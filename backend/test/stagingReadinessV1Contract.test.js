import assert from "node:assert/strict";
import {
  generateKeyPairSync,
  sign
} from "node:crypto";
import { readFile } from "node:fs/promises";
import { before, describe, it } from "node:test";
import {
  CANONICAL_CASES,
  CANONICAL_ROLE_IDS,
  CANONICAL_ROLE_SEPARATION_GUARD_IDS,
  CANCELLATION_CONTROL_PRIVILEGE_MANIFEST,
  CANCELLATION_CONTROL_ROLE_ID
} from "../evaluation/stagingReadinessV1/constants.js";
import {
  sealStagingReadinessReceiptV1,
  stagingReadinessObserverKeyIdV1,
  validateStagingReadinessReceiptV1
} from "../evaluation/stagingReadinessV1/contract.js";
import { loadStagingReadinessPolicyV1 } from
  "../evaluation/stagingReadinessV1/policy.js";
import { stagingReadinessCandidateBindingRecordV1 } from
  "../evaluation/stagingReadinessV1/observations.js";
import { renderStagingReadinessRolesMarkdownV1 } from
  "../evaluation/stagingReadinessV1/roleReport.js";
import {
  createCompleteSyntheticStagingReceiptV1,
  SYNTHETIC_STAGING_PROOF_AS_OF
} from "../evaluation/stagingReadinessV1/syntheticFixtures.js";
import { stableSerializeStagingReadinessV1 } from
  "../evaluation/stagingReadinessV1/serialization.js";

let policy;
let publicKey;
let privateKey;
let observerKeyIdSha256;
let receipt;

before(async () => {
  policy = await loadStagingReadinessPolicyV1();
  ({ publicKey, privateKey } = generateKeyPairSync("ed25519"));
  observerKeyIdSha256 = stagingReadinessObserverKeyIdV1(publicKey);
  receipt = await createCompleteSyntheticStagingReceiptV1({
    policy,
    signer: signer()
  });
});

