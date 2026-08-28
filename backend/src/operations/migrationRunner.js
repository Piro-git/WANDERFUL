import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { MIGRATION_POLICIES } from "./stagingMigrationPolicy.js";
import {
  consumeStagingPhase1V2MigrationCapability
} from "./stagingMigrationCapability.js";

const MIGRATION_LOGIN_ROLE = "migration_role";
const APPLICATION_OWNER_ROLE = "trailmind_app_owner";
const APPLICATION_SCHEMA = "trailmind_app";

export async function runMigrationPolicy({
  client,
  admittedMigrations,
  migrationDirectory,
  migrationPolicy,
  operatorContext,
  migrationPurpose,
  fileAccess = access,
  fileRead = readFile,
  now
}) {
  const migrations = [...migrationPolicy.migrations];
  const expectedMigrations = MIGRATION_POLICIES[migrationPolicy.policyId];
  if (
    !expectedMigrations ||
    migrations.length === 0 ||
    new Set(migrations).size !== migrations.length ||
    migrations.length !== expectedMigrations.length ||
    migrations.some((version, index) => version !== expectedMigrations[index])
  ) throw new Error("trailmind_migration_policy_invalid");

  if (migrationPolicy.policyId === "supabase-postgis-isolation-v2") {
    const authorizedPurpose = consumeStagingPhase1V2MigrationCapability({
      capability: operatorContext,
      policyId: migrationPolicy.policyId,
      ...(now ? { now } : {})
    });
    if (
      !["apply", "verify-noop"].includes(migrationPurpose) ||
      migrationPurpose !== authorizedPurpose
    ) throw new Error("trailmind_supabase_v2_operator_context_purpose_invalid");
  } else if (operatorContext !== undefined || migrationPurpose !== undefined) {
    throw new Error("trailmind_historical_migration_context_forbidden");
  }

  if (migrationPolicy.policyId === "historical-portable-v1") {
    if (admittedMigrations !== undefined) {
      throw new Error("trailmind_historical_admitted_migrations_forbidden");
    }
    const migrationSql = new Map();
    for (const version of migrations) {
      const path = join(migrationDirectory, version);
      await fileAccess(path);
      migrationSql.set(version, await fileRead(path, "utf8"));
    }
    return runHistoricalPortablePolicy({
      client,
      migrations,
      migrationSql,
      policyId: migrationPolicy.policyId
    });
  }
  const migrationSql = admittedMigrationMap(admittedMigrations, migrations);
  const newlyApplied = [];
  let transactionOpen = false;
  try {
    await client.query("BEGIN");
    transactionOpen = true;
    await client.query("SET LOCAL statement_timeout = '30s'");
    await client.query("SET LOCAL lock_timeout = '5s'");
    await assertMigrationOperator(client);
    await assertIsolatedPostgisOwnership(client);
    await client.query("SET LOCAL ROLE migration_role");
    await assertMigrationRole(client);
    await client.query("SET LOCAL ROLE trailmind_app_owner");
    await client.query(
      "SET LOCAL search_path = trailmind_app, pg_catalog, trailmind_gis, pg_temp"
    );
    await assertApplicationOwner(client);
    await client.query(
      `CREATE TABLE IF NOT EXISTS trailmind_app.trailmind_schema_migrations (
         version text PRIMARY KEY,
         applied_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp()
       )`
    );
    await assertLedgerShape(client, APPLICATION_SCHEMA, APPLICATION_OWNER_ROLE);

    const applied = await client.query(
      `SELECT version
         FROM trailmind_app.trailmind_schema_migrations
        ORDER BY applied_at, version`
    );
    const expectedPrefix = migrations.slice(0, applied.rowCount);
    if (
      applied.rowCount > migrations.length ||
      applied.rows.some((row, index) => row.version !== expectedPrefix[index])
    ) {
      throw new Error(
        `trailmind_migration_ledger_incompatible:${migrationPolicy.policyId}`
      );
    }

    for (let index = applied.rowCount; index < migrations.length; index += 1) {
      const version = migrations[index];
      const admitted = migrationSql.get(version);
      if (sha256(admitted.sql) !== admitted.sha256) {
        throw new Error("trailmind_admitted_migration_mutated");
      }
      await client.query(admitted.sql);
      await client.query(
        `INSERT INTO trailmind_app.trailmind_schema_migrations (version)
         VALUES ($1)`,
        [version]
      );
      newlyApplied.push(version);
    }

    await client.query("COMMIT");
    transactionOpen = false;
    await assertOperatorRoleRestored(client);
    return Object.freeze([...newlyApplied]);
  } catch (error) {
    if (transactionOpen) await client.query("ROLLBACK");
    throw error;
  }
}

