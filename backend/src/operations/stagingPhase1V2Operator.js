import { createHash } from "node:crypto";
import {
  issueStagingPhase1V2MigrationCapability
} from "./stagingMigrationCapability.js";
import {
  SUPABASE_POSTGIS_ISOLATION_MIGRATIONS_V2
} from "./stagingMigrationPolicy.js";

export const STAGING_PHASE1_V2_TARGET = deepFreeze({
  projectRef: "mbvzwsrtqcrwhvykugcd",
  projectName: "TrailMind Outdoor Staging V1",
  organizationId: "wbnftkftyamxzvxsftda",
  region: "eu-central-1",
  status: "ACTIVE_HEALTHY",
  organizationPlan: "free",
  computeSize: "nano",
  monthlyCost: Object.freeze({ currency: "USD", amount: 0 })
});

export const STAGING_PHASE1_V2_POLICY_ID =
  "supabase-postgis-isolation-v2";
export const STAGING_PHASE1_V2_MAXIMUM_OBSERVATION_AGE_MILLISECONDS =
  5 * 60 * 1_000;
export const STAGING_PHASE1_V2_LOCK_KEY =
  "trailmind-phase-1-foundation";

const MAXIMUM_PHASE_EVIDENCE_BYTES = 32 * 1024;
const MAXIMUM_DURABLE_RECEIPT_BYTES = 64 * 1024;
const DENIED_PROJECTS = Object.freeze([
  Object.freeze({ ref: "bejvhhjbgtvctpsnlwid", kind: "production" }),
  Object.freeze({ ref: "cmkvbxppgofteoutfslp", kind: "planua" })
]);
const DENIED_PROJECT_REFS = new Set(DENIED_PROJECTS.map(({ ref }) => ref));
const RESERVED_SCHEMAS = new Set([
  "trailmind_app",
  "trailmind_control",
  "trailmind_gis",
  "trailmind_phase1_guard"
]);
const FLAG_NAMES = Object.freeze([
  "OUTDOOR_EVIDENCE_ENABLED",
  "RESEARCH_GUIDED_PLANNING_ENABLED",
  "ROUTABLE_HIGHLIGHT_ACCESS_ENABLED",
  "OUTDOOR_EVIDENCE_PROVIDER_ENABLED",
  "OUTDOOR_RESEARCH_PLANNING_ENABLED",
  "OUTDOOR_ROUTABLE_HIGHLIGHT_ACCESS_ENABLED",
  "ROUTE_PROVIDER_ENABLED",
  "INTENT_PROVIDER_ENABLED",
  "OUTDOOR_RESEARCH_PLANNING_ALLOW_INSECURE_LOCAL",
  "ROUTE_ALLOW_INSECURE_LOCAL_ROUTING",
  "INTENT_ALLOW_INSECURE_LOCAL_PARSING",
  "APP_ATTEST_ALLOW_IN_MEMORY",
  "INTENT_ALLOW_DETERMINISTIC_MOCK"
]);
const RUNTIME_FUNCTIONS = Object.freeze([
  "trailmind_runtime_outdoor_research_snapshot_context_v1",
  "trailmind_runtime_outdoor_research_highlights_v1",
  "trailmind_runtime_outdoor_research_route_memberships_v1",
  "trailmind_runtime_outdoor_research_route_assertions_v1",
  "trailmind_runtime_outdoor_research_trail_access_candidates_v1"
].sort());

