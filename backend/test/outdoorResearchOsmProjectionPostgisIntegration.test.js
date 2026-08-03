import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { after, before, describe, it } from "node:test";
import pg from "pg";
import {
  deterministicOsmEntityId,
  OSM_POLICY_ACTIVATION_CONFIRMATION,
  OSM_POLICY_REVOCATION_CONFIRMATION,
  OSM_PROJECTION_OPERATOR_CONFIRMATION,
  OSM_PROJECTION_POLICY_REACTIVATION_VERSION,
  OSM_PROJECTION_POLICY_VERSION,
  OsmProjectionError
} from "../src/outdoorResearch/osmProjectionPolicy.js";
import { PostgresOsmEvidenceGraphProjector } from
  "../src/outdoorResearch/postgresOsmEvidenceGraphProjector.js";
import { configureOsmProjectionPolicy } from
  "../src/outdoorResearch/postgresOsmProjectionPolicyRepository.js";

const { Pool } = pg;
const connectionString = process.env.TRAILMIND_TEST_POSTGIS_DATABASE_URL;
const REGION_ID = "harz-v1";
const REVIEW_REFERENCE = "docs/osm-projection-policy-review/2026-07-20";
const REVIEWED_AT = "2026-07-20T09:00:00.000Z";
const BASE_NOW = new Date("2026-07-24T10:00:00.000Z");

