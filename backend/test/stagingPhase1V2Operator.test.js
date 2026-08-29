import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canonicalAclDigest,
  runStagingPhase1V2Operator,
  STAGING_PHASE1_V2_TARGET
} from "../src/operations/stagingPhase1V2Operator.js";
import {
  SUPABASE_POSTGIS_ISOLATION_MIGRATIONS_V2
} from "../src/operations/stagingMigrationPolicy.js";

const now = new Date("2026-08-25T08:00:00.000Z");
const aclDigest = canonicalAclDigest({
  database: null,
  extensions: ["PUBLIC=USAGE"],
  public: ["PUBLIC=USAGE"]
});
const restorePlanDigest = "d".repeat(64);
const authorizationBindingDigest = "a".repeat(64);
const candidateCommit = "5".repeat(40);
const candidateTree = "6".repeat(40);
const operatorDigestsDigest = "b".repeat(64);
const runtimeFunctions = [
  "trailmind_runtime_outdoor_research_snapshot_context_v1",
  "trailmind_runtime_outdoor_research_highlights_v1",
  "trailmind_runtime_outdoor_research_route_memberships_v1",
  "trailmind_runtime_outdoor_research_route_assertions_v1",
  "trailmind_runtime_outdoor_research_trail_access_candidates_v1"
].sort();
const flagNames = [
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
];

