import { createHash } from "node:crypto";
import { open, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  V4_PROTECTED_RECEIPTS,
  V4_PROVIDER_CALL_LIMIT,
  stableSerializeV4
} from "../evaluation/outdoorAdventureTargetedLiveRouteQualityProofV4/contract.js";
import {
  readAndVerifyV4DurableProofRunIdentity,
  removeV4RuntimeArtifact,
  writeCanonicalV4ArtifactExclusive
} from "../evaluation/outdoorAdventureTargetedLiveRouteQualityProofV4/durableProofRunIdentity.js";
import {
  disabledV4FlagSnapshot,
  runDisabledZeroWorkEndpointProbeV4
} from "../evaluation/outdoorAdventureTargetedLiveRouteQualityProofV4/preflight.js";
import {
  assertV4PublicationOutputAbsent,
  captureV4VerifiedPublicationCleanupEvidence
} from "../evaluation/outdoorAdventureTargetedLiveRouteQualityProofV4/publicationCleanup.js";
import {
  buildV4FutureRunSummary,
  validateV4FuturePublicationEvidence,
  validateV4FutureRunSummaryPublication
} from "../evaluation/outdoorAdventureTargetedLiveRouteQualityProofV4/receipt.js";

const REPOSITORY_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const PUBLICATION_OPTION_KEYS = Object.freeze([
  "authorizationReference",
  "baselineCommit",
  "candidateCommit",
  "capturePath",
  "gitCandidateAttestationDigest",
  "identityArtifactDigest",
  "identityPath",
  "ledgerNamespace",
  "ledgerPath",
  "summaryPath"
]);

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(
  import.meta.url
)) {
  await main();
}

async function main() {
  try {
    const options = parseArguments(process.argv.slice(2));
    const { summary, durableRun } = await publishV4FutureSummary(options);
    process.stdout.write(`${stableSerializeV4({
      status: summary.status,
      proofRunIdentityDigest: durableRun.identity.digest,
      proofRunIdentityArtifactDigest: durableRun.artifactDigest,
      semanticReceiptSha256: summary.semanticReceiptSha256,
      runtimeArtifactsRemovedBeforePublication: true
    })}\n`);
  } catch (error) {
    process.stdout.write(`${stableSerializeV4({
      status: "not_published",
      errorCode: safeErrorCode(error)
    })}\n`);
    process.exitCode = 1;
  }
}

export async function publishV4FutureSummary(options, dependencies = {}) {
  validatePublicationOptions(options);
  validateDependencies(dependencies);
  const removeRuntimeArtifact = dependencies.removeRuntimeArtifact ??
    defaultRemoveRuntimeArtifact;
  const releasePublicationLock = dependencies.releasePublicationLock ??
    defaultReleasePublicationLock;
  const writeFinalSummary = dependencies.writeFinalSummary ??
    defaultWriteFinalSummary;
  const environment = dependencies.environment ?? process.env;
  let publicationLock;
  let publicationLockReleased = false;

  try {
    publicationLock = await acquireCompletedLedger(options.ledgerPath);
    const durableRun = await readAndVerifyV4DurableProofRunIdentity(
      options.identityPath,
      {
        artifactDigest: options.identityArtifactDigest,
        baselineCommit: options.baselineCommit,
        candidateCommit: options.candidateCommit,
        authorizationReference: options.authorizationReference,
        ledgerNamespace: options.ledgerNamespace,
        providerCallLimit: V4_PROVIDER_CALL_LIMIT,
        gitCandidateAttestationDigest:
          options.gitCandidateAttestationDigest
      }
    );
    const capture = await readCanonicalArtifact(options.capturePath);
    const ledgerSerialized = await readBoundedSerializedArtifact(
      options.ledgerPath
    );
    const ledger = parseJson(ledgerSerialized);
    const finalFlags = disabledV4FlagSnapshot(environment);
    const disabledProbe = await runDisabledZeroWorkEndpointProbeV4();
    const protectedHistoricalReceipts =
      await collectProtectedHistoricalReceipts();

    validateV4FuturePublicationEvidence({
      durableRun,
      capture,
      ledger,
      ledgerSerialized,
      finalFlags,
      disabledProbe,
      protectedHistoricalReceipts
    });
    await assertV4PublicationOutputAbsent(options.summaryPath);

    await removeRuntimeArtifact(options.identityPath, "identity");
    await removeRuntimeArtifact(options.capturePath, "capture");
    await removeRuntimeArtifact(options.ledgerPath, "ledger");
    await releasePublicationLock(publicationLock);
    publicationLockReleased = true;

    const cleanupEvidence =
      await captureV4VerifiedPublicationCleanupEvidence({
        identityPath: options.identityPath,
        capturePath: options.capturePath,
        ledgerPath: options.ledgerPath,
        publicationLockPath: publicationLock.path,
        summaryPath: options.summaryPath,
        finalFlags,
        disabledProbe
      });
    const summary = buildV4FutureRunSummary({
      durableRun,
      capture,
      ledger,
      ledgerSerialized,
      finalFlags,
      disabledProbe,
      protectedHistoricalReceipts,
      cleanupEvidence
    });
    validateV4FutureRunSummaryPublication({
      summary,
      durableRun,
      capture,
      ledger,
      ledgerSerialized,
      finalFlags,
      disabledProbe,
      protectedHistoricalReceipts,
      cleanupEvidence
    });
    await writeFinalSummary(options.summaryPath, summary);
    return { summary, durableRun, cleanupEvidence };
  } catch (error) {
    if (publicationLock && !publicationLockReleased) {
      await releasePublicationLock(publicationLock).catch(() => {});
    }
    throw sanitizedPublicationError(error);
  }
}

