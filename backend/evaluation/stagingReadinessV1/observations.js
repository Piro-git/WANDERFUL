import {
  CANONICAL_ALERT_IDS,
  CANONICAL_FLAG_BINDINGS,
  CANONICAL_MIGRATIONS,
  CANONICAL_OUTAGE_IDS,
  CANONICAL_PERFORMANCE_OPERATIONS,
  CANONICAL_REGION_IDS,
  CANONICAL_RESTORE_RECONCILIATIONS,
  CANONICAL_ROLE_IDS,
  CANONICAL_ROLE_SEPARATION_GUARD_IDS,
  CANCELLATION_CONTROL_PRIVILEGE_MANIFEST,
  CANCELLATION_CONTROL_ROLE_ID,
  REGIONAL_FRESHNESS_THRESHOLD_DAYS,
  REVIEWED_THRESHOLDS
} from "./constants.js";
import {
  HEX_40,
  IMAGE_DIGEST,
  assertBoundedArray,
  assertDigest,
  assertExactOrderedIds,
  assertSafeIdentifier,
  exactKeys,
  invalidStagingReadinessV1,
  plainObject,
  timestampMilliseconds
} from "./validation.js";

const OBSERVATION_KEYS = Object.freeze([
  "environment",
  "runtime",
  "database",
  "migrations",
  "roles",
  "regions",
  "performance",
  "backupRestore",
  "runtimeOperations",
  "monitoring",
  "outages",
  "featureFlags",
  "providerAccounting",
  "privacy",
  "cleanup"
]);

export function validateStagingReadinessObservationsV1(
  observations,
  context
) {
  exactKeys(observations, OBSERVATION_KEYS, "receipt_observations_schema_drift");
  const live = context.evidenceMode === "live_staging";
  if (live && OBSERVATION_KEYS.some((key) => observations[key] === null)) {
    invalidStagingReadinessV1("live_observation_missing");
  }
  if (observations.environment !== null) validateEnvironment(observations.environment, context);
  if (observations.runtime !== null) validateRuntime(observations.runtime, context);
  if (observations.database !== null) validateDatabase(observations.database, context);
  if (observations.migrations !== null) validateMigrations(observations.migrations, context);
  if (observations.roles !== null) validateRoles(observations.roles, context);
  if (observations.regions !== null) validateRegions(observations.regions, context);
  if (observations.performance !== null) validatePerformance(observations.performance, context);
  if (observations.backupRestore !== null) validateBackupRestore(observations.backupRestore, context);
  if (observations.runtimeOperations !== null) validateRuntimeOperations(observations.runtimeOperations, context);
  if (observations.monitoring !== null) validateMonitoring(observations.monitoring, context);
  if (observations.outages !== null) validateOutages(observations.outages, context);
  if (observations.featureFlags !== null) validateFeatureFlags(observations.featureFlags, context);
  if (observations.providerAccounting !== null) validateProviderAccounting(observations.providerAccounting);
  if (observations.privacy !== null) validatePrivacy(observations.privacy);
  if (observations.cleanup !== null) validateCleanup(observations.cleanup, context);
  if (live) validateCrossBindings(observations, context);
  return true;
}

function validateEnvironment(value, context) {
  exactKeys(value, [
    "stage", "httpsOriginDigest", "supabaseProjectRefDigest",
    "databaseInstanceDigest", "supabaseRegion", "productionIdentitySetDigest",
    "productionHttpsOriginDigest", "productionSupabaseProjectRefDigest",
    "productionDatabaseInstanceDigest", "explicitlyNotProduction",
    "preflightBindingSha256", "postflightBindingSha256", "preflightObservedAt",
    "postflightObservedAt", "evidenceSha256"
  ]);
  if (value.stage !== "staging" || value.explicitlyNotProduction !== true) {
    invalidStagingReadinessV1("environment_not_staging");
  }
  for (const key of [
    "httpsOriginDigest", "supabaseProjectRefDigest", "databaseInstanceDigest",
    "productionIdentitySetDigest", "productionHttpsOriginDigest",
    "productionSupabaseProjectRefDigest", "productionDatabaseInstanceDigest",
    "preflightBindingSha256", "postflightBindingSha256", "evidenceSha256"
  ]) assertDigest(value[key]);
  assertSafeIdentifier(value.supabaseRegion);
  const preflightObservedAt = assertObservationClock(
    value.preflightObservedAt,
    context
  );
  const postflightObservedAt = assertObservationClock(
    value.postflightObservedAt,
    context
  );
  if (postflightObservedAt <= preflightObservedAt) {
    invalidStagingReadinessV1("candidate_binding_window_invalid");
  }
  const staging = new Set([
    value.httpsOriginDigest,
    value.supabaseProjectRefDigest,
    value.databaseInstanceDigest
  ]);
  const production = new Set([
    value.productionHttpsOriginDigest,
    value.productionSupabaseProjectRefDigest,
    value.productionDatabaseInstanceDigest
  ]);
  if ([...staging].some((digest) => production.has(digest)) ||
      staging.size !== 3 || production.size !== 3) {
    invalidStagingReadinessV1("production_staging_identity_alias");
  }
  if (value.productionIdentitySetDigest !== context.sha256([...production])) {
    invalidStagingReadinessV1("production_identity_set_digest_mismatch");
  }
  if (value.preflightBindingSha256 !== context.candidateBindingSha256 ||
      value.postflightBindingSha256 !== context.candidateBindingSha256) {
    invalidStagingReadinessV1("candidate_binding_changed_during_proof");
  }
}

function validateRuntime(value, context) {
  exactKeys(value, [
    "imageDigest", "deploymentRevisionDigest", "candidateCommit", "treeDigest",
    "runsAsNonRoot", "runtimeUserClass", "observedAt", "evidenceSha256"
  ]);
  if (!IMAGE_DIGEST.test(value.imageDigest ?? "") ||
      value.candidateCommit !== context.candidate.candidateCommit ||
      value.treeDigest !== context.candidate.treeDigest ||
      value.runsAsNonRoot !== true || value.runtimeUserClass !== "non_root") {
    invalidStagingReadinessV1("runtime_candidate_binding_invalid");
  }
  assertDigest(value.deploymentRevisionDigest);
  assertDigest(value.evidenceSha256);
  assertObservationClock(value.observedAt, context);
}

