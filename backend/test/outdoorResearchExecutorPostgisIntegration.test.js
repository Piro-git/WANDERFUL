import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { after, before, describe, it } from "node:test";
import pg from "pg";
import {
  V4_CASE_BINDINGS,
  V4_MANIFEST_DIGEST
} from "../evaluation/outdoorAdventureTargetedLiveRouteQualityProofV4/contract.js";
import {
  captureV4ProofRunContextAfterImports,
  reconcileV4DatabaseClockEvidence,
  runV4DatabasePlanningClockGate
} from "../evaluation/outdoorAdventureTargetedLiveRouteQualityProofV4/databaseGate.js";
import {
  createV4ProofClockBinding,
  validateV4ProofClockBinding
} from "../evaluation/outdoorAdventureTargetedLiveRouteQualityProofV4/proofRunContext.js";
import {
  planAndRouteOutdoorAdventureV1
} from "../src/outdoorAdventure/outdoorAdventureOrchestrator.js";
import {
  planAndRouteOutdoorAdventureV2
} from "../src/outdoorAdventure/outdoorAdventureOrchestratorV2.js";
import {
  RESEARCH_TRAIL_ACCESS_CANDIDATE_POLICY_V1
} from "../src/routeResearch/index.js";
import {
  validateOutdoorAdventurePlanningResponseV1
} from "../src/outdoorAdventure/orchestrationContract.js";
import {
  validateOutdoorAdventurePlanningResponseV2
} from "../src/outdoorAdventure/orchestrationContractV2.js";
import {
  OSM_POLICY_ACTIVATION_CONFIRMATION,
  OSM_POLICY_REVOCATION_CONFIRMATION,
  OSM_PROJECTION_POLICY_VERSION
} from "../src/outdoorResearch/osmProjectionPolicy.js";
import {
  researchOutdoorAdventureV1
} from "../src/outdoorResearch/outdoorResearchExecutor.js";
import {
  outdoorResearchRepositoryQueriesForTesting,
  PostgresOutdoorResearchRepository
} from "../src/outdoorResearch/postgresOutdoorResearchRepository.js";
import {
  configureOsmProjectionPolicy
} from "../src/outdoorResearch/postgresOsmProjectionPolicyRepository.js";
import {
  OUTDOOR_RESEARCH_REGION_BINDINGS_V1
} from "../src/outdoorResearch/regionBindings.js";

const { Pool } = pg;
const connectionString = process.env.TRAILMIND_TEST_POSTGIS_DATABASE_URL;
const NOW = new Date("2026-07-24T10:30:00.000Z");
const REVIEWED_AT = "2026-07-20T09:00:00.000Z";
const REGIONS = Object.freeze([
  {
    operationalRegionId: "harz-v1",
    anchor: { latitude: 51.8, longitude: 10.6 },
    envelope: [10.4, 51.65, 10.8, 51.95],
    osmBase: 1000,
    hashCharacter: "a"
  },
  {
    operationalRegionId: "innsbruck-alps-v1",
    anchor: { latitude: 47.2692, longitude: 11.4041 },
    envelope: [11.2, 47.15, 11.6, 47.4],
    osmBase: 2000,
    hashCharacter: "b"
  }
]);

