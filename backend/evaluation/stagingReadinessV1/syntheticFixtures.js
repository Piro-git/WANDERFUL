import {
  CANONICAL_ALERT_IDS,
  CANONICAL_CASES,
  CANONICAL_FLAG_BINDINGS,
  CANONICAL_MIGRATIONS,
  CANONICAL_OUTAGE_IDS,
  CANONICAL_PERFORMANCE_OPERATIONS,
  CANONICAL_REGION_IDS,
  CANONICAL_RESTORE_RECONCILIATIONS,
  CANONICAL_ROLE_IDS,
  STAGING_READINESS_PROOF_VERSION,
  STAGING_READINESS_SCHEMA_VERSION
} from "./constants.js";
import {
  buildStagingReadinessGatesV1,
  buildStagingReadinessSummaryV1,
  makeStagingReadinessCaseV1,
  sealStagingReadinessReceiptV1
} from "./contract.js";
import { stagingReadinessCandidateBindingRecordV1 } from "./observations.js";
import { stagingReadinessPolicyReceiptBindingV1 } from "./policy.js";
import { sha256StagingReadinessV1 } from "./serialization.js";

const TIMES = Object.freeze({
  proof: "2026-08-24T10:00:00.000Z",
  source: "2026-08-23T10:00:00.000Z",
  retrieved: "2026-08-23T11:00:00.000Z",
  imported: "2026-08-23T12:00:00.000Z",
  projected: "2026-08-23T13:00:00.000Z",
  backup: "2026-08-24T07:00:00.000Z",
  restoreStart: "2026-08-24T07:10:00.000Z",
  restoreEnd: "2026-08-24T07:20:00.000Z",
  migrationStart: "2026-08-24T08:00:00.000Z",
  migrationEnd: "2026-08-24T08:01:00.000Z",
  migrationSecondStart: "2026-08-24T08:02:00.000Z",
  migrationSecondEnd: "2026-08-24T08:03:00.000Z",
  outageStart: "2026-08-24T09:00:00.000Z",
  outageEnd: "2026-08-24T09:05:00.000Z",
  observed: "2026-08-24T09:30:00.000Z",
  finalObserved: "2026-08-24T09:55:00.000Z",
  bindingStart: "2026-08-24T06:55:00.000Z",
  bindingEnd: "2026-08-24T09:59:00.000Z",
  certificateStart: "2026-08-01T00:00:00.000Z",
  certificateEnd: "2026-09-01T00:00:00.000Z"
});

export async function createCompleteSyntheticStagingReceiptV1({
  policy,
  signer
}) {
  const candidate = syntheticCandidate();
  const observations = syntheticObservations(policy, candidate);
  const candidateBindingSha256 = sha256StagingReadinessV1(
    stagingReadinessCandidateBindingRecordV1(observations, candidate)
  );
  observations.environment.preflightBindingSha256 = candidateBindingSha256;
  observations.environment.postflightBindingSha256 = candidateBindingSha256;
  observations.runtimeOperations.preflight.candidateBindingSha256 =
    candidateBindingSha256;

  const cases = CANONICAL_CASES.map(({ id }) => {
    if (id === "staging_prerequisite_reconciliation") return null;
    const isStatic = new Set([
      "git_candidate_attestation",
      "policy_contract_attestation",
      "historical_receipts_immutable"
    ]).has(id);
    const evidenceSha256 = digest(`case:${id}`);
    return makeStagingReadinessCaseV1({
      id,
      state: "passed",
      evidenceKind: isStatic ? "immutable_source" : "independent_live_observation",
      evidenceSha256,
      observedAt: TIMES.finalObserved,
      candidateBindingSha256: isStatic
        ? candidate.candidateAttestationSha256
        : candidateBindingSha256
    });
  }).filter(Boolean);
  const prerequisiteDigest = sha256StagingReadinessV1(cases.map((item) => ({
    id: item.id,
    state: item.state,
    evidenceSha256: item.evidenceSha256
  })));
  cases.push(makeStagingReadinessCaseV1({
    id: "staging_prerequisite_reconciliation",
    state: "passed",
    evidenceKind: "derived_attestation",
    evidenceSha256: prerequisiteDigest,
    observedAt: TIMES.finalObserved,
    candidateBindingSha256
  }));
  const gates = buildStagingReadinessGatesV1(cases);
  const findings = [];
  const summary = buildStagingReadinessSummaryV1({
    evidenceMode: "live_staging",
    cases,
    gates,
    findings
  });
  return sealStagingReadinessReceiptV1({
    schemaVersion: STAGING_READINESS_SCHEMA_VERSION,
    proofVersion: STAGING_READINESS_PROOF_VERSION,
    evidenceMode: "live_staging",
    generatedAt: TIMES.proof,
    proofAsOf: TIMES.proof,
    clockPolicy: {
      maximumReceiptAgeSeconds: 14_400,
      ownerDecisionDigest: digest("clock-owner-decision"),
      trustedObservationAt: TIMES.proof
    },
    policy: stagingReadinessPolicyReceiptBindingV1(policy),
    candidate,
    candidateBindingSha256,
    observations,
    cases,
    gates,
    findings,
    summary
  }, { signer });
}

