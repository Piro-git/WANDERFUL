import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as ed25519Sign,
  verify as ed25519Verify
} from "node:crypto";
import { lstatSync, unlinkSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import {
  AUDITOR_ROLE,
  CANONICAL_UTC,
  HEX_40,
  HEX_64,
  LIMITS,
  SIGNATURE_DOMAIN,
  SIGNED_RECEIPT_SCHEMA_VERSION,
  TARGET_PROJECT_NAME,
  UUID
} from "./constants.js";
import {
  canonicalJson,
  exactKeys,
  sha256Bytes,
  strictParseJson
} from "./canonicalJson.js";
import { blocked } from "./errors.js";
import {
  MIGRATION_PROFILE_SCHEMA_VERSION,
  SUPABASE_PHASE1_PROFILE_ID
} from "./migrationProfiles.js";
import { atomicWriteFile, readSafeRegularFile } from "./safeFiles.js";

const PRIVATE_KEY_FILE = "trailmind-observer-ed25519.pk8";
const PUBLIC_KEY_FILE = "trailmind-observer-ed25519.spki";
const SIGNATURE = /^[A-Za-z0-9_-]{86}$/;
const APPLICATION_NAME = /^trailmind_p1v2_auditor_[a-f0-9]{32}$/;

export function stableKeyId(publicKeySpkiSha256) {
  if (!HEX_64.test(publicKeySpkiSha256)) blocked("key_pin");
  return `trailmind-observer-ed25519-${publicKeySpkiSha256.slice(0, 24)}`;
}

export function inspectPublicKeySpki(publicKeyDer) {
  if (!Buffer.isBuffer(publicKeyDer) || publicKeyDer.length < 32 ||
      publicKeyDer.length > 1_024) blocked("public_key_bytes");
  let publicKey;
  try {
    publicKey = createPublicKey({
      format: "der",
      key: publicKeyDer,
      type: "spki"
    });
  } catch {
    blocked("public_key_parse");
  }
  if (publicKey.asymmetricKeyType !== "ed25519") blocked("public_key_algorithm");
  const publicKeySpkiSha256 = sha256Bytes(publicKeyDer);
  return Object.freeze({
    algorithm: "Ed25519",
    keyId: stableKeyId(publicKeySpkiSha256),
    publicKeySpkiSha256
  });
}

export function provisionCandidateSigningKey({ outputDirectory }) {
  if (typeof outputDirectory !== "string" || !isAbsolute(outputDirectory)) {
    blocked("key_output_directory");
  }
  const directory = resolve(outputDirectory);
  const metadata = lstatSync(directory);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() ||
      metadata.uid !== process.getuid?.() || (metadata.mode & 0o077) !== 0) {
    blocked("key_output_directory");
  }
  const privatePath = join(directory, PRIVATE_KEY_FILE);
  const publicPath = join(directory, PUBLIC_KEY_FILE);
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const privateDer = privateKey.export({ format: "der", type: "pkcs8" });
  const publicDer = publicKey.export({ format: "der", type: "spki" });
  try {
    atomicWriteFile(privatePath, privateDer, { mode: 0o600 });
    try {
      atomicWriteFile(publicPath, publicDer, { mode: 0o644 });
    } catch (error) {
      safeUnlinkCreated(privatePath);
      throw error;
    }
    const publicMetadata = inspectPublicKeySpki(publicDer);
    return Object.freeze({
      ...publicMetadata,
      candidateOnly: true,
      privateKeyFileName: PRIVATE_KEY_FILE,
      privateKeyMode: "0600",
      publicKeyFileName: PUBLIC_KEY_FILE
    });
  } finally {
    privateDer.fill(0);
  }
}

export function createUnsignedReceipt(value) {
  validateUnsignedReceipt(value);
  return Object.freeze(clone(value));
}

