import {
  ASSERTION_IDS,
  AUDITOR_LEDGER_FUNCTION,
  AUDITOR_ROLE,
  LIMITS,
  PACKAGE_SCHEMA_VERSION
} from "./constants.js";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  canonicalJson,
  canonicalSha256,
  exactKeys,
  sha256Bytes
} from "./canonicalJson.js";
import { blocked } from "./errors.js";
import { validateExpectedManifest } from "./expectedManifest.js";
import { readSafeRegularFile } from "./safeFiles.js";

const packageDirectory = dirname(fileURLToPath(import.meta.url));
const PROGRAM_SOURCE_FILES = Object.freeze([
  "auditorLifecycle.js",
  "canonicalJson.js",
  "catalogAssertion.js",
  "constants.js",
  "errors.js",
  "expectedManifest.js",
  "safeFiles.js"
]);

const BEGIN_READ_ONLY =
  "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY";
const SET_STATEMENT_TIMEOUT =
  `SET LOCAL statement_timeout = '${LIMITS.statementTimeoutMilliseconds}ms'`;
const SET_LOCK_TIMEOUT =
  `SET LOCAL lock_timeout = '${LIMITS.lockTimeoutMilliseconds}ms'`;
const SET_IDLE_TIMEOUT =
  "SET LOCAL idle_in_transaction_session_timeout = " +
  `'${LIMITS.idleTransactionTimeoutMilliseconds}ms'`;
const SET_SEARCH_PATH = "SET LOCAL search_path = pg_catalog, pg_temp";
const ROLLBACK = "ROLLBACK";