describe("OSM Evidence Graph projection PostGIS integration", {
  skip: !connectionString
}, () => {
  let administrativePool;
  let pool;
  let schemaName;
  let lastKnownGoodImportId;

  before(async () => {
    const url = new URL(connectionString);
    if (!/test/i.test(url.pathname)) {
      throw new Error(
        "TRAILMIND_TEST_POSTGIS_DATABASE_URL must name an explicitly disposable test database."
      );
    }
    schemaName = `trailmind_osm_projection_${randomUUID().replaceAll("-", "_")}`;
    administrativePool = new Pool({
      connectionString,
      max: 2,
      allowExitOnIdle: true
    });
    await administrativePool.query("CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA public");
    await administrativePool.query(`CREATE SCHEMA "${schemaName}"`);
    pool = new Pool({
      connectionString,
      options: `-c search_path=${schemaName},public`,
      max: 4,
      allowExitOnIdle: true
    });
    for (const migrationName of [
      "002_outdoor_evidence.sql",
      "003_outdoor_research_graph.sql",
      "004_osm_outdoor_research_projection.sql",
      "005_outdoor_research_projection_geometry.sql",
      "006_outdoor_route_membership_point_index.sql"
    ]) {
      const migration = await readFile(
        new URL(`../migrations/${migrationName}`, import.meta.url), "utf8"
      );
      await pool.query(migration);
      await pool.query(migration);
    }
  });

  after(async () => {
    if (pool) await pool.end();
    if (administrativePool && schemaName) {
      await administrativePool.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    }
    if (administrativePool) await administrativePool.end();
  });

  it("creates the projection schema idempotently with RLS and audit indexes", async () => {
    const tables = await pool.query(
      `SELECT tablename, rowsecurity
         FROM pg_tables
        WHERE schemaname = $1
          AND tablename IN (
            'outdoor_research_source_policies',
            'outdoor_research_source_policy_scopes',
            'outdoor_research_source_policy_relationship_scopes',
            'outdoor_research_projection_runs',
            'outdoor_research_osm_entity_identities',
            'outdoor_research_projection_entities',
            'outdoor_research_projection_assertions',
            'outdoor_research_projection_relationships',
            'outdoor_research_projection_quarantines'
          )`,
      [schemaName]
    );
    assert.equal(tables.rowCount, 9);
    assert(tables.rows.every((row) => row.rowsecurity === true));
    const indexes = await pool.query(
      "SELECT indexname FROM pg_indexes WHERE schemaname = $1",
      [schemaName]
    );
    const indexNames = new Set(indexes.rows.map((row) => row.indexname));
    assert(indexNames.has("outdoor_research_projection_runs_active_idx"));
    assert(indexNames.has("outdoor_research_projection_entities_identity_idx"));
    assert(indexNames.has("outdoor_research_projection_entities_geometry_gist_idx"));
    assert(indexNames.has("outdoor_research_projection_assertions_lookup_idx"));
    assert(indexNames.has("outdoor_research_projection_relationships_subject_idx"));
  });

  it("rejects ambiguous, invalid-calendar, offset and future policy timestamps", async () => {
    const clock = () => new Date("2026-07-24T12:00:00.000Z");
    for (const [mode, reviewedAt, code] of [
      ["activate", "2026", "invalid_review_timestamp"],
      ["activate", "2026-02-30T09:00:00Z", "invalid_review_timestamp"],
      ["revoke", "2026-07-24T09:00:00+00:00", "invalid_review_timestamp"],
      ["revoke", "2026-07-24T12:00:00.001Z", "future_review_timestamp"]
    ]) {
      await assert.rejects(configureOsmProjectionPolicy({
        pool,
        mode,
        policyVersion: OSM_PROJECTION_POLICY_VERSION,
        operatorConfirmation: mode === "activate"
          ? OSM_POLICY_ACTIVATION_CONFIRMATION
          : OSM_POLICY_REVOCATION_CONFIRMATION,
        reviewReference: REVIEW_REFERENCE,
        reviewedAt,
        now: clock
      }), hasCode(code));
    }
    const sourceCount = await pool.query(
      "SELECT count(*)::integer AS count FROM outdoor_research_sources"
    );
    assert.equal(sourceCount.rows[0].count, 0);
  });

  it("requires explicit reviewed policy activation and writes the exact OSM contract", async () => {
    await assert.rejects(configureOsmProjectionPolicy({
      pool,
      mode: "activate",
      policyVersion: OSM_PROJECTION_POLICY_VERSION,
      operatorConfirmation: "not-reviewed",
      reviewReference: REVIEW_REFERENCE,
      reviewedAt: REVIEWED_AT
    }), hasCode("operator_confirmation_required"));

    const result = await configureOsmProjectionPolicy({
      pool,
      mode: "activate",
      policyVersion: OSM_PROJECTION_POLICY_VERSION,
      operatorConfirmation: OSM_POLICY_ACTIVATION_CONFIRMATION,
      reviewReference: REVIEW_REFERENCE,
      reviewedAt: REVIEWED_AT,
      now: () => BASE_NOW
    });
    assert.equal(result.lifecycleState, "active");
    assert.equal(result.normalizedFactsAllowed, true);
    assert.equal(result.derivedFeaturesAllowed, false);

    const source = await pool.query(
      `SELECT source_key, source_category, authority_class, license_identifier,
              canonical_origin, normalized_facts_allowed, derived_features_allowed
         FROM outdoor_research_sources
        WHERE source_key = 'osm_foundational_data'`
    );
    assert.deepEqual(source.rows, [{
      source_key: "osm_foundational_data",
      source_category: "openstreetmap_open_mapping",
      authority_class: "open_community",
      license_identifier: "ODbL-1.0",
      canonical_origin: "https://www.openstreetmap.org",
      normalized_facts_allowed: true,
      derived_features_allowed: false
    }]);
    const authorityText = await pool.query(
      `SELECT string_agg(
          source_name || ' ' || canonical_origin || ' ' || attribution_requirements,
          ' '
        ) AS contract
         FROM outdoor_research_sources
        WHERE source_key = 'osm_foundational_data'`
    );
    assert.doesNotMatch(authorityText.rows[0].contract, /geofabrik/i);

    await assert.rejects(
      pool.query(
        `INSERT INTO outdoor_research_source_policies
           (source_policy_id, source_id, policy_version, policy_schema_version,
            adapter_schema_version, normalized_facts_allowed,
            derived_features_allowed, maximum_input_age_days,
            review_reference, reviewed_at, lifecycle_state)
         SELECT $1, source_id, 'direct-future-policy', 1,
                'osm-evidence-graph-v1', true, false, 14,
                'database timestamp guard regression',
                '2099-01-01T00:00:00Z', 'active'
           FROM outdoor_research_sources
          WHERE source_key = 'osm_foundational_data'`,
        [randomUUID()]
      ),
      (error) => error?.code === "23514"
    );
  });

  it("keeps source permissions required by another exact active reviewed policy", async () => {
    const isolatedSchema =
      `trailmind_osm_policy_overlap_${randomUUID().replaceAll("-", "_")}`;
    let isolatedPool;
    await administrativePool.query(`CREATE SCHEMA "${isolatedSchema}"`);
    try {
      isolatedPool = new Pool({
        connectionString,
        options: `-c search_path=${isolatedSchema},public`,
        max: 2,
        allowExitOnIdle: true
      });
      for (const migrationName of [
        "002_outdoor_evidence.sql",
        "003_outdoor_research_graph.sql",
        "004_osm_outdoor_research_projection.sql"
      ]) {
        const migration = await readFile(
          new URL(`../migrations/${migrationName}`, import.meta.url), "utf8"
        );
        await isolatedPool.query(migration);
      }
      for (const [policyVersion, suffix] of [
        [OSM_PROJECTION_POLICY_VERSION, "v1"],
        [OSM_PROJECTION_POLICY_REACTIVATION_VERSION, "v2"]
      ]) {
        await configureOsmProjectionPolicy({
          pool: isolatedPool,
          mode: "activate",
          policyVersion,
          operatorConfirmation: OSM_POLICY_ACTIVATION_CONFIRMATION,
          reviewReference: `${REVIEW_REFERENCE}/${suffix}`,
          reviewedAt: REVIEWED_AT,
          now: () => BASE_NOW
        });
      }
      const result = await configureOsmProjectionPolicy({
        pool: isolatedPool,
        mode: "revoke",
        policyVersion: OSM_PROJECTION_POLICY_VERSION,
        operatorConfirmation: OSM_POLICY_REVOCATION_CONFIRMATION,
        reviewReference: "operator-revocation/overlapping-v1",
        reviewedAt: "2026-07-24T09:30:00Z",
        now: () => BASE_NOW
      });
      assert.equal(result.remainingActivePolicyCount, 1);
      assert.equal(result.sourceLifecycleState, "active");
      assert.equal(result.normalizedFactsAllowed, true);
      const state = await isolatedPool.query(
        `SELECT source.lifecycle_state, source.normalized_facts_allowed,
                source.derived_features_allowed,
                (count(authority.source_authority_scope_id)
                  FILTER (WHERE authority.lifecycle_state = 'active'))::integer
                  AS active_authority
           FROM outdoor_research_sources source
           LEFT JOIN outdoor_research_source_authority_scopes authority
             ON authority.source_id = source.source_id
          WHERE source.source_key = 'osm_foundational_data'
          GROUP BY source.source_id`
      );
      assert.deepEqual(state.rows, [{
        lifecycle_state: "active",
        normalized_facts_allowed: true,
        derived_features_allowed: false,
        active_authority: 21
      }]);
    } finally {
      if (isolatedPool) await isolatedPool.end();
      await administrativePool.query(`DROP SCHEMA IF EXISTS "${isolatedSchema}" CASCADE`);
    }
  });

  it("projects, reruns, supersedes, retracts and preserves last-known-good atomically", async () => {
    const firstImportId = randomUUID();
    await seedImport(pool, {
      importId: firstImportId,
      sourceDataAt: "2026-07-20T06:00:00Z",
      retrievedAt: "2026-07-20T08:00:00Z",
      importedAt: "2026-07-20T08:30:00Z",
      version: 1,
      viewpointName: "Brockenblick",
      routeOperator: "Harzklub",
      sacScale: "mountain_hiking",
      accessTag: "no",
      includeSecondRoute: true
    });
    const projector = new PostgresOsmEvidenceGraphProjector({
      pool,
      now: () => BASE_NOW
    });
    await assert.rejects(projector.project({
      regionId: "other-region-v1",
      policyVersion: OSM_PROJECTION_POLICY_VERSION,
      operatorConfirmation: OSM_PROJECTION_OPERATOR_CONFIRMATION,
      dryRun: true
    }), hasCode("unsupported_region"));
    await assert.rejects(projector.project({
      regionId: REGION_ID,
      policyVersion: OSM_PROJECTION_POLICY_VERSION,
      operatorConfirmation: "not-confirmed",
      dryRun: false
    }), hasCode("operator_confirmation_required"));

    await pool.query(
      "UPDATE outdoor_evidence_imports SET acquisition_channel = NULL WHERE import_id = $1",
      [firstImportId]
    );
    try {
      await assert.rejects(
        projector.project(projectionRequest(firstImportId, true)),
        hasCode("acquisition_channel_missing")
      );
      const legacyRows = await pool.query(
        `SELECT count(*)::integer AS count
           FROM outdoor_evidence_trail_segments
          WHERE import_id = $1`,
        [firstImportId]
      );
      assert.equal(legacyRows.rows[0].count, 2);
    } finally {
      await pool.query(
        `UPDATE outdoor_evidence_imports
            SET acquisition_channel = 'geofabrik_regional_extract'
          WHERE import_id = $1`,
        [firstImportId]
      );
    }
    await expectFailureDuringTemporaryMutation(pool, projector, {
      setupSql: "UPDATE outdoor_evidence_imports SET input_file_sha256 = NULL WHERE import_id = $1",
      restoreSql: `UPDATE outdoor_evidence_imports
                      SET input_file_sha256 = repeat('b', 64)
                    WHERE import_id = $1`,
      parameters: [firstImportId],
      request: projectionRequest(firstImportId, true),
      code: "input_file_sha256_missing"
    });
    await assert.rejects(
      pool.query(
        "UPDATE outdoor_evidence_imports SET input_file_sha256 = 'malformed' WHERE import_id = $1",
        [firstImportId]
      ),
      (error) => error?.code === "23514"
    );
    await assert.rejects(
      pool.query(
        `UPDATE outdoor_evidence_imports
            SET source_checksum_algorithm = NULL,
                source_checksum = NULL,
                source_checksum_verified_at = NULL
          WHERE import_id = $1`,
        [firstImportId]
      ),
      (error) => error?.code === "23514"
    );

    const first = await projector.project(projectionRequest(firstImportId, false));
    assert.equal(first.status, "active");
    assert.deepEqual(first.counts.input, {
      pois: 6, trails: 2, relations: 2, members: 3
    });
    assert.equal(first.counts.entities, 10);
    assert.equal(first.counts.pois, 6);
    assert.equal(first.counts.trailSegments, 2);
    assert.equal(first.counts.hikingRoutes, 2);
    assert.equal(first.counts.relationships, 3);
    assert.equal(first.counts.quarantined, 0);

    const sameInputDryRun = await projector.project(
      projectionRequest(firstImportId, true)
    );
    assert.equal(sameInputDryRun.status, "dry_run");
    const runsAfterSameInputDryRun = await pool.query(
      "SELECT count(*)::integer AS count FROM outdoor_research_projection_runs"
    );
    assert.equal(runsAfterSameInputDryRun.rows[0].count, 1);

    const unchanged = await projector.project(projectionRequest(firstImportId, false));
    assert.equal(unchanged.status, "unchanged");
    assert.equal(unchanged.projectionRunId, first.projectionRunId);
    const sourceId = await sourceIdForTest(pool);

    await expectFailureDuringTemporaryMutation(pool, projector, {
      setupSql: `UPDATE outdoor_research_sources
                    SET source_category = 'wikimedia_open_knowledge'
                  WHERE source_id = $1`,
      restoreSql: `UPDATE outdoor_research_sources
                      SET source_category = 'openstreetmap_open_mapping'
                    WHERE source_id = $1`,
      parameters: [sourceId],
      request: projectionRequest(firstImportId, false),
      code: "source_contract_mismatch"
    });
    for (const lifecycle of ["paused", "blocked"]) {
      await expectFailureDuringTemporaryMutation(pool, projector, {
        setupSql: "UPDATE outdoor_research_sources SET lifecycle_state = $2 WHERE source_id = $1",
        restoreSql: "UPDATE outdoor_research_sources SET lifecycle_state = 'active' WHERE source_id = $1",
        parameters: [sourceId, lifecycle],
        restoreParameters: [sourceId],
        request: projectionRequest(firstImportId, false),
        code: "source_inactive"
      });
    }
    await expectFailureDuringTemporaryMutation(pool, projector, {
      setupSql: `UPDATE outdoor_research_sources
                    SET normalized_facts_allowed = false
                  WHERE source_id = $1`,
      restoreSql: `UPDATE outdoor_research_sources
                      SET normalized_facts_allowed = true
                    WHERE source_id = $1`,
      parameters: [sourceId],
      request: projectionRequest(firstImportId, false),
      code: "normalized_facts_disabled"
    });
    await expectFailureDuringTemporaryMutation(pool, projector, {
      setupSql: `UPDATE outdoor_research_sources
                    SET derived_features_allowed = true
                  WHERE source_id = $1`,
      restoreSql: `UPDATE outdoor_research_sources
                      SET derived_features_allowed = false
                    WHERE source_id = $1`,
      parameters: [sourceId],
      request: projectionRequest(firstImportId, false),
      code: "derived_features_must_be_disabled"
    });
    await expectFailureDuringTemporaryMutation(pool, projector, {
      setupSql: `UPDATE outdoor_research_source_policies
                    SET maximum_input_age_days = 13
                  WHERE source_id = $1 AND policy_version = $2`,
      restoreSql: `UPDATE outdoor_research_source_policies
                      SET maximum_input_age_days = 14
                    WHERE source_id = $1 AND policy_version = $2`,
      parameters: [sourceId, OSM_PROJECTION_POLICY_VERSION],
      request: projectionRequest(firstImportId, false),
      code: "source_policy_invalid"
    });
    await expectFailureDuringTemporaryMutation(pool, projector, {
      setupSql: `UPDATE outdoor_research_source_authority_scopes
                    SET lifecycle_state = 'retired'
                  WHERE source_id = $1
                    AND predicate = 'entity_category'
                    AND entity_category = 'viewpoint'`,
      restoreSql: `UPDATE outdoor_research_source_authority_scopes
                      SET lifecycle_state = 'active'
                    WHERE source_id = $1
                      AND predicate = 'entity_category'
                      AND entity_category = 'viewpoint'`,
      parameters: [sourceId],
      request: projectionRequest(firstImportId, false),
      code: "authority_scope_mismatch"
    });
    await expectFailureDuringTemporaryMutation(pool, projector, {
      setupSql: `UPDATE outdoor_research_source_policy_relationship_scopes
                    SET lifecycle_state = 'retired'
                  WHERE relationship_type = 'trail_segment_member_of_route'`,
      restoreSql: `UPDATE outdoor_research_source_policy_relationship_scopes
                      SET lifecycle_state = 'active'
                    WHERE relationship_type = 'trail_segment_member_of_route'`,
      parameters: [],
      request: projectionRequest(firstImportId, false),
      code: "relationship_scope_mismatch"
    });
    await insertRegionOnly(pool, "innsbruck-alps-v1");
    await assert.rejects(projector.project({
      ...projectionRequest(firstImportId, false),
      regionId: "innsbruck-alps-v1"
    }), hasCode("wrong_region_import"));

    const claimAudit = await pool.query(
      `SELECT
         count(*) FILTER (WHERE evidence_class <> 'mapped')::integer AS not_mapped,
         count(*) FILTER (WHERE predicate IN (
           'public_access', 'current_opening', 'seasonal_opening',
           'overnight_permission', 'bookability',
           'drinking_water_availability', 'closure_status'
         ))::integer AS forbidden,
         count(*) FILTER (
           WHERE predicate = 'access_restriction' AND value_text = 'prohibited'
         )::integer AS cautious_restrictions
       FROM outdoor_research_active_assertions`
    );
    assert.deepEqual(claimAudit.rows, [{
      not_mapped: 0,
      forbidden: 0,
      cautious_restrictions: 1
    }]);
    const relationshipAudit = await pool.query(
      `SELECT subject_entity_id, count(*)::integer AS route_count
         FROM outdoor_research_active_relationships
        WHERE relationship_type = 'trail_segment_member_of_route'
        GROUP BY subject_entity_id
        ORDER BY route_count DESC`
    );
    assert.equal(relationshipAudit.rows[0].route_count, 2);
    const membershipAssertions = await pool.query(
      `SELECT count(*)::integer AS count
         FROM outdoor_research_assertions
        WHERE predicate = 'mapped_hiking_route_membership'`
    );
    assert.equal(membershipAssertions.rows[0].count, 0);

    const provenance = await pool.query(
      `SELECT record_provenance
         FROM outdoor_research_projection_entities
        WHERE projection_run_id = $1 AND osm_type = 'way'
        ORDER BY osm_id
        LIMIT 1`,
      [first.projectionRunId]
    );
    assert.equal(provenance.rows[0].record_provenance.evidence_authority, "OpenStreetMap");
    assert.equal(
      provenance.rows[0].record_provenance.acquisition_channel,
      "geofabrik_regional_extract"
    );
    assert.equal(provenance.rows[0].record_provenance.license, "ODbL-1.0");
    assert.match(provenance.rows[0].record_provenance.input_file_sha256, /^[a-f0-9]{64}$/);
    assert.equal(
      new Date(
        provenance.rows[0].record_provenance.source_checksum_verified_at
      ).toISOString(),
      "2026-07-20T08:00:00.000Z"
    );

    const extraScopeId = randomUUID();
    await pool.query(
      `INSERT INTO outdoor_research_source_authority_scopes
         (source_authority_scope_id, source_id, predicate, entity_category,
          review_reference, reviewed_at, lifecycle_state)
       VALUES ($1, $2, 'public_access', 'trail_segment', $3, $4, 'active')`,
      [extraScopeId, sourceId, REVIEW_REFERENCE, REVIEWED_AT]
    );
    await assert.rejects(
      projector.project(projectionRequest(firstImportId, false)),
      hasCode("authority_scope_mismatch")
    );
    await pool.query(
      `UPDATE outdoor_research_source_authority_scopes
          SET lifecycle_state = 'retired', updated_at = clock_timestamp()
        WHERE source_authority_scope_id = $1`,
      [extraScopeId]
    );

    const emptyImportId = randomUUID();
    await seedEmptyImport(pool, {
      importId: emptyImportId,
      sourceDataAt: "2026-07-21T06:00:00Z",
      retrievedAt: "2026-07-21T08:00:00Z",
      importedAt: "2026-07-21T08:30:00Z"
    });
    await assert.rejects(
      projector.project(projectionRequest(emptyImportId, false)),
      hasCode("empty_import")
    );
    const activeAfterEmptyImport = await pool.query(
      `SELECT projection_run_id
         FROM outdoor_research_projection_runs
        WHERE source_id = $1 AND region_id = $2 AND status = 'active'`,
      [sourceId, REGION_ID]
    );
    assert.deepEqual(activeAfterEmptyImport.rows, [{
      projection_run_id: first.projectionRunId
    }]);

    const secondImportId = randomUUID();
    await seedImport(pool, {
      importId: secondImportId,
      sourceDataAt: "2026-07-22T06:00:00Z",
      retrievedAt: "2026-07-22T08:00:00Z",
      importedAt: "2026-07-22T08:30:00Z",
      version: 2,
      viewpointName: "Brockenblick Nord",
      routeOperator: null,
      sacScale: null,
      accessTag: "permit",
      includeSecondRoute: false,
      viewpointCategory: "waterfall",
      acquisitionChannel: "operator_supplied_local"
    });
    const dryRun = await projector.project(projectionRequest(secondImportId, true));
    assert.equal(dryRun.status, "dry_run");
    const dryRunRows = await pool.query(
      "SELECT count(*)::integer AS count FROM outdoor_research_projection_runs WHERE input_import_id = $1",
      [secondImportId]
    );
    assert.equal(dryRunRows.rows[0].count, 0);

    const concurrentResults = await Promise.allSettled([
      projector.project(projectionRequest(secondImportId, false)),
      projector.project(projectionRequest(secondImportId, false))
    ]);
    const activeResult = concurrentResults.find(
      (result) => result.status === "fulfilled" && result.value.status === "active"
    );
    assert(activeResult);
    const second = activeResult.value;
    const otherResult = concurrentResults.find((result) => result !== activeResult);
    assert(
      (otherResult.status === "fulfilled" && otherResult.value.status === "unchanged") ||
      (otherResult.status === "rejected" &&
        otherResult.reason instanceof OsmProjectionError &&
        otherResult.reason.code === "concurrent_projection")
    );
    assert.equal(second.status, "active");
    assert.equal(second.counts.entities, 9);
    assert.equal(second.counts.relationships, 2);
    assert(second.counts.retractions >= 2);
    lastKnownGoodImportId = secondImportId;
    const localReceipt = await pool.query(
      `SELECT input_acquisition_channel, input_file_sha256,
              input_source_checksum, input_source_checksum_verified_at
         FROM outdoor_research_projection_runs
        WHERE projection_run_id = $1`,
      [second.projectionRunId]
    );
    assert.deepEqual(localReceipt.rows, [{
      input_acquisition_channel: "operator_supplied_local",
      input_file_sha256: "b".repeat(64),
      input_source_checksum: null,
      input_source_checksum_verified_at: null
    }]);

    const stableIdentity = await pool.query(
      `SELECT count(DISTINCT entity_id)::integer AS entity_ids,
              count(DISTINCT source_version)::integer AS versions
         FROM outdoor_research_projection_entities
        WHERE source_id = $1 AND osm_type = 'node' AND osm_id = 1001`,
      [sourceId]
    );
    assert.deepEqual(stableIdentity.rows, [{ entity_ids: 1, versions: 2 }]);
    const sqlIdentity = await pool.query(
      `SELECT outdoor_research_deterministic_uuid_v3(
         'outdoor-research-entity',
         'osm_foundational_data:node:1001'
       ) AS entity_id`
    );
    assert.equal(sqlIdentity.rows[0].entity_id, deterministicOsmEntityId("node", 1001));
    const changedCategory = await pool.query(
      `SELECT assertion.value_text, assertion.assertion_state,
              assertion.supersedes_assertion_id IS NOT NULL AS has_target
         FROM outdoor_research_active_assertions assertion
         JOIN outdoor_research_osm_entity_identities identity
           ON identity.entity_id = assertion.entity_id
        WHERE identity.source_id = $1
          AND identity.osm_type = 'node' AND identity.osm_id = 1001
          AND assertion.predicate = 'entity_category'`,
      [sourceId]
    );
    assert.deepEqual(changedCategory.rows, [{
      value_text: "waterfall",
      assertion_state: "supersedes",
      has_target: true
    }]);
    const changedName = await pool.query(
      `SELECT assertion_state, supersedes_assertion_id IS NOT NULL AS has_target
         FROM outdoor_research_active_assertions
        WHERE predicate = 'name' AND value_text = 'Brockenblick Nord'`
    );
    assert.deepEqual(changedName.rows, [{
      assertion_state: "supersedes",
      has_target: true
    }]);
    const unchangedFreshReceipt = await pool.query(
      `SELECT assertion.assertion_state, assertion.retrieved_at,
              (
                SELECT count(DISTINCT historic.assertion_id)::integer
                  FROM outdoor_research_assertions historic
                 WHERE historic.source_id = assertion.source_id
                   AND historic.entity_id = assertion.entity_id
                   AND historic.predicate = assertion.predicate
              ) AS audit_receipts
         FROM outdoor_research_active_assertions assertion
         JOIN outdoor_research_osm_entity_identities identity
           ON identity.entity_id = assertion.entity_id
        WHERE identity.source_id = $1
          AND identity.osm_type = 'node' AND identity.osm_id = 1003
          AND assertion.predicate = 'name'`,
      [sourceId]
    );
    assert.equal(unchangedFreshReceipt.rows[0].assertion_state, "asserted");
    assert.equal(
      new Date(unchangedFreshReceipt.rows[0].retrieved_at).toISOString(),
      "2026-07-22T08:00:00.000Z"
    );
    assert.equal(unchangedFreshReceipt.rows[0].audit_receipts, 2);
    const removedClaims = await pool.query(
      `SELECT
         count(*) FILTER (WHERE assertion.predicate = 'operator')::integer AS operators,
         count(*) FILTER (
           WHERE assertion.predicate = 'trail_difficulty'
             AND identity.osm_type = 'way' AND identity.osm_id = 2001
         )::integer AS first_trail_difficulties
         FROM outdoor_research_active_assertions assertion
         JOIN outdoor_research_osm_entity_identities identity
           ON identity.entity_id = assertion.entity_id
        WHERE identity.source_id = $1`,
      [sourceId]
    );
    assert.deepEqual(removedClaims.rows, [{
      operators: 0,
      first_trail_difficulties: 0
    }]);
    const retractions = await pool.query(
      `SELECT count(*)::integer AS count
         FROM outdoor_research_assertions assertion
         JOIN outdoor_research_projection_assertions projection
           ON projection.assertion_id = assertion.assertion_id
        WHERE projection.projection_run_id = $1
          AND assertion.assertion_state = 'retracts'`,
      [second.projectionRunId]
    );
    assert(retractions.rows[0].count >= 2);
    const oldRouteAudit = await pool.query(
      `SELECT
         (SELECT count(*)::integer
            FROM outdoor_research_projection_entities
           WHERE projection_run_id = $1 AND osm_type = 'relation' AND osm_id = 3002
         ) AS first_run,
         (SELECT count(*)::integer
            FROM outdoor_research_active_entities active
            JOIN outdoor_research_osm_entity_identities identity
              ON identity.entity_id = active.entity_id
           WHERE identity.source_id = $2
             AND identity.osm_type = 'relation' AND identity.osm_id = 3002
         ) AS active_snapshot`,
      [first.projectionRunId, sourceId]
    );
    assert.deepEqual(oldRouteAudit.rows, [{ first_run: 1, active_snapshot: 0 }]);

    const staleImportId = randomUUID();
    await seedImport(pool, {
      importId: staleImportId,
      sourceDataAt: "2026-06-01T06:00:00Z",
      retrievedAt: "2026-06-01T08:00:00Z",
      importedAt: "2026-06-01T08:30:00Z",
      version: 3,
      viewpointName: "Stale input",
      routeOperator: null,
      sacScale: null,
      accessTag: null,
      includeSecondRoute: false
    });
    await assert.rejects(
      projector.project(projectionRequest(staleImportId, false)),
      hasCode("stale_import")
    );
    const invalidImportId = randomUUID();
    await seedImport(pool, {
      importId: invalidImportId,
      sourceDataAt: "2026-07-23T06:00:00Z",
      retrievedAt: "2026-07-23T08:00:00Z",
      importedAt: "2026-07-23T08:30:00Z",
      version: 4,
      trailVersion: null,
      viewpointName: "Structurally invalid input",
      routeOperator: null,
      sacScale: null,
      accessTag: null,
      includeSecondRoute: false
    });
    await assert.rejects(
      projector.project(projectionRequest(invalidImportId, false)),
      hasCode("structurally_invalid_input")
    );
    const failedReceipt = await pool.query(
      `SELECT projection_run_id, status, failure_code
         FROM outdoor_research_projection_runs
        WHERE input_import_id = $1`,
      [invalidImportId]
    );
    assert.equal(failedReceipt.rowCount, 1);
    assert.equal(failedReceipt.rows[0].status, "failed");
    assert.equal(failedReceipt.rows[0].failure_code, "structurally_invalid_input");
    const failedLineage = await pool.query(
      `SELECT count(*)::integer AS count
         FROM outdoor_research_projection_entities
        WHERE projection_run_id = $1`,
      [failedReceipt.rows[0].projection_run_id]
    );
    assert.equal(failedLineage.rows[0].count, 0);
    const lastKnownGood = await pool.query(
      `SELECT projection_run_id, status
         FROM outdoor_research_projection_runs
        WHERE source_id = $1 AND region_id = $2 AND status = 'active'`,
      [sourceId, REGION_ID]
    );
    assert.deepEqual(lastKnownGood.rows, [{
      projection_run_id: second.projectionRunId,
      status: "active"
    }]);
    const activeAfterFailure = await pool.query(
      "SELECT count(*)::integer AS count FROM outdoor_research_active_entities"
    );
    assert.equal(activeAfterFailure.rows[0].count, 9);
    await assertCriticalIndexesUsed(pool, sourceId, secondImportId);
  });

  it("disables graph writes after final revocation and permits only a new policy version", async () => {
    assert(lastKnownGoodImportId);
    const importClient = await pool.connect();
    try {
      await importClient.query("BEGIN");
      await importClient.query(
        `UPDATE outdoor_evidence_imports
            SET status = 'superseded'
          WHERE region_id = $1 AND status = 'active'`,
        [REGION_ID]
      );
      await importClient.query(
        "UPDATE outdoor_evidence_imports SET status = 'active' WHERE import_id = $1",
        [lastKnownGoodImportId]
      );
      await importClient.query(
        `UPDATE outdoor_evidence_regions
            SET active_import_id = $2, updated_at = clock_timestamp()
          WHERE region_id = $1`,
        [REGION_ID, lastKnownGoodImportId]
      );
      await importClient.query("COMMIT");
    } catch (error) {
      await importClient.query("ROLLBACK");
      throw error;
    } finally {
      importClient.release();
    }
    const before = await projectionAuditCounts(pool);
    const result = await configureOsmProjectionPolicy({
      pool,
      mode: "revoke",
      policyVersion: OSM_PROJECTION_POLICY_VERSION,
      operatorConfirmation: OSM_POLICY_REVOCATION_CONFIRMATION,
      reviewReference: "operator-revocation/2026-07-24",
      reviewedAt: "2026-07-23T11:00:00Z",
      now: () => BASE_NOW
    });
    assert.equal(result.lifecycleState, "retired");
    assert.equal(result.remainingActivePolicyCount, 0);
    assert.equal(result.sourceLifecycleState, "paused");
    assert.equal(result.normalizedFactsAllowed, false);
    assert.equal(result.derivedFeaturesAllowed, false);
    const retirementAudit = await pool.query(
      `SELECT policy.retirement_reference, policy.retired_at,
              source.lifecycle_state AS source_lifecycle,
              source.normalized_facts_allowed,
              source.derived_features_allowed,
              (SELECT count(*)::integer
                 FROM outdoor_research_source_policy_scopes scope
                WHERE scope.source_policy_id = policy.source_policy_id
                  AND scope.lifecycle_state = 'retired') AS retired_assertion_scopes,
              (SELECT count(*)::integer
                 FROM outdoor_research_source_policy_relationship_scopes scope
                WHERE scope.source_policy_id = policy.source_policy_id
                  AND scope.lifecycle_state = 'retired') AS retired_relationship_scopes,
              (SELECT count(*)::integer
                 FROM outdoor_research_source_authority_scopes authority
                WHERE authority.source_id = source.source_id
                  AND authority.lifecycle_state = 'retired') AS retired_authority_scopes,
              (SELECT count(*)::integer
                 FROM outdoor_research_source_authority_scopes authority
                WHERE authority.source_id = source.source_id
                  AND authority.lifecycle_state = 'active') AS active_authority_scopes
         FROM outdoor_research_source_policies policy
         JOIN outdoor_research_sources source ON source.source_id = policy.source_id
        WHERE policy.policy_version = $1`,
      [OSM_PROJECTION_POLICY_VERSION]
    );
    assert.equal(retirementAudit.rows[0].retirement_reference,
      "operator-revocation/2026-07-24");
    assert.equal(
      new Date(retirementAudit.rows[0].retired_at).toISOString(),
      "2026-07-23T11:00:00.000Z"
    );
    assert.equal(retirementAudit.rows[0].source_lifecycle, "paused");
    assert.equal(retirementAudit.rows[0].normalized_facts_allowed, false);
    assert.equal(retirementAudit.rows[0].derived_features_allowed, false);
    assert.equal(retirementAudit.rows[0].retired_assertion_scopes, 21);
    assert.equal(retirementAudit.rows[0].retired_relationship_scopes, 1);
    assert(retirementAudit.rows[0].retired_authority_scopes >= 21);
    assert.equal(retirementAudit.rows[0].active_authority_scopes, 0);
    const active = await pool.query(
      `SELECT
         (SELECT count(*)::integer FROM outdoor_research_active_projection_runs) AS runs,
         (SELECT count(*)::integer FROM outdoor_research_active_entities) AS entities,
         (SELECT count(*)::integer FROM outdoor_research_active_assertions) AS assertions,
         (SELECT count(*)::integer FROM outdoor_research_active_relationships) AS relationships`
    );
    assert.deepEqual(active.rows, [{
      runs: 0, entities: 0, assertions: 0, relationships: 0
    }]);
    const projector = new PostgresOsmEvidenceGraphProjector({
      pool,
      now: () => BASE_NOW
    });
    await assert.rejects(
      projector.project(projectionRequest(lastKnownGoodImportId, false)),
      hasCode("source_inactive")
    );
    const target = await pool.query(
      `SELECT entity_id
         FROM outdoor_research_entities
        WHERE entity_category = 'peak'
        ORDER BY entity_id
        LIMIT 1`
    );
    assert.equal(target.rowCount, 1);
    const sourceId = await sourceIdForTest(pool);
    await assert.rejects(
      pool.query(
        `INSERT INTO outdoor_research_assertions
           (assertion_id, entity_id, source_id, predicate, value_type, value_text,
            evidence_class, observed_at, retrieved_at, freshness_state,
            provenance_identifier, assertion_state, resolution_group_key)
         VALUES (
           $1, $2, $3, 'name', 'text', 'Rejected after revocation',
           'mapped', $4, $4, 'current',
           'direct-write-revocation-regression', 'asserted',
           'revocation-write-regression'
         )`,
        [randomUUID(), target.rows[0].entity_id, sourceId, BASE_NOW.toISOString()]
      ),
      (error) => error?.code === "23514" &&
        /source is not active and approved/.test(error.message)
    );
    assert.deepEqual(await projectionAuditCounts(pool), before);

    await assert.rejects(configureOsmProjectionPolicy({
      pool,
      mode: "activate",
      policyVersion: OSM_PROJECTION_POLICY_VERSION,
      operatorConfirmation: OSM_POLICY_ACTIVATION_CONFIRMATION,
      reviewReference: REVIEW_REFERENCE,
      reviewedAt: REVIEWED_AT,
      now: () => BASE_NOW
    }), hasCode("policy_version_conflict"));
    const stillPaused = await pool.query(
      `SELECT lifecycle_state, normalized_facts_allowed
         FROM outdoor_research_sources
        WHERE source_key = 'osm_foundational_data'`
    );
    assert.deepEqual(stillPaused.rows, [{
      lifecycle_state: "paused",
      normalized_facts_allowed: false
    }]);

    const reactivated = await configureOsmProjectionPolicy({
      pool,
      mode: "activate",
      policyVersion: OSM_PROJECTION_POLICY_REACTIVATION_VERSION,
      operatorConfirmation: OSM_POLICY_ACTIVATION_CONFIRMATION,
      reviewReference: "docs/osm-projection-policy-review/reactivation-v2",
      reviewedAt: "2026-07-23T11:30:00Z",
      now: () => BASE_NOW
    });
    assert.equal(reactivated.lifecycleState, "active");
    assert.equal(reactivated.assertionScopeCount, 21);
    assert.equal(reactivated.relationshipScopeCount, 1);
    const reactivatedState = await pool.query(
      `SELECT source.lifecycle_state, source.normalized_facts_allowed,
              source.derived_features_allowed,
              (count(scope.source_policy_scope_id)
                FILTER (WHERE scope.lifecycle_state = 'active'))::integer
                AS active_scopes
         FROM outdoor_research_sources source
         JOIN outdoor_research_source_policies policy ON policy.source_id = source.source_id
         LEFT JOIN outdoor_research_source_policy_scopes scope
           ON scope.source_policy_id = policy.source_policy_id
        WHERE source.source_key = 'osm_foundational_data'
          AND policy.policy_version = $1
        GROUP BY source.source_id`,
      [OSM_PROJECTION_POLICY_REACTIVATION_VERSION]
    );
    assert.deepEqual(reactivatedState.rows, [{
      lifecycle_state: "active",
      normalized_facts_allowed: true,
      derived_features_allowed: false,
      active_scopes: 21
    }]);
    const v2Projection = await projector.project(
      projectionRequest(
        lastKnownGoodImportId, false,
        OSM_PROJECTION_POLICY_REACTIVATION_VERSION
      )
    );
    assert.equal(v2Projection.status, "active");
    const activeAfterReactivation = await pool.query(
      "SELECT count(*)::integer AS count FROM outdoor_research_active_projection_runs"
    );
    assert.equal(activeAfterReactivation.rows[0].count, 1);
  });
});