export async function runStagingPhase1V2Operator({
  controlPlane,
  database,
  executor,
  containment,
  receiptStore,
  approval,
  now = () => new Date()
}) {
  requireDependency(controlPlane, "inspectPre", "control_plane_pre");
  requireDependency(controlPlane, "inspectPostAdvisors", "post_advisors");
  requireDependency(controlPlane, "inspectFinal", "control_plane_final");
  requireDependency(database, "inspectPre", "database_pre");
  requireDependency(database, "withFoundationLock", "database_lock");
  requireDependency(database, "inspectFailure", "database_failure");
  requireDependency(database, "inspectFinal", "database_final");
  requireDependency(executor, "commitPreStep", "pre_step");
  requireDependency(executor, "runMigrations", "migration_runner");
  requireDependency(executor, "commitPostStep", "post_step");
  requireDependency(executor, "compensatePreLedger", "compensation");
  requireDependency(containment, "securePostCommitFailure", "containment");
  requireDependency(receiptStore, "persist", "receipt_store");
  assertApproval(approval);

  const observedAt = exactDate(now());
  const controlSnapshot = await controlPlane.inspectPre({
    projectRef: STAGING_PHASE1_V2_TARGET.projectRef,
    readOnly: true
  });
  assertControlPlaneSnapshot(controlSnapshot, observedAt);
  const unlockedDatabaseSnapshot = await database.inspectPre({
    stage: "unlocked",
    readOnly: true
  });
  assertDatabaseSnapshot(
    controlSnapshot,
    unlockedDatabaseSnapshot,
    approval
  );
  const phaseEvidence = [derivedPhaseEvidence(
    "initial-unlocked-admission",
    1,
    "admitted",
    { controlSnapshot, databaseSnapshot: unlockedDatabaseSnapshot }
  )];

  return database.withFoundationLock({
    key: STAGING_PHASE1_V2_LOCK_KEY,
    wait: false
  }, async (lock) => {
    if (!isObject(lock) || lock.acquired !== true) {
      throw operatorError("concurrent_writer");
    }
    phaseEvidence.push(derivedPhaseEvidence(
      "nonwaiting-lock-acquisition",
      2,
      "acquired",
      { key: STAGING_PHASE1_V2_LOCK_KEY, wait: false }
    ));

    const lockedDatabaseSnapshot = await database.inspectPre({
      stage: "locked",
      readOnly: true,
      lock
    });
    assertDatabaseSnapshot(controlSnapshot, lockedDatabaseSnapshot, approval);
    if (
      lockedDatabaseSnapshot.stateDigest !==
        unlockedDatabaseSnapshot.stateDigest ||
      lockedDatabaseSnapshot.providerAclRestorePlanDigest !==
        unlockedDatabaseSnapshot.providerAclRestorePlanDigest
    ) throw operatorError("prestate_changed_before_lock");
    phaseEvidence.push(derivedPhaseEvidence(
      "locked-state-reinspection",
      3,
      "admitted",
      { databaseSnapshot: lockedDatabaseSnapshot }
    ));

    let attemptedPhase = "before-pre-step";
    try {
      attemptedPhase = "pre-step";
      const preStep = await executor.commitPreStep({ lock });
      assertPhaseEvidence(preStep, {
        phase: "v2-pre-step",
        ordinal: 4,
        status: "committed",
        fields: {
          applicationLedgerExists: false,
          applicationMigrationCount: 0,
          applicationFoundationExists: false
        }
      });
      phaseEvidence.push(preStep);

      attemptedPhase = "first-migration-run";
      const firstContext = issueStagingPhase1V2MigrationCapability({
        projectRef: STAGING_PHASE1_V2_TARGET.projectRef,
        policyId: STAGING_PHASE1_V2_POLICY_ID,
        purpose: "apply",
        now
      });
      const firstRun = await executor.runMigrations({
        lock,
        policyId: STAGING_PHASE1_V2_POLICY_ID,
        migrations: [...SUPABASE_POSTGIS_ISOLATION_MIGRATIONS_V2],
        operatorContext: firstContext,
        runKind: "apply"
      });
      assertMigrationPhase(firstRun, {
        phase: "first-migration-run",
        ordinal: 5,
        status: "committed",
        appliedMigrations: SUPABASE_POSTGIS_ISOLATION_MIGRATIONS_V2
      });
      phaseEvidence.push(firstRun);

      attemptedPhase = "second-migration-run";
      const noOpContext = issueStagingPhase1V2MigrationCapability({
        projectRef: STAGING_PHASE1_V2_TARGET.projectRef,
        policyId: STAGING_PHASE1_V2_POLICY_ID,
        purpose: "verify-noop",
        now
      });
      const secondRun = await executor.runMigrations({
        lock,
        policyId: STAGING_PHASE1_V2_POLICY_ID,
        migrations: [...SUPABASE_POSTGIS_ISOLATION_MIGRATIONS_V2],
        operatorContext: noOpContext,
        runKind: "verify-noop"
      });
      assertMigrationPhase(secondRun, {
        phase: "second-migration-run",
        ordinal: 6,
        status: "no-op",
        appliedMigrations: []
      });
      if (secondRun.stdoutBytes !== 0) {
        throw operatorError("second_migration_run_emitted_output");
      }
      phaseEvidence.push(secondRun);

      attemptedPhase = "post-step";
      const postStep = await executor.commitPostStep({ lock });
      assertPhaseEvidence(postStep, {
        phase: "v2-post-step",
        ordinal: 7,
        status: "committed",
        fields: {
          ledgerMigrationCount: 8,
          runtimeFunctionCount: 5
        }
      });
      phaseEvidence.push(postStep);

      attemptedPhase = "post-advisors";
      const postAdvisors = await controlPlane.inspectPostAdvisors({
        projectRef: STAGING_PHASE1_V2_TARGET.projectRef,
        readOnly: true,
        lock
      });
      assertPostAdvisorEvidence(postAdvisors, exactDate(now()));
      phaseEvidence.push(postAdvisors);

      attemptedPhase = "final-reinspection";
      const finalControlSnapshot = await controlPlane.inspectFinal({
        projectRef: STAGING_PHASE1_V2_TARGET.projectRef,
        readOnly: true,
        lock
      });
      assertControlPlaneSnapshot(finalControlSnapshot, exactDate(now()));
      const finalDatabaseSnapshot = await database.inspectFinal({
        readOnly: true,
        lock
      });
      assertFinalDatabaseSnapshot(finalDatabaseSnapshot);
      const finalEvidence = derivedPhaseEvidence(
        "final-containment-reinspection",
        9,
        "admitted",
        {
          controlSnapshot: finalControlSnapshot,
          databaseSnapshot: finalDatabaseSnapshot
        }
      );
      phaseEvidence.push(finalEvidence);

      attemptedPhase = "durable-receipt";
      assertUniquePhaseEvidence(phaseEvidence);
      const receiptPayload = deepFreeze({
        schemaVersion: 1,
        status: "committed",
        projectRef: STAGING_PHASE1_V2_TARGET.projectRef,
        organizationId: STAGING_PHASE1_V2_TARGET.organizationId,
        region: STAGING_PHASE1_V2_TARGET.region,
        policyId: STAGING_PHASE1_V2_POLICY_ID,
        migrations: [...SUPABASE_POSTGIS_ISOLATION_MIGRATIONS_V2],
        providerAclRestorePlanDigest:
          approval.providerAclRestorePlanDigest,
        initialDatabaseStateDigest: lockedDatabaseSnapshot.stateDigest,
        finalDatabaseStateDigest: finalDatabaseSnapshot.stateDigest,
        controlObservedAt: controlSnapshot.observedAt,
        completedAt: exactDate(now()).toISOString(),
        featureFlagCount: FLAG_NAMES.length,
        featureFlagsAllFalse: true,
        protectedProjectMutationCount: 0,
        phaseEvidence: phaseEvidence.map(({ phase, ordinal, status, evidenceDigest }) =>
          ({ phase, ordinal, status, evidenceDigest }))
      });
      assertSanitizedReceipt(receiptPayload);
      const receiptBytes = byteLength(receiptPayload);
      if (receiptBytes > MAXIMUM_DURABLE_RECEIPT_BYTES) {
        throw operatorError("durable_receipt_oversized");
      }
      const receiptDigest = canonicalAclDigest(receiptPayload);
      const persisted = await receiptStore.persist({
        receipt: receiptPayload,
        receiptDigest,
        receiptBytes
      });
      assertPhaseEvidence(persisted, {
        phase: "sanitized-durable-receipt",
        ordinal: 10,
        status: "persisted",
        fields: { receiptDigest, receiptBytes }
      });
      assertUniquePhaseEvidence([...phaseEvidence, persisted]);
      return deepFreeze({
        receipt: receiptPayload,
        receiptDigest,
        receiptBytes,
        persistence: persisted
      });
    } catch (error) {
      return handleFailure({
        error,
        attemptedPhase,
        lock,
        database,
        executor,
        containment
      });
    }
  });
}