async function runHistoricalPortablePolicy({
  client,
  migrations,
  migrationSql,
  policyId
}) {
  const newlyApplied = [];
  let transactionOpen = false;
  try {
    await client.query("BEGIN");
    transactionOpen = true;
    await client.query("SET LOCAL statement_timeout = '30s'");
    await client.query(
      "SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('trailmind-schema-migrations', 0))"
    );
    const topology = await client.query(`
      SELECT pg_catalog.current_schema() AS application_schema,
             current_user AS owner_name,
             namespace.nspowner = role_record.oid AS current_user_owns_schema,
             NOT pg_catalog.has_schema_privilege(
               'public', 'public', 'CREATE'
             ) AS public_is_not_writable,
             pg_catalog.replace(
               pg_catalog.replace(current_setting('search_path'), ' ', ''),
               '"', ''
             ) = namespace.nspname || ',public' AS exact_portable_path
        FROM pg_catalog.pg_namespace namespace
        JOIN pg_catalog.pg_roles role_record
          ON role_record.rolname = current_user
       WHERE namespace.nspname = pg_catalog.current_schema()
         AND namespace.nspname NOT IN (
           'public', 'pg_catalog', 'information_schema', 'trailmind_app'
         )
         AND namespace.nspname !~ '^pg_(toast|temp)'
    `);
    if (
      topology.rowCount !== 1 ||
      topology.rows[0].current_user_owns_schema !== true ||
      topology.rows[0].public_is_not_writable !== true ||
      topology.rows[0].exact_portable_path !== true
    ) throw new Error("trailmind_historical_portable_topology_invalid");
    const schema = topology.rows[0].application_schema;
    const owner = topology.rows[0].owner_name;
    const qualifiedLedger =
      `${quoteIdentifier(schema)}.trailmind_schema_migrations`;
    await client.query(`
      CREATE TABLE IF NOT EXISTS ${qualifiedLedger} (
        version text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp()
      )
    `);
    await assertLedgerShape(client, schema, owner);
    const applied = await client.query(`
      SELECT version
        FROM ${qualifiedLedger}
       ORDER BY applied_at, version
    `);
    const expectedPrefix = migrations.slice(0, applied.rowCount);
    if (
      applied.rowCount > migrations.length ||
      applied.rows.some((row, index) => row.version !== expectedPrefix[index])
    ) throw new Error(`trailmind_migration_ledger_incompatible:${policyId}`);
    for (let index = applied.rowCount; index < migrations.length; index += 1) {
      const version = migrations[index];
      await client.query(migrationSql.get(version));
      await client.query(
        `INSERT INTO ${qualifiedLedger} (version) VALUES ($1)`,
        [version]
      );
      newlyApplied.push(version);
    }
    await client.query("COMMIT");
    transactionOpen = false;
    return Object.freeze([...newlyApplied]);
  } catch (error) {
    if (transactionOpen) await client.query("ROLLBACK");
    throw error;
  }
}

