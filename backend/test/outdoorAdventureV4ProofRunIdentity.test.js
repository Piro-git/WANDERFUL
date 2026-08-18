import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import {
  V4_CASE_BINDINGS,
  V4_FLAG_NAMES,
  V4_PROTECTED_RECEIPTS,
  V4_PROVIDER_CALL_LIMIT,
  sha256V4,
  validateV4Summary
} from "../evaluation/outdoorAdventureTargetedLiveRouteQualityProofV4/contract.js";
import {
  V4_PROOF_FRESHNESS_LIMIT_MILLISECONDS,
  V4_PROOF_RUN_CONTEXT_SCHEMA_VERSION,
  V4_PROOF_RUN_CONTEXT_VERSION,
  bindV4FutureReceiptClock,
  createV4DatabaseClockDiagnostic,
  createV4ProofClockBinding,
  createV4ProofRunContext,
  validateV4FutureReceiptClock
} from "../evaluation/outdoorAdventureTargetedLiveRouteQualityProofV4/proofRunContext.js";
import {
  V4_GOLDEN_SET_MANIFEST_DIGEST,
  V4_GOLDEN_SET_POLICY_VERSION,
  V4_PRODUCT_SHAPING_POLICY_DIGEST,
  V4_PRODUCT_SHAPING_POLICY_VERSION,
  V4_REGIONAL_SOURCE_MANIFEST_DIGEST,
  admitV4ProviderAfterProofIdentityReconciliation,
  bindV4RunReceiptIdentity,
  bindV4RunSummaryIdentity,
  buildV4RunManifestRecord,
  createV4ProofRunIdentity,
  validateV4ProofRunIdentity,
  validateV4RunReceiptIdentity,
  validateV4RunSummary
} from "../evaluation/outdoorAdventureTargetedLiveRouteQualityProofV4/proofRunIdentity.js";
import {
  notRunV4CaseRecord
} from "../evaluation/outdoorAdventureTargetedLiveRouteQualityProofV4/quality.js";
import {
  v4GitCandidateAttestationDigest
} from "../evaluation/outdoorAdventureTargetedLiveRouteQualityProofV4/gitCandidateAttestation.js";
import {
  RESEARCH_GUIDED_ROUTE_PRODUCT_SHAPING_POLICY_V3
} from "../src/routeResearch/researchGuidedRouteProductShapingPolicyV3.js";

const BASELINE = "88ae392e23ec0973835bbe7aa95f9e6d27adb68a";
const AUTHORIZATION = "USER_AUTHORIZED_V4_ATTEMPT_8_SYNTHETIC_15_CALLS";
const LEDGER = "outdoor-adventure-v4-attempt-8-synthetic";
const PROOF_AS_OF = "2026-08-18T09:30:00.000Z";
const GIT_ATTESTATION_DIGEST = v4GitCandidateAttestationDigest({
  baselineCommit: BASELINE,
  candidateCommit: BASELINE
});
const GOLDEN_SET_URL = new URL(
  "../../docs/route-quality/golden-set-v1/golden-cases-v1.json",
  import.meta.url
);
const SOURCE_MANIFEST_URL = new URL(
  "../../docs/route-quality/golden-set-v1/source-manifest-v1.json",
  import.meta.url
);

