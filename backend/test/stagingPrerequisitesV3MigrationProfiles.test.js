import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  GENERIC_POSTGRES_PROFILE_ID,
  MIGRATION_PROFILE_SCHEMA_VERSION,
  MIGRATION_PROFILES,
  SUPABASE_PHASE1_PROFILE_ID,
  TARGET_PROJECT_NAME,
  validateMigrationProfileSelection
} from "../src/operations/stagingPrerequisitesV3/index.js";

describe("staging prerequisites v3 migration profiles", () => {
  it("accepts only each exact schema-versioned ledger", () => {
    const generic = selection(GENERIC_POSTGRES_PROFILE_ID,
      "TrailMind Generic PostgreSQL Offline V1");
    const supabase = selection(SUPABASE_PHASE1_PROFILE_ID, TARGET_PROJECT_NAME);
    assert.equal(validateMigrationProfileSelection(generic).compatibility,
      "generic_postgresql_only");
    assert.equal(validateMigrationProfileSelection(supabase).compatibility,
      "supabase_phase1_v2");
    assert.deepEqual(generic.migrations.map(({ id }) => id),
      ["001", "002", "003", "004", "005", "006", "007", "008"]);
    assert.deepEqual(supabase.migrations.map(({ id }) => id),
      ["001", "002", "003", "004", "005", "006", "007", "009", "010"]);
  });

  it("binds the fixed Supabase target exclusively to supabase_phase1_v2", () => {
    assert.throws(() => validateMigrationProfileSelection(selection(
      GENERIC_POSTGRES_PROFILE_ID, TARGET_PROJECT_NAME
    )), hasCode("target_profile_binding"));
  });

  it("rejects 008 mixed with either Supabase runtime-boundary migration", () => {
    for (const id of ["009", "010"]) {
      const value = selection(GENERIC_POSTGRES_PROFILE_ID,
        "TrailMind Generic PostgreSQL Offline V1");
      value.migrations.push(structuredClone(
        MIGRATION_PROFILES[SUPABASE_PHASE1_PROFILE_ID].migrations.find(
          (migration) => migration.id === id
        )
      ));
      assert.throws(() => validateMigrationProfileSelection(value),
        hasCode("migration_runtime_boundary_conflict"));
    }
  });

  for (const profileId of [
    GENERIC_POSTGRES_PROFILE_ID, SUPABASE_PHASE1_PROFILE_ID
  ]) {
    it(`rejects mixing, omission, addition, reorder, path/hash drift and duplicates for ${profileId}`, () => {
      const target = profileId === SUPABASE_PHASE1_PROFILE_ID
        ? TARGET_PROJECT_NAME
        : "TrailMind Generic PostgreSQL Offline V1";
      const mutations = [
        (value) => { value.migrations.pop(); },
        (value) => { value.migrations.push(structuredClone(value.migrations.at(-1))); },
        (value) => {
          [value.migrations[0], value.migrations[1]] =
            [value.migrations[1], value.migrations[0]];
        },
        (value) => { value.migrations[0].path += ".drift"; },
        (value) => { value.migrations[0].sha256 = "0".repeat(64); },
        (value) => { value.migrations[1] = structuredClone(value.migrations[0]); }
      ];
      for (const mutate of mutations) {
        const value = selection(profileId, target);
        mutate(value);
        assert.throws(() => validateMigrationProfileSelection(value),
          (error) => error?.status === "blocked");
      }
    });
  }
});

function selection(profileId, targetProjectName) {
  return {
    migrations: structuredClone(MIGRATION_PROFILES[profileId].migrations),
    profileId,
    schemaVersion: MIGRATION_PROFILE_SCHEMA_VERSION,
    targetProjectName
  };
}

function hasCode(code) {
  return (error) => error?.code === code;
}
