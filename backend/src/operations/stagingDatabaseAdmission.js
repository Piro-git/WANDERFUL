const APPLICATION_SCHEMA_PATTERN =
  /^trailmind_[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;
const ROLE_PATTERN = /^[a-z_][a-z0-9_]{0,62}$/;
const MAXIMUM_APPLICATION_SCHEMA_LENGTH = 48;
const FORBIDDEN_IDENTITY_ROLES = new Set([
  "postgres",
  "service_role",
  "supabase_admin",
  "anon",
  "authenticated"
]);

const APP_ATTEST_TABLE_NAMES = Object.freeze([
  "app_attest_challenges",
  "app_attest_keys",
  "app_attest_route_sessions",
  "app_attest_request_ids",
  "app_attest_rate_windows",
  "app_attest_provider_leases"
]);

export const APP_ATTEST_RUNTIME_PRIVILEGE_MANIFEST = deepFreeze({
  responsibility: "app_attest_runtime",
  roleEnvironmentName: "APP_ATTEST_RUNTIME_ROLE",
  database: { connect: true, create: false, temporary: false },
  schemas: {
    application: { usage: true, create: false },
    public: { usage: true, create: false }
  },
  tables: [
    tablePrivileges("app_attest_challenges", ["select", "insert", "update"]),
    tablePrivileges("app_attest_keys", ["select", "insert", "update"]),
    tablePrivileges("app_attest_route_sessions", ["select", "insert", "update"]),
    tablePrivileges("app_attest_request_ids", ["insert"]),
    tablePrivileges("app_attest_rate_windows", ["select", "insert", "update"]),
    tablePrivileges("app_attest_provider_leases", ["select", "insert", "update"])
  ],
  applicationSequences: [],
  applicationFunctions: [],
  publicFunctionExtensions: []
});

export const APP_ATTEST_CONTROL_PRIVILEGE_MANIFEST = deepFreeze({
  responsibility: "app_attest_control",
  roleEnvironmentName: "APP_ATTEST_CONTROL_ROLE",
  database: { connect: true, create: false, temporary: false },
  schemas: {
    application: { usage: true, create: false },
    public: { usage: true, create: false }
  },
  tables: [
    tablePrivileges("app_attest_challenges", ["delete"]),
    tablePrivileges("app_attest_keys", []),
    tablePrivileges("app_attest_route_sessions", ["delete"]),
    tablePrivileges("app_attest_request_ids", []),
    tablePrivileges("app_attest_rate_windows", ["delete"]),
    tablePrivileges("app_attest_provider_leases", ["delete"])
  ],
  applicationSequences: [],
  applicationFunctions: [],
  publicFunctionExtensions: []
});

const EXACT_DATABASE_PRIVILEGE_ADMISSION_SQL = `
WITH identity AS (
  SELECT roles.*
    FROM pg_catalog.pg_roles AS roles
   WHERE roles.rolname = $3
),
expected_tables AS (
  SELECT *
    FROM pg_catalog.jsonb_to_recordset($5::jsonb) AS expected(
      name text,
      can_select boolean,
      can_insert boolean,
      can_update boolean,
      can_delete boolean,
      can_truncate boolean,
      can_references boolean,
      can_trigger boolean,
      can_maintain boolean
    )
),
application_namespace AS (
  SELECT namespace.oid, namespace.nspowner
    FROM pg_catalog.pg_namespace AS namespace
   WHERE namespace.nspname = $1
),
application_relations AS (
  SELECT relation.oid, relation.relname, relation.relkind,
         relation.relowner, relation.relrowsecurity
    FROM pg_catalog.pg_class AS relation
    JOIN application_namespace AS namespace
      ON namespace.oid = relation.relnamespace
   WHERE relation.relkind IN ('r', 'p', 'v', 'm', 'f')
),
public_relations AS (
  SELECT relation.oid, relation.relname
    FROM pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
   WHERE namespace.nspname = 'public'
     AND relation.relkind IN ('r', 'p', 'v', 'm', 'f')
),
application_sequences AS (
  SELECT relation.oid, relation.relowner
    FROM pg_catalog.pg_class AS relation
    JOIN application_namespace AS namespace
      ON namespace.oid = relation.relnamespace
   WHERE relation.relkind = 'S'
),
public_sequences AS (
  SELECT relation.oid
    FROM pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
   WHERE namespace.nspname = 'public'
     AND relation.relkind = 'S'
),
application_functions AS (
  SELECT procedure.oid, procedure.proowner
    FROM pg_catalog.pg_proc AS procedure
    JOIN application_namespace AS namespace
      ON namespace.oid = procedure.pronamespace
),
public_functions AS (
  SELECT procedure.oid
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = procedure.pronamespace
   WHERE namespace.nspname = 'public'
)
SELECT (
  current_user = $3
  AND session_user = $3
  AND EXISTS (
    SELECT 1
      FROM identity AS identity_role
     WHERE identity_role.rolcanlogin
       AND NOT identity_role.rolinherit
       AND NOT identity_role.rolsuper
       AND NOT identity_role.rolcreatedb
       AND NOT identity_role.rolcreaterole
       AND NOT identity_role.rolreplication
       AND NOT identity_role.rolbypassrls
  )
  AND (
    SELECT pg_catalog.count(*)
      FROM pg_catalog.pg_roles AS expected_role
     WHERE expected_role.rolname = ANY($4::text[])
  ) = pg_catalog.cardinality($4::text[])
  AND NOT EXISTS (
    SELECT 1
      FROM identity AS identity_role
      JOIN pg_catalog.pg_auth_members AS membership
        ON membership.member = identity_role.oid
  )
  AND NOT EXISTS (
    SELECT 1
      FROM identity AS identity_role
      JOIN pg_catalog.pg_roles AS inherited
        ON inherited.oid <> identity_role.oid
       AND pg_catalog.pg_has_role(identity_role.oid, inherited.oid, 'MEMBER')
  )
  AND EXISTS (
    SELECT 1
      FROM application_namespace AS namespace
      CROSS JOIN identity AS identity_role
     WHERE namespace.nspowner <> identity_role.oid
  )
  AND pg_catalog.has_schema_privilege(current_user, $1, 'USAGE')
  AND NOT pg_catalog.has_schema_privilege(current_user, $1, 'USAGE WITH GRANT OPTION')
  AND NOT pg_catalog.has_schema_privilege(current_user, $1, 'CREATE')
  AND pg_catalog.has_schema_privilege(current_user, 'public', 'USAGE')
  AND NOT pg_catalog.has_schema_privilege(current_user, 'public', 'USAGE WITH GRANT OPTION')
  AND NOT pg_catalog.has_schema_privilege(current_user, 'public', 'CREATE')
  AND NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_namespace AS namespace
     WHERE pg_catalog.has_schema_privilege(current_user, namespace.oid, 'CREATE')
  )
  AND NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_namespace AS namespace
     WHERE namespace.nspname NOT IN ($1, 'public', 'pg_catalog', 'information_schema')
       AND namespace.nspname NOT LIKE 'pg_toast%'
       AND namespace.nspname NOT LIKE 'pg_temp_%'
       AND pg_catalog.has_schema_privilege(current_user, namespace.oid, 'USAGE')
  )
  AND pg_catalog.has_database_privilege(current_user, current_database(), 'CONNECT')
  AND NOT pg_catalog.has_database_privilege(
    current_user, current_database(), 'CONNECT WITH GRANT OPTION'
  )
  AND NOT pg_catalog.has_database_privilege(current_user, current_database(), 'CREATE')
  AND NOT pg_catalog.has_database_privilege(current_user, current_database(), 'TEMPORARY')
  AND pg_catalog.replace(
    pg_catalog.replace(current_setting('search_path'), ' ', ''),
    '"',
    ''
  ) = $2
  AND (
    SELECT pg_catalog.count(*)
      FROM expected_tables AS expected
      JOIN application_relations AS relation
        ON relation.relname = expected.name
       AND relation.relkind IN ('r', 'p')
  ) = pg_catalog.jsonb_array_length($5::jsonb)
  AND NOT EXISTS (
    SELECT 1
      FROM expected_tables AS expected
      JOIN application_relations AS relation
        ON relation.relname = expected.name
     WHERE NOT relation.relrowsecurity
        OR NOT pg_catalog.row_security_active(relation.oid)
        OR pg_catalog.has_table_privilege(
             current_user, relation.oid, 'SELECT'
           ) IS DISTINCT FROM expected.can_select
        OR pg_catalog.has_table_privilege(
             current_user, relation.oid, 'INSERT'
           ) IS DISTINCT FROM expected.can_insert
        OR pg_catalog.has_table_privilege(
             current_user, relation.oid, 'UPDATE'
           ) IS DISTINCT FROM expected.can_update
        OR pg_catalog.has_table_privilege(
             current_user, relation.oid, 'DELETE'
           ) IS DISTINCT FROM expected.can_delete
        OR pg_catalog.has_table_privilege(
             current_user, relation.oid, 'TRUNCATE'
           ) IS DISTINCT FROM expected.can_truncate
        OR pg_catalog.has_table_privilege(
             current_user, relation.oid, 'REFERENCES'
           ) IS DISTINCT FROM expected.can_references
        OR pg_catalog.has_table_privilege(
             current_user, relation.oid, 'TRIGGER'
           ) IS DISTINCT FROM expected.can_trigger
        OR pg_catalog.has_table_privilege(
             current_user, relation.oid, 'MAINTAIN'
           ) IS DISTINCT FROM expected.can_maintain
        OR pg_catalog.has_any_column_privilege(
             current_user, relation.oid, 'SELECT'
           ) IS DISTINCT FROM expected.can_select
        OR pg_catalog.has_any_column_privilege(
             current_user, relation.oid, 'INSERT'
           ) IS DISTINCT FROM expected.can_insert
        OR pg_catalog.has_any_column_privilege(
             current_user, relation.oid, 'UPDATE'
           ) IS DISTINCT FROM expected.can_update
        OR pg_catalog.has_any_column_privilege(
             current_user, relation.oid, 'REFERENCES'
           ) IS DISTINCT FROM expected.can_references
        OR pg_catalog.has_any_column_privilege(
             current_user, relation.oid, 'SELECT WITH GRANT OPTION'
           )
        OR pg_catalog.has_any_column_privilege(
             current_user, relation.oid, 'INSERT WITH GRANT OPTION'
           )
        OR pg_catalog.has_any_column_privilege(
             current_user, relation.oid, 'UPDATE WITH GRANT OPTION'
           )
        OR pg_catalog.has_any_column_privilege(
             current_user, relation.oid, 'REFERENCES WITH GRANT OPTION'
           )
        OR pg_catalog.has_table_privilege(
             current_user, relation.oid, 'SELECT WITH GRANT OPTION'
           )
        OR pg_catalog.has_table_privilege(
             current_user, relation.oid, 'INSERT WITH GRANT OPTION'
           )
        OR pg_catalog.has_table_privilege(
             current_user, relation.oid, 'UPDATE WITH GRANT OPTION'
           )
        OR pg_catalog.has_table_privilege(
             current_user, relation.oid, 'DELETE WITH GRANT OPTION'
           )
        OR pg_catalog.has_table_privilege(
             current_user, relation.oid, 'TRUNCATE WITH GRANT OPTION'
           )
        OR pg_catalog.has_table_privilege(
             current_user, relation.oid, 'REFERENCES WITH GRANT OPTION'
           )
        OR pg_catalog.has_table_privilege(
             current_user, relation.oid, 'TRIGGER WITH GRANT OPTION'
           )
        OR pg_catalog.has_table_privilege(
             current_user, relation.oid, 'MAINTAIN WITH GRANT OPTION'
           )
  )
  AND NOT EXISTS (
    SELECT 1
      FROM application_relations AS relation
      LEFT JOIN expected_tables AS expected
        ON expected.name = relation.relname
     WHERE expected.name IS NULL
       AND (
         pg_catalog.has_table_privilege(
           current_user, relation.oid,
           'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN'
         )
         OR pg_catalog.has_any_column_privilege(
           current_user, relation.oid, 'SELECT,INSERT,UPDATE,REFERENCES'
         )
       )
  )
  AND NOT EXISTS (
    SELECT 1
      FROM public_relations AS relation
     WHERE pg_catalog.has_table_privilege(
             current_user, relation.oid,
             'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN'
           )
        OR pg_catalog.has_any_column_privilege(
             current_user, relation.oid, 'SELECT,INSERT,UPDATE,REFERENCES'
           )
  )
  AND NOT EXISTS (
    SELECT 1
      FROM public_relations AS shadow
     WHERE shadow.relname = ANY($7::text[])
  )
  AND NOT EXISTS (
    SELECT 1
      FROM application_sequences AS app_sequence
     WHERE pg_catalog.has_sequence_privilege(
             current_user, app_sequence.oid, 'USAGE,SELECT,UPDATE'
           )
        OR pg_catalog.has_sequence_privilege(
             current_user, app_sequence.oid, 'USAGE WITH GRANT OPTION'
           )
        OR pg_catalog.has_sequence_privilege(
             current_user, app_sequence.oid, 'SELECT WITH GRANT OPTION'
           )
        OR pg_catalog.has_sequence_privilege(
             current_user, app_sequence.oid, 'UPDATE WITH GRANT OPTION'
           )
  )
  AND NOT EXISTS (
    SELECT 1
      FROM public_sequences AS public_sequence
     WHERE pg_catalog.has_sequence_privilege(
             current_user, public_sequence.oid, 'USAGE,SELECT,UPDATE'
           )
  )
  AND NOT EXISTS (
    SELECT 1
      FROM application_functions AS app_function
     WHERE pg_catalog.has_function_privilege(
       current_user, app_function.oid, 'EXECUTE'
     )
  )
  AND NOT EXISTS (
    SELECT 1
      FROM public_functions AS public_function
     WHERE pg_catalog.has_function_privilege(
             current_user, public_function.oid, 'EXECUTE'
           )
       AND NOT EXISTS (
         SELECT 1
           FROM pg_catalog.pg_depend AS dependency
           JOIN pg_catalog.pg_extension AS extension
             ON extension.oid = dependency.refobjid
          WHERE dependency.classid = 'pg_catalog.pg_proc'::pg_catalog.regclass
            AND dependency.objid = public_function.oid
            AND dependency.deptype = 'e'
            AND extension.extname = ANY($6::text[])
       )
  )
  AND NOT EXISTS (
    SELECT 1
      FROM public_functions AS public_function
     WHERE pg_catalog.has_function_privilege(
       current_user, public_function.oid, 'EXECUTE WITH GRANT OPTION'
     )
  )
  AND NOT EXISTS (
    SELECT 1
      FROM identity AS identity_role
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.nspowner = identity_role.oid
     WHERE namespace.nspname <> 'pg_temp'
  )
  AND NOT EXISTS (
    SELECT 1
      FROM identity AS identity_role
      JOIN pg_catalog.pg_class AS relation
        ON relation.relowner = identity_role.oid
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = relation.relnamespace
     WHERE namespace.nspname NOT IN ('pg_catalog', 'information_schema')
       AND namespace.nspname NOT LIKE 'pg_toast%'
       AND namespace.nspname NOT LIKE 'pg_temp_%'
  )
  AND NOT EXISTS (
    SELECT 1
      FROM identity AS identity_role
      JOIN pg_catalog.pg_proc AS owned_function
        ON owned_function.proowner = identity_role.oid
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = owned_function.pronamespace
     WHERE namespace.nspname NOT IN ('pg_catalog', 'information_schema')
       AND namespace.nspname NOT LIKE 'pg_toast%'
       AND namespace.nspname NOT LIKE 'pg_temp_%'
  )
  AND NOT EXISTS (
    SELECT 1
      FROM identity AS identity_role
      JOIN pg_catalog.pg_database AS database_record
        ON database_record.datdba = identity_role.oid
     WHERE database_record.datname = current_database()
  )
) AS admitted`;

export function applicationSchemaConfiguration(env = process.env) {
  const value = env.TRAILMIND_APPLICATION_SCHEMA;
  if (
    typeof value !== "string" ||
    value.length > MAXIMUM_APPLICATION_SCHEMA_LENGTH ||
    !APPLICATION_SCHEMA_PATTERN.test(value)
  ) {
    invalid();
  }
  return value;
}

export function stagingDatabaseIdentityConfiguration(env = process.env) {
  const runtimeRole = requiredRole(env.APP_ATTEST_RUNTIME_ROLE);
  const controlRole = requiredRole(env.APP_ATTEST_CONTROL_ROLE);
  const operatorRole = requiredRole(env.APP_ATTEST_OPERATOR_ROLE);
  if (new Set([runtimeRole, controlRole, operatorRole]).size !== 3) invalid();
  return deepFreeze({ runtimeRole, controlRole, operatorRole });
}

export function stagingDatabaseAdmissionProbe(env = process.env, responsibility = "runtime") {
  const applicationSchema = applicationSchemaConfiguration(env);
  const identities = stagingDatabaseIdentityConfiguration(env);
  const manifest = responsibility === "runtime"
    ? APP_ATTEST_RUNTIME_PRIVILEGE_MANIFEST
    : responsibility === "control"
      ? APP_ATTEST_CONTROL_PRIVILEGE_MANIFEST
      : invalid();
  const role = responsibility === "runtime"
    ? identities.runtimeRole
    : identities.controlRole;
  const normalizedSearchPath = `pg_catalog,${applicationSchema},public,pg_temp`;
  return deepFreeze({
    responsibility,
    applicationSchema,
    role,
    startupOptions:
      `-c search_path=pg_catalog,${quotePostgresIdentifier(applicationSchema)},public,pg_temp`,
    query: EXACT_DATABASE_PRIVILEGE_ADMISSION_SQL,
    values: [
      applicationSchema,
      normalizedSearchPath,
      role,
      [identities.runtimeRole, identities.controlRole, identities.operatorRole],
      JSON.stringify(manifest.tables),
      [...manifest.publicFunctionExtensions],
      [...APP_ATTEST_TABLE_NAMES]
    ],
    manifest
  });
}

export function quotePostgresIdentifier(value) {
  const identifier = applicationSchemaConfiguration({
    TRAILMIND_APPLICATION_SCHEMA: value
  });
  return `"${identifier.replaceAll('"', '""')}"`;
}

function tablePrivileges(name, allowed) {
  if (!APP_ATTEST_TABLE_NAMES.includes(name)) invalid();
  const privileges = new Set(allowed);
  return Object.freeze({
    name,
    can_select: privileges.has("select"),
    can_insert: privileges.has("insert"),
    can_update: privileges.has("update"),
    can_delete: privileges.has("delete"),
    can_truncate: false,
    can_references: false,
    can_trigger: false,
    can_maintain: false
  });
}

function requiredRole(value) {
  if (
    typeof value !== "string" ||
    !ROLE_PATTERN.test(value) ||
    FORBIDDEN_IDENTITY_ROLES.has(value)
  ) invalid();
  return value;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function invalid() {
  throw new TypeError("staging_database_admission_invalid");
}
