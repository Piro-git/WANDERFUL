export const STAGING_READINESS_SCHEMA_VERSION = 1;
export const STAGING_READINESS_PROOF_VERSION =
  "trailmind-staging-readiness-v1";
export const STAGING_READINESS_POLICY_VERSION =
  "trailmind-staging-readiness-policy-v2-supabase-postgis-isolation";
export const MAXIMUM_RECEIPT_BYTES = 524_288;
export const MAXIMUM_CLOCK_SKEW_MILLISECONDS = 5 * 60 * 1_000;
export const REGIONAL_FRESHNESS_THRESHOLD_DAYS = 14;

export const HISTORICAL_CANONICAL_MIGRATIONS_V1 = Object.freeze([
  "001_app_attest.sql",
  "002_outdoor_evidence.sql",
  "003_outdoor_research_graph.sql",
  "004_osm_outdoor_research_projection.sql",
  "005_outdoor_research_projection_geometry.sql",
  "006_outdoor_route_membership_point_index.sql",
  "007_routable_highlight_access_geography_index.sql",
  "008_outdoor_research_runtime_read_contract.sql"
]);

export const CANONICAL_MIGRATIONS = Object.freeze([
  "001_app_attest.sql",
  "002_outdoor_evidence.sql",
  "003_outdoor_research_graph.sql",
  "004_osm_outdoor_research_projection.sql",
  "005_outdoor_research_projection_geometry.sql",
  "006_outdoor_route_membership_point_index.sql",
  "007_routable_highlight_access_geography_index.sql",
  "009_supabase_postgis_isolated_runtime_read_contract.sql"
]);

export const CANONICAL_REGION_IDS = Object.freeze([
  "harz-v1",
  "innsbruck-alps-v1"
]);

export const CANCELLATION_CONTROL_ROLE_ID =
  "outdoor_research_cancellation_control_role";

export const CANCELLATION_CONTROL_PRIVILEGE_MANIFEST = Object.freeze({
  version: "cancellation-control-privileges-v1",
  canLogin: true,
  connectionLimit: 1,
  statementTimeoutMilliseconds: 1_000,
  inheritPrivileges: false,
  superuser: false,
  createDatabase: false,
  createRole: false,
  replication: false,
  bypassRls: false,
  membershipRoleIds: Object.freeze([]),
  ownedObjectCount: 0,
  schemaUsageIds: Object.freeze(["trailmind_control"]),
  tablePrivilegeIds: Object.freeze([]),
  sequencePrivilegeIds: Object.freeze([]),
  functionExecuteIds: Object.freeze([
    "trailmind_control.cancel_active_outdoor_research_backend_integer"
  ]),
  publicDataApiExposed: false,
  directBusinessDataRead: false,
  businessDataMutation: false,
  directPgCancelBackendExecute: false,
  targetRoleId: "outdoor_research_runtime_role",
  targetRestrictionEnforced: true,
  productQueryExecutionDenied: true,
  selfPrivilegeEscalationDenied: true
});

export const CANONICAL_ROLE_CONTRACTS = Object.freeze([
  Object.freeze({
    id: "platform_provisioner",
    purpose: "provision_staging_platform",
    exactPrivilegeManifest: null
  }),
  Object.freeze({
    id: "migration_role",
    purpose: "apply_reviewed_migrations",
    exactPrivilegeManifest: null
  }),
  Object.freeze({
    id: "regional_import_role",
    purpose: "import_approved_regional_sources",
    exactPrivilegeManifest: null
  }),
  Object.freeze({
    id: "projection_role",
    purpose: "project_reviewed_active_imports",
    exactPrivilegeManifest: null
  }),
  Object.freeze({
    id: "app_security_runtime_role",
    purpose: "serve_durable_app_attest_transactions",
    exactPrivilegeManifest: null
  }),
  Object.freeze({
    id: "outdoor_research_runtime_role",
    purpose: "execute_five_bounded_research_reads",
    exactPrivilegeManifest: null
  }),
  Object.freeze({
    id: CANCELLATION_CONTROL_ROLE_ID,
    purpose: "cancel_only_active_outdoor_research_backend",
    exactPrivilegeManifest: CANCELLATION_CONTROL_PRIVILEGE_MANIFEST
  }),
  Object.freeze({
    id: "pruner_role",
    purpose: "prune_expired_app_attest_state",
    exactPrivilegeManifest: null
  }),
  Object.freeze({
    id: "readonly_auditor_role",
    purpose: "read_sanitized_release_evidence",
    exactPrivilegeManifest: null
  })
]);

export const CANONICAL_ROLE_IDS = Object.freeze(
  CANONICAL_ROLE_CONTRACTS.map((contract) => contract.id)
);