describe("staging Phase 1 V2 future operator state machine", () => {
  it("binds and completes the exact ten ordered phases", async () => {
    const events = [];
    const dependencies = fixture(events);
    const result = await runStagingPhase1V2Operator(dependencies);
    assert.deepEqual(events, [
      "control:pre",
      "database:pre:unlocked",
      "database:lock:trailmind-phase-1-foundation:false",
      "database:pre:locked",
      "executor:pre",
      "executor:migrations:apply",
      "executor:migrations:verify-noop",
      "executor:post",
      "control:post-advisors",
      "control:final",
      "database:final",
      "receipt:stage"
    ]);
    assert.equal(result.receipt.status, "committed");
    assert.equal(result.receipt.projectRef, STAGING_PHASE1_V2_TARGET.projectRef);
    assert.equal(result.receipt.providerAclRestorePlanDigest, restorePlanDigest);
    assert.deepEqual(
      result.receipt.migrations,
      SUPABASE_POSTGIS_ISOLATION_MIGRATIONS_V2
    );
    assert.deepEqual(
      result.receipt.phaseEvidence.map(({ ordinal }) => ordinal),
      [1, 2, 3, 4, 5, 6, 7, 8, 9]
    );
    assert.equal(result.staging.ordinal, 10);
    assert.equal(result.staging.receiptDigest, result.receiptDigest);
    assert.equal(result.staging.receiptBytes, result.receiptBytes);
    assert.equal(result.receipt.featureFlagCount, 13);
    assert.equal(result.receipt.featureFlagsAllFalse, true);
    assert.equal(result.receipt.protectedProjectMutationCount, 0);
  });

  it("evaluates control-plane freshness after the asynchronous inspection", async () => {
    const events = [];
    const dependencies = fixture(events);
    const inspectPre = dependencies.controlPlane.inspectPre.bind(
      dependencies.controlPlane
    );
    let inspectionCompleted = false;
    dependencies.controlPlane.inspectPre = async (...arguments_) => {
      const snapshot = await inspectPre(...arguments_);
      inspectionCompleted = true;
      return snapshot;
    };
    dependencies.now = () => inspectionCompleted
      ? new Date(now)
      : new Date(now.getTime() - 1);

    const result = await runStagingPhase1V2Operator(dependencies);
    assert.equal(result.receipt.status, "committed");
  });

  for (const [name, mutate, error] of [
    ["production", (value) => { value.project.ref = "bejvhhjbgtvctpsnlwid"; }, /identity/],
    ["Planua", (value) => { value.project.ref = "cmkvbxppgofteoutfslp"; }, /identity/],
    ["organization", (value) => { value.project.organizationId = "wrong"; }, /identity/],
    ["region", (value) => { value.project.region = "us-east-1"; }, /identity/],
    ["health", (value) => { value.project.status = "INACTIVE"; }, /identity/],
    ["cost", (value) => { value.billing.monthlyCostAmount = 1; }, /cost/],
    ["compute", (value) => { value.billing.computeSize = "micro"; }, /cost/],
    ["stale", (value) => { value.observedAt = "2026-08-25T07:54:59.999Z"; }, /stale/],
    ["security advisor", (value) => { value.advisors.security.blockingFindingCount = 1; }, /security_advisor/],
    ["production mutation", (value) => { value.protectedProjects[0].mutationCount = 1; }, /protected_projects/],
    ["Planua selection", (value) => { value.protectedProjects[1].selected = true; }, /protected_projects/],
    ["enabled flag", (value) => { value.featureFlags.ROUTE_PROVIDER_ENABLED = true; }, /feature_flags/]
  ]) {
    it(`blocks ${name} before the database gate`, async () => {
      const events = [];
      const dependencies = fixture(events);
      mutate(dependencies.controlPlane.preSnapshot);
      await assert.rejects(runStagingPhase1V2Operator(dependencies), error);
      assert.deepEqual(events, ["control:pre"]);
    });
  }

  for (const [name, mutate] of [
    ["nonempty roles", (value) => { value.trailmindRoleCount = 1; }],
    ["insufficient Free-plan capacity", (value) => {
      value.currentDatabaseBytes = 470_000_000;
      value.capacityAdmission = false;
    }],
    ["installed PostGIS", (value) => { value.postgisInstalled = true; }],
    ["sibling writer", (value) => { value.siblingWriterSessionCount = 1; }],
    ["wrong operator", (value) => { value.currentUser = "supabase_admin"; }],
    ["uncontrolled extensions", (value) => { value.sharedAclMutationAuthorized = false; }],
    ["extensions owner", (value) => { value.extensionsSchemaOwner = "supabase_admin"; }],
    ["ACL mismatch", (value) => { value.databaseAclDigest = "b".repeat(64); }],
    ["Data API exposure", (value) => { value.dataApiExposedSchemas.push("trailmind_app"); }]
  ]) {
    it(`blocks ${name} before the lock`, async () => {
      const events = [];
      const dependencies = fixture(events);
      mutate(dependencies.database.preSnapshot);
      await assert.rejects(
        runStagingPhase1V2Operator(dependencies),
        /database_prestate/
      );
      assert.deepEqual(events, ["control:pre", "database:pre:unlocked"]);
    });
  }

  it("requires an independently supplied exact restore-plan digest", async () => {
    for (const approval of [
      {},
      buildApproval({ providerAclRestorePlanDigest: "e".repeat(64) }),
      {
        ...buildApproval(),
        restorePlanDigest: restorePlanDigest
      }
    ]) {
      const dependencies = fixture([]);
      dependencies.approval = approval;
      await assert.rejects(
        runStagingPhase1V2Operator(dependencies),
        /approval|database_prestate/
      );
    }
  });

  it("rejects restore-plan mutation between unlocked and locked snapshots", async () => {
    const dependencies = fixture([]);
    dependencies.database.lockedSnapshot = {
      ...dependencies.database.preSnapshot,
      providerAclRestorePlanDigest: "e".repeat(64)
    };
    await assert.rejects(
      runStagingPhase1V2Operator(dependencies),
      /database_prestate|prestate_changed/
    );
    assert.equal(dependencies.executor.callCount, 0);
  });

  it("rejects an unavailable lock and state mutation under lock", async () => {
    const unavailable = fixture([]);
    unavailable.database.lockAcquired = false;
    await assert.rejects(
      runStagingPhase1V2Operator(unavailable),
      /concurrent_writer/
    );
    const changed = fixture([]);
    changed.database.lockedSnapshot = {
      ...changed.database.preSnapshot,
      stateDigest: "c".repeat(64)
    };
    await assert.rejects(
      runStagingPhase1V2Operator(changed),
      /prestate_changed/
    );
  });

  it("rejects missing, reordered, inconsistent, duplicated, and oversized evidence", async () => {
    const missing = fixture([]);
    delete missing.executor.results.pre.evidenceDigest;
    await assert.rejects(
      runStagingPhase1V2Operator(missing),
      /pre-step-committed-no-ledger/
    );
    assert.equal(missing.executor.compensationCount, 1);

    const reordered = fixture([]);
    reordered.executor.results.pre.ordinal = 5;
    await assert.rejects(
      runStagingPhase1V2Operator(reordered),
      /pre-step-committed-no-ledger/
    );

    const inconsistent = fixture([]);
    inconsistent.executor.results.first.appliedMigrations = [];
    await assert.rejects(
      runStagingPhase1V2Operator(inconsistent),
      /committed-migration-failure/
    );
    assert.equal(inconsistent.containment.callCount, 1);

    const duplicated = fixture([]);
    duplicated.executor.results.first.evidenceDigest =
      duplicated.executor.results.pre.evidenceDigest;
    await assert.rejects(
      runStagingPhase1V2Operator(duplicated),
      /post-step-or-later-failure/
    );
    assert.equal(duplicated.containment.callCount, 1);

    const oversized = fixture([]);
    oversized.database.preSnapshot.dataApiExposedSchemas = [
      "public",
      `safe_${"x".repeat(40_000)}`
    ];
    oversized.database.lockedSnapshot = oversized.database.preSnapshot;
    await assert.rejects(
      runStagingPhase1V2Operator(oversized),
      /oversized/
    );
  });

  for (const [name, failAt, state, classification, compensation, secured] of [
    ["before pre commit", "pre", failureState(), "before-pre-step-commit", 0, 0],
    ["pre committed no ledger", "pre-after-commit", failureState({ preStepCommitted: true }), "pre-step-committed-no-ledger", 1, 0],
    ["migration rollback", "first", failureState({ preStepCommitted: true }), "migration-transaction-rollback", 1, 0],
    ["partial migration commit", "first-partial", failureState({ preStepCommitted: true, applicationLedgerExists: true, applicationMigrationCount: 1, applicationFoundationExists: true }), "committed-migration-failure", 0, 1],
    ["second runner", "second", failureState({ preStepCommitted: true, applicationLedgerExists: true, applicationMigrationCount: 8, applicationFoundationExists: true }), "committed-migration-failure", 0, 1],
    ["post step", "post", failureState({ preStepCommitted: true, applicationLedgerExists: true, applicationMigrationCount: 8, applicationFoundationExists: true }), "committed-migration-failure", 0, 1],
    ["post advisors", "advisors", failureState({ preStepCommitted: true, applicationLedgerExists: true, applicationMigrationCount: 8, applicationFoundationExists: true, postStepCommitted: true }), "post-step-or-later-failure", 0, 1],
    ["final inspection", "final", failureState({ preStepCommitted: true, applicationLedgerExists: true, applicationMigrationCount: 8, applicationFoundationExists: true, postStepCommitted: true }), "post-step-or-later-failure", 0, 1],
    ["durable receipt", "receipt", failureState({ preStepCommitted: true, applicationLedgerExists: true, applicationMigrationCount: 8, applicationFoundationExists: true, postStepCommitted: true }), "post-step-or-later-failure", 0, 1]
  ]) {
    it(`classifies and contains ${name}`, async () => {
      const dependencies = fixture([]);
      dependencies.failAt = failAt;
      dependencies.database.failureSnapshot = state;
      await assert.rejects(
        runStagingPhase1V2Operator(dependencies),
        new RegExp(classification)
      );
      assert.equal(dependencies.executor.compensationCount, compensation);
      assert.equal(dependencies.containment.callCount, secured);
    });
  }

  it("uses conservative containment when failure state cannot be proved", async () => {
    const dependencies = fixture([]);
    dependencies.failAt = "first";
    dependencies.database.failureInspectionFails = true;
    await assert.rejects(
      runStagingPhase1V2Operator(dependencies),
      /unknown-after-pre-step-attempt/
    );
    assert.equal(dependencies.executor.compensationCount, 0);
    assert.equal(dependencies.containment.callCount, 1);
  });
});