export const SYNTHETIC_STAGING_PROOF_AS_OF = TIMES.proof;

function syntheticCandidate() {
  const record = {
    baselineCommit: "1".repeat(40),
    candidateCommit: "2".repeat(40),
    headCommit: "2".repeat(40),
    treeDigest: "3".repeat(40),
    indexTreeDigest: "3".repeat(40),
    indexClean: true,
    worktreeClean: true,
    baselineExists: true,
    baselineAncestorOfCandidate: true
  };
  return {
    ...record,
    candidateAttestationSha256: sha256StagingReadinessV1(record)
  };
}

function syntheticObservations(policy, candidate) {
  const stagingOrigin = digest("staging-origin");
  const stagingProject = digest("staging-project");
  const stagingDatabase = digest("staging-database");
  const deploymentRevision = digest("candidate-deployment");
  const matrixSource = policy.sources.find((source) =>
    source.path.endsWith("feature-flag-state-matrix-v1.json")
  ).sha256;
  return {
    environment: {
      stage: "staging",
      httpsOriginDigest: stagingOrigin,
      supabaseProjectRefDigest: stagingProject,
      databaseInstanceDigest: stagingDatabase,
      supabaseRegion: "eu-central-1",
      productionHttpsOriginDigest: digest("production-origin"),
      productionSupabaseProjectRefDigest: digest("production-project"),
      productionDatabaseInstanceDigest: digest("production-database"),
      productionIdentitySetDigest: sha256StagingReadinessV1([
        digest("production-origin"),
        digest("production-project"),
        digest("production-database")
      ]),
      explicitlyNotProduction: true,
      preflightBindingSha256: digest("binding-placeholder"),
      postflightBindingSha256: digest("binding-placeholder"),
      preflightObservedAt: TIMES.bindingStart,
      postflightObservedAt: TIMES.bindingEnd,
      evidenceSha256: digest("environment-evidence")
    },
    runtime: {
      imageDigest: `sha256:${digest("runtime-image")}`,
      deploymentRevisionDigest: deploymentRevision,
      candidateCommit: candidate.candidateCommit,
      treeDigest: candidate.treeDigest,
      runsAsNonRoot: true,
      runtimeUserClass: "non_root",
      observedAt: TIMES.finalObserved,
      evidenceSha256: digest("runtime-evidence")
    },
    database: {
      supabaseProjectRefDigest: stagingProject,
      databaseInstanceDigest: stagingDatabase,
      supabaseRegion: "eu-central-1",
      postgresVersion: "17.2",
      postgisVersion: "3.5.2",
      candidateCommit: candidate.candidateCommit,
      observedAt: TIMES.finalObserved,
      evidenceSha256: digest("database-evidence")
    },
    migrations: syntheticMigrations(policy),
    roles: syntheticRoles(),
    regions: CANONICAL_REGION_IDS.map((regionId, index) =>
      syntheticRegion(regionId, policy.regionConfigs[index])
    ),
    performance: syntheticPerformance(),
    backupRestore: syntheticBackupRestore(stagingDatabase),
    runtimeOperations: syntheticRuntimeOperations(stagingOrigin, deploymentRevision),
    monitoring: syntheticMonitoring(),
    outages: syntheticOutages(),
    featureFlags: syntheticFeatureFlags(matrixSource),
    providerAccounting: syntheticProviderAccounting(),
    privacy: {
      scanVersion: "staging-readiness-privacy-scan-v1",
      artifactCount: 20,
      maximumArtifactBytes: 524_288,
      scannedBytes: 123_456,
      forbiddenKeyMatches: 0,
      secretPatternMatches: 0,
      rawUrlMatches: 0,
      exactCoordinateMatches: 0,
      routeGeometryMatches: 0,
      appAttestMaterialMatches: 0,
      secretBearingErrorMatches: 0,
      passed: true,
      evidenceSha256: digest("privacy-evidence")
    },
    cleanup: {
      attempted: true,
      completedAt: TIMES.finalObserved,
      flagsAllFalse: true,
      poolsClosed: true,
      leasesRemaining: 0,
      temporaryResourcesCreated: 4,
      temporaryResourcesRemoved: 4,
      proofProcessesRemaining: 0,
      listenersRemaining: 0,
      credentialAccessRemoved: true,
      residualResourceDigests: [],
      immutableEvidenceRetained: true,
      evidenceSha256: digest("cleanup-evidence")
    }
  };
}

