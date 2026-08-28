import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

const repositoryRoot = new URL("../../", import.meta.url);
const receiptPath =
  "docs/operations/staging-v1/supabase/PHASE_1_REMOTE_ADMISSION_20260826.json";
const reportPath =
  "docs/operations/staging-v1/supabase/PHASE_1_REMOTE_ADMISSION_20260826.md";
const blockedProvisioningReceiptPath =
  "docs/operations/staging-v1/database/PHASE_1_REMOTE_PROVISIONING_BLOCKED_20260828.json";
const blockedProvisioningReportPath =
  "docs/operations/staging-v1/database/PHASE_1_REMOTE_PROVISIONING_BLOCKED_20260828.md";

async function readRepositoryFile(path) {
  return readFile(new URL(path, repositoryRoot), "utf8");
}

async function sha256(path) {
  return createHash("sha256")
    .update(await readFile(new URL(path, repositoryRoot)))
    .digest("hex");
}

describe("Supabase Phase 1 remote admission evidence", () => {
  it("binds the exact free staging target and forbids a hosting go-ahead", async () => {
    const receipt = JSON.parse(await readRepositoryFile(receiptPath));

    assert.equal(receipt.schemaVersion, 1);
    assert.equal(receipt.status, "blocked_remote_adapter_unavailable");
    assert.equal(receipt.target.projectRef, "mbvzwsrtqcrwhvykugcd");
    assert.equal(receipt.target.organizationPlan, "free");
    assert.equal(receipt.target.region, "eu-central-1");
    assert.equal(receipt.target.recurringCostUsd, 0);
    assert.equal(receipt.protectedProduction.projectRef, "bejvhhjbgtvctpsnlwid");
    assert.equal(receipt.protectedProduction.mutationCount, 0);
    assert.equal(receipt.goNoGo.hostingRuntimeConnection, "NO_GO");
  });

  it("keeps the mutually exclusive migration policies explicit and digest-bound", async () => {
    const receipt = JSON.parse(await readRepositoryFile(receiptPath));
    const expectedFiles = [
      "001_app_attest.sql",
      "002_outdoor_evidence.sql",
      "003_outdoor_research_graph.sql",
      "004_osm_outdoor_research_projection.sql",
      "005_outdoor_research_projection_geometry.sql",
      "006_outdoor_route_membership_point_index.sql",
      "007_routable_highlight_access_geography_index.sql",
      "009_supabase_postgis_isolated_runtime_read_contract.sql"
    ];

    assert.equal(receipt.reviewedMigrationPolicy.historicalPortablePolicy, "001-008");
    assert.equal(receipt.reviewedMigrationPolicy.managedSupabasePolicy, "001-007+009");
    assert.equal(receipt.reviewedMigrationPolicy.mixedPolicyForbidden, true);
    assert.deepEqual(
      receipt.reviewedMigrationPolicy.migrations.map(({ file }) => file),
      expectedFiles
    );

    for (const migration of receipt.reviewedMigrationPolicy.migrations) {
      assert.equal(
        migration.sha256,
        await sha256(`backend/migrations/${migration.file}`)
      );
    }
  });

  it("cannot convert absent remote execution into migration, data, or backup proof", async () => {
    const receipt = JSON.parse(await readRepositoryFile(receiptPath));

    assert.equal(receipt.executionDecision.migrationStatus, "not_run");
    assert.equal(receipt.executionDecision.rawApplyMigrationBypassUsed, false);
    assert.equal(receipt.executionDecision.directDatabaseAccessAdmitted, false);
    assert.equal(receipt.remotePrestate.postgisInstalled, false);
    assert.equal(receipt.remotePrestate.applicationMigrationLedgerExists, false);
    assert.equal(receipt.regionalData.activeImportCount, 0);
    assert.equal(receipt.regionalData.activeProjectionCount, 0);
    assert.equal(receipt.regionalData.coverageProved, false);
    assert.equal(receipt.regionalData.freshnessProved, false);
    assert.match(receipt.backupRestore.status, /^not_run_/);
    assert.equal(receipt.goNoGo.databaseFoundation, "NO_GO");
    assert.equal(receipt.goNoGo.regionalDataActivation, "NO_GO");
  });

  it("records zero mutation, provider, secret, flag, and paid-resource effects", async () => {
    const receipt = JSON.parse(await readRepositoryFile(receiptPath));
    const effects = receipt.externalEffects;

    assert.equal(effects.stagingMutationCount, 0);
    assert.equal(effects.productionMutationCount, 0);
    assert.equal(effects.graphHopperCalls, 0);
    assert.equal(effects.aiProviderCalls, 0);
    assert.equal(effects.paidResourceOperations, 0);
    assert.equal(effects.secretsReadPrintedCopiedOrStored, false);
    assert.equal(effects.featureFlagCount, 13);
    assert.equal(effects.allFeatureFlagsRemainFalse, true);
  });

  it("keeps the human report truthful and credential-free", async () => {
    const report = await readRepositoryFile(reportPath);

    assert.match(report, /NO-GO for migrations, regional imports, and runtime connection/);
    assert.match(report, /001–007 \+ 009/);
    assert.match(report, /No feature flag, provider, paid resource, deployment/);
    assert.doesNotMatch(report, /postgres(?:ql)?:\/\//i);
    assert.doesNotMatch(report, /service[_-]?role\s*[:=]\s*["']?[A-Za-z0-9._-]{16,}/i);
    assert.doesNotMatch(report, /eyJ[A-Za-z0-9_-]{10,}/);
  });

  it("binds the blocked provisioning receipt to the observed main tree and pristine target", async () => {
    const receipt = JSON.parse(
      await readRepositoryFile(blockedProvisioningReceiptPath)
    );

    assert.equal(receipt.schemaVersion, 1);
    assert.equal(receipt.status, "blocked");
    assert.equal(
      receipt.baseline.remoteMainCommit,
      "a36c646815f390b60df734147a78e82c8ef46dd1"
    );
    assert.equal(
      receipt.baseline.candidateTree,
      "efd9c0469e031f24e2adfe84fe8bacf021f4c1b3"
    );
    assert.equal(receipt.baseline.equivalentSuccessfulProvisionFound, false);
    assert.equal(receipt.baseline.concurrentProvisioningWriterFound, false);
    assert.equal(receipt.authorizedTarget.projectRef, "mbvzwsrtqcrwhvykugcd");
    assert.equal(receipt.authorizedTarget.organizationPlan, "free");
    assert.equal(receipt.authorizedTarget.region, "eu-central-1");
    assert.equal(receipt.remoteCatalogBeforeAndAfter.identical, true);
    assert.equal(receipt.remoteCatalogBeforeAndAfter.postgisInstalled, false);
    for (const field of [
      "trailmindRoleCount",
      "trailmindSchemaCount",
      "trailmindRelationCount",
      "trailmindFunctionCount"
    ]) {
      assert.equal(receipt.remoteCatalogBeforeAndAfter[field], 0, field);
    }
  });

  it("keeps the blocked provisioning migration bytes ordered and digest-bound", async () => {
    const receipt = JSON.parse(
      await readRepositoryFile(blockedProvisioningReceiptPath)
    );
    const expectedFiles = [
      "001_app_attest.sql",
      "002_outdoor_evidence.sql",
      "003_outdoor_research_graph.sql",
      "004_osm_outdoor_research_projection.sql",
      "005_outdoor_research_projection_geometry.sql",
      "006_outdoor_route_membership_point_index.sql",
      "007_routable_highlight_access_geography_index.sql",
      "009_supabase_postgis_isolated_runtime_read_contract.sql",
      "010_bounded_outdoor_import_schema_provisioning.sql"
    ];

    assert.equal(receipt.migrationContract.policyId, "supabase-postgis-isolation-v2");
    assert.equal(receipt.migrationContract.historical008Excluded, true);
    assert.deepEqual(
      receipt.migrationContract.orderedMigrations.map(({ version }) => version),
      expectedFiles
    );
    for (const migration of receipt.migrationContract.orderedMigrations) {
      assert.equal(
        migration.sha256,
        await sha256(`backend/migrations/${migration.version}`)
      );
    }
    assert.equal(receipt.migrationContract.firstRun, "not_run");
    assert.equal(receipt.migrationContract.secondRun, "not_run");
    assert.equal(receipt.migrationContract.secondRunTrueNoOpProved, false);
  });

  it("keeps the blocked provisioning report mutation-free and credential-free", async () => {
    const receipt = JSON.parse(
      await readRepositoryFile(blockedProvisioningReceiptPath)
    );
    const report = await readRepositoryFile(blockedProvisioningReportPath);

    for (const field of [
      "remoteMutationCount",
      "protectedProjectMutationCount",
      "providerCallCount",
      "graphHopperCallCount",
      "aiProviderCallCount",
      "downloadCount",
      "importCount",
      "projectionCount",
      "backupCount",
      "restoreCount",
      "faultInjectionRemoteCount"
    ]) {
      assert.equal(receipt.execution[field], 0, field);
    }
    assert.equal(receipt.execution.reviewedOperatorInvoked, false);
    assert.equal(receipt.features.releaseOrBackendDeploymentPerformed, false);
    assert.equal(receipt.cleanup.credentialsRetained, false);
    assert.equal(receipt.cleanup.connectionMaterialRetained, false);
    assert.doesNotMatch(report, /postgres(?:ql)?:\/\//i);
    assert.doesNotMatch(report, /service[_-]?role\s*[:=]\s*["']?[A-Za-z0-9._-]{16,}/i);
    assert.doesNotMatch(report, /eyJ[A-Za-z0-9_-]{10,}/);
  });
});
