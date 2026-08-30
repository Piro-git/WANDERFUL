import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign,
  verify
} from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  openSync,
  readFileSync,
  readSync,
  writeSync
} from "node:fs";
import { join } from "node:path";
import {
  parseStagingPhase1V2BoundedJson,
  STAGING_PHASE1_V2_PRODUCTION_OBSERVER_POLICY,
  StagingPhase1V2ProductionObserverContractError
} from "./stagingPhase1V2ProductionObserverContract.js";

const DIGEST_PATTERN = /^[a-f0-9]{64}$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAXIMUM_SIGNING_KEY_BYTES = 16 * 1024;
const PHASES = Object.freeze([
  [1, "pre-control", "observer.01.pre-control.json"],
  [2, "post-ddl-advisors", "observer.02.post-ddl-advisors.json"],
  [3, "final-control", "observer.03.final-control.json"],
  [4, "post-disconnect-cleanup", "observer.04.post-disconnect-cleanup.json"]
]);

// These values intentionally remain null. A production key may only be added
// as reviewed source literals in a later, separately accepted change. Neither
// runtime configuration nor a caller may supply a replacement public key.
const PINNED_SIGNING_KEY_ID = null;
const PINNED_SIGNING_PUBLIC_KEY_DER_BASE64 = null;
const PINNED_SIGNING_PUBLIC_KEY_SHA256 = null;

export const STAGING_PHASE1_V2_PRODUCTION_ARTIFACT_MANIFEST = deepFreeze({
  schemaVersion:
    STAGING_PHASE1_V2_PRODUCTION_OBSERVER_POLICY.artifacts.schemaVersion,
  signatureAlgorithm: "Ed25519",
  signatureDomain: "trailmind-production-observer-v1",
  signingKeyId: PINNED_SIGNING_KEY_ID,
  signingPublicKeySha256: PINNED_SIGNING_PUBLIC_KEY_SHA256,
  productionSigningAvailable: false,
  phases: PHASES.map(([sequence, phase, suffix]) => ({
    sequence, phase, suffix
  }))
});

export function assertStagingPhase1V2ProductionSigningAvailable() {
  if (typeof PINNED_SIGNING_KEY_ID !== "string" ||
      typeof PINNED_SIGNING_PUBLIC_KEY_DER_BASE64 !== "string" ||
      !DIGEST_PATTERN.test(PINNED_SIGNING_PUBLIC_KEY_SHA256 ?? "")) {
    blocked("observer_signature_key");
  }
  const der = Buffer.from(PINNED_SIGNING_PUBLIC_KEY_DER_BASE64, "base64");
  try {
    if (der.length === 0 || sha256(der) !==
        PINNED_SIGNING_PUBLIC_KEY_SHA256) {
      blocked("observer_signature_key");
    }
  } finally {
    der.fill(0);
  }
  return Object.freeze({
    keyId: PINNED_SIGNING_KEY_ID,
    publicKeySha256: PINNED_SIGNING_PUBLIC_KEY_SHA256
  });
}