describe("outdoor research executor real PostGIS integration", {
  skip: !connectionString
}, () => {
  let administrativePool;
  let administrativeRoleName;
  let auditorPool;
  let auditorRoleName;
  let functionOwnerRoleName;
  let pool;
  let runtimePool;
  let runtimeRoleName;
  let schemaName;
  let seeded;
  let sourceId;
  let policyId;

  before(async () => {
    const url = new URL(connectionString);
    if (!/test/i.test(url.pathname)) {
      throw new Error(
        "TRAILMIND_TEST_POSTGIS_DATABASE_URL must name a disposable test database."
      );
    }
    schemaName = `trailmind_executor_${randomUUID().replaceAll("-", "_")}`;
    administrativePool = new Pool({
      connectionString,
      max: 2,
      allowExitOnIdle: true
    });
    administrativeRoleName = (await administrativePool.query(
      "SELECT current_user AS role_name"
    )).rows[0].role_name;
    await administrativePool.query("CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA public");
    functionOwnerRoleName =
      `trailmind_function_owner_${randomUUID().replaceAll("-", "_")}`;
    await administrativePool.query(
      `CREATE ROLE ${quoteIdentifier(functionOwnerRoleName)}
         NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE
         NOREPLICATION NOBYPASSRLS`
    );
    await administrativePool.query(
      `GRANT ${quoteIdentifier(functionOwnerRoleName)}
         TO ${quoteIdentifier(administrativeRoleName)}`
    );
    await administrativePool.query("REVOKE CREATE ON SCHEMA public FROM PUBLIC");
    await administrativePool.query(
      `CREATE SCHEMA "${schemaName}"
         AUTHORIZATION ${quoteIdentifier(functionOwnerRoleName)}`
    );
    pool = new Pool({
      connectionString,
      options:
        `-c role=${functionOwnerRoleName} -c search_path=${schemaName},public`,
      max: 6,
      allowExitOnIdle: true
    });
    for (const migrationName of [
      "002_outdoor_evidence.sql",
      "003_outdoor_research_graph.sql",
      "004_osm_outdoor_research_projection.sql",
      "005_outdoor_research_projection_geometry.sql",
      "006_outdoor_route_membership_point_index.sql",
      "007_routable_highlight_access_geography_index.sql",
      "008_outdoor_research_runtime_read_contract.sql"
    ]) {
      const migration = await readFile(
        new URL(`../migrations/${migrationName}`, import.meta.url),
        "utf8"
      );
      await pool.query(migration);
      await pool.query(migration);
    }
    const configured = await configureOsmProjectionPolicy({
      pool,
      mode: "activate",
      policyVersion: OSM_PROJECTION_POLICY_VERSION,
      operatorConfirmation: OSM_POLICY_ACTIVATION_CONFIRMATION,
      reviewReference: "tests/outdoor-research-executor-v1",
      reviewedAt: REVIEWED_AT,
      now: () => NOW
    });
    sourceId = configured.sourceId;
    const policy = await pool.query(
      `SELECT source_policy_id
         FROM outdoor_research_source_policies
        WHERE source_id = $1
          AND policy_version = $2
          AND lifecycle_state = 'active'`,
      [sourceId, OSM_PROJECTION_POLICY_VERSION]
    );
    policyId = policy.rows[0].source_policy_id;
    seeded = new Map();
    for (const region of REGIONS) {
      seeded.set(
        region.operationalRegionId,
        await seedRegion(pool, region, sourceId, policyId)
      );
    }
    runtimeRoleName = `trailmind_runtime_${randomUUID().replaceAll("-", "_")}`;
    const runtimePassword = randomUUID();
    await administrativePool.query(
      `CREATE ROLE ${quoteIdentifier(runtimeRoleName)}
         LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE
         NOREPLICATION NOBYPASSRLS PASSWORD '${runtimePassword}'`
    );
    const databaseName = (await administrativePool.query(
      "SELECT current_database() AS database_name"
    )).rows[0].database_name;
    await administrativePool.query(
      `REVOKE TEMPORARY ON DATABASE ${quoteIdentifier(databaseName)} FROM PUBLIC`
    );
    await administrativePool.query(
      `REVOKE ALL ON SCHEMA ${quoteIdentifier(schemaName)}
         FROM ${quoteIdentifier(runtimeRoleName)}`
    );
    await administrativePool.query(
      `REVOKE ALL ON ALL TABLES IN SCHEMA ${quoteIdentifier(schemaName)}
         FROM ${quoteIdentifier(runtimeRoleName)}`
    );
    await administrativePool.query(
      `REVOKE ALL ON ALL SEQUENCES IN SCHEMA ${quoteIdentifier(schemaName)}
         FROM ${quoteIdentifier(runtimeRoleName)}`
    );
    await administrativePool.query(
      `GRANT USAGE ON SCHEMA ${quoteIdentifier(schemaName)}
         TO ${quoteIdentifier(runtimeRoleName)}`
    );
    for (const signature of runtimeFunctionSignatures(schemaName)) {
      await administrativePool.query(
        `GRANT EXECUTE ON FUNCTION ${signature}
           TO ${quoteIdentifier(runtimeRoleName)}`
      );
    }
    auditorRoleName = `trailmind_auditor_${randomUUID().replaceAll("-", "_")}`;
    const auditorPassword = randomUUID();
    await administrativePool.query(
      `CREATE ROLE ${quoteIdentifier(auditorRoleName)}
         LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE
         NOREPLICATION BYPASSRLS PASSWORD '${auditorPassword}'`
    );
    await administrativePool.query(
      `REVOKE ALL ON SCHEMA ${quoteIdentifier(schemaName)}
         FROM ${quoteIdentifier(auditorRoleName)}`
    );
    await administrativePool.query(
      `GRANT USAGE ON SCHEMA ${quoteIdentifier(schemaName)}
         TO ${quoteIdentifier(auditorRoleName)}`
    );
    await administrativePool.query(
      `GRANT SELECT ON ALL TABLES IN SCHEMA ${quoteIdentifier(schemaName)}
         TO ${quoteIdentifier(auditorRoleName)}`
    );
    const runtimeUrl = new URL(connectionString);
    runtimeUrl.username = runtimeRoleName;
    runtimeUrl.password = runtimePassword;
    runtimePool = new Pool({
      connectionString: runtimeUrl.toString(),
      options: `-c search_path=${schemaName},public`,
      max: 3,
      allowExitOnIdle: true
    });
    const auditorUrl = new URL(connectionString);
    auditorUrl.username = auditorRoleName;
    auditorUrl.password = auditorPassword;
    auditorPool = new Pool({
      connectionString: auditorUrl.toString(),
      options: `-c search_path=${schemaName},public`,
      max: 2,
      allowExitOnIdle: true
    });
  });

  after(async () => {
    if (auditorPool) await auditorPool.end();
    if (runtimePool) await runtimePool.end();
    if (pool) await pool.end();
    if (administrativePool && runtimeRoleName) {
      await administrativePool.query(
        `DROP OWNED BY ${quoteIdentifier(runtimeRoleName)}`
      );
      await administrativePool.query(
        `DROP ROLE ${quoteIdentifier(runtimeRoleName)}`
      );
    }
    if (administrativePool && auditorRoleName) {
      await administrativePool.query(
        `DROP OWNED BY ${quoteIdentifier(auditorRoleName)}`
      );
      await administrativePool.query(
        `DROP ROLE ${quoteIdentifier(auditorRoleName)}`
      );
    }
    if (administrativePool && schemaName) {
      await administrativePool.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    }
    if (administrativePool && functionOwnerRoleName) {
      await administrativePool.query(
        `REVOKE ${quoteIdentifier(functionOwnerRoleName)}
           FROM ${quoteIdentifier(administrativeRoleName)}`
      );
      await administrativePool.query(
        `DROP ROLE ${quoteIdentifier(functionOwnerRoleName)}`
      );
    }
    if (administrativePool) await administrativePool.end();
  });

  it("applies evidence and research migrations twice and retains spatial indexes", async () => {
    const relations = await pool.query(
      `SELECT to_regclass('outdoor_evidence_regions') IS NOT NULL AS regions,
              to_regclass('outdoor_research_sources') IS NOT NULL AS sources,
              to_regclass('outdoor_research_projection_runs') IS NOT NULL AS runs`
    );
    assert.deepEqual(relations.rows[0], {
      regions: true,
      sources: true,
      runs: true
    });
    const indexes = await pool.query(
      `SELECT indexname
         FROM pg_indexes
        WHERE schemaname = $1
          AND indexname IN (
            'outdoor_evidence_regions_boundary_gist_idx',
            'outdoor_research_projection_entities_geometry_gist_idx',
            'outdoor_research_projection_entities_trail_point_gist_idx',
            'outdoor_research_projection_entities_trail_geography_gist_idx',
            'outdoor_research_projection_assertions_lookup_idx',
            'outdoor_research_projection_relationships_subject_idx'
          )`,
      [schemaName]
    );
    assert.equal(indexes.rowCount, 6);
  });

  it("seals and reconciles one V4 proof clock against real active PostGIS snapshots", async () => {
    const runContext = await captureV4ProofRunContextAfterImports({
      pool,
      authorizationReference: "USER_AUTHORIZED_V4_POSTGIS_CLOCK_TEST",
      ledgerNamespace: "outdoor-adventure-v4-postgis-clock-test",
      caseManifestDigest: V4_MANIFEST_DIGEST,
      clock: () => NOW
    });
    const cases = V4_CASE_BINDINGS.map(({ caseId }) => ({ id: caseId }));
    const intents = new Map(cases.map(({ id }) => [id, { id }]));
    const observed = [];
    const diagnostic = await runV4DatabasePlanningClockGate({
      runContext,
      cases,
      intents,
      repository: {},
      async researchAdventure(_intent, dependencies) {
        observed.push(dependencies.clock().toISOString());
        return {
          state: "ready",
          dossier: {},
          trailAccessResolution: {}
        };
      },
      buildCandidatePlan: () => ({ state: "ready", proposals: [{}] }),
      validateCandidatePlan: (plan) => plan,
      validateCandidatePlanForResearch: () => true
    });
    assert.deepEqual(observed, Array(V4_CASE_BINDINGS.length).fill(
      NOW.toISOString()
    ));
    assert.equal(await reconcileV4DatabaseClockEvidence(
      pool,
      runContext
    ), true);
    const binding = createV4ProofClockBinding(runContext, diagnostic);
    assert.equal(validateV4ProofClockBinding(
      runContext,
      diagnostic,
      binding
    ), true);
  });

  it("leaves migration 007 as a true second-run no-op", async () => {
    const state = async () => (await pool.query(
      `SELECT index_relation.oid::text AS oid,
              index_relation.relfilenode::text AS relfilenode,
              pg_relation_size(index_relation.oid)::text AS size_bytes,
              pg_get_indexdef(index_relation.oid) AS definition
         FROM pg_class index_relation
         JOIN pg_namespace namespace
           ON namespace.oid = index_relation.relnamespace
        WHERE namespace.nspname = $1
          AND index_relation.relname =
            'outdoor_research_projection_entities_trail_geography_gist_idx'`,
      [schemaName]
    )).rows[0];
    const before = await state();
    const migration = await readFile(
      new URL(
        "../migrations/007_routable_highlight_access_geography_index.sql",
        import.meta.url
      ),
      "utf8"
    );

    await pool.query(migration);
    await pool.query(migration);

    assert.deepEqual(await state(), before);
  });

  it("leaves migration 008 functions unchanged on the second direct run", async () => {
    const state = async () => (await pool.query(
      `SELECT procedure.oid::text AS oid,
              procedure.proname,
              procedure.proconfig
         FROM pg_proc procedure
         JOIN pg_namespace namespace
           ON namespace.oid = procedure.pronamespace
        WHERE namespace.nspname = $1
          AND procedure.proname LIKE
            'trailmind_runtime_outdoor_research_%_v1'
        ORDER BY procedure.proname`,
      [schemaName]
    )).rows;
    const before = await state();
    const migration = await readFile(
      new URL(
        "../migrations/008_outdoor_research_runtime_read_contract.sql",
        import.meta.url
      ),
      "utf8"
    );

    await pool.query(migration);
    await pool.query(migration);

    assert.equal(before.length, 5);
    assert.deepEqual(await state(), before);
  });

  it("rolls the runtime contract migration back atomically on failure", async () => {
    const rollbackSchema =
      `trailmind_rollback_${randomUUID().replaceAll("-", "_")}`;
    await administrativePool.query(
      `CREATE SCHEMA ${quoteIdentifier(rollbackSchema)}
         AUTHORIZATION ${quoteIdentifier(functionOwnerRoleName)}`
    );
    const rollbackPool = new Pool({
      connectionString,
      options:
        `-c role=${functionOwnerRoleName} -c search_path=${rollbackSchema},public`,
      max: 1,
      allowExitOnIdle: true
    });
    try {
      for (const migrationName of [
        "002_outdoor_evidence.sql",
        "003_outdoor_research_graph.sql",
        "004_osm_outdoor_research_projection.sql",
        "005_outdoor_research_projection_geometry.sql",
        "006_outdoor_route_membership_point_index.sql",
        "007_routable_highlight_access_geography_index.sql"
      ]) {
        await rollbackPool.query(await readFile(
          new URL(`../migrations/${migrationName}`, import.meta.url),
          "utf8"
        ));
      }
      const migration = await readFile(
        new URL(
          "../migrations/008_outdoor_research_runtime_read_contract.sql",
          import.meta.url
        ),
        "utf8"
      );
      const client = await rollbackPool.connect();
      try {
        await client.query("BEGIN");
        await client.query(migration);
        await assert.rejects(
          () => client.query("SELECT missing_runtime_migration_symbol"),
          (error) => error?.code === "42703"
        );
        await client.query("ROLLBACK");
      } finally {
        client.release();
      }
      const functions = await rollbackPool.query(
        `SELECT count(*)::integer AS count
           FROM pg_proc procedure
           JOIN pg_namespace namespace
             ON namespace.oid = procedure.pronamespace
          WHERE namespace.nspname = $1
            AND procedure.proname LIKE
              'trailmind_runtime_outdoor_research_%_v1'`,
        [rollbackSchema]
      );
      assert.equal(functions.rows[0].count, 0);
    } finally {
      await rollbackPool.end();
      await administrativePool.query(
        `DROP SCHEMA IF EXISTS ${quoteIdentifier(rollbackSchema)} CASCADE`
      );
    }
  });

  it("uses a real non-elevated login role with execute-only repository access", async () => {
    const identity = await runtimePool.query(
      `SELECT current_user, session_user,
              rolcanlogin, rolinherit, rolsuper, rolcreatedb, rolcreaterole,
              rolreplication, rolbypassrls,
              NOT EXISTS (
                SELECT 1 FROM pg_auth_members membership
                 WHERE membership.member = role.oid
              ) AS no_role_memberships
         FROM pg_roles role
        WHERE role.rolname = current_user`
    );
    assert.deepEqual(identity.rows, [{
      current_user: runtimeRoleName,
      session_user: runtimeRoleName,
      rolcanlogin: true,
      rolinherit: false,
      rolsuper: false,
      rolcreatedb: false,
      rolcreaterole: false,
      rolreplication: false,
      rolbypassrls: false,
      no_role_memberships: true
    }]);
    const privileges = await runtimePool.query(
      `SELECT has_schema_privilege(current_user, $1, 'USAGE') AS schema_usage,
              has_schema_privilege(current_user, $1, 'CREATE') AS schema_create,
              has_database_privilege(
                current_user, current_database(), 'TEMPORARY'
              ) AS database_temporary,
              has_table_privilege(
                current_user, $2, 'SELECT'
              ) AS base_select,
              has_table_privilege(
                current_user, $3, 'SELECT'
              ) AS active_view_select,
              NOT EXISTS (
                SELECT 1
                  FROM pg_class relation
                  JOIN pg_namespace namespace
                    ON namespace.oid = relation.relnamespace
                 WHERE namespace.nspname = $1
                   AND relation.relkind IN ('r', 'p', 'v', 'm', 'f')
                   AND relation.relname LIKE 'outdoor\_%' ESCAPE '\'
                   AND has_table_privilege(
                     current_user,
                     relation.oid,
                     'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
                   )
              ) AS no_operational_relation_privileges,
              NOT EXISTS (
                SELECT 1
                  FROM pg_class relation
                  JOIN pg_namespace namespace
                    ON namespace.oid = relation.relnamespace
                 WHERE namespace.nspname = $1
                   AND relation.relkind = 'S'
                   AND has_sequence_privilege(
                     current_user, relation.oid, 'USAGE,SELECT,UPDATE'
                   )
              ) AS no_sequence_privileges,
              NOT EXISTS (
                SELECT 1 FROM pg_class relation
                 WHERE relation.relowner = (
                   SELECT oid FROM pg_roles WHERE rolname = current_user
                 )
              ) AND NOT EXISTS (
                SELECT 1 FROM pg_proc procedure
                 WHERE procedure.proowner = (
                   SELECT oid FROM pg_roles WHERE rolname = current_user
                 )
              ) AS owns_no_objects`,
      [
        schemaName,
        `${schemaName}.outdoor_research_projection_entities`,
        `${schemaName}.outdoor_research_active_projection_runs`
      ]
    );
    assert.deepEqual(privileges.rows, [{
      schema_usage: true,
      schema_create: false,
      database_temporary: false,
      base_select: false,
      active_view_select: false,
      no_operational_relation_privileges: true,
      no_sequence_privileges: true,
      owns_no_objects: true
    }]);
    for (const signature of runtimeFunctionSignatures(schemaName)) {
      const privilege = await runtimePool.query(
        "SELECT has_function_privilege(current_user, $1, 'EXECUTE') AS allowed",
        [signature]
      );
      assert.equal(privilege.rows[0].allowed, true, signature);
    }
    const owners = await administrativePool.query(
      `SELECT procedure.proname,
              owner.rolname AS owner_name,
              owner.rolcanlogin,
              owner.rolinherit,
              owner.rolsuper,
              owner.rolcreatedb,
              owner.rolcreaterole,
              owner.rolreplication,
              owner.rolbypassrls,
              NOT EXISTS (
                SELECT 1 FROM pg_auth_members membership
                 WHERE membership.member = owner.oid
              ) AS no_role_memberships,
              NOT EXISTS (
                SELECT 1
                  FROM aclexplode(COALESCE(
                    procedure.proacl,
                    acldefault('f', procedure.proowner)
                  )) privilege
                 WHERE privilege.grantee = 0
                   AND privilege.privilege_type = 'EXECUTE'
              ) AS no_public_execute
         FROM pg_proc procedure
         JOIN pg_namespace namespace
           ON namespace.oid = procedure.pronamespace
         JOIN pg_roles owner ON owner.oid = procedure.proowner
        WHERE namespace.nspname = $1
          AND procedure.proname LIKE
            'trailmind_runtime_outdoor_research_%_v1'`,
      [schemaName]
    );
    assert.equal(owners.rowCount, 5);
    assert(owners.rows.every((row) =>
      row.owner_name === functionOwnerRoleName &&
      row.rolcanlogin === false &&
      row.rolinherit === false &&
      row.rolsuper === false &&
      row.rolcreatedb === false &&
      row.rolcreaterole === false &&
      row.rolreplication === false &&
      row.rolbypassrls === false &&
      row.no_role_memberships === true &&
      row.no_public_execute === true
    ));

    const repository = new PostgresOutdoorResearchRepository({
      pool: runtimePool,
      runtimeSchema: schemaName,
      statementTimeoutMs: 2_000
    });
    for (const region of REGIONS) {
      const result = await researchOutdoorAdventureV1(intent(region), {
        repository,
        clock: () => NOW,
        totalTimeoutMs: 5_000
      });
      assert.equal(result.state, "ready");
      assert(result.dossier.candidateHighlights.length > 0);
      assert(result.dossier.mappedOrOfficialRouteCandidates.length > 0);
    }
  });

  it("captures reviewed indexes through the separate auditor role", async () => {
    const ids = seeded.get("harz-v1");
    await seedRepresentativeTrailVolume({
      pool,
      sourceId,
      projectionRunId: ids.runId,
      importId: ids.importId,
      operationalRegionId: "harz-v1",
      osmBase: REGIONS[0].osmBase + 30_000,
      count: 1_000
    });
    await pool.query("ANALYZE outdoor_research_projection_entities");
    const client = await auditorPool.connect();
    try {
      await client.query("BEGIN TRANSACTION READ ONLY");
      await client.query("SET LOCAL enable_seqscan = off");
      const routePlan = await client.query(
        `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
${outdoorResearchRepositoryQueriesForTesting.routeMemberships}`,
        [ids.runId, "harz-v1", 10.6, 51.8, 10_000, 24, 1]
      );
      const routeIndexes = collectPlanValues(
        routePlan.rows[0]["QUERY PLAN"],
        "Index Name"
      );
      assert(routeIndexes.includes(
        "outdoor_research_projection_relationships_subject_idx"
      ), `observed runtime route indexes: ${routeIndexes.join(", ")}`);

      const accessPlan = await client.query(
        `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
${outdoorResearchRepositoryQueriesForTesting.trailAccessCandidates}`,
        [
          ids.runId,
          "harz-v1",
          [ids.viewpointId],
          75,
          3,
          RESEARCH_TRAIL_ACCESS_CANDIDATE_POLICY_V1.eligibleHighwayClasses,
          RESEARCH_TRAIL_ACCESS_CANDIDATE_POLICY_V1.highlightCategories,
          64
        ]
      );
      const accessIndexes = collectPlanValues(
        accessPlan.rows[0]["QUERY PLAN"],
        "Index Name"
      );
      assert(accessIndexes.includes(
        "outdoor_research_projection_entities_trail_geography_gist_idx"
      ), `observed runtime access indexes: ${accessIndexes.join(", ")}`);
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  });

  it("denies direct reads, writes, DDL, role changes and RLS bypass attempts", async () => {
    const denied = [
      "SELECT * FROM outdoor_research_projection_entities LIMIT 1",
      "SELECT * FROM outdoor_research_active_projection_runs LIMIT 1",
      "INSERT INTO outdoor_research_projection_quarantines (quarantine_id, projection_run_id, reason_code, record_kind, osm_type, osm_id) VALUES ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'invalid_value', 'poi', 'node', 1)",
      "UPDATE outdoor_evidence_regions SET enabled = false WHERE region_id = 'harz-v1'",
      "DELETE FROM outdoor_research_projection_entities WHERE false",
      "TRUNCATE outdoor_research_projection_entities",
      "ALTER TABLE outdoor_research_projection_entities DISABLE ROW LEVEL SECURITY",
      "CREATE POLICY runtime_escape ON outdoor_research_projection_entities USING (true)",
      "CREATE TABLE runtime_escape (id integer)",
      "CREATE TEMP TABLE runtime_escape_temp (id integer)",
      `CREATE FUNCTION ${quoteIdentifier(schemaName)}.runtime_escape()
         RETURNS integer LANGUAGE sql AS 'SELECT 1'`,
      "CREATE ROLE runtime_escape_role",
      `ALTER ROLE ${quoteIdentifier(administrativeRoleName)} SUPERUSER`,
      `ALTER ROLE ${quoteIdentifier(functionOwnerRoleName)} LOGIN`,
      `SET ROLE ${quoteIdentifier(administrativeRoleName)}`,
      `SET ROLE ${quoteIdentifier(functionOwnerRoleName)}`
    ];
    for (const sql of denied) {
      let observed;
      try {
        await runtimePool.query(sql);
      } catch (error) {
        observed = error;
      }
      assert(
        ["42501", "42P01", "0LP01"].includes(observed?.code),
        `${sql}: ${observed?.code ?? "unexpectedly allowed"}`
      );
    }
    await runtimePool.query("SET row_security = off");
    try {
      await assert.rejects(
        () => runtimePool.query(
          "SELECT * FROM outdoor_research_projection_entities LIMIT 1"
        ),
        (error) => ["42501", "42P01"].includes(error?.code)
      );
    } finally {
      await runtimePool.query("RESET row_security");
    }
  });

  it("removes superseded imports and revoked source policy state from runtime results", async () => {
    const ids = seeded.get("harz-v1");
    const repository = new PostgresOutdoorResearchRepository({
      pool: runtimePool,
      runtimeSchema: schemaName,
      statementTimeoutMs: 2_000
    });
    const resolve = () => repository.withConsistentSnapshot({}, (session) =>
      session.resolveCapabilities(binding(REGIONS[0]), REGIONS[0].anchor, NOW)
    );
    assert.equal((await resolve()).availabilityState, "active");

    await pool.query(
      "UPDATE outdoor_evidence_imports SET status = 'superseded' WHERE import_id = $1",
      [ids.importId]
    );
    try {
      assert.equal((await resolve()).availabilityState, "source_unavailable");
      const memberships = await runtimePool.query(
        `SELECT trailmind_runtime_outdoor_research_route_memberships_v1(
           $1, $2, $3, $4, $5, $6, $7
         ) AS runtime_row`,
        [ids.runId, "harz-v1", 10.6, 51.8, 10_000, 24, 1]
      );
      assert.equal(memberships.rowCount, 0);
    } finally {
      await pool.query(
        "UPDATE outdoor_evidence_imports SET status = 'active' WHERE import_id = $1",
        [ids.importId]
      );
    }

    await pool.query(
      "UPDATE outdoor_research_sources SET lifecycle_state = 'paused' WHERE source_id = $1",
      [sourceId]
    );
    try {
      assert.equal((await resolve()).availabilityState, "source_unavailable");
    } finally {
      await pool.query(
        "UPDATE outdoor_research_sources SET lifecycle_state = 'active' WHERE source_id = $1",
        [sourceId]
      );
    }

    await pool.query(
      "UPDATE outdoor_research_source_policies SET lifecycle_state = 'blocked' WHERE source_policy_id = $1",
      [policyId]
    );
    try {
      assert.equal((await resolve()).availabilityState, "source_unavailable");
    } finally {
      await pool.query(
        "UPDATE outdoor_research_source_policies SET lifecycle_state = 'active' WHERE source_policy_id = $1",
        [policyId]
      );
    }
  });

  it("resolves exact Harz and Innsbruck boundaries without cross-region leakage", async () => {
    for (const region of REGIONS) {
      const result = await execute(region);
      const ids = seeded.get(region.operationalRegionId);
      const other = seeded.get(REGIONS.find((item) =>
        item.operationalRegionId !== region.operationalRegionId
      ).operationalRegionId);
      assert.equal(result.state, "ready");
      assert.deepEqual(result.dossier.regionCoverage.regionEntityIds, [
        binding(region).regionEntityId
      ]);
      assert.deepEqual(
        result.dossier.candidateHighlights.map((candidate) => candidate.entityId),
        [ids.viewpointId, ids.hutId]
      );
      assert.equal(
        result.dossier.evidenceClaims.some((claim) =>
          Object.values(other).includes(claim.entityId)),
        false
      );
    }
  });

  it("orchestrates real Harz and Innsbruck snapshots through deterministic fake routing", async () => {
    for (const region of REGIONS) {
      const repository = new PostgresOutdoorResearchRepository({
        pool,
        runtimeSchema: schemaName,
        statementTimeoutMs: 2_000
      });
      const result = await planAndRouteOutdoorAdventureV1(
        {
          schemaVersion: 1,
          intent: intent(region, {
            requiredFacilities: [],
            preferredExperiences: []
          })
        },
        {
          repository,
          clock: () => NOW,
          provider: {
            async route(request) {
              return deterministicProviderResponse(request);
            }
          }
        },
        {
          maximumProposals: 2,
          maximumConcurrency: 2,
          researchTimeoutMs: 5_000,
          graphHopperAttemptTimeoutMs: 5_000,
          totalDeadlineMs: 15_000
        }
      );
      assert(["partial", "routed"].includes(result.state));
      assert(result.routedAlternatives.attempts.length >= 1);
      assert(result.routedAlternatives.attempts.every((attempt) =>
        attempt.state === "routed"
      ));
      assert.doesNotThrow(() =>
        validateOutdoorAdventurePlanningResponseV1(result)
      );
    }
  });

  it("reads active projection assertions and mapped route memberships with provenance", async () => {
    const repository = new PostgresOutdoorResearchRepository({
      pool,
      runtimeSchema: schemaName,
      statementTimeoutMs: 2_000
    });
    const rawRoutes = await repository.withConsistentSnapshot({}, async (session) => {
      const capabilities = await session.resolveCapabilities(
        binding(REGIONS[0]),
        REGIONS[0].anchor,
        NOW
      );
      return session.retrieveMappedHikingRoutes({
        projectionRunId: capabilities.snapshot.projectionRunId,
        operationalRegionId: "harz-v1",
        anchor: REGIONS[0].anchor,
        predicates: ["mapped_hiking_route_membership"],
        searchRadiusMeters: 10_000,
        limit: 1
      });
    });
    assert.equal(rawRoutes.memberships[0].evidence_class, "mapped");

    const result = await execute(REGIONS[0]);
    const ids = seeded.get("harz-v1");
    assert.equal(result.dossier.mappedOrOfficialRouteCandidates.length, 1);
    assert.equal(
      result.dossier.mappedOrOfficialRouteCandidates[0].entityId,
      ids.routeId
    );
    assert.equal(
      result.dossier.mappedOrOfficialRouteCandidates[0].sourceBasis,
      "mapped"
    );
    const membership = result.dossier.evidenceClaims.find((claim) =>
      claim.predicate === "mapped_hiking_route_membership"
    );
    assert.equal(membership.entityId, ids.routeId);
    assert.deepEqual(membership.value, {
      type: "entity_reference",
      value: ids.segmentId
    });
    assert.equal(membership.provenance.recordVersion, 7);
    assert.equal(
      result.dossier.sourceProvenanceSummary[0].licenseIdentifier,
      "ODbL-1.0"
    );
    assert(result.dossier.candidateHighlights.every((candidate) =>
      candidate.knownLimitations.includes("route_connection_unverified")
    ));
    assert(result.dossier.evidenceGaps.some((gap) =>
      gap.code === "missing_route_connection" &&
      gap.predicate === null
    ));
  });

  it("does not promote an evidence-valid highlight far from the mapped trail network", async () => {
    const region = REGIONS[0];
    const ids = seeded.get(region.operationalRegionId);
    const isolatedAnchor = {
      longitude: region.anchor.longitude + 0.05,
      latitude: region.anchor.latitude + 0.05
    };
    await insertProjectedViewpoint({
      pool,
      sourceId,
      projectionRunId: ids.runId,
      operationalRegionId: region.operationalRegionId,
      osmId: region.osmBase + 99,
      coordinate: isolatedAnchor
    });
    const repository = new PostgresOutdoorResearchRepository({
      pool,
      runtimeSchema: schemaName,
      statementTimeoutMs: 2_000
    });
    const rows = await repository.withConsistentSnapshot({}, async (session) => {
      const capabilities = await session.resolveCapabilities(
        binding(region),
        region.anchor,
        NOW
      );
      return session.discoverHighlights({
        projectionRunId: capabilities.snapshot.projectionRunId,
        operationalRegionId: region.operationalRegionId,
        anchor: isolatedAnchor,
        entityCategories: ["viewpoint"],
        predicates: ["entity_category", "viewpoint_presence"],
        searchRadiusMeters: 500,
        limit: 12
      });
    });
    assert.deepEqual(rows, []);
  });

  it("enforces the 75 m mapped-trail boundary in metres without latitude prefilter loss", async () => {
    const region = REGIONS[0];
    const ids = seeded.get(region.operationalRegionId);
    const trailPoint = {
      longitude: region.anchor.longitude + 0.015,
      latitude: region.anchor.latitude
    };
    const distances = [74.9, 75, 75.1];
    const inserted = [];
    for (const [index, distanceMeters] of distances.entries()) {
      const coordinate = await projectCoordinate(
        pool,
        trailPoint,
        distanceMeters,
        0
      );
      inserted.push({
        distanceMeters,
        coordinate,
        entityId: await insertProjectedViewpoint({
          pool,
          sourceId,
          projectionRunId: ids.runId,
          operationalRegionId: region.operationalRegionId,
          osmId: region.osmBase + 110 + index,
          coordinate
        })
      });
    }
    const repository = new PostgresOutdoorResearchRepository({
      pool,
      runtimeSchema: schemaName,
      statementTimeoutMs: 2_000
    });
    const rows = await repository.withConsistentSnapshot({}, async (session) => {
      const capabilities = await session.resolveCapabilities(
        binding(region),
        region.anchor,
        NOW
      );
      return session.discoverHighlights({
        projectionRunId: capabilities.snapshot.projectionRunId,
        operationalRegionId: region.operationalRegionId,
        anchor: trailPoint,
        entityCategories: ["viewpoint"],
        predicates: ["entity_category", "viewpoint_presence"],
        searchRadiusMeters: 500,
        limit: 12
      });
    });
    const returnedIds = new Set(rows.map((row) => row.entity_id));
    assert.equal(returnedIds.has(inserted[0].entityId), true);
    assert.equal(returnedIds.has(inserted[1].entityId), true);
    assert.equal(returnedIds.has(inserted[2].entityId), false);
    for (const expected of inserted.slice(0, 2)) {
      const row = rows.find((item) => item.entity_id === expected.entityId);
      assert.ok(row);
      assert.ok(Math.abs(row.latitude - expected.coordinate.latitude) < 1e-9);
      assert.ok(Math.abs(row.longitude - expected.coordinate.longitude) < 1e-9);
    }
  });

  it("computes deterministic closest trail access points at the exact 75 m boundary", async () => {
    const region = REGIONS[0];
    const ids = seeded.get(region.operationalRegionId);
    const otherIds = seeded.get(REGIONS[1].operationalRegionId);
    const trailPoint = {
      longitude: region.anchor.longitude + 0.015,
      latitude: region.anchor.latitude
    };
    const trailGeometry = [
      {
        longitude: trailPoint.longitude - 0.001,
        latitude: trailPoint.latitude
      },
      {
        longitude: trailPoint.longitude + 0.001,
        latitude: trailPoint.latitude
      }
    ];
    await insertProjectedTrailSegment({
      pool,
      sourceId,
      projectionRunId: ids.runId,
      importId: ids.importId,
      operationalRegionId: region.operationalRegionId,
      osmId: region.osmBase + 250,
      coordinates: trailGeometry
    });
    await insertProjectedTrailSegment({
      pool,
      sourceId,
      projectionRunId: ids.runId,
      importId: ids.importId,
      operationalRegionId: region.operationalRegionId,
      osmId: region.osmBase + 251,
      coordinates: trailGeometry
    });
    const inserted = [];
    for (const [index, distanceMeters] of [74.9, 75, 75.1].entries()) {
      const coordinate = await projectCoordinate(pool, trailPoint, distanceMeters, 0);
      inserted.push({
        distanceMeters,
        coordinate,
        entityId: await insertProjectedViewpoint({
          pool,
          sourceId,
          projectionRunId: ids.runId,
          operationalRegionId: region.operationalRegionId,
          osmId: region.osmBase + 210 + index,
          coordinate
        })
      });
    }
    const repository = new PostgresOutdoorResearchRepository({
      pool,
      runtimeSchema: schemaName,
      statementTimeoutMs: 2_000
    });
    const request = {
      projectionRunId: ids.runId,
      operationalRegionId: region.operationalRegionId,
      highlights: [
        ...inserted.map((item) => ({
          entityId: item.entityId,
          highlightCategory: "viewpoint",
          evidenceCoordinate: item.coordinate
        })),
        {
          entityId: otherIds.viewpointId,
          highlightCategory: "viewpoint",
          evidenceCoordinate: REGIONS[1].anchor
        }
      ],
      maximumDistanceMeters: 75,
      maximumCandidatesPerHighlight: 3,
      eligibleHighwayClasses:
        RESEARCH_TRAIL_ACCESS_CANDIDATE_POLICY_V1.eligibleHighwayClasses,
      highlightCategories:
        RESEARCH_TRAIL_ACCESS_CANDIDATE_POLICY_V1.highlightCategories,
      maximumRows: 64
    };
    const first = await repository.withConsistentSnapshot({}, (session) =>
      session.resolveTrailAccessCandidates(request)
    );
    const second = await repository.withConsistentSnapshot({}, (session) =>
      session.resolveTrailAccessCandidates(request)
    );
    assert.deepEqual(first, second);
    const returned = new Set(first.map((row) => row.highlight_entity_id));
    assert.equal(returned.has(inserted[0].entityId), true);
    assert.equal(returned.has(inserted[1].entityId), true);
    assert.equal(returned.has(inserted[2].entityId), false);
    assert.equal(returned.has(otherIds.viewpointId), false);
    for (const expected of inserted.slice(0, 2)) {
      const rows = first.filter((item) =>
        item.highlight_entity_id === expected.entityId
      );
      assert.equal(rows.length, 2);
      assert.deepEqual(
        rows.map((row) => row.trail_entity_id),
        rows.map((row) => row.trail_entity_id).sort()
      );
      for (const row of rows) {
        assert.ok(Math.abs(row.routing_latitude - trailPoint.latitude) < 1e-8);
        assert.ok(Math.abs(row.routing_longitude - trailPoint.longitude) < 1e-8);
        assert.ok(Math.abs(
          row.poi_to_access_distance_meters - expected.distanceMeters
        ) < 0.02);
        assert.equal(row.highway_class, "path");
        assert.equal(row.trail_osm_type, "way");
        assert.match(row.trail_osm_id, /^[1-9][0-9]*$/);
        assert.equal(row.trail_category_evidence_claim_ids.length, 1);
      }
    }
  });

  it("orchestrates V2 through real access projection and deterministic fake routing", async () => {
    const region = REGIONS[1];
    const ids = seeded.get(region.operationalRegionId);
    const highlight = {
      longitude: region.anchor.longitude + 0.01,
      latitude: region.anchor.latitude
    };
    await insertProjectedTrailSegment({
      pool,
      sourceId,
      projectionRunId: ids.runId,
      importId: ids.importId,
      operationalRegionId: region.operationalRegionId,
      osmId: region.osmBase + 260,
      coordinates: [
        { longitude: highlight.longitude - 0.001, latitude: highlight.latitude },
        { longitude: highlight.longitude + 0.001, latitude: highlight.latitude }
      ]
    });
    const repository = new PostgresOutdoorResearchRepository({
      pool,
      runtimeSchema: schemaName,
      statementTimeoutMs: 2_000
    });
    let providerRequest;
    const result = await planAndRouteOutdoorAdventureV2(
      {
        schemaVersion: 2,
        intent: intent(region, {
          requiredFacilities: [],
          preferredExperiences: []
        })
      },
      {
        repository,
        clock: () => NOW,
        provider: { async route(request) {
          providerRequest = request;
          return deterministicProviderResponse(request);
        } }
      },
      {
        maximumProposals: 2,
        maximumConcurrency: 2,
        researchTimeoutMs: 5_000,
        graphHopperAttemptTimeoutMs: 5_000,
        totalDeadlineMs: 15_000
      }
    );

    assert(["partial", "routed"].includes(result.state));
    assert.equal(result.routedAlternatives.schemaVersion, 2);
    const routed = result.routedAlternatives.attempts.find((attempt) =>
      attempt.state === "routed"
    );
    assert.ok(routed);
    const approach = routed.routeResults[0].highlightVerifications[0];
    assert.equal(approach.providerVerifiedAccess, true);
    assert.equal(approach.approachState, "reached");
    assert.deepEqual(
      providerRequest.points[1],
      routed.provenance.selectedHighlights[0].routingCoordinate
    );
    assert.doesNotThrow(() => validateOutdoorAdventurePlanningResponseV2(result));
  });

  it("rejects restricted, quarantined, malformed, inactive and unsupported trail access", async () => {
    const region = REGIONS[0];
    const ids = seeded.get(region.operationalRegionId);
    const trailPoint = {
      longitude: region.anchor.longitude + 0.0185,
      latitude: region.anchor.latitude
    };
    const highlightId = await insertProjectedViewpoint({
      pool,
      sourceId,
      projectionRunId: ids.runId,
      operationalRegionId: region.operationalRegionId,
      osmId: region.osmBase + 269,
      coordinate: trailPoint
    });
    const coordinates = [
      { longitude: trailPoint.longitude - 0.0005, latitude: trailPoint.latitude },
      { longitude: trailPoint.longitude + 0.0005, latitude: trailPoint.latitude }
    ];
    const eligible = await insertProjectedTrailSegment({
      pool, sourceId, projectionRunId: ids.runId, importId: ids.importId,
      operationalRegionId: region.operationalRegionId,
      osmId: region.osmBase + 270, coordinates
    });
    await insertProjectedTrailSegment({
      pool, sourceId, projectionRunId: ids.runId, importId: ids.importId,
      operationalRegionId: region.operationalRegionId,
      osmId: region.osmBase + 271, coordinates,
      accessRestriction: "restricted"
    });
    await insertProjectedTrailSegment({
      pool, sourceId, projectionRunId: ids.runId, importId: ids.importId,
      operationalRegionId: region.operationalRegionId,
      osmId: region.osmBase + 272, coordinates,
      accessRestriction: "prohibited"
    });
    await insertProjectedTrailSegment({
      pool, sourceId, projectionRunId: ids.runId, importId: ids.importId,
      operationalRegionId: region.operationalRegionId,
      osmId: region.osmBase + 273, coordinates, quarantined: true
    });
    await insertProjectedTrailSegment({
      pool, sourceId, projectionRunId: ids.runId, importId: ids.importId,
      operationalRegionId: region.operationalRegionId,
      osmId: region.osmBase + 274, coordinates, lifecycleState: "retired"
    });
    await insertProjectedTrailSegment({
      pool, sourceId, projectionRunId: ids.runId, importId: ids.importId,
      operationalRegionId: region.operationalRegionId,
      osmId: region.osmBase + 275, coordinates,
      projectedGeometryAvailable: false
    });
    await insertProjectedTrailSegment({
      pool, sourceId, projectionRunId: ids.runId, importId: ids.importId,
      operationalRegionId: region.operationalRegionId,
      osmId: region.osmBase + 276, coordinates, highwayClass: "service"
    });
    const repository = new PostgresOutdoorResearchRepository({
      pool,
      runtimeSchema: schemaName,
      statementTimeoutMs: 2_000
    });
    const request = {
      projectionRunId: ids.runId,
      operationalRegionId: region.operationalRegionId,
      highlights: [{
        entityId: highlightId,
        highlightCategory: "viewpoint",
        evidenceCoordinate: trailPoint
      }],
      maximumDistanceMeters: 75,
      maximumCandidatesPerHighlight: 3,
      eligibleHighwayClasses:
        RESEARCH_TRAIL_ACCESS_CANDIDATE_POLICY_V1.eligibleHighwayClasses,
      highlightCategories:
        RESEARCH_TRAIL_ACCESS_CANDIDATE_POLICY_V1.highlightCategories,
      maximumRows: 64
    };
    const resolve = () => repository.withConsistentSnapshot({}, (session) =>
      session.resolveTrailAccessCandidates(request)
    );

    assert.deepEqual(
      (await resolve()).map((row) => row.trail_entity_id),
      [eligible.entityId]
    );
    await pool.query(
      "UPDATE outdoor_evidence_imports SET status = 'superseded' WHERE import_id = $1",
      [ids.importId]
    );
    try {
      assert.deepEqual(await resolve(), []);
    } finally {
      await pool.query(
        "UPDATE outdoor_evidence_imports SET status = 'active' WHERE import_id = $1",
        [ids.importId]
      );
    }
    await pool.query(
      "UPDATE outdoor_research_sources SET lifecycle_state = 'paused' WHERE source_id = $1",
      [sourceId]
    );
    try {
      assert.deepEqual(await resolve(), []);
    } finally {
      await pool.query(
        "UPDATE outdoor_research_sources SET lifecycle_state = 'active' WHERE source_id = $1",
        [sourceId]
      );
    }
    await pool.query(
      "UPDATE outdoor_research_source_policies SET lifecycle_state = 'blocked' WHERE source_policy_id = $1",
      [policyId]
    );
    try {
      assert.deepEqual(await resolve(), []);
    } finally {
      await pool.query(
        "UPDATE outdoor_research_source_policies SET lifecycle_state = 'active' WHERE source_policy_id = $1",
        [policyId]
      );
    }
  });

  it("keeps the candidate-radius GiST prefilter complete east-west", async () => {
    const region = REGIONS[0];
    const ids = seeded.get(region.operationalRegionId);
    const distances = [499.9, 500, 500.1];
    const inserted = [];
    for (const [index, distanceMeters] of distances.entries()) {
      const coordinate = await projectCoordinate(
        pool,
        region.anchor,
        distanceMeters,
        Math.PI / 2
      );
      inserted.push({
        entityId: await insertProjectedViewpoint({
          pool,
          sourceId,
          projectionRunId: ids.runId,
          operationalRegionId: region.operationalRegionId,
          osmId: region.osmBase + 120 + index,
          coordinate
        })
      });
    }
    const repository = new PostgresOutdoorResearchRepository({
      pool,
      runtimeSchema: schemaName,
      statementTimeoutMs: 2_000
    });
    const rows = await repository.withConsistentSnapshot({}, async (session) => {
      const capabilities = await session.resolveCapabilities(
        binding(region),
        region.anchor,
        NOW
      );
      return session.discoverHighlights({
        projectionRunId: capabilities.snapshot.projectionRunId,
        operationalRegionId: region.operationalRegionId,
        anchor: region.anchor,
        entityCategories: ["viewpoint"],
        predicates: ["entity_category", "viewpoint_presence"],
        searchRadiusMeters: 500,
        limit: 12
      });
    });
    const returnedIds = new Set(rows.map((row) => row.entity_id));
    assert.equal(returnedIds.has(inserted[0].entityId), true);
    assert.equal(returnedIds.has(inserted[1].entityId), true);
    assert.equal(returnedIds.has(inserted[2].entityId), false);
  });

  it("cannot qualify a highlight through an overlapping but different region", async () => {
    const sourceRegion = REGIONS[0];
    const ids = seeded.get(sourceRegion.operationalRegionId);
    const overlappingRegionId = "overlap-test-v1";
    await pool.query(
      `INSERT INTO outdoor_evidence_regions
         (region_id, name, definition_version, boundary_kind,
          coordinate_reference_system, metric_srid, boundary,
          boundary_metric, supported_feature_classes,
          freshness_threshold_days, path_match_tolerance_meters,
          active_import_id, enabled)
       VALUES (
         $1, 'Overlapping test region', 1, 'trailmind-operational-polygon',
         'EPSG:4326', 25832,
         ST_Multi(ST_MakeEnvelope($2, $3, $4, $5, 4326)),
         ST_Transform(
           ST_Multi(ST_MakeEnvelope($2, $3, $4, $5, 4326)),
           25832
         ),
         ARRAY['viewpoint'], 14, 75, NULL, true
       )`,
      [overlappingRegionId, ...sourceRegion.envelope]
    );
    try {
      const repository = new PostgresOutdoorResearchRepository({
        pool,
        runtimeSchema: schemaName
      });
      const rows = await repository.withConsistentSnapshot({}, (session) =>
        session.discoverHighlights({
          projectionRunId: ids.runId,
          operationalRegionId: overlappingRegionId,
          anchor: sourceRegion.anchor,
          entityCategories: ["viewpoint"],
          predicates: ["entity_category", "viewpoint_presence"],
          searchRadiusMeters: 500,
          limit: 12
        })
      );
      assert.deepEqual(rows, []);
    } finally {
      await pool.query(
        "DELETE FROM outdoor_evidence_regions WHERE region_id = $1",
        [overlappingRegionId]
      );
    }
  });

  it("keeps official/current operations as gaps and mapped access unresolved", async () => {
    const result = await execute(REGIONS[0], {
      dateOrSeason: { kind: "date", date: "2026-07-25" },
      overnightRequirements: {
        required: true,
        nights: 1,
        allowedAccommodationTypes: ["alpine_hut"]
      }
    });
    assert.equal(result.state, "ready");
    const gapCodes = new Set(result.dossier.evidenceGaps.map((gap) => gap.code));
    for (const code of [
      "missing_access_evidence",
      "missing_current_conditions",
      "missing_opening_evidence",
      "missing_overnight_evidence",
      "missing_seasonal_evidence",
      "missing_water_evidence"
    ]) assert(gapCodes.has(code), code);
    const access = result.dossier.evidenceClaims.find((claim) =>
      claim.predicate === "access_restriction"
    );
    assert.equal(access.resolutionState, "unavailable");
    assert.equal(result.dossier.evidenceClaims.some((claim) =>
      ["public_access", "current_opening", "overnight_permission",
        "drinking_water_availability", "closure_status"].includes(claim.predicate)
    ), false);
  });

  it("is deterministic across repeated executions of one consistent snapshot", async () => {
    const first = await execute(REGIONS[1]);
    const second = await execute(REGIONS[1]);
    assert.equal(JSON.stringify(first), JSON.stringify(second));
  });

  it("removes capabilities when an exact authority scope is inactive", async () => {
    await pool.query(
      `UPDATE outdoor_research_source_authority_scopes
          SET lifecycle_state = 'retired'
        WHERE source_id = $1
          AND predicate = 'viewpoint_presence'
          AND entity_category = 'viewpoint'`,
      [sourceId]
    );
    try {
      const result = await execute(REGIONS[0]);
      assert.equal(result.state, "unsupported");
      assert.equal(result.availabilityState, "source_unavailable");
    } finally {
      await pool.query(
        `UPDATE outdoor_research_source_authority_scopes
            SET lifecycle_state = 'active'
          WHERE source_id = $1
            AND predicate = 'viewpoint_presence'
            AND entity_category = 'viewpoint'`,
        [sourceId]
      );
    }
  });

  it("does not present a stale import as current", async () => {
    const ids = seeded.get("harz-v1");
    await pool.query(
      `UPDATE outdoor_evidence_imports
          SET source_data_at = '2026-07-01T08:00:00Z'
        WHERE import_id = $1`,
      [ids.importId]
    );
    try {
      const result = await execute(REGIONS[0]);
      assert.equal(result.state, "unsupported");
      assert.equal(result.availabilityState, "source_stale");
      assert.equal(Object.hasOwn(result, "dossier"), false);
    } finally {
      await pool.query(
        `UPDATE outdoor_evidence_imports
            SET source_data_at = '2026-07-24T08:00:00Z'
          WHERE import_id = $1`,
        [ids.importId]
      );
    }
  });

  it("enforces real statement timeout and cancellation on a blocked query", async () => {
    const lockClient = await pool.connect();
    const repository = new PostgresOutdoorResearchRepository({
      pool,
      runtimeSchema: schemaName,
      statementTimeoutMs: 100
    });
    try {
      await lockClient.query("BEGIN");
      await lockClient.query(
        "LOCK TABLE outdoor_evidence_regions IN ACCESS EXCLUSIVE MODE"
      );
      await assert.rejects(
        () => repository.withConsistentSnapshot({}, (session) =>
          session.resolveCapabilities(
            binding(REGIONS[0]),
            REGIONS[0].anchor,
            NOW
          )
        ),
        hasCode("repository_timed_out")
      );

      const controller = new AbortController();
      const pending = repository.withConsistentSnapshot(
        { signal: controller.signal },
        (session) => session.resolveCapabilities(
          binding(REGIONS[0]),
          REGIONS[0].anchor,
          NOW
        )
      );
      setTimeout(() => controller.abort(), 25);
      await assert.rejects(pending, hasCode("request_cancelled"));
    } finally {
      await lockClient.query("ROLLBACK");
      lockClient.release();
    }
  });

  it("cancels repeatedly through a distinct pool and rolls every transaction back", async () => {
    const lockClient = await pool.connect();
    const cancellationPool = new Pool({
      connectionString,
      options: `-c search_path=${schemaName},public`,
      max: 2,
      allowExitOnIdle: true
    });
    const events = [];
    const repository = new PostgresOutdoorResearchRepository({
      pool,
      cancellationPool,
      runtimeSchema: schemaName,
      statementTimeoutMs: 2_500,
      transactionLifecycleObserver(event) {
        events.push(event);
      }
    });
    try {
      await lockClient.query("BEGIN");
      await lockClient.query(
        "LOCK TABLE outdoor_evidence_regions IN ACCESS EXCLUSIVE MODE"
      );
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const controller = new AbortController();
        const pending = repository.withConsistentSnapshot(
          { signal: controller.signal },
          (session) => session.resolveCapabilities(
            binding(REGIONS[0]),
            REGIONS[0].anchor,
            NOW
          )
        );
        setTimeout(() => controller.abort(), 25);
        await assert.rejects(pending, hasCode("request_cancelled"));
        assert.deepEqual(events.splice(0), [
          "began",
          "query_cancelled_after_abort",
          "rollback_completed_after_cancel"
        ]);
        assert.equal(pool.waitingCount, 0);
        assert.equal(cancellationPool.waitingCount, 0);
        assert.deepEqual((await pool.query("SELECT 1 AS available")).rows, [
          { available: 1 }
        ]);
      }
      assert(cancellationPool.totalCount <= 2);
      assert.equal(cancellationPool.idleCount, cancellationPool.totalCount);
    } finally {
      await lockClient.query("ROLLBACK");
      lockClient.release();
      await cancellationPool.end();
    }
  });

  it("uses the projection geometry GiST index for bounded spatial access", async () => {
    const ids = seeded.get("harz-v1");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL enable_seqscan = off");
      const plan = await client.query(
        `EXPLAIN (FORMAT JSON)
         ${outdoorResearchRepositoryQueriesForTesting.highlights}`,
        [
          ids.runId,
          REGIONS[0].operationalRegionId,
          REGIONS[0].anchor.longitude,
          REGIONS[0].anchor.latitude,
          ["viewpoint"],
          10_000,
          ["entity_category", "viewpoint_presence"],
          12,
          75
        ]
      );
      const text = JSON.stringify(plan.rows[0]["QUERY PLAN"]);
      assert.match(
        text,
        /outdoor_research_projection_entities_geometry_gist_idx/
      );
      assert.doesNotMatch(
        outdoorResearchRepositoryQueriesForTesting.highlights,
        /ST_AsGeoJSON|ST_AsText/
      );
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  });

  it("uses the representative-point GiST index for mapped route membership", async () => {
    const region = REGIONS[0];
    const ids = seeded.get(region.operationalRegionId);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL enable_seqscan = off");
      const plan = await client.query(
        `EXPLAIN (FORMAT JSON)
         ${outdoorResearchRepositoryQueriesForTesting.routeMemberships}`,
        [
          ids.runId,
          region.operationalRegionId,
          region.anchor.longitude,
          region.anchor.latitude,
          10_000,
          24,
          1
        ]
      );
      const text = JSON.stringify(plan.rows[0]["QUERY PLAN"]);
      assert.match(
        text,
        /outdoor_research_projection_entities_trail_point_gist_idx/
      );
      assert.doesNotMatch(
        text,
        /"Node Type":"Seq Scan","Parallel Aware":false,"Async Capable":false,"Relation Name":"outdoor_research_projection_entities"/
      );
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  });

  it("uses the trail geography GiST index for bounded access projection", async (context) => {
    const region = REGIONS[0];
    const ids = seeded.get(region.operationalRegionId);
    await seedRepresentativeTrailVolume({
      pool,
      sourceId,
      projectionRunId: ids.runId,
      importId: ids.importId,
      operationalRegionId: region.operationalRegionId,
      osmBase: region.osmBase + 10_000,
      count: 1_000
    });
    await pool.query("ANALYZE outdoor_research_projection_entities");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL enable_seqscan = off");
      const plan = await client.query(
        `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
         ${outdoorResearchRepositoryQueriesForTesting.trailAccessCandidates}`,
        [
          ids.runId,
          region.operationalRegionId,
          [ids.viewpointId],
          75,
          3,
          RESEARCH_TRAIL_ACCESS_CANDIDATE_POLICY_V1.eligibleHighwayClasses,
          RESEARCH_TRAIL_ACCESS_CANDIDATE_POLICY_V1.highlightCategories,
          64
        ]
      );
      const planRoot = plan.rows[0]["QUERY PLAN"][0];
      const indexNames = collectPlanValues(planRoot, "Index Name");
      assert(
        indexNames.includes(
          "outdoor_research_projection_entities_trail_geography_gist_idx"
        ),
        `expected trail geography GiST index; observed ${
          [...new Set(indexNames)].sort().join(", ")
        }`
      );
      assert(
        planRoot["Execution Time"] < 2_000,
        `bounded access query exceeded 2 s: ${
          planRoot["Execution Time"]
        } ms`
      );
      context.diagnostic(
        `access resolver execution ${planRoot["Execution Time"]} ms ` +
        "at 1,000 synthetic current trail rows"
      );
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  });

  it("removes both regions after reviewed policy revocation", async () => {
    await configureOsmProjectionPolicy({
      pool,
      mode: "revoke",
      policyVersion: OSM_PROJECTION_POLICY_VERSION,
      operatorConfirmation: OSM_POLICY_REVOCATION_CONFIRMATION,
      reviewReference: "tests/outdoor-research-executor-v1/revocation",
      reviewedAt: "2026-07-24T10:00:00.000Z",
      now: () => NOW
    });
    for (const region of REGIONS) {
      const result = await execute(region);
      assert.equal(result.state, "unsupported");
      assert.equal(result.availabilityState, "source_unavailable");
    }
    const activeRuns = await pool.query(
      "SELECT count(*)::integer AS count FROM outdoor_research_active_projection_runs"
    );
    assert.equal(activeRuns.rows[0].count, 0);
  });

  async function execute(region, overrides = {}) {
    const repository = new PostgresOutdoorResearchRepository({
      pool,
      runtimeSchema: schemaName,
      statementTimeoutMs: 2_000
    });
    return researchOutdoorAdventureV1(intent(region, overrides), {
      repository,
      clock: () => NOW,
      totalTimeoutMs: 5_000
    });
  }
});