describe("staging readiness V1 strict receipt contract", () => {
  it("validates a complete signed live shape up to the hard admission stop", () => {
    assert.equal(receipt.summary.finalClassification, "GO");
    assert.equal(receipt.summary.providerCalls, 0);
    assert.equal(receipt.summary.productionMutations, 0);
    assert.equal(receipt.summary.secretExposures, 0);
    assert.throws(() => validate(receipt), /live_execution_not_admitted/);
  });

  it("is byte- and semantic-deterministic for identical modeled run identity", async () => {
    const second = await createCompleteSyntheticStagingReceiptV1({
      policy,
      signer: signer()
    });
    assert.equal(second.semanticReceiptSha256, receipt.semanticReceiptSha256);
    assert.equal(
      stableSerializeStagingReadinessV1(second),
      stableSerializeStagingReadinessV1(receipt)
    );
  });

  it("binds nine canonical roles and renders cancellation evidence deterministically", () => {
    assert.equal(CANONICAL_CASES.length, 45);
    assert.deepEqual(CANONICAL_ROLE_IDS, [
      "platform_provisioner",
      "migration_role",
      "regional_import_role",
      "projection_role",
      "app_security_runtime_role",
      "outdoor_research_runtime_role",
      CANCELLATION_CONTROL_ROLE_ID,
      "pruner_role",
      "readonly_auditor_role"
    ]);
    const first = renderStagingReadinessRolesMarkdownV1({
      roleObservation: receipt.observations.roles,
      policy
    });
    const second = renderStagingReadinessRolesMarkdownV1({
      roleObservation: receipt.observations.roles,
      policy
    });
    assert.equal(first, second);
    assert.match(first, /outdoor_research_cancellation_control_role/);
    assert.match(first, /cancel_only_active_outdoor_research_backend/);
    assert.match(first, /cancel_active_outdoor_research_backend_integer/);
    assert.match(first, /backup_restore_role/);
    assert.deepEqual(
      cancellationRole(receipt).privilegeManifest,
      CANCELLATION_CONTROL_PRIVILEGE_MANIFEST
    );
    const binding = stagingReadinessCandidateBindingRecordV1(
      receipt.observations,
      receipt.candidate
    );
    assert.equal(
      binding.cancellationRoleIdentityDigest,
      receipt.observations.roles.cancellationRoleDigest
    );
    assert.equal(
      binding.cancellationPrivilegeManifestDigest,
      cancellationRole(receipt).privilegeManifestDigest
    );
    const malformed = structuredClone(receipt.observations.roles);
    malformed.roles[cancellationRoleIndex()].purpose = "forged_purpose";
    assert.throws(() => renderStagingReadinessRolesMarkdownV1({
      roleObservation: malformed,
      policy
    }), /role_report_contract_mismatch/);
  });

  it("keeps the documented cancellation privilege manifest byte-exact", async () => {
    const markdown = await readFile(new URL(
      "../../docs/release/staging-v1/ROLE_CONTRACT_V1.md",
      import.meta.url
    ), "utf8");
    assert.ok(markdown.includes(
      stableSerializeStagingReadinessV1(CANCELLATION_CONTROL_PRIVILEGE_MANIFEST)
    ));
  });

  const adversarialCases = [
    ["missing evidence", (value) => { value.observations.database = null; }],
    ["unknown schema field", (value) => { value.observations.database.extra = true; }],
    ["duplicate canonical case", (value) => { value.cases[1] = structuredClone(value.cases[0]); }],
    ["reordered canonical cases", (value) => { [value.cases[4], value.cases[5]] = [value.cases[5], value.cases[4]]; }],
    ["zero executed summary", (value) => { value.summary.executedCases = 0; }],
    ["skip represented as pass", (value) => { value.cases[8].state = "skipped"; }],
    ["passed case with blocker", (value) => { value.cases[8].blockerCodes = ["forged_blocker"]; }],
    ["stale regional import", (value) => {
      value.observations.regions[0].sourceDataAt = "2026-08-01T10:00:00.000Z";
      value.observations.regions[0].sourceAgeSeconds = 1_987_200;
    }],
    ["stale projection clock", (value) => {
      value.observations.regions[1].projectedAt = "2026-08-25T10:00:00.000Z";
    }],
    ["stale backup restore", (value) => {
      value.observations.backupRestore.maximumEvidenceAgeSeconds = 60;
    }],
    ["wrong runtime Git candidate", (value) => {
      value.observations.runtime.candidateCommit = "4".repeat(40);
    }],
    ["wrong image candidate", (value) => {
      value.observations.runtime.imageDigest = `sha256:${"4".repeat(64)}`;
    }],
    ["wrong deployment candidate", (value) => {
      value.observations.runtimeOperations.rollback.candidateRevisionDigest = "4".repeat(64);
    }],
    ["wrong database candidate", (value) => {
      value.observations.database.databaseInstanceDigest = "4".repeat(64);
    }],
    ["production and staging alias", (value) => {
      value.observations.environment.productionHttpsOriginDigest =
        value.observations.environment.httpsOriginDigest;
    }],
    ["forged production identity-set digest", (value) => {
      value.observations.environment.productionIdentitySetDigest = "4".repeat(64);
    }],
    ["TOCTOU binding substitution", (value) => {
      value.observations.environment.postflightBindingSha256 = "4".repeat(64);
    }],
    ["unbounded stale observation window", (value) => {
      value.observations.environment.preflightObservedAt =
        "2019-01-01T00:00:00.000Z";
      value.observations.featureFlags.observedAt = "2020-01-01T00:00:00.000Z";
    }],
    ["migration gap", (value) => { value.observations.migrations.ledger.splice(4, 1); }],
    ["fake second migration no-op", (value) => {
      value.observations.migrations.secondRun.appliedCount = 1;
    }],
    ["privileged runtime role", (value) => {
      value.observations.roles.roles[5].dangerousPrivilegeDetected = true;
    }],
    ["aliased database roles", (value) => {
      value.observations.roles.roles[5].identityDigest =
        value.observations.roles.roles[4].identityDigest;
    }],
    ["RLS or Data API leakage", (value) => {
      value.observations.roles.publicDataApiDenied = false;
    }],
    ["function boundary leakage", (value) => {
      value.observations.roles.runtimeFunctionCount = 6;
    }],
    ["missing cancellation control role", (value) => {
      value.observations.roles.roles.splice(cancellationRoleIndex(), 1);
    }],
    ["duplicate cancellation control role", (value) => {
      value.observations.roles.roles[cancellationRoleIndex()] = structuredClone(
        value.observations.roles.roles[cancellationRoleIndex() - 1]
      );
    }],
    ["reordered cancellation control role", (value) => {
      const index = cancellationRoleIndex();
      [value.observations.roles.roles[index], value.observations.roles.roles[index + 1]] =
        [value.observations.roles.roles[index + 1], value.observations.roles.roles[index]];
    }],
    ["unknown cancellation control role ID", (value) => {
      cancellationRole(value).id = "unknown_cancellation_role";
    }],
    ["wrong cancellation control purpose", (value) => {
      cancellationRole(value).purpose = "serve_product_queries";
    }],
    ["cancellation superuser privilege", (value) => {
      cancellationManifest(value).superuser = true;
    }],
    ["cancellation CREATEDB privilege", (value) => {
      cancellationManifest(value).createDatabase = true;
    }],
    ["cancellation CREATEROLE privilege", (value) => {
      cancellationManifest(value).createRole = true;
    }],
    ["cancellation REPLICATION privilege", (value) => {
      cancellationManifest(value).replication = true;
    }],
    ["cancellation BYPASSRLS privilege", (value) => {
      cancellationManifest(value).bypassRls = true;
    }],
    ["cancellation unexpected membership", (value) => {
      cancellationManifest(value).membershipRoleIds.push("pg_signal_backend");
    }],
    ["cancellation unexpected inheritance", (value) => {
      cancellationManifest(value).inheritPrivileges = true;
    }],
    ["cancellation object ownership", (value) => {
      cancellationManifest(value).ownedObjectCount = 1;
    }],
    ["cancellation broad schema access", (value) => {
      cancellationManifest(value).schemaUsageIds.push("public");
    }],
    ["cancellation broad table access", (value) => {
      cancellationManifest(value).tablePrivilegeIds.push("public.all_tables_select");
    }],
    ["cancellation sequence access", (value) => {
      cancellationManifest(value).sequencePrivilegeIds.push("public.all_sequences_usage");
    }],
    ["cancellation excess function execution", (value) => {
      cancellationManifest(value).functionExecuteIds.push("pg_catalog.pg_terminate_backend");
    }],
    ["cancellation direct pg_cancel_backend execution", (value) => {
      cancellationManifest(value).directPgCancelBackendExecute = true;
    }],
    ["cancellation public or Data API exposure", (value) => {
      cancellationManifest(value).publicDataApiExposed = true;
    }],
    ["cancellation direct business-data read", (value) => {
      cancellationManifest(value).directBusinessDataRead = true;
    }],
    ["cancellation business-data mutation", (value) => {
      cancellationManifest(value).businessDataMutation = true;
    }],
    ["cancellation target substitution", (value) => {
      cancellationManifest(value).targetRoleId = "app_security_runtime_role";
    }],
    ["cancellation target restriction disabled", (value) => {
      cancellationManifest(value).targetRestrictionEnforced = false;
    }],
    ["cancellation product query execution", (value) => {
      cancellationManifest(value).productQueryExecutionDenied = false;
    }],
    ["cancellation self privilege escalation", (value) => {
      cancellationManifest(value).selfPrivilegeEscalationDenied = false;
    }],
    ["cancellation RLS boundary bypass", (value) => {
      cancellationRole(value).rlsBoundaryPassed = false;
    }],
    ["hidden unsafe cancellation role behind safe runtime role", (value) => {
      cancellationRole(value).dangerousPrivilegeDetected = true;
    }],
    ["mutable cancellation role evidence", (value) => {
      cancellationRole(value).evidenceSha256 = "4".repeat(64);
    }],
    ["unknown cancellation privilege field", (value) => {
      cancellationManifest(value).unexpectedPrivilege = true;
    }],
    ["malformed cancellation privilege manifest", (value) => {
      cancellationRole(value).privilegeManifest = null;
    }],
    ["forged cancellation privilege digest", (value) => {
      cancellationRole(value).privilegeManifestDigest = "4".repeat(64);
    }],
    ["forged cancellation role-set digest", (value) => {
      value.observations.roles.roleSetDigest = "4".repeat(64);
    }],
    ["forged cancellation grant digest", (value) => {
      value.observations.roles.grantDigest = "4".repeat(64);
    }],
    ["detached cancellation identity digest", (value) => {
      value.observations.roles.cancellationRoleDigest = "4".repeat(64);
    }],
    ["forged cancellation contract digest", (value) => {
      value.observations.roles.roleContractDigest = "4".repeat(64);
    }],
    ["cancellation identity aliased to backup restore", (value) => {
      aliasCancellationToGuard(value, "backup_restore_role");
    }],
    ["cancellation identity aliased to anon", (value) => {
      aliasCancellationToGuard(value, "anon");
    }],
    ["cancellation identity aliased to authenticated", (value) => {
      aliasCancellationToGuard(value, "authenticated");
    }],
    ["cancellation identity aliased to service role", (value) => {
      aliasCancellationToGuard(value, "service_role");
    }],
    ["cancellation identity aliased to administrative role", (value) => {
      aliasCancellationToGuard(value, "postgres_administrator");
    }],
    ["missing separation guard identity", (value) => {
      value.observations.roles.separationGuardIdentities.pop();
    }],
    ["reordered separation guard identities", (value) => {
      [value.observations.roles.separationGuardIdentities[0],
        value.observations.roles.separationGuardIdentities[1]] =
        [value.observations.roles.separationGuardIdentities[1],
          value.observations.roles.separationGuardIdentities[0]];
    }],
    ["empty regional import rows", (value) => {
      value.observations.regions[0].rowTotals.importedSegments = 0;
    }],
    ["cross-region contamination", (value) => {
      value.observations.regions[1].crossRegionRows = 1;
    }],
    ["cross-region import identity alias", (value) => {
      value.observations.regions[1].importIdentityDigest =
        value.observations.regions[0].importIdentityDigest;
    }],
    ["partial import residue", (value) => {
      value.observations.regions[0].partialResidueRows = 1;
    }],
    ["required index unused", (value) => {
      value.observations.performance.observations[1].indexUsed = false;
    }],
    ["projection entity sequential scan", (value) => {
      value.observations.performance.observations[2].projectionEntitySequentialScan = true;
    }],
    ["performance threshold breach", (value) => {
      value.observations.performance.observations[1].p95Milliseconds = 1_500;
      value.observations.performance.observations[1].maximumMilliseconds = 1_600;
    }],
    ["cancellation pool leak", (value) => {
      value.observations.performance.cancellation.waitingClients = 1;
    }],
    ["health response leaks details", (value) => {
      value.observations.runtimeOperations.liveness.sensitiveDetailsExposed = true;
    }],
    ["readiness green during database outage", (value) => {
      value.observations.outages[0].readinessDuringOutage = "ready";
    }],
    ["drain accepts late work", (value) => {
      value.observations.runtimeOperations.drain.lateWorkAccepted = 1;
    }],
    ["rollback points to same revision", (value) => {
      value.observations.runtimeOperations.rollback.rollbackTargetRevisionDigest =
        value.observations.runtimeOperations.rollback.candidateRevisionDigest;
      value.observations.runtimeOperations.rollback.rolledBackRevisionDigest =
        value.observations.runtimeOperations.rollback.candidateRevisionDigest;
    }],
    ["rollback target not known good", (value) => {
      value.observations.runtimeOperations.rollback.rollbackTargetKnownGood = false;
    }],
    ["alert missing", (value) => { value.observations.monitoring.alerts.pop(); }],
    ["alert disabled", (value) => { value.observations.monitoring.alerts[0].enabled = false; }],
    ["alert stale", (value) => {
      value.observations.monitoring.maximumAlertTestAgeSeconds = 60;
    }],
    ["backup without restore", (value) => {
      value.observations.backupRestore.restoreSucceeded = false;
    }],
    ["restore target aliases production", (value) => {
      value.observations.backupRestore.restoreDatabaseInstanceDigest =
        value.observations.environment.productionDatabaseInstanceDigest;
    }],
    ["feature flag missing", (value) => { value.observations.featureFlags.flags.pop(); }],
    ["feature flag malformed", (value) => {
      value.observations.featureFlags.flags[0].deployedObservedValue = "false";
    }],
    ["feature flag true", (value) => {
      value.observations.featureFlags.flags[6].deployedObservedValue = true;
      value.observations.featureFlags.flags[6].effectiveValue = true;
    }],
    ["provider attempt", (value) => {
      value.observations.providerAccounting.attempted = 1;
      value.summary.providerCalls = 1;
    }],
    ["provider budget work", (value) => {
      value.observations.providerAccounting.budgetWork = 1;
    }],
    ["cleanup failure", (value) => {
      value.observations.cleanup.temporaryResourcesRemoved = 3;
    }],
    ["residual resource", (value) => {
      value.observations.cleanup.residualResourceDigests = ["4".repeat(64)];
    }],
    ["privacy scan violation", (value) => {
      value.observations.privacy.secretPatternMatches = 1;
    }],
    ["future proof clock", (value) => {
      value.proofAsOf = "2026-08-25T10:00:00.000Z";
      value.generatedAt = value.proofAsOf;
    }],
    ["future case clock", (value) => {
      value.cases[12].observedAt = "2026-08-25T10:00:00.000Z";
    }],
    ["stale proof clock", (value) => {
      value.proofAsOf = "2026-08-24T09:00:00.000Z";
      value.generatedAt = value.proofAsOf;
      value.clockPolicy.maximumReceiptAgeSeconds = 60;
    }]
  ];

  for (const targetRoleId of CANONICAL_ROLE_IDS.filter((id) =>
    id !== CANCELLATION_CONTROL_ROLE_ID
  )) {
    adversarialCases.push([
      `cancellation identity aliased to ${targetRoleId}`,
      (value) => { aliasCancellationToRole(value, targetRoleId); }
    ]);
  }

  for (const [name, mutate] of adversarialCases) {
    it(`rejects ${name}`, async () => {
      await assert.rejects(async () => {
        const changed = await resign(mutate);
        validate(changed);
      }, undefined, name);
    });
  }

  it("rejects secret-bearing diagnostics before schema processing", async () => {
    await assert.rejects(async () => {
      await resign((value) => {
        value.observations.runtimeOperations.liveness.rawError =
          ["postgres", "ql://operator:credential@example.invalid/staging"].join("");
      });
    }, (error) => error?.code === "receipt_sensitive_value_rejected" ||
      error?.code === "receipt_sensitive_key_rejected");
  });

  it("rejects a forged signature", () => {
    const changed = structuredClone(receipt);
    const signature = Buffer.from(
      changed.authenticity.signatureBase64url,
      "base64url"
    );
    signature[0] ^= 0x01;
    changed.authenticity.signatureBase64url = signature.toString("base64url");
    assert.throws(() => validate(changed), /live_receipt_signature_invalid/);
  });

  it("rejects an untrusted observer key even for internally consistent bytes", () => {
    const other = generateKeyPairSync("ed25519");
    const otherId = stagingReadinessObserverKeyIdV1(other.publicKey);
    assert.throws(() => validateStagingReadinessReceiptV1(receipt, {
      trustedNow: SYNTHETIC_STAGING_PROOF_AS_OF,
      policy,
      observerPublicKey: other.publicKey,
      expectedObserverKeyIdSha256: otherId
    }), /live_receipt_authenticity_invalid/);
  });
});

