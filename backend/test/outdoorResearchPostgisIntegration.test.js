import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { after, before, describe, it } from "node:test";
import pg from "pg";

const { Pool } = pg;
const executeFile = promisify(execFile);
const connectionString = process.env.TRAILMIND_TEST_POSTGIS_DATABASE_URL;
const IDS = Object.freeze({
  entity: "11111111-1111-4111-8111-111111111111",
  secondEntity: "22222222-2222-4222-8222-222222222222",
  osmSource: "33333333-3333-4333-8333-333333333333",
  officialSource: "44444444-4444-4444-8444-444444444444",
  secondOfficialSource: "55555555-5555-4555-8555-555555555555",
  communitySource: "66666666-6666-4666-8666-666666666666",
  derivedSource: "77777777-7777-4777-8777-777777777777",
  firstAssertion: "88888888-8888-4888-8888-888888888888",
  secondAssertion: "99999999-9999-4999-8999-999999999999"
});

describe("outdoor research graph PostGIS integration", { skip: !connectionString }, () => {
  let administrativePool;
  let testPool;
  let schemaName;
  let runnerSchemaName;

  before(async () => {
    const url = new URL(connectionString);
    if (!/test/i.test(url.pathname)) {
      throw new Error("TRAILMIND_TEST_POSTGIS_DATABASE_URL must name an explicitly disposable test database.");
    }
    schemaName = `trailmind_research_test_${randomUUID().replaceAll("-", "_")}`;
    runnerSchemaName = `trailmind_migration_test_${randomUUID().replaceAll("-", "_")}`;
    administrativePool = new Pool({ connectionString, max: 2, allowExitOnIdle: true });
    await administrativePool.query("CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA public");
    await administrativePool.query(`CREATE SCHEMA "${schemaName}"`);
    await administrativePool.query(`CREATE SCHEMA "${runnerSchemaName}"`);
    testPool = new Pool({
      connectionString,
      options: `-c search_path=${schemaName},public`,
      max: 3,
      allowExitOnIdle: true
    });
    const migration = await readFile(
      new URL("../migrations/003_outdoor_research_graph.sql", import.meta.url), "utf8"
    );
    await testPool.query(migration);
    await testPool.query(migration);
    await seedSourcesAndEntities(testPool);
  });

  after(async () => {
    if (testPool) await testPool.end();
    if (administrativePool && schemaName) {
      await administrativePool.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    }
    if (administrativePool && runnerSchemaName) {
      await administrativePool.query(`DROP SCHEMA IF EXISTS "${runnerSchemaName}" CASCADE`);
    }
    if (administrativePool) await administrativePool.end();
  });

  it("applies twice, creates all tables, indexes and RLS", async () => {
    const tables = await testPool.query(
      `SELECT tablename, rowsecurity
         FROM pg_tables
        WHERE schemaname = $1 AND tablename LIKE 'outdoor_research_%'
        ORDER BY tablename`,
      [schemaName]
    );
    assert.equal(tables.rowCount, 9);
    assert(tables.rows.every((row) => row.rowsecurity === true));
    const indexes = await testPool.query(
      `SELECT indexname FROM pg_indexes WHERE schemaname = $1 AND indexname LIKE 'outdoor_research_%'`,
      [schemaName]
    );
    assert(indexes.rows.some((row) => row.indexname === "outdoor_research_entities_geometry_gist_idx"));
    assert(indexes.rows.some((row) => row.indexname === "outdoor_research_assertions_current_lookup_idx"));
  });

  it("runs the real migration runner once and produces a true no-op on the second run", async () => {
    const runnerURL = new URL(connectionString);
    runnerURL.searchParams.set("options", `-csearch_path=${runnerSchemaName},public`);
    const environment = { ...process.env, DATABASE_URL: runnerURL.toString(), POSTGRES_URL: "" };
    const first = await executeFile(process.execPath, ["scripts/migrate.js"], {
      cwd: new URL("..", import.meta.url),
      env: environment
    });
    const second = await executeFile(process.execPath, ["scripts/migrate.js"], {
      cwd: new URL("..", import.meta.url),
      env: environment
    });
    assert.match(first.stdout, /Applied 003_outdoor_research_graph\.sql/);
    assert.equal(second.stdout, "");
    const migrations = await administrativePool.query(
      `SELECT version FROM "${runnerSchemaName}".trailmind_schema_migrations ORDER BY version`
    );
    assert.deepEqual(migrations.rows.map((row) => row.version), [
      "001_app_attest.sql",
      "002_outdoor_evidence.sql",
      "003_outdoor_research_graph.sql",
      "004_osm_outdoor_research_projection.sql",
      "005_outdoor_research_projection_geometry.sql",
      "006_outdoor_route_membership_point_index.sql"
    ]);
  });

  it("rejects invalid WGS84 geometry and invalid canonical categories", async () => {
    await assert.rejects(testPool.query(
      `INSERT INTO outdoor_research_entities
         (entity_id, entity_category, canonical_geometry)
       VALUES ($1, 'viewpoint', ST_SetSRID(ST_MakePoint(181, 47), 4326))`,
      [randomUUID()]
    ), /check constraint/i);
    await assert.rejects(testPool.query(
      `INSERT INTO outdoor_research_entities (entity_id, entity_category)
       VALUES ($1, 'beautiful_place')`,
      [randomUUID()]
    ), /check constraint/i);
  });

  it("allows unresolved candidate matches but prevents one resolved source identity mapping twice", async () => {
    await testPool.query(
      `INSERT INTO outdoor_research_source_entities
         (source_entity_link_id, entity_id, source_id, external_type, external_id,
          matching_status, matching_method, matched_at)
       VALUES ($1, $2, $3, 'node', '123', 'matched', 'exact_external_id', '2026-07-20T09:00:00Z')`,
      [randomUUID(), IDS.entity, IDS.osmSource]
    );
    await assert.rejects(testPool.query(
      `INSERT INTO outdoor_research_source_entities
         (source_entity_link_id, entity_id, source_id, external_type, external_id,
          matching_status, matching_method, matched_at)
       VALUES ($1, $2, $3, 'node', '123', 'matched', 'exact_external_id', '2026-07-20T09:00:00Z')`,
      [randomUUID(), IDS.secondEntity, IDS.osmSource]
    ), /unique constraint/i);
    for (const entityId of [IDS.entity, IDS.secondEntity]) {
      await testPool.query(
        `INSERT INTO outdoor_research_source_entities
           (source_entity_link_id, entity_id, source_id, external_type, external_id,
            matching_status, matching_method)
         VALUES ($1, $2, $3, 'node', 'possible-456', 'conflicted', 'spatial_candidate')`,
        [randomUUID(), entityId, IDS.osmSource]
      );
    }
  });

  it("preserves conflicting authoritative assertions and temporal states", async () => {
    await insertBooleanAssertion(testPool, {
      assertionId: IDS.firstAssertion,
      sourceId: IDS.officialSource,
      value: true,
      provenance: "authority/access/1",
      freshness: "current"
    });
    await insertBooleanAssertion(testPool, {
      assertionId: IDS.secondAssertion,
      sourceId: IDS.secondOfficialSource,
      value: false,
      provenance: "operator/access/1",
      freshness: "current"
    });
    await insertBooleanAssertion(testPool, {
      assertionId: randomUUID(),
      sourceId: IDS.officialSource,
      value: true,
      provenance: "authority/access/stale",
      freshness: "stale"
    });
    await insertBooleanAssertion(testPool, {
      assertionId: randomUUID(),
      sourceId: IDS.officialSource,
      value: false,
      provenance: "authority/access/expired",
      freshness: "expired",
      validUntil: "2026-07-19T00:00:00Z"
    });
    const rows = await testPool.query(
      `SELECT value_boolean, freshness_state
         FROM outdoor_research_assertions
        WHERE entity_id = $1 AND predicate = 'public_access'
        ORDER BY freshness_state, value_boolean`,
      [IDS.entity]
    );
    assert.equal(rows.rowCount, 4);
    assert.deepEqual(new Set(rows.rows.map((row) => row.freshness_state)), new Set(["current", "stale", "expired"]));
  });

  it("keeps community high-stakes assertions non-official and derived output derived", async () => {
    await testPool.query(
      `INSERT INTO outdoor_research_assertions
         (assertion_id, entity_id, source_id, predicate, value_type, value_boolean,
          evidence_class, retrieved_at, freshness_state, provenance_identifier)
       VALUES ($1, $2, $3, 'overnight_permission', 'boolean', true,
          'community_observed', '2026-07-20T09:00:00Z', 'current', 'community/report/1')`,
      [randomUUID(), IDS.entity, IDS.communitySource]
    );
    await assert.rejects(testPool.query(
      `INSERT INTO outdoor_research_assertions
         (assertion_id, entity_id, source_id, predicate, value_type, value_boolean,
          evidence_class, retrieved_at, freshness_state, provenance_identifier)
       VALUES ($1, $2, $3, 'viewpoint_presence', 'boolean', true,
          'official', '2026-07-20T09:00:00Z', 'current', 'derived/invalid')`,
      [randomUUID(), IDS.entity, IDS.derivedSource]
    ), /evidence class does not match source category/i);
    await testPool.query(
      `INSERT INTO outdoor_research_derived_features
         (derived_feature_id, entity_id, source_id, feature_key, value_type, value_number,
          computation_version, input_data_version, provenance_reference, calculated_at,
          freshness_state)
       VALUES ($1, $2, $3, 'horizon_openness', 'number', 0.62,
          'viewshed-v1', 'dem-v1', 'calculation/1', '2026-07-20T09:00:00Z', 'current')`,
      [randomUUID(), IDS.entity, IDS.derivedSource]
    );
    const derived = await testPool.query(
      "SELECT evidence_class FROM outdoor_research_derived_features WHERE entity_id = $1",
      [IDS.entity]
    );
    assert.deepEqual(derived.rows, [{ evidence_class: "derived" }]);
  });

  it("requires active normalized-fact writers with reviewed claim-specific scope", async () => {
    await assert.rejects(testPool.query(
      `INSERT INTO outdoor_research_assertions
         (assertion_id, entity_id, source_id, predicate, value_type, value_boolean,
          evidence_class, retrieved_at, freshness_state, provenance_identifier)
       VALUES ($1, $2, $3, 'viewpoint_presence', 'boolean', true,
          'mapped', '2026-07-20T09:00:00Z', 'current', 'osm/unreviewed-predicate/1')`,
      [randomUUID(), IDS.entity, IDS.osmSource]
    ), /lacks reviewed authority for assertion scope/i);

    const waterfallEntityId = randomUUID();
    await testPool.query(
      `INSERT INTO outdoor_research_entities (entity_id, entity_category, lifecycle_state)
       VALUES ($1, 'waterfall', 'active')`,
      [waterfallEntityId]
    );
    await assert.rejects(testPool.query(
      `INSERT INTO outdoor_research_assertions
         (assertion_id, entity_id, source_id, predicate, value_type, value_boolean,
          evidence_class, retrieved_at, freshness_state, provenance_identifier)
       VALUES ($1, $2, $3, 'public_access', 'boolean', true,
          'official', '2026-07-20T09:00:00Z', 'current', 'authority/wrong-entity-category/1')`,
      [randomUUID(), waterfallEntityId, IDS.officialSource]
    ), /lacks reviewed authority for assertion scope/i);

    for (const configuration of [
      { lifecycle: "active", normalized: false, message: /approved for normalized facts/i },
      { lifecycle: "paused", normalized: true, message: /approved for normalized facts/i }
    ]) {
      const sourceId = randomUUID();
      await insertTestSource(testPool, {
        sourceId,
        sourceKey: `authority.${sourceId}`,
        lifecycle: configuration.lifecycle,
        normalized: configuration.normalized,
        derived: false
      });
      await insertAuthorityScope(testPool, sourceId, "public_access", "viewpoint");
      await assert.rejects(testPool.query(
        `INSERT INTO outdoor_research_assertions
           (assertion_id, entity_id, source_id, predicate, value_type, value_boolean,
            evidence_class, retrieved_at, freshness_state, provenance_identifier)
         VALUES ($1, $2, $3, 'public_access', 'boolean', true,
            'official', '2026-07-20T09:00:00Z', 'current', $4)`,
        [randomUUID(), IDS.entity, sourceId, `authority/rejected/${sourceId}`]
      ), configuration.message);
    }
  });

  it("enforces derived-feature permission independently from assertion authority", async () => {
    await assert.rejects(testPool.query(
      `INSERT INTO outdoor_research_derived_features
         (derived_feature_id, entity_id, source_id, feature_key, value_type, value_number,
          computation_version, input_data_version, provenance_reference, calculated_at,
          freshness_state)
       VALUES ($1, $2, $3, 'horizon_openness', 'number', 0.4,
          'viewshed-v1', 'dem-v1', 'calculation/not-approved', '2026-07-20T09:00:00Z', 'current')`,
      [randomUUID(), IDS.entity, IDS.osmSource]
    ), /approved for derived features/i);
    await assert.rejects(testPool.query(
      `INSERT INTO outdoor_research_derived_features
         (derived_feature_id, entity_id, source_id, feature_key, value_type, value_number,
          computation_version, input_data_version, provenance_reference, calculated_at,
          freshness_state)
       VALUES ($1, $2, NULL, 'horizon_openness', 'number', 0.4,
          'viewshed-v1', 'dem-v1', 'calculation/no-source', '2026-07-20T09:00:00Z', 'current')`,
      [randomUUID(), IDS.entity]
    ), /derived feature source does not exist/i);
  });

  it("restricts supersession and retraction to a later assertion in the same source cohort", async () => {
    const targetId = randomUUID();
    await insertStateAssertion(testPool, {
      assertionId: targetId,
      provenance: "authority/supersession/base",
      retrievedAt: "2026-07-20T09:00:00Z",
      createdAt: "2026-07-20T09:00:00Z"
    });
    await insertStateAssertion(testPool, {
      provenance: "authority/supersession/valid",
      retrievedAt: "2026-07-20T10:00:00Z",
      createdAt: "2026-07-20T10:00:00Z",
      assertionState: "supersedes",
      targetId
    });
    await insertStateAssertion(testPool, {
      provenance: "authority/retraction/valid",
      retrievedAt: "2026-07-20T11:00:00Z",
      createdAt: "2026-07-20T11:00:00Z",
      assertionState: "retracts",
      targetId
    });

    const invalidTargets = [
      {
        provenance: "authority/supersession/wrong-entity",
        entityId: IDS.secondEntity,
        assertionState: "supersedes",
        retrievedAt: "2026-07-20T12:00:00Z",
        createdAt: "2026-07-20T12:00:00Z",
        expected: /share entity, predicate and source/i
      },
      {
        provenance: "authority/retraction/wrong-predicate",
        predicate: "current_opening",
        assertionState: "retracts",
        retrievedAt: "2026-07-20T12:00:00Z",
        createdAt: "2026-07-20T12:00:00Z",
        expected: /share entity, predicate and source/i
      },
      {
        provenance: "operator/supersession/wrong-source",
        sourceId: IDS.secondOfficialSource,
        assertionState: "supersedes",
        retrievedAt: "2026-07-20T12:00:00Z",
        createdAt: "2026-07-20T12:00:00Z",
        expected: /share entity, predicate and source/i
      },
      {
        provenance: "authority/supersession/older-retrieval",
        assertionState: "supersedes",
        retrievedAt: "2026-07-20T08:00:00Z",
        createdAt: "2026-07-20T12:00:00Z",
        expected: /temporally later/i
      },
      {
        provenance: "authority/retraction/older-created",
        assertionState: "retracts",
        retrievedAt: "2026-07-20T12:00:00Z",
        createdAt: "2026-07-20T08:00:00Z",
        expected: /temporally later/i
      }
    ];
    for (const invalidTarget of invalidTargets) {
      await assert.rejects(insertStateAssertion(testPool, { ...invalidTarget, targetId }), invalidTarget.expected);
    }
  });

  it("prevents assertion and observation mutation and protects referenced audit evidence", async () => {
    await assert.rejects(testPool.query(
      "UPDATE outdoor_research_assertions SET freshness_state = 'stale' WHERE assertion_id = $1",
      [IDS.firstAssertion]
    ), /append-only/i);
    await assert.rejects(testPool.query(
      "DELETE FROM outdoor_research_assertions WHERE assertion_id = $1",
      [IDS.firstAssertion]
    ), /append-only/i);
    const observationId = randomUUID();
    await testPool.query(
      `INSERT INTO outdoor_research_observations
         (observation_id, entity_id, source_id, observation_type, value_type, value_text,
          observed_at, retrieved_at, provenance_identifier)
       VALUES ($1, $2, $3, 'closure_observation', 'text', 'closed',
          '2026-07-20T08:00:00Z', '2026-07-20T09:00:00Z', 'community/closure/1')`,
      [observationId, IDS.entity, IDS.communitySource]
    );
    await assert.rejects(testPool.query(
      "DELETE FROM outdoor_research_observations WHERE observation_id = $1",
      [observationId]
    ), /append-only/i);
    await assert.rejects(testPool.query(
      "DELETE FROM outdoor_research_sources WHERE source_id = $1",
      [IDS.officialSource]
    ), /foreign key constraint/i);
  });
});