async function assertMigrationOperator(client) {
  const result = await client.query(`
    WITH RECURSIVE migration AS (
      SELECT role_record.*
        FROM pg_catalog.pg_roles role_record
       WHERE role_record.rolname = '${MIGRATION_LOGIN_ROLE}'
    ), direct_membership AS (
      SELECT target.rolname AS target_name,
             membership.inherit_option,
             membership.set_option,
             membership.admin_option
        FROM migration
        JOIN pg_catalog.pg_auth_members membership
          ON membership.member = migration.oid
        JOIN pg_catalog.pg_roles target
          ON target.oid = membership.roleid
    ), reachable_membership(role_oid, path) AS (
      SELECT membership.roleid,
             ARRAY[migration.oid, membership.roleid]::oid[]
        FROM migration
        JOIN pg_catalog.pg_auth_members membership
          ON membership.member = migration.oid
      UNION ALL
      SELECT membership.roleid,
             reachable.path || membership.roleid
        FROM reachable_membership reachable
        JOIN pg_catalog.pg_auth_members membership
          ON membership.member = reachable.role_oid
       WHERE NOT membership.roleid = ANY(reachable.path)
    )
    SELECT session_user = 'postgres' AS exact_session,
           current_user = 'postgres' AS exact_current,
           operator.rolcanlogin AND NOT operator.rolinherit
             AND NOT operator.rolsuper AND NOT operator.rolcreatedb
             AND operator.rolcreaterole AND NOT operator.rolreplication
             AND NOT operator.rolbypassrls AS exact_operator_attributes,
           NOT migration.rolcanlogin AND NOT migration.rolinherit
             AND NOT migration.rolsuper AND NOT migration.rolcreatedb
             AND NOT migration.rolcreaterole AND NOT migration.rolreplication
             AND NOT migration.rolbypassrls AS exact_migration_attributes,
           NOT owner.rolcanlogin AND NOT owner.rolinherit AND NOT owner.rolsuper
             AND NOT owner.rolcreatedb AND NOT owner.rolcreaterole
             AND NOT owner.rolreplication AND NOT owner.rolbypassrls
             AS exact_owner_attributes,
           namespace.nspowner = owner.oid AS exact_schema_owner,
           (
             SELECT pg_catalog.count(*) = 1
                    AND pg_catalog.bool_and(
                      target_name = '${APPLICATION_OWNER_ROLE}'
                      AND NOT inherit_option
                      AND set_option
                      AND NOT admin_option
                    )
               FROM direct_membership
           ) AS exact_complete_outgoing_membership,
           (
             SELECT pg_catalog.count(*) = 1
                    AND pg_catalog.bool_and(
                      pg_catalog.pg_get_userbyid(role_oid) =
                        '${APPLICATION_OWNER_ROLE}'
                    )
               FROM reachable_membership
           ) AS exact_reachable_membership,
           NOT EXISTS (
             SELECT 1
               FROM pg_catalog.pg_auth_members membership
              WHERE membership.member = owner.oid
           ) AS owner_has_no_outgoing_membership,
           pg_catalog.pg_has_role(
             '${MIGRATION_LOGIN_ROLE}', '${APPLICATION_OWNER_ROLE}', 'SET'
           ) AS may_set_owner,
           pg_catalog.pg_has_role(
             session_user, '${MIGRATION_LOGIN_ROLE}', 'SET'
           ) AS operator_may_set_migration,
           pg_catalog.pg_has_role(
             session_user, '${APPLICATION_OWNER_ROLE}', 'SET'
           ) AS operator_may_set_owner,
           EXISTS (
             SELECT 1
               FROM pg_catalog.pg_locks held
              WHERE held.pid = pg_catalog.pg_backend_pid()
                AND held.locktype = 'advisory'
                AND held.granted
                AND held.objsubid = 1
                AND held.classid = (
                  (pg_catalog.hashtextextended(
                    'trailmind-phase-1-foundation', 0
                  ) >> 32) & 4294967295
                )::oid
                AND held.objid = (
                  pg_catalog.hashtextextended(
                    'trailmind-phase-1-foundation', 0
                  ) & 4294967295
                )::oid
           ) AS outer_session_lock_held,
           pg_catalog.has_schema_privilege(
             '${APPLICATION_OWNER_ROLE}', 'trailmind_gis', 'USAGE'
           ) AS owner_gis_usage,
           NOT pg_catalog.has_schema_privilege(
             '${APPLICATION_OWNER_ROLE}', 'trailmind_gis', 'CREATE'
           ) AS owner_gis_no_create,
           EXISTS (
             SELECT 1
               FROM pg_catalog.pg_extension extension
               JOIN pg_catalog.pg_namespace extension_namespace
                 ON extension_namespace.oid = extension.extnamespace
              WHERE extension.extname = 'postgis'
                AND extension_namespace.nspname = 'trailmind_gis'
           ) AS isolated_postgis
      FROM migration
      JOIN pg_catalog.pg_roles operator
        ON operator.rolname = session_user
      JOIN pg_catalog.pg_roles owner
        ON owner.rolname = '${APPLICATION_OWNER_ROLE}'
      JOIN pg_catalog.pg_namespace namespace
        ON namespace.nspname = '${APPLICATION_SCHEMA}'
  `);
  if (
    result.rowCount !== 1 ||
    Object.values(result.rows[0]).some((value) => value !== true)
  ) throw new Error("trailmind_migration_operator_owner_contract_invalid");
}