async function seedRegion(pool, region, sourceId, policyId) {
  const ids = {
    importId: randomUUID(),
    runId: randomUUID(),
    viewpointId: randomUUID(),
    hutId: randomUUID(),
    routeId: randomUUID(),
    segmentId: randomUUID()
  };
  const [west, south, east, north] = region.envelope;
  await pool.query("BEGIN");
  try {
    await pool.query(
      `INSERT INTO outdoor_evidence_regions
         (region_id, name, definition_version, boundary_kind,
          coordinate_reference_system, metric_srid, boundary, boundary_metric,
          supported_feature_classes, freshness_threshold_days,
          path_match_tolerance_meters, enabled)
       VALUES (
         $1, $2, 1, 'trailmind-operational-polygon',
         'EPSG:4326', 25832,
         ST_Multi(ST_MakeEnvelope($3, $4, $5, $6, 4326)),
         ST_Transform(
           ST_Multi(ST_MakeEnvelope($3, $4, $5, $6, 4326)),
           25832
         ),
         ARRAY['viewpoint','alpineHut','hikingRoute','trailSegment'],
         14, 20, true
       )`,
      [
        region.operationalRegionId,
        region.operationalRegionId,
        west,
        south,
        east,
        north
      ]
    );
    await pool.query(
      `INSERT INTO outdoor_evidence_imports
         (import_id, region_id, source_dataset_name, source_identifier,
          source_data_at, retrieved_at, imported_at, tool_version,
          import_schema_version, status, aggregate_counts,
          acquisition_channel, input_file_sha256)
       VALUES (
         $1, $2, 'synthetic executor fixture', $3,
         '2026-07-24T08:00:00Z', '2026-07-24T08:30:00Z',
         '2026-07-24T09:00:00Z', 'executor-test-v1',
         1, 'active', '{}'::jsonb, 'operator_supplied_local', $4
       )`,
      [
        ids.importId,
        region.operationalRegionId,
        `synthetic:${region.operationalRegionId}`,
        region.hashCharacter.repeat(64)
      ]
    );
    await pool.query(
      `UPDATE outdoor_evidence_regions
          SET active_import_id = $2
        WHERE region_id = $1`,
      [region.operationalRegionId, ids.importId]
    );
    await pool.query(
      `INSERT INTO outdoor_research_projection_runs
         (projection_run_id, projection_key, source_id, source_policy_id,
          source_policy_version, adapter_schema_version, region_id,
          input_import_id, input_source_dataset_name, input_source_identifier,
          input_source_data_at, input_retrieved_at, input_imported_at,
          input_acquisition_channel, input_file_sha256, operator_invoked,
          started_at, completed_at, duration_milliseconds, status,
          aggregate_counts)
       VALUES (
         $1, $2, $3, $4, $5, 'osm-evidence-graph-v1', $6,
         $7, 'synthetic executor fixture', $8,
         '2026-07-24T08:00:00Z', '2026-07-24T08:30:00Z',
         '2026-07-24T09:00:00Z', 'operator_supplied_local', $9, true,
         '2026-07-24T09:30:00Z', '2026-07-24T09:31:00Z',
         60000, 'active', '{}'::jsonb
       )`,
      [
        ids.runId,
        `${region.hashCharacter.repeat(63)}1`,
        sourceId,
        policyId,
        OSM_PROJECTION_POLICY_VERSION,
        region.operationalRegionId,
        ids.importId,
        `synthetic:${region.operationalRegionId}`,
        region.hashCharacter.repeat(64)
      ]
    );
    const entities = [
      {
        key: "viewpoint",
        id: ids.viewpointId,
        category: "viewpoint",
        osmType: "node",
        osmId: region.osmBase + 1,
        geometry: `POINT(${region.anchor.longitude + 0.01} ${region.anchor.latitude})`
      },
      {
        key: "hut",
        id: ids.hutId,
        category: "alpine_hut",
        osmType: "node",
        osmId: region.osmBase + 2,
        geometry: `POINT(${region.anchor.longitude + 0.02} ${region.anchor.latitude})`
      },
      {
        key: "route",
        id: ids.routeId,
        category: "hiking_route",
        osmType: "relation",
        osmId: region.osmBase + 3,
        geometry: null
      },
      {
        key: "segment",
        id: ids.segmentId,
        category: "trail_segment",
        osmType: "way",
        osmId: region.osmBase + 4,
        geometry:
          `LINESTRING(${region.anchor.longitude - 0.01} ${region.anchor.latitude},` +
          `${region.anchor.longitude + 0.02} ${region.anchor.latitude})`
      }
    ];
    for (const entity of entities) {
      entity.linkId = randomUUID();
      await pool.query(
        `INSERT INTO outdoor_research_entities
           (entity_id, entity_category, canonical_geometry, lifecycle_state)
         VALUES (
           $1, $2,
           CASE WHEN $3::text IS NULL THEN NULL
                ELSE ST_GeomFromText($3, 4326) END,
           'active'
         )`,
        [entity.id, entity.category, entity.geometry]
      );
      await pool.query(
        `INSERT INTO outdoor_research_source_entities
           (source_entity_link_id, entity_id, source_id, external_type,
            external_id, matching_status, matching_method, matched_at,
            review_status, reviewed_at)
         VALUES (
           $1, $2, $3, $4, $5, 'matched', 'exact_external_id',
           '2026-07-24T09:00:00Z', 'confirmed', '2026-07-24T09:00:00Z'
         )`,
        [
          entity.linkId,
          entity.id,
          sourceId,
          `osm:${entity.osmType}`,
          String(entity.osmId)
        ]
      );
      await pool.query(
        `INSERT INTO outdoor_research_osm_entity_identities
           (source_id, osm_type, osm_id, entity_id, deterministic_id_version)
         VALUES ($1, $2, $3, $4, 'trailmind-osm-identity-v1')`,
        [sourceId, entity.osmType, entity.osmId, entity.id]
      );
      await pool.query(
        `INSERT INTO outdoor_research_projection_entities
           (projection_run_id, source_id, entity_id, source_entity_link_id,
            osm_type, osm_id, entity_category, projected_geometry,
            source_version, source_timestamp, record_provenance)
         VALUES (
           $1, $2, $3, $4, $5, $6, $7,
           CASE WHEN $8::text IS NULL THEN NULL
                ELSE ST_GeomFromText($8, 4326) END,
           7, '2026-07-24T08:00:00Z',
           jsonb_build_object(
             'osm_version', 7,
             'adapter_version', 'osm-evidence-graph-v1',
             'region_id', $9::text
           )
         )`,
        [
          ids.runId,
          sourceId,
          entity.id,
          entity.linkId,
          entity.osmType,
          entity.osmId,
          entity.category,
          entity.geometry,
          region.operationalRegionId
        ]
      );
    }
    await pool.query(
      `INSERT INTO outdoor_evidence_trail_segments
         (import_id, region_id, osm_type, osm_id, highway_class,
          trail_visibility, sac_scale, geom, geom_metric,
          source_version, source_timestamp)
       VALUES (
         $1, $2, 'way', $3, 'path', 'good', 'mountain_hiking',
         ST_Multi(ST_GeomFromText($4, 4326)),
         ST_Transform(ST_Multi(ST_GeomFromText($4, 4326)), 25832),
         7, '2026-07-24T08:00:00Z'
       )`,
      [
        ids.importId,
        region.operationalRegionId,
        region.osmBase + 4,
        entities[3].geometry
      ]
    );

    const assertions = [
      [entities[0], "entity_category", "text", "viewpoint"],
      [entities[0], "viewpoint_presence", "boolean", true],
      [entities[1], "entity_category", "text", "alpine_hut"],
      [entities[1], "name", "text", `${region.operationalRegionId} mapped hut`],
      [entities[2], "entity_category", "text", "hiking_route"],
      [entities[2], "name", "text", `${region.operationalRegionId} mapped relation`],
      [entities[3], "entity_category", "text", "trail_segment"],
      [entities[3], "trail_difficulty", "text", "mountain_hiking"],
      [entities[3], "trail_visibility", "text", "good"],
      [entities[3], "access_restriction", "text", "conditional"]
    ];
    for (const [entity, predicate, valueType, value] of assertions) {
      const assertionId = randomUUID();
      await pool.query(
        `INSERT INTO outdoor_research_assertions
           (assertion_id, entity_id, source_id, predicate, value_type,
            value_text, value_boolean, evidence_class, observed_at,
            retrieved_at, freshness_state, provenance_identifier,
            assertion_state, resolution_group_key)
         VALUES (
           $1, $2, $3, $4, $5,
           CASE WHEN $5 = 'text' THEN $6::text ELSE NULL END,
           CASE WHEN $5 = 'boolean' THEN $7::boolean ELSE NULL END,
           'mapped', '2026-07-24T08:00:00Z', '2026-07-24T08:30:00Z',
           'current', $8, 'asserted', $9
         )`,
        [
          assertionId,
          entity.id,
          sourceId,
          predicate,
          valueType,
          valueType === "text" ? value : null,
          valueType === "boolean" ? value : null,
          `osm:${entity.osmType}/${entity.osmId}@7#${predicate}`,
          `osm:${entity.osmType}:${entity.osmId}:${predicate}`
        ]
      );
      await pool.query(
        `INSERT INTO outdoor_research_projection_assertions
           (projection_run_id, assertion_id, entity_id, predicate,
            record_provenance)
         VALUES (
           $1, $2, $3, $4,
           jsonb_build_object('osm_version', 7, 'region_id', $5::text)
         )`,
        [
          ids.runId,
          assertionId,
          entity.id,
          predicate,
          region.operationalRegionId
        ]
      );
    }
    const relationshipId = randomUUID();
    await pool.query(
      `INSERT INTO outdoor_research_relationships
         (relationship_id, relationship_type, subject_entity_id,
          object_entity_id, source_id, evidence_class,
          provenance_identifier, observed_at, retrieved_at, freshness_state)
       VALUES (
         $1, 'trail_segment_member_of_route', $2, $3, $4, 'mapped',
         $5, '2026-07-24T08:00:00Z', '2026-07-24T08:30:00Z', 'current'
       )`,
      [
        relationshipId,
        ids.segmentId,
        ids.routeId,
        sourceId,
        `osm:relation/${region.osmBase + 3}@7/member/way/${region.osmBase + 4}`
      ]
    );
    await pool.query(
      `INSERT INTO outdoor_research_projection_relationships
         (projection_run_id, relationship_id, subject_entity_id,
          object_entity_id, relationship_type, record_provenance)
       VALUES (
         $1, $2, $3, $4, 'trail_segment_member_of_route',
         jsonb_build_object(
           'relation_osm_version', 7,
           'segment_osm_version', 7,
           'region_id', $5::text
         )
       )`,
      [
        ids.runId,
        relationshipId,
        ids.segmentId,
        ids.routeId,
        region.operationalRegionId
      ]
    );
    await pool.query("COMMIT");
    return ids;
  } catch (error) {
    await pool.query("ROLLBACK");
    throw error;
  }
}