function syntheticMigrations(policy) {
  const ledgerAfter = digest("migration-ledger-after");
  const schemaAfter = digest("migration-schema-after");
  return {
    ledger: CANONICAL_MIGRATIONS.map((file, index) => ({
      ordinal: index + 1,
      file,
      sourceSha256: policy.migrations[index].sourceSha256,
      ledgerSourceSha256: policy.migrations[index].sourceSha256
    })),
    firstRun: {
      startedAt: TIMES.migrationStart,
      completedAt: TIMES.migrationEnd,
      appliedCount: 8,
      ledgerBeforeDigest: digest("empty-ledger"),
      ledgerAfterDigest: ledgerAfter,
      schemaBeforeDigest: digest("empty-schema"),
      schemaAfterDigest: schemaAfter,
      succeeded: true,
      transactionRolledBack: false,
      noOp: false,
      evidenceSha256: digest("first-migration-run")
    },
    secondRun: {
      startedAt: TIMES.migrationSecondStart,
      completedAt: TIMES.migrationSecondEnd,
      appliedCount: 0,
      ledgerBeforeDigest: ledgerAfter,
      ledgerAfterDigest: ledgerAfter,
      schemaBeforeDigest: schemaAfter,
      schemaAfterDigest: schemaAfter,
      succeeded: true,
      transactionRolledBack: false,
      noOp: true,
      evidenceSha256: digest("second-migration-run")
    },
    schemaDigest: schemaAfter,
    rlsDigest: digest("rls-policy"),
    indexDigest: digest("index-set"),
    evidenceSha256: digest("migration-evidence")
  };
}

function syntheticRoles() {
  const runtimeRoleDigest = digest("role:outdoor_research_runtime_role");
  return {
    roleSetDigest: digest("role-set"),
    grantDigest: digest("grant-set"),
    rlsPolicyDigest: digest("rls-set"),
    functionBoundaryDigest: digest("function-boundary"),
    publicDataApiDenied: true,
    runtimeDirectTableAccessDenied: true,
    runtimeFunctionCount: 5,
    runtimeRoleDigest,
    cancellationRoleDigest: digest("cancellation-role"),
    roles: CANONICAL_ROLE_IDS.map((id) => ({
      id,
      identityDigest: digest(`role:${id}`),
      separatedIdentity: true,
      boundaryPassed: true,
      prohibitedPrivilegesDenied: true,
      dangerousPrivilegeDetected: false,
      rlsBoundaryPassed: true,
      evidenceSha256: digest(`role-evidence:${id}`)
    })),
    observedAt: TIMES.observed,
    evidenceSha256: digest("roles-evidence")
  };
}

