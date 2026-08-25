import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import pg from "pg";
import {
  SUPABASE_POSTGIS_ISOLATION_MIGRATIONS_V2
} from "../src/operations/stagingMigrationPolicy.js";

const disposable = disposableConfiguration(process.env);

describe("managed Supabase-style PostGIS ownership topology", {
  skip: disposable ? false : "set the guarded disposable provider-owner fixture"
}, () => {
  let client;

  before(async () => {
    client = new pg.Client({
      host: disposable.host,
      port: disposable.port,
      database: disposable.database,
      user: disposable.adminRole
    });
    await client.connect();
  });

  after(async () => client?.end());

  it("admits postgres schema ownership with supabase_admin extension members", async () => {
    const topology = await client.query(`
      WITH extension_topology AS (
        SELECT extension.extowner, namespace.oid AS namespace_oid,
               pg_catalog.pg_get_userbyid(extension.extowner) AS extension_owner,
               pg_catalog.pg_get_userbyid(namespace.nspowner) AS schema_owner
          FROM pg_catalog.pg_extension extension
          JOIN pg_catalog.pg_namespace namespace
            ON namespace.oid = extension.extnamespace
         WHERE extension.extname = 'postgis'
           AND namespace.nspname = 'trailmind_gis'
      ), owned_objects AS (
        SELECT procedure.proowner AS owner_oid
          FROM extension_topology topology
          JOIN pg_catalog.pg_proc procedure
            ON procedure.pronamespace = topology.namespace_oid
        UNION ALL
        SELECT relation.relowner
          FROM extension_topology topology
          JOIN pg_catalog.pg_class relation
            ON relation.relnamespace = topology.namespace_oid
        UNION ALL
        SELECT type_record.typowner
          FROM extension_topology topology
          JOIN pg_catalog.pg_type type_record
            ON type_record.typnamespace = topology.namespace_oid
        UNION ALL
        SELECT operator_record.oprowner
          FROM extension_topology topology
          JOIN pg_catalog.pg_operator operator_record
            ON operator_record.oprnamespace = topology.namespace_oid
        UNION ALL
        SELECT operator_class.opcowner
          FROM extension_topology topology
          JOIN pg_catalog.pg_opclass operator_class
            ON operator_class.opcnamespace = topology.namespace_oid
        UNION ALL
        SELECT operator_family.opfowner
          FROM extension_topology topology
          JOIN pg_catalog.pg_opfamily operator_family
            ON operator_family.opfnamespace = topology.namespace_oid
      )
      SELECT topology.schema_owner, topology.extension_owner,
             pg_catalog.count(*) FILTER (
               WHERE owned_objects.owner_oid <> topology.extowner
             )::integer AS owner_drift_count
        FROM extension_topology topology
        CROSS JOIN owned_objects
       GROUP BY topology.schema_owner, topology.extension_owner
    `);
    assert.deepEqual(topology.rows, [{
      schema_owner: "postgres",
      extension_owner: "supabase_admin",
      owner_drift_count: 0
    }]);
    const providerRole = await client.query(`
      SELECT rolcanlogin, rolinherit, rolsuper, rolcreatedb, rolcreaterole,
             rolreplication, rolbypassrls
        FROM pg_catalog.pg_roles
       WHERE rolname = 'supabase_admin'
    `);
    assert.deepEqual(providerRole.rows, [{
      rolcanlogin: false,
      rolinherit: false,
      rolsuper: false,
      rolcreatedb: false,
      rolcreaterole: false,
      rolreplication: false,
      rolbypassrls: false
    }]);
  });

  it("applies the exact V2 ledger and trusted function path under that topology", async () => {
    const ledger = await client.query(`
      SELECT version
        FROM trailmind_app.trailmind_schema_migrations
       ORDER BY applied_at, version
    `);
    assert.deepEqual(
      ledger.rows.map(({ version }) => version),
      [...SUPABASE_POSTGIS_ISOLATION_MIGRATIONS_V2]
    );
    const functions = await client.query(`
      SELECT pg_catalog.count(*)::integer AS function_count,
             pg_catalog.bool_and(
               'search_path=pg_catalog,trailmind_app,trailmind_gis,pg_temp' =
                 ANY(procedure.proconfig)
             ) AS exact_path
        FROM pg_catalog.pg_proc procedure
        JOIN pg_catalog.pg_namespace namespace
          ON namespace.oid = procedure.pronamespace
       WHERE namespace.nspname = 'trailmind_app'
         AND procedure.proname LIKE 'trailmind_runtime_outdoor_research_%_v1'
    `);
    assert.deepEqual(functions.rows, [{ function_count: 5, exact_path: true }]);
  });
});

function disposableConfiguration(env) {
  if (env.TRAILMIND_SUPABASE_POSTGIS_ISOLATION_V2_DISPOSABLE === undefined) {
    return undefined;
  }
  if (
    env.TRAILMIND_SUPABASE_POSTGIS_ISOLATION_V2_DISPOSABLE !== "true" ||
    !env.PGHOST?.startsWith("/private/tmp/trailmind-postgis-isolation-v2.") ||
    Number(env.PGPORT) < 55_000 || Number(env.PGPORT) > 55_999 ||
    env.PGDATABASE !== "trailmind_v2_17_provider_ownership" ||
    env.PGUSER !== "trailmind_v2_admin" ||
    env.PGPASSWORD
  ) throw new TypeError("trailmind_provider_owner_fixture_invalid");
  return Object.freeze({
    host: env.PGHOST,
    port: Number(env.PGPORT),
    database: env.PGDATABASE,
    adminRole: env.PGUSER
  });
}