async function acquireCompletedLedger(ledgerPath) {
  const path = `${ledgerPath}.lock`;
  try {
    const handle = await open(path, "wx", 0o600);
    return { handle, path, closed: false };
  } catch {
    throw proofError("v4_execution_still_active");
  }
}

async function defaultReleasePublicationLock(lock) {
  if (!lock || typeof lock !== "object" ||
      !absoluteTemporaryPath(lock.path)) {
    throw proofError("v4_publication_lock_removal_failed");
  }
  if (!lock.closed) {
    try {
      await lock.handle.close();
      lock.closed = true;
    } catch {
      throw proofError("v4_publication_lock_removal_failed");
    }
  }
  try {
    await removeV4RuntimeArtifact(lock.path);
  } catch {
    throw proofError("v4_publication_lock_removal_failed");
  }
}

async function defaultRemoveRuntimeArtifact(path) {
  await removeV4RuntimeArtifact(path);
}

async function defaultWriteFinalSummary(path, summary) {
  try {
    await writeCanonicalV4ArtifactExclusive(path, summary);
  } catch {
    throw proofError("v4_final_summary_write_failed");
  }
}

async function readCanonicalArtifact(path) {
  const serialized = await readBoundedSerializedArtifact(path);
  const value = parseJson(serialized);
  if (`${stableSerializeV4(value)}\n` !== serialized) {
    throw proofError("invalid_v4_runtime_artifact");
  }
  return value;
}

async function readBoundedSerializedArtifact(path) {
  let serialized;
  try {
    serialized = await readFile(path, "utf8");
  } catch {
    throw proofError("invalid_v4_runtime_artifact");
  }
  if (Buffer.byteLength(serialized) > 131_072) {
    throw proofError("invalid_v4_runtime_artifact");
  }
  parseJson(serialized);
  return serialized;
}

async function collectProtectedHistoricalReceipts() {
  const receipts = [];
  for (const expected of V4_PROTECTED_RECEIPTS) {
    let bytes;
    try {
      bytes = await readFile(resolve(
        REPOSITORY_ROOT,
        expected.repoRelativePath
      ));
    } catch {
      throw proofError("v4_protected_receipt_unavailable");
    }
    const digest = createHash("sha256").update(bytes).digest("hex");
    receipts.push({
      repoRelativePath: expected.repoRelativePath,
      beforeSha256: expected.sha256,
      afterSha256: digest,
      unchanged: digest === expected.sha256
    });
  }
  return receipts;
}

