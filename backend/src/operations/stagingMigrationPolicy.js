export const HISTORICAL_PORTABLE_MIGRATIONS_V1 = Object.freeze([
  "001_app_attest.sql",
  "002_outdoor_evidence.sql",
  "003_outdoor_research_graph.sql",
  "004_osm_outdoor_research_projection.sql",
  "005_outdoor_research_projection_geometry.sql",
  "006_outdoor_route_membership_point_index.sql",
  "007_routable_highlight_access_geography_index.sql",
  "008_outdoor_research_runtime_read_contract.sql"
]);

export const SUPABASE_POSTGIS_ISOLATION_MIGRATIONS_V2 = Object.freeze([
  "001_app_attest.sql",
  "002_outdoor_evidence.sql",
  "003_outdoor_research_graph.sql",
  "004_osm_outdoor_research_projection.sql",
  "005_outdoor_research_projection_geometry.sql",
  "006_outdoor_route_membership_point_index.sql",
  "007_routable_highlight_access_geography_index.sql",
  "009_supabase_postgis_isolated_runtime_read_contract.sql"
]);

export const MIGRATION_POLICIES = Object.freeze({
  "historical-portable-v1": HISTORICAL_PORTABLE_MIGRATIONS_V1,
  "supabase-postgis-isolation-v2": SUPABASE_POSTGIS_ISOLATION_MIGRATIONS_V2
});

export function requiredMigrationPolicy(env = process.env) {
  const policyId = env.TRAILMIND_MIGRATION_POLICY;
  if (
    typeof policyId !== "string" ||
    !Object.hasOwn(MIGRATION_POLICIES, policyId)
  ) throw new Error("trailmind_migration_policy_required");
  const migrations = MIGRATION_POLICIES[policyId];
  return Object.freeze({ policyId, migrations });
}
