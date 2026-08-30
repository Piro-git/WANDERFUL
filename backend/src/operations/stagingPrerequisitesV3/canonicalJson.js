import { createHash } from "node:crypto";
import { LIMITS } from "./constants.js";
import { blocked } from "./errors.js";

export function sha256Bytes(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function strictParseJson(input, {
  maximumBytes = LIMITS.jsonBytes,
  maximumDepth = LIMITS.depth
} = {}) {
  const source = Buffer.isBuffer(input) ? input.toString("utf8") : input;
  if (typeof source !== "string" ||
      Buffer.byteLength(source, "utf8") > maximumBytes) {
    blocked("json_size");
  }
  if (source.includes("\0") || source.includes("\uFEFF")) blocked("json_encoding");
  let offset = 0;

  function whitespace() {
    while (/[\x20\x09\x0a\x0d]/.test(source[offset] ?? "")) offset += 1;
  }

  function value(depth) {
    if (depth > maximumDepth) blocked("json_depth");
    whitespace();
    const character = source[offset];
    if (character === "{") return object(depth + 1);
    if (character === "[") return array(depth + 1);
    if (character === '"') return string();
    if (source.startsWith("true", offset)) {
      offset += 4;
      return true;
    }
    if (source.startsWith("false", offset)) {
      offset += 5;
      return false;
    }
    if (source.startsWith("null", offset)) {
      offset += 4;
      return null;
    }
    return number();
  }

  function object(depth) {
    offset += 1;
    const result = Object.create(null);
    const keys = new Set();
    whitespace();
    if (source[offset] === "}") {
      offset += 1;
      return result;
    }
    while (true) {
      whitespace();
      if (source[offset] !== '"') blocked("json_object_key");
      const key = string();
      if (keys.has(key)) blocked("json_duplicate_key");
      keys.add(key);
      whitespace();
      if (source[offset] !== ":") blocked("json_object_colon");
      offset += 1;
      result[key] = value(depth);
      whitespace();
      if (source[offset] === "}") {
        offset += 1;
        return result;
      }
      if (source[offset] !== ",") blocked("json_object_separator");
      offset += 1;
    }
  }

  function array(depth) {
    offset += 1;
    const result = [];
    whitespace();
    if (source[offset] === "]") {
      offset += 1;
      return result;
    }
    while (true) {
      if (result.length >= LIMITS.arrayItems) blocked("json_array_bound");
      result.push(value(depth));
      whitespace();
      if (source[offset] === "]") {
        offset += 1;
        return result;
      }
      if (source[offset] !== ",") blocked("json_array_separator");
      offset += 1;
    }
  }

  function string() {
    const start = offset;
    offset += 1;
    let escaped = false;
    while (offset < source.length) {
      const code = source.charCodeAt(offset);
      if (!escaped && code === 0x22) {
        offset += 1;
        let parsed;
        try {
          parsed = JSON.parse(source.slice(start, offset));
        } catch {
          blocked("json_string");
        }
        if (parsed.length > LIMITS.stringCharacters || hasLoneSurrogate(parsed)) {
          blocked("json_string");
        }
        return parsed;
      }
      if (!escaped && code < 0x20) blocked("json_string_control");
      if (!escaped && code === 0x5c) {
        escaped = true;
      } else {
        escaped = false;
      }
      offset += 1;
    }
    blocked("json_string_unterminated");
  }

  function number() {
    const match = source.slice(offset).match(
      /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/
    );
    if (!match) blocked("json_token");
    offset += match[0].length;
    const parsed = Number(match[0]);
    if (!Number.isFinite(parsed) || Object.is(parsed, -0)) blocked("json_number");
    if (/^-?\d+$/.test(match[0]) && !Number.isSafeInteger(parsed)) {
      blocked("json_integer_precision");
    }
    return parsed;
  }

  const parsed = value(0);
  whitespace();
  if (offset !== source.length) blocked("json_trailing_data");
  return parsed;
}

export function canonicalJson(value) {
  const seen = new Set();
  function serialize(candidate, depth) {
    if (depth > LIMITS.depth) blocked("canonical_depth");
    if (candidate === null || typeof candidate === "boolean") {
      return JSON.stringify(candidate);
    }
    if (typeof candidate === "string") {
      if (candidate.length > LIMITS.stringCharacters ||
          hasLoneSurrogate(candidate)) blocked("canonical_string");
      return JSON.stringify(candidate);
    }
    if (typeof candidate === "number") {
      if (!Number.isFinite(candidate) || Object.is(candidate, -0)) {
        blocked("canonical_number");
      }
      if (Number.isInteger(candidate) && !Number.isSafeInteger(candidate)) {
        blocked("canonical_number");
      }
      return JSON.stringify(candidate);
    }
    if (!candidate || typeof candidate !== "object") blocked("canonical_type");
    if (!Array.isArray(candidate) &&
        Object.getPrototypeOf(candidate) !== Object.prototype &&
        Object.getPrototypeOf(candidate) !== null) blocked("canonical_type");
    if (seen.has(candidate)) blocked("canonical_cycle");
    seen.add(candidate);
    let output;
    if (Array.isArray(candidate)) {
      if (candidate.length > LIMITS.arrayItems) blocked("canonical_array_bound");
      output = `[${candidate.map((item) => serialize(item, depth + 1)).join(",")}]`;
    } else {
      const keys = Object.keys(candidate).sort();
      output = `{${keys.map((key) => {
        if (key.length > LIMITS.stringCharacters || hasLoneSurrogate(key)) {
          blocked("canonical_key");
        }
        if (candidate[key] === undefined) blocked("canonical_undefined");
        return `${JSON.stringify(key)}:${serialize(candidate[key], depth + 1)}`;
      }).join(",")}}`;
    }
    seen.delete(candidate);
    return output;
  }
  const output = serialize(value, 0);
  if (Buffer.byteLength(output, "utf8") > LIMITS.outputBytes) {
    blocked("canonical_output_bound");
  }
  return output;
}

export function canonicalSha256(value) {
  return sha256Bytes(canonicalJson(value));
}

export function exactKeys(value, keys, code = "schema_keys") {
  if (!value || typeof value !== "object" || Array.isArray(value)) blocked(code);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length ||
      actual.some((key, index) => key !== expected[index])) blocked(code);
}

function hasLoneSurrogate(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!Number.isInteger(next) || next < 0xdc00 || next > 0xdfff) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}