function projectionRequest(
  importId,
  dryRun,
  policyVersion = OSM_PROJECTION_POLICY_VERSION
) {
  return {
    regionId: REGION_ID,
    importId,
    policyVersion,
    operatorConfirmation: OSM_PROJECTION_OPERATOR_CONFIRMATION,
    dryRun
  };
}

function hasCode(code) {
  return (error) => error instanceof OsmProjectionError && error.code === code;
}

async function sourceIdForTest(pool) {
  const result = await pool.query(
    "SELECT source_id FROM outdoor_research_sources WHERE source_key = 'osm_foundational_data'"
  );
  return result.rows[0].source_id;
}

async function projectionAuditCounts(pool) {
  const result = await pool.query(
    `SELECT
       (SELECT count(*)::integer FROM outdoor_research_projection_runs) AS runs,
       (SELECT count(*)::integer FROM outdoor_research_projection_entities)
         AS projection_entities,
       (SELECT count(*)::integer FROM outdoor_research_projection_assertions)
         AS projection_assertions,
       (SELECT count(*)::integer FROM outdoor_research_projection_relationships)
         AS projection_relationships,
       (SELECT count(*)::integer FROM outdoor_research_osm_entity_identities)
         AS identities,
       (SELECT count(*)::integer FROM outdoor_research_assertions) AS assertions,
       (SELECT count(*)::integer FROM outdoor_research_relationships) AS relationships,
       (SELECT count(*)::integer FROM outdoor_research_source_policies) AS policies,
       (SELECT count(*)::integer FROM outdoor_research_source_policy_scopes)
         AS policy_scopes`
  );
  return result.rows[0];
}

