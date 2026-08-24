import assert from "node:assert/strict";
import {
  generateKeyPairSync,
  sign
} from "node:crypto";
import { before, describe, it } from "node:test";
import {
  sealStagingReadinessReceiptV1,
  stagingReadinessObserverKeyIdV1,
  validateStagingReadinessReceiptV1
} from "../evaluation/stagingReadinessV1/contract.js";
import { loadStagingReadinessPolicyV1 } from
  "../evaluation/stagingReadinessV1/policy.js";
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