async function handleFailure({
  error,
  attemptedPhase,
  lock,
  database,
  executor,
  containment
}) {
  let failureState;
  try {
    failureState = await database.inspectFailure({
      readOnly: true,
      lock,
      attemptedPhase
    });
    assertFailureState(failureState);
  } catch {
    if (attemptedPhase === "before-pre-step") throw error;
    await requireContainment(containment, lock, "unknown-after-pre-step-attempt");
    throw classifiedError("unknown-after-pre-step-attempt");
  }

  if (!failureState.preStepCommitted) {
    if (attemptedPhase !== "pre-step") {
      await requireContainment(
        containment,
        lock,
        "inconsistent-failure-state-after-pre-step"
      );
      throw classifiedError("inconsistent-failure-state-after-pre-step");
    }
    throw classifiedError("before-pre-step-commit");
  }
  if (
    !failureState.applicationLedgerExists &&
    failureState.applicationMigrationCount === 0 &&
    !failureState.applicationFoundationExists &&
    !failureState.postStepCommitted
  ) {
    if (![
      "pre-step",
      "first-migration-run"
    ].includes(attemptedPhase)) {
      await requireContainment(
        containment,
        lock,
        "inconsistent-no-ledger-after-migration-phase"
      );
      throw classifiedError("inconsistent-no-ledger-after-migration-phase");
    }
    const classification = attemptedPhase === "first-migration-run"
      ? "migration-transaction-rollback"
      : "pre-step-committed-no-ledger";
    const compensation = await executor.compensatePreLedger({
      lock,
      classification
    });
    assertPhaseEvidence(compensation, {
      phase: "v2-pre-ledger-compensation",
      ordinal: 0,
      status: "compensated",
      fields: {
        exactAclRestored: true,
        providerFixturePreserved: true,
        applicationLedgerExists: false,
        applicationFoundationExists: false
      }
    });
    throw classifiedError(classification);
  }

  await requireContainment(
    containment,
    lock,
    failureState.postStepCommitted
      ? "post-step-or-later-failure"
      : "committed-migration-failure"
  );
  throw classifiedError(
    failureState.postStepCommitted
      ? "post-step-or-later-failure"
      : "committed-migration-failure"
  );
}

