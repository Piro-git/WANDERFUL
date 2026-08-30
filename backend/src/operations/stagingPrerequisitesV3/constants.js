export const PACKAGE_SCHEMA_VERSION = 3;
export const EXPECTED_MANIFEST_SCHEMA_VERSION = 1;
export const READINESS_SCHEMA_VERSION = 1;
export const SIGNED_RECEIPT_SCHEMA_VERSION = 1;
export const TARGET_PROJECT_NAME = "TrailMind Outdoor Staging V1";
export const AUDITOR_ROLE = "trailmind_phase1_v2_stats_auditor";
export const AUDITOR_LEDGER_FUNCTION =
  "trailmind_app.trailmind_auditor_migration_ledger_v1()";
export const SIGNATURE_DOMAIN =
  "trailmind.production-observer.admission.v2\n";

export const LIMITS = Object.freeze({
  arrayItems: 256,
  catalogAssertions: 64,
  catalogRowsPerQuery: 512,
  caBytes: 256 * 1024,
  depth: 32,
  jsonBytes: 256 * 1024,
  manifestBytes: 256 * 1024,
  outputBytes: 256 * 1024,
  privateKeyBytes: 16 * 1024,
  statementTimeoutMilliseconds: 5_000,
  lockTimeoutMilliseconds: 1_000,
  idleTransactionTimeoutMilliseconds: 10_000,
  stringCharacters: 64 * 1024,
  subprocessMilliseconds: 15_000
});

export const HEX_40 = /^[a-f0-9]{40}$/;
export const HEX_64 = /^[a-f0-9]{64}$/;
export const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const CANONICAL_UTC =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
export const SAFE_ID = /^[a-z][a-z0-9._:-]{0,127}$/;
export const SQL_IDENTIFIER = /^[a-z_][a-z0-9_]{0,62}$/;

export const ASSERTION_IDS = Object.freeze([
  "auditor.no_generic_mutation",
  "auditor.role_contract",
  "catalog.constraints",
  "catalog.default_acls",
  "catalog.extensions",
  "catalog.functions",
  "catalog.indexes",
  "catalog.migration_ledger_001_008",
  "catalog.policies",
  "catalog.relation_acls",
  "catalog.relations",
  "catalog.rls",
  "catalog.role_memberships",
  "catalog.roles",
  "catalog.schema_acls",
  "catalog.schemas",
  "catalog.unexpected_trailmind_objects_absent",
  "postgis.reviewed_topology"
]);

export const PIN_PATHS = Object.freeze([
  "artifactContract.key.keyId",
  "artifactContract.key.requiredPinnedPublicKeySpkiSha256",
  "auditorContract.connection.sslrootcertSha256",
  "staticGate.independentCatalogAssertionProgramSha256",
  "staticGate.independentExpectedManifestSha256"
]);
