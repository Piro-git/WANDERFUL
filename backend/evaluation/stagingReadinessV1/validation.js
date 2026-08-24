import { MAXIMUM_RECEIPT_BYTES } from "./constants.js";
import { stableSerializeStagingReadinessV1 } from "./serialization.js";

export const HEX_40 = /^[a-f0-9]{40}$/;
export const HEX_64 = /^[a-f0-9]{64}$/;
export const IMAGE_DIGEST = /^sha256:[a-f0-9]{64}$/;
export const SAFE_CODE = /^[a-z][a-z0-9_]{0,95}$/;
export const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
export const CANONICAL_UTC =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const FORBIDDEN_KEYS = new Set([
  "url",
  "databaseUrl",
  "connectionString",
  "password",
  "secret",
  "credential",
  "token",
  "authorization",
  "prompt",
  "latitude",
  "longitude",
  "coordinate",
  "coordinates",
  "geometry",
  "routeGeometry",
  "assertion",
  "attestationObject",
  "clientData",
  "privateKey",
  "headers",
  "requestBody",
  "responseBody",
  "rawError"
]);

const FORBIDDEN_STRING_PATTERNS = Object.freeze([
  /https?:\/\//i,
  /postgres(?:ql)?:\/\//i,
  /(?:^|\s)Bearer\s+[A-Za-z0-9._~+\/-]+/i,
  /-----BEGIN (?:RSA |EC |OPENSSH |)PRIVATE KEY-----/,
  /(?:password|passwd|api[_-]?key|client[_-]?secret)\s*[:=]/i,
  /\b(?:lat(?:itude)?|lon(?:gitude)?)\s*[:=]\s*-?\d{1,3}\.\d{4,}\b/i,
  /\b(?:LINESTRING|POLYGON|MULTIPOLYGON|GEOMETRYCOLLECTION)\s*\(/i
]);

export class StagingReadinessContractError extends Error {
  constructor(code) {
    super(code);
    this.name = "StagingReadinessContractError";
    this.code = code;
  }
}

export function invalidStagingReadinessV1(code = "invalid_staging_readiness_receipt") {
  throw new StagingReadinessContractError(code);
}

export function plainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function exactKeys(value, expected, code = "receipt_schema_drift") {
  if (!plainObject(value)) invalidStagingReadinessV1(code);
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  if (actual.length !== sortedExpected.length ||
      actual.some((key, index) => key !== sortedExpected[index])) {
    invalidStagingReadinessV1(code);
  }
}

export function assertExactOrderedIds(values, expected, field = "id") {
  if (!Array.isArray(values) || values.length !== expected.length ||
      values.some((value, index) => !plainObject(value) ||
        value[field] !== expected[index])) {
    invalidStagingReadinessV1("receipt_canonical_order_mismatch");
  }
}

export function assertBoundedArray(value, maximum, code = "receipt_array_invalid") {
  if (!Array.isArray(value) || value.length > maximum) {
    invalidStagingReadinessV1(code);
  }
}

export function assertSafeCodes(value, maximum = 32) {
  assertBoundedArray(value, maximum, "receipt_issue_codes_invalid");
  if (new Set(value).size !== value.length ||
      value.some((code) => typeof code !== "string" || !SAFE_CODE.test(code))) {
    invalidStagingReadinessV1("receipt_issue_codes_invalid");
  }
}

export function timestampMilliseconds(value) {
  if (typeof value !== "string" || !CANONICAL_UTC.test(value)) {
    invalidStagingReadinessV1("receipt_clock_invalid");
  }
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    invalidStagingReadinessV1("receipt_clock_invalid");
  }
  return milliseconds;
}

export function assertDigest(value, code = "receipt_digest_invalid") {
  if (typeof value !== "string" || !HEX_64.test(value)) {
    invalidStagingReadinessV1(code);
  }
}

export function assertSafeIdentifier(value, code = "receipt_identifier_invalid") {
  if (typeof value !== "string" || !SAFE_IDENTIFIER.test(value)) {
    invalidStagingReadinessV1(code);
  }
}

export function assertSafeReceiptValue(value) {
  let serialized;
  try {
    serialized = stableSerializeStagingReadinessV1(value);
  } catch {
    invalidStagingReadinessV1("receipt_serialization_failed");
  }
  if (Buffer.byteLength(serialized) > MAXIMUM_RECEIPT_BYTES) {
    invalidStagingReadinessV1("receipt_output_too_large");
  }
  scan(value, 0);
}

function scan(value, depth) {
  if (depth > 32) invalidStagingReadinessV1("receipt_nesting_too_deep");
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) invalidStagingReadinessV1("receipt_number_invalid");
    return;
  }
  if (typeof value === "string") {
    if (value.length > 512 || value.includes("\0") || value.includes("\n") ||
        FORBIDDEN_STRING_PATTERNS.some((pattern) => pattern.test(value))) {
      invalidStagingReadinessV1("receipt_sensitive_value_rejected");
    }
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > 128) invalidStagingReadinessV1("receipt_array_too_large");
    value.forEach((item) => scan(item, depth + 1));
    return;
  }
  if (!plainObject(value)) invalidStagingReadinessV1("receipt_value_invalid");
  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key)) {
      invalidStagingReadinessV1("receipt_sensitive_key_rejected");
    }
    scan(nested, depth + 1);
  }
}