async function requireContainment(containment, lock, classification) {
  const result = await containment.securePostCommitFailure({
    lock,
    classification,
    targetRuntimeRole: "outdoor_research_runtime_role"
  });
  assertPhaseEvidence(result, {
    phase: "post-commit-containment",
    ordinal: 0,
    status: "contained",
    fields: {
      runtimeExecuteRevoked: true,
      nonRuntimeSessionsTerminatedCount: 0,
      providerFlagsAllFalse: true,
      importFlagsAllFalse: true,
      deployFlagsAllFalse: true,
      evidencePreserved: true,
      compensationAttempted: false,
      rollbackAttempted: false,
      forwardFixRequired: true
    },
    integerFields: ["affectedRuntimeSessionsTerminatedCount"]
  });
}

export function assertControlPlaneSnapshot(snapshot, now) {
  assertExactKeys(snapshot, [
    "observedAt", "project", "billing", "advisors",
    "expectedDatabaseAclDigest", "protectedProjects", "featureFlags"
  ], "control_plane_snapshot");
  assertFresh(snapshot.observedAt, now, "control_plane");
  assertExactKeys(snapshot.project, [
    "ref", "name", "organizationId", "region", "status"
  ], "control_plane_project");
  const project = snapshot.project;
  if (
    DENIED_PROJECT_REFS.has(project.ref) ||
    project.ref !== STAGING_PHASE1_V2_TARGET.projectRef ||
    project.name !== STAGING_PHASE1_V2_TARGET.projectName ||
    project.organizationId !== STAGING_PHASE1_V2_TARGET.organizationId ||
    project.region !== STAGING_PHASE1_V2_TARGET.region ||
    project.status !== STAGING_PHASE1_V2_TARGET.status
  ) invalid("control_plane_identity");
  assertExactKeys(snapshot.billing, [
    "organizationPlan", "computeSize", "currency", "monthlyCostAmount",
    "nonzeroAddonCount", "observedAt"
  ], "control_plane_billing");
  const billing = snapshot.billing;
  if (
    billing.organizationPlan !== STAGING_PHASE1_V2_TARGET.organizationPlan ||
    billing.computeSize !== STAGING_PHASE1_V2_TARGET.computeSize ||
    billing.currency !== STAGING_PHASE1_V2_TARGET.monthlyCost.currency ||
    billing.monthlyCostAmount !== STAGING_PHASE1_V2_TARGET.monthlyCost.amount ||
    billing.nonzeroAddonCount !== 0
  ) invalid("control_plane_cost");
  assertFresh(billing.observedAt, now, "billing");
  assertExactKeys(snapshot.advisors, ["security", "performance"], "advisors");
  for (const kind of ["security", "performance"]) {
    const advisor = snapshot.advisors[kind];
    assertExactKeys(advisor, [
      "status", "blockingFindingCount", "observedAt"
    ], `${kind}_advisor`);
    if (advisor.status !== "completed" || advisor.blockingFindingCount !== 0) {
      invalid(`${kind}_advisor`);
    }
    assertFresh(advisor.observedAt, now, `${kind}_advisor`);
  }
  if (!isDigest(snapshot.expectedDatabaseAclDigest)) {
    invalid("control_plane_acl_digest");
  }
  assertProtectedProjects(snapshot.protectedProjects);
  assertAllFlagsFalse(snapshot.featureFlags);
  assertBoundedObject(snapshot, "control_plane_snapshot");
}

