import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  access,
  chmod,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { promisify } from "node:util";
import { describe, it } from "node:test";
import {
  V4_CASE_BINDINGS,
  V4_FLAG_NAMES,
  V4_PROTECTED_RECEIPTS,
  V4_PROVIDER_CALL_LIMIT,
  sha256V4,
  stableSerializeV4,
  validateV4Summary
} from "../evaluation/outdoorAdventureTargetedLiveRouteQualityProofV4/contract.js";
import {
  bindV4DurableRunReceiptIdentity,
  buildV4DurableProofRunIdentityArtifact,
  parseAndVerifyV4DurableProofRunIdentity,
  readAndVerifyV4DurableProofRunIdentity,
  removeV4RuntimeArtifact,
  validateV4DurableRunReceiptIdentity,
  writeCanonicalV4ArtifactExclusive,
  writeV4DurableProofRunIdentityArtifact
} from "../evaluation/outdoorAdventureTargetedLiveRouteQualityProofV4/durableProofRunIdentity.js";
import {
  V4_PROOF_FRESHNESS_LIMIT_MILLISECONDS,
  V4_PROOF_RUN_CONTEXT_SCHEMA_VERSION,
  V4_PROOF_RUN_CONTEXT_VERSION,
  bindV4FutureReceiptClock,
  createV4DatabaseClockDiagnostic,
  createV4ProofClockBinding,
  createV4ProofRunContext
} from "../evaluation/outdoorAdventureTargetedLiveRouteQualityProofV4/proofRunContext.js";
import {
  V4_GOLDEN_SET_MANIFEST_DIGEST,
  V4_GOLDEN_SET_POLICY_VERSION,
  V4_PRODUCT_SHAPING_POLICY_DIGEST,
  V4_PRODUCT_SHAPING_POLICY_VERSION,
  V4_REGIONAL_SOURCE_MANIFEST_DIGEST,
  buildV4RunManifestRecord,
  createV4ProofRunIdentity
} from "../evaluation/outdoorAdventureTargetedLiveRouteQualityProofV4/proofRunIdentity.js";
import {
  notRunV4CaseRecord
} from "../evaluation/outdoorAdventureTargetedLiveRouteQualityProofV4/quality.js";
import {
  v4GitCandidateAttestationDigest
} from "../evaluation/outdoorAdventureTargetedLiveRouteQualityProofV4/gitCandidateAttestation.js";
import {
  buildV4FutureRunSummary
} from "../evaluation/outdoorAdventureTargetedLiveRouteQualityProofV4/receipt.js";
import {
  captureV4VerifiedPublicationCleanupEvidence
} from "../evaluation/outdoorAdventureTargetedLiveRouteQualityProofV4/publicationCleanup.js";
import {
  cleanupV4ProofProcess
} from "../scripts/run-outdoor-adventure-targeted-live-route-quality-proof-v4.js";
import {
  publishV4FutureSummary
} from "../scripts/publish-outdoor-adventure-targeted-live-route-quality-proof-v4.js";

const execFileAsync = promisify(execFile);
const BASELINE = "88ae392e23ec0973835bbe7aa95f9e6d27adb68a";
const CANDIDATE = "9".repeat(40);
const AUTHORIZATION = "USER_AUTHORIZED_V4_ATTEMPT_8_OFFLINE_15_CALLS";
const LEDGER_NAMESPACE = "outdoor-adventure-v4-attempt-8-offline";
const GIT_ATTESTATION_DIGEST = v4GitCandidateAttestationDigest({
  baselineCommit: BASELINE,
  candidateCommit: CANDIDATE
});
const PROOF_AS_OF = "2026-08-18T09:30:00.000Z";
const PUBLISHER = new URL(
  "../scripts/publish-outdoor-adventure-targeted-live-route-quality-proof-v4.js",
  import.meta.url
).pathname;

