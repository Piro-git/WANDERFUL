import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { after, before, describe, it } from "node:test";
import pg from "pg";
import {
  outdoorEvidenceCorridorQueryForTesting
} from "../src/outdoorEvidence/postgresOutdoorEvidenceRepository.js";
import {
  researchOutdoorAdventureWithTrailAccessV1
} from "../src/outdoorResearch/outdoorResearchExecutor.js";
import {
  outdoorResearchRepositoryQueriesForTesting,
  outdoorResearchRuntimeQueriesForSchemaForTesting,
  PostgresOutdoorResearchRepository
} from "../src/outdoorResearch/postgresOutdoorResearchRepository.js";
import {
  OUTDOOR_RESEARCH_REGION_BINDINGS_V1
} from "../src/outdoorResearch/regionBindings.js";
import {
  RESEARCH_TRAIL_ACCESS_CANDIDATE_POLICY_V1
} from "../src/routeResearch/trailAccessCandidatePolicy.js";
import {
  buildResearchGuidedRouteCandidatePlanV2,
  validateResearchGuidedRouteCandidatePlanV2ForResearch
} from "../src/routeResearch/researchGuidedRouteCandidatePlannerV2.js";

const { Pool } = pg;
const runtimeConnectionString =
  process.env.TRAILMIND_CAPACITY_PROFILE_RUNTIME_DATABASE_URL;
const operatorConnectionString =
  process.env.TRAILMIND_CAPACITY_PROFILE_OPERATOR_DATABASE_URL;
const adminConnectionString =
  process.env.TRAILMIND_CAPACITY_PROFILE_ADMIN_DATABASE_URL;
const cancellationConnectionString =
  process.env.TRAILMIND_CAPACITY_PROFILE_CANCELLATION_DATABASE_URL;
const RUNTIME_SCHEMA = "trailmind_app";
const runtimeQueries = outdoorResearchRuntimeQueriesForSchemaForTesting(
  RUNTIME_SCHEMA
);
const EXPECTED_MIGRATIONS = Object.freeze([
  "001_app_attest.sql",
  "002_outdoor_evidence.sql",
  "003_outdoor_research_graph.sql",
  "004_osm_outdoor_research_projection.sql",
  "005_outdoor_research_projection_geometry.sql",
  "006_outdoor_route_membership_point_index.sql",
  "007_routable_highlight_access_geography_index.sql",
  "009_supabase_postgis_isolated_runtime_read_contract.sql",
  "010_bounded_outdoor_import_schema_provisioning.sql"
]);
const SAMPLES = Object.freeze([
  Object.freeze({
    name: "Brocken", regionId: "harz-v1", longitude: 10.6177,
    latitude: 51.7992, corridorEnd: [10.635, 51.79]
  }),
  Object.freeze({
    name: "Ilsenburg", regionId: "harz-v1", longitude: 10.6782,
    latitude: 51.8663, corridorEnd: [10.69, 51.85]
  }),
  Object.freeze({
    name: "Schierke", regionId: "harz-v1", longitude: 10.665,
    latitude: 51.765, corridorEnd: [10.65, 51.78]
  }),
  Object.freeze({
    name: "Innsbruck", regionId: "innsbruck-alps-v1", longitude: 11.4041,
    latitude: 47.2692, corridorEnd: [11.4, 47.29]
  }),
  Object.freeze({
    name: "Nordkette", regionId: "innsbruck-alps-v1", longitude: 11.384,
    latitude: 47.312, corridorEnd: [11.4, 47.32]
  })
]);

