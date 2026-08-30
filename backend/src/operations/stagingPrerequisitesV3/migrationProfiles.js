import { exactKeys } from "./canonicalJson.js";
import { TARGET_PROJECT_NAME } from "./constants.js";
import { blocked } from "./errors.js";

export const MIGRATION_PROFILE_SCHEMA_VERSION = 1;
export const GENERIC_POSTGRES_PROFILE_ID = "generic_postgres_v1";
export const SUPABASE_PHASE1_PROFILE_ID = "supabase_phase1_v2";

const COMMON = Object.freeze([
  migration("001", "001_app_attest.sql",
    "f25c5c712563d53abc926c34196e603b54d6ce7d414b5f22fdf95ec49ae95c16"),
  migration("002", "002_outdoor_evidence.sql",
    "750d715dc4662ca725a3c04de91c559e6dfc9455332be23eb95fa509dceafd7d"),
  migration("003", "003_outdoor_research_graph.sql",
    "79eaf76eea21c6a3476fb801cfae432bccdbc3260421dcfb9e123513b6bb3928"),
  migration("004", "004_osm_outdoor_research_projection.sql",
    "7a876c955740021ca173300409c97a869e1c6aebbdb8dffdf773295d39d7bbb3"),
  migration("005", "005_outdoor_research_projection_geometry.sql",
    "945688fdff722cfdab62f72fc7b9bd5c27335e10161054f3909e774094ae6bc8"),
  migration("006", "006_outdoor_route_membership_point_index.sql",
    "13ad98c4fc0fa19b27ad7a398bbaca8a6dfdfb1a29616e2de25c4a877843e8c4"),
  migration("007", "007_routable_highlight_access_geography_index.sql",
    "d3eb65d307f28e65bdaa234be7a6fc1cd7ceec47499ebd40e05b61fdb40657f7")
]);

const GENERIC_LEDGER = Object.freeze([
  ...COMMON,
  migration("008", "008_outdoor_research_runtime_read_contract.sql",
    "e568e6ea65bd0d6f96fd20f636efcbb42700c55856ea3f19d1955b6a9e415b32")
]);

const SUPABASE_LEDGER = Object.freeze([
  ...COMMON,
  migration("009", "009_supabase_postgis_isolated_runtime_read_contract.sql",
    "92f51e93280027b77081b2cc96beaf10c2c25ba225ebbf527e78239a50040294"),
  migration("010", "010_bounded_outdoor_import_schema_provisioning.sql",
    "62f23c605654fc3e58661646d376bf68cca8e95c0e9354dc9da6d77c765ef467")
]);

export const MIGRATION_PROFILES = deepFreeze({
  [GENERIC_POSTGRES_PROFILE_ID]: {
    compatibility: "generic_postgresql_only",
    migrations: GENERIC_LEDGER,
    profileId: GENERIC_POSTGRES_PROFILE_ID,
    schemaVersion: MIGRATION_PROFILE_SCHEMA_VERSION
  },
  [SUPABASE_PHASE1_PROFILE_ID]: {
    compatibility: "supabase_phase1_v2",
    migrations: SUPABASE_LEDGER,
    profileId: SUPABASE_PHASE1_PROFILE_ID,
    schemaVersion: MIGRATION_PROFILE_SCHEMA_VERSION
  }
});

export function migrationProfile(profileId) {
  const profile = MIGRATION_PROFILES[profileId];
  if (!profile) blocked("migration_profile");
  return profile;
}

export function validateMigrationProfileSelection(value) {
  exactKeys(value, [
    "migrations", "profileId", "schemaVersion", "targetProjectName"
  ], "migration_profile_selection_keys");
  if (value.schemaVersion !== MIGRATION_PROFILE_SCHEMA_VERSION ||
      typeof value.targetProjectName !== "string" ||
      value.targetProjectName.length < 1 || value.targetProjectName.length > 128) {
    blocked("migration_profile_selection");
  }
  const profile = migrationProfile(value.profileId);
  if (value.targetProjectName === TARGET_PROJECT_NAME &&
      value.profileId !== SUPABASE_PHASE1_PROFILE_ID) {
    blocked("target_profile_binding");
  }
  validateNoRuntimeBoundaryMix(value.migrations);
  if (!sameLedger(value.migrations, profile.migrations)) {
    blocked("migration_profile_ledger");
  }
  return profile;
}

export function assertSupabasePhase1TargetProfile({
  migrations,
  profileId,
  targetProjectName
}) {
  return validateMigrationProfileSelection({
    migrations,
    profileId,
    schemaVersion: MIGRATION_PROFILE_SCHEMA_VERSION,
    targetProjectName
  });
}

function migration(id, fileName, sha256) {
  return Object.freeze({
    id,
    path: `backend/migrations/${fileName}`,
    sha256
  });
}

function validateNoRuntimeBoundaryMix(values) {
  if (!Array.isArray(values)) blocked("migration_profile_ledger");
  const ids = values.map((item) => item?.id);
  if (ids.includes("008") && (ids.includes("009") || ids.includes("010"))) {
    blocked("migration_runtime_boundary_conflict");
  }
}

function sameLedger(actual, expected) {
  if (!Array.isArray(actual) || actual.length !== expected.length) return false;
  const paths = new Set();
  for (let index = 0; index < actual.length; index += 1) {
    const item = actual[index];
    try {
      exactKeys(item, ["id", "path", "sha256"], "migration_profile_item_keys");
    } catch {
      return false;
    }
    if (paths.has(item.path)) return false;
    paths.add(item.path);
    const wanted = expected[index];
    if (item.id !== wanted.id || item.path !== wanted.path ||
        item.sha256 !== wanted.sha256) return false;
  }
  return true;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}
