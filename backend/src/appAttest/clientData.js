import { createHash, timingSafeEqual } from "node:crypto";
import { appAttestError } from "./appAttestErrors.js";

export const ROUTE_SESSION_METHOD = "POST";
export const ROUTE_SESSION_PATH = "/api/app-attest/route-session";
export const ROUTE_SESSION_SCHEMA = "trailmind-route-session-v1";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export function canonicalRouteSessionClientData({ challenge, keyId, sessionNonce }) {
  const fields = [
    Buffer.from(ROUTE_SESSION_SCHEMA, "utf8"),
    Buffer.from(ROUTE_SESSION_METHOD, "utf8"),
    Buffer.from(ROUTE_SESSION_PATH, "utf8"),
    requiredBuffer(challenge),
    Buffer.from(requiredOpaqueString(keyId, "keyId", 512), "utf8"),
    requiredBuffer(sessionNonce)
  ];
  return Buffer.concat(fields.flatMap((field) => [uint32(field.length), field]));
}

export function sha256(value) {
  return createHash("sha256").update(value).digest();
}

export function hashOpaqueValue(value) {
  return sha256(Buffer.from(requiredOpaqueString(value, "opaque value", 4_096), "utf8")).toString("hex");
}

export function installationIdentity(environment, keyId) {
  return sha256(Buffer.from(`${environment}\0${keyId}`, "utf8")).toString("hex");
}

export function decodeBase64Url(value, options = {}) {
  const string = requiredOpaqueString(value, options.name ?? "base64url value", options.maxLength ?? 65_536);
  if (!BASE64URL_PATTERN.test(string) || string.length % 4 === 1) {
    throw appAttestError("app_attest_invalid");
  }
  const decoded = Buffer.from(string, "base64url");
  if (decoded.length === 0 || decoded.toString("base64url") !== string) {
    throw appAttestError("app_attest_invalid");
  }
  if (options.expectedLength !== undefined && decoded.length !== options.expectedLength) {
    throw appAttestError("app_attest_invalid");
  }
  return decoded;
}

export function decodeBase64(value, options = {}) {
  const string = requiredOpaqueString(value, options.name ?? "base64 value", options.maxLength ?? 65_536);
  if (!BASE64_PATTERN.test(string)) throw appAttestError("app_attest_invalid");
  const decoded = Buffer.from(string, "base64");
  if (decoded.length === 0 || decoded.toString("base64") !== string) {
    throw appAttestError("app_attest_invalid");
  }
  if (options.expectedLength !== undefined && decoded.length !== options.expectedLength) {
    throw appAttestError("app_attest_invalid");
  }
  return decoded;
}

export function encodeBase64Url(value) {
  return requiredBuffer(value).toString("base64url");
}

export function assertRequestId(value) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw appAttestError("route_session_invalid");
  }
  return value.toLowerCase();
}

export function equalBytes(left, right) {
  const lhs = requiredBuffer(left);
  const rhs = requiredBuffer(right);
  return lhs.length === rhs.length && timingSafeEqual(lhs, rhs);
}

export function requiredOpaqueString(value, _name, maximumLength) {
  if (
    typeof value !== "string" || value.length === 0 || value.length > maximumLength ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw appAttestError("app_attest_invalid");
  }
  return value;
}

function requiredBuffer(value) {
  if (!Buffer.isBuffer(value) && !(value instanceof Uint8Array)) {
    throw appAttestError("app_attest_invalid");
  }
  const buffer = Buffer.from(value);
  if (buffer.length === 0) throw appAttestError("app_attest_invalid");
  return buffer;
}

function uint32(value) {
  const buffer = Buffer.allocUnsafe(4);
  buffer.writeUInt32BE(value);
  return buffer;
}