export function createAndPersistStagingPhase1V2ProductionArtifact({
  attemptDirectory,
  evidence,
  signingCredentialFd,
  unsignedArtifact
}) {
  try {
    assertStagingPhase1V2ProductionSigningAvailable();
  } catch (error) {
    closeDescriptor(signingCredentialFd);
    throw error;
  }
  try {
    validateUnsignedArtifact(unsignedArtifact, evidence);
    assertDurablePredecessor(unsignedArtifact, attemptDirectory);
  } catch (error) {
    closeDescriptor(signingCredentialFd);
    throw error;
  }
  const privateKeyBytes = consumeProtectedSigningDescriptor(
    signingCredentialFd
  );
  let privateKey;
  try {
    privateKey = createPrivateKey({
      format: "der",
      key: privateKeyBytes,
      type: "pkcs8"
    });
    const publicKeyDer = createPublicKey(privateKey).export({
      format: "der", type: "spki"
    });
    try {
      if (sha256(publicKeyDer) !== PINNED_SIGNING_PUBLIC_KEY_SHA256) {
        blocked("observer_signature_key");
      }
    } finally {
      publicKeyDer.fill(0);
    }
    const artifactDigest = sha256(canonicalJson(unsignedArtifact));
    const payload = signaturePayload(artifactDigest);
    let signatureBytes;
    try {
      signatureBytes = sign(null, payload, privateKey);
    } finally {
      payload.fill(0);
    }
    const artifact = deepFreeze({
      ...unsignedArtifact,
      artifactDigest,
      signature: {
        algorithm: "Ed25519",
        keyId: PINNED_SIGNING_KEY_ID,
        signedPayloadDigest: sha256(signaturePayload(artifactDigest)),
        valueBase64: signatureBytes.toString("base64")
      }
    });
    signatureBytes.fill(0);
    verifyProductionArtifact(artifact);
    persistArtifact({ artifact, attemptDirectory });
    return artifact;
  } catch (error) {
    if (error instanceof StagingPhase1V2ProductionObserverContractError) {
      throw error;
    }
    blocked("observer_signature");
  } finally {
    privateKey = undefined;
    privateKeyBytes.fill(0);
    closeDescriptor(signingCredentialFd);
  }
}

export function verifyStagingPhase1V2ProductionArtifact(artifact) {
  assertStagingPhase1V2ProductionSigningAvailable();
  verifyProductionArtifact(artifact);
  return Object.freeze({
    artifactDigest: artifact.artifactDigest,
    verified: true
  });
}

function validateUnsignedArtifact(value, evidence) {
  const commonKeys = [
    "binding", "contractDigest", "contractId", "contractVersion",
    "evidence", "managementCallLedgerDigest", "monotonicCompletedNanoseconds",
    "monotonicStartedNanoseconds", "observationId", "observedAt", "package",
    "phase", "previousArtifactDigest", "requestNonce", "schemaVersion",
    "sequence", "session"
  ];
  if (!isExactObject(value, commonKeys) || value.evidence !== evidence ||
      value.schemaVersion !== 2 || !UUID_PATTERN.test(value.observationId) ||
      !UUID_PATTERN.test(value.requestNonce) ||
      value.observationId === value.requestNonce ||
      !DIGEST_PATTERN.test(value.contractDigest) ||
      !DIGEST_PATTERN.test(value.managementCallLedgerDigest) ||
      !isExactObject(value.package, [
        "id", "packageSourceDigest", "signingKeyId", "trustMode", "version"
      ]) || value.package.id !==
        STAGING_PHASE1_V2_PRODUCTION_OBSERVER_POLICY.packageId ||
      value.package.trustMode !==
        STAGING_PHASE1_V2_PRODUCTION_OBSERVER_POLICY.trustMode ||
      value.package.signingKeyId !== PINNED_SIGNING_KEY_ID ||
      !DIGEST_PATTERN.test(value.package.packageSourceDigest) ||
      !isExactPhase(value.sequence, value.phase) ||
      (value.sequence === 1
        ? value.previousArtifactDigest !== null
        : !DIGEST_PATTERN.test(value.previousArtifactDigest))) {
    blocked("observer_contract");
  }
  const bytes = Buffer.byteLength(canonicalJson(value), "utf8");
  if (bytes >
      STAGING_PHASE1_V2_PRODUCTION_OBSERVER_POLICY.artifacts.maximumBytesEach) {
    blocked("observer_oversized");
  }
  assertSanitized(value);
}