describe("V4 immutable run-specific proof identity", () => {
  it("reproduces the old invalid_v4_summary and accepts the matching future run", () => {
    const identity = identityFixture();
    const summary = summaryFixture(identity);

    assert.throws(
      () => validateV4Summary(structuredClone(summary)),
      hasCode("invalid_v4_summary")
    );
    assert.equal(summary.baselineCommit, BASELINE);
    assert.equal(summary.candidateCommit, BASELINE);
    assert.equal(validateV4RunSummary(summary, identity), true);
  });

  it("seals a strict identity before execution and rejects unknown fields", () => {
    const identity = identityFixture();
    assert.equal(validateV4ProofRunIdentity(identity), true);
    assert.equal(Object.isFrozen(identity), true);
    assert.equal(Object.isFrozen(identity.canonicalCases), true);
    assert.equal(Reflect.set(identity, "baselineCommit", "0".repeat(40)), false);
    assert.equal(identity.baselineCommit, BASELINE);

    assert.throws(() => createV4ProofRunIdentity({
      ...identityCreationInput(),
      unknownIdentityField: "not-admitted"
    }), hasCode("invalid_v4_proof_run_identity"));
  });

  it("rejects baseline, authorization, ledger, budget and clock mismatch", () => {
    const identity = identityFixture();
    const mutations = [
      ["baselineCommit", "0".repeat(40)],
      ["candidateCommit", "1".repeat(40)],
      ["authorizationReference", "USER_AUTHORIZED_DIFFERENT_RUN"],
      ["ledgerNamespace", "outdoor-adventure-v4-different-run"],
      ["proofAsOf", "2026-08-18T09:30:01.000Z"]
    ];
    for (const [field, value] of mutations) {
      const summary = structuredClone(summaryFixture(identity));
      summary[field] = value;
      assert.throws(
        () => validateV4RunSummary(summary, identity),
        hasCode("v4_proof_run_identity_mismatch"),
        field
      );
    }
    const budget = structuredClone(summaryFixture(identity));
    budget.providerAccounting.hardLimit = 14;
    assert.throws(
      () => validateV4RunSummary(budget, identity),
      hasCode("v4_proof_run_identity_mismatch")
    );
    assert.throws(() => createV4ProofRunIdentity({
      ...identityCreationInput(),
      providerCallLimit: 14
    }), hasCode("v4_proof_run_identity_mismatch"));
  });

  it("rejects missing, duplicate, extra, reordered or substituted cases", () => {
    const identity = identityFixture();
    const transformations = [
      (cases) => cases.slice(1),
      (cases) => [cases[0], cases[0], ...cases.slice(2)],
      (cases) => [...cases, cases[0]],
      (cases) => [cases[1], cases[0], ...cases.slice(2)],
      (cases) => [{ ...cases[0], fixtureDigest: "0".repeat(64) },
        ...cases.slice(1)]
    ];
    for (const transform of transformations) {
      const summary = structuredClone(summaryFixture(identity));
      summary.cases = transform(summary.cases);
      assert.throws(
        () => validateV4RunSummary(summary, identity),
        hasCode("v4_proof_run_identity_mismatch")
      );
    }
  });

  it("rejects manifest, Golden Set and Product Shaping substitutions", () => {
    const identity = identityFixture();
    const manifest = structuredClone(summaryFixture(identity));
    manifest.manifest.digest = "0".repeat(64);
    assert.throws(
      () => validateV4RunSummary(manifest, identity),
      hasCode("v4_proof_run_identity_mismatch")
    );

    for (const field of [
      "goldenSetManifestDigest",
      "productShapingPolicyDigest",
      "regionalSourceManifestDigest"
    ]) {
      const summary = structuredClone(summaryFixture(identity));
      summary.proofRunIdentity[field] = "0".repeat(64);
      assert.throws(
        () => validateV4RunSummary(summary, identity),
        hasCode("v4_proof_run_identity_mismatch"),
        field
      );
    }
    assert.throws(() => createV4ProofRunIdentity({
      ...identityCreationInput(),
      productShapingPolicyDigest: "0".repeat(64)
    }), hasCode("v4_proof_run_identity_mismatch"));
  });

  it("rejects a different sealed identity and summary-derived self-attestation", () => {
    const identity = identityFixture();
    const summary = summaryFixture(identity);
    const other = identityFixture({
      authorizationReference: "USER_AUTHORIZED_V4_OTHER_SYNTHETIC_RUN",
      ledgerNamespace: "outdoor-adventure-v4-other-synthetic-run"
    });
    assert.throws(
      () => validateV4RunSummary(summary, other),
      hasCode("v4_proof_run_identity_mismatch")
    );
    assert.throws(
      () => validateV4ProofRunIdentity(summary.proofRunIdentity),
      hasCode("invalid_v4_proof_run_identity")
    );
    assert.throws(
      () => createV4ProofRunIdentity(summary.proofRunIdentity),
      hasCode("invalid_v4_proof_run_identity")
    );

    const missing = structuredClone(summary);
    delete missing.proofRunIdentity.contractVersion;
    assert.throws(
      () => validateV4RunSummary(missing, identity),
      hasCode("v4_proof_run_identity_mismatch")
    );
    const unknown = structuredClone(summary);
    unknown.proofRunIdentity.unknownIdentityField = "not-admitted";
    assert.throws(
      () => validateV4RunSummary(unknown, identity),
      hasCode("v4_proof_run_identity_mismatch")
    );
  });

  it("fails invalid identity before reservation, credential admission or provider work", async () => {
    const identity = identityFixture();
    const context = contextForIdentity(identity);
    const diagnostic = diagnosticFixture(context);
    const binding = createV4ProofClockBinding(context, diagnostic);
    let reservationOperations = 0;
    let credentialOperations = 0;
    let providerOperations = 0;
    await assert.rejects(
      () => admitV4ProviderAfterProofIdentityReconciliation({
        runIdentity: structuredClone(identity),
        runContext: context,
        databaseDiagnostic: diagnostic,
        proofClockBinding: binding
      }, async () => {
        reservationOperations += 1;
        credentialOperations += 1;
        providerOperations += 1;
      }),
      hasCode("invalid_v4_proof_run_identity")
    );
    assert.deepEqual({
      reservationOperations, credentialOperations, providerOperations
    }, {
      reservationOperations: 0,
      credentialOperations: 0,
      providerOperations: 0
    });
  });

  it("binds the runner capture and semantic digest to the same identity", () => {
    const identity = identityFixture();
    const context = contextForIdentity(identity);
    const diagnostic = diagnosticFixture(context);
    const binding = createV4ProofClockBinding(context, diagnostic);
    const fields = bindV4RunReceiptIdentity({
      receiptVersion: "synthetic-v4-run-capture",
      status: "blocked",
      cases: V4_CASE_BINDINGS.map((item) =>
        structuredClone(notRunV4CaseRecord(
          item.caseId,
          "synthetic_preprovider_stop"
        ))
      ),
      providerAccounting: providerAccounting(identity)
    }, identity);
    const receipt = bindV4FutureReceiptClock(
      fields,
      context,
      diagnostic,
      binding
    );
    assert.equal(validateV4RunReceiptIdentity(receipt, identity), true);
    assert.equal(validateV4FutureReceiptClock(
      receipt,
      context,
      diagnostic
    ), true);
  });

  it("returns only bounded sanitized identity errors", () => {
    const sentinel = "SENSITIVE_SENTINEL_VALUE_MUST_NOT_BE_REFLECTED";
    let error;
    try {
      createV4ProofRunIdentity({
        ...identityCreationInput(),
        authorizationReference: sentinel
      });
    } catch (caught) {
      error = caught;
    }
    assert(error);
    assert.match(error.code, /^[a-z0-9_]{1,80}$/);
    assert.equal(error.message, error.code);
    assert.equal(JSON.stringify(error).includes(sentinel), false);
    assert.equal(error.stack.includes(sentinel), false);

    const identity = identityFixture();
    const malformed = structuredClone(summaryFixture(identity));
    malformed.unexpectedIdentityMaterial = 1n;
    assert.throws(
      () => validateV4RunSummary(malformed, identity),
      hasCode("v4_summary_semantic_digest_mismatch")
    );
  });

  it("does not convert a blocked receipt to passed by changing status", () => {
    const identity = identityFixture();
    const changed = structuredClone(summaryFixture(identity));
    changed.status = "passed";
    const { semanticReceiptSha256: _discarded, ...record } = changed;
    changed.semanticReceiptSha256 = sha256V4(record);
    assert.throws(() => validateV4RunSummary(changed, identity));
  });

  it("keeps cleanup and final-disabled feature flags mandatory", () => {
    const identity = identityFixture();
    const cleanup = structuredClone(summaryFixture(identity));
    cleanup.cleanup.cleanupComplete = false;
    assert.throws(
      () => validateV4RunSummary(cleanup, identity),
      hasCode("cleanup_failed")
    );

    const enabled = structuredClone(summaryFixture(identity));
    enabled.featureFlags.final.flags.ROUTE_PROVIDER_ENABLED = true;
    assert.throws(() => validateV4RunSummary(enabled, identity));
  });

  it("binds the committed Golden Set, source manifest and Product Shaping policy", async () => {
    const golden = JSON.parse(await readFile(GOLDEN_SET_URL, "utf8"));
    const sources = JSON.parse(await readFile(SOURCE_MANIFEST_URL, "utf8"));
    assert.equal(sha256V4(golden), V4_GOLDEN_SET_MANIFEST_DIGEST);
    assert.equal(golden.policyVersion, V4_GOLDEN_SET_POLICY_VERSION);
    assert.equal(sha256V4(sources), V4_REGIONAL_SOURCE_MANIFEST_DIGEST);
    assert.equal(
      sha256V4(RESEARCH_GUIDED_ROUTE_PRODUCT_SHAPING_POLICY_V3),
      V4_PRODUCT_SHAPING_POLICY_DIGEST
    );
    assert.equal(
      RESEARCH_GUIDED_ROUTE_PRODUCT_SHAPING_POLICY_V3.policyVersion,
      V4_PRODUCT_SHAPING_POLICY_VERSION
    );
  });
});