function validateDatabase(value, context) {
  exactKeys(value, [
    "supabaseProjectRefDigest", "databaseInstanceDigest", "supabaseRegion",
    "postgresVersion", "postgisVersion", "candidateCommit", "observedAt",
    "evidenceSha256"
  ]);
  for (const key of ["supabaseProjectRefDigest", "databaseInstanceDigest", "evidenceSha256"]) {
    assertDigest(value[key]);
  }
  assertSafeIdentifier(value.supabaseRegion);
  assertVersion(value.postgresVersion);
  assertVersion(value.postgisVersion);
  const [major, minor] = value.postgisVersion.split(".").map(Number);
  if (major < REVIEWED_THRESHOLDS.postgisMinimumMajor ||
      (major === REVIEWED_THRESHOLDS.postgisMinimumMajor &&
        minor < REVIEWED_THRESHOLDS.postgisMinimumMinor) ||
      value.candidateCommit !== context.candidate.candidateCommit) {
    invalidStagingReadinessV1("database_candidate_or_version_invalid");
  }
  assertObservationClock(value.observedAt, context);
}

function validateMigrations(value, context) {
  exactKeys(value, [
    "ledger", "firstRun", "secondRun", "schemaDigest", "rlsDigest",
    "indexDigest", "evidenceSha256"
  ]);
  assertExactOrderedIds(value.ledger, CANONICAL_MIGRATIONS, "file");
  value.ledger.forEach((entry, index) => {
    exactKeys(entry, ["ordinal", "file", "sourceSha256", "ledgerSourceSha256"]);
    const expected = context.policy.migrations[index];
    if (entry.ordinal !== index + 1 || entry.sourceSha256 !== expected.sourceSha256 ||
        entry.ledgerSourceSha256 !== expected.sourceSha256) {
      invalidStagingReadinessV1("migration_ledger_mismatch");
    }
  });
  validateMigrationRun(value.firstRun, context);
  validateMigrationRun(value.secondRun, context);
  if (value.firstRun.succeeded !== true || value.firstRun.appliedCount !== 8 ||
      value.firstRun.transactionRolledBack !== false ||
      value.secondRun.succeeded !== true || value.secondRun.appliedCount !== 0 ||
      value.secondRun.noOp !== true ||
      value.secondRun.startedAt < value.firstRun.completedAt ||
      value.secondRun.ledgerBeforeDigest !== value.firstRun.ledgerAfterDigest ||
      value.secondRun.ledgerAfterDigest !== value.firstRun.ledgerAfterDigest ||
      value.secondRun.schemaBeforeDigest !== value.firstRun.schemaAfterDigest ||
      value.secondRun.schemaAfterDigest !== value.firstRun.schemaAfterDigest) {
    invalidStagingReadinessV1("migration_second_run_not_true_noop");
  }
  for (const key of ["schemaDigest", "rlsDigest", "indexDigest", "evidenceSha256"]) {
    assertDigest(value[key]);
  }
  if (value.schemaDigest !== value.secondRun.schemaAfterDigest) {
    invalidStagingReadinessV1("migration_schema_digest_mismatch");
  }
}

function validateMigrationRun(value, context) {
  exactKeys(value, [
    "startedAt", "completedAt", "appliedCount", "ledgerBeforeDigest",
    "ledgerAfterDigest", "schemaBeforeDigest", "schemaAfterDigest", "succeeded",
    "transactionRolledBack", "noOp", "evidenceSha256"
  ]);
  const started = assertObservationClock(value.startedAt, context);
  const completed = assertObservationClock(value.completedAt, context);
  if (completed < started || !Number.isInteger(value.appliedCount) ||
      value.appliedCount < 0 || value.appliedCount > 8 ||
      typeof value.succeeded !== "boolean" ||
      typeof value.transactionRolledBack !== "boolean" ||
      typeof value.noOp !== "boolean") {
    invalidStagingReadinessV1("migration_run_invalid");
  }
  for (const key of [
    "ledgerBeforeDigest", "ledgerAfterDigest", "schemaBeforeDigest",
    "schemaAfterDigest", "evidenceSha256"
  ]) assertDigest(value[key]);
}

