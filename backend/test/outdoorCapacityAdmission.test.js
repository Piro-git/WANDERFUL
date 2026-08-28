import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  acquireOutdoorCapacityAdmission,
  evaluateOutdoorCapacityAdmission,
  loadOutdoorCapacityContract,
  OutdoorCapacityAdmissionError,
  outdoorCapacityAdmissionConstantsForTesting
} from "../src/outdoorEvidence/outdoorCapacityAdmission.js";

const PROFILE_ID = "supabase-free-bounded-two-core-v1";
const REGION_ID = "harz-v1";

describe("bounded Supabase Free capacity admission", () => {
  it("binds the immutable migration, polygon, profile, and lifecycle bytes", async () => {
    const contract = await loadOutdoorCapacityContract(PROFILE_ID);
    assert.equal(contract.profileId, PROFILE_ID);
    assert.equal(contract.profileIdentitySha256,
      "c5da9580a96eba5d18aeb8f8346926c016b71b8fd2340002529a1cb03c7e2afc");
    assert.equal(contract.identityFiles.length, 15);
    assert.equal(contract.operationalFiles.length, 1);
    assert.equal(contract.maximumRetainedGenerationsPerRegion, 2);
    assert.equal(contract.officialLimit.hardLimitBytes, 500_000_000);
    assert.equal(contract.safetyReserveBytes, 40_000_000);
    assert.match(outdoorCapacityAdmissionConstantsForTesting.contractSha256,
      /^[a-f0-9]{64}$/);
  });

  it("admits the measured retained-refresh projection with the reserve intact", async () => {
    const contract = await loadOutdoorCapacityContract(PROFILE_ID);
    const summary = evaluateOutdoorCapacityAdmission({
      contract,
      snapshot: snapshot(contract, {
        currentDatabaseBytes: 239_347_456,
        retainedImports: 2,
        retainedProjections: 1
      }),
      operation: "project"
    });
    assert.equal(summary.decision, "ADMITTED");
    assert.equal(summary.measurements.estimatedTransientPeakBytes, 453_060_352);
    assert.equal(
      summary.measurements.hardLimitBytes -
        summary.measurements.estimatedTransientPeakBytes,
      46_939_648
    );
    assert(summary.measurements.estimatedTransientPeakBytes +
      summary.measurements.safetyReserveBytes <=
      summary.measurements.hardLimitBytes);
  });

  it("refuses a transient peak that would consume the reserve", async () => {
    const contract = await loadOutdoorCapacityContract(PROFILE_ID);
    assert.throws(() => evaluateOutdoorCapacityAdmission({
      contract,
      snapshot: snapshot(contract, {
        currentDatabaseBytes: 250_000_000,
        retainedImports: 2,
        retainedProjections: 1
      }),
      operation: "project"
    }), decision("PLATFORM_LIMIT"));
  });

  it("refuses a third import and a third projection before mutation", async () => {
    const contract = await loadOutdoorCapacityContract(PROFILE_ID);
    assert.throws(() => evaluateOutdoorCapacityAdmission({
      contract,
      snapshot: snapshot(contract, {
        currentDatabaseBytes: 355_657_472,
        retainedImports: 2,
        retainedProjections: 2
      }),
      operation: "import"
    }), decision("GENERATION_LIMIT"));
    assert.throws(() => evaluateOutdoorCapacityAdmission({
      contract,
      snapshot: snapshot(contract, {
        currentDatabaseBytes: 239_347_456,
        retainedImports: 2,
        retainedProjections: 2
      }),
      operation: "project"
    }), decision("GENERATION_LIMIT"));
  });

  it("admits only an exact two-generation state for reviewed retirement", async () => {
    const contract = await loadOutdoorCapacityContract(PROFILE_ID);
    const accepted = evaluateOutdoorCapacityAdmission({
      contract,
      snapshot: snapshot(contract, {
        currentDatabaseBytes: 355_657_472,
        retainedImports: 2,
        retainedProjections: 2
      }),
      operation: "retire"
    });
    assert.equal(accepted.decision, "ADMITTED");
    assert.throws(() => evaluateOutdoorCapacityAdmission({
      contract,
      snapshot: snapshot(contract, {
        currentDatabaseBytes: 224_274_176,
        retainedImports: 1,
        retainedProjections: 1
      }),
      operation: "retire"
    }), decision("GENERATION_STATE_INVALID"));
  });

  it("fails closed on migration identity, profile identity, quarantine, and in-flight work", async () => {
    const contract = await loadOutdoorCapacityContract(PROFILE_ID);
    const cases = [
      [
        { migrations: contract.migrationPolicy.orderedVersions.slice(0, -1) },
        "DATABASE_IDENTITY_MISMATCH"
      ],
      [{ profileIdentitySha256: "0".repeat(64) }, "DATABASE_IDENTITY_MISMATCH"],
      [{ quarantines: 1 }, "QUARANTINE_PRESENT"],
      [{ inFlightImports: 1 }, "IN_FLIGHT_OPERATION"]
    ];
    for (const [change, expected] of cases) {
      assert.throws(() => evaluateOutdoorCapacityAdmission({
        contract,
        snapshot: snapshot(contract, change),
        operation: "import"
      }), decision(expected));
    }
  });

  it("holds and releases one database-minted admission lease", async () => {
    const contract = await loadOutdoorCapacityContract(PROFILE_ID);
    const calls = [];
    let releases = 0;
    const client = {
      async query(sql, values) {
        calls.push({ sql, values });
        if (sql.includes("pg_try_advisory_lock")) {
          return { rowCount: 1, rows: [{ acquired: true }] };
        }
        if (sql.includes("outdoor_capacity_activate_admission_v1")) {
          return {
            rowCount: 1,
            rows: [{ admission: {
              schemaVersion: 1,
              decision: "ADMITTED",
              snapshot: snapshot(contract)
            } }]
          };
        }
        if (sql.includes("outdoor_capacity_release_admission_v1")) {
          return { rowCount: 1, rows: [{ released: true }] };
        }
        if (sql.includes("pg_advisory_unlock")) {
          return { rowCount: 1, rows: [{ unlocked: true }] };
        }
        throw new Error("unexpected query");
      },
      release() { releases += 1; }
    };
    const lease = await acquireOutdoorCapacityAdmission({
      pool: { async connect() { return client; } },
      profileId: PROFILE_ID,
      regionId: REGION_ID,
      operation: "import"
    });
    assert.equal(lease.summary.decision, "ADMITTED");
    assert.equal(releases, 0);
    await lease.release();
    await lease.release();
    assert.equal(releases, 1);
    assert.equal(calls.filter(({ sql }) =>
      sql.includes("outdoor_capacity_activate_admission_v1")).length, 1);
    assert.equal(calls.filter(({ sql }) =>
      sql.includes("outdoor_capacity_release_admission_v1")).length, 1);
    assert.equal(calls.filter(({ sql }) => sql.includes("set_config")).length, 0);
    assert.equal(calls.filter(({ sql }) => sql.includes("pg_advisory_unlock")).length, 1);
  });

  it("assumes and resets only the reviewed owner role for retirement", async () => {
    const contract = await loadOutdoorCapacityContract(PROFILE_ID);
    const calls = [];
    let releases = 0;
    const client = {
      async query(sql, values) {
        calls.push({ sql, values });
        if (sql === "SET ROLE trailmind_app_owner" || sql === "RESET ROLE") {
          return { rowCount: null, rows: [] };
        }
        if (sql.includes("pg_try_advisory_lock")) {
          return { rowCount: 1, rows: [{ acquired: true }] };
        }
        if (sql.includes("outdoor_capacity_activate_admission_v1")) {
          return {
            rowCount: 1,
            rows: [{ admission: {
              schemaVersion: 1,
              decision: "ADMITTED",
              snapshot: snapshot(contract, {
                retainedImports: 2,
                retainedProjections: 2
              })
            } }]
          };
        }
        if (sql.includes("outdoor_capacity_release_admission_v1")) {
          return { rowCount: 1, rows: [{ released: true }] };
        }
        if (sql.includes("pg_advisory_unlock")) {
          return { rowCount: 1, rows: [{ unlocked: true }] };
        }
        throw new Error("unexpected query");
      },
      release() { releases += 1; }
    };
    const lease = await acquireOutdoorCapacityAdmission({
      pool: { async connect() { return client; } },
      profileId: PROFILE_ID,
      regionId: REGION_ID,
      operation: "retire"
    });
    await lease.release();
    assert.equal(calls[0].sql, "SET ROLE trailmind_app_owner");
    assert.equal(calls.at(-1).sql, "RESET ROLE");
    assert.equal(releases, 1);
  });

  it("destroys a pooled session when private lease cleanup cannot be proved", async () => {
    const contract = await loadOutdoorCapacityContract(PROFILE_ID);
    let releasedWith;
    const client = {
      async query(sql) {
        if (sql.includes("pg_try_advisory_lock")) {
          return { rowCount: 1, rows: [{ acquired: true }] };
        }
        if (sql.includes("outdoor_capacity_activate_admission_v1")) {
          return {
            rowCount: 1,
            rows: [{ admission: {
              schemaVersion: 1,
              decision: "ADMITTED",
              snapshot: snapshot(contract)
            } }]
          };
        }
        if (sql.includes("outdoor_capacity_release_admission_v1")) {
          throw new Error("lease_cleanup_failed");
        }
        if (sql.includes("pg_advisory_unlock")) {
          return { rowCount: 1, rows: [{ unlocked: true }] };
        }
        throw new Error("unexpected query");
      },
      release(error) { releasedWith = error; }
    };
    const lease = await acquireOutdoorCapacityAdmission({
      pool: { async connect() { return client; } },
      profileId: PROFILE_ID,
      regionId: REGION_ID,
      operation: "import"
    });
    await assert.rejects(lease.release(), /lease_cleanup_failed/);
    assert(releasedWith instanceof Error);
    assert.equal(releasedWith.message, "lease_cleanup_failed");
  });

  it("publishes bounded refusal fields without database identity or credentials", async () => {
    const contract = await loadOutdoorCapacityContract(PROFILE_ID);
    let caught;
    try {
      evaluateOutdoorCapacityAdmission({
        contract,
        snapshot: snapshot(contract, {
          currentDatabaseBytes: 250_000_000,
          retainedImports: 2,
          retainedProjections: 1
        }),
        operation: "project"
      });
    } catch (error) {
      caught = error;
    }
    assert(caught instanceof OutdoorCapacityAdmissionError);
    const serialized = JSON.stringify(caught.publicResult);
    assert.match(serialized, /PLATFORM_LIMIT/);
    assert.doesNotMatch(serialized, /postgres|password|hostname|databaseName|importId/i);
  });
});

function snapshot(contract, change = {}) {
  return {
    schemaVersion: 1,
    profileId: contract.profileId,
    profileIdentitySha256: contract.profileIdentitySha256,
    hardLimitBytes: contract.officialLimit.hardLimitBytes,
    safetyReserveBytes: contract.safetyReserveBytes,
    currentDatabaseBytes: 224_274_176,
    migrations: [...contract.migrationPolicy.orderedVersions],
    regionId: REGION_ID,
    activeImportId: "11111111-1111-4111-8111-111111111111",
    selectedImportId: "11111111-1111-4111-8111-111111111111",
    retainedImports: 1,
    inFlightImports: 0,
    retainedProjections: 1,
    inFlightProjections: 0,
    selectedImportProjections: 1,
    quarantines: 0,
    ...change
  };
}

function decision(expected) {
  return (error) =>
    error instanceof OutdoorCapacityAdmissionError &&
    error.decision === expected;
}