function verifyProductionArtifact(artifact) {
  if (!isExactObject(artifact.signature, [
    "algorithm", "keyId", "signedPayloadDigest", "valueBase64"
  ]) || artifact.signature.algorithm !== "Ed25519" ||
      artifact.signature.keyId !== PINNED_SIGNING_KEY_ID ||
      !DIGEST_PATTERN.test(artifact.artifactDigest) ||
      !DIGEST_PATTERN.test(artifact.signature.signedPayloadDigest)) {
    blocked("observer_signature");
  }
  const unsigned = Object.fromEntries(Object.entries(artifact).filter(
    ([key]) => !["artifactDigest", "signature"].includes(key)
  ));
  if (sha256(canonicalJson(unsigned)) !== artifact.artifactDigest) {
    blocked("observer_signature");
  }
  const payload = signaturePayload(artifact.artifactDigest);
  const signature = Buffer.from(artifact.signature.valueBase64, "base64");
  const publicKeyDer = Buffer.from(
    PINNED_SIGNING_PUBLIC_KEY_DER_BASE64, "base64"
  );
  try {
    if (sha256(payload) !== artifact.signature.signedPayloadDigest ||
        signature.length !== 64 ||
        !verify(null, payload, createPublicKey({
          format: "der", key: publicKeyDer, type: "spki"
        }), signature)) {
      blocked("observer_signature");
    }
  } finally {
    payload.fill(0);
    signature.fill(0);
    publicKeyDer.fill(0);
  }
}