async function seedSourcesAndEntities(pool) {
  const sources = [
    [IDS.osmSource, "openstreetmap.test", "OpenStreetMap test", "openstreetmap_open_mapping", "open_community", "ODbL-1.0", true, false],
    [IDS.officialSource, "tirol.authority", "Tyrol authority", "official_authority", "primary_authority", "official-open-data", true, false],
    [IDS.secondOfficialSource, "innsbruck.operator", "Innsbruck operator", "official_operator", "operator", "operator-license", true, false],
    [IDS.communitySource, "trailmind.community", "TrailMind community", "trailmind_community", "trailmind_community", "internal", true, false],
    [IDS.derivedSource, "trailmind.derived", "TrailMind derived", "derived_computation", "derived", "internal", true, true]
  ];
  for (const [id, key, name, category, authorityClass, license, normalized, derived] of sources) {
    await pool.query(
      `INSERT INTO outdoor_research_sources
         (source_id, source_key, source_name, source_category, authority_class,
          license_identifier, attribution_requirements, canonical_origin,
          normalized_facts_allowed, derived_features_allowed, geographic_coverage,
          lifecycle_state, adapter_schema_version)
       VALUES ($1, $2, $3, $4, $5, $6, '', $7, $8, $9, 'Disposable test only', 'active', 'v1')`,
      [id, key, name, category, authorityClass, license, `test-origin:${key}`, normalized, derived]
    );
  }
  await pool.query(
    `INSERT INTO outdoor_research_entities
       (entity_id, entity_category, canonical_geometry, lifecycle_state)
     VALUES
       ($1, 'viewpoint', ST_SetSRID(ST_MakePoint(11.4041, 47.2692), 4326), 'active'),
       ($2, 'viewpoint', ST_SetSRID(ST_MakePoint(11.41, 47.27), 4326), 'candidate')`,
    [IDS.entity, IDS.secondEntity]
  );
  for (const [sourceId, predicate] of [
    [IDS.osmSource, "entity_category"],
    [IDS.officialSource, "public_access"],
    [IDS.officialSource, "current_opening"],
    [IDS.secondOfficialSource, "public_access"],
    [IDS.communitySource, "overnight_permission"],
    [IDS.derivedSource, "viewpoint_presence"]
  ]) {
    await insertAuthorityScope(pool, sourceId, predicate, "viewpoint");
  }
}