function validateRoles(value, context) {
  exactKeys(value, [
    "roleContractDigest", "roleSetDigest", "grantDigest", "rlsPolicyDigest",
    "functionBoundaryDigest", "cancellationPrivilegeManifestDigest",
    "publicDataApiDenied", "runtimeDirectTableAccessDenied", "runtimeFunctionCount",
    "runtimeRoleDigest", "cancellationRoleDigest", "roles",
    "separationGuardIdentities", "observedAt", "evidenceSha256"
  ]);
  for (const key of [
    "roleContractDigest", "roleSetDigest", "grantDigest", "rlsPolicyDigest",
    "functionBoundaryDigest", "cancellationPrivilegeManifestDigest",
    "runtimeRoleDigest", "cancellationRoleDigest", "evidenceSha256"
  ]) assertDigest(value[key]);
  if (value.publicDataApiDenied !== true ||
      value.runtimeDirectTableAccessDenied !== true ||
      value.runtimeFunctionCount !== REVIEWED_THRESHOLDS.runtimeReadFunctionCount) {
    invalidStagingReadinessV1("role_boundary_invalid");
  }
  if (value.roleContractDigest !== context.sha256(
    context.policy.canonicalRoleContracts
  )) {
    invalidStagingReadinessV1("role_contract_digest_mismatch");
  }
  assertExactOrderedIds(value.roles, CANONICAL_ROLE_IDS);
  const identities = new Set();
  value.roles.forEach((role, index) => {
    exactKeys(role, [
      "id", "purpose", "identityDigest", "privilegeManifestDigest",
      "privilegeManifest", "separatedIdentity", "boundaryPassed",
      "prohibitedPrivilegesDenied", "dangerousPrivilegeDetected",
      "unexpectedMembershipDetected", "unexpectedInheritanceDetected",
      "unexpectedOwnershipDetected", "unexpectedSchemaPrivilegeDetected",
      "unexpectedTablePrivilegeDetected", "publicDataApiExposed",
      "rlsBoundaryPassed", "businessDataMutationBoundaryPassed",
      "evidenceSha256"
    ]);
    const contract = context.policy.canonicalRoleContracts[index];
    if (role.purpose !== contract.purpose) {
      invalidStagingReadinessV1("role_purpose_mismatch");
    }
    assertDigest(role.identityDigest);
    assertDigest(role.privilegeManifestDigest);
    assertDigest(role.evidenceSha256);
    identities.add(role.identityDigest);
    if (role.separatedIdentity !== true || role.boundaryPassed !== true ||
        role.prohibitedPrivilegesDenied !== true ||
        role.dangerousPrivilegeDetected !== false ||
        role.unexpectedMembershipDetected !== false ||
        role.unexpectedInheritanceDetected !== false ||
        role.unexpectedOwnershipDetected !== false ||
        role.unexpectedSchemaPrivilegeDetected !== false ||
        role.unexpectedTablePrivilegeDetected !== false ||
        role.publicDataApiExposed !== false || role.rlsBoundaryPassed !== true ||
        role.businessDataMutationBoundaryPassed !== true) {
      invalidStagingReadinessV1("privileged_or_leaking_role");
    }
    if (role.id === CANCELLATION_CONTROL_ROLE_ID) {
      validateCancellationControlPrivilegeManifest(role, context);
    } else if (role.privilegeManifest !== null) {
      invalidStagingReadinessV1("unexpected_exact_role_privilege_manifest");
    }
    const { evidenceSha256, ...roleRecord } = role;
    if (context.sha256(roleRecord) !== evidenceSha256) {
      invalidStagingReadinessV1("role_evidence_digest_mismatch");
    }
  });
  assertExactOrderedIds(
    value.separationGuardIdentities,
    CANONICAL_ROLE_SEPARATION_GUARD_IDS
  );
  value.separationGuardIdentities.forEach((guard) => {
    exactKeys(guard, ["id", "identityDigest"]);
    assertDigest(guard.identityDigest);
    identities.add(guard.identityDigest);
  });
  if (identities.size !== CANONICAL_ROLE_IDS.length +
      CANONICAL_ROLE_SEPARATION_GUARD_IDS.length) {
    invalidStagingReadinessV1("role_identity_alias");
  }
  const runtimeRole = value.roles.find((role) =>
    role.id === "outdoor_research_runtime_role"
  );
  const cancellationRole = value.roles.find((role) =>
    role.id === CANCELLATION_CONTROL_ROLE_ID
  );
  if (value.runtimeRoleDigest !== runtimeRole.identityDigest ||
      value.cancellationRoleDigest !== cancellationRole.identityDigest ||
      value.runtimeRoleDigest === value.cancellationRoleDigest ||
      value.cancellationPrivilegeManifestDigest !==
        cancellationRole.privilegeManifestDigest) {
    invalidStagingReadinessV1("role_boundary_invalid");
  }
  if (value.roleSetDigest !== context.sha256(
    stagingReadinessRoleSetRecordV1(value)
  ) || value.grantDigest !== context.sha256(
    value.roles.map((role) => ({
      id: role.id,
      privilegeManifestDigest: role.privilegeManifestDigest
    }))
  )) {
    invalidStagingReadinessV1("role_set_or_grant_digest_mismatch");
  }
  const { evidenceSha256, ...roleObservationRecord } = value;
  if (context.sha256(roleObservationRecord) !== evidenceSha256) {
    invalidStagingReadinessV1("roles_evidence_digest_mismatch");
  }
  assertObservationClock(value.observedAt, context);
}

function validateCancellationControlPrivilegeManifest(role, context) {
  const manifest = role.privilegeManifest;
  exactKeys(manifest, Object.keys(CANCELLATION_CONTROL_PRIVILEGE_MANIFEST),
    "cancellation_control_manifest_schema_drift");
  const expectedDigest = context.sha256(CANCELLATION_CONTROL_PRIVILEGE_MANIFEST);
  if (role.privilegeManifestDigest !== expectedDigest ||
      context.sha256(manifest) !== expectedDigest) {
    invalidStagingReadinessV1("cancellation_control_privilege_manifest_mismatch");
  }
  if (manifest.canLogin !== true || manifest.connectionLimit !== 1 ||
      manifest.statementTimeoutMilliseconds !== 1_000 ||
      manifest.inheritPrivileges !== false || manifest.superuser !== false ||
      manifest.createDatabase !== false || manifest.createRole !== false ||
      manifest.replication !== false || manifest.bypassRls !== false ||
      manifest.membershipRoleIds.length !== 0 || manifest.ownedObjectCount !== 0 ||
      manifest.schemaUsageIds.length !== 1 ||
      manifest.schemaUsageIds[0] !== "trailmind_control" ||
      manifest.tablePrivilegeIds.length !== 0 ||
      manifest.sequencePrivilegeIds.length !== 0 ||
      manifest.functionExecuteIds.length !== 1 ||
      manifest.functionExecuteIds[0] !==
        "trailmind_control.cancel_active_outdoor_research_backend_integer" ||
      manifest.publicDataApiExposed !== false ||
      manifest.directBusinessDataRead !== false ||
      manifest.businessDataMutation !== false ||
      manifest.directPgCancelBackendExecute !== false ||
      manifest.targetRoleId !== "outdoor_research_runtime_role" ||
      manifest.targetRestrictionEnforced !== true ||
      manifest.productQueryExecutionDenied !== true ||
      manifest.selfPrivilegeEscalationDenied !== true) {
    invalidStagingReadinessV1("cancellation_control_privilege_boundary_failed");
  }
}

