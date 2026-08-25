import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import pg from "pg";
import { stagingDatabaseAdmissionProbe } from "../src/operations/stagingDatabaseAdmission.js";

const disposable = disposableConfiguration(process.env);
const operationalRoles = Object.freeze([
  "platform_provisioner",
  "migration_role",
  "regional_import_role",
  "projection_role",
  "app_security_runtime_role",
  "outdoor_research_runtime_role",
  "outdoor_research_cancellation_control_role",
  "pruner_role",
  "readonly_auditor_role"
]);
const runtimeFunctions = Object.freeze([
  "trailmind_runtime_outdoor_research_snapshot_context_v1",
  "trailmind_runtime_outdoor_research_highlights_v1",
  "trailmind_runtime_outdoor_research_route_memberships_v1",
  "trailmind_runtime_outdoor_research_route_assertions_v1",
  "trailmind_runtime_outdoor_research_trail_access_candidates_v1"
]);

describe("Supabase PostGIS isolation V2 disposable PostgreSQL contract", {
  skip: disposable ? false : "set the guarded disposable V2 PostgreSQL contract"
}, () => {
  let admin;
  const pools = new Map();

  before(() => {
    admin = poolFor(disposable.adminRole);
    for (const role of [
      "app_security_runtime_role",
      "pruner_role",
      "outdoor_research_runtime_role",
      "outdoor_research_cancellation_control_role",
      "regional_import_role",
      "projection_role",
      "readonly_auditor_role",
      "service_role"
    ]) pools.set(role, poolFor(role));
  });

  after(async () => {
    await Promise.all([...pools.values()].map((pool) => pool.end()));
    await admin?.end();
  });

  it("has the exact V2 ledger, direct isolated extension install, and no public PostGIS routines", async () => {
    const ledger = await admin.query(
      "SELECT version FROM trailmind_app.trailmind_schema_migrations ORDER BY applied_at, version"
    );
    assert.deepEqual(ledger.rows.map(({ version }) => version), [
      "001_app_attest.sql",
      "002_outdoor_evidence.sql",
      "003_outdoor_research_graph.sql",
      "004_osm_outdoor_research_projection.sql",
      "005_outdoor_research_projection_geometry.sql",
      "006_outdoor_route_membership_point_index.sql",
      "007_routable_highlight_access_geography_index.sql",
      "009_supabase_postgis_isolated_runtime_read_contract.sql"
    ]);
    const extension = await admin.query(`
      SELECT namespace.nspname AS schema_name,
             extension.extversion AS extension_version,
             pg_catalog.count(*) FILTER (
               WHERE procedure_namespace.nspname = 'public'
             )::integer AS public_routines
        FROM pg_catalog.pg_extension extension
        JOIN pg_catalog.pg_namespace namespace
          ON namespace.oid = extension.extnamespace
        LEFT JOIN pg_catalog.pg_depend dependency
          ON dependency.refobjid = extension.oid
         AND dependency.deptype = 'e'
         AND dependency.classid = 'pg_catalog.pg_proc'::pg_catalog.regclass
        LEFT JOIN pg_catalog.pg_proc procedure ON procedure.oid = dependency.objid
        LEFT JOIN pg_catalog.pg_namespace procedure_namespace
          ON procedure_namespace.oid = procedure.pronamespace
       WHERE extension.extname = 'postgis'
       GROUP BY namespace.nspname, extension.extversion
    `);
    assert.equal(extension.rowCount, 1);
    assert.equal(extension.rows[0].schema_name, "trailmind_gis");
    assert.match(extension.rows[0].extension_version, /^3\./);
    assert.equal(extension.rows[0].public_routines, 0);
  });

  it("preserves exact role attributes and bounded memberships", async () => {
    const roles = await admin.query(`
      SELECT rolname, rolcanlogin, rolinherit, rolsuper, rolcreatedb,
             rolcreaterole, rolreplication, rolbypassrls, rolconnlimit
        FROM pg_catalog.pg_roles
       WHERE rolname = ANY($1::text[])
       ORDER BY rolname
    `, [operationalRoles]);
    assert.equal(roles.rowCount, operationalRoles.length);
    for (const role of roles.rows) {
      assert.equal(role.rolsuper, false, role.rolname);
      assert.equal(role.rolcreatedb, false, role.rolname);
      assert.equal(role.rolcreaterole, false, role.rolname);
      assert.equal(role.rolreplication, false, role.rolname);
      assert.equal(role.rolbypassrls, false, role.rolname);
      assert.equal(role.rolinherit, false, role.rolname);
      assert.equal(role.rolcanlogin, role.rolname !== "platform_provisioner", role.rolname);
      assert.equal(
        role.rolconnlimit,
        role.rolname === "outdoor_research_cancellation_control_role" ? 1 : -1,
        role.rolname
      );
    }
    const memberships = await admin.query(`
      SELECT member.rolname AS member, target.rolname AS target,
             membership.inherit_option, membership.set_option,
             membership.admin_option
        FROM pg_catalog.pg_auth_members membership
        JOIN pg_catalog.pg_roles member ON member.oid = membership.member
        JOIN pg_catalog.pg_roles target ON target.oid = membership.roleid
       WHERE member.rolname = ANY($1::text[])
          OR target.rolname = ANY($1::text[])
       ORDER BY member.rolname, target.rolname
    `, [operationalRoles]);
    assert.deepEqual(memberships.rows.filter(({ member }) =>
      operationalRoles.includes(member)
    ), [{
      member: "migration_role",
      target: "trailmind_app_owner",
      inherit_option: false,
      set_option: true,
      admin_option: false
    }]);

    const providerCreatorMemberships = await admin.query(`
      SELECT target.rolname AS target, membership.inherit_option,
             membership.set_option, membership.admin_option
        FROM pg_catalog.pg_auth_members membership
        JOIN pg_catalog.pg_roles member ON member.oid = membership.member
        JOIN pg_catalog.pg_roles target ON target.oid = membership.roleid
       WHERE member.rolname = 'postgres'
         AND target.rolname = ANY($1::text[])
       ORDER BY target.rolname
    `, [["trailmind_app_owner", "trailmind_control_owner", ...operationalRoles]]);
    assert.equal(providerCreatorMemberships.rowCount, 11);
    for (const membership of providerCreatorMemberships.rows) {
      const ownerMembership = [
        "trailmind_app_owner", "trailmind_control_owner"
      ].includes(membership.target);
      assert.equal(membership.inherit_option, false, membership.target);
      assert.equal(membership.set_option, ownerMembership, membership.target);
      assert.equal(membership.admin_option, true, membership.target);
    }
  });

  it("grants GIS usage only to the function owner, import, and projection roles", async () => {
    const allowed = ["trailmind_app_owner", "regional_import_role", "projection_role"];
    const denied = [
      "public", "anon", "authenticated", "service_role",
      "platform_provisioner", "migration_role", "app_security_runtime_role",
      "outdoor_research_runtime_role",
      "outdoor_research_cancellation_control_role", "pruner_role",
      "readonly_auditor_role"
    ];
    for (const role of allowed) {
      const result = await schemaPrivileges(role, "trailmind_gis");
      assert.deepEqual(result, { usage: true, create: false, grant: false }, role);
    }
    for (const role of denied) {
      const result = await schemaPrivileges(role, "trailmind_gis");
      assert.deepEqual(result, { usage: false, create: false, grant: false }, role);
    }
    for (const role of [
      "app_security_runtime_role", "outdoor_research_runtime_role",
      "outdoor_research_cancellation_control_role", "pruner_role",
      "readonly_auditor_role"
    ]) {
      assert.equal((await schemaPrivileges(role, "public")).usage, false, role);
    }
  });

  it("removes PUBLIC extensions reachability while preserving managed provider identities exactly", async () => {
    const denied = [
      "public",
      ...operationalRoles,
      "trailmind_app_owner"
    ];
    for (const role of denied) {
      assert.deepEqual(
        await schemaPrivileges(role, "extensions"),
        { usage: false, create: false, grant: false },
        role
      );
    }
    for (const role of [
      "anon",
      "authenticated",
      "service_role",
      "authenticator",
      "dashboard_user",
      "supabase_admin",
      "supabase_auth_admin",
      "supabase_storage_admin"
    ]) {
      const privileges = await schemaPrivileges(role, "extensions");
      assert.equal(privileges.usage, true, role);
      assert.equal(privileges.create, false, role);
      assert.equal(privileges.grant, false, role);
      assert.equal((await queryAsRole(role,
        "SELECT extensions.fixture_extension_routine() AS value"
      )).rows[0].value, 1, role);
    }
    for (const role of [
      "app_security_runtime_role",
      "outdoor_research_runtime_role",
      "outdoor_research_cancellation_control_role",
      "pruner_role",
      "readonly_auditor_role"
    ]) {
      await assert.rejects(
        pools.get(role).query(
          "SELECT extensions.fixture_extension_routine()"
        ),
        /permission denied for schema extensions/i,
        role
      );
    }
    const routineCapability = await admin.query(`
      SELECT role_name,
             pg_catalog.count(*) FILTER (
               WHERE pg_catalog.has_schema_privilege(
                       role_name, 'extensions', 'USAGE'
                     )
                 AND pg_catalog.has_function_privilege(
                       role_name, procedure.oid, 'EXECUTE'
                     )
             )::integer AS directly_reachable,
             pg_catalog.count(*) FILTER (
               WHERE pg_catalog.has_function_privilege(
                 role_name, procedure.oid, 'EXECUTE WITH GRANT OPTION'
               )
             )::integer AS grant_options
        FROM pg_catalog.unnest($1::text[]) role_name
       CROSS JOIN pg_catalog.pg_proc procedure
        JOIN pg_catalog.pg_namespace namespace
          ON namespace.oid = procedure.pronamespace
         AND namespace.nspname = 'extensions'
       GROUP BY role_name
       ORDER BY role_name
    `, [[
      "app_security_runtime_role",
      "outdoor_research_runtime_role",
      "outdoor_research_cancellation_control_role",
      "pruner_role",
      "readonly_auditor_role"
    ]]);
    assert(routineCapability.rows.every(({ directly_reachable, grant_options }) =>
      directly_reachable === 0 && grant_options === 0
    ));
  });

  it("keeps five SECURITY DEFINER functions on the exact owner-controlled trusted path", async () => {
    const functions = await admin.query(`
      SELECT procedure.proname, procedure.prosecdef, owner.rolname AS owner,
             procedure.proconfig,
             pg_catalog.has_function_privilege(
               'public', procedure.oid, 'EXECUTE'
             ) AS public_execute
        FROM pg_catalog.pg_proc procedure
        JOIN pg_catalog.pg_namespace namespace
          ON namespace.oid = procedure.pronamespace
        JOIN pg_catalog.pg_roles owner ON owner.oid = procedure.proowner
       WHERE namespace.nspname = 'trailmind_app'
         AND procedure.proname = ANY($1::text[])
       ORDER BY procedure.proname
    `, [runtimeFunctions]);
    assert.equal(functions.rowCount, 5);
    for (const fn of functions.rows) {
      assert.equal(fn.prosecdef, true, fn.proname);
      assert.equal(fn.owner, "trailmind_app_owner", fn.proname);
      assert.equal(fn.public_execute, false, fn.proname);
      assert(fn.proconfig.includes(
        "search_path=pg_catalog,trailmind_app,trailmind_gis,pg_temp"
      ), fn.proname);
    }
  });

  it("admits the exact App Attest runtime and pruner without public, extensions, or GIS", async () => {
    await assertAppAttestAdmission("app_security_runtime_role", "runtime");
    await assertAppAttestAdmission("pruner_role", "control");
    for (const role of ["app_security_runtime_role", "pruner_role"]) {
      const pool = pools.get(role);
      const path = (await pool.query(
        "SELECT pg_catalog.replace(current_setting('search_path'), ' ', '') AS path"
      )).rows[0].path;
      assert.equal(path, "pg_catalog,trailmind_app,pg_temp");
      await assert.rejects(
        pool.query("SELECT trailmind_gis.ST_Point(10, 50)"),
        /permission denied for schema trailmind_gis/i
      );
      await assert.rejects(
        pool.query("SELECT extensions.fixture_extension_routine()"),
        /permission denied for schema extensions/i
      );
    }
  });

  it("allows outdoor runtime to execute exactly five bounded functions and no direct PostGIS", async () => {
    const runtime = pools.get("outdoor_research_runtime_role");
    const executable = await runtime.query(`
      SELECT procedure.proname
        FROM pg_catalog.pg_proc procedure
        JOIN pg_catalog.pg_namespace namespace
          ON namespace.oid = procedure.pronamespace
       WHERE namespace.nspname = 'trailmind_app'
         AND pg_catalog.has_function_privilege(
           current_user, procedure.oid, 'EXECUTE'
         )
       ORDER BY procedure.proname
    `);
    assert.deepEqual(executable.rows.map(({ proname }) => proname),
      [...runtimeFunctions].sort());

    const calls = [
      "SELECT * FROM trailmind_app.trailmind_runtime_outdoor_research_snapshot_context_v1('harz-v1', 10, 50)",
      "SELECT * FROM trailmind_app.trailmind_runtime_outdoor_research_route_memberships_v1('00000000-0000-4000-8000-000000000001', 'harz-v1', 10, 50, 5000, 1, 1)",
      "SELECT * FROM trailmind_app.trailmind_runtime_outdoor_research_route_assertions_v1('00000000-0000-4000-8000-000000000001', ARRAY['00000000-0000-4000-8000-000000000002'::uuid], ARRAY['name'::text], 1)",
      "SELECT * FROM trailmind_app.trailmind_runtime_outdoor_research_highlights_v1('00000000-0000-4000-8000-000000000001', 'harz-v1', 10, 50, ARRAY['viewpoint'::text], 5000, ARRAY['name'::text], 1, 500)",
      "SELECT * FROM trailmind_app.trailmind_runtime_outdoor_research_trail_access_candidates_v1('00000000-0000-4000-8000-000000000001', 'harz-v1', ARRAY['00000000-0000-4000-8000-000000000002'::uuid], 500, 1, ARRAY['path'::text], ARRAY['foot'::text], 1)"
    ];
    for (const call of calls) assert.equal((await runtime.query(call)).rowCount, 0);

    for (const direct of [
      "SELECT trailmind_gis.ST_Point(10, 50)",
      "SELECT trailmind_gis.ST_Distance(trailmind_gis.ST_Point(0, 0), trailmind_gis.ST_Point(1, 1))",
      "SELECT 'POINT(10 50)'::trailmind_gis.geometry",
      "SELECT 'POINT(10 50)'::trailmind_gis.geography"
    ]) await assert.rejects(runtime.query(direct), /permission denied for schema trailmind_gis/i);
    await assert.rejects(runtime.query("SELECT ST_Point(10, 50)"), /function st_point.*does not exist/i);
  });

  it("denies outdoor base-table reads, writes, DDL, TEMP, and privilege escalation", async () => {
    const runtime = pools.get("outdoor_research_runtime_role");
    for (const sql of [
      "SELECT * FROM trailmind_app.outdoor_research_entities LIMIT 1",
      "INSERT INTO trailmind_app.outdoor_research_entities(entity_id, entity_category) VALUES ('00000000-0000-4000-8000-000000000099', 'viewpoint')",
      "CREATE TABLE trailmind_app.runtime_shadow(id integer)",
      "CREATE TABLE trailmind_gis.runtime_shadow(id integer)",
      "CREATE TABLE public.runtime_shadow(id integer)",
      "CREATE TEMP TABLE runtime_shadow(id integer)",
      "GRANT outdoor_research_runtime_role TO app_security_runtime_role",
      "ALTER ROLE outdoor_research_runtime_role BYPASSRLS"
    ]) await assert.rejects(runtime.query(sql), /permission denied|must have|not allowed/i, sql);
  });

  it("resists public, temp, and attacker-owned search-path shadowing", async () => {
    await admin.query("CREATE FUNCTION public.st_point(double precision, double precision) RETURNS text LANGUAGE sql IMMUTABLE AS 'SELECT ''shadow''' ");
    await admin.query("CREATE ROLE trailmind_v2_attacker NOLOGIN NOINHERIT");
    await admin.query("CREATE SCHEMA trailmind_v2_attacker AUTHORIZATION trailmind_v2_attacker");
    await admin.query("CREATE FUNCTION trailmind_v2_attacker.st_point(double precision, double precision) RETURNS text LANGUAGE sql IMMUTABLE AS 'SELECT ''shadow''' ");
    try {
      const runtime = pools.get("outdoor_research_runtime_role");
      assert.equal((await runtime.query(
        "SELECT count(*)::integer AS count FROM trailmind_app.trailmind_runtime_outdoor_research_snapshot_context_v1('harz-v1', 10, 50)"
      )).rows[0].count, 0);
      const client = await runtime.connect();
      try {
        await client.query("SET search_path = trailmind_v2_attacker, public, pg_catalog");
        await assert.rejects(
          client.query("SELECT ST_Point(10, 50)"),
          /function st_point.*does not exist/i
        );
        assert.equal((await client.query(
          "SELECT count(*)::integer AS count FROM trailmind_app.trailmind_runtime_outdoor_research_snapshot_context_v1('harz-v1', 10, 50)"
        )).rows[0].count, 0);
      } finally {
        client.release(true);
      }
    } finally {
      await admin.query("DROP SCHEMA trailmind_v2_attacker CASCADE");
      await admin.query("DROP ROLE trailmind_v2_attacker");
      await admin.query("DROP FUNCTION public.st_point(double precision, double precision)");
    }
  });

  it("keeps import, projection, pruning, audit, migration, and API identities distinct", async () => {
    assert.equal((await pools.get("regional_import_role").query(
      "SELECT trailmind_gis.ST_X(trailmind_gis.ST_Point(10, 50)) AS x"
    )).rows[0].x, 10);
    assert.equal((await pools.get("projection_role").query(
      "SELECT trailmind_gis.ST_Y(trailmind_gis.ST_Point(10, 50)) AS y"
    )).rows[0].y, 50);
    await assert.rejects(
      pools.get("readonly_auditor_role").query(
        "SELECT * FROM trailmind_app.outdoor_research_entities"
      ), /permission denied for schema trailmind_app/i
    );
    for (const role of ["anon", "authenticated", "service_role"]) {
      await assertRoleQueryRejected(
        role,
        "SELECT * FROM trailmind_app.app_attest_keys",
        /permission denied for schema trailmind_app/i
      );
      await assertRoleQueryRejected(
        role,
        "SELECT trailmind_gis.ST_Point(10, 50)",
        /permission denied for schema trailmind_gis/i
      );
    }
  });

  it("keeps cancellation target-restricted and product-data blind", async () => {
    const runtime = pools.get("outdoor_research_runtime_role");
    const cancellation = pools.get("outdoor_research_cancellation_control_role");
    const runtimeClient = await runtime.connect();
    try {
      const pid = (await runtimeClient.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
      const sleeping = runtimeClient.query("SELECT pg_sleep(30)");
      await new Promise((resolve) => setTimeout(resolve, 50));
      const cancelled = await cancellation.query(
        "SELECT trailmind_control.cancel_active_outdoor_research_backend_integer($1) AS cancelled",
        [pid]
      );
      assert.equal(cancelled.rows[0].cancelled, true);
      await assert.rejects(sleeping, /canceling statement due to user request/i);
      assert.equal((await cancellation.query(
        "SELECT trailmind_control.cancel_active_outdoor_research_backend_integer(pg_backend_pid()) AS cancelled"
      )).rows[0].cancelled, false);
    } finally {
      runtimeClient.release();
    }
    await assert.rejects(
      cancellation.query("SELECT * FROM trailmind_app.outdoor_research_entities"),
      /permission denied for schema trailmind_app/i
    );
  });

  it("retains WGS84/PostGIS and required GiST index sanity", async () => {
    const projection = pools.get("projection_role");
    const geometry = await projection.query(`
      SELECT trailmind_gis.ST_SRID(
               trailmind_gis.ST_SetSRID(trailmind_gis.ST_Point(10, 50), 4326)
             ) AS srid,
             trailmind_gis.ST_Distance(
               trailmind_gis.ST_SetSRID(trailmind_gis.ST_Point(10, 50), 4326)::trailmind_gis.geography,
               trailmind_gis.ST_SetSRID(trailmind_gis.ST_Point(10.01, 50), 4326)::trailmind_gis.geography
             ) > 0 AS positive_distance
    `);
    assert.deepEqual(geometry.rows[0], { srid: 4326, positive_distance: true });
    const indexes = await admin.query(`
      SELECT indexname
        FROM pg_catalog.pg_indexes
       WHERE schemaname = 'trailmind_app'
         AND indexdef ILIKE '%USING gist%'
    `);
    assert(indexes.rowCount >= 4);
  });

  async function schemaPrivileges(role, schema) {
    const result = await admin.query(`
      SELECT pg_catalog.has_schema_privilege($1, $2, 'USAGE') AS usage,
             pg_catalog.has_schema_privilege($1, $2, 'CREATE') AS create,
             pg_catalog.has_schema_privilege(
               $1, $2, 'USAGE WITH GRANT OPTION'
             ) AS grant
    `, [role, schema]);
    return result.rows[0];
  }

  async function assertAppAttestAdmission(role, responsibility) {
    const probe = stagingDatabaseAdmissionProbe({
      TRAILMIND_APPLICATION_SCHEMA: "trailmind_app",
      APP_ATTEST_RUNTIME_ROLE: "app_security_runtime_role",
      APP_ATTEST_CONTROL_ROLE: "pruner_role",
      APP_ATTEST_OPERATOR_ROLE: "migration_role"
    }, responsibility);
    const result = await pools.get(role).query(probe.query, probe.values);
    assert.equal(result.rows[0]?.admitted, true);
  }

  async function assertRoleQueryRejected(role, sql, pattern) {
    const client = await admin.connect();
    try {
      await client.query(`SET ROLE ${role}`);
      await assert.rejects(client.query(sql), pattern);
    } finally {
      await client.query("RESET ROLE");
      client.release();
    }
  }

  async function queryAsRole(role, sql) {
    const client = await admin.connect();
    try {
      await client.query(`SET ROLE ${role}`);
      return await client.query(sql);
    } finally {
      await client.query("RESET ROLE");
      client.release();
    }
  }
});

function poolFor(user) {
  return new pg.Pool({
    host: disposable.host,
    port: disposable.port,
    database: "postgres",
    user,
    max: 2,
    allowExitOnIdle: true
  });
}

function disposableConfiguration(env) {
  const requested = env.TRAILMIND_SUPABASE_POSTGIS_ISOLATION_V2_DISPOSABLE !== undefined;
  if (!requested) return undefined;
  const host = env.PGHOST;
  const port = Number(env.PGPORT);
  const adminRole = env.PGUSER;
  if (
    env.TRAILMIND_SUPABASE_POSTGIS_ISOLATION_V2_DISPOSABLE !== "true" ||
    typeof host !== "string" ||
    !host.startsWith("/private/tmp/trailmind-postgis-isolation-v2.") ||
    !Number.isInteger(port) || port < 55000 || port > 55999 ||
    adminRole !== "trailmind_v2_admin" ||
    env.PGDATABASE !== "postgres" ||
    env.PGPASSWORD
  ) throw new TypeError("supabase_postgis_isolation_v2_disposable_invalid");
  return Object.freeze({ host, port, adminRole });
}
