import { createHash } from "node:crypto";

export function stableSerializeStagingReadinessV1(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableSerializeStagingReadinessV1).join(",")}]`;
  }
  return `{${Object.keys(value).sort().map((key) =>
    `${JSON.stringify(key)}:${stableSerializeStagingReadinessV1(value[key])}`
  ).join(",")}}`;
}

export function sha256StagingReadinessV1(value) {
  const bytes = typeof value === "string" || Buffer.isBuffer(value) ||
    value instanceof Uint8Array
    ? value
    : stableSerializeStagingReadinessV1(value);
  return createHash("sha256").update(bytes).digest("hex");
}

export function deepFreezeStagingReadinessV1(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  Object.values(value).forEach(deepFreezeStagingReadinessV1);
  return value;
}
