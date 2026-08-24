import {
  CANONICAL_CASES,
  CANONICAL_FLAG_BINDINGS,
  POLICY_SOURCE_PATHS,
  STAGING_READINESS_PROOF_VERSION,
  STAGING_READINESS_SCHEMA_VERSION
} from "./constants.js";
import {
  buildStagingReadinessGatesV1,
  buildStagingReadinessSummaryV1,
  makeStagingReadinessCaseV1,
  sealStagingReadinessReceiptV1,
  validateStagingReadinessReceiptV1
} from "./contract.js";
import {
  attestHistoricalStagingProofReceiptsV1,
  attestStagingReadinessGitCandidateV1
} from "./gitEvidence.js";
import {
  loadStagingReadinessPolicyV1,
  stagingReadinessPolicyReceiptBindingV1
} from "./policy.js";
import { sha256StagingReadinessV1 } from "./serialization.js";
import { invalidStagingReadinessV1 } from "./validation.js";

const DEFAULT_TIMEOUT_MILLISECONDS = 15_000;
const REMOTE_BLOCKERS_BY_GATE = Object.freeze({
  production_isolation: [
    "immutable_staging_candidate_identities_not_supplied",
    "production_identity_guard_not_supplied"
  ],
  migration_repeatability: [
    "database_lane_terminal_candidate_not_supplied",
    "read_only_staging_authorization_not_supplied"
  ],
  least_privilege: [
    "database_lane_terminal_candidate_not_supplied",
    "proof_access_not_supplied"
  ],
  regional_data: [
    "database_lane_terminal_candidate_not_supplied",
    "read_only_staging_authorization_not_supplied"
  ],
  index_transaction_performance: [
    "database_lane_terminal_candidate_not_supplied",
    "read_only_staging_authorization_not_supplied"
  ],
  backup_restore: [
    "database_lane_terminal_candidate_not_supplied",
    "failure_drill_authorization_not_supplied",
    "operational_age_owner_decisions_not_supplied"
  ],
  https_startup: [
    "runtime_lane_terminal_candidate_not_supplied",
    "read_only_staging_authorization_not_supplied"
  ],
  lifecycle_rollback: [
    "runtime_lane_terminal_candidate_not_supplied",
    "failure_drill_authorization_not_supplied"
  ],
  monitoring_alerts: [
    "runtime_monitoring_candidate_not_supplied",
    "operational_age_owner_decisions_not_supplied"
  ],
  outage_fail_closed: [
    "runtime_lane_terminal_candidate_not_supplied",
    "failure_drill_authorization_not_supplied"
  ],
  provider_containment: [
    "staging_flags_not_independently_observed",
    "proof_access_not_supplied"
  ],
  privacy_cleanup: [
    "proof_access_not_supplied",
    "immutable_staging_candidate_identities_not_supplied"
  ]
});

export async function runOfflineStagingReadinessV1({
  baselineCommit,
  candidateCommit,
  proofAsOf,
  trustedNow = new Date().toISOString(),
  timeoutMilliseconds = DEFAULT_TIMEOUT_MILLISECONDS,
  signal,
  policyLoader = loadStagingReadinessPolicyV1,
  gitAttester = attestStagingReadinessGitCandidateV1,
  historicalAttester = attestHistoricalStagingProofReceiptsV1,
  timerApi = globalThis
}) {
  if (!Number.isInteger(timeoutMilliseconds) || timeoutMilliseconds < 100 ||
      timeoutMilliseconds > 30_000) {
    invalidStagingReadinessV1("offline_timeout_invalid");
  }
  const operation = async () => {
    if (signal?.aborted) invalidStagingReadinessV1("offline_run_cancelled");
    const policy = await policyLoader();
    if (signal?.aborted) invalidStagingReadinessV1("offline_run_cancelled");
    const candidate = await gitAttester({ baselineCommit, candidateCommit });
    if (signal?.aborted) invalidStagingReadinessV1("offline_run_cancelled");
    const historical = await historicalAttester({ baselineCommit, candidateCommit });
    if (signal?.aborted) invalidStagingReadinessV1("offline_run_cancelled");
    const receipt = await buildOfflineReceipt({
      proofAsOf,
      trustedNow,
      policy,
      candidate,
      historical
    });
    validateStagingReadinessReceiptV1(receipt, {
      trustedNow,
      policy
    });
    return { receipt, policy };
  };
  return withinDeadline(operation, timeoutMilliseconds, timerApi);
}