export function stagingReadinessRoleSetRecordV1(value) {
  return {
    roles: value.roles.map((role) => ({
      id: role.id,
      purpose: role.purpose,
      identityDigest: role.identityDigest,
      privilegeManifestDigest: role.privilegeManifestDigest
    })),
    separationGuardIdentities: value.separationGuardIdentities.map((guard) => ({
      id: guard.id,
      identityDigest: guard.identityDigest
    }))
  };
}

function validateRegions(value, context) {
  assertExactOrderedIds(value, CANONICAL_REGION_IDS, "regionId");
  value.forEach((region, index) => {
    exactKeys(region, [
      "regionId", "configSha256", "boundarySha256", "sourceImportSha256",
      "sourceChecksumDigest", "importIdentityDigest", "projectionIdentityDigest",
      "projectionPolicyDigest", "sourceDataAt", "retrievedAt", "importedAt",
      "projectedAt", "observedAt", "sourceAgeSeconds", "freshnessThresholdDays",
      "fresh", "importStatus", "projectionStatus", "activeBindingPassed",
      "crossRegionRows", "partialResidueRows", "rowTotals", "evidenceSha256"
    ]);
    const expected = context.policy.regionConfigs[index];
    if (region.configSha256 !== expected.configSha256 ||
        region.boundarySha256 !== expected.boundarySha256) {
      invalidStagingReadinessV1("region_config_digest_mismatch");
    }
    for (const key of [
      "sourceImportSha256", "sourceChecksumDigest", "importIdentityDigest",
      "projectionIdentityDigest", "projectionPolicyDigest", "evidenceSha256"
    ]) assertDigest(region[key]);
    const source = assertObservationClock(region.sourceDataAt, context);
    const retrieved = assertObservationClock(region.retrievedAt, context);
    const imported = assertObservationClock(region.importedAt, context);
    const projected = assertObservationClock(region.projectedAt, context);
    const observed = assertObservationClock(region.observedAt, context);
    if (!(source <= retrieved && retrieved <= imported && imported <= projected &&
        projected <= observed) || region.freshnessThresholdDays !==
        REGIONAL_FRESHNESS_THRESHOLD_DAYS) {
      invalidStagingReadinessV1("region_clock_lineage_invalid");
    }
    const expectedAge = Math.floor((context.proofAsOfMs - source) / 1_000);
    if (region.sourceAgeSeconds !== expectedAge || expectedAge < 0 ||
        expectedAge >= REGIONAL_FRESHNESS_THRESHOLD_DAYS * 86_400 ||
        region.fresh !== true || region.importStatus !== "active" ||
        region.projectionStatus !== "active" || region.activeBindingPassed !== true ||
        region.crossRegionRows !== 0 || region.partialResidueRows !== 0) {
      invalidStagingReadinessV1("region_not_current_active_isolated");
    }
    validateRowTotals(region.rowTotals);
  });
  for (const key of [
    "sourceImportSha256",
    "sourceChecksumDigest",
    "importIdentityDigest",
    "projectionIdentityDigest"
  ]) {
    if (new Set(value.map((region) => region[key])).size !== value.length) {
      invalidStagingReadinessV1("regional_identity_alias");
    }
  }
}

function validateRowTotals(value) {
  exactKeys(value, [
    "importedPois", "importedSegments", "importedRelations", "projectedEntities",
    "projectedAssertions", "projectedRelationships", "quarantinedRows"
  ]);
  for (const key of [
    "importedPois", "importedSegments", "importedRelations", "projectedEntities",
    "projectedAssertions", "projectedRelationships"
  ]) {
    if (!Number.isInteger(value[key]) || value[key] <= 0 || value[key] > 10_000_000) {
      invalidStagingReadinessV1("region_row_totals_empty_or_unbounded");
    }
  }
  if (!Number.isInteger(value.quarantinedRows) || value.quarantinedRows < 0 ||
      value.quarantinedRows > 1_000_000) {
    invalidStagingReadinessV1("region_row_totals_empty_or_unbounded");
  }
}

function validatePerformance(value, context) {
  exactKeys(value, ["policy", "observations", "cancellation", "evidenceSha256"]);
  exactKeys(value.policy, [
    "statementTimeoutMilliseconds", "routeMembershipP95Milliseconds",
    "reviewedMeasurementMaximumMilliseconds", "postgisMinimumVersion"
  ]);
  if (value.policy.statementTimeoutMilliseconds !== 2_500 ||
      value.policy.routeMembershipP95Milliseconds !== 1_500 ||
      value.policy.reviewedMeasurementMaximumMilliseconds !== 2_000 ||
      value.policy.postgisMinimumVersion !== "3.2") {
    invalidStagingReadinessV1("performance_policy_changed");
  }
  assertExactOrderedIds(value.observations, CANONICAL_PERFORMANCE_OPERATIONS, "operationId");
  value.observations.forEach((observation) => {
    exactKeys(observation, [
      "operationId", "sampleCount", "minimumMilliseconds", "medianMilliseconds",
      "p95Milliseconds", "maximumMilliseconds", "expectedRowCount", "indexUsed",
      "indexNameDigest", "projectionEntitySequentialScan", "observedAt",
      "evidenceSha256"
    ]);
    if (!Number.isInteger(observation.sampleCount) || observation.sampleCount < 5 ||
        observation.sampleCount > 100 || !orderedFinite([
          observation.minimumMilliseconds,
          observation.medianMilliseconds,
          observation.p95Milliseconds,
          observation.maximumMilliseconds
        ]) || observation.maximumMilliseconds >= 2_000 ||
        (observation.operationId === "route_membership_query" &&
          observation.p95Milliseconds >= 1_500) ||
        !Number.isInteger(observation.expectedRowCount) ||
        observation.expectedRowCount <= 0 || observation.expectedRowCount > 2_000 ||
        observation.indexUsed !== true ||
        observation.projectionEntitySequentialScan !== false) {
      invalidStagingReadinessV1("performance_gate_failed");
    }
    assertDigest(observation.indexNameDigest);
    assertDigest(observation.evidenceSha256);
    assertObservationClock(observation.observedAt, context);
  });
  exactKeys(value.cancellation, [
    "attempted", "cancelled", "rollbacksSucceeded", "poolRecovered",
    "waitingClients", "lateResults", "observedAt", "evidenceSha256"
  ]);
  if (value.cancellation.attempted !== 3 || value.cancellation.cancelled !== 3 ||
      value.cancellation.rollbacksSucceeded !== 3 ||
      value.cancellation.poolRecovered !== true ||
      value.cancellation.waitingClients !== 0 || value.cancellation.lateResults !== 0) {
    invalidStagingReadinessV1("cancellation_pool_recovery_failed");
  }
  assertDigest(value.cancellation.evidenceSha256);
  assertObservationClock(value.cancellation.observedAt, context);
  assertDigest(value.evidenceSha256);
}