export function assertDatabaseSnapshot(controlSnapshot, snapshot, approval) {
  assertExactKeys(snapshot, [
    "projectRef", "databaseName", "trailmindRoleCount",
    "trailmindSchemaCount", "trailmindObjectCount", "postgisInstalled",
    "publicPostgisRoutineCount", "siblingWriterSessionCount", "sessionUser",
    "currentUser", "databaseOwner", "extensionsSchemaOwner",
    "sharedAclMutationAuthorized", "extensionsSchemaExists",
    "extensionsPublicUsage", "extensionsPublicCreate",
    "providerAclPrincipalCount", "providerAclRestorePlanDigest",
    "databaseAclDigest", "stateDigest", "dataApiExposedSchemas"
  ], "database_prestate");
  if (
    snapshot.projectRef !== STAGING_PHASE1_V2_TARGET.projectRef ||
    DENIED_PROJECT_REFS.has(snapshot.projectRef) ||
    snapshot.databaseName !== "postgres" ||
    snapshot.trailmindRoleCount !== 0 ||
    snapshot.trailmindSchemaCount !== 0 ||
    snapshot.trailmindObjectCount !== 0 ||
    snapshot.postgisInstalled !== false ||
    snapshot.publicPostgisRoutineCount !== 0 ||
    snapshot.siblingWriterSessionCount !== 0 ||
    snapshot.sessionUser !== "postgres" ||
    snapshot.currentUser !== "postgres" ||
    snapshot.databaseOwner !== "postgres" ||
    snapshot.extensionsSchemaOwner !== "postgres" ||
    snapshot.sharedAclMutationAuthorized !== true ||
    snapshot.extensionsSchemaExists !== true ||
    snapshot.extensionsPublicUsage !== true ||
    snapshot.extensionsPublicCreate !== false ||
    !Number.isInteger(snapshot.providerAclPrincipalCount) ||
    snapshot.providerAclPrincipalCount < 1 ||
    !isDigest(snapshot.providerAclRestorePlanDigest) ||
    snapshot.providerAclRestorePlanDigest !==
      approval.providerAclRestorePlanDigest ||
    snapshot.databaseAclDigest !== controlSnapshot.expectedDatabaseAclDigest ||
    !isDigest(snapshot.stateDigest) ||
    !Array.isArray(snapshot.dataApiExposedSchemas) ||
    snapshot.dataApiExposedSchemas.some((schema) => RESERVED_SCHEMAS.has(schema))
  ) invalid("database_prestate");
  assertBoundedObject(snapshot, "database_prestate");
}