function identityFixture(overrides = {}) {
  return createV4ProofRunIdentity(identityCreationInput(overrides));
}

function identityCreationInput(overrides = {}) {
  const authorizationReference = overrides.authorizationReference ??
    AUTHORIZATION;
  const ledgerNamespace = overrides.ledgerNamespace ?? LEDGER;
  const manifest = buildV4RunManifestRecord(authorizationReference);
  const runContext = createV4ProofRunContext({
    schemaVersion: V4_PROOF_RUN_CONTEXT_SCHEMA_VERSION,
    contractVersion: V4_PROOF_RUN_CONTEXT_VERSION,
    authorizationReference,
    ledgerNamespace,
    caseManifestDigest: manifest.digest,
    proofAsOf: PROOF_AS_OF,
    evidenceSnapshots: snapshotsFixture()
  }, { observedAt: PROOF_AS_OF });
  return {
    baselineCommit: BASELINE,
    candidateCommit: BASELINE,
    authorizationReference,
    ledgerNamespace,
    providerCallLimit: V4_PROVIDER_CALL_LIMIT,
    caseManifest: manifest,
    proofRunContext: runContext,
    gitCandidateAttestationDigest: GIT_ATTESTATION_DIGEST,
    goldenSetManifestDigest: V4_GOLDEN_SET_MANIFEST_DIGEST,
    goldenSetPolicyVersion: V4_GOLDEN_SET_POLICY_VERSION,
    productShapingPolicyVersion: V4_PRODUCT_SHAPING_POLICY_VERSION,
    productShapingPolicyDigest: V4_PRODUCT_SHAPING_POLICY_DIGEST,
    regionalSourceManifestDigest: V4_REGIONAL_SOURCE_MANIFEST_DIGEST,
    ...without(overrides, "authorizationReference", "ledgerNamespace")
  };
}