function validateBackupRestore(value, context) {
  exactKeys(value, [
    "policyOwnerDecisionDigest", "maximumEvidenceAgeSeconds", "backupIdentityDigest",
    "restoreIdentityDigest", "sourceDatabaseInstanceDigest",
    "restoreDatabaseInstanceDigest", "backupCompletedAt", "restoreStartedAt",
    "restoreCompletedAt", "observedAt", "configured", "restoreSucceeded", "fresh",
    "reconciliations", "evidenceSha256"
  ]);
  for (const key of [
    "policyOwnerDecisionDigest", "backupIdentityDigest", "restoreIdentityDigest",
    "sourceDatabaseInstanceDigest", "restoreDatabaseInstanceDigest", "evidenceSha256"
  ]) assertDigest(value[key]);
  if (!Number.isInteger(value.maximumEvidenceAgeSeconds) ||
      value.maximumEvidenceAgeSeconds < 60 ||
      value.maximumEvidenceAgeSeconds > 31 * 86_400 ||
      value.backupIdentityDigest === value.restoreIdentityDigest ||
      value.sourceDatabaseInstanceDigest === value.restoreDatabaseInstanceDigest ||
      value.configured !== true || value.restoreSucceeded !== true || value.fresh !== true) {
    invalidStagingReadinessV1("backup_restore_identity_or_policy_invalid");
  }
  const backup = assertObservationClock(value.backupCompletedAt, context);
  const restoreStart = assertObservationClock(value.restoreStartedAt, context);
  const restoreEnd = assertObservationClock(value.restoreCompletedAt, context);
  const observed = assertObservationClock(value.observedAt, context);
  if (!(backup <= restoreStart && restoreStart <= restoreEnd && restoreEnd <= observed) ||
      context.proofAsOfMs - restoreEnd > value.maximumEvidenceAgeSeconds * 1_000) {
    invalidStagingReadinessV1("backup_restore_stale_or_impossible");
  }
  assertExactOrderedIds(value.reconciliations, CANONICAL_RESTORE_RECONCILIATIONS);
  value.reconciliations.forEach((item) => {
    exactKeys(item, ["id", "passed", "evidenceSha256"]);
    if (item.passed !== true) invalidStagingReadinessV1("restore_reconciliation_failed");
    assertDigest(item.evidenceSha256);
  });
}

function validateRuntimeOperations(value, context) {
  exactKeys(value, [
    "https", "liveness", "readiness", "preflight", "drain", "restart", "rollback",
    "evidenceSha256"
  ]);
  validateHttps(value.https, context);
  validateLiveness(value.liveness, context);
  validateReadiness(value.readiness, context);
  validatePreflight(value.preflight, context);
  validateDrain(value.drain, context);
  validateRestart(value.restart, context);
  validateRollback(value.rollback, context);
  assertDigest(value.evidenceSha256);
}

function validateHttps(value, context) {
  exactKeys(value, [
    "certificateDigest", "originDigest", "validFrom", "validTo", "tlsProtocol",
    "chainValid", "hostnameVerified", "observedAt", "evidenceSha256"
  ]);
  assertDigest(value.certificateDigest);
  assertDigest(value.originDigest);
  assertDigest(value.evidenceSha256);
  const validFrom = timestampMilliseconds(value.validFrom);
  const validTo = timestampMilliseconds(value.validTo);
  const observed = assertObservationClock(value.observedAt, context);
  if (value.tlsProtocol !== "TLSv1.3" || value.chainValid !== true ||
      value.hostnameVerified !== true || !(validFrom <= observed && observed < validTo)) {
    invalidStagingReadinessV1("https_certificate_invalid");
  }
}

function validateLiveness(value, context) {
  exactKeys(value, [
    "statusCode", "state", "dependencyWorkCount", "sensitiveDetailsExposed",
    "observedAt", "evidenceSha256"
  ]);
  if (value.statusCode !== 200 || value.state !== "live" ||
      value.dependencyWorkCount !== 0 || value.sensitiveDetailsExposed !== false) {
    invalidStagingReadinessV1("liveness_contract_invalid");
  }
  assertDigest(value.evidenceSha256);
  assertObservationClock(value.observedAt, context);
}

function validateReadiness(value, context) {
  exactKeys(value, [
    "statusCode", "state", "requiredDatabaseReady", "optionalMonitoringReady",
    "sensitiveDetailsExposed", "observedAt", "evidenceSha256"
  ]);
  if (value.statusCode !== 200 || value.state !== "ready" ||
      value.requiredDatabaseReady !== true || value.optionalMonitoringReady !== true ||
      value.sensitiveDetailsExposed !== false) {
    invalidStagingReadinessV1("readiness_contract_invalid");
  }
  assertDigest(value.evidenceSha256);
  assertObservationClock(value.observedAt, context);
}