describe("Supabase Free bounded two-core current-volume PostGIS gates", {
  skip: !runtimeConnectionString || !operatorConnectionString ||
    !adminConnectionString || !cancellationConnectionString
}, () => {
  let runtimePool;
  let operatorPool;
  let adminPool;
  let cancellationPool;

  before(async () => {
    const urls = [
      runtimeConnectionString,
      operatorConnectionString,
      adminConnectionString,
      cancellationConnectionString
    ].map((value) => new URL(value));
    const expectedDatabase = urls[0].pathname;
    const expectedEndpoint = `${urls[0].hostname}:${urls[0].port}`;
    assert.match(expectedDatabase, /capacity|combined/i);
    assert(urls.every((url) =>
      new Set(["127.0.0.1", "localhost", "::1"]).has(url.hostname) &&
      url.pathname === expectedDatabase &&
      `${url.hostname}:${url.port}` === expectedEndpoint &&
      url.search === "" && url.hash === ""
    ), "capacity proof roles must use one loopback disposable database");
    assert.equal(new Set(urls.map((url) => url.username)).size, 4);

    runtimePool = pool(runtimeConnectionString, "capacity_runtime");
    operatorPool = pool(operatorConnectionString, "capacity_operator");
    adminPool = pool(adminConnectionString, "capacity_admin");
    cancellationPool = pool(
      cancellationConnectionString,
      "capacity_cancellation"
    );
  });

  after(async () => {
    await Promise.all([
      runtimePool?.end(), operatorPool?.end(), adminPool?.end(),
      cancellationPool?.end()
    ]);
  });

  it("has exact migrations, truthful partial boundaries, active lineage, and zero quarantines", async (context) => {
    const migrations = await adminPool.query(
      "SELECT version FROM trailmind_schema_migrations ORDER BY version"
    );
    assert.deepEqual(migrations.rows.map((row) => row.version),
      EXPECTED_MIGRATIONS);

    const regions = await adminPool.query(
      `SELECT region.region_id, region.name, ST_SRID(region.boundary) AS srid,
              region.metric_srid,
              ST_XMin(region.boundary) AS xmin,
              ST_YMin(region.boundary) AS ymin,
              ST_XMax(region.boundary) AS xmax,
              ST_YMax(region.boundary) AS ymax,
              import.status AS import_status,
              run.status AS projection_status,
              import.input_file_sha256,
              run.input_file_sha256 AS projected_input_file_sha256
         FROM outdoor_evidence_regions region
         JOIN outdoor_evidence_imports import
           ON import.import_id = region.active_import_id
         JOIN outdoor_research_active_projection_runs run
           ON run.region_id = region.region_id
          AND run.input_import_id = import.import_id
        ORDER BY region.region_id`
    );
    assert.equal(regions.rowCount, 2);
    assert(regions.rows.every((row) =>
      /partial|core/i.test(row.name) &&
      row.srid === 4326 && row.metric_srid === 25832 &&
      row.import_status === "active" && row.projection_status === "active" &&
      row.input_file_sha256 === row.projected_input_file_sha256
    ));
    const overlap = await adminPool.query(
      `SELECT ST_Intersects(harz.boundary, innsbruck.boundary) AS overlaps
         FROM outdoor_evidence_regions harz
         JOIN outdoor_evidence_regions innsbruck ON true
        WHERE harz.region_id = 'harz-v1'
          AND innsbruck.region_id = 'innsbruck-alps-v1'`
    );
    assert.equal(overlap.rows[0].overlaps, false);
    const quarantines = await adminPool.query(
      "SELECT count(*)::integer AS count FROM outdoor_research_projection_quarantines"
    );
    assert.equal(quarantines.rows[0].count, 0);
    context.diagnostic(JSON.stringify({ regions: regions.rows, overlap: false }));
  });

  it("keeps five membership samples deterministic and below the existing p95 gate", async (context) => {
    const records = [];
    for (const sample of SAMPLES) {
      const snapshot = await runtimePool.query(runtimeQueries.snapshotContext, [
        sample.regionId, sample.longitude, sample.latitude
      ]);
      assert.equal(snapshot.rowCount, 1, sample.name);
      const values = [
        snapshot.rows[0].runtime_row.projection_run_id,
        sample.regionId, sample.longitude, sample.latitude, 20_000, 24, 1
      ];
      const measured = await measureRuntimeQuery({
        pool: runtimePool,
        query: runtimeQueries.routeMemberships,
        values,
        minimumRows: 1
      });
      assert(measured.p95Ms < 1_500, sample.name);
      const plan = await explain(adminPool,
        outdoorResearchRepositoryQueriesForTesting.routeMemberships, values);
      assert(plan.indexes.includes(
        "outdoor_research_projection_relationships_subject_idx"
      ), JSON.stringify(plan.indexes));
      assert(plan.indexes.some((name) => [
        "outdoor_research_projection_entities_trail_point_gist_idx",
        "outdoor_research_projection_entities_trail_geography_gist_idx"
      ].includes(name)), JSON.stringify(plan.indexes));
      records.push({ ...sampleIdentity(sample), ...measured, indexes: plan.indexes });
    }
    context.diagnostic(JSON.stringify(records));
  });

  it("keeps five routable-access samples deterministic and below the existing p95 gate", async (context) => {
    const policy = RESEARCH_TRAIL_ACCESS_CANDIDATE_POLICY_V1;
    const records = [];
    for (const sample of SAMPLES) {
      const snapshot = await runtimePool.query(runtimeQueries.snapshotContext, [
        sample.regionId, sample.longitude, sample.latitude
      ]);
      const runId = snapshot.rows[0].runtime_row.projection_run_id;
      const highlights = await runtimePool.query(runtimeQueries.highlights, [
        runId, sample.regionId, sample.longitude, sample.latitude,
        policy.highlightCategories, 20_000,
        ["entity_category", "name", "viewpoint_presence", "waterfall_presence"],
        12, policy.maximumPoiToTrailDistanceMeters
      ]);
      const entityIds = [...new Set(highlights.rows.map((row) =>
        row.runtime_row.entity_id
      ))].slice(0, 4);
      assert(entityIds.length > 0, sample.name);
      const values = [
        runId, sample.regionId, entityIds,
        policy.maximumPoiToTrailDistanceMeters,
        policy.limits.maximumCandidatesPerHighlight,
        policy.eligibleHighwayClasses, policy.highlightCategories,
        policy.limits.maximumCandidates
      ];
      const measured = await measureRuntimeQuery({
        pool: runtimePool,
        query: runtimeQueries.trailAccessCandidates,
        values,
        minimumRows: 1
      });
      assert(measured.p95Ms < 1_500, sample.name);
      const plan = await explain(adminPool,
        outdoorResearchRepositoryQueriesForTesting.trailAccessCandidates,
        values);
      assert(plan.indexes.includes(
        "outdoor_research_projection_entities_trail_geography_gist_idx"
      ), JSON.stringify(plan.indexes));
      records.push({
        ...sampleIdentity(sample), highlightCount: entityIds.length,
        ...measured, indexes: plan.indexes
      });
    }
    context.diagnostic(JSON.stringify(records));
  });

  it("keeps five corridor samples below the existing timeout with intended GiST plans", async (context) => {
    const records = [];
    for (const sample of SAMPLES) {
      const values = [JSON.stringify({
        type: "LineString",
        coordinates: [
          [sample.longitude, sample.latitude], sample.corridorEnd
        ]
      }), 100, 40];
      const measured = await measureRuntimeQuery({
        pool: adminPool,
        query: outdoorEvidenceCorridorQueryForTesting,
        values,
        minimumRows: 1,
        maximumMs: 2_500
      });
      assert(measured.p95Ms < 2_500, sample.name);
      const plan = await explain(
        adminPool, outdoorEvidenceCorridorQueryForTesting, values
      );
      for (const required of [
        "outdoor_evidence_regions_boundary_gist_idx",
        "outdoor_evidence_trail_segments_geom_metric_gist_idx",
        "outdoor_evidence_pois_geom_metric_gist_idx"
      ]) assert(plan.indexes.includes(required), `${sample.name}: ${required}`);
      records.push({ ...sampleIdentity(sample), ...measured, indexes: plan.indexes });
    }
    context.diagnostic(JSON.stringify(records));
  });

  it("runs representative pre-provider dossier and candidate-shaping reads", async (context) => {
    const repository = new PostgresOutdoorResearchRepository({
      pool: runtimePool,
      cancellationPool,
      runtimeSchema: RUNTIME_SCHEMA,
      statementTimeoutMs: 2_500
    });
    const outcomes = [];
    for (const sample of [SAMPLES[0], SAMPLES[3]]) {
      const research = await researchOutdoorAdventureWithTrailAccessV1(
        intent(sample),
        {
          repository,
          clock: () => new Date("2026-08-28T14:00:00.000Z"),
          totalTimeoutMs: 30_000
        }
      );
      assert.equal(research.state, "ready", sample.name);
      const plan = buildResearchGuidedRouteCandidatePlanV2(
        research.dossier,
        research.trailAccessResolution,
        { maximumProposals: 3 }
      );
      validateResearchGuidedRouteCandidatePlanV2ForResearch(
        plan, research.dossier, research.trailAccessResolution,
        { maximumProposals: 3 }
      );
      assert(plan.proposals.length > 0 && plan.proposals.length <= 3);
      outcomes.push({
        sample: sample.name,
        researchState: research.state,
        planState: plan.state,
        proposalCount: plan.proposals.length
      });
    }
    context.diagnostic(JSON.stringify(outcomes));
  });

  it("enforces runtime least privilege and five SECURITY DEFINER entry points", async (context) => {
    const role = await runtimePool.query(
      `SELECT rolcanlogin, rolsuper, rolcreatedb, rolcreaterole,
              rolreplication, rolbypassrls, rolconfig
         FROM pg_roles WHERE rolname = current_user`
    );
    assert.deepEqual(role.rows.map((row) => ({
      ...row, rolconfig: row.rolconfig ?? []
    })), [{
      rolcanlogin: true, rolsuper: false, rolcreatedb: false,
      rolcreaterole: false, rolreplication: false, rolbypassrls: false,
      rolconfig: ["search_path=pg_catalog, trailmind_app, pg_temp"]
    }]);
    const functions = await adminPool.query(
      `SELECT procedure.proname
         FROM pg_proc procedure
         JOIN pg_namespace namespace ON namespace.oid = procedure.pronamespace
        WHERE namespace.nspname = $1
          AND procedure.proname LIKE 'trailmind_runtime_outdoor_research_%_v1'
          AND has_function_privilege(
            'outdoor_research_runtime_role', procedure.oid, 'EXECUTE'
          )
        ORDER BY procedure.proname`,
      [RUNTIME_SCHEMA]
    );
    assert.equal(functions.rowCount, 5);
    const projectionDatabasePrivileges = await adminPool.query(
      `SELECT
         has_database_privilege(
           'projection_role', current_database(), 'TEMPORARY'
         ) AS temporary_workspace,
         has_database_privilege(
           'projection_role', current_database(), 'CREATE'
         ) AS persistent_create`
    );
    assert.deepEqual(projectionDatabasePrivileges.rows, [{
      temporary_workspace: true,
      persistent_create: false
    }]);
    const denied = [
      "SELECT * FROM public.outdoor_research_projection_entities LIMIT 1",
      "UPDATE public.outdoor_evidence_regions SET enabled = false WHERE false",
      "CREATE TEMP TABLE capacity_escape (id integer)",
      "SET ROLE projection_role"
    ];
    for (const sql of denied) {
      await assert.rejects(() => runtimePool.query(sql), (error) =>
        ["42501", "42P01", "0LP01"].includes(error?.code)
      );
    }
    context.diagnostic(JSON.stringify({
      functions: functions.rows,
      projectionDatabasePrivileges: projectionDatabasePrivileges.rows[0]
    }));
  });

  it("cancels and times out without partial graph or import state", async (context) => {
    const counts = () => adminPool.query(
      `SELECT
         (SELECT count(*)::bigint FROM outdoor_evidence_imports) AS imports,
         (SELECT count(*)::bigint FROM outdoor_research_projection_runs) AS runs,
         (SELECT count(*)::bigint FROM outdoor_research_projection_entities) AS entities,
         (SELECT count(*)::bigint FROM outdoor_research_projection_relationships) AS relationships`
    );
    const beforeCounts = (await counts()).rows[0];
    const lock = await adminPool.connect();
    const runtimeClient = await runtimePool.connect();
    try {
      await lock.query("BEGIN");
      await lock.query(
        "LOCK TABLE outdoor_evidence_regions IN ACCESS EXCLUSIVE MODE"
      );
      await runtimeClient.query(
        "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY"
      );
      const runtimePid = (await runtimeClient.query(
        "SELECT pg_backend_pid() AS pid"
      )).rows[0].pid;
      const pending = runtimeClient.query(
        runtimeQueries.snapshotContext,
        [SAMPLES[0].regionId, SAMPLES[0].longitude, SAMPLES[0].latitude]
      );
      await new Promise((resolve) => setTimeout(resolve, 50));
      const cancelled = await cancellationPool.query(
        `SELECT trailmind_control
           .cancel_active_outdoor_research_backend_integer($1) AS cancelled`,
        [runtimePid]
      );
      assert.equal(cancelled.rows[0].cancelled, true);
      await assert.rejects(pending, (error) => error?.code === "57014");
      await runtimeClient.query("ROLLBACK");
      await lock.query("ROLLBACK");
    } finally {
      await runtimeClient.query("ROLLBACK").catch(() => {});
      await lock.query("ROLLBACK").catch(() => {});
      runtimeClient.release();
      lock.release();
    }
    const protectedClient = await adminPool.connect();
    try {
      const protectedPid = (await protectedClient.query(
        "SELECT pg_backend_pid() AS pid"
      )).rows[0].pid;
      await assert.rejects(
        () => cancellationPool.query(
          "SELECT pg_cancel_backend($1)", [protectedPid]
        ),
        (error) => error?.code === "42501"
      );
    } finally {
      protectedClient.release();
    }

    const timeoutClient = await operatorPool.connect();
    try {
      await timeoutClient.query("BEGIN READ ONLY");
      await timeoutClient.query("SET LOCAL statement_timeout = '1ms'");
      await assert.rejects(
        () => timeoutClient.query("SELECT pg_sleep(0.05)"),
        (error) => error?.code === "57014"
      );
      await timeoutClient.query("ROLLBACK");
    } finally {
      await timeoutClient.query("ROLLBACK").catch(() => {});
      timeoutClient.release();
    }
    const afterCounts = (await counts()).rows[0];
    assert.deepEqual(afterCounts, beforeCounts);
    context.diagnostic(JSON.stringify({
      targetRestrictedCancellation: true,
      directPgCancelDenied: true,
      statementTimeoutRolledBack: true,
      beforeCounts,
      afterCounts
    }));
  });
});

