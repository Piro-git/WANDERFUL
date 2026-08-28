import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

const projectorURL = new URL(
  "../src/outdoorResearch/postgresOsmEvidenceGraphProjector.js",
  import.meta.url
);

describe("OSM projection candidate preparation", () => {
  it("validates dry runs before any persistent projection write", async () => {
    const source = await readFile(projectorURL, "utf8");
    const projectStart = source.indexOf("  async project(input = {})");
    const preflightStart = source.indexOf("  async preflight(", projectStart);
    const project = source.slice(projectStart, preflightStart);
    const dryBranch = project.indexOf("if (request.dryRun)");
    const dryValidation = project.indexOf("validateDryProjection", dryBranch);
    const dryRollback = project.indexOf('client.query("ROLLBACK")', dryBranch);
    const firstPersistentWrite = project.indexOf("insertProjectionRun", dryBranch);

    for (const position of [
      projectStart,
      preflightStart,
      dryBranch,
      dryValidation,
      dryRollback,
      firstPersistentWrite
    ]) {
      assert.notEqual(position, -1);
    }
    assert(
      dryBranch < dryValidation &&
      dryValidation < dryRollback &&
      dryRollback < firstPersistentWrite
    );
    for (const write of [
      "upsertCanonicalEntities",
      "insertProjectionEntities",
      "insertAssertions",
      "insertRelationships",
      "insertQuarantines"
    ]) {
      assert(project.indexOf(write, dryBranch) > dryRollback);
    }
    assert.doesNotMatch(project, /VACUUM/i);
  });

  it("uses the shared import advisory lock without requiring input-table update privileges", async () => {
    const source = await readFile(projectorURL, "utf8");
    const projectStart = source.indexOf("  async project(input = {})");
    const preflightStart = source.indexOf("  async preflight(", projectStart);
    const project = source.slice(projectStart, preflightStart);
    const preflight = source.slice(preflightStart);

    assert.match(project, /trailmind-outdoor-import:/);
    assert.match(project, /pg_try_advisory_xact_lock/);
    assert.match(project, /active_import_changed/);
    assert.doesNotMatch(preflight, /FOR\s+(?:KEY\s+)?(?:SHARE|UPDATE)/i);
  });

  it("materializes and analyzes filtered candidates before the identity join", async () => {
    const source = await readFile(projectorURL, "utf8");
    const filteredTable = source.indexOf(
      "CREATE TEMP TABLE tmp_osm_projection_filtered_candidates"
    );
    const filteredIndex = source.indexOf(
      "CREATE INDEX tmp_osm_projection_filtered_candidates_identity_idx"
    );
    const identityIndex = source.indexOf(
      "CREATE UNIQUE INDEX tmp_osm_projection_identity_counts_identity_idx"
    );
    const filteredAnalyze = source.indexOf(
      "ANALYZE tmp_osm_projection_filtered_candidates"
    );
    const identityAnalyze = source.indexOf(
      "ANALYZE tmp_osm_projection_identity_counts"
    );
    const eligibleTable = source.indexOf(
      "CREATE TEMP TABLE tmp_osm_projection_eligible"
    );

    for (const position of [
      filteredTable,
      filteredIndex,
      identityIndex,
      filteredAnalyze,
      identityAnalyze,
      eligibleTable
    ]) {
      assert.notEqual(position, -1);
    }
    assert(
      filteredTable < filteredIndex &&
      filteredIndex < identityIndex &&
      identityIndex < filteredAnalyze &&
      filteredAnalyze < identityAnalyze &&
      identityAnalyze < eligibleTable
    );

    const filteredQuery = source.slice(filteredTable, filteredIndex);
    assert.match(filteredQuery, /candidate\.entity_category IS NOT NULL/);
    assert.match(filteredQuery, /candidate\.source_version IS NOT NULL/);
    assert.match(filteredQuery, /candidate\.source_timestamp IS NOT NULL/);
    assert.match(filteredQuery, /candidate\.source_timestamp <= \$1::timestamptz/);
    assert.match(filteredQuery, /candidate\.source_timestamp <= \$2::timestamptz/);
    assert.match(
      filteredQuery,
      /candidate\.entity_category = 'hiking_route' AND candidate\.geom IS NULL/
    );
    assert.match(filteredQuery, /ST_IsValid\(candidate\.geom\)/);
    assert.match(filteredQuery, /ST_CoveredBy\(/);
    assert.match(
      filteredQuery,
      /ST_MakeEnvelope\(-180, -90, 180, 90, 4326\)/
    );

    const eligibleQuery = source.slice(
      eligibleTable,
      source.indexOf(
        "CREATE UNIQUE INDEX tmp_osm_projection_eligible_identity_idx"
      )
    );
    assert.match(
      eligibleQuery,
      /FROM tmp_osm_projection_filtered_candidates candidate/
    );
    assert.match(
      eligibleQuery,
      /JOIN tmp_osm_projection_identity_counts identity/
    );
    assert.match(eligibleQuery, /identity\.record_count = 1/);
    assert.match(eligibleQuery, /identity\.category_count = 1/);
    assert.doesNotMatch(eligibleQuery, /ST_IsValid|ST_CoveredBy/);
  });

  it("indexes and analyzes lineage before persistent identity checks", async () => {
    const source = await readFile(projectorURL, "utf8");
    const lineageTable = source.indexOf(
      "CREATE TEMP TABLE tmp_osm_projection_lineage"
    );
    const identityIndex = source.indexOf(
      "CREATE INDEX tmp_osm_projection_lineage_identity_idx"
    );
    const entityIndex = source.indexOf(
      "CREATE INDEX tmp_osm_projection_lineage_entity_idx"
    );
    const sourceLinkIndex = source.indexOf(
      "CREATE INDEX tmp_osm_projection_lineage_source_link_idx"
    );
    const lineageAnalyze = source.indexOf(
      "ANALYZE tmp_osm_projection_lineage"
    );
    const collisionCheck = source.indexOf(
      "async function assertNoIdentityCollisions"
    );

    for (const position of [
      lineageTable,
      identityIndex,
      entityIndex,
      sourceLinkIndex,
      lineageAnalyze,
      collisionCheck
    ]) {
      assert.notEqual(position, -1);
    }
    assert(
      lineageTable < identityIndex &&
      identityIndex < entityIndex &&
      entityIndex < sourceLinkIndex &&
      sourceLinkIndex < lineageAnalyze &&
      lineageAnalyze < collisionCheck
    );

    const persistentIdentityCheck = source.slice(
      source.indexOf("const invalid = await client.query"),
      source.indexOf(
        "if (invalid.rows[0]?.invalid)",
        source.indexOf("const invalid = await client.query")
      )
    );
    assert.match(
      persistentIdentityCheck,
      /SELECT count\(\*\)\s+FROM tmp_osm_projection_lineage candidate\s+JOIN outdoor_research_osm_entity_identities/
    );
    assert.match(
      persistentIdentityCheck,
      /SELECT count\(\*\)\s+FROM tmp_osm_projection_lineage candidate\s+JOIN outdoor_research_source_entities/
    );
    assert.doesNotMatch(persistentIdentityCheck, /LEFT JOIN/);
  });

  it("checks existing identities with materialized set operations", async () => {
    const source = await readFile(projectorURL, "utf8");
    const collisionStart = source.indexOf(
      "async function assertNoIdentityCollisions"
    );
    const canonicalWriteStart = source.indexOf(
      "async function upsertCanonicalEntities",
      collisionStart
    );
    const collisionCheck = source.slice(collisionStart, canonicalWriteStart);

    assert.match(collisionCheck, /candidates AS MATERIALIZED/);
    assert.match(collisionCheck, /existing_entities AS MATERIALIZED/);
    assert.match(collisionCheck, /existing_identities AS MATERIALIZED/);
    assert.match(collisionCheck, /existing_source_links AS MATERIALIZED/);
    assert.match(collisionCheck, /WHERE source_id = \$1/);
    assert.match(collisionCheck, /INTERSECT/);
    assert.match(collisionCheck, /EXCEPT/);
    assert.doesNotMatch(collisionCheck, /LEFT JOIN/);
  });

  it("materializes each latest active assertion once before candidate joins", async () => {
    const source = await readFile(projectorURL, "utf8");
    const priorTable = source.indexOf(
      "CREATE TEMP TABLE tmp_osm_prior_assertions"
    );
    const distinctLatest = source.indexOf(
      "SELECT DISTINCT ON (assertion.entity_id, assertion.predicate)",
      priorTable
    );
    const exactOrder = source.indexOf(
      "assertion.retrieved_at DESC, assertion.created_at DESC",
      priorTable
    );
    const priorIndex = source.indexOf(
      "CREATE UNIQUE INDEX tmp_osm_prior_assertions_cohort_idx"
    );
    const priorAnalyze = source.indexOf(
      "ANALYZE tmp_osm_prior_assertions"
    );
    const candidateTable = source.indexOf(
      "CREATE TEMP TABLE tmp_osm_assertion_candidates"
    );

    for (const position of [
      priorTable,
      distinctLatest,
      exactOrder,
      priorIndex,
      priorAnalyze,
      candidateTable
    ]) {
      assert.notEqual(position, -1);
    }
    assert(
      priorTable < distinctLatest &&
      distinctLatest < exactOrder &&
      exactOrder < priorIndex &&
      priorIndex < priorAnalyze &&
      priorAnalyze < candidateTable
    );

    const assertionCandidateSection = source.slice(
      candidateTable,
      source.indexOf("async function insertAssertions")
    );
    assert.match(
      assertionCandidateSection,
      /LEFT JOIN tmp_osm_prior_assertions prior/
    );
    assert.match(
      assertionCandidateSection,
      /JOIN tmp_osm_prior_assertions prior/
    );
    assert.doesNotMatch(
      assertionCandidateSection,
      /JOIN outdoor_research_active_assertions prior/
    );
  });
});