function assertPostAdvisorEvidence(evidence, now) {
  assertPhaseEvidence(evidence, {
    phase: "post-ddl-advisors",
    ordinal: 8,
    status: "acceptable",
    fields: {},
    extraKeys: ["observedAt", "security", "performance"]
  });
  assertFresh(evidence.observedAt, now, "post_advisors");
  for (const kind of ["security", "performance"]) {
    assertExactKeys(evidence[kind], [
      "status", "blockingFindingCount", "noticeCount", "evidenceDigest"
    ], `post_${kind}_advisor`);
    if (
      evidence[kind].status !== "completed" ||
      evidence[kind].blockingFindingCount !== 0 ||
      !Number.isInteger(evidence[kind].noticeCount) ||
      evidence[kind].noticeCount < 0 ||
      !isDigest(evidence[kind].evidenceDigest)
    ) invalid(`post_${kind}_advisor`);
  }
}

function assertFinalDatabaseSnapshot(snapshot) {
  assertExactKeys(snapshot, [
    "projectRef", "databaseName", "sessionUser", "currentUser",
    "databaseOwner", "stateDigest", "policyId", "ledger",
    "roleContractDigest", "aclDigest", "dataApiExposedSchemas",
    "applicationSchemasExposed", "postgisSchema", "postgisOwnerTopology",
    "gisUnexpectedCreatePrincipalCount", "publicPostgisRoutineCount",
    "runtimeExecutableFunctions", "runtimeDirectTablePrivilegeCount",
    "runtimeDirectPostgisRoutineCount", "runtimeDirectSharedRoutineCount",
    "appAttestAdmission", "outdoorRuntimeAdmission", "cancellationAdmission",
    "siblingWriterSessionCount"
  ], "final_database_snapshot");
  if (
    snapshot.projectRef !== STAGING_PHASE1_V2_TARGET.projectRef ||
    snapshot.databaseName !== "postgres" ||
    snapshot.sessionUser !== "postgres" ||
    snapshot.currentUser !== "postgres" ||
    snapshot.databaseOwner !== "postgres" ||
    !isDigest(snapshot.stateDigest) ||
    snapshot.policyId !== STAGING_PHASE1_V2_POLICY_ID ||
    !exactArray(snapshot.ledger, SUPABASE_POSTGIS_ISOLATION_MIGRATIONS_V2) ||
    !isDigest(snapshot.roleContractDigest) ||
    !isDigest(snapshot.aclDigest) ||
    !Array.isArray(snapshot.dataApiExposedSchemas) ||
    snapshot.dataApiExposedSchemas.some((schema) => RESERVED_SCHEMAS.has(schema)) ||
    snapshot.applicationSchemasExposed !== false ||
    snapshot.postgisSchema !== "trailmind_gis" ||
    ![
      "postgres-schema/postgres-extension-members",
      "postgres-schema/supabase_admin-extension-members"
    ].includes(snapshot.postgisOwnerTopology) ||
    snapshot.gisUnexpectedCreatePrincipalCount !== 0 ||
    snapshot.publicPostgisRoutineCount !== 0 ||
    !Array.isArray(snapshot.runtimeExecutableFunctions) ||
    !exactArray([...snapshot.runtimeExecutableFunctions].sort(), RUNTIME_FUNCTIONS) ||
    snapshot.runtimeDirectTablePrivilegeCount !== 0 ||
    snapshot.runtimeDirectPostgisRoutineCount !== 0 ||
    snapshot.runtimeDirectSharedRoutineCount !== 0 ||
    snapshot.appAttestAdmission !== true ||
    snapshot.outdoorRuntimeAdmission !== true ||
    snapshot.cancellationAdmission !== true ||
    snapshot.siblingWriterSessionCount !== 0
  ) invalid("final_database_snapshot");
  assertBoundedObject(snapshot, "final_database_snapshot");
}