async function assertMigrationRole(client) {
  const result = await client.query(`
    SELECT session_user = 'postgres' AS exact_session,
           current_user = '${MIGRATION_LOGIN_ROLE}' AS exact_current,
           NOT role_record.rolcanlogin AND NOT role_record.rolinherit
             AND NOT role_record.rolsuper AND NOT role_record.rolcreatedb
             AND NOT role_record.rolcreaterole AND NOT role_record.rolreplication
             AND NOT role_record.rolbypassrls AS exact_attributes
      FROM pg_catalog.pg_roles role_record
     WHERE role_record.rolname = current_user
  `);
  if (
    result.rowCount !== 1 ||
    Object.values(result.rows[0]).some((value) => value !== true)
  ) throw new Error("trailmind_migration_role_transition_invalid");
}

async function assertIsolatedPostgisOwnership(client) {
  const result = await client.query(`
    WITH topology AS (
      SELECT extension.oid AS extension_oid,
             extension_owner.rolname AS extension_owner,
             namespace.oid AS namespace_oid,
             namespace.nspowner AS namespace_owner_oid,
             schema_owner.rolname AS schema_owner
        FROM pg_catalog.pg_extension extension
        JOIN pg_catalog.pg_roles extension_owner
          ON extension_owner.oid = extension.extowner
        JOIN pg_catalog.pg_namespace namespace
          ON namespace.oid = extension.extnamespace
        JOIN pg_catalog.pg_roles schema_owner
          ON schema_owner.oid = namespace.nspowner
       WHERE extension.extname = 'postgis'
         AND namespace.nspname = 'trailmind_gis'
    ), owned_objects AS (
      SELECT procedure.proowner AS owner_oid
        FROM topology
        JOIN pg_catalog.pg_proc procedure
          ON procedure.pronamespace = topology.namespace_oid
      UNION ALL
      SELECT relation.relowner
        FROM topology
        JOIN pg_catalog.pg_class relation
          ON relation.relnamespace = topology.namespace_oid
      UNION ALL
      SELECT type_record.typowner
        FROM topology
        JOIN pg_catalog.pg_type type_record
          ON type_record.typnamespace = topology.namespace_oid
      UNION ALL
      SELECT operator_record.oprowner
        FROM topology
        JOIN pg_catalog.pg_operator operator_record
          ON operator_record.oprnamespace = topology.namespace_oid
      UNION ALL
      SELECT operator_class.opcowner
        FROM topology
        JOIN pg_catalog.pg_opclass operator_class
          ON operator_class.opcnamespace = topology.namespace_oid
      UNION ALL
      SELECT operator_family.opfowner
        FROM topology
        JOIN pg_catalog.pg_opfamily operator_family
          ON operator_family.opfnamespace = topology.namespace_oid
      UNION ALL
      SELECT collation_record.collowner
        FROM topology
        JOIN pg_catalog.pg_collation collation_record
          ON collation_record.collnamespace = topology.namespace_oid
      UNION ALL
      SELECT conversion_record.conowner
        FROM topology
        JOIN pg_catalog.pg_conversion conversion_record
          ON conversion_record.connamespace = topology.namespace_oid
      UNION ALL
      SELECT configuration.cfgowner
        FROM topology
        JOIN pg_catalog.pg_ts_config configuration
          ON configuration.cfgnamespace = topology.namespace_oid
      UNION ALL
      SELECT dictionary.dictowner
        FROM topology
        JOIN pg_catalog.pg_ts_dict dictionary
          ON dictionary.dictnamespace = topology.namespace_oid
    )
    SELECT topology.schema_owner = 'postgres' AS exact_schema_owner,
           topology.extension_owner IN ('postgres', 'supabase_admin')
             AS reviewed_extension_owner,
           (
             topology.extension_owner = topology.schema_owner
             OR (
               topology.schema_owner = 'postgres'
               AND topology.extension_owner = 'supabase_admin'
             )
           ) AS reviewed_managed_owner_topology,
           NOT EXISTS (
             SELECT 1
               FROM owned_objects
              WHERE owner_oid <> (
                SELECT extension.extowner
                  FROM pg_catalog.pg_extension extension
                 WHERE extension.oid = topology.extension_oid
              )
           ) AS exact_owned_object_owner,
           NOT EXISTS (
             SELECT 1
               FROM pg_catalog.aclexplode(
                 COALESCE(
                   namespace.nspacl,
                   pg_catalog.acldefault('n', namespace.nspowner)
                 )
               ) privilege
              WHERE privilege.privilege_type = 'CREATE'
                AND privilege.grantee <> namespace.nspowner
           ) AS no_unexpected_create_acl,
           NOT EXISTS (
             SELECT 1
               FROM pg_catalog.pg_roles candidate
              WHERE candidate.oid <> topology.namespace_owner_oid
                AND NOT candidate.rolsuper
                AND pg_catalog.pg_has_role(
                      candidate.oid, topology.namespace_owner_oid, 'SET'
                    )
           ) AS no_unexpected_owner_membership
      FROM topology
      JOIN pg_catalog.pg_namespace namespace
        ON namespace.oid = topology.namespace_oid
  `);
  if (
    result.rowCount !== 1 ||
    Object.values(result.rows[0]).some((value) => value !== true)
  ) throw new Error("trailmind_postgis_ownership_contract_invalid");
}