export const CATALOG_ASSERTION_QUERY = String.raw`
WITH manifest AS (
  SELECT $1::jsonb AS value
), expected_migrations AS (
  SELECT item->>'path' AS path,
         pg_catalog.regexp_replace(item->>'path', '^.*/', '') AS version,
         ordinality
    FROM manifest,
         LATERAL pg_catalog.jsonb_array_elements(
           value->'migrationLedger'
         ) WITH ORDINALITY AS source(item, ordinality)
), expected_extensions AS (
  SELECT item->>'name' AS name,
         item->>'schema' AS schema_name,
         item->>'schemaOwner' AS schema_owner,
         ARRAY(SELECT pg_catalog.jsonb_array_elements_text(
           item->'allowedOwners'
         ) ORDER BY 1) AS allowed_owners
    FROM manifest,
         LATERAL pg_catalog.jsonb_array_elements(
           value->'catalog'->'extensions'
         ) AS source(item)
), expected_schemas AS (
  SELECT item->>'name' AS name,
         ARRAY(SELECT pg_catalog.jsonb_array_elements_text(
           item->'allowedOwners'
         ) ORDER BY 1) AS allowed_owners
    FROM manifest,
         LATERAL pg_catalog.jsonb_array_elements(
           value->'catalog'->'schemas'
         ) AS source(item)
), expected_relations AS (
  SELECT pg_catalog.split_part(identity, ':', 1) AS identity,
         pg_catalog.split_part(identity, ':', 2) AS kind
    FROM manifest,
         LATERAL pg_catalog.jsonb_array_elements_text(
           value->'catalog'->'relations'
         ) AS source(identity)
), expected_functions AS (
  SELECT item->>'identity' AS identity,
         item->>'owner' AS owner,
         (item->>'securityDefiner')::boolean AS security_definer
    FROM manifest,
         LATERAL pg_catalog.jsonb_array_elements(
           value->'catalog'->'functions'
         ) AS source(item)
), expected_indexes AS (
  SELECT identity
    FROM manifest,
         LATERAL pg_catalog.jsonb_array_elements_text(
           value->'catalog'->'indexes'
         ) AS source(identity)
), expected_constraints AS (
  SELECT identity
    FROM manifest,
         LATERAL pg_catalog.jsonb_array_elements_text(
           value->'catalog'->'constraints'
         ) AS source(identity)
), expected_policies AS (
  SELECT item->>'identity' AS identity,
         item->>'command' AS command,
         item->'roles' AS roles,
         item->>'usingExpression' AS using_expression,
         item->>'withCheckExpression' AS with_check_expression
    FROM manifest,
         LATERAL pg_catalog.jsonb_array_elements(
           value->'catalog'->'policies'
         ) AS source(item)
), expected_roles AS (
  SELECT item->>'name' AS name,
         (item->>'canLogin')::boolean AS can_login,
         (item->>'inherit')::boolean AS inherit,
         (item->>'connectionLimit')::integer AS connection_limit
    FROM manifest,
         LATERAL pg_catalog.jsonb_array_elements(
           value->'catalog'->'roleRules'
         ) AS source(item)
), checks AS (
  SELECT 'catalog.migration_ledger_001_008'::text AS id,
         COALESCE((
           SELECT pg_catalog.array_agg(ledger.version ORDER BY ledger.version)
             FROM ${AUDITOR_LEDGER_FUNCTION} ledger
         ), ARRAY[]::text[]) = COALESCE((
           SELECT pg_catalog.array_agg(version ORDER BY ordinality)
             FROM expected_migrations
         ), ARRAY[]::text[]) AS pass
  UNION ALL
  SELECT 'catalog.extensions',
         NOT EXISTS (
           SELECT 1 FROM expected_extensions expected
            WHERE NOT EXISTS (
              SELECT 1 FROM pg_catalog.pg_extension extension
              JOIN pg_catalog.pg_namespace namespace
                ON namespace.oid = extension.extnamespace
              JOIN pg_catalog.pg_roles owner ON owner.oid = extension.extowner
              JOIN pg_catalog.pg_roles schema_owner
                ON schema_owner.oid = namespace.nspowner
             WHERE extension.extname = expected.name
               AND namespace.nspname = expected.schema_name
               AND owner.rolname = ANY(expected.allowed_owners)
               AND schema_owner.rolname = expected.schema_owner
            )
         )
  UNION ALL
  SELECT 'catalog.schemas',
         NOT EXISTS (
           SELECT 1 FROM expected_schemas expected
            WHERE NOT EXISTS (
              SELECT 1 FROM pg_catalog.pg_namespace namespace
              JOIN pg_catalog.pg_roles owner ON owner.oid = namespace.nspowner
             WHERE namespace.nspname = expected.name
               AND owner.rolname = ANY(expected.allowed_owners)
            )
         )
  UNION ALL
  SELECT 'catalog.relations',
         COALESCE((
           SELECT pg_catalog.array_agg(
             namespace.nspname || '.' || relation.relname || ':' ||
             CASE relation.relkind WHEN 'r' THEN 'table' WHEN 'v' THEN 'view' END
             ORDER BY namespace.nspname, relation.relname
           )
             FROM pg_catalog.pg_class relation
             JOIN pg_catalog.pg_namespace namespace
               ON namespace.oid = relation.relnamespace
            WHERE namespace.nspname = ANY(ARRAY['trailmind_app','trailmind_control'])
              AND relation.relkind IN ('r','v')
         ), ARRAY[]::text[]) = COALESCE((
           SELECT pg_catalog.array_agg(identity || ':' || kind ORDER BY identity)
             FROM expected_relations
         ), ARRAY[]::text[])
  UNION ALL
  SELECT 'catalog.functions',
         NOT EXISTS (
           SELECT 1 FROM expected_functions expected
            WHERE NOT EXISTS (
              SELECT 1 FROM pg_catalog.pg_proc procedure
              JOIN pg_catalog.pg_namespace namespace
                ON namespace.oid = procedure.pronamespace
              JOIN pg_catalog.pg_roles owner ON owner.oid = procedure.proowner
             WHERE procedure.oid = pg_catalog.to_regprocedure(expected.identity)
               AND owner.rolname = expected.owner
               AND procedure.prosecdef = expected.security_definer
               AND pg_catalog.has_function_privilege(
                 '${AUDITOR_ROLE}', procedure.oid, 'EXECUTE'
               ) = (expected.identity = '${AUDITOR_LEDGER_FUNCTION}')
               AND (
                 NOT expected.security_definer OR
                 NOT EXISTS (
                   SELECT 1 FROM pg_catalog.aclexplode(
                     COALESCE(
                       procedure.proacl,
                       pg_catalog.acldefault('f', procedure.proowner)
                     )
                   ) privilege
                    WHERE privilege.grantee = 0
                      AND privilege.privilege_type = 'EXECUTE'
                 )
               )
               AND (
                 NOT expected.security_definer OR
                 EXISTS (
                   SELECT 1 FROM pg_catalog.unnest(procedure.proconfig) setting
                    WHERE setting LIKE 'search_path=%'
                      AND setting NOT LIKE '%public%'
                 )
               )
            )
         )
  UNION ALL
  SELECT 'catalog.indexes',
         NOT EXISTS (
           SELECT 1 FROM expected_indexes expected
            WHERE NOT EXISTS (
              SELECT 1 FROM pg_catalog.pg_class index_relation
              JOIN pg_catalog.pg_namespace namespace
                ON namespace.oid = index_relation.relnamespace
              JOIN pg_catalog.pg_index index_record
                ON index_record.indexrelid = index_relation.oid
              JOIN pg_catalog.pg_am access_method
                ON access_method.oid = index_relation.relam
             WHERE namespace.nspname || '.' || index_relation.relname =
                   expected.identity
               AND index_record.indisvalid
               AND index_record.indisready
               AND access_method.amname IN ('btree','gist')
            )
         )
  UNION ALL
  SELECT 'catalog.constraints',
         NOT EXISTS (
           SELECT 1 FROM expected_constraints expected
            WHERE NOT EXISTS (
              SELECT 1 FROM pg_catalog.pg_constraint constraint_record
              JOIN pg_catalog.pg_namespace namespace
                ON namespace.oid = constraint_record.connamespace
             WHERE namespace.nspname || '.' || constraint_record.conname =
                   expected.identity
               AND constraint_record.contype IN ('c','f')
               AND constraint_record.convalidated
            )
         )
  UNION ALL
  SELECT 'catalog.rls',
         NOT EXISTS (
           SELECT 1 FROM expected_relations expected
            WHERE expected.kind = 'table'
              AND expected.identity <> 'trailmind_app.trailmind_schema_migrations'
              AND NOT EXISTS (
                SELECT 1 FROM pg_catalog.pg_class relation
                 WHERE relation.oid = pg_catalog.to_regclass(expected.identity)
                   AND relation.relrowsecurity
              )
         )
  UNION ALL
  SELECT 'catalog.policies',
         COALESCE((
           SELECT pg_catalog.array_agg(
             policy.schemaname || '.' || policy.tablename || ':' ||
             policy.policyname || '|' || policy.cmd || '|' ||
             pg_catalog.array_to_string(policy.roles, ',')
             ORDER BY policy.schemaname, policy.tablename, policy.policyname
           )
             FROM pg_catalog.pg_policies policy
            WHERE policy.schemaname = 'trailmind_app'
         ), ARRAY[]::text[]) = COALESCE((
           SELECT pg_catalog.array_agg(
             identity || '|' || command || '|' ||
             pg_catalog.array_to_string(
               ARRAY(SELECT pg_catalog.jsonb_array_elements_text(roles)), ','
             ) ORDER BY identity
           ) FROM expected_policies
         ), ARRAY[]::text[])
         AND NOT EXISTS (
           SELECT 1 FROM expected_policies expected
            WHERE NOT EXISTS (
              SELECT 1 FROM pg_catalog.pg_policies policy
               WHERE policy.schemaname || '.' || policy.tablename || ':' ||
                     policy.policyname = expected.identity
                 AND COALESCE(
                   pg_catalog.regexp_replace(policy.qual, '\s+', '', 'g'),
                   '<null>'
                 ) = COALESCE(expected.using_expression, '<null>')
                 AND COALESCE(
                   pg_catalog.regexp_replace(policy.with_check, '\s+', '', 'g'),
                   '<null>'
                 ) = COALESCE(expected.with_check_expression, '<null>')
            )
         )
  UNION ALL
  SELECT 'catalog.schema_acls',
         NOT EXISTS (
           SELECT 1 FROM expected_schemas expected
           CROSS JOIN (VALUES
             ('public'), ('anon'), ('authenticated'), ('service_role'),
             ('trailmind_phase1_v2_stats_auditor')
           ) denied(role_name)
            WHERE pg_catalog.has_schema_privilege(
              denied.role_name, expected.name, 'CREATE'
            ) OR (
              pg_catalog.has_schema_privilege(
                denied.role_name, expected.name, 'USAGE'
              ) AND NOT (
                denied.role_name = '${AUDITOR_ROLE}' AND
                expected.name = 'trailmind_app'
              )
            ) OR (
              denied.role_name = '${AUDITOR_ROLE}' AND
              expected.name = 'trailmind_app' AND
              NOT pg_catalog.has_schema_privilege(
                denied.role_name, expected.name, 'USAGE'
              )
            )
         )
  UNION ALL
  SELECT 'catalog.relation_acls',
         NOT EXISTS (
           SELECT 1 FROM expected_relations expected
           CROSS JOIN (VALUES
             ('public'), ('anon'), ('authenticated'), ('service_role'),
             ('trailmind_phase1_v2_stats_auditor')
           ) denied(role_name)
            WHERE expected.kind = 'table' AND (
              pg_catalog.has_table_privilege(
                denied.role_name, expected.identity, 'SELECT'
              ) OR pg_catalog.has_table_privilege(
                denied.role_name, expected.identity,
                'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
              )
            )
         )
  UNION ALL
  SELECT 'catalog.default_acls',
         NOT EXISTS (
           SELECT 1 FROM pg_catalog.pg_default_acl default_acl
           JOIN pg_catalog.pg_roles owner ON owner.oid = default_acl.defaclrole
           LEFT JOIN pg_catalog.pg_namespace namespace
             ON namespace.oid = default_acl.defaclnamespace
           CROSS JOIN LATERAL pg_catalog.aclexplode(default_acl.defaclacl) privilege
          WHERE owner.rolname IN ('trailmind_app_owner','trailmind_control_owner')
            AND COALESCE(namespace.nspname, '') IN (
              '', 'trailmind_app', 'trailmind_control'
            )
            AND privilege.grantee = 0
         )
  UNION ALL
  SELECT 'catalog.role_memberships',
         COALESCE((
           SELECT pg_catalog.array_agg(
             granted.rolname || '->' || member.rolname || ':' ||
             membership.admin_option::text || ':' ||
             membership.inherit_option::text || ':' ||
             membership.set_option::text
             ORDER BY granted.rolname, member.rolname
           )
             FROM pg_catalog.pg_auth_members membership
             JOIN pg_catalog.pg_roles granted ON granted.oid = membership.roleid
             JOIN pg_catalog.pg_roles member ON member.oid = membership.member
            WHERE member.rolname IN (
              SELECT name FROM expected_roles
              UNION ALL SELECT '${AUDITOR_ROLE}'
            )
         ), ARRAY[]::text[]) = ARRAY[
           'pg_read_all_stats->${AUDITOR_ROLE}:false:false:true',
           'pg_signal_backend->trailmind_control_owner:false:true:false',
           'trailmind_app_owner->migration_role:false:false:true'
         ]::text[]
  UNION ALL
  SELECT 'catalog.roles',
         NOT EXISTS (
           SELECT 1 FROM expected_roles expected
            WHERE NOT EXISTS (
              SELECT 1 FROM pg_catalog.pg_roles role_record
               WHERE role_record.rolname = expected.name
                 AND role_record.rolcanlogin = expected.can_login
                 AND role_record.rolinherit = expected.inherit
                 AND role_record.rolconnlimit = expected.connection_limit
                 AND NOT role_record.rolsuper
                 AND NOT role_record.rolcreatedb
                 AND NOT role_record.rolcreaterole
                 AND NOT role_record.rolreplication
                 AND NOT role_record.rolbypassrls
            )
         )
  UNION ALL
  SELECT 'auditor.role_contract',
         EXISTS (
           SELECT 1 FROM pg_catalog.pg_roles role_record
            WHERE role_record.rolname = '${AUDITOR_ROLE}'
              AND role_record.rolcanlogin
              AND NOT role_record.rolinherit
              AND NOT role_record.rolsuper
              AND NOT role_record.rolcreatedb
              AND NOT role_record.rolcreaterole
              AND NOT role_record.rolreplication
              AND NOT role_record.rolbypassrls
              AND role_record.rolconnlimit = 1
              AND role_record.rolvaliduntil IS NOT NULL
              AND role_record.rolvaliduntil > pg_catalog.clock_timestamp()
              AND 'default_transaction_read_only=on' = ANY(role_record.rolconfig)
         )
  UNION ALL
  SELECT 'auditor.no_generic_mutation',
         NOT pg_catalog.has_database_privilege(
           '${AUDITOR_ROLE}', pg_catalog.current_database(), 'CREATE'
         ) AND NOT pg_catalog.has_database_privilege(
           '${AUDITOR_ROLE}', pg_catalog.current_database(), 'TEMPORARY'
         ) AND NOT EXISTS (
          SELECT 1 FROM expected_schemas expected
            WHERE pg_catalog.has_schema_privilege(
              '${AUDITOR_ROLE}', expected.name, 'CREATE'
            ) OR (
              expected.name <> 'trailmind_app' AND
              pg_catalog.has_schema_privilege(
                '${AUDITOR_ROLE}', expected.name, 'USAGE'
              )
            )
         ) AND NOT EXISTS (
           SELECT 1 FROM pg_catalog.pg_class relation
           JOIN pg_catalog.pg_namespace namespace
             ON namespace.oid = relation.relnamespace
          WHERE namespace.nspname NOT LIKE 'pg_%'
            AND namespace.nspname <> 'information_schema'
            AND relation.relkind IN ('r','p','v','m','f')
            AND pg_catalog.has_table_privilege(
              '${AUDITOR_ROLE}', relation.oid,
              'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
            )
         )
  UNION ALL
  SELECT 'postgis.reviewed_topology',
         EXISTS (
           SELECT 1 FROM pg_catalog.pg_extension extension
           JOIN pg_catalog.pg_namespace namespace
             ON namespace.oid = extension.extnamespace
           JOIN pg_catalog.pg_roles owner ON owner.oid = extension.extowner
           JOIN pg_catalog.pg_roles schema_owner
             ON schema_owner.oid = namespace.nspowner
          WHERE extension.extname = 'postgis'
            AND namespace.nspname = 'trailmind_gis'
            AND owner.rolname IN ('postgres','supabase_admin')
            AND schema_owner.rolname = 'postgres'
         ) AND NOT EXISTS (
           SELECT 1 FROM pg_catalog.pg_extension extension
           JOIN pg_catalog.pg_depend dependency
             ON dependency.refobjid = extension.oid AND dependency.deptype = 'e'
           JOIN pg_catalog.pg_proc procedure
             ON dependency.classid = 'pg_catalog.pg_proc'::pg_catalog.regclass
            AND dependency.objid = procedure.oid
           JOIN pg_catalog.pg_namespace namespace
             ON namespace.oid = procedure.pronamespace
          WHERE extension.extname = 'postgis'
            AND namespace.nspname <> 'trailmind_gis'
         )
  UNION ALL
  SELECT 'catalog.unexpected_trailmind_objects_absent',
         COALESCE((
           SELECT pg_catalog.array_agg(namespace.nspname ORDER BY namespace.nspname)
             FROM pg_catalog.pg_namespace namespace
            WHERE namespace.nspname LIKE 'trailmind\_%' ESCAPE '\'
         ), ARRAY[]::text[]) = COALESCE((
           SELECT pg_catalog.array_agg(name ORDER BY name) FROM expected_schemas
         ), ARRAY[]::text[])
         AND NOT EXISTS (
           SELECT 1 FROM pg_catalog.pg_proc procedure
           JOIN pg_catalog.pg_namespace namespace
             ON namespace.oid = procedure.pronamespace
          WHERE namespace.nspname IN ('trailmind_app','trailmind_control')
            AND NOT EXISTS (
              SELECT 1 FROM expected_functions expected
               WHERE procedure.oid = pg_catalog.to_regprocedure(expected.identity)
            )
         )
)
SELECT id, pass FROM checks ORDER BY id
`;