function assertFailureState(state) {
  assertPhaseEvidence(state, {
    phase: "failure-state-inspection",
    ordinal: 0,
    status: "inspected",
    fields: {},
    extraKeys: [
      "preStepCommitted", "applicationLedgerExists",
      "applicationMigrationCount", "applicationFoundationExists",
      "postStepCommitted"
    ]
  });
  for (const key of [
    "preStepCommitted", "applicationLedgerExists",
    "applicationFoundationExists", "postStepCommitted"
  ]) if (typeof state[key] !== "boolean") invalid("failure_state");
  if (!Number.isInteger(state.applicationMigrationCount) ||
      state.applicationMigrationCount < 0 ||
      state.applicationMigrationCount > 8) invalid("failure_state");
  if (
    (state.applicationMigrationCount > 0 && !state.applicationLedgerExists) ||
    (state.postStepCommitted && state.applicationMigrationCount !== 8)
  ) invalid("failure_state");
}

function assertMigrationPhase(value, expected) {
  assertPhaseEvidence(value, {
    phase: expected.phase,
    ordinal: expected.ordinal,
    status: expected.status,
    fields: {},
    extraKeys: ["appliedMigrations", "ledger", "stdoutBytes"]
  });
  if (
    !exactArray(value.appliedMigrations, expected.appliedMigrations) ||
    !exactArray(value.ledger, SUPABASE_POSTGIS_ISOLATION_MIGRATIONS_V2) ||
    !Number.isInteger(value.stdoutBytes) || value.stdoutBytes < 0
  ) invalid("migration_phase");
}

function assertPhaseEvidence(value, {
  phase,
  ordinal,
  status,
  fields,
  integerFields = [],
  extraKeys = []
}) {
  assertExactKeys(value, [
    "phase", "ordinal", "status", "evidenceDigest",
    ...Object.keys(fields), ...integerFields, ...extraKeys
  ], `${phase}_evidence`);
  if (
    value.phase !== phase ||
    value.ordinal !== ordinal ||
    value.status !== status ||
    !isDigest(value.evidenceDigest)
  ) invalid(`${phase}_evidence`);
  for (const [key, expected] of Object.entries(fields)) {
    if (value[key] !== expected) invalid(`${phase}_${key}`);
  }
  for (const key of integerFields) {
    if (!Number.isInteger(value[key]) || value[key] < 0) {
      invalid(`${phase}_${key}`);
    }
  }
  assertBoundedObject(value, `${phase}_evidence`);
}

function derivedPhaseEvidence(phase, ordinal, status, boundState) {
  assertBoundedObject(boundState, `${phase}_bound_state`);
  return deepFreeze({
    phase,
    ordinal,
    status,
    evidenceDigest: canonicalAclDigest({ phase, ordinal, status, boundState })
  });
}