function syntheticRegion(regionId, config) {
  return {
    regionId,
    configSha256: config.configSha256,
    boundarySha256: config.boundarySha256,
    sourceImportSha256: digest(`source-import:${regionId}`),
    sourceChecksumDigest: digest(`source-checksum:${regionId}`),
    importIdentityDigest: digest(`import:${regionId}`),
    projectionIdentityDigest: digest(`projection:${regionId}`),
    projectionPolicyDigest: digest("osm-foundational-mapped-v1"),
    sourceDataAt: TIMES.source,
    retrievedAt: TIMES.retrieved,
    importedAt: TIMES.imported,
    projectedAt: TIMES.projected,
    observedAt: TIMES.observed,
    sourceAgeSeconds: 86_400,
    freshnessThresholdDays: 14,
    fresh: true,
    importStatus: "active",
    projectionStatus: "active",
    activeBindingPassed: true,
    crossRegionRows: 0,
    partialResidueRows: 0,
    rowTotals: {
      importedPois: 100 + (regionId === "harz-v1" ? 1 : 2),
      importedSegments: 1_000,
      importedRelations: 25,
      projectedEntities: 1_100,
      projectedAssertions: 1_200,
      projectedRelationships: 200,
      quarantinedRows: 0
    },
    evidenceSha256: digest(`region-evidence:${regionId}`)
  };
}

function syntheticPerformance() {
  return {
    policy: {
      statementTimeoutMilliseconds: 2_500,
      routeMembershipP95Milliseconds: 1_500,
      reviewedMeasurementMaximumMilliseconds: 2_000,
      postgisMinimumVersion: "3.2"
    },
    observations: CANONICAL_PERFORMANCE_OPERATIONS.map((operationId, index) => ({
      operationId,
      sampleCount: 5,
      minimumMilliseconds: 100 + index,
      medianMilliseconds: 200 + index,
      p95Milliseconds: 300 + index,
      maximumMilliseconds: 400 + index,
      expectedRowCount: 5 + index,
      indexUsed: true,
      indexNameDigest: digest(`index:${operationId}`),
      projectionEntitySequentialScan: false,
      observedAt: TIMES.observed,
      evidenceSha256: digest(`performance:${operationId}`)
    })),
    cancellation: {
      attempted: 3,
      cancelled: 3,
      rollbacksSucceeded: 3,
      poolRecovered: true,
      waitingClients: 0,
      lateResults: 0,
      observedAt: TIMES.observed,
      evidenceSha256: digest("cancellation-evidence")
    },
    evidenceSha256: digest("performance-evidence")
  };
}

function syntheticBackupRestore(databaseDigest) {
  return {
    policyOwnerDecisionDigest: digest("backup-owner-decision"),
    maximumEvidenceAgeSeconds: 86_400,
    backupIdentityDigest: digest("backup-identity"),
    restoreIdentityDigest: digest("restore-identity"),
    sourceDatabaseInstanceDigest: databaseDigest,
    restoreDatabaseInstanceDigest: digest("restore-database"),
    backupCompletedAt: TIMES.backup,
    restoreStartedAt: TIMES.restoreStart,
    restoreCompletedAt: TIMES.restoreEnd,
    observedAt: TIMES.observed,
    configured: true,
    restoreSucceeded: true,
    fresh: true,
    reconciliations: CANONICAL_RESTORE_RECONCILIATIONS.map((id) => ({
      id,
      passed: true,
      evidenceSha256: digest(`restore:${id}`)
    })),
    evidenceSha256: digest("backup-restore-evidence")
  };
}