export const CANONICAL_ROLE_SEPARATION_GUARD_IDS = Object.freeze([
  "backup_restore_role",
  "anon",
  "authenticated",
  "service_role",
  "postgres_administrator",
  "managed_platform_administrator"
]);

export const CANONICAL_FLAG_BINDINGS = Object.freeze([
  ["ios_outdoor_evidence", "OUTDOOR_EVIDENCE_ENABLED"],
  ["ios_research_guided_planning", "RESEARCH_GUIDED_PLANNING_ENABLED"],
  ["ios_routable_highlight_access", "ROUTABLE_HIGHLIGHT_ACCESS_ENABLED"],
  ["backend_outdoor_evidence", "OUTDOOR_EVIDENCE_PROVIDER_ENABLED"],
  ["backend_research_planning", "OUTDOOR_RESEARCH_PLANNING_ENABLED"],
  ["backend_routable_highlight_access", "OUTDOOR_ROUTABLE_HIGHLIGHT_ACCESS_ENABLED"],
  ["backend_route_provider", "ROUTE_PROVIDER_ENABLED"],
  ["backend_intent_provider", "INTENT_PROVIDER_ENABLED"],
  ["backend_research_insecure_local", "OUTDOOR_RESEARCH_PLANNING_ALLOW_INSECURE_LOCAL"],
  ["backend_route_insecure_local", "ROUTE_ALLOW_INSECURE_LOCAL_ROUTING"],
  ["backend_intent_insecure_local", "INTENT_ALLOW_INSECURE_LOCAL_PARSING"],
  ["backend_app_attest_in_memory", "APP_ATTEST_ALLOW_IN_MEMORY"],
  ["backend_intent_deterministic_mock", "INTENT_ALLOW_DETERMINISTIC_MOCK"]
]);

export const CANONICAL_PERFORMANCE_OPERATIONS = Object.freeze([
  "corridor_query",
  "route_membership_query",
  "trail_access_query"
]);

export const CANONICAL_RESTORE_RECONCILIATIONS = Object.freeze([
  "migration_ledger",
  "schema_index_rls",
  "app_attest_counter_replay",
  "regional_pointers_projections",
  "application_readiness"
]);

export const CANONICAL_ALERT_IDS = Object.freeze([
  "feature_gate_zero_work",
  "evidence_stale_or_unavailable",
  "postgis_latency",
  "cancellation_anomaly",
  "receipt_integrity",
  "app_attest_environment_mismatch",
  "runtime_unavailable"
]);

export const CANONICAL_OUTAGE_IDS = Object.freeze([
  "database_unavailable",
  "database_timeout",
  "monitoring_unavailable"
]);

export const CANONICAL_GATE_DEFINITIONS = Object.freeze([
  {
    id: "candidate_identity",
    caseIds: [
      "git_candidate_attestation",
      "policy_contract_attestation",
      "historical_receipts_immutable"
    ]
  },
  {
    id: "production_isolation",
    caseIds: [
      "staging_origin_isolation",
      "supabase_project_isolation",
      "candidate_cross_binding"
    ]
  },
  {
    id: "migration_repeatability",
    caseIds: [
      "migration_ledger_supabase_postgis_isolation_v2",
      "migration_second_run_noop",
      "schema_rls_index_digest"
    ]
  },
  {
    id: "least_privilege",
    caseIds: [
      "separated_role_attributes",
      "grants_denied_operations",
      "rls_data_api_denial",
      "runtime_function_boundary",
      "cancellation_control_role_contract"
    ]
  },
  {
    id: "regional_data",
    caseIds: [
      "harz_import",
      "harz_projection",
      "innsbruck_import",
      "innsbruck_projection",
      "cross_region_isolation",
      "import_projection_cleanup"
    ]
  },
  {
    id: "index_transaction_performance",
    caseIds: [
      "gist_index_plan",
      "latency_distribution",
      "cancellation_pool_recovery",
      "cancellation_control_target_and_mutation_denial"
    ]
  },
  {
    id: "backup_restore",
    caseIds: [
      "backup_policy_identity",
      "restore_reconciliation"
    ]
  },
  {
    id: "https_startup",
    caseIds: [
      "https_certificate",
      "dependency_free_liveness",
      "readiness_semantics",
      "startup_preflight",
      "non_root_runtime_image"
    ]
  },
  {
    id: "lifecycle_rollback",
    caseIds: [
      "graceful_drain",
      "restart_recovery",
      "deployment_rollback"
    ]
  },
  {
    id: "monitoring_alerts",
    caseIds: [
      "monitoring_privacy_pipeline",
      "alerts_configured_tested"
    ]
  },
  {
    id: "outage_fail_closed",
    caseIds: [
      "database_outage_fail_closed",
      "readiness_recovery",
      "optional_monitoring_outage"
    ]
  },
  {
    id: "provider_containment",
    caseIds: [
      "exact_feature_flags_false",
      "provider_disabled_zero_work",
      "provider_ledger_zero"
    ]
  },
  {
    id: "privacy_cleanup",
    caseIds: [
      "privacy_redaction_scan",
      "cleanup_residual_state"
    ]
  },
  {
    id: "physical_proof_admission",
    caseIds: ["staging_prerequisite_reconciliation"]
  }
]);