function persistArtifact({ artifact, attemptDirectory }) {
  const phase = PHASES.find(([sequence, name]) =>
    sequence === artifact.sequence && name === artifact.phase
  );
  if (!phase || typeof attemptDirectory !== "string" ||
      !UUID_PATTERN.test(artifact.binding?.runId)) {
    blocked("observer_persistence");
  }
  const path = join(
    attemptDirectory,
    `${artifact.binding.runId}.${phase[2]}`
  );
  const bytes = Buffer.from(canonicalJson(artifact), "utf8");
  let fd;
  try {
    fd = openSync(path, constants.O_WRONLY | constants.O_CREAT |
      constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
    let offset = 0;
    while (offset < bytes.length) {
      const written = writeSync(fd, bytes, offset, bytes.length - offset, null);
      if (!Number.isSafeInteger(written) || written <= 0) {
        blocked("observer_persistence");
      }
      offset += written;
    }
    fsyncSync(fd);
    const metadata = fstatSync(fd);
    if (!metadata.isFile() || metadata.uid !== process.geteuid() ||
        metadata.nlink !== 1 || (metadata.mode & 0o777) !== 0o600 ||
        metadata.size !== bytes.length) {
      blocked("observer_persistence");
    }
    closeSync(fd);
    fd = undefined;
    const directoryFd = openSync(attemptDirectory, constants.O_RDONLY);
    try { fsyncSync(directoryFd); } finally { closeSync(directoryFd); }
    const persisted = readFileSync(path);
    try {
      const parsed = parseStagingPhase1V2BoundedJson(persisted, {
        maximumBytes:
          STAGING_PHASE1_V2_PRODUCTION_OBSERVER_POLICY.artifacts.maximumBytesEach
      });
      if (canonicalJson(parsed) !== canonicalJson(artifact)) {
        blocked("observer_persistence");
      }
      verifyProductionArtifact(parsed);
    } finally {
      persisted.fill(0);
    }
  } catch (error) {
    if (fd !== undefined) try { closeSync(fd); } catch { /* bounded */ }
    if (error instanceof StagingPhase1V2ProductionObserverContractError) {
      throw error;
    }
    blocked("observer_persistence");
  } finally {
    bytes.fill(0);
  }
}

function assertDurablePredecessor(unsignedArtifact, attemptDirectory) {
  if (unsignedArtifact.sequence === 1) return;
  const predecessor = PHASES.find(([sequence]) =>
    sequence === unsignedArtifact.sequence - 1
  );
  if (!predecessor || typeof attemptDirectory !== "string") {
    blocked("observer_chain");
  }
  const path = join(
    attemptDirectory,
    `${unsignedArtifact.binding?.runId}.${predecessor[2]}`
  );
  let fd;
  let bytes;
  try {
    fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const metadata = fstatSync(fd);
    if (!metadata.isFile() || metadata.uid !== process.geteuid() ||
        metadata.nlink !== 1 || (metadata.mode & 0o777) !== 0o600 ||
        metadata.size <= 0 || metadata.size >
          STAGING_PHASE1_V2_PRODUCTION_OBSERVER_POLICY.artifacts
            .maximumBytesEach) {
      blocked("observer_chain");
    }
    bytes = readFileSync(fd);
    const artifact = parseStagingPhase1V2BoundedJson(bytes, {
      maximumBytes:
        STAGING_PHASE1_V2_PRODUCTION_OBSERVER_POLICY.artifacts.maximumBytesEach
    });
    const unsigned = Object.fromEntries(Object.entries(artifact).filter(
      ([key]) => !["artifactDigest", "signature"].includes(key)
    ));
    validateUnsignedArtifact(unsigned, unsigned.evidence);
    verifyProductionArtifact(artifact);
    if (artifact.sequence !== unsignedArtifact.sequence - 1 ||
        artifact.phase !== predecessor[1] ||
        artifact.binding?.runId !== unsignedArtifact.binding?.runId ||
        artifact.artifactDigest !== unsignedArtifact.previousArtifactDigest) {
      blocked("observer_chain");
    }
  } catch (error) {
    if (error instanceof StagingPhase1V2ProductionObserverContractError) {
      throw error;
    }
    blocked("observer_chain");
  } finally {
    if (fd !== undefined) try { closeSync(fd); } catch { /* bounded */ }
    bytes?.fill?.(0);
  }
}

function consumeProtectedSigningDescriptor(fd) {
  try {
    if (!Number.isSafeInteger(fd) || fd < 3) {
      blocked("observer_signature_key");
    }
    const metadata = fstatSync(fd);
    if (!metadata.isFile() || metadata.uid !== process.geteuid() ||
        metadata.nlink !== 0 || (metadata.mode & 0o777) !== 0o600 ||
        metadata.size <= 0 || metadata.size > MAXIMUM_SIGNING_KEY_BYTES) {
      blocked("observer_signature_key");
    }
    const output = Buffer.alloc(metadata.size);
    const count = readSync(fd, output, 0, output.length, null);
    if (count !== output.length) {
      output.fill(0);
      blocked("observer_signature_key");
    }
    closeSync(fd);
    return output;
  } catch (error) {
    closeDescriptor(fd);
    if (error instanceof StagingPhase1V2ProductionObserverContractError) {
      throw error;
    }
    blocked("observer_signature_key");
  }
}

function signaturePayload(artifactDigest) {
  return Buffer.from(
    `${STAGING_PHASE1_V2_PRODUCTION_OBSERVER_POLICY.artifacts.signatureDomain}` +
      `\0${artifactDigest}`,
    "ascii"
  );
}

function isExactPhase(sequence, phase) {
  return PHASES.some(([expectedSequence, expectedPhase]) =>
    sequence === expectedSequence && phase === expectedPhase
  );
}

function assertSanitized(value) {
  walk(value, (key, nested) => {
    if (/(password|secret|token|credential|connectionString|rawBody|sql)/i
      .test(key)) {
      blocked("observer_contract");
    }
    if (typeof nested === "string" &&
        /postgres(?:ql)?:\/\/|-----BEGIN|bearer\s/i.test(nested)) {
      blocked("observer_contract");
    }
  });
}

function walk(value, visitor) {
  if (Array.isArray(value)) {
    for (const [index, nested] of value.entries()) {
      visitor(String(index), nested);
      walk(nested, visitor);
    }
  } else if (value && typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) {
      visitor(key, nested);
      walk(nested, visitor);
    }
  }
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function isExactObject(value, keys) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}

function closeDescriptor(fd) {
  if (!Number.isSafeInteger(fd) || fd < 3) return;
  try { closeSync(fd); } catch { /* already closed */ }
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}

function blocked(code) {
  throw new StagingPhase1V2ProductionObserverContractError(code);
}