function syntheticRuntimeOperations(originDigest, deploymentRevision) {
  return {
    https: {
      certificateDigest: digest("certificate"),
      originDigest,
      validFrom: TIMES.certificateStart,
      validTo: TIMES.certificateEnd,
      tlsProtocol: "TLSv1.3",
      chainValid: true,
      hostnameVerified: true,
      observedAt: TIMES.observed,
      evidenceSha256: digest("https-evidence")
    },
    liveness: {
      statusCode: 200,
      state: "live",
      dependencyWorkCount: 0,
      sensitiveDetailsExposed: false,
      observedAt: TIMES.observed,
      evidenceSha256: digest("liveness-evidence")
    },
    readiness: {
      statusCode: 200,
      state: "ready",
      requiredDatabaseReady: true,
      optionalMonitoringReady: true,
      sensitiveDetailsExposed: false,
      observedAt: TIMES.observed,
      evidenceSha256: digest("readiness-evidence")
    },
    preflight: {
      decision: "ready",
      nodeEnvironment: "production",
      releaseStage: "staging",
      allControlledFlagsExact: true,
      missingRequiredConfiguration: false,
      sensitiveDetailsExposed: false,
      candidateBindingSha256: digest("binding-placeholder"),
      observedAt: TIMES.observed,
      evidenceSha256: digest("preflight-evidence")
    },
    drain: {
      acceptingAfterDrainStarted: false,
      lateWorkAccepted: 0,
      inFlightWorkSettled: true,
      poolsClosed: true,
      deadlineExceeded: false,
      observedAt: TIMES.observed,
      evidenceSha256: digest("drain-evidence")
    },
    restart: {
      preRestartRevisionDigest: deploymentRevision,
      postRestartRevisionDigest: deploymentRevision,
      readinessRecovered: true,
      inFlightLeakCount: 0,
      observedAt: TIMES.observed,
      evidenceSha256: digest("restart-evidence")
    },
    rollback: {
      candidateRevisionDigest: deploymentRevision,
      rollbackTargetRevisionDigest: digest("known-good-revision"),
      rolledBackRevisionDigest: digest("known-good-revision"),
      finalRevisionDigest: deploymentRevision,
      rollbackTargetKnownGood: true,
      rollbackReadinessPassed: true,
      rollForwardSucceeded: true,
      observedAt: TIMES.observed,
      evidenceSha256: digest("rollback-evidence")
    },
    evidenceSha256: digest("runtime-operations-evidence")
  };
}

function syntheticMonitoring() {
  return {
    policyOwnerDecisionDigest: digest("monitoring-owner-decision"),
    maximumAlertTestAgeSeconds: 3_600,
    sinkConfigDigest: digest("monitoring-sink"),
    dashboardConfigDigest: digest("dashboard-config"),
    retentionPolicyDigest: digest("retention-policy"),
    accessPolicyDigest: digest("access-policy"),
    privacySchemaDigest: digest("privacy-schema"),
    forbiddenSignalCount: 0,
    alerts: CANONICAL_ALERT_IDS.map((id) => ({
      id,
      enabled: true,
      testPassed: true,
      signalCount: 1,
      lastTestedAt: TIMES.observed,
      deliveryDigest: digest(`delivery:${id}`),
      evidenceSha256: digest(`alert:${id}`)
    })),
    observedAt: TIMES.observed,
    evidenceSha256: digest("monitoring-evidence")
  };
}

function syntheticOutages() {
  return CANONICAL_OUTAGE_IDS.map((id) => ({
    id,
    dependencyClass: id === "monitoring_unavailable" ? "optional" : "required",
    inducedAt: TIMES.outageStart,
    recoveredAt: TIMES.outageEnd,
    resultCode: id === "monitoring_unavailable" ? "monitoring_degraded" : "dependency_unavailable",
    livenessState: "live",
    readinessDuringOutage: id === "monitoring_unavailable"
      ? "ready_degraded"
      : "not_ready",
    readinessAfterRecovery: "ready",
    providerCalls: 0,
    authorizationWork: 0,
    budgetWork: 0,
    leaseWork: 0,
    circuitWork: 0,
    rollbackPassed: true,
    poolRecovered: true,
    sensitiveDetailsExposed: false,
    evidenceSha256: digest(`outage:${id}`)
  }));
}

function syntheticFeatureFlags(matrixSourceSha256) {
  return {
    matrixSourceSha256,
    observationScope: "independent_live_staging",
    allDeployedValuesObserved: true,
    allEffectiveValuesFalse: true,
    flags: CANONICAL_FLAG_BINDINGS.map(([id, key]) => ({
      id,
      key,
      sourceDeclaredDefault: false,
      deployedObservedValue: false,
      effectiveValue: false,
      verified: true,
      evidenceSha256: digest(`flag:${id}`)
    })),
    observedAt: TIMES.observed,
    evidenceSha256: digest("feature-flags-evidence")
  };
}

function syntheticProviderAccounting() {
  return {
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
    snapshots: ["before", "during", "after"].map((id) => ({
      id,
      attempted: 0,
      providerWork: 0,
      evidenceSha256: digest(`provider-snapshot:${id}`)
    })),
    evidenceSha256: digest("provider-accounting-evidence")
  };
}

function digest(value) {
  return sha256StagingReadinessV1(value);
}