export const CANONICAL_CASES = Object.freeze(
  CANONICAL_GATE_DEFINITIONS.flatMap((gate) =>
    gate.caseIds.map((id) => Object.freeze({ id, gateId: gate.id }))
  )
);

export const LIVE_OBSERVATION_CASE_IDS = Object.freeze(
  CANONICAL_CASES
    .map((item) => item.id)
    .filter((id) => !new Set([
      "git_candidate_attestation",
      "policy_contract_attestation",
      "historical_receipts_immutable",
      "staging_prerequisite_reconciliation"
    ]).has(id))
);

export const POLICY_SOURCE_PATHS = Object.freeze([
  "backend/evaluation/stagingReadinessV1/constants.js",
  "backend/evaluation/stagingReadinessV1/serialization.js",
  "backend/evaluation/stagingReadinessV1/validation.js",
  "backend/evaluation/stagingReadinessV1/policy.js",
  "backend/evaluation/stagingReadinessV1/observations.js",
  "backend/evaluation/stagingReadinessV1/roleReport.js",
  "backend/evaluation/stagingReadinessV1/contract.js",
  "backend/evaluation/stagingReadinessV1/gitEvidence.js",
  "backend/evaluation/stagingReadinessV1/offlineHarness.js",
  "backend/evaluation/stagingReadinessV1/io.js",
  "backend/scripts/run-staging-readiness-v1.js",
  "docs/operations/closed-beta-readiness-v1/go-no-go-checklist-v1.json",
  "docs/operations/closed-beta-readiness-v1/feature-flag-state-matrix-v1.json",
  "docs/operations/closed-beta-readiness-v1/SOURCE_EVIDENCE_MANIFEST_V1.json",
  "docs/operations/closed-beta-readiness-v1/STAGING_PROVISIONING_RUNBOOK_V1.md",
  "docs/operations/closed-beta-readiness-v1/ROLLBACK_AND_INCIDENT_RESPONSE_V1.md",
  "docs/operations/closed-beta-readiness-v1/OBSERVABILITY_AND_PRIVACY_V1.md",
  "docs/operations/closed-beta-readiness-v1/V4_OPERATIONAL_PROTOCOL.md",
  "docs/operations/closed-beta-readiness-v1/V4_PROOF_RUN_CLOCK_CONTRACT.md",
  "docs/operations/closed-beta-readiness-v1/V4_PROOF_RUN_IDENTITY_CONTRACT.md",
  "docs/release/app-store-v1/RELEASE_BLOCKERS_V1.json",
  "backend/docs/outdoor-research-runtime-read-boundary.md",
  "docs/OUTDOOR_MAPPED_ROUTE_MEMBERSHIP_PERFORMANCE_V1.md",
  "backend/config/outdoor-regions/harz-v1.json",
  "backend/config/outdoor-regions/harz-v1.geojson",
  "backend/config/outdoor-regions/innsbruck-alps-v1.json",
  "backend/config/outdoor-regions/innsbruck-alps-v1.geojson",
  ...CANONICAL_MIGRATIONS.map((name) => `backend/migrations/${name}`)
]);

export const REVIEWED_THRESHOLDS = Object.freeze({
  regionalFreshnessDays: 14,
  postgisMinimumMajor: 3,
  postgisMinimumMinor: 2,
  statementTimeoutMilliseconds: 2_500,
  routeMembershipP95Milliseconds: 1_500,
  reviewedMeasurementMaximumMilliseconds: 2_000,
  runtimeReadFunctionCount: 5,
  cancellationCaseCount: 3
});

export const HISTORICAL_V4_RECEIPT_PATTERN =
  /^docs\/release\/OUTDOOR_ADVENTURE_TARGETED_LIVE_ROUTE_QUALITY_PROOF_V4(?:_ATTEMPT_(?:2|3|4|5|10|11|12))?\.(?:md|summary\.json)$/;

export const ATTEMPT_13_PATH_PATTERN =
  /OUTDOOR_ADVENTURE_TARGETED_LIVE_ROUTE_QUALITY_PROOF_V4_ATTEMPT_13/;