function fixture(events) {
  const controlSnapshot = controlPlaneSnapshot();
  const databaseSnapshot = databasePreSnapshot();
  const state = {
    now: () => new Date(now),
    approval: buildApproval(),
    failAt: undefined,
    controlPlane: {
      preSnapshot: controlSnapshot,
      finalSnapshot: structuredClone(controlSnapshot),
      async inspectPre() {
        events.push("control:pre");
        return this.preSnapshot;
      },
      async inspectPostAdvisors() {
        events.push("control:post-advisors");
        if (state.failAt === "advisors") throw new Error("fixture");
        return phase("post-ddl-advisors", 8, "acceptable", {
          observedAt: now.toISOString(),
          security: advisor("8"),
          performance: advisor("9")
        }, "8");
      },
      async inspectFinal() {
        events.push("control:final");
        if (state.failAt === "final") throw new Error("fixture");
        return this.finalSnapshot;
      }
    },
    database: {
      preSnapshot: databaseSnapshot,
      lockedSnapshot: databaseSnapshot,
      failureSnapshot: failureState(),
      failureInspectionFails: false,
      lockAcquired: true,
      async inspectPre({ stage }) {
        events.push(`database:pre:${stage}`);
        return stage === "locked" ? this.lockedSnapshot : this.preSnapshot;
      },
      async withFoundationLock(options, operation) {
        events.push(`database:lock:${options.key}:${options.wait}`);
        return operation({ acquired: this.lockAcquired });
      },
      async inspectFailure() {
        events.push("database:failure");
        if (this.failureInspectionFails) throw new Error("fixture");
        return this.failureSnapshot;
      },
      async inspectFinal() {
        events.push("database:final");
        return finalDatabaseSnapshot();
      }
    },
    executor: {
      callCount: 0,
      compensationCount: 0,
      results: {
        pre: phase("v2-pre-step", 4, "committed", {
          applicationLedgerExists: false,
          applicationMigrationCount: 0,
          applicationFoundationExists: false
        }, "4"),
        first: phase("first-migration-run", 5, "committed", {
          appliedMigrations: [...SUPABASE_POSTGIS_ISOLATION_MIGRATIONS_V2],
          ledger: [...SUPABASE_POSTGIS_ISOLATION_MIGRATIONS_V2],
          stdoutBytes: 410
        }, "5"),
        second: phase("second-migration-run", 6, "no-op", {
          appliedMigrations: [],
          ledger: [...SUPABASE_POSTGIS_ISOLATION_MIGRATIONS_V2],
          stdoutBytes: 0
        }, "6"),
        post: phase("v2-post-step", 7, "committed", {
          ledgerMigrationCount: SUPABASE_POSTGIS_ISOLATION_MIGRATIONS_V2.length,
          runtimeFunctionCount: 5
        }, "7")
      },
      async commitPreStep() {
        this.callCount += 1;
        events.push("executor:pre");
        if (state.failAt === "pre") throw new Error("fixture");
        state.database.failureSnapshot.preStepCommitted = true;
        if (state.failAt === "pre-after-commit") throw new Error("fixture");
        return this.results.pre;
      },
      async runMigrations({ runKind, operatorContext }) {
        this.callCount += 1;
        events.push(`executor:migrations:${runKind}`);
        assert.equal(Object.isFrozen(operatorContext), true);
        if (
          (runKind === "apply" && state.failAt === "first") ||
          (runKind === "apply" && state.failAt === "first-partial") ||
          (runKind === "verify-noop" && state.failAt === "second")
        ) throw new Error("fixture");
        if (runKind === "apply") {
          state.database.failureSnapshot.applicationLedgerExists = true;
          state.database.failureSnapshot.applicationMigrationCount =
            SUPABASE_POSTGIS_ISOLATION_MIGRATIONS_V2.length;
          state.database.failureSnapshot.applicationFoundationExists = true;
        }
        return runKind === "apply" ? this.results.first : this.results.second;
      },
      async commitPostStep() {
        this.callCount += 1;
        events.push("executor:post");
        if (state.failAt === "post") throw new Error("fixture");
        state.database.failureSnapshot.postStepCommitted = true;
        return this.results.post;
      },
      async compensatePreLedger() {
        this.compensationCount += 1;
        events.push("executor:compensate");
        return phase("v2-pre-ledger-compensation", 0, "compensated", {
          exactAclRestored: true,
          providerFixturePreserved: true,
          applicationLedgerExists: false,
          applicationFoundationExists: false
        }, "a");
      }
    },
    containment: {
      callCount: 0,
      async securePostCommitFailure({ targetRuntimeRole }) {
        this.callCount += 1;
        events.push("containment:secure");
        assert.equal(targetRuntimeRole, "outdoor_research_runtime_role");
        return phase("post-commit-containment", 0, "contained", {
          runtimeExecuteRevoked: true,
          affectedRuntimeSessionsTerminatedCount: 1,
          nonRuntimeSessionsTerminatedCount: 0,
          providerFlagsAllFalse: true,
          importFlagsAllFalse: true,
          deployFlagsAllFalse: true,
          evidencePreserved: true,
          compensationAttempted: false,
          rollbackAttempted: false,
          forwardFixRequired: true
        }, "b");
      }
    },
    receiptStore: {
      async stage({ receiptDigest, receiptBytes }) {
        events.push("receipt:stage");
        if (state.failAt === "receipt") throw new Error("fixture");
        return phase("sanitized-terminal-receipt-staging", 10, "staged", {
          receiptDigest,
          receiptBytes
        }, "c");
      }
    }
  };
  return state;
}