async function insertProjectedViewpoint({
  pool,
  sourceId,
  projectionRunId,
  operationalRegionId,
  osmId,
  coordinate
}) {
  const client = await pool.connect();
  const entityId = randomUUID();
  const sourceEntityLinkId = randomUUID();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO outdoor_research_entities
         (entity_id, entity_category, canonical_geometry, lifecycle_state)
       VALUES (
         $1, 'viewpoint', ST_SetSRID(ST_MakePoint($2, $3), 4326), 'active'
       )`,
      [entityId, coordinate.longitude, coordinate.latitude]
    );
    await client.query(
      `INSERT INTO outdoor_research_source_entities
         (source_entity_link_id, entity_id, source_id, external_type,
          external_id, matching_status, matching_method, matched_at,
          review_status, reviewed_at)
       VALUES (
         $1, $2, $3, 'osm:node', $4, 'matched', 'exact_external_id',
         '2026-07-24T09:00:00Z', 'confirmed', '2026-07-24T09:00:00Z'
       )`,
      [sourceEntityLinkId, entityId, sourceId, String(osmId)]
    );
    await client.query(
      `INSERT INTO outdoor_research_osm_entity_identities
         (source_id, osm_type, osm_id, entity_id, deterministic_id_version)
       VALUES ($1, 'node', $2, $3, 'trailmind-osm-identity-v1')`,
      [sourceId, osmId, entityId]
    );
    await client.query(
      `INSERT INTO outdoor_research_projection_entities
         (projection_run_id, source_id, entity_id, source_entity_link_id,
          osm_type, osm_id, entity_category, projected_geometry,
          source_version, source_timestamp, record_provenance)
       VALUES (
         $1, $2, $3, $4, 'node', $5, 'viewpoint',
         ST_SetSRID(ST_MakePoint($6, $7), 4326),
         7, '2026-07-24T08:00:00Z',
         jsonb_build_object(
           'osm_version', 7,
           'adapter_version', 'osm-evidence-graph-v1',
           'region_id', $8::text
         )
       )`,
      [
        projectionRunId,
        sourceId,
        entityId,
        sourceEntityLinkId,
        osmId,
        coordinate.longitude,
        coordinate.latitude,
        operationalRegionId
      ]
    );
    for (const [predicate, valueType, value] of [
      ["entity_category", "text", "viewpoint"],
      ["viewpoint_presence", "boolean", true]
    ]) {
      const assertionId = randomUUID();
      await client.query(
        `INSERT INTO outdoor_research_assertions
           (assertion_id, entity_id, source_id, predicate, value_type,
            value_text, value_boolean, evidence_class, observed_at,
            retrieved_at, freshness_state, provenance_identifier,
            assertion_state, resolution_group_key)
         VALUES (
           $1, $2, $3, $4, $5,
           CASE WHEN $5 = 'text' THEN $6::text ELSE NULL END,
           CASE WHEN $5 = 'boolean' THEN $7::boolean ELSE NULL END,
           'mapped', '2026-07-24T08:00:00Z', '2026-07-24T08:30:00Z',
           'current', $8, 'asserted', $9
         )`,
        [
          assertionId,
          entityId,
          sourceId,
          predicate,
          valueType,
          valueType === "text" ? value : null,
          valueType === "boolean" ? value : null,
          `osm:node/${osmId}@7#${predicate}`,
          `osm:node:${osmId}:${predicate}`
        ]
      );
      await client.query(
        `INSERT INTO outdoor_research_projection_assertions
           (projection_run_id, assertion_id, entity_id, predicate,
            record_provenance)
         VALUES (
           $1, $2, $3, $4,
           jsonb_build_object('osm_version', 7, 'region_id', $5::text)
         )`,
        [
          projectionRunId,
          assertionId,
          entityId,
          predicate,
          operationalRegionId
        ]
      );
    }
    await client.query("COMMIT");
    return entityId;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function insertProjectedTrailSegment({
  pool,
  sourceId,
  projectionRunId,
  importId,
  operationalRegionId,
  osmId,
  coordinates,
  lifecycleState = "active",
  projectedGeometryAvailable = true,
  highwayClass = "path",
  accessRestriction = null,
  quarantined = false
}) {
  const client = await pool.connect();
  const entityId = randomUUID();
  const sourceEntityLinkId = randomUUID();
  const assertionId = randomUUID();
  const [start, finish] = coordinates;
  const geometrySQL = `ST_MakeLine(
    ST_SetSRID(ST_MakePoint($6, $7), 4326),
    ST_SetSRID(ST_MakePoint($8, $9), 4326)
  )`;
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO outdoor_research_entities
         (entity_id, entity_category, canonical_geometry, lifecycle_state)
       VALUES (
         $1, 'trail_segment', ST_MakeLine(
           ST_SetSRID(ST_MakePoint($2, $3), 4326),
           ST_SetSRID(ST_MakePoint($4, $5), 4326)
         ), $6
       )`,
      [
        entityId,
        start.longitude,
        start.latitude,
        finish.longitude,
        finish.latitude,
        lifecycleState
      ]
    );
    await client.query(
      `INSERT INTO outdoor_research_source_entities
         (source_entity_link_id, entity_id, source_id, external_type,
          external_id, matching_status, matching_method, matched_at,
          review_status, reviewed_at)
       VALUES (
         $1, $2, $3, 'osm:way', $4, 'matched', 'exact_external_id',
         '2026-07-24T09:00:00Z', 'confirmed', '2026-07-24T09:00:00Z'
       )`,
      [sourceEntityLinkId, entityId, sourceId, String(osmId)]
    );
    await client.query(
      `INSERT INTO outdoor_research_osm_entity_identities
         (source_id, osm_type, osm_id, entity_id, deterministic_id_version)
       VALUES ($1, 'way', $2, $3, 'trailmind-osm-identity-v1')`,
      [sourceId, osmId, entityId]
    );
    await client.query(
      `INSERT INTO outdoor_research_projection_entities
         (projection_run_id, source_id, entity_id, source_entity_link_id,
          osm_type, osm_id, entity_category, projected_geometry,
          source_version, source_timestamp, record_provenance)
       VALUES (
         $1, $2, $3, $4, 'way', $5, 'trail_segment',
         CASE WHEN $11::boolean THEN ${geometrySQL} ELSE NULL END,
         7, '2026-07-24T08:00:00Z',
         jsonb_build_object(
           'osm_version', 7,
           'adapter_version', 'osm-evidence-graph-v1',
           'region_id', $10::text
         )
       )`,
      [
        projectionRunId,
        sourceId,
        entityId,
        sourceEntityLinkId,
        osmId,
        start.longitude,
        start.latitude,
        finish.longitude,
        finish.latitude,
        operationalRegionId,
        projectedGeometryAvailable
      ]
    );
    await client.query(
      `INSERT INTO outdoor_evidence_trail_segments
         (import_id, region_id, osm_type, osm_id, highway_class,
          trail_visibility, sac_scale, geom, geom_metric,
          source_version, source_timestamp)
       VALUES (
         $1, $2, 'way', $3, $8, 'good', 'mountain_hiking',
         ST_Multi(ST_MakeLine(
           ST_SetSRID(ST_MakePoint($4, $5), 4326),
           ST_SetSRID(ST_MakePoint($6, $7), 4326)
         )),
         ST_Transform(ST_Multi(ST_MakeLine(
           ST_SetSRID(ST_MakePoint($4, $5), 4326),
           ST_SetSRID(ST_MakePoint($6, $7), 4326)
         )), 25832),
         7, '2026-07-24T08:00:00Z'
       )`,
      [
        importId,
        operationalRegionId,
        osmId,
        start.longitude,
        start.latitude,
        finish.longitude,
        finish.latitude,
        highwayClass
      ]
    );
    await client.query(
      `INSERT INTO outdoor_research_assertions
         (assertion_id, entity_id, source_id, predicate, value_type,
          value_text, evidence_class, observed_at, retrieved_at,
          freshness_state, provenance_identifier, assertion_state,
          resolution_group_key)
       VALUES (
         $1, $2, $3, 'entity_category', 'text', 'trail_segment',
         'mapped', '2026-07-24T08:00:00Z', '2026-07-24T08:30:00Z',
         'current', $4, 'asserted', $5
       )`,
      [
        assertionId,
        entityId,
        sourceId,
        `osm:way/${osmId}@7#entity_category`,
        `osm:way:${osmId}:entity_category`
      ]
    );
    await client.query(
      `INSERT INTO outdoor_research_projection_assertions
         (projection_run_id, assertion_id, entity_id, predicate,
          record_provenance)
       VALUES (
         $1, $2, $3, 'entity_category',
         jsonb_build_object('osm_version', 7, 'region_id', $4::text)
       )`,
      [projectionRunId, assertionId, entityId, operationalRegionId]
    );
    if (accessRestriction !== null) {
      const restrictionAssertionId = randomUUID();
      await client.query(
        `INSERT INTO outdoor_research_assertions
           (assertion_id, entity_id, source_id, predicate, value_type,
            value_text, evidence_class, observed_at, retrieved_at,
            freshness_state, provenance_identifier, assertion_state,
            resolution_group_key)
         VALUES (
           $1, $2, $3, 'access_restriction', 'text', $4,
           'mapped', '2026-07-24T08:00:00Z', '2026-07-24T08:30:00Z',
           'current', $5, 'asserted', $6
         )`,
        [
          restrictionAssertionId,
          entityId,
          sourceId,
          accessRestriction,
          `osm:way/${osmId}@7#access_restriction`,
          `osm:way:${osmId}:access_restriction`
        ]
      );
      await client.query(
        `INSERT INTO outdoor_research_projection_assertions
           (projection_run_id, assertion_id, entity_id, predicate,
            record_provenance)
         VALUES (
           $1, $2, $3, 'access_restriction',
           jsonb_build_object('osm_version', 7, 'region_id', $4::text)
         )`,
        [
          projectionRunId,
          restrictionAssertionId,
          entityId,
          operationalRegionId
        ]
      );
    }
    if (quarantined) {
      await client.query(
        `INSERT INTO outdoor_research_projection_quarantines
           (quarantine_id, projection_run_id, reason_code, record_kind,
            osm_type, osm_id)
         VALUES ($1, $2, 'invalid_value', 'trail_segment', 'way', $3)`,
        [randomUUID(), projectionRunId, osmId]
      );
    }
    await client.query("COMMIT");
    return { entityId, osmId };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function seedRepresentativeTrailVolume({
  pool,
  sourceId,
  projectionRunId,
  importId,
  operationalRegionId,
  osmBase,
  count
}) {
  const parameters = [projectionRunId, sourceId, operationalRegionId, osmBase, count];
  const volume = `SELECT series AS ordinal,
         $2::uuid AS source_id,
         $3::text AS operational_region_id,
         md5($1::text || ':' || $4::text || ':volume-entity:' || series)::uuid AS entity_id,
         md5($1::text || ':' || $4::text || ':volume-link:' || series)::uuid AS link_id,
         md5($1::text || ':' || $4::text || ':volume-claim:' || series)::uuid AS assertion_id,
         ($4::bigint + series)::bigint AS osm_id,
         10.41 + ((series - 1) % 50) * 0.0025 AS longitude,
         51.66 + (((series - 1) / 50) % 20) * 0.005 AS latitude
    FROM generate_series(1, $5::integer) series`;
  await pool.query(
    `WITH volume AS (${volume})
     INSERT INTO outdoor_research_entities
       (entity_id, entity_category, canonical_geometry, lifecycle_state)
     SELECT entity_id, 'trail_segment',
            ST_MakeLine(
              ST_SetSRID(ST_MakePoint(longitude, latitude), 4326),
              ST_SetSRID(ST_MakePoint(longitude + 0.0001, latitude), 4326)
            ),
            'active'
       FROM volume`,
    parameters
  );
  await pool.query(
    `WITH volume AS (${volume})
     INSERT INTO outdoor_research_source_entities
       (source_entity_link_id, entity_id, source_id, external_type,
        external_id, matching_status, matching_method, matched_at,
        review_status, reviewed_at)
     SELECT link_id, entity_id, $2::uuid, 'osm:way', osm_id::text,
            'matched', 'exact_external_id', '2026-07-24T09:00:00Z',
            'confirmed', '2026-07-24T09:00:00Z'
       FROM volume`,
    parameters
  );
  await pool.query(
    `WITH volume AS (${volume})
     INSERT INTO outdoor_research_osm_entity_identities
       (source_id, osm_type, osm_id, entity_id, deterministic_id_version)
     SELECT $2::uuid, 'way', osm_id, entity_id, 'trailmind-osm-identity-v1'
       FROM volume`,
    parameters
  );
  await pool.query(
    `WITH volume AS (${volume})
     INSERT INTO outdoor_research_projection_entities
       (projection_run_id, source_id, entity_id, source_entity_link_id,
        osm_type, osm_id, entity_category, projected_geometry,
        source_version, source_timestamp, record_provenance)
     SELECT $1::uuid, $2::uuid, entity_id, link_id, 'way', osm_id, 'trail_segment',
            ST_MakeLine(
              ST_SetSRID(ST_MakePoint(longitude, latitude), 4326),
              ST_SetSRID(ST_MakePoint(longitude + 0.0001, latitude), 4326)
            ),
            7, '2026-07-24T08:00:00Z',
            jsonb_build_object(
              'osm_version', 7,
              'adapter_version', 'osm-evidence-graph-v1',
              'region_id', $3::text
            )
       FROM volume`,
    parameters
  );
  await pool.query(
    `WITH volume AS (${volume}), prepared AS (
       SELECT *, ST_Multi(ST_MakeLine(
         ST_SetSRID(ST_MakePoint(longitude, latitude), 4326),
         ST_SetSRID(ST_MakePoint(longitude + 0.0001, latitude), 4326)
       )) AS geometry
         FROM volume
     )
     INSERT INTO outdoor_evidence_trail_segments
       (import_id, region_id, osm_type, osm_id, highway_class,
        trail_visibility, sac_scale, geom, geom_metric,
        source_version, source_timestamp)
     SELECT $1::uuid, $3, 'way', osm_id, 'path', 'good',
            'mountain_hiking', geometry, ST_Transform(geometry, 25832),
            7, '2026-07-24T08:00:00Z'
       FROM prepared`,
    [importId, sourceId, operationalRegionId, osmBase, count]
  );
  await pool.query(
    `WITH volume AS (${volume})
     INSERT INTO outdoor_research_assertions
       (assertion_id, entity_id, source_id, predicate, value_type,
        value_text, evidence_class, observed_at, retrieved_at,
        freshness_state, provenance_identifier, assertion_state,
        resolution_group_key)
     SELECT assertion_id, entity_id, $2::uuid, 'entity_category', 'text',
            'trail_segment', 'mapped', '2026-07-24T08:00:00Z',
            '2026-07-24T08:30:00Z', 'current',
            'osm:way/' || osm_id || '@7#entity_category', 'asserted',
            'osm:way:' || osm_id || ':entity_category'
       FROM volume`,
    parameters
  );
  await pool.query(
    `WITH volume AS (${volume})
     INSERT INTO outdoor_research_projection_assertions
       (projection_run_id, assertion_id, entity_id, predicate,
        record_provenance)
     SELECT $1::uuid, assertion_id, entity_id, 'entity_category',
            jsonb_build_object('osm_version', 7, 'region_id', $3::text)
       FROM volume`,
    parameters
  );
}