function validatePreflight(value, context) {
  exactKeys(value, [
    "decision", "nodeEnvironment", "releaseStage", "allControlledFlagsExact",
    "missingRequiredConfiguration", "sensitiveDetailsExposed", "candidateBindingSha256",
    "observedAt", "evidenceSha256"
  ]);
  if (value.decision !== "ready" || value.nodeEnvironment !== "production" ||
      value.releaseStage !== "staging" || value.allControlledFlagsExact !== true ||
      value.missingRequiredConfiguration !== false ||
      value.sensitiveDetailsExposed !== false ||
      value.candidateBindingSha256 !== context.candidateBindingSha256) {
    invalidStagingReadinessV1("startup_preflight_invalid");
  }
  assertDigest(value.evidenceSha256);
  assertObservationClock(value.observedAt, context);
}

function validateDrain(value, context) {
  exactKeys(value, [
    "acceptingAfterDrainStarted", "lateWorkAccepted", "inFlightWorkSettled",
    "poolsClosed", "deadlineExceeded", "observedAt", "evidenceSha256"
  ]);
  if (value.acceptingAfterDrainStarted !== false || value.lateWorkAccepted !== 0 ||
      value.inFlightWorkSettled !== true || value.poolsClosed !== true ||
      value.deadlineExceeded !== false) {
    invalidStagingReadinessV1("graceful_drain_failed");
  }
  assertDigest(value.evidenceSha256);
  assertObservationClock(value.observedAt, context);
}

function validateRestart(value, context) {
  exactKeys(value, [
    "preRestartRevisionDigest", "postRestartRevisionDigest", "readinessRecovered",
    "inFlightLeakCount", "observedAt", "evidenceSha256"
  ]);
  assertDigest(value.preRestartRevisionDigest);
  assertDigest(value.postRestartRevisionDigest);
  assertDigest(value.evidenceSha256);
  if (value.preRestartRevisionDigest !== value.postRestartRevisionDigest ||
      value.readinessRecovered !== true || value.inFlightLeakCount !== 0) {
    invalidStagingReadinessV1("restart_recovery_failed");
  }
  assertObservationClock(value.observedAt, context);
}

function validateRollback(value, context) {
  exactKeys(value, [
    "candidateRevisionDigest", "rollbackTargetRevisionDigest", "rolledBackRevisionDigest",
    "finalRevisionDigest", "rollbackTargetKnownGood", "rollbackReadinessPassed",
    "rollForwardSucceeded", "observedAt", "evidenceSha256"
  ]);
  for (const key of [
    "candidateRevisionDigest", "rollbackTargetRevisionDigest", "rolledBackRevisionDigest",
    "finalRevisionDigest", "evidenceSha256"
  ]) assertDigest(value[key]);
  if (value.rollbackTargetRevisionDigest === value.candidateRevisionDigest ||
      value.rolledBackRevisionDigest !== value.rollbackTargetRevisionDigest ||
      value.finalRevisionDigest !== value.candidateRevisionDigest ||
      value.rollbackTargetKnownGood !== true || value.rollbackReadinessPassed !== true ||
      value.rollForwardSucceeded !== true) {
    invalidStagingReadinessV1("deployment_rollback_failed");
  }
  assertObservationClock(value.observedAt, context);
}

function validateMonitoring(value, context) {
  exactKeys(value, [
    "policyOwnerDecisionDigest", "maximumAlertTestAgeSeconds", "sinkConfigDigest",
    "dashboardConfigDigest", "retentionPolicyDigest", "accessPolicyDigest",
    "privacySchemaDigest", "forbiddenSignalCount", "alerts", "observedAt",
    "evidenceSha256"
  ]);
  for (const key of [
    "policyOwnerDecisionDigest", "sinkConfigDigest", "dashboardConfigDigest",
    "retentionPolicyDigest", "accessPolicyDigest", "privacySchemaDigest", "evidenceSha256"
  ]) assertDigest(value[key]);
  if (!Number.isInteger(value.maximumAlertTestAgeSeconds) ||
      value.maximumAlertTestAgeSeconds < 60 ||
      value.maximumAlertTestAgeSeconds > 31 * 86_400 ||
      value.forbiddenSignalCount !== 0) {
    invalidStagingReadinessV1("monitoring_policy_invalid");
  }
  assertExactOrderedIds(value.alerts, CANONICAL_ALERT_IDS);
  value.alerts.forEach((alert) => {
    exactKeys(alert, [
      "id", "enabled", "testPassed", "signalCount", "lastTestedAt",
      "deliveryDigest", "evidenceSha256"
    ]);
    const tested = assertObservationClock(alert.lastTestedAt, context);
    if (alert.enabled !== true || alert.testPassed !== true ||
        !Number.isInteger(alert.signalCount) || alert.signalCount <= 0 ||
        alert.signalCount > 100 ||
        context.proofAsOfMs - tested > value.maximumAlertTestAgeSeconds * 1_000) {
      invalidStagingReadinessV1("alert_missing_disabled_or_stale");
    }
    assertDigest(alert.deliveryDigest);
    assertDigest(alert.evidenceSha256);
  });
  assertObservationClock(value.observedAt, context);
}

function validateOutages(value, context) {
  assertExactOrderedIds(value, CANONICAL_OUTAGE_IDS);
  value.forEach((outage) => {
    exactKeys(outage, [
      "id", "dependencyClass", "inducedAt", "recoveredAt", "resultCode",
      "livenessState", "readinessDuringOutage", "readinessAfterRecovery",
      "providerCalls", "authorizationWork", "budgetWork", "leaseWork", "circuitWork",
      "rollbackPassed", "poolRecovered", "sensitiveDetailsExposed", "evidenceSha256"
    ]);
    const induced = assertObservationClock(outage.inducedAt, context);
    const recovered = assertObservationClock(outage.recoveredAt, context);
    if (recovered < induced || outage.providerCalls !== 0 ||
        outage.authorizationWork !== 0 || outage.budgetWork !== 0 ||
        outage.leaseWork !== 0 || outage.circuitWork !== 0 ||
        outage.rollbackPassed !== true || outage.poolRecovered !== true ||
        outage.sensitiveDetailsExposed !== false || outage.livenessState !== "live" ||
        outage.readinessAfterRecovery !== "ready") {
      invalidStagingReadinessV1("dependency_outage_not_fail_closed");
    }
    if (outage.id === "monitoring_unavailable") {
      if (outage.dependencyClass !== "optional" ||
          outage.readinessDuringOutage !== "ready_degraded") {
        invalidStagingReadinessV1("optional_dependency_semantics_invalid");
      }
    } else if (outage.dependencyClass !== "required" ||
        outage.readinessDuringOutage !== "not_ready") {
      invalidStagingReadinessV1("readiness_green_during_required_outage");
    }
    assertSafeIdentifier(outage.resultCode);
    assertDigest(outage.evidenceSha256);
  });
}