function contextForIdentity(identity) {
  return createV4ProofRunContext({
    schemaVersion: V4_PROOF_RUN_CONTEXT_SCHEMA_VERSION,
    contractVersion: V4_PROOF_RUN_CONTEXT_VERSION,
    authorizationReference: identity.authorizationReference,
    ledgerNamespace: identity.ledgerNamespace,
    caseManifestDigest: identity.caseManifestDigest,
    proofAsOf: identity.proofAsOf,
    evidenceSnapshots: snapshotsFixture()
  }, { observedAt: identity.proofAsOf });
}

function summaryFixture(identity) {
  return bindV4RunSummaryIdentity({
    status: "blocked",
    blockedReasonCode: "synthetic_preprovider_stop",
    decisions: {
      databasePreflight: "blocked",
      physicalAppAttest: "not_run",
      providerProof: "not_run",
      routeQuality: "not_run",
      cleanupAndContainment: "passed"
    },
    physicalAppAttestReceiptPresent: false,
    cases: V4_CASE_BINDINGS.map((binding) =>
      structuredClone(notRunV4CaseRecord(
        binding.caseId,
        "synthetic_preprovider_stop"
      ))
    ),
    providerAccounting: providerAccounting(identity),
    featureFlags: allDisabledFlags(),
    cleanup: {
      cleanupComplete: true,
      finalFlagsDisabled: true,
      disabledZeroWorkProbePassed: true,
      disabledZeroWorkDatabaseOperations: 0,
      disabledZeroWorkProviderOperations: 0,
      providerCredentialRemovedFromProofProcess: true,
      poolsClosed: true,
      leasesReleased: true,
      taskOwnedArtifactsRemoved: true
    },
    protectedHistoricalReceipts: V4_PROTECTED_RECEIPTS.map((item) => ({
      repoRelativePath: item.repoRelativePath,
      beforeSha256: item.sha256,
      afterSha256: item.sha256,
      unchanged: true
    })),
    privacy: {
      forbiddenFieldCount: 0,
      rawProviderMaterialRetained: false,
      routeShapeRetained: false,
      preciseLocationRetained: false,
      unboundedErrorRetained: false,
      appAttestMaterialRetained: false
    },
    manualExpertReview: {
      completed: false,
      classification: "not_completed"
    },
    closedBetaEligible: false,
    deployed: false,
    released: false,
    committed: false,
    pushed: false
  }, identity);
}

