import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, describe, it } from "node:test";
import pg from "pg";

const disposable = disposableConfiguration(process.env);
const rollbackUrl = new URL(
  "../../docs/operations/staging-v1/database/PHASE_1_PRE_MIGRATION_V2_ROLLBACK.sql",
  import.meta.url
);

describe("Supabase PostGIS isolation V2 exact pre-ledger compensation", {
  skip: disposable ? false : "use the deterministic V2 disposable bootstrap"
}, () => {
  let pool;
  let rollbackSql;
  let originalAcl;

  before(async () => {
    pool = new pg.Pool(disposable);
    rollbackSql = await readFile(rollbackUrl, "utf8");
    originalAcl = await sharedAclSnapshot(pool);
  });

  after(async () => {
    await pool?.end();
  });

  it("starts from the exact temporary pre-ledger membership inventory", async () => {
    const memberships = await pool.query(`
      SELECT member.rolname AS member, target.rolname AS target,
             membership.inherit_option, membership.set_option,
             membership.admin_option
        FROM pg_catalog.pg_auth_members membership
        JOIN pg_catalog.pg_roles member ON member.oid = membership.member
        JOIN pg_catalog.pg_roles target ON target.oid = membership.roleid
       WHERE member.rolname = ANY($1::text[])
          OR target.rolname = ANY($1::text[])
       ORDER BY member.rolname, target.rolname
    `, [[
      "trailmind_app_owner", "trailmind_control_owner",
      "platform_provisioner", "migration_role", "regional_import_role",
      "projection_role", "app_security_runtime_role",
      "outdoor_research_runtime_role",
      "outdoor_research_cancellation_control_role", "pruner_role",
      "readonly_auditor_role"
    ]]);
    assert.equal(memberships.rowCount, 13, JSON.stringify(memberships.rows));
    assert(memberships.rows.every((membership) =>
      membership.member === "migration_role" ||
      membership.member === "trailmind_control_owner" ||
      membership.member === "postgres"
    ), JSON.stringify(memberships.rows));
  });

  for (const [name, createSql, dropSql] of [
    [
      "enum",
      "SET ROLE trailmind_app_owner; CREATE TYPE trailmind_app.rollback_unexpected_enum AS ENUM ('x'); RESET ROLE",
      "SET ROLE trailmind_app_owner; DROP TYPE trailmind_app.rollback_unexpected_enum; RESET ROLE"
    ],
    [
      "domain",
      "SET ROLE trailmind_app_owner; CREATE DOMAIN trailmind_app.rollback_unexpected_domain AS integer CHECK (VALUE > 0); RESET ROLE",
      "SET ROLE trailmind_app_owner; DROP DOMAIN trailmind_app.rollback_unexpected_domain; RESET ROLE"
    ],
    [
      "operator",
      "SET ROLE trailmind_app_owner; CREATE OPERATOR trailmind_app.## (LEFTARG = integer, RIGHTARG = integer, FUNCTION = pg_catalog.int4pl); RESET ROLE",
      "SET ROLE trailmind_app_owner; DROP OPERATOR trailmind_app.## (integer, integer); RESET ROLE"
    ]
  ]) {
    it(`refuses an unexpected ${name} before any destructive action`, async () => {
      await pool.query(createSql);
      try {
        await assert.rejects(runRollback(pool, rollbackSql), /refuses unexpected/);
        await assertPreFoundationPresent(pool);
      } finally {
        await pool.query(dropSql);
      }
    });
  }

  it("refuses while a TrailMind session is active", async () => {
    const runtime = new pg.Client({
      ...disposable,
      user: "outdoor_research_runtime_role"
    });
    await runtime.connect();
    try {
      assert.equal((await runtime.query(
        "SELECT current_user AS role_name"
      )).rows[0].role_name, "outdoor_research_runtime_role");
      assert.equal((await pool.query(`
        SELECT pg_catalog.count(*)::integer AS session_count
          FROM pg_catalog.pg_stat_activity
         WHERE pid = $1
           AND usename = 'outdoor_research_runtime_role'
      `, [runtime.processID])).rows[0].session_count, 1);
      await assert.rejects(runRollback(pool, rollbackSql), /active TrailMind session/);
      await assertPreFoundationPresent(pool);
    } finally {
      await runtime.end();
    }
  });

  it("refuses any ledger and leaves the pre-foundation untouched", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE trailmind_app_owner");
      await client.query(`
        CREATE TABLE trailmind_app.trailmind_schema_migrations(
          version text PRIMARY KEY,
          applied_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp()
        )
      `);
      await client.query("RESET ROLE");
      await client.query("COMMIT");
      await assert.rejects(runRollback(pool, rollbackSql), /migration ledger/);
      await assertPreFoundationPresent(pool);
      await client.query("SET ROLE trailmind_app_owner");
      await client.query("DROP TABLE trailmind_app.trailmind_schema_migrations");
      await client.query("RESET ROLE");
    } finally {
      client.release();
    }
  });

  it("drops only the exact pre-foundation and preserves raw and semantic ACLs", async () => {
    await runRollback(pool, rollbackSql);
    assert.deepEqual(await currentSharedAcl(pool), originalAcl);
    const residual = await pool.query(`
      SELECT
        (SELECT pg_catalog.count(*)::integer
           FROM pg_catalog.pg_roles
          WHERE rolname = ANY(ARRAY[
            'trailmind_app_owner',
            'trailmind_control_owner',
            'platform_provisioner',
            'migration_role',
            'regional_import_role',
            'projection_role',
            'app_security_runtime_role',
            'outdoor_research_runtime_role',
            'outdoor_research_cancellation_control_role',
            'pruner_role',
            'readonly_auditor_role'
          ]::text[])) AS roles,
        (SELECT pg_catalog.count(*)::integer
           FROM pg_catalog.pg_namespace
          WHERE nspname LIKE 'trailmind\\_%' ESCAPE '\\') AS schemas,
        (SELECT pg_catalog.count(*)::integer
           FROM pg_catalog.pg_extension
          WHERE extname = 'postgis') AS postgis,
        pg_catalog.to_regprocedure(
          'extensions.fixture_extension_routine()'
        ) IS NOT NULL AS provider_fixture
    `);
    assert.deepEqual(residual.rows[0], {
      roles: 0,
      schemas: 0,
      postgis: 0,
      provider_fixture: true
    });
  });

  it("refuses a repeated compensation without changing provider state", async () => {
    await assert.rejects(runRollback(pool, rollbackSql), /role identity guard/);
    assert.deepEqual(await currentSharedAcl(pool), originalAcl);
    assert.equal((await pool.query(
      "SELECT extensions.fixture_extension_routine() AS value"
    )).rows[0].value, 1);
  });
});