export function signCanonicalReceipt({
  privateKeyPath,
  receipt,
  requiredKeyId,
  requiredPublicKeySpkiSha256
}) {
  validateUnsignedReceipt(receipt);
  if (typeof privateKeyPath !== "string" || !isAbsolute(privateKeyPath)) {
    blocked("private_key_path");
  }
  if (typeof requiredKeyId !== "string" ||
      !HEX_64.test(requiredPublicKeySpkiSha256) ||
      stableKeyId(requiredPublicKeySpkiSha256) !== requiredKeyId) {
    blocked("signing_pin");
  }
  const privateBytes = readSafeRegularFile(resolve(privateKeyPath), {
    maximumBytes: LIMITS.privateKeyBytes,
    privateFile: true
  });
  try {
    let privateKey;
    try {
      privateKey = createPrivateKey({
        format: "der",
        key: privateBytes,
        type: "pkcs8"
      });
    } catch {
      blocked("private_key_parse");
    }
    if (privateKey.asymmetricKeyType !== "ed25519") blocked("private_key_algorithm");
    const publicDer = createPublicKey(privateKey).export({
      format: "der",
      type: "spki"
    });
    const inspected = inspectPublicKeySpki(publicDer);
    if (inspected.keyId !== requiredKeyId ||
        inspected.publicKeySpkiSha256 !== requiredPublicKeySpkiSha256) {
      blocked("private_key_pin_mismatch");
    }
    const canonicalReceipt = canonicalJson(receipt);
    const message = Buffer.concat([
      Buffer.from(SIGNATURE_DOMAIN, "utf8"),
      Buffer.from(canonicalReceipt, "utf8")
    ]);
    const signature = ed25519Sign(null, message, privateKey).toString("base64url");
    const envelope = {
      algorithm: "Ed25519",
      artifactSha256: sha256Bytes(canonicalReceipt),
      keyId: requiredKeyId,
      publicKeySpkiSha256: requiredPublicKeySpkiSha256,
      receipt: clone(receipt),
      schemaVersion: SIGNED_RECEIPT_SCHEMA_VERSION,
      signature
    };
    validateEnvelope(envelope);
    return Object.freeze({
      canonical: canonicalJson(envelope),
      envelope: deepFreeze(envelope)
    });
  } finally {
    privateBytes.fill(0);
  }
}

export function verifyCanonicalReceipt({
  envelope,
  publicKeyPath,
  requiredKeyId,
  requiredPublicKeySpkiSha256
}) {
  if (typeof publicKeyPath !== "string" || !isAbsolute(publicKeyPath)) {
    blocked("public_key_path");
  }
  const parsed = typeof envelope === "string" || Buffer.isBuffer(envelope)
    ? strictParseJson(envelope)
    : clone(envelope);
  validateEnvelope(parsed);
  if (parsed.keyId !== requiredKeyId ||
      parsed.publicKeySpkiSha256 !== requiredPublicKeySpkiSha256 ||
      stableKeyId(requiredPublicKeySpkiSha256) !== requiredKeyId) {
    blocked("verification_pin");
  }
  const publicBytes = readSafeRegularFile(resolve(publicKeyPath), {
    maximumBytes: 1_024
  });
  const inspected = inspectPublicKeySpki(publicBytes);
  if (inspected.keyId !== requiredKeyId ||
      inspected.publicKeySpkiSha256 !== requiredPublicKeySpkiSha256) {
    blocked("verification_public_key");
  }
  const canonicalReceipt = canonicalJson(parsed.receipt);
  if (sha256Bytes(canonicalReceipt) !== parsed.artifactSha256) {
    blocked("verification_artifact_digest");
  }
  const message = Buffer.concat([
    Buffer.from(SIGNATURE_DOMAIN, "utf8"),
    Buffer.from(canonicalReceipt, "utf8")
  ]);
  const publicKey = createPublicKey({
    format: "der",
    key: publicBytes,
    type: "spki"
  });
  if (!ed25519Verify(
    null,
    message,
    publicKey,
    Buffer.from(parsed.signature, "base64url")
  )) blocked("verification_signature");
  return Object.freeze({
    artifactSha256: parsed.artifactSha256,
    authenticityProved: true,
    integrityProved: true,
    freshnessProved: false,
    truthProved: false
  });
}