function pool(connectionString, applicationName) {
  const configuration = {
    connectionString,
    max: 4,
    connectionTimeoutMillis: 10_000,
    query_timeout: 3_000,
    statement_timeout: 2_500,
    allowExitOnIdle: true,
    application_name: applicationName
  };
  if (applicationName === "capacity_admin") {
    configuration.options =
      "-csearch_path=pg_catalog,trailmind_app,trailmind_gis,pg_temp";
  }
  return new Pool(configuration);
}

async function measureRuntimeQuery({
  pool: connectionPool,
  query,
  values,
  minimumRows,
  maximumMs = 2_000
}) {
  const warmup = await connectionPool.query(query, values);
  assert(warmup.rowCount >= minimumRows);
  const expected = normalizeRows(warmup.rows);
  const measurements = [];
  for (let iteration = 0; iteration < 5; iteration += 1) {
    const started = performance.now();
    const result = await connectionPool.query(query, values);
    measurements.push(performance.now() - started);
    assert.deepEqual(normalizeRows(result.rows), expected);
  }
  assert(measurements.every((duration) => duration < maximumMs));
  return {
    rowCount: warmup.rowCount,
    p50Ms: round(percentile(measurements, 0.5)),
    p95Ms: round(percentile(measurements, 0.95)),
    maximumMs: round(Math.max(...measurements))
  };
}