function validateFeatureFlags(value, context) {
  exactKeys(value, [
    "matrixSourceSha256", "observationScope", "allDeployedValuesObserved",
    "allEffectiveValuesFalse", "flags", "observedAt", "evidenceSha256"
  ]);
  assertDigest(value.matrixSourceSha256);
  assertDigest(value.evidenceSha256);
  assertExactOrderedIds(value.flags, CANONICAL_FLAG_BINDINGS.map(([id]) => id));
  value.flags.forEach((flag, index) => {
    exactKeys(flag, [
      "id", "key", "sourceDeclaredDefault", "deployedObservedValue",
      "effectiveValue", "verified", "evidenceSha256"
    ]);
    const [id, key] = CANONICAL_FLAG_BINDINGS[index];
    if (flag.id !== id || flag.key !== key || flag.sourceDeclaredDefault !== false) {
      invalidStagingReadinessV1("feature_flag_matrix_mismatch");
    }
    assertDigest(flag.evidenceSha256);
    if (context.evidenceMode === "live_staging" &&
        (flag.deployedObservedValue !== false || flag.effectiveValue !== false ||
          flag.verified !== true)) {
      invalidStagingReadinessV1("feature_flag_not_exact_false");
    }
  });
  if (context.evidenceMode === "live_staging") {
    if (value.observationScope !== "independent_live_staging" ||
        value.allDeployedValuesObserved !== true ||
        value.allEffectiveValuesFalse !== true) {
      invalidStagingReadinessV1("feature_flags_not_live_verified_false");
    }
    assertObservationClock(value.observedAt, context);
  } else if (value.observationScope !== "repository_contract_only" ||
      value.allDeployedValuesObserved !== false ||
      value.allEffectiveValuesFalse !== false || value.observedAt !== null ||
      value.flags.some((flag) => flag.deployedObservedValue !== null ||
        flag.effectiveValue !== null || flag.verified !== false)) {
    invalidStagingReadinessV1("offline_feature_flag_claim_invalid");
  }
}

function validateProviderAccounting(value) {
  exactKeys(value, [
    "hardCallCeiling", "authorized", "attempted", "successful", "failed",
    "timedOut", "cancelled", "credentialAdmitted", "egressAdmitted",
    "authorizationWork", "databaseWork", "budgetWork", "leaseWork", "circuitWork",
    "providerWork", "snapshots", "evidenceSha256"
  ]);
  const zeroKeys = [
    "hardCallCeiling", "authorized", "attempted", "successful", "failed",
    "timedOut", "cancelled", "authorizationWork", "databaseWork", "budgetWork",
    "leaseWork", "circuitWork", "providerWork"
  ];
  if (zeroKeys.some((key) => value[key] !== 0) ||
      value.credentialAdmitted !== false || value.egressAdmitted !== false) {
    invalidStagingReadinessV1("provider_accounting_nonzero");
  }
  assertExactOrderedIds(value.snapshots, ["before", "during", "after"]);
  value.snapshots.forEach((snapshot) => {
    exactKeys(snapshot, ["id", "attempted", "providerWork", "evidenceSha256"]);
    if (snapshot.attempted !== 0 || snapshot.providerWork !== 0) {
      invalidStagingReadinessV1("provider_accounting_nonzero");
    }
    assertDigest(snapshot.evidenceSha256);
  });
  assertDigest(value.evidenceSha256);
}

function validatePrivacy(value) {
  exactKeys(value, [
    "scanVersion", "artifactCount", "maximumArtifactBytes", "scannedBytes",
    "forbiddenKeyMatches", "secretPatternMatches", "rawUrlMatches",
    "exactCoordinateMatches", "routeGeometryMatches", "appAttestMaterialMatches",
    "secretBearingErrorMatches", "passed", "evidenceSha256"
  ]);
  if (value.scanVersion !== "staging-readiness-privacy-scan-v1" ||
      !Number.isInteger(value.artifactCount) || value.artifactCount <= 0 ||
      value.artifactCount > 128 || !Number.isInteger(value.maximumArtifactBytes) ||
      value.maximumArtifactBytes <= 0 || value.maximumArtifactBytes > 524_288 ||
      !Number.isInteger(value.scannedBytes) || value.scannedBytes <= 0 ||
      value.scannedBytes > value.maximumArtifactBytes * value.artifactCount ||
      [
        value.forbiddenKeyMatches, value.secretPatternMatches, value.rawUrlMatches,
        value.exactCoordinateMatches, value.routeGeometryMatches,
        value.appAttestMaterialMatches, value.secretBearingErrorMatches
      ].some((count) => count !== 0) || value.passed !== true) {
    invalidStagingReadinessV1("privacy_redaction_scan_failed");
  }
  assertDigest(value.evidenceSha256);
}

function validateCleanup(value, context) {
  exactKeys(value, [
    "attempted", "completedAt", "flagsAllFalse", "poolsClosed", "leasesRemaining",
    "temporaryResourcesCreated", "temporaryResourcesRemoved",
    "proofProcessesRemaining", "listenersRemaining", "credentialAccessRemoved",
    "residualResourceDigests", "immutableEvidenceRetained", "evidenceSha256"
  ]);
  assertBoundedArray(value.residualResourceDigests, 32);
  value.residualResourceDigests.forEach((digest) => assertDigest(digest));
  if (value.attempted !== true || value.flagsAllFalse !== true ||
      value.poolsClosed !== true || value.leasesRemaining !== 0 ||
      !Number.isInteger(value.temporaryResourcesCreated) ||
      value.temporaryResourcesCreated < 0 ||
      value.temporaryResourcesCreated !== value.temporaryResourcesRemoved ||
      value.proofProcessesRemaining !== 0 || value.listenersRemaining !== 0 ||
      value.credentialAccessRemoved !== true ||
      value.residualResourceDigests.length !== 0 ||
      value.immutableEvidenceRetained !== true) {
    invalidStagingReadinessV1("cleanup_incomplete_or_forged");
  }
  assertObservationClock(value.completedAt, context);
  assertDigest(value.evidenceSha256);
}