async function expectFailureDuringTemporaryMutation(pool, projector, input) {
  await pool.query(input.setupSql, input.parameters);
  try {
    await assert.rejects(projector.project(input.request), hasCode(input.code));
  } finally {
    await pool.query(
      input.restoreSql,
      input.restoreParameters ?? input.parameters
    );
  }
}

async function insertRegionOnly(pool, regionId) {
  await pool.query(
    `INSERT INTO outdoor_evidence_regions
       (region_id, name, definition_version, boundary_kind,
        coordinate_reference_system, metric_srid, boundary, boundary_metric,
        supported_feature_classes, freshness_threshold_days,
        path_match_tolerance_meters, enabled)
     VALUES (
       $1, 'Synthetic operator test region', 1, 'trailmind-operational-polygon',
       'EPSG:4326', 3857,
       ST_Multi(ST_MakeEnvelope(11.2, 47.1, 11.6, 47.4, 4326)),
       ST_Transform(ST_Multi(ST_MakeEnvelope(11.2, 47.1, 11.6, 47.4, 4326)), 3857),
       ARRAY['pois', 'trail_segments', 'hiking_relations'], 14, 25, true
     )
     ON CONFLICT (region_id) DO NOTHING`,
    [regionId]
  );
}

async function seedEmptyImport(pool, input) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "UPDATE outdoor_evidence_imports SET status = 'superseded' WHERE region_id = $1 AND status = 'active'",
      [REGION_ID]
    );
    await client.query(
      `INSERT INTO outdoor_evidence_imports
         (import_id, region_id, source_dataset_name, source_identifier,
          source_data_at, retrieved_at, imported_at, tool_version,
          import_schema_version, status, aggregate_counts, acquisition_channel,
          input_file_sha256)
       VALUES (
         $1, $2, 'Synthetic empty bounded input', 'synthetic-empty.osm.pbf',
         $3, $4, $5, 'synthetic fixture', 1, 'active',
         '{}'::jsonb, 'operator_supplied_local', repeat('c', 64)
       )`,
      [
        input.importId, REGION_ID, input.sourceDataAt,
        input.retrievedAt, input.importedAt
      ]
    );
    await client.query(
      `UPDATE outdoor_evidence_regions
          SET active_import_id = $2, updated_at = clock_timestamp()
        WHERE region_id = $1`,
      [REGION_ID, input.importId]
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function assertCriticalIndexesUsed(pool, sourceId, importId) {
  const client = await pool.connect();
  try {
    await client.query("SET enable_seqscan = off");
    const activeRunPlan = await client.query(
      `EXPLAIN (FORMAT JSON, COSTS OFF)
       SELECT projection_run_id
         FROM outdoor_research_projection_runs
        WHERE source_id = $1 AND region_id = $2 AND status = 'active'`,
      [sourceId, REGION_ID]
    );
    const identityPlan = await client.query(
      `EXPLAIN (FORMAT JSON, COSTS OFF)
       SELECT entity_id
         FROM outdoor_research_projection_entities
        WHERE source_id = $1 AND osm_type = 'way' AND osm_id = 2001`,
      [sourceId]
    );
    const importPlan = await client.query(
      `EXPLAIN (FORMAT JSON, COSTS OFF)
       SELECT osm_id
         FROM outdoor_evidence_trail_segments
        WHERE import_id = $1 AND region_id = $2`,
      [importId, REGION_ID]
    );
    assert.match(
      JSON.stringify(activeRunPlan.rows),
      /outdoor_research_projection_runs_active_idx/
    );
    assert.match(
      JSON.stringify(identityPlan.rows),
      /outdoor_research_projection_entities_identity_idx/
    );
    assert.match(
      JSON.stringify(importPlan.rows),
      /outdoor_evidence_trail_segments_identity_region_idx/
    );
  } finally {
    try { await client.query("RESET enable_seqscan"); } catch {}
    client.release();
  }
}

async function seedImport(pool, input) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO outdoor_evidence_regions
         (region_id, name, definition_version, boundary_kind,
          coordinate_reference_system, metric_srid, boundary, boundary_metric,
          supported_feature_classes, freshness_threshold_days,
          path_match_tolerance_meters, enabled)
       VALUES (
         $1, 'Harz test region', 1, 'trailmind-operational-polygon',
         'EPSG:4326', 3857,
         ST_Multi(ST_MakeEnvelope(10.5, 51.6, 10.8, 51.9, 4326)),
         ST_Transform(ST_Multi(ST_MakeEnvelope(10.5, 51.6, 10.8, 51.9, 4326)), 3857),
         ARRAY['pois', 'trail_segments', 'hiking_relations'], 14, 25, true
       )
       ON CONFLICT (region_id) DO NOTHING`,
      [REGION_ID]
    );
    await client.query(
      "UPDATE outdoor_evidence_imports SET status = 'superseded' WHERE region_id = $1 AND status = 'active'",
      [REGION_ID]
    );
    await client.query(
      `INSERT INTO outdoor_evidence_imports
         (import_id, region_id, source_dataset_name, source_identifier,
          source_data_at, retrieved_at, imported_at, tool_version,
          import_schema_version, status, aggregate_counts, acquisition_channel,
          source_checksum_algorithm, source_checksum,
          source_checksum_verified_at, input_file_sha256)
       VALUES (
         $1, $2, $10, $11,
         $3, $4, $5, 'osm2pgsql synthetic fixture', 1, 'active',
         '{"fixture":true}'::jsonb, $6, $7, $8, $9, repeat('b', 64)
       )`,
      [
        input.importId, REGION_ID, input.sourceDataAt,
        input.retrievedAt, input.importedAt,
        input.acquisitionChannel ?? "geofabrik_regional_extract",
        input.acquisitionChannel === "operator_supplied_local" ? null : "md5",
        input.acquisitionChannel === "operator_supplied_local" ? null : "a".repeat(32),
        input.acquisitionChannel === "operator_supplied_local"
          ? null
          : (input.sourceChecksumVerifiedAt ?? input.retrievedAt),
        input.acquisitionChannel === "operator_supplied_local"
          ? "Operator-supplied local OSM extract"
          : "Geofabrik Germany regional extract",
        input.acquisitionChannel === "operator_supplied_local"
          ? "operator-local-synthetic-fixture.osm.pbf"
          : "synthetic-postgis-fixture.osm.pbf"
      ]
    );
    await client.query(
      `INSERT INTO outdoor_evidence_pois
         (import_id, region_id, osm_type, osm_id, category, name,
          geom, geom_metric, source_version, source_timestamp, evidence_tags)
       SELECT $1, $2, 'node', fixture.osm_id, fixture.category, fixture.name,
              ST_SetSRID(ST_MakePoint(fixture.longitude, fixture.latitude), 4326),
              ST_Transform(
                ST_SetSRID(ST_MakePoint(fixture.longitude, fixture.latitude), 4326),
                3857
              ),
              $3, $4, '{}'::jsonb
         FROM (VALUES
           (1001::bigint, $6::text, $5::text, 10.60, 51.70),
           (1002::bigint, 'waterfall', 'Radau waterfall', 10.61, 51.71),
           (1003::bigint, 'peak', 'Brocken', 10.62, 51.72),
           (1004::bigint, 'lake', 'Oderteich', 10.63, 51.73),
           (1005::bigint, 'alpineHut', 'Test alpine hut', 10.64, 51.74),
           (1006::bigint, 'wildernessHut', 'Test wilderness hut', 10.65, 51.75)
         ) AS fixture(osm_id, category, name, longitude, latitude)`,
      [
        input.importId, REGION_ID, input.version, input.sourceDataAt,
        input.viewpointName, input.viewpointCategory ?? "viewpoint"
      ]
    );
    await client.query(
      `INSERT INTO outdoor_evidence_trail_segments
         (import_id, region_id, osm_type, osm_id, highway_class, surface,
          trail_visibility, sac_scale, access_tag, foot_tag,
          access_conditional, foot_conditional, seasonal_tag, permit_tag,
          geom, geom_metric, source_version, source_timestamp)
       SELECT $1, $2, 'way', fixture.osm_id, 'path', 'ground',
              fixture.visibility, fixture.sac_scale, fixture.access_tag, fixture.foot_tag,
              NULL, NULL, NULL, NULL,
              ST_Multi(ST_GeomFromText(fixture.wkt, 4326)),
              ST_Transform(ST_Multi(ST_GeomFromText(fixture.wkt, 4326)), 3857),
              $3, $4
         FROM (VALUES
           (
             2001::bigint, 'good'::text, $5::text, $6::text, NULL::text,
             'LINESTRING(10.60 51.70, 10.61 51.71)'
           ),
           (
             2002::bigint, 'intermediate'::text, 'hiking'::text, NULL::text,
             'yes'::text, 'LINESTRING(10.61 51.71, 10.62 51.72)'
           )
         ) AS fixture(osm_id, visibility, sac_scale, access_tag, foot_tag, wkt)`,
      [
        input.importId, REGION_ID,
        Object.hasOwn(input, "trailVersion") ? input.trailVersion : input.version,
        input.sourceDataAt,
        input.sacScale, input.accessTag
      ]
    );
    await client.query(
      `INSERT INTO outdoor_evidence_hiking_relations
         (import_id, region_id, osm_type, osm_id, route_type, network,
          name, operator, source_version, source_timestamp)
       VALUES
         ($1, $2, 'relation', 3001, 'hiking', 'rwn',
          'Harz route one', $3, $4, $5)`,
      [
        input.importId, REGION_ID, input.routeOperator,
        input.version, input.sourceDataAt
      ]
    );
    if (input.includeSecondRoute) {
      await client.query(
        `INSERT INTO outdoor_evidence_hiking_relations
           (import_id, region_id, osm_type, osm_id, route_type, network,
            name, operator, source_version, source_timestamp)
         VALUES
           ($1, $2, 'relation', 3002, 'hiking', 'lwn',
            'Harz route two', 'Harzklub', $3, $4)`,
        [input.importId, REGION_ID, input.version, input.sourceDataAt]
      );
    }
    await client.query(
      `INSERT INTO outdoor_evidence_hiking_relation_members
         (import_id, region_id, relation_osm_type, relation_osm_id,
          segment_osm_type, segment_osm_id, member_role, member_sequence)
       VALUES
         ($1, $2, 'relation', 3001, 'way', 2001, '', 0),
         ($1, $2, 'relation', 3001, 'way', 2002, '', 1)`,
      [input.importId, REGION_ID]
    );
    if (input.includeSecondRoute) {
      await client.query(
        `INSERT INTO outdoor_evidence_hiking_relation_members
           (import_id, region_id, relation_osm_type, relation_osm_id,
            segment_osm_type, segment_osm_id, member_role, member_sequence)
         VALUES ($1, $2, 'relation', 3002, 'way', 2001, '', 0)`,
        [input.importId, REGION_ID]
      );
    }
    await client.query(
      `UPDATE outdoor_evidence_regions
          SET active_import_id = $2, updated_at = clock_timestamp()
        WHERE region_id = $1`,
      [REGION_ID, input.importId]
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