function buildApproval(overrides = {}) {
  return {
    authorizationBindingDigest,
    candidateCommit,
    candidateTree,
    operatorDigestsDigest,
    providerAclRestorePlanDigest: restorePlanDigest,
    runId: "11111111-1111-4111-8111-111111111111",
    ...overrides
  };
}

function controlPlaneSnapshot() {
  return {
    observedAt: now.toISOString(),
    project: {
      ref: "mbvzwsrtqcrwhvykugcd",
      name: "TrailMind Outdoor Staging V1",
      organizationId: "wbnftkftyamxzvxsftda",
      region: "eu-central-1",
      status: "ACTIVE_HEALTHY"
    },
    billing: {
      organizationPlan: "free",
      computeSize: "nano",
      currency: "USD",
      monthlyCostAmount: 0,
      nonzeroAddonCount: 0,
      observedAt: now.toISOString()
    },
    advisors: {
      security: {
        status: "completed",
        blockingFindingCount: 0,
        observedAt: now.toISOString()
      },
      performance: {
        status: "completed",
        blockingFindingCount: 0,
        observedAt: now.toISOString()
      }
    },
    expectedDatabaseAclDigest: aclDigest,
    protectedProjects: [
      {
        ref: "bejvhhjbgtvctpsnlwid",
        kind: "production",
        selected: false,
        mutationCount: 0
      },
      {
        ref: "cmkvbxppgofteoutfslp",
        kind: "planua",
        selected: false,
        mutationCount: 0
      }
    ],
    featureFlags: Object.fromEntries(flagNames.map((name) => [name, false]))
  };
}