async function runRollback(pool, rollbackSql) {
  const client = await pool.connect();
  try {
    await client.query(
      "SET trailmind.phase_1_v2_rollback_confirmation = 'mbvzwsrtqcrwhvykugcd:pre-only'"
    );
    try {
      await client.query(rollbackSql);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  } finally {
    client.release();
  }
}

async function assertPreFoundationPresent(pool) {
  const result = await pool.query(`
    SELECT pg_catalog.to_regnamespace('trailmind_app') IS NOT NULL AS app,
           pg_catalog.to_regnamespace('trailmind_control') IS NOT NULL AS control,
           pg_catalog.to_regnamespace('trailmind_gis') IS NOT NULL AS gis,
           pg_catalog.to_regnamespace('trailmind_phase1_guard') IS NOT NULL AS guard,
           EXISTS (
             SELECT 1 FROM pg_catalog.pg_extension WHERE extname = 'postgis'
           ) AS postgis
  `);
  assert.deepEqual(result.rows[0], {
    app: true,
    control: true,
    gis: true,
    guard: true,
    postgis: true
  });
}

async function sharedAclSnapshot(pool) {
  const result = await pool.query(`
    SELECT object_kind, object_name, owner_name, raw_acl, semantic_acl
      FROM trailmind_phase1_guard.shared_acl_snapshot
     ORDER BY object_kind, object_name
  `);
  return result.rows;
}

async function currentSharedAcl(pool) {
  const result = await pool.query(`
    WITH shared_object AS (
      SELECT 'database'::text AS object_kind,
             database_record.datname AS object_name,
             database_record.datdba AS owner_oid,
             database_record.datacl AS object_acl,
             'd'::"char" AS acl_kind
        FROM pg_catalog.pg_database database_record
       WHERE database_record.datname = pg_catalog.current_database()
      UNION ALL
      SELECT 'schema', namespace.nspname, namespace.nspowner,
             namespace.nspacl, 'n'::"char"
        FROM pg_catalog.pg_namespace namespace
       WHERE namespace.nspname IN ('public', 'extensions')
    )
    SELECT object_kind, object_name,
           pg_catalog.pg_get_userbyid(owner_oid) AS owner_name,
           object_acl::text AS raw_acl,
           (
             SELECT COALESCE(
               pg_catalog.jsonb_agg(
                 pg_catalog.jsonb_build_object(
                   'grantee', CASE WHEN acl.grantee = 0 THEN 'PUBLIC'
                     ELSE pg_catalog.pg_get_userbyid(acl.grantee) END,
                   'grantor', pg_catalog.pg_get_userbyid(acl.grantor),
                   'privilege', acl.privilege_type,
                   'grantable', acl.is_grantable
                 ) ORDER BY acl.grantee, acl.grantor,
                            acl.privilege_type, acl.is_grantable
               ), '[]'::jsonb
             )
               FROM pg_catalog.aclexplode(
                 COALESCE(object_acl, pg_catalog.acldefault(acl_kind, owner_oid))
               ) acl
           ) AS semantic_acl
      FROM shared_object
     ORDER BY object_kind, object_name
  `);
  return result.rows;
}

function disposableConfiguration(env) {
  if (env.TRAILMIND_SUPABASE_POSTGIS_ISOLATION_V2_DISPOSABLE !== "true") {
    return undefined;
  }
  if (
    !env.PGHOST?.startsWith("/private/tmp/trailmind-postgis-isolation-v2.") ||
    env.PGUSER !== "postgres" ||
    env.PGDATABASE !== "postgres" ||
    env.PGPASSWORD
  ) throw new TypeError("supabase_postgis_isolation_v2_disposable_invalid");
  return Object.freeze({
    host: env.PGHOST,
    port: Number(env.PGPORT),
    database: env.PGDATABASE,
    user: env.PGUSER,
    max: 2,
    allowExitOnIdle: true
  });
}