const PROGRAM = Object.freeze({
  resultContract: {
    assertionIds: ASSERTION_IDS,
    maximumRows: LIMITS.catalogAssertions,
    shape: ["id", "pass"]
  },
  schemaVersion: PACKAGE_SCHEMA_VERSION,
  statements: [
    BEGIN_READ_ONLY,
    SET_STATEMENT_TIMEOUT,
    SET_LOCK_TIMEOUT,
    SET_IDLE_TIMEOUT,
    SET_SEARCH_PATH,
    CATALOG_ASSERTION_QUERY,
    ROLLBACK
  ],
  transactionMode: "repeatable-read-read-only"
});

export function catalogAssertionProgram() {
  return PROGRAM;
}

export function catalogAssertionProgramSha256() {
  return canonicalSha256(catalogAssertionProgramDigestContract());
}

export function catalogAssertionProgramDigestContract() {
  return Object.freeze({
    program: PROGRAM,
    sourceFiles: PROGRAM_SOURCE_FILES.map((name) => Object.freeze({
      name,
      sha256: sha256Bytes(readSafeRegularFile(resolve(packageDirectory, name), {
        maximumBytes: LIMITS.manifestBytes
      }))
    }))
  });
}

export async function runCatalogAssertions({ client, expectedManifest }) {
  validateExpectedManifest(expectedManifest);
  if (!client || typeof client.query !== "function") blocked("catalog_client");
  let began = false;
  try {
    await queryExact(client, BEGIN_READ_ONLY);
    began = true;
    await queryExact(client, SET_STATEMENT_TIMEOUT);
    await queryExact(client, SET_LOCK_TIMEOUT);
    await queryExact(client, SET_IDLE_TIMEOUT);
    await queryExact(client, SET_SEARCH_PATH);
    const response = await client.query({
      name: "trailmind-staging-prerequisites-v3-catalog-v1",
      text: CATALOG_ASSERTION_QUERY,
      values: [canonicalJson(expectedManifest)]
    });
    const assertions = validateAssertionRows(response);
    await queryExact(client, ROLLBACK);
    began = false;
    if (assertions.some(({ pass }) => pass !== true)) blocked("catalog_mismatch");
    const result = {
      assertions,
      programSha256: catalogAssertionProgramSha256(),
      resultSchemaVersion: 1,
      status: "pass"
    };
    return Object.freeze({
      ...result,
      resultSha256: canonicalSha256(result)
    });
  } catch (error) {
    if (began) {
      try {
        await client.query(ROLLBACK);
      } catch {
        // The caller must discard a connection that cannot roll back.
      }
    }
    if (error?.name === "StagingPrerequisitesV3Error") throw error;
    blocked("catalog_query_failed");
  }
}

function validateAssertionRows(response) {
  if (!response || !Array.isArray(response.rows) ||
      response.rows.length !== ASSERTION_IDS.length ||
      response.rows.length > LIMITS.catalogAssertions) blocked("catalog_result_shape");
  const assertions = response.rows.map((row) => {
    exactKeys(row, ["id", "pass"], "catalog_result_keys");
    if (typeof row.id !== "string" || typeof row.pass !== "boolean") {
      blocked("catalog_result_type");
    }
    return { id: row.id, pass: row.pass };
  });
  if (new Set(assertions.map(({ id }) => id)).size !== assertions.length ||
      assertions.some(({ id }, index) => id !== ASSERTION_IDS[index])) {
    blocked("catalog_result_order");
  }
  if (Buffer.byteLength(canonicalJson(assertions)) > LIMITS.outputBytes) {
    blocked("catalog_result_bound");
  }
  return assertions;
}

async function queryExact(client, text) {
  const response = await client.query(text);
  if (response?.rows && response.rows.length > 0) blocked("catalog_control_output");
}