describe("V4 durable identity and future summary publication", () => {
  it("atomically writes a permission-bound artifact and rehydrates it", async () => {
    const fixture = proofFixture();
    const directory = await runtimeDirectory();
    const identityPath = `${directory}/identity.json`;
    try {
      const artifactDigest = await writeV4DurableProofRunIdentityArtifact(
        identityPath,
        fixture.identity,
        fixture.context
      );
      assert.equal((await stat(identityPath)).mode & 0o777, 0o600);
      const durableRun = await readAndVerifyV4DurableProofRunIdentity(
        identityPath,
        expectedRun(artifactDigest)
      );
      assert.notEqual(durableRun.identity, fixture.identity);
      assert.notEqual(durableRun.runContext, fixture.context);
      assert.equal(durableRun.identity.digest, fixture.identity.digest);
      assert.equal(durableRun.runContext.digest, fixture.context.digest);
      await assert.rejects(() => writeV4DurableProofRunIdentityArtifact(
        identityPath,
        fixture.identity,
        fixture.context
      ), hasCode("v4_identity_artifact_write_failed"));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects identity mutations, weak permissions, and summary-derived substitutes", async () => {
    const fixture = proofFixture();
    const artifact = buildV4DurableProofRunIdentityArtifact(
      fixture.identity,
      fixture.context
    );
    const serialized = `${stableSerializeV4(artifact)}\n`;
    const mutated = structuredClone(artifact);
    mutated.identity.baselineCommit = "0".repeat(40);
    const { artifactDigest: _discarded, ...mutatedRecord } = mutated;
    mutated.artifactDigest = sha256V4(mutatedRecord);
    assert.throws(() => parseAndVerifyV4DurableProofRunIdentity(
      `${stableSerializeV4(mutated)}\n`,
      expectedRun(artifact.artifactDigest)
    ));
    assert.throws(() => parseAndVerifyV4DurableProofRunIdentity(
      `${stableSerializeV4({
        ...artifact,
        runContext: undefined
      })}\n`,
      expectedRun(artifact.artifactDigest)
    ));

    const directory = await runtimeDirectory();
    const identityPath = `${directory}/identity.json`;
    try {
      await writeFile(identityPath, serialized, { mode: 0o600, flag: "wx" });
      await chmod(identityPath, 0o644);
      await assert.rejects(() => readAndVerifyV4DurableProofRunIdentity(
        identityPath,
        expectedRun(artifact.artifactDigest)
      ), hasCode("v4_identity_artifact_permissions_invalid"));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("verifies a receipt after rehydration and rejects receipt or ledger mutation", async () => {
    const fixture = proofFixture();
    const artifact = buildV4DurableProofRunIdentityArtifact(
      fixture.identity,
      fixture.context
    );
    const durableRun = parseAndVerifyV4DurableProofRunIdentity(
      `${stableSerializeV4(artifact)}\n`,
      expectedRun(artifact.artifactDigest)
    );
    const { capture, ledger, ledgerSerialized } = captureFixture(durableRun);
    assert.equal(validateV4DurableRunReceiptIdentity(capture, durableRun), true);
    const changed = structuredClone(capture);
    changed.authorizationReference = "USER_AUTHORIZED_V4_SUBSTITUTE";
    assert.throws(() => validateV4DurableRunReceiptIdentity(
      changed,
      durableRun
    ));
    const substitutedLedger = {
      ...ledger,
      proofRunIdentityArtifactDigest: "0".repeat(64)
    };
    assert.throws(() => buildV4FutureRunSummary({
      durableRun,
      capture,
      ledger: substitutedLedger,
      ledgerSerialized: `${JSON.stringify(substitutedLedger)}\n`,
      finalFlags: disabledFlags(),
      disabledProbe: zeroWorkProbe(),
      protectedHistoricalReceipts: protectedReceipts()
    }));
  });

  it("removes all authorized runtime artifacts before fresh-process final publication", async () => {
    const fixture = proofFixture();
    const directory = await runtimeDirectory();
    const identityPath = `${directory}/identity.json`;
    const ledgerPath = `${directory}/ledger.json`;
    const capturePath = `${directory}/capture.json`;
    const summaryPath = `${directory}/summary.json`;
    try {
      const artifactDigest = await writeV4DurableProofRunIdentityArtifact(
        identityPath,
        fixture.identity,
        fixture.context
      );
      const durableRun = await readAndVerifyV4DurableProofRunIdentity(
        identityPath,
        expectedRun(artifactDigest)
      );
      const { capture, ledgerSerialized } = captureFixture(durableRun);
      await writeFile(ledgerPath, ledgerSerialized, {
        encoding: "utf8", mode: 0o600, flag: "wx"
      });
      await writeCanonicalV4ArtifactExclusive(capturePath, capture);

      const arguments_ = publicationArguments({
        artifactDigest,
        identityPath,
        ledgerPath,
        capturePath,
        summaryPath
      });
      const substitutedLedger = {
        ...JSON.parse(ledgerSerialized),
        proofRunIdentityDigest: "0".repeat(64)
      };
      await writeFile(ledgerPath, `${JSON.stringify(substitutedLedger)}\n`);
      await assert.rejects(() => execFileAsync(
        process.execPath,
        arguments_,
        publicationProcessOptions()
      ));
      await access(identityPath);
      await assert.rejects(() => access(summaryPath), hasCode("ENOENT"));
      await writeFile(ledgerPath, ledgerSerialized);

      const { stdout } = await execFileAsync(process.execPath, arguments_, {
        env: Object.fromEntries(V4_FLAG_NAMES.map((name) => [name, "false"])),
        timeout: 10_000,
        maxBuffer: 16_384
      });
      const result = JSON.parse(stdout);
      assert.equal(result.status, "failed");
      assert.equal(result.runtimeArtifactsRemovedBeforePublication, true);
      const summary = JSON.parse(await readFile(summaryPath, "utf8"));
      assert.throws(() => validateV4Summary(structuredClone(summary)),
        hasCode("invalid_v4_summary"));
      assert.equal(summary.baselineCommit, BASELINE);
      assert.equal(summary.candidateCommit, CANDIDATE);
      assert.equal(summary.authorizationReference, AUTHORIZATION);
      assert.equal(summary.ledgerNamespace, LEDGER_NAMESPACE);
      assert.equal(summary.proofRunIdentityArtifactDigest, artifactDigest);
      assert.equal(summary.cleanup.cleanupComplete, true);
      assert.equal(summary.cleanup.finalFlagsDisabled, true);
      assert.equal(summary.cleanup.disabledZeroWorkProbePassed, true);
      assert.equal(summary.cleanup.identityArtifactRemoved, true);
      assert.equal(summary.cleanup.captureArtifactRemoved, true);
      assert.equal(summary.cleanup.ledgerArtifactRemoved, true);
      assert.equal(summary.cleanup.publicationLockRemoved, true);
      assert.equal(summary.cleanup.taskOwnedRuntimeArtifactCount, 4);
      assert.equal(summary.cleanup.removedTaskOwnedRuntimeArtifactCount, 4);
      assert.equal(
        summary.cleanup
          .retainedFinalSummaryExcludedFromTaskOwnedRuntimeArtifacts,
        true
      );
      await assert.rejects(() => access(identityPath), hasCode("ENOENT"));
      await assert.rejects(() => access(capturePath), hasCode("ENOENT"));
      await assert.rejects(() => access(ledgerPath), hasCode("ENOENT"));
      await assert.rejects(() => access(`${ledgerPath}.lock`),
        hasCode("ENOENT"));
      await access(summaryPath);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("publishes only after exact runtime-artifact absence is observable", async () => {
    const fixture = await publicationFixture();
    let absenceVerifiedBeforeWrite = false;
    try {
      const { summary } = await publishV4FutureSummary(fixture.options, {
        environment: disabledEnvironment(),
        async writeFinalSummary(path, value) {
          await assertRuntimeArtifactsAbsent(fixture);
          await assert.rejects(() => access(path), hasCode("ENOENT"));
          absenceVerifiedBeforeWrite = true;
          await writeCanonicalV4ArtifactExclusive(path, value);
        }
      });
      assert.equal(absenceVerifiedBeforeWrite, true);
      assert.equal(summary.cleanup.cleanupComplete, true);
      assert.equal(summary.cleanup.identityArtifactRemoved, true);
      assert.equal(summary.cleanup.captureArtifactRemoved, true);
      assert.equal(summary.cleanup.ledgerArtifactRemoved, true);
      assert.equal(summary.cleanup.publicationLockRemoved, true);
      assert.equal(
        summary.cleanup
          .retainedFinalSummaryExcludedFromTaskOwnedRuntimeArtifacts,
        true
      );
      await access(fixture.summaryPath);
    } finally {
      await rm(fixture.directory, { recursive: true, force: true });
    }
  });

  for (const failedRole of ["identity", "capture", "ledger"]) {
    it(`does not publish cleanup success when ${failedRole} removal fails`,
      async () => {
        const fixture = await publicationFixture();
        try {
          await assert.rejects(() => publishV4FutureSummary(
            fixture.options,
            {
              environment: disabledEnvironment(),
              async removeRuntimeArtifact(path, role) {
                if (role === failedRole) {
                  throw new Error(`injected removal failure: ${path}`);
                }
                await removeV4RuntimeArtifact(path);
              }
            }
          ), boundedPublicationFailure(fixture.directory));
          await assert.rejects(() => access(fixture.summaryPath),
            hasCode("ENOENT"));
        } finally {
          await rm(fixture.directory, { recursive: true, force: true });
        }
      });
  }

  it("does not publish cleanup success when publication-lock removal fails", async () => {
    const fixture = await publicationFixture();
    try {
      await assert.rejects(() => publishV4FutureSummary(fixture.options, {
        environment: disabledEnvironment(),
        async releasePublicationLock(lock) {
          if (!lock.closed) {
            await lock.handle.close();
            lock.closed = true;
          }
          throw new Error(`injected lock removal failure: ${lock.path}`);
        }
      }), boundedPublicationFailure(fixture.directory));
      await assert.rejects(() => access(fixture.summaryPath),
        hasCode("ENOENT"));
      await access(`${fixture.ledgerPath}.lock`);
    } finally {
      await rm(fixture.directory, { recursive: true, force: true });
    }
  });

  it("fails exact absence checks when removal falsely reports success", async () => {
    const fixture = await publicationFixture();
    try {
      await assert.rejects(() => publishV4FutureSummary(fixture.options, {
        environment: disabledEnvironment(),
        async removeRuntimeArtifact(path, role) {
          if (role !== "capture") await removeV4RuntimeArtifact(path);
        }
      }), hasCode("v4_runtime_artifact_present"));
      await access(fixture.capturePath);
      await assert.rejects(() => access(fixture.summaryPath),
        hasCode("ENOENT"));
    } finally {
      await rm(fixture.directory, { recursive: true, force: true });
    }
  });

  it("rejects missing cleanup evidence before summary construction", async () => {
    const fixture = await publicationFixture();
    try {
      assert.throws(() => buildV4FutureRunSummary({
        durableRun: fixture.durableRun,
        capture: fixture.capture,
        ledger: fixture.ledger,
        ledgerSerialized: fixture.ledgerSerialized,
        finalFlags: disabledFlags(),
        disabledProbe: zeroWorkProbe(),
        protectedHistoricalReceipts: protectedReceipts()
      }), hasCode("invalid_v4_publication_cleanup_evidence"));
      await assert.rejects(() => access(fixture.summaryPath),
        hasCode("ENOENT"));
    } finally {
      await rm(fixture.directory, { recursive: true, force: true });
    }
  });

  it("rejects forged cleanup evidence even when every claim is true", async () => {
    const fixture = await publicationFixture();
    try {
      await removeV4RuntimeArtifact(fixture.identityPath);
      await removeV4RuntimeArtifact(fixture.capturePath);
      await removeV4RuntimeArtifact(fixture.ledgerPath);
      const cleanupEvidence =
        await captureV4VerifiedPublicationCleanupEvidence({
          identityPath: fixture.identityPath,
          capturePath: fixture.capturePath,
          ledgerPath: fixture.ledgerPath,
          publicationLockPath: `${fixture.ledgerPath}.lock`,
          summaryPath: fixture.summaryPath,
          finalFlags: disabledFlags(),
          disabledProbe: zeroWorkProbe()
        });
      assert.throws(() => buildV4FutureRunSummary({
        durableRun: fixture.durableRun,
        capture: fixture.capture,
        ledger: fixture.ledger,
        ledgerSerialized: fixture.ledgerSerialized,
        finalFlags: disabledFlags(),
        disabledProbe: zeroWorkProbe(),
        protectedHistoricalReceipts: protectedReceipts(),
        cleanupEvidence: structuredClone(cleanupEvidence)
      }), hasCode("invalid_v4_publication_cleanup_evidence"));
      await assert.rejects(() => access(fixture.summaryPath),
        hasCode("ENOENT"));
    } finally {
      await rm(fixture.directory, { recursive: true, force: true });
    }
  });

  it("rejects an existing final summary before removing runtime evidence", async () => {
    const fixture = await publicationFixture();
    try {
      await writeFile(fixture.summaryPath, "preexisting-summary\n", {
        mode: 0o600,
        flag: "wx"
      });
      await assert.rejects(() => publishV4FutureSummary(fixture.options, {
        environment: disabledEnvironment()
      }), hasCode("v4_final_summary_already_exists"));
      assert.equal(await readFile(fixture.summaryPath, "utf8"),
        "preexisting-summary\n");
      await access(fixture.identityPath);
      await access(fixture.capturePath);
      await access(fixture.ledgerPath);
      await assert.rejects(() => access(`${fixture.ledgerPath}.lock`),
        hasCode("ENOENT"));
    } finally {
      await rm(fixture.directory, { recursive: true, force: true });
    }
  });

  it("leaves no final summary when the exclusive write fails after cleanup", async () => {
    const fixture = await publicationFixture();
    try {
      await assert.rejects(() => publishV4FutureSummary(fixture.options, {
        environment: disabledEnvironment(),
        async writeFinalSummary(path) {
          await assertRuntimeArtifactsAbsent(fixture);
          throw new Error(`injected final write failure: ${path}`);
        }
      }), boundedPublicationFailure(fixture.directory));
      await assertRuntimeArtifactsAbsent(fixture);
      await assert.rejects(() => access(fixture.summaryPath),
        hasCode("ENOENT"));
    } finally {
      await rm(fixture.directory, { recursive: true, force: true });
    }
  });

  it("releases the ledger lock only after pools and provider access are closed", async () => {
    const state = { cancellationClosed: false, poolClosed: false };
    const env = {
      ...Object.fromEntries(V4_FLAG_NAMES.map((name) => [name, "true"])),
      GRAPHHOPPER_API_KEY: "synthetic-placeholder"
    };
    await cleanupV4ProofProcess({
      cancellationPool: {
        async end() { state.cancellationClosed = true; }
      },
      pool: {
        async end() { state.poolClosed = true; }
      },
      ledger: {
        async close() {
          assert.equal(state.cancellationClosed, true);
          assert.equal(state.poolClosed, true);
          assert.equal(env.GRAPHHOPPER_API_KEY, undefined);
          assert.equal(V4_FLAG_NAMES.every((name) => env[name] === "false"),
            true);
        }
      },
      env
    });
  });
});

function proofFixture() {
  const manifest = buildV4RunManifestRecord(AUTHORIZATION);
  const context = createV4ProofRunContext({
    schemaVersion: V4_PROOF_RUN_CONTEXT_SCHEMA_VERSION,
    contractVersion: V4_PROOF_RUN_CONTEXT_VERSION,
    authorizationReference: AUTHORIZATION,
    ledgerNamespace: LEDGER_NAMESPACE,
    caseManifestDigest: manifest.digest,
    proofAsOf: PROOF_AS_OF,
    evidenceSnapshots: ["harz-v1", "innsbruck-alps-v1"].map((regionId) => ({
      regionId,
      sourceDataAt: "2026-08-17T09:00:00.000Z",
      retrievedAt: "2026-08-18T08:00:00.000Z",
      importedAt: "2026-08-18T08:30:00.000Z",
      activeSnapshotAt: "2026-08-18T09:00:00.000Z",
      freshnessLimitMilliseconds: V4_PROOF_FRESHNESS_LIMIT_MILLISECONDS
    }))
  }, { observedAt: PROOF_AS_OF });
  const identity = createV4ProofRunIdentity({
    baselineCommit: BASELINE,
    candidateCommit: CANDIDATE,
    authorizationReference: AUTHORIZATION,
    ledgerNamespace: LEDGER_NAMESPACE,
    providerCallLimit: V4_PROVIDER_CALL_LIMIT,
    caseManifest: manifest,
    proofRunContext: context,
    gitCandidateAttestationDigest: GIT_ATTESTATION_DIGEST,
    goldenSetManifestDigest: V4_GOLDEN_SET_MANIFEST_DIGEST,
    goldenSetPolicyVersion: V4_GOLDEN_SET_POLICY_VERSION,
    productShapingPolicyVersion: V4_PRODUCT_SHAPING_POLICY_VERSION,
    productShapingPolicyDigest: V4_PRODUCT_SHAPING_POLICY_DIGEST,
    regionalSourceManifestDigest: V4_REGIONAL_SOURCE_MANIFEST_DIGEST
  });
  return { context, identity };
}

function captureFixture(durableRun) {
  const ledger = {
    schemaVersion: 1,
    authorizationReference: AUTHORIZATION,
    ledgerNamespace: LEDGER_NAMESPACE,
    proofRunIdentityDigest: durableRun.identity.digest,
    proofRunIdentityArtifactDigest: durableRun.artifactDigest,
    hardLimit: V4_PROVIDER_CALL_LIMIT,
    calls: []
  };
  const ledgerSerialized = `${JSON.stringify(ledger)}\n`;
  const ledgerSha256 = sha256V4(ledgerSerialized);
  const providerAccounting = {
    authorizationReference: AUTHORIZATION,
    ledgerNamespace: LEDGER_NAMESPACE,
    proofRunIdentityDigest: durableRun.identity.digest,
    proofRunIdentityArtifactDigest: durableRun.artifactDigest,
    ledgerSha256,
    providerCredentialAdmitted: false,
    providerEgressAdmitted: false,
    hardLimit: V4_PROVIDER_CALL_LIMIT,
    maximumConcurrencyAllowed: 1,
    minimumCallStartSpacingMilliseconds: 2_000,
    attempted: 0,
    successful: 0,
    failed: 0,
    timedOut: 0,
    cancelled: 0,
    controlledPostSuccessFailures: 0,
    unused: V4_PROVIDER_CALL_LIMIT,
    reconciled: true,
    maximumConcurrencyObserved: 0,
    minimumObservedStartSpacingMilliseconds: null,
    retriesAttempted: 0,
    probesAfterCircuitOpen: 0,
    attempt16Prevented: true,
    circuitOpened: false,
    circuitStopHonored: true,
    invalidRetryAfterObserved: false,
    invalidRetryAfterStoppedCase: false
  };
  const diagnostic = createV4DatabaseClockDiagnostic(
    durableRun.runContext,
    V4_CASE_BINDINGS.map(({ caseId }) => ({
      caseId,
      proofAsOf: PROOF_AS_OF,
      researchState: "ready",
      planningState: "ready",
      proposalCount: 1
    }))
  );
  const clockBinding = createV4ProofClockBinding(
    durableRun.runContext,
    diagnostic
  );
  const identityFields = bindV4DurableRunReceiptIdentity({
    receiptVersion: "synthetic-v4-offline-capture",
    ledgerSha256,
    status: "failed",
    databaseAdmissionPassed: true,
    databaseDiagnostic: diagnostic,
    providerAccounting,
    cases: V4_CASE_BINDINGS.map((item) => structuredClone(
      notRunV4CaseRecord(item.caseId, "synthetic_no_provider")
    )),
    featureFlags: {
      initial: disabledFlags(),
      execution: disabledFlags()
    },
    privacy: {
      forbiddenFieldCount: 0,
      rawProviderMaterialRetained: false,
      routeShapeRetained: false,
      preciseLocationRetained: false,
      providerUrlRetained: false,
      credentialRetained: false,
      promptRetained: false,
      databaseUrlRetained: false,
      appAttestMaterialRetained: false,
      unboundedErrorRetained: false
    }
  }, durableRun);
  const capture = bindV4FutureReceiptClock(
    identityFields,
    durableRun.runContext,
    diagnostic,
    clockBinding
  );
  return { capture, ledger, ledgerSerialized };
}

function expectedRun(artifactDigest) {
  return {
    artifactDigest,
    baselineCommit: BASELINE,
    candidateCommit: CANDIDATE,
    authorizationReference: AUTHORIZATION,
    ledgerNamespace: LEDGER_NAMESPACE,
    providerCallLimit: V4_PROVIDER_CALL_LIMIT,
    gitCandidateAttestationDigest: GIT_ATTESTATION_DIGEST
  };
}

function disabledFlags() {
  return {
    exactAdmissionVerified: true,
    flags: Object.fromEntries(V4_FLAG_NAMES.map((name) => [name, false]))
  };
}

function zeroWorkProbe() {
  return {
    passed: true,
    authorizationOperations: 0,
    databaseOperations: 0,
    providerOperations: 0,
    budgetOperations: 0,
    leaseOperations: 0,
    orchestratorOperations: 0
  };
}

function protectedReceipts() {
  return V4_PROTECTED_RECEIPTS.map((item) => ({
    repoRelativePath: item.repoRelativePath,
    beforeSha256: item.sha256,
    afterSha256: item.sha256,
    unchanged: true
  }));
}

function runtimeDirectory() {
  return mkdtemp("/private/tmp/TrailMindV4RunRuntime-test-");
}

function publicationArguments({
  artifactDigest,
  identityPath,
  ledgerPath,
  capturePath,
  summaryPath
}) {
  return [
    PUBLISHER,
    "--baseline-commit", BASELINE,
    "--candidate-commit", CANDIDATE,
    "--authorization-reference", AUTHORIZATION,
    "--ledger-namespace", LEDGER_NAMESPACE,
    "--git-attestation-digest", GIT_ATTESTATION_DIGEST,
    "--identity-artifact-digest", artifactDigest,
    "--identity", identityPath,
    "--ledger", ledgerPath,
    "--capture", capturePath,
    "--summary", summaryPath
  ];
}

async function publicationFixture() {
  const fixture = proofFixture();
  const directory = await runtimeDirectory();
  const identityPath = `${directory}/identity.json`;
  const ledgerPath = `${directory}/ledger.json`;
  const capturePath = `${directory}/capture.json`;
  const summaryPath = `${directory}/summary.json`;
  const artifactDigest = await writeV4DurableProofRunIdentityArtifact(
    identityPath,
    fixture.identity,
    fixture.context
  );
  const durableRun = await readAndVerifyV4DurableProofRunIdentity(
    identityPath,
    expectedRun(artifactDigest)
  );
  const { capture, ledger, ledgerSerialized } = captureFixture(durableRun);
  await writeFile(ledgerPath, ledgerSerialized, {
    encoding: "utf8", mode: 0o600, flag: "wx"
  });
  await writeCanonicalV4ArtifactExclusive(capturePath, capture);
  return {
    directory,
    identityPath,
    ledgerPath,
    capturePath,
    summaryPath,
    durableRun,
    capture,
    ledger,
    ledgerSerialized,
    options: {
      baselineCommit: BASELINE,
      candidateCommit: CANDIDATE,
      authorizationReference: AUTHORIZATION,
      ledgerNamespace: LEDGER_NAMESPACE,
      gitCandidateAttestationDigest: GIT_ATTESTATION_DIGEST,
      identityArtifactDigest: artifactDigest,
      identityPath,
      ledgerPath,
      capturePath,
      summaryPath
    }
  };
}

async function assertRuntimeArtifactsAbsent(fixture) {
  for (const path of [
    fixture.identityPath,
    fixture.capturePath,
    fixture.ledgerPath,
    `${fixture.ledgerPath}.lock`
  ]) {
    await assert.rejects(() => access(path), hasCode("ENOENT"));
  }
}

function disabledEnvironment() {
  return Object.fromEntries(V4_FLAG_NAMES.map((name) => [name, "false"]));
}

function boundedPublicationFailure(runtimeDirectoryPath) {
  return (error) => {
    assert.equal(error?.code, "v4_future_summary_publication_failed");
    assert.equal(error?.message, "v4_future_summary_publication_failed");
    assert.equal(error.message.includes(runtimeDirectoryPath), false);
    return true;
  };
}

function publicationProcessOptions() {
  return {
    env: Object.fromEntries(V4_FLAG_NAMES.map((name) => [name, "false"])),
    timeout: 10_000,
    maxBuffer: 16_384
  };
}

function hasCode(code) {
  return (error) => error?.code === code;
}