async function assertApplicationOwner(client) {
  const result = await client.query(`
    SELECT session_user = 'postgres' AS exact_session,
           current_user = '${APPLICATION_OWNER_ROLE}' AS exact_current,
           pg_catalog.pg_get_userbyid(namespace.nspowner) =
             '${APPLICATION_OWNER_ROLE}' AS exact_schema_owner,
           pg_catalog.replace(
             pg_catalog.replace(current_setting('search_path'), ' ', ''),
             '"', ''
           ) = 'trailmind_app,pg_catalog,trailmind_gis,pg_temp' AS exact_path
      FROM pg_catalog.pg_namespace namespace
     WHERE namespace.nspname = '${APPLICATION_SCHEMA}'
  `);
  if (
    result.rowCount !== 1 ||
    Object.values(result.rows[0]).some((value) => value !== true)
  ) throw new Error("trailmind_migration_owner_transition_invalid");
}

async function assertOperatorRoleRestored(client) {
  const result = await client.query(`
    SELECT session_user = 'postgres' AS exact_session,
           current_user = 'postgres' AS exact_current
  `);
  if (
    result.rowCount !== 1 ||
    Object.values(result.rows[0]).some((value) => value !== true)
  ) throw new Error("trailmind_migration_operator_reversion_invalid");
}