function assertUniquePhaseEvidence(phases) {
  const ordinals = phases.map(({ ordinal }) => ordinal);
  const names = phases.map(({ phase }) => phase);
  const digests = phases.map(({ evidenceDigest }) => evidenceDigest);
  if (
    new Set(ordinals).size !== ordinals.length ||
    new Set(names).size !== names.length ||
    new Set(digests).size !== digests.length ||
    ordinals.some((ordinal, index) => ordinal !== index + 1)
  ) invalid("phase_sequence");
}

function assertApproval(approval) {
  assertExactKeys(approval, ["providerAclRestorePlanDigest"], "approval");
  if (!isDigest(approval.providerAclRestorePlanDigest)) {
    invalid("approval_restore_plan_digest");
  }
}

function assertProtectedProjects(projects) {
  if (!Array.isArray(projects) || projects.length !== DENIED_PROJECTS.length) {
    invalid("protected_projects");
  }
  for (let index = 0; index < DENIED_PROJECTS.length; index += 1) {
    const project = projects[index];
    assertExactKeys(project, [
      "ref", "kind", "selected", "mutationCount"
    ], "protected_project");
    if (
      project.ref !== DENIED_PROJECTS[index].ref ||
      project.kind !== DENIED_PROJECTS[index].kind ||
      project.selected !== false ||
      project.mutationCount !== 0
    ) invalid("protected_projects");
  }
}

function assertAllFlagsFalse(flags) {
  assertExactKeys(flags, FLAG_NAMES, "feature_flags");
  if (FLAG_NAMES.some((name) => flags[name] !== false)) {
    invalid("feature_flags");
  }
}

export function canonicalAclDigest(value) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function assertSanitizedReceipt(value) {
  walk(value, (key, nested) => {
    if (/(password|secret|token|jwt|connection|string|url)/i.test(key)) {
      invalid("receipt_sensitive_field");
    }
    if (typeof nested === "string" && /postgres(?:ql)?:\/\//i.test(nested)) {
      invalid("receipt_sensitive_value");
    }
  });
}

function walk(value, visitor) {
  if (Array.isArray(value)) {
    value.forEach((nested, index) => {
      visitor(String(index), nested);
      walk(nested, visitor);
    });
  } else if (isObject(value)) {
    for (const [key, nested] of Object.entries(value)) {
      visitor(key, nested);
      walk(nested, visitor);
    }
  }
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isObject(value)) {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`
    ).join(",")}}`;
  }
  return JSON.stringify(value);
}

function assertFresh(value, now, label) {
  const observed = exactDate(new Date(value));
  const age = now.getTime() - observed.getTime();
  if (
    age < 0 ||
    age > STAGING_PHASE1_V2_MAXIMUM_OBSERVATION_AGE_MILLISECONDS
  ) invalid(`${label}_stale`);
}

function exactDate(value) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    invalid("invalid_time");
  }
  return value;
}

function requireDependency(value, method, label) {
  if (!isObject(value) || typeof value[method] !== "function") {
    invalid(`${label}_required`);
  }
}

function assertExactKeys(value, keys, label) {
  if (!isObject(value)) invalid(label);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (!exactArray(actual, expected)) invalid(`${label}_fields`);
}

function exactArray(actual, expected) {
  return Array.isArray(actual) &&
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index]);
}

function assertBoundedObject(value, label) {
  if (byteLength(value) > MAXIMUM_PHASE_EVIDENCE_BYTES) {
    invalid(`${label}_oversized`);
  }
}

function byteLength(value) {
  return Buffer.byteLength(canonicalJson(value), "utf8");
}

function isDigest(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function operatorError(reason) {
  return new Error(`trailmind_phase1_v2_operator_blocked:${reason}`);
}

function classifiedError(classification) {
  const error = new Error(
    `trailmind_phase1_v2_operator_failed:${classification}`
  );
  error.classification = classification;
  return error;
}

function invalid(reason) {
  throw operatorError(reason);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}