function databasePreSnapshot() {
  return {
    projectRef: "mbvzwsrtqcrwhvykugcd",
    databaseName: "postgres",
    currentDatabaseBytes: 12_000_000,
    freePlanDatabaseLimitBytes: 500_000_000,
    phase1MinimumHeadroomBytes: 40_000_000,
    capacityAdmission: true,
    trailmindRoleCount: 0,
    trailmindSchemaCount: 0,
    trailmindObjectCount: 0,
    postgisInstalled: false,
    publicPostgisRoutineCount: 0,
    siblingWriterSessionCount: 0,
    sessionUser: "postgres",
    currentUser: "postgres",
    databaseOwner: "postgres",
    extensionsSchemaOwner: "postgres",
    sharedAclMutationAuthorized: true,
    extensionsSchemaExists: true,
    extensionsPublicUsage: true,
    extensionsPublicCreate: false,
    providerAclPrincipalCount: 8,
    providerAclRestorePlanDigest: restorePlanDigest,
    databaseAclDigest: aclDigest,
    stateDigest: "a".repeat(64),
    dataApiExposedSchemas: ["public", "graphql_public"],
    recoveryState: "pristine",
    recoveryAuthorizationBindingDigest: null,
    recoveryCandidateCommit: null,
    recoveryCandidateTree: null,
    recoveryOperatorDigestsDigest: null,
    recoveryProviderAclRestorePlanDigest: null,
    recoveryRunId: null
  };
}

function finalDatabaseSnapshot() {
  return {
    projectRef: "mbvzwsrtqcrwhvykugcd",
    databaseName: "postgres",
    sessionUser: "postgres",
    currentUser: "postgres",
    databaseOwner: "postgres",
    stateDigest: "f".repeat(64),
    policyId: "supabase-postgis-isolation-v2",
    ledger: [...SUPABASE_POSTGIS_ISOLATION_MIGRATIONS_V2],
    roleContractDigest: "1".repeat(64),
    roleContractValid: true,
    aclDigest: "2".repeat(64),
    dataApiExposedSchemas: ["public", "graphql_public"],
    applicationSchemasExposed: false,
    regionalImportNoDatabaseCreate: true,
    importSchemaOwnerBoundedDatabaseCreate: true,
    boundedImportProvisioningContract: true,
    postgisSchema: "trailmind_gis",
    postgisOwnerTopology: "postgres-schema/postgres-extension-members",
    gisUnexpectedCreatePrincipalCount: 0,
    publicPostgisRoutineCount: 0,
    runtimeExecutableFunctions: runtimeFunctions,
    runtimeDirectTablePrivilegeCount: 0,
    runtimeDirectPostgisRoutineCount: 0,
    runtimeDirectSharedRoutineCount: 0,
    appAttestAdmission: true,
    outdoorRuntimeAdmission: true,
    cancellationAdmission: true,
    siblingWriterSessionCount: 0
  };
}

function failureState(overrides = {}) {
  return phase("failure-state-inspection", 0, "inspected", {
    preStepCommitted: false,
    applicationLedgerExists: false,
    applicationMigrationCount: 0,
    applicationFoundationExists: false,
    postStepCommitted: false,
    ...overrides
  }, "e");
}

function advisor(digit) {
  return {
    status: "completed",
    blockingFindingCount: 0,
    noticeCount: 0,
    evidenceDigest: digit.repeat(64)
  };
}

function phase(name, ordinal, status, fields, digit) {
  return {
    phase: name,
    ordinal,
    status,
    evidenceDigest: digit.repeat(64),
    ...fields
  };
}