function validateCrossBindings(observations, context) {
  if (observations.environment.httpsOriginDigest !==
        observations.runtimeOperations.https.originDigest ||
      observations.environment.supabaseProjectRefDigest !==
        observations.database.supabaseProjectRefDigest ||
      observations.environment.databaseInstanceDigest !==
        observations.database.databaseInstanceDigest ||
      observations.environment.supabaseRegion !== observations.database.supabaseRegion ||
      observations.runtime.deploymentRevisionDigest !==
        observations.runtimeOperations.rollback.candidateRevisionDigest ||
      observations.runtime.deploymentRevisionDigest !==
        observations.runtimeOperations.restart.preRestartRevisionDigest ||
      observations.database.databaseInstanceDigest !==
        observations.backupRestore.sourceDatabaseInstanceDigest ||
      new Set([
        observations.environment.httpsOriginDigest,
        observations.environment.supabaseProjectRefDigest,
        observations.environment.databaseInstanceDigest,
        observations.environment.productionHttpsOriginDigest,
        observations.environment.productionSupabaseProjectRefDigest,
        observations.environment.productionDatabaseInstanceDigest
      ]).has(observations.backupRestore.restoreDatabaseInstanceDigest)) {
    invalidStagingReadinessV1("observation_candidate_binding_mismatch");
  }
  const binding = candidateBinding(observations, context);
  if (binding !== context.candidateBindingSha256) {
    invalidStagingReadinessV1("candidate_binding_digest_mismatch");
  }
  validateObservationWindow(observations, context);
}

function validateObservationWindow(observations, context) {
  const preflight = timestampMilliseconds(
    observations.environment.preflightObservedAt
  );
  const postflight = timestampMilliseconds(
    observations.environment.postflightObservedAt
  );
  if (!Number.isInteger(context.maximumReceiptAgeSeconds) ||
      postflight - preflight > context.maximumReceiptAgeSeconds * 1_000 ||
      preflight < context.proofAsOfMs - context.maximumReceiptAgeSeconds * 1_000) {
    invalidStagingReadinessV1("candidate_binding_window_too_large");
  }
  const timestamps = [
    observations.runtime.observedAt,
    observations.database.observedAt,
    observations.migrations.firstRun.startedAt,
    observations.migrations.secondRun.completedAt,
    observations.roles.observedAt,
    ...observations.regions.map((region) => region.observedAt),
    ...observations.performance.observations.map((item) => item.observedAt),
    observations.performance.cancellation.observedAt,
    observations.backupRestore.backupCompletedAt,
    observations.backupRestore.observedAt,
    observations.runtimeOperations.https.observedAt,
    observations.runtimeOperations.liveness.observedAt,
    observations.runtimeOperations.readiness.observedAt,
    observations.runtimeOperations.preflight.observedAt,
    observations.runtimeOperations.drain.observedAt,
    observations.runtimeOperations.restart.observedAt,
    observations.runtimeOperations.rollback.observedAt,
    observations.monitoring.observedAt,
    ...observations.monitoring.alerts.map((alert) => alert.lastTestedAt),
    ...observations.outages.flatMap((outage) => [outage.inducedAt, outage.recoveredAt]),
    observations.featureFlags.observedAt,
    observations.cleanup.completedAt
  ];
  if (timestamps.some((value) => {
    const milliseconds = timestampMilliseconds(value);
    return milliseconds < preflight || milliseconds > postflight ||
      milliseconds > context.proofAsOfMs;
  })) {
    invalidStagingReadinessV1("observation_outside_candidate_binding_window");
  }
}

export function stagingReadinessCandidateBindingRecordV1(observations, candidate) {
  return {
    candidateCommit: candidate.candidateCommit,
    treeDigest: candidate.treeDigest,
    imageDigest: observations.runtime.imageDigest,
    deploymentRevisionDigest: observations.runtime.deploymentRevisionDigest,
    httpsOriginDigest: observations.environment.httpsOriginDigest,
    supabaseProjectRefDigest: observations.environment.supabaseProjectRefDigest,
    databaseInstanceDigest: observations.database.databaseInstanceDigest,
    supabaseRegion: observations.database.supabaseRegion,
    roleContractDigest: observations.roles.roleContractDigest,
    roleSetDigest: observations.roles.roleSetDigest,
    grantDigest: observations.roles.grantDigest,
    cancellationRoleIdentityDigest: observations.roles.cancellationRoleDigest,
    cancellationPrivilegeManifestDigest:
      observations.roles.cancellationPrivilegeManifestDigest
  };
}

function candidateBinding(observations, context) {
  return context.sha256(stagingReadinessCandidateBindingRecordV1(
    observations,
    context.candidate
  ));
}

function assertObservationClock(value, context) {
  const milliseconds = timestampMilliseconds(value);
  if (milliseconds > context.proofAsOfMs || milliseconds > context.trustedNowMs + 300_000) {
    invalidStagingReadinessV1("observation_clock_outside_proof_window");
  }
  return milliseconds;
}

function assertVersion(value) {
  if (typeof value !== "string" || !/^\d{1,2}\.\d{1,2}(?:\.\d{1,3})?$/.test(value)) {
    invalidStagingReadinessV1("database_version_invalid");
  }
}

function orderedFinite(values) {
  return values.every((value) => Number.isFinite(value) && value >= 0 && value < 60_000) &&
    values.every((value, index) => index === 0 || values[index - 1] <= value);
}