async function assertLedgerShape(client, schema, owner) {
  const result = await client.query(`
    SELECT relation.relkind = 'r' AS ordinary_table,
           pg_catalog.pg_get_userbyid(relation.relowner) = $2 AS exact_owner,
           (
             SELECT pg_catalog.jsonb_agg(
               pg_catalog.jsonb_build_object(
                 'name', attribute.attname,
                 'type', pg_catalog.format_type(
                   attribute.atttypid, attribute.atttypmod
                 ),
                 'not_null', attribute.attnotnull
               ) ORDER BY attribute.attnum
             )
               FROM pg_catalog.pg_attribute attribute
              WHERE attribute.attrelid = relation.oid
                AND attribute.attnum > 0
                AND NOT attribute.attisdropped
           ) = '[{"name":"version","type":"text","not_null":true},{"name":"applied_at","type":"timestamp with time zone","not_null":true}]'::jsonb
             AS exact_columns,
           (
             SELECT pg_catalog.count(*) = 1
               FROM pg_catalog.pg_constraint constraint_record
              WHERE constraint_record.conrelid = relation.oid
                AND constraint_record.contype = 'p'
                AND constraint_record.conkey = ARRAY[
                  (
                    SELECT attribute.attnum
                      FROM pg_catalog.pg_attribute attribute
                     WHERE attribute.attrelid = relation.oid
                       AND attribute.attname = 'version'
                  )::smallint
                ]
           ) AS exact_primary_key,
           EXISTS (
             SELECT 1
               FROM pg_catalog.pg_attribute attribute
               JOIN pg_catalog.pg_attrdef default_record
                 ON default_record.adrelid = attribute.attrelid
                AND default_record.adnum = attribute.attnum
              WHERE attribute.attrelid = relation.oid
                AND attribute.attname = 'applied_at'
                AND pg_catalog.pg_get_expr(
                      default_record.adbin, default_record.adrelid
                    ) = 'clock_timestamp()'
           ) AS exact_applied_default
      FROM pg_catalog.pg_class relation
      JOIN pg_catalog.pg_namespace namespace
        ON namespace.oid = relation.relnamespace
     WHERE namespace.nspname = $1
       AND relation.relname = 'trailmind_schema_migrations'
  `, [schema, owner]);
  if (
    result.rowCount !== 1 ||
    Object.values(result.rows[0]).some((value) => value !== true)
  ) throw new Error("trailmind_migration_ledger_shape_invalid");
}

function quoteIdentifier(value) {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(value)) {
    throw new Error("trailmind_migration_schema_identifier_invalid");
  }
  return `"${value}"`;
}

function admittedMigrationMap(admittedMigrations, expectedVersions) {
  if (
    !Array.isArray(admittedMigrations) ||
    admittedMigrations.length !== expectedVersions.length
  ) throw new Error("trailmind_admitted_migrations_required");
  const result = new Map();
  for (let index = 0; index < expectedVersions.length; index += 1) {
    const admitted = admittedMigrations[index];
    if (
      !admitted || typeof admitted !== "object" || Array.isArray(admitted) ||
      JSON.stringify(Object.keys(admitted).sort()) !==
        JSON.stringify(["sha256", "sql", "version"]) ||
      admitted.version !== expectedVersions[index] ||
      typeof admitted.sql !== "string" || admitted.sql.length === 0 ||
      !/^[a-f0-9]{64}$/.test(admitted.sha256) ||
      sha256(admitted.sql) !== admitted.sha256
    ) throw new Error("trailmind_admitted_migration_invalid");
    result.set(admitted.version, Object.freeze({ ...admitted }));
  }
  return result;
}

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