function validate(value) {
  return validateStagingReadinessReceiptV1(value, {
    trustedNow: SYNTHETIC_STAGING_PROOF_AS_OF,
    policy,
    observerPublicKey: publicKey,
    expectedObserverKeyIdSha256: observerKeyIdSha256
  });
}

function signer() {
  return async (payload) => ({
    observerKeyIdSha256,
    signatureBase64url: sign(null, payload, privateKey).toString("base64url")
  });
}

async function resign(mutate) {
  const changed = structuredClone(receipt);
  delete changed.semanticReceiptSha256;
  delete changed.authenticity;
  mutate(changed);
  return sealStagingReadinessReceiptV1(changed, { signer: signer() });
}

function cancellationRoleIndex() {
  return CANONICAL_ROLE_IDS.indexOf(CANCELLATION_CONTROL_ROLE_ID);
}

function cancellationRole(value) {
  return value.observations.roles.roles[cancellationRoleIndex()];
}

function cancellationManifest(value) {
  return cancellationRole(value).privilegeManifest;
}

function aliasCancellationToRole(value, targetRoleId) {
  const target = value.observations.roles.roles.find((role) =>
    role.id === targetRoleId
  );
  cancellationRole(value).identityDigest = target.identityDigest;
  value.observations.roles.cancellationRoleDigest = target.identityDigest;
}

function aliasCancellationToGuard(value, targetGuardId) {
  assert.ok(CANONICAL_ROLE_SEPARATION_GUARD_IDS.includes(targetGuardId));
  const target = value.observations.roles.separationGuardIdentities.find(
    (guard) => guard.id === targetGuardId
  );
  cancellationRole(value).identityDigest = target.identityDigest;
  value.observations.roles.cancellationRoleDigest = target.identityDigest;
}