async function buildOfflineReceipt({
  proofAsOf,
  trustedNow,
  policy,
  candidate,
  historical
}) {
  const featureFlags = offlineFeatureFlags(policy);
  const providerAccounting = zeroProviderAccounting();
  const observations = {
    environment: null,
    runtime: null,
    database: null,
    migrations: null,
    roles: null,
    regions: null,
    performance: null,
    backupRestore: null,
    runtimeOperations: null,
    monitoring: null,
    outages: null,
    featureFlags,
    providerAccounting,
    privacy: null,
    cleanup: null
  };
  const staticEvidence = new Map([
    ["git_candidate_attestation", candidate.candidateAttestationSha256],
    ["policy_contract_attestation", policy.policySha256],
    ["historical_receipts_immutable", historical.manifestSha256]
  ]);
  const cases = CANONICAL_CASES.map(({ id, gateId }) => {
    if (staticEvidence.has(id)) {
      return makeStagingReadinessCaseV1({
        id,
        state: "passed",
        evidenceKind: "immutable_source",
        evidenceSha256: staticEvidence.get(id),
        observedAt: proofAsOf,
        candidateBindingSha256: candidate.candidateAttestationSha256
      });
    }
    if (id === "staging_prerequisite_reconciliation") {
      return makeStagingReadinessCaseV1({
        id,
        state: "not_run",
        evidenceKind: "external_blocker",
        blockerCodes: [
          "observer_trust_not_supplied",
          "upstream_mandatory_gate_non_pass"
        ]
      });
    }
    return makeStagingReadinessCaseV1({
      id,
      state: "blocked",
      evidenceKind: "external_blocker",
      blockerCodes: REMOTE_BLOCKERS_BY_GATE[gateId]
    });
  });
  const gates = buildStagingReadinessGatesV1(cases);
  const findings = [];
  const summary = buildStagingReadinessSummaryV1({
    evidenceMode: "offline_contract",
    cases,
    gates,
    findings
  });
  return sealStagingReadinessReceiptV1({
    schemaVersion: STAGING_READINESS_SCHEMA_VERSION,
    proofVersion: STAGING_READINESS_PROOF_VERSION,
    evidenceMode: "offline_contract",
    generatedAt: proofAsOf,
    proofAsOf,
    clockPolicy: {
      maximumReceiptAgeSeconds: null,
      ownerDecisionDigest: null,
      trustedObservationAt: trustedNow
    },
    policy: stagingReadinessPolicyReceiptBindingV1(policy),
    candidate,
    candidateBindingSha256: null,
    observations,
    cases,
    gates,
    findings,
    summary
  });
}

function offlineFeatureFlags(policy) {
  const matrixSource = policy.sources.find((source) =>
    source.path ===
      "docs/operations/closed-beta-readiness-v1/feature-flag-state-matrix-v1.json"
  );
  return {
    matrixSourceSha256: matrixSource.sha256,
    observationScope: "repository_contract_only",
    allDeployedValuesObserved: false,
    allEffectiveValuesFalse: false,
    flags: CANONICAL_FLAG_BINDINGS.map(([id, key]) => {
      const evidence = { id, key, sourceDeclaredDefault: false };
      return {
        ...evidence,
        deployedObservedValue: null,
        effectiveValue: null,
        verified: false,
        evidenceSha256: sha256StagingReadinessV1(evidence)
      };
    }),
    observedAt: null,
    evidenceSha256: sha256StagingReadinessV1({
      matrixSourceSha256: matrixSource.sha256,
      scope: "repository_contract_only"
    })
  };
}

function zeroProviderAccounting() {
  const snapshot = (id) => ({
    id,
    attempted: 0,
    providerWork: 0,
    evidenceSha256: sha256StagingReadinessV1({ id, attempted: 0, providerWork: 0 })
  });
  const record = {
    hardCallCeiling: 0,
    authorized: 0,
    attempted: 0,
    successful: 0,
    failed: 0,
    timedOut: 0,
    cancelled: 0,
    credentialAdmitted: false,
    egressAdmitted: false,
    authorizationWork: 0,
    databaseWork: 0,
    budgetWork: 0,
    leaseWork: 0,
    circuitWork: 0,
    providerWork: 0,
    snapshots: [snapshot("before"), snapshot("during"), snapshot("after")]
  };
  return { ...record, evidenceSha256: sha256StagingReadinessV1(record) };
}

async function withinDeadline(operation, timeoutMilliseconds, timerApi) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = timerApi.setTimeout(() => {
      reject(Object.assign(new Error("offline_run_timed_out"), {
        code: "offline_run_timed_out"
      }));
    }, timeoutMilliseconds);
    timer?.unref?.();
  });
  try {
    return await Promise.race([Promise.resolve().then(operation), timeout]);
  } finally {
    timerApi.clearTimeout(timer);
  }
}
