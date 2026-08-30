import { X509Certificate } from "node:crypto";
import { resolve } from "node:path";
import { HEX_64, LIMITS } from "./constants.js";
import { sha256Bytes } from "./canonicalJson.js";
import { blocked, notReady } from "./errors.js";
import { readSafeRegularFile } from "./safeFiles.js";

export function acquireCandidateCaPin({ caCertificatePath }) {
  if (typeof caCertificatePath !== "string") blocked("ca_path");
  const bytes = readSafeRegularFile(resolve(caCertificatePath), {
    maximumBytes: LIMITS.caBytes
  });
  const text = bytes.toString("ascii");
  if (/PRIVATE KEY/.test(text) || /postgres(?:ql)?:\/\//i.test(text)) {
    blocked("ca_sensitive_content");
  }
  const pemCount = (text.match(/-----BEGIN CERTIFICATE-----/g) ?? []).length;
  if (pemCount > 1 || pemCount === 1 &&
      (text.match(/-----END CERTIFICATE-----/g) ?? []).length !== 1) {
    blocked("ca_certificate_count");
  }
  if (pemCount === 1 && !/^\s*-----BEGIN CERTIFICATE-----[A-Za-z0-9+/=\r\n]+-----END CERTIFICATE-----\s*$/.test(
    text
  )) blocked("ca_trailing_content");
  let certificate;
  try {
    certificate = new X509Certificate(bytes);
  } catch {
    blocked("ca_parse");
  }
  if (certificate.ca !== true || certificate.raw.length > LIMITS.caBytes) {
    blocked("ca_not_authority");
  }
  return Object.freeze({
    candidateOnly: true,
    certificateDerSha256: sha256Bytes(certificate.raw),
    digestAlgorithm: "sha256",
    sslrootcertSha256: sha256Bytes(bytes)
  });
}

export function verifyPinnedCaFile({ caCertificatePath, reviewedSslrootcertSha256 }) {
  if (reviewedSslrootcertSha256 === null ||
      reviewedSslrootcertSha256 === undefined) notReady("ca_pin_missing");
  if (typeof reviewedSslrootcertSha256 !== "string" ||
      !HEX_64.test(reviewedSslrootcertSha256)) blocked("ca_pin_format");
  const candidate = acquireCandidateCaPin({ caCertificatePath });
  if (candidate.sslrootcertSha256 !== reviewedSslrootcertSha256) {
    blocked("ca_pin_mismatch");
  }
  return Object.freeze({
    digestAlgorithm: "sha256",
    pinMatched: true,
    sslrootcertSha256: reviewedSslrootcertSha256
  });
}