function parseArguments(values) {
  const names = [
    "--baseline-commit",
    "--candidate-commit",
    "--authorization-reference",
    "--ledger-namespace",
    "--git-attestation-digest",
    "--identity-artifact-digest",
    "--identity",
    "--ledger",
    "--capture",
    "--summary"
  ];
  if (values.length !== names.length * 2 ||
      names.some((name, index) => values[index * 2] !== name)) {
    throw proofError("invalid_arguments");
  }
  const result = Object.fromEntries(names.map((name, index) => [
    name.slice(2).replace(/-([a-z])/g, (_match, letter) =>
      letter.toUpperCase()),
    values[index * 2 + 1]
  ]));
  return validatePublicationOptions({
    baselineCommit: result.baselineCommit,
    candidateCommit: result.candidateCommit,
    authorizationReference: result.authorizationReference,
    ledgerNamespace: result.ledgerNamespace,
    gitCandidateAttestationDigest: result.gitAttestationDigest,
    identityArtifactDigest: result.identityArtifactDigest,
    identityPath: result.identity,
    ledgerPath: result.ledger,
    capturePath: result.capture,
    summaryPath: result.summary
  });
}

function validatePublicationOptions(options) {
  const paths = options && [
    options.identityPath,
    options.ledgerPath,
    options.capturePath,
    options.summaryPath
  ];
  if (!options || typeof options !== "object" || Array.isArray(options) ||
      !exactKeys(options, PUBLICATION_OPTION_KEYS) ||
      !/^[a-f0-9]{40}$/.test(options.baselineCommit ?? "") ||
      !/^[a-f0-9]{40}$/.test(options.candidateCommit ?? "") ||
      !runIdentifier(options.authorizationReference) ||
      !runIdentifier(options.ledgerNamespace) ||
      !/^[a-f0-9]{64}$/.test(
        options.gitCandidateAttestationDigest ?? ""
      ) || !/^[a-f0-9]{64}$/.test(options.identityArtifactDigest ?? "") ||
      paths.some((path) => !absoluteTemporaryPath(path)) ||
      new Set([...paths, `${options.ledgerPath}.lock`]).size !==
        paths.length + 1) {
    throw proofError("invalid_arguments");
  }
  return options;
}

function validateDependencies(dependencies) {
  const allowed = new Set([
    "environment", "releasePublicationLock", "removeRuntimeArtifact",
    "writeFinalSummary"
  ]);
  if (!dependencies || typeof dependencies !== "object" ||
      Array.isArray(dependencies) ||
      Object.keys(dependencies).some((key) => !allowed.has(key)) ||
      ["releasePublicationLock", "removeRuntimeArtifact", "writeFinalSummary"]
        .some((key) => dependencies[key] !== undefined &&
          typeof dependencies[key] !== "function") ||
      (dependencies.environment !== undefined &&
        (!dependencies.environment ||
          typeof dependencies.environment !== "object"))) {
    throw proofError("invalid_publication_dependencies");
  }
}

function absoluteTemporaryPath(value) {
  return typeof value === "string" &&
    value.startsWith("/private/tmp/TrailMindV4RunRuntime-") &&
    !value.includes("..") && !value.includes("\0") && value.length <= 500;
}

function runIdentifier(value) {
  return typeof value === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value);
}

function parseJson(serialized) {
  try {
    const value = JSON.parse(serialized);
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("invalid");
    }
    return value;
  } catch {
    throw proofError("invalid_v4_runtime_artifact");
  }
}

function safeErrorCode(error) {
  const code = error?.code ?? error?.message;
  return typeof code === "string" && /^[a-z0-9_]{1,80}$/.test(code)
    ? code : "v4_future_summary_publication_failed";
}

function sanitizedPublicationError(error) {
  return proofError(safeErrorCode(error));
}

function proofError(code) {
  return Object.assign(new Error(code), { code });
}

function exactKeys(value, expected) {
  const actual = Object.keys(value).sort();
  const sorted = [...expected].sort();
  return actual.length === sorted.length &&
    actual.every((key, index) => key === sorted[index]);
}

export { parseArguments as parseV4FuturePublicationArguments };