async function projectCoordinate(pool, origin, distanceMeters, bearingRadians) {
  const result = await pool.query(
    `SELECT ST_Y(projected::geometry)::double precision AS latitude,
            ST_X(projected::geometry)::double precision AS longitude
       FROM (
         SELECT ST_Project(
           ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
           $3::double precision,
           $4::double precision
         ) AS projected
       ) value`,
    [origin.longitude, origin.latitude, distanceMeters, bearingRadians]
  );
  return result.rows[0];
}

function collectPlanValues(value, key) {
  if (!value || typeof value !== "object") return [];
  const own = typeof value[key] === "string" ? [value[key]] : [];
  return [
    ...own,
    ...Object.values(value).flatMap((child) => collectPlanValues(child, key))
  ];
}

function runtimeFunctionSignatures(schemaName) {
  const schema = quoteIdentifier(schemaName);
  return [
    `${schema}.trailmind_runtime_outdoor_research_snapshot_context_v1(text, double precision, double precision)`,
    `${schema}.trailmind_runtime_outdoor_research_highlights_v1(uuid, text, double precision, double precision, text[], double precision, text[], integer, double precision)`,
    `${schema}.trailmind_runtime_outdoor_research_route_memberships_v1(uuid, text, double precision, double precision, double precision, integer, integer)`,
    `${schema}.trailmind_runtime_outdoor_research_route_assertions_v1(uuid, uuid[], text[], integer)`,
    `${schema}.trailmind_runtime_outdoor_research_trail_access_candidates_v1(uuid, text, uuid[], double precision, integer, text[], text[], integer)`
  ];
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function intent(region, overrides = {}) {
  return {
    schemaVersion: 1,
    activity: "hiking",
    geographicAnchor: {
      state: "resolved",
      name: binding(region).displayName,
      coordinate: region.anchor,
      regionEntityId: binding(region).regionEntityId
    },
    routeType: "loop",
    distanceRangeKm: { min: 10, max: 14 },
    durationRangeMinutes: null,
    maximumElevationGainMeters: null,
    maximumTechnicalDifficulty: null,
    mustHaveExperiences: [{ experience: "viewpoint", minimumCount: 1 }],
    preferredExperiences: ["alpine_hut"],
    avoidedExperiences: [],
    requiredFacilities: ["lunch_hut"],
    groupContext: {
      partySize: 2,
      includesChildren: false,
      youngestAge: null,
      mobility: "standard",
      experienceLevel: "intermediate"
    },
    dateOrSeason: null,
    overnightRequirements: {
      required: false,
      nights: 0,
      allowedAccommodationTypes: []
    },
    transportRequirements: {
      arrivalMode: "walking",
      returnToStart: true,
      publicTransportRequired: false
    },
    unresolvedClarificationQuestions: [],
    ...overrides
  };
}

function binding(region) {
  return OUTDOOR_RESEARCH_REGION_BINDINGS_V1.find((item) =>
    item.operationalRegionId === region.operationalRegionId
  );
}

function hasCode(code) {
  return (error) => {
    assert.equal(error.code, code);
    assert.equal(error.message.length < 120, true);
    return true;
  };
}

function deterministicProviderResponse(request) {
  const coordinates = request.points.map((point, index) => [
    point.longitude,
    point.latitude,
    500 + index * 10
  ]);
  const finalIndex = coordinates.length - 1;
  return {
    provider: "graphhopper",
    paths: [{
      distance: 12_000,
      time: 10_800_000,
      ascend: 400,
      descend: 400,
      points: { type: "LineString", coordinates },
      instructions: [{
        text: "Continue",
        distance: 12_000,
        time: 10_800_000,
        interval: [0, finalIndex],
        sign: 0
      }],
      details: {
        surface: [[0, finalIndex, "ground"]],
        road_class: [[0, finalIndex, "path"]],
        hike_rating: [[0, finalIndex, "1"]]
      },
      snapped_waypoints: {
        type: "LineString",
        coordinates: request.points.map((point) => [
          point.longitude,
          point.latitude
        ])
      }
    }]
  };
}