async function explain(connectionPool, query, values) {
  const client = await connectionPool.connect();
  try {
    await client.query("BEGIN TRANSACTION READ ONLY");
    await client.query("SET LOCAL enable_seqscan = off");
    await client.query("SET LOCAL statement_timeout = '2500ms'");
    const result = await client.query(
      `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)\n${query}`,
      values
    );
    await client.query("ROLLBACK");
    const document = result.rows[0]["QUERY PLAN"][0];
    return {
      executionMs: round(Number(document["Execution Time"])),
      indexes: [...new Set(collectPlanValues(document.Plan, "Index Name"))]
        .sort()
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

function collectPlanValues(value, key) {
  if (!value || typeof value !== "object") return [];
  const own = typeof value[key] === "string" ? [value[key]] : [];
  return [
    ...own,
    ...Object.values(value).flatMap((child) => collectPlanValues(child, key))
  ];
}

function percentile(values, ratio) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)];
}

function normalizeRows(rows) {
  return rows.map((row) => Object.fromEntries(Object.entries(row).map(
    ([key, value]) => [key, value instanceof Date ? value.toISOString() : value]
  )));
}

function round(value) {
  return Math.round(value * 10) / 10;
}

function sampleIdentity(sample) {
  return { name: sample.name, regionId: sample.regionId };
}

function intent(sample) {
  const binding = OUTDOOR_RESEARCH_REGION_BINDINGS_V1.find((item) =>
    item.operationalRegionId === sample.regionId
  );
  return {
    schemaVersion: 1,
    activity: "hiking",
    geographicAnchor: {
      state: "resolved",
      name: sample.name,
      coordinate: { latitude: sample.latitude, longitude: sample.longitude },
      regionEntityId: binding.regionEntityId
    },
    routeType: "loop",
    distanceRangeKm: { min: 8, max: 14 },
    durationRangeMinutes: null,
    maximumElevationGainMeters: null,
    maximumTechnicalDifficulty: null,
    mustHaveExperiences: [{ experience: "viewpoint", minimumCount: 1 }],
    preferredExperiences: ["alpine_hut"],
    avoidedExperiences: [],
    requiredFacilities: [],
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
    unresolvedClarificationQuestions: []
  };
}