export function writeSignedEnvelope(path, signed) {
  if (!signed || typeof signed.canonical !== "string") blocked("signed_envelope");
  atomicWriteFile(resolve(path), Buffer.from(`${signed.canonical}\n`, "utf8"), {
    mode: 0o600
  });
}

function validateUnsignedReceipt(value) {
  exactKeys(value, [
    "auditorIdentity", "auditorSslrootcertSha256", "candidateGitCommit",
    "candidateGitTree", "catalogResultSha256", "expectedManifestSha256",
    "migrationProfileId", "migrationProfileSchemaVersion", "observedAt",
    "programSha256", "result", "runId", "schemaVersion",
    "targetProjectName"
  ], "receipt_keys");
  if (value.schemaVersion !== SIGNED_RECEIPT_SCHEMA_VERSION ||
      value.migrationProfileSchemaVersion !== MIGRATION_PROFILE_SCHEMA_VERSION ||
      value.migrationProfileId !== SUPABASE_PHASE1_PROFILE_ID ||
      value.targetProjectName !== TARGET_PROJECT_NAME ||
      !UUID.test(value.runId) || !HEX_40.test(value.candidateGitCommit) ||
      !HEX_40.test(value.candidateGitTree) ||
      !HEX_64.test(value.auditorSslrootcertSha256) ||
      !HEX_64.test(value.catalogResultSha256) ||
      !HEX_64.test(value.expectedManifestSha256) ||
      !HEX_64.test(value.programSha256) ||
      typeof value.observedAt !== "string" ||
      !CANONICAL_UTC.test(value.observedAt) ||
      new Date(value.observedAt).toISOString() !== value.observedAt) {
    blocked("receipt_header");
  }
  exactKeys(value.auditorIdentity, [
    "applicationName", "backendPid", "roleName", "sessionIdentitySha256"
  ], "receipt_auditor_keys");
  if (value.auditorIdentity.roleName !== AUDITOR_ROLE ||
      !APPLICATION_NAME.test(value.auditorIdentity.applicationName) ||
      !Number.isSafeInteger(value.auditorIdentity.backendPid) ||
      value.auditorIdentity.backendPid <= 0 ||
      !HEX_64.test(value.auditorIdentity.sessionIdentitySha256)) {
    blocked("receipt_auditor");
  }
  exactKeys(value.result, ["digest", "status"], "receipt_result_keys");
  if (value.result.status !== "pass" || !HEX_64.test(value.result.digest)) {
    blocked("receipt_result");
  }
  if (Buffer.byteLength(canonicalJson(value)) > 32 * 1024) blocked("receipt_size");
}

function validateEnvelope(value) {
  exactKeys(value, [
    "algorithm", "artifactSha256", "keyId", "publicKeySpkiSha256", "receipt",
    "schemaVersion", "signature"
  ], "envelope_keys");
  if (value.schemaVersion !== SIGNED_RECEIPT_SCHEMA_VERSION ||
      value.algorithm !== "Ed25519" || !HEX_64.test(value.artifactSha256) ||
      !HEX_64.test(value.publicKeySpkiSha256) ||
      value.keyId !== stableKeyId(value.publicKeySpkiSha256) ||
      typeof value.signature !== "string" || !SIGNATURE.test(value.signature)) {
    blocked("envelope_header");
  }
  validateUnsignedReceipt(value.receipt);
}

function clone(value) {
  return strictParseJson(canonicalJson(value));
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(deepFreeze);
  return value;
}

function safeUnlinkCreated(path) {
  try {
    const metadata = lstatSync(path);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1 ||
        metadata.uid !== process.getuid?.()) blocked("partial_key_cleanup");
    unlinkSync(path);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}