async function insertBooleanAssertion(pool, options) {
  await pool.query(
    `INSERT INTO outdoor_research_assertions
       (assertion_id, entity_id, source_id, predicate, value_type, value_boolean,
        evidence_class, retrieved_at, valid_until, freshness_state, provenance_identifier)
     VALUES ($1, $2, $3, 'public_access', 'boolean', $4,
        'official', '2026-07-20T09:00:00Z', $5, $6, $7)`,
    [
      options.assertionId,
      IDS.entity,
      options.sourceId,
      options.value,
      options.validUntil ?? null,
      options.freshness,
      options.provenance
    ]
  );
}

async function insertTestSource(pool, options) {
  await pool.query(
    `INSERT INTO outdoor_research_sources
       (source_id, source_key, source_name, source_category, authority_class,
        license_identifier, attribution_requirements, canonical_origin,
        normalized_facts_allowed, derived_features_allowed, geographic_coverage,
        lifecycle_state, adapter_schema_version)
     VALUES ($1, $2, 'Test authority', 'official_authority', 'primary_authority',
        'test-license', '', $3, $4, $5, 'Disposable test only', $6, 'v1')`,
    [
      options.sourceId, options.sourceKey, `test-origin:${options.sourceKey}`,
      options.normalized, options.derived, options.lifecycle
    ]
  );
}

async function insertAuthorityScope(pool, sourceId, predicate, entityCategory) {
  await pool.query(
    `INSERT INTO outdoor_research_source_authority_scopes
       (source_authority_scope_id, source_id, predicate, entity_category,
        review_reference, reviewed_at)
     VALUES ($1, $2, $3, $4, 'test-review', '2026-07-19T09:00:00Z')`,
    [randomUUID(), sourceId, predicate, entityCategory]
  );
}

async function insertStateAssertion(pool, options) {
  return pool.query(
    `INSERT INTO outdoor_research_assertions
       (assertion_id, entity_id, source_id, predicate, value_type, value_boolean,
        evidence_class, retrieved_at, freshness_state, provenance_identifier,
        assertion_state, supersedes_assertion_id, created_at)
     VALUES ($1, $2, $3, $4, 'boolean', true, 'official', $5, 'current', $6, $7, $8, $9)`,
    [
      options.assertionId ?? randomUUID(),
      options.entityId ?? IDS.entity,
      options.sourceId ?? IDS.officialSource,
      options.predicate ?? "public_access",
      options.retrievedAt,
      options.provenance,
      options.assertionState ?? "asserted",
      options.targetId ?? null,
      options.createdAt
    ]
  );
}