function providerAccounting(identity) {
  return {
    authorizationReference: identity.authorizationReference,
    ledgerNamespace: identity.ledgerNamespace,
    hardLimit: identity.providerCallLimit,
    maximumConcurrencyAllowed: 1,
    minimumCallStartSpacingMilliseconds: 2_000,
    attempted: 0,
    successful: 0,
    failed: 0,
    timedOut: 0,
    cancelled: 0,
    controlledPostSuccessFailures: 0,
    unused: identity.providerCallLimit,
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
}

function allDisabledFlags() {
  const flags = Object.fromEntries(V4_FLAG_NAMES.map((name) => [name, false]));
  return {
    initial: { exactAdmissionVerified: true, flags: { ...flags } },
    execution: { exactAdmissionVerified: true, flags: { ...flags } },
    final: { exactAdmissionVerified: true, flags: { ...flags } }
  };
}

function diagnosticFixture(context) {
  return createV4DatabaseClockDiagnostic(
    context,
    V4_CASE_BINDINGS.map(({ caseId }) => ({
      caseId,
      proofAsOf: context.proofAsOf,
      researchState: "ready",
      planningState: "ready",
      proposalCount: 1
    }))
  );
}

function snapshotsFixture() {
  return ["harz-v1", "innsbruck-alps-v1"].map((regionId) => ({
    regionId,
    sourceDataAt: "2026-08-17T09:00:00.000Z",
    retrievedAt: "2026-08-18T08:00:00.000Z",
    importedAt: "2026-08-18T08:30:00.000Z",
    activeSnapshotAt: "2026-08-18T09:00:00.000Z",
    freshnessLimitMilliseconds: V4_PROOF_FRESHNESS_LIMIT_MILLISECONDS
  }));
}

function without(value, ...keys) {
  const result = { ...value };
  keys.forEach((key) => { delete result[key]; });
  return result;
}

function hasCode(code) {
  return (error) => error?.code === code;
}
