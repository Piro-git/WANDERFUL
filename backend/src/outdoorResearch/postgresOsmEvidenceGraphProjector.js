import { randomUUID } from "node:crypto";
import {
  exactRelationshipScopeSetMatches,
  exactScopeSetMatches,
  OSM_ALLOWED_ASSERTION_PREDICATES,
  OSM_ASSERTION_POLICY_SCOPES,
  OSM_FORBIDDEN_HIGH_STAKES_PREDICATES,
  OSM_PROJECTION_ADAPTER_VERSION,
  OSM_PROJECTION_OPERATOR_CONFIRMATION,
  OSM_PROJECTION_REGION_IDS,
  OSM_RELATIONSHIP_POLICY_SCOPES,
  OSM_RESEARCH_SOURCE_KEY,
  OSM_SOURCE_CONTRACT,
  OsmProjectionError,
  projectionKey,
  recognizedOsmProjectionPolicy,
  validatedOsmProjectionAcquisition
} from "./osmProjectionPolicy.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REGION_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export class PostgresOsmEvidenceGraphProjector {
  constructor(options = {}) {
    if (!options.pool?.connect || !options.pool?.query) {
      throw new OsmProjectionError("database_unavailable");
    }
    this.pool = options.pool;
    this.now = typeof options.now === "function" ? options.now : () => new Date();
    this.statementTimeoutMs = boundedInteger(
      options.statementTimeoutMs, 120_000, 1_000, 900_000
    );
  }

  async project(input = {}) {
    const request = validateProjectionRequest(input);
    const startedAt = normalizedNow(this.now());
    let selected;
    let runId;
    let key;
    const client = await this.pool.connect();
    try {
      selected = await this.preflight(client, request, startedAt);
      key = projectionKey({
        regionId: request.regionId,
        importId: selected.importId,
        policyVersion: request.policyVersion
      });
      const activeDuplicate = await client.query(
        `SELECT projection_run_id, aggregate_counts, completed_at, duration_milliseconds
           FROM outdoor_research_projection_runs
          WHERE projection_key = $1 AND status = 'active'`,
        [key]
      );
      if (!request.dryRun && activeDuplicate.rowCount === 1) {
        return freezeSummary({
          status: "unchanged",
          projectionRunId: activeDuplicate.rows[0].projection_run_id,
          regionId: request.regionId,
          importId: selected.importId,
          policyVersion: request.policyVersion,
          counts: activeDuplicate.rows[0].aggregate_counts,
          durationMilliseconds: activeDuplicate.rows[0].duration_milliseconds ?? 0
        });
      }

      runId = randomUUID();
      await client.query("BEGIN");
      await client.query("SELECT set_config('statement_timeout', $1, true)", [
        `${this.statementTimeoutMs}ms`
      ]);
      const lockResult = await client.query(
        `SELECT
           pg_try_advisory_xact_lock(hashtextextended($1, 0)) AS import_lock,
           pg_try_advisory_xact_lock(hashtextextended($2, 0)) AS projection_lock`,
        [
          `trailmind-outdoor-import:${request.regionId}`,
          `trailmind-osm-projection:${request.regionId}`
        ]
      );
      if (!lockResult.rows[0]?.import_lock || !lockResult.rows[0]?.projection_lock) {
        throw new OsmProjectionError("concurrent_projection");
      }

      const lockedSelection = await this.preflight(client, request, startedAt);
      if (lockedSelection.importId !== selected.importId) {
        throw new OsmProjectionError("active_import_changed");
      }
      selected = lockedSelection;

      await buildCandidateTables(client, selected, runId);
      await buildQuarantineCandidates(client, selected);
      await assertNoIdentityCollisions(client, selected.sourceId);
      await buildAssertionCandidates(client, {
        runId,
        sourceId: selected.sourceId,
        importId: selected.importId,
        retrievedAt: selected.retrievedAt,
        selected
      });
      await assertNoAssertionCollisions(client, selected.sourceId);
      await buildRelationshipCandidates(client, {
        runId,
        sourceId: selected.sourceId,
        retrievedAt: selected.retrievedAt,
        selected
      });
      await assertNoRelationshipCollisions(client, selected.sourceId);
      await appendMissingRelationshipQuarantines(client, selected);

      if (request.dryRun) {
        const counts = await validateDryProjection(client, {
          selected,
          policy: selected.policy
        });
        const durationMilliseconds = elapsedMilliseconds(
          startedAt, normalizedNow(this.now())
        );
        await client.query("ROLLBACK");
        return freezeSummary({
          status: "dry_run",
          projectionRunId: null,
          regionId: request.regionId,
          importId: selected.importId,
          policyVersion: request.policyVersion,
          counts,
          durationMilliseconds
        });
      }

      await insertProjectionRun(client, {
        runId, key, selected, request, startedAt
      });
      await upsertCanonicalEntities(client, selected.sourceId);
      await insertProjectionEntities(client, {
        runId,
        sourceId: selected.sourceId,
        importId: selected.importId,
        selected
      });
      await insertAssertions(client, {
        runId,
        sourceId: selected.sourceId,
        retrievedAt: selected.retrievedAt
      });
      await insertRelationships(client, {
        runId,
        sourceId: selected.sourceId,
        retrievedAt: selected.retrievedAt
      });
      await insertQuarantines(client, runId);
      const counts = await validateProjection(client, {
        runId,
        selected,
        policy: selected.policy
      });
      const durationMilliseconds = elapsedMilliseconds(startedAt, normalizedNow(this.now()));

      await client.query(
        `UPDATE outdoor_research_projection_runs
            SET status = 'validating', aggregate_counts = $2::jsonb,
                updated_at = clock_timestamp()
          WHERE projection_run_id = $1 AND status = 'loading'`,
        [runId, JSON.stringify(counts)]
      );
      await client.query(
        `UPDATE outdoor_research_projection_runs
            SET status = 'superseded', updated_at = clock_timestamp()
          WHERE source_id = $1 AND region_id = $2
            AND status = 'active' AND projection_run_id <> $3`,
        [selected.sourceId, request.regionId, runId]
      );
      const promoted = await client.query(
        `UPDATE outdoor_research_projection_runs
            SET status = 'active', completed_at = clock_timestamp(),
                duration_milliseconds = $2, aggregate_counts = $3::jsonb,
                updated_at = clock_timestamp()
          WHERE projection_run_id = $1 AND status = 'validating'
          RETURNING projection_run_id`,
        [runId, durationMilliseconds, JSON.stringify(counts)]
      );
      if (promoted.rowCount !== 1) {
        throw new OsmProjectionError("promotion_state_changed");
      }
      await client.query(
        `UPDATE outdoor_research_sources
            SET last_successful_retrieval_at = CASE
                  WHEN last_successful_retrieval_at IS NULL OR
                       last_successful_retrieval_at < $2
                    THEN $2
                  ELSE last_successful_retrieval_at
                END,
                updated_at = clock_timestamp()
          WHERE source_id = $1`,
        [selected.sourceId, selected.retrievedAt]
      );
      await client.query("COMMIT");
      return freezeSummary({
        status: "active",
        projectionRunId: runId,
        regionId: request.regionId,
        importId: selected.importId,
        policyVersion: request.policyVersion,
        counts,
        durationMilliseconds
      });
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch {}
      const safeError = normalizeProjectionError(error);
      if (!request.dryRun && selected && runId && key) {
        try {
          await insertFailedProjectionRun(client, {
            runId,
            key,
            selected,
            request,
            startedAt,
            completedAt: normalizedNow(this.now()),
            failureCode: safeError.code
          });
        } catch {}
      }
      throw safeError;
    } finally {
      client.release();
    }
  }

  async preflight(client, request, now) {
    await ensureProjectionSchema(client);
    const policy = recognizedOsmProjectionPolicy(request.policyVersion);
    if (!policy) throw new OsmProjectionError("unrecognized_policy_version");

    const regionResult = await client.query(
      `SELECT region_id, active_import_id, enabled, freshness_threshold_days
         FROM outdoor_evidence_regions
        WHERE region_id = $1`,
      [request.regionId]
    );
    if (regionResult.rowCount !== 1) throw new OsmProjectionError("unknown_region");
    const region = regionResult.rows[0];
    if (region.enabled !== true) throw new OsmProjectionError("region_disabled");
    const selectedImportId = request.importId ?? region.active_import_id;
    if (!selectedImportId) throw new OsmProjectionError("active_import_unavailable");

    const importResult = await client.query(
      `SELECT import_id, region_id, source_dataset_name, source_identifier,
              source_data_at, retrieved_at, imported_at, status, aggregate_counts,
              acquisition_channel, source_checksum_algorithm, source_checksum,
              source_checksum_verified_at, input_file_sha256
         FROM outdoor_evidence_imports
        WHERE import_id = $1`,
      [selectedImportId]
    );
    if (importResult.rowCount !== 1) throw new OsmProjectionError("import_not_found");
    const importRow = importResult.rows[0];
    if (importRow.region_id !== request.regionId) {
      throw new OsmProjectionError("wrong_region_import");
    }
    if (importRow.status !== "active" || region.active_import_id !== importRow.import_id) {
      throw new OsmProjectionError("inactive_import");
    }
    const acquisition = validatedOsmProjectionAcquisition(importRow);
    if (!importRow.source_data_at || !importRow.retrieved_at || !importRow.imported_at) {
      throw new OsmProjectionError("source_timing_unavailable");
    }
    const sourceDataAt = validDatabaseDate(importRow.source_data_at, "invalid_source_timing");
    const retrievedAt = validDatabaseDate(importRow.retrieved_at, "invalid_source_timing");
    const importedAt = validDatabaseDate(importRow.imported_at, "invalid_source_timing");
    if (sourceDataAt > retrievedAt || retrievedAt > importedAt || importedAt > now) {
      throw new OsmProjectionError("invalid_source_timing");
    }
    let sourceChecksumVerifiedAt = null;
    if (acquisition.sourceChecksumVerifiedAt !== null) {
      sourceChecksumVerifiedAt = validDatabaseDate(
        acquisition.sourceChecksumVerifiedAt, "checksum_verification_invalid"
      );
      if (sourceChecksumVerifiedAt < retrievedAt ||
          sourceChecksumVerifiedAt > importedAt) {
        throw new OsmProjectionError("checksum_verification_invalid");
      }
    }

    const sourcePolicy = await client.query(
      `SELECT source.source_id, source.source_key, source.source_name,
              source.source_category, source.authority_class,
              source.license_identifier, source.attribution_requirements,
              source.canonical_origin, source.normalized_facts_allowed AS source_normalized,
              source.derived_features_allowed AS source_derived,
              source.lifecycle_state AS source_lifecycle,
              source.adapter_schema_version AS source_adapter_version,
              policy.source_policy_id, policy.policy_version,
              policy.policy_schema_version,
              policy.adapter_schema_version AS policy_adapter_version,
              policy.normalized_facts_allowed AS policy_normalized,
              policy.derived_features_allowed AS policy_derived,
              policy.maximum_input_age_days, policy.lifecycle_state AS policy_lifecycle
         FROM outdoor_research_sources source
         LEFT JOIN outdoor_research_source_policies policy
           ON policy.source_id = source.source_id AND policy.policy_version = $2
        WHERE source.source_key = $1`,
      [OSM_RESEARCH_SOURCE_KEY, request.policyVersion]
    );
    if (sourcePolicy.rowCount !== 1) throw new OsmProjectionError("source_policy_missing");
    const source = sourcePolicy.rows[0];
    validateSourceAndPolicy(source, policy);

    const maximumAgeDays = Math.min(
      Number(region.freshness_threshold_days),
      Number(source.maximum_input_age_days),
      policy.maximumInputAgeDays
    );
    if (!Number.isInteger(maximumAgeDays) || maximumAgeDays < 1 ||
        now.getTime() - sourceDataAt.getTime() > maximumAgeDays * 86_400_000 ||
        sourceDataAt > now) {
      throw new OsmProjectionError("stale_import");
    }

    const policyScopes = await client.query(
      `SELECT predicate, entity_category
         FROM outdoor_research_source_policy_scopes
        WHERE source_policy_id = $1 AND lifecycle_state = 'active'`,
      [source.source_policy_id]
    );
    const relationshipScopes = await client.query(
      `SELECT relationship_type, subject_entity_category, object_entity_category
         FROM outdoor_research_source_policy_relationship_scopes
        WHERE source_policy_id = $1 AND lifecycle_state = 'active'`,
      [source.source_policy_id]
    );
    const authorityScopes = await client.query(
      `SELECT predicate, entity_category
         FROM outdoor_research_source_authority_scopes
        WHERE source_id = $1 AND lifecycle_state = 'active'`,
      [source.source_id]
    );
    const inputCounts = await client.query(
      `SELECT
         (SELECT count(*)::integer FROM outdoor_evidence_pois
           WHERE import_id = $1 AND region_id = $2) AS pois,
         (SELECT count(*)::integer FROM outdoor_evidence_trail_segments
           WHERE import_id = $1 AND region_id = $2) AS trails,
         (SELECT count(*)::integer FROM outdoor_evidence_hiking_relations
           WHERE import_id = $1 AND region_id = $2) AS relations,
         (SELECT count(*)::integer FROM outdoor_evidence_hiking_relation_members
           WHERE import_id = $1 AND region_id = $2) AS members`,
      [importRow.import_id, request.regionId]
    );
    const previous = await client.query(
      `SELECT input_retrieved_at
         FROM outdoor_research_projection_runs
        WHERE source_id = $1 AND region_id = $2 AND status = 'active'
        LIMIT 1`,
      [source.source_id, request.regionId]
    );
    if (!exactScopeSetMatches(policyScopes.rows.map(fromScopeRow)) ||
        !exactScopeSetMatches(authorityScopes.rows.map(fromScopeRow))) {
      throw new OsmProjectionError("authority_scope_mismatch");
    }
    if (!exactRelationshipScopeSetMatches(
      relationshipScopes.rows.map(fromRelationshipScopeRow)
    )) {
      throw new OsmProjectionError("relationship_scope_mismatch");
    }
    const counts = normalizedInputCounts(inputCounts.rows[0]);
    if (counts.trails < 1 || counts.pois + counts.trails + counts.relations < 1) {
      throw new OsmProjectionError("empty_import");
    }
    if (previous.rowCount === 1 &&
        retrievedAt < validDatabaseDate(
          previous.rows[0].input_retrieved_at, "invalid_projection_lineage"
        )) {
      throw new OsmProjectionError("non_monotonic_input");
    }
    return Object.freeze({
      sourceId: source.source_id,
      sourcePolicyId: source.source_policy_id,
      policy,
      regionId: request.regionId,
      importId: importRow.import_id,
      sourceDatasetName: acquisition.sourceDatasetName,
      sourceIdentifier: acquisition.sourceIdentifier,
      sourceDataAt: sourceDataAt.toISOString(),
      retrievedAt: retrievedAt.toISOString(),
      importedAt: importedAt.toISOString(),
      acquisitionChannel: acquisition.acquisitionChannel,
      sourceChecksumAlgorithm: acquisition.sourceChecksumAlgorithm,
      sourceChecksum: acquisition.sourceChecksum,
      sourceChecksumVerifiedAt: sourceChecksumVerifiedAt?.toISOString() ?? null,
      inputFileSha256: acquisition.inputFileSha256,
      inputCounts: counts,
      maximumAgeDays
    });
  }
}

async function ensureProjectionSchema(client) {
  const result = await client.query(
    `SELECT
       to_regclass('outdoor_evidence_imports') IS NOT NULL AS imports,
       to_regclass('outdoor_research_source_policies') IS NOT NULL AS policies,
       to_regclass('outdoor_research_projection_runs') IS NOT NULL AS projections,
       to_regclass('outdoor_research_active_assertions') IS NOT NULL AS active_assertions,
       to_regprocedure('outdoor_research_deterministic_uuid_v3(text,text)') IS NOT NULL
         AS deterministic_ids`
  );
  const row = result.rows[0];
  if (!row?.imports || !row?.policies || !row?.projections ||
      !row?.active_assertions || !row?.deterministic_ids) {
    throw new OsmProjectionError("missing_migrations");
  }
}

function validateSourceAndPolicy(row, policy) {
  if (row.source_lifecycle !== "active") {
    throw new OsmProjectionError("source_inactive");
  }
  if (row.source_normalized !== true) {
    throw new OsmProjectionError("normalized_facts_disabled");
  }
  if (row.source_derived !== false) {
    throw new OsmProjectionError("derived_features_must_be_disabled");
  }
  const sourceExact = row.source_key === OSM_SOURCE_CONTRACT.sourceKey &&
    row.source_category === OSM_SOURCE_CONTRACT.sourceCategory &&
    row.authority_class === OSM_SOURCE_CONTRACT.authorityClass &&
    row.license_identifier === OSM_SOURCE_CONTRACT.licenseIdentifier &&
    row.canonical_origin === OSM_SOURCE_CONTRACT.canonicalOrigin &&
    row.attribution_requirements === OSM_SOURCE_CONTRACT.attributionRequirements &&
    row.source_adapter_version === OSM_SOURCE_CONTRACT.adapterSchemaVersion;
  if (!sourceExact) throw new OsmProjectionError("source_contract_mismatch");
  if (!row.source_policy_id || row.policy_lifecycle !== "active") {
    throw new OsmProjectionError("source_policy_inactive");
  }
  const policyExact = row.policy_version === policy.policyVersion &&
    row.policy_schema_version === policy.policySchemaVersion &&
    row.policy_adapter_version === policy.adapterSchemaVersion &&
    row.policy_normalized === true &&
    row.policy_derived === false &&
    row.maximum_input_age_days === policy.maximumInputAgeDays;
  if (!policyExact) throw new OsmProjectionError("source_policy_invalid");
}

async function insertProjectionRun(client, input) {
  await client.query(
    `INSERT INTO outdoor_research_projection_runs
       (projection_run_id, projection_key, source_id, source_policy_id,
        source_policy_version, adapter_schema_version, region_id, input_import_id,
        input_source_dataset_name, input_source_identifier, input_source_data_at,
        input_retrieved_at, input_imported_at, input_acquisition_channel,
        input_source_checksum_algorithm, input_source_checksum,
        input_source_checksum_verified_at, input_file_sha256,
        operator_invoked, started_at, status)
     VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
       $14, $15, $16, $17, $18, true, $19, 'loading'
     )`,
    [
      input.runId, input.key, input.selected.sourceId, input.selected.sourcePolicyId,
      input.request.policyVersion, OSM_PROJECTION_ADAPTER_VERSION,
      input.request.regionId, input.selected.importId,
      input.selected.sourceDatasetName, input.selected.sourceIdentifier,
      input.selected.sourceDataAt, input.selected.retrievedAt, input.selected.importedAt,
      input.selected.acquisitionChannel, input.selected.sourceChecksumAlgorithm,
      input.selected.sourceChecksum, input.selected.sourceChecksumVerifiedAt,
      input.selected.inputFileSha256,
      input.startedAt.toISOString()
    ]
  );
}

async function buildCandidateTables(client, selected, runId) {
  await client.query(
    `CREATE TEMP TABLE tmp_osm_projection_candidates ON COMMIT DROP AS
     SELECT 'poi'::text AS record_kind, poi.osm_type, poi.osm_id,
            CASE poi.category
              WHEN 'viewpoint' THEN 'viewpoint'
              WHEN 'waterfall' THEN 'waterfall'
              WHEN 'peak' THEN 'peak'
              WHEN 'lake' THEN 'lake'
              WHEN 'alpineHut' THEN 'alpine_hut'
              WHEN 'wildernessHut' THEN 'wilderness_hut'
              ELSE NULL
            END::text AS entity_category,
            ST_Force2D(poi.geom)::geometry AS geom,
            poi.source_version, poi.source_timestamp,
            poi.name, NULL::text AS operator,
            NULL::text AS sac_scale, NULL::text AS trail_visibility,
            NULL::text AS access_tag, NULL::text AS foot_tag,
            NULL::text AS access_conditional, NULL::text AS foot_conditional,
            NULL::text AS seasonal_tag, NULL::text AS permit_tag
       FROM outdoor_evidence_pois poi
      WHERE poi.import_id = $1 AND poi.region_id = $2
     UNION ALL
     SELECT 'trail_segment', segment.osm_type, segment.osm_id,
            'trail_segment', ST_Force2D(segment.geom)::geometry,
            segment.source_version, segment.source_timestamp,
            NULL, NULL, segment.sac_scale, segment.trail_visibility,
            segment.access_tag, segment.foot_tag,
            segment.access_conditional, segment.foot_conditional,
            segment.seasonal_tag, segment.permit_tag
       FROM outdoor_evidence_trail_segments segment
      WHERE segment.import_id = $1 AND segment.region_id = $2
     UNION ALL
     SELECT 'hiking_relation', relation.osm_type, relation.osm_id,
            'hiking_route', NULL::geometry,
            relation.source_version, relation.source_timestamp,
            relation.name, relation.operator,
            NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL
       FROM outdoor_evidence_hiking_relations relation
      WHERE relation.import_id = $1 AND relation.region_id = $2`,
    [selected.importId, selected.regionId]
  );
  await client.query(
    `CREATE TEMP TABLE tmp_osm_projection_identity_counts ON COMMIT DROP AS
     SELECT osm_type, osm_id, count(*)::integer AS record_count,
            count(DISTINCT entity_category)::integer AS category_count
       FROM tmp_osm_projection_candidates
      GROUP BY osm_type, osm_id`
  );
  await client.query(
    `CREATE TEMP TABLE tmp_osm_projection_filtered_candidates ON COMMIT DROP AS
     SELECT candidate.*
       FROM tmp_osm_projection_candidates candidate
      WHERE candidate.entity_category IS NOT NULL
        AND candidate.source_version IS NOT NULL
        AND candidate.source_timestamp IS NOT NULL
        AND candidate.source_timestamp <= $1::timestamptz
        AND candidate.source_timestamp <= $2::timestamptz
        AND (
          (candidate.entity_category = 'hiking_route' AND candidate.geom IS NULL) OR
          (
            candidate.geom IS NOT NULL AND ST_SRID(candidate.geom) = 4326 AND
            ST_NDims(candidate.geom) = 2 AND NOT ST_IsEmpty(candidate.geom) AND
            ST_IsValid(candidate.geom) AND
            ST_CoveredBy(
              candidate.geom, ST_MakeEnvelope(-180, -90, 180, 90, 4326)
            )
          )
        )`,
    [selected.retrievedAt, selected.sourceDataAt]
  );
  await client.query(
    "CREATE INDEX tmp_osm_projection_filtered_candidates_identity_idx " +
    "ON tmp_osm_projection_filtered_candidates (osm_type, osm_id)"
  );
  await client.query(
    "CREATE UNIQUE INDEX tmp_osm_projection_identity_counts_identity_idx " +
    "ON tmp_osm_projection_identity_counts (osm_type, osm_id)"
  );
  await client.query("ANALYZE tmp_osm_projection_filtered_candidates");
  await client.query("ANALYZE tmp_osm_projection_identity_counts");
  await client.query(
    `CREATE TEMP TABLE tmp_osm_projection_eligible ON COMMIT DROP AS
     SELECT candidate.*,
            outdoor_research_deterministic_uuid_v3(
              'outdoor-research-entity',
              $1 || ':' || candidate.osm_type || ':' || candidate.osm_id::text
            ) AS entity_id,
            outdoor_research_deterministic_uuid_v3(
              'outdoor-research-source-entity',
              $2::text || ':' || candidate.osm_type || ':' || candidate.osm_id::text
            ) AS source_entity_link_id,
            CASE
              WHEN (
                     candidate.foot_conditional IS NOT NULL AND
                     length(trim(candidate.foot_conditional)) BETWEEN 1 AND 256 AND
                     candidate.foot_conditional !~ '[[:cntrl:]]'
                   ) OR (
                     candidate.access_conditional IS NOT NULL AND
                     length(trim(candidate.access_conditional)) BETWEEN 1 AND 256 AND
                     candidate.access_conditional !~ '[[:cntrl:]]'
                   ) OR lower(trim(candidate.seasonal_tag)) = 'yes'
                THEN 'conditional'
              WHEN lower(trim(COALESCE(candidate.foot_tag, candidate.access_tag))) = 'no'
                THEN 'prohibited'
              WHEN lower(trim(COALESCE(candidate.foot_tag, candidate.access_tag))) = 'permit'
                THEN 'permit_required'
              WHEN lower(trim(COALESCE(candidate.foot_tag, candidate.access_tag))) IN (
                'private', 'customers', 'delivery', 'agricultural',
                'forestry', 'use_sidepath'
              ) THEN 'restricted'
              WHEN lower(trim(candidate.permit_tag)) IN ('yes', 'required')
                THEN 'permit_required'
              ELSE NULL
            END::text AS access_restriction
       FROM tmp_osm_projection_filtered_candidates candidate
       JOIN tmp_osm_projection_identity_counts identity
         USING (osm_type, osm_id)
      WHERE identity.record_count = 1
        AND identity.category_count = 1`,
    [OSM_RESEARCH_SOURCE_KEY, selected.sourceId]
  );
  await client.query(
    "CREATE UNIQUE INDEX tmp_osm_projection_eligible_identity_idx " +
    "ON tmp_osm_projection_eligible (osm_type, osm_id)"
  );
  const eligible = await client.query(
    `SELECT count(*)::integer AS entities,
            count(*) FILTER (WHERE entity_category = 'trail_segment')::integer AS trails
       FROM tmp_osm_projection_eligible`
  );
  if (eligible.rows[0]?.entities < 1 || eligible.rows[0]?.trails < 1) {
    throw new OsmProjectionError("structurally_invalid_input");
  }

  await client.query(
    `CREATE TEMP TABLE tmp_osm_projection_lineage ON COMMIT DROP AS
     SELECT eligible.*,
            jsonb_strip_nulls(jsonb_build_object(
              'source_key', $1::text,
              'evidence_authority', 'OpenStreetMap',
              'acquisition_channel', $2::text,
              'osm_type', eligible.osm_type,
              'osm_id', eligible.osm_id::text,
              'osm_version', eligible.source_version,
              'osm_timestamp', eligible.source_timestamp,
              'input_import_id', $3::text,
              'dataset_name', $4::text,
              'extract_identifier', $5::text,
              'dataset_timestamp', $6::timestamptz,
              'retrieved_at', $7::timestamptz,
              'imported_at', $8::timestamptz,
              'source_checksum_algorithm', $9::text,
              'source_checksum', $10::text,
              'source_checksum_verified_at', $11::timestamptz,
              'input_file_sha256', $12::text,
              'projection_run_id', $13::text,
              'adapter_version', $14::text,
              'license', 'ODbL-1.0',
              'attribution', '© OpenStreetMap contributors'
            )) AS record_provenance
       FROM tmp_osm_projection_eligible eligible`,
    [
      OSM_RESEARCH_SOURCE_KEY, selected.acquisitionChannel, selected.importId,
      selected.sourceDatasetName, selected.sourceIdentifier, selected.sourceDataAt,
      selected.retrievedAt, selected.importedAt, selected.sourceChecksumAlgorithm,
      selected.sourceChecksum, selected.sourceChecksumVerifiedAt,
      selected.inputFileSha256, runId, OSM_PROJECTION_ADAPTER_VERSION
    ]
  );
  await client.query(
    "CREATE INDEX tmp_osm_projection_lineage_identity_idx " +
    "ON tmp_osm_projection_lineage (osm_type, osm_id)"
  );
  await client.query(
    "CREATE INDEX tmp_osm_projection_lineage_entity_idx " +
    "ON tmp_osm_projection_lineage (entity_id)"
  );
  await client.query(
    "CREATE INDEX tmp_osm_projection_lineage_source_link_idx " +
    "ON tmp_osm_projection_lineage (source_entity_link_id)"
  );
  await client.query("ANALYZE tmp_osm_projection_lineage");
}

async function buildQuarantineCandidates(client, selected) {
  await client.query(
    `CREATE TEMP TABLE tmp_osm_projection_quarantine_candidates
       ON COMMIT DROP AS
     SELECT reason_code, record_kind, osm_type, osm_id
       FROM (
         SELECT candidate.record_kind, candidate.osm_type, candidate.osm_id,
                'missing_source_version'::text AS reason_code
           FROM tmp_osm_projection_candidates candidate
          WHERE candidate.source_version IS NULL
         UNION ALL
         SELECT candidate.record_kind, candidate.osm_type, candidate.osm_id,
                'missing_source_timestamp'
           FROM tmp_osm_projection_candidates candidate
          WHERE candidate.source_timestamp IS NULL
         UNION ALL
         SELECT candidate.record_kind, candidate.osm_type, candidate.osm_id,
                'unsupported_category'
           FROM tmp_osm_projection_candidates candidate
          WHERE candidate.entity_category IS NULL
         UNION ALL
         SELECT candidate.record_kind, candidate.osm_type, candidate.osm_id,
                'ambiguous_entity_category'
           FROM tmp_osm_projection_candidates candidate
           JOIN tmp_osm_projection_identity_counts identity USING (osm_type, osm_id)
          WHERE identity.record_count > 1 OR identity.category_count > 1
         UNION ALL
         SELECT candidate.record_kind, candidate.osm_type, candidate.osm_id,
                'invalid_geometry'
           FROM tmp_osm_projection_candidates candidate
          WHERE candidate.entity_category <> 'hiking_route' AND (
            candidate.geom IS NULL OR ST_SRID(candidate.geom) <> 4326 OR
            ST_NDims(candidate.geom) <> 2 OR ST_IsEmpty(candidate.geom) OR
            NOT ST_IsValid(candidate.geom) OR
            NOT ST_CoveredBy(
              candidate.geom, ST_MakeEnvelope(-180, -90, 180, 90, 4326)
            )
          )
         UNION ALL
         SELECT candidate.record_kind, candidate.osm_type, candidate.osm_id,
                'invalid_value'
           FROM tmp_osm_projection_candidates candidate
          WHERE candidate.source_timestamp > $1::timestamptz OR
                candidate.source_timestamp > $2::timestamptz
       ) quarantined`,
    [selected.retrievedAt, selected.sourceDataAt]
  );
  await client.query(
    `CREATE UNIQUE INDEX tmp_osm_projection_quarantine_candidates_cohort_idx
        ON tmp_osm_projection_quarantine_candidates (
          reason_code, record_kind, osm_type, osm_id
        )`
  );
}

async function insertQuarantines(client, runId) {
  await client.query(
    `INSERT INTO outdoor_research_projection_quarantines
       (quarantine_id, projection_run_id, reason_code, record_kind, osm_type, osm_id)
     SELECT outdoor_research_deterministic_uuid_v3(
              'outdoor-research-projection-quarantine',
              $1::text || ':' || reason_code || ':' || record_kind || ':' ||
              osm_type || ':' || osm_id::text
            ),
            $1::uuid, reason_code, record_kind, osm_type, osm_id
       FROM tmp_osm_projection_quarantine_candidates
     ON CONFLICT DO NOTHING`,
    [runId]
  );
}

async function assertNoIdentityCollisions(client, sourceId) {
  const collision = await client.query(
    `WITH candidates AS MATERIALIZED (
       SELECT entity_id, source_entity_link_id, osm_type, osm_id
         FROM tmp_osm_projection_lineage
     ), existing_entities AS MATERIALIZED (
       SELECT entity_id
         FROM outdoor_research_entities
     ), existing_identities AS MATERIALIZED (
       SELECT osm_type, osm_id, entity_id
         FROM outdoor_research_osm_entity_identities
        WHERE source_id = $1
     ), existing_source_links AS MATERIALIZED (
       SELECT source_entity_link_id, entity_id, external_type, external_id,
              matching_status
         FROM outdoor_research_source_entities
        WHERE source_id = $1
     ), existing_candidate_entity_ids AS MATERIALIZED (
       SELECT entity_id FROM candidates
       INTERSECT
       SELECT entity_id FROM existing_entities
     ), exact_identity_entity_ids AS MATERIALIZED (
       SELECT entity_id
         FROM (
           SELECT entity_id, osm_type, osm_id FROM candidates
           INTERSECT
           SELECT entity_id, osm_type, osm_id FROM existing_identities
         ) exact_identity
     )
     SELECT EXISTS (
       SELECT 1 FROM (
         SELECT entity_id FROM existing_candidate_entity_ids
         EXCEPT
         SELECT entity_id FROM exact_identity_entity_ids
       ) missing_identity
     ) OR EXISTS (
       SELECT 1
         FROM candidates candidate
         JOIN existing_identities identity ON identity.entity_id = candidate.entity_id
        WHERE identity.osm_type <> candidate.osm_type OR identity.osm_id <> candidate.osm_id
     ) OR EXISTS (
       SELECT 1
         FROM candidates candidate
         JOIN existing_identities identity
           ON identity.osm_type = candidate.osm_type
          AND identity.osm_id = candidate.osm_id
        WHERE identity.entity_id <> candidate.entity_id
     ) OR EXISTS (
       SELECT 1
         FROM candidates candidate
         JOIN existing_source_links link
           ON link.external_type = candidate.osm_type
          AND link.external_id = candidate.osm_id::text
        WHERE link.entity_id <> candidate.entity_id OR
              link.matching_status <> 'matched' OR
              link.source_entity_link_id <> candidate.source_entity_link_id
     ) OR EXISTS (
       SELECT 1
         FROM candidates candidate
         JOIN existing_source_links link
           ON link.source_entity_link_id = candidate.source_entity_link_id
        WHERE link.entity_id <> candidate.entity_id OR
              link.external_type <> candidate.osm_type OR
              link.external_id <> candidate.osm_id::text OR
              link.matching_status <> 'matched'
     ) AS collided`,
    [sourceId]
  );
  if (collision.rows[0]?.collided) {
    throw new OsmProjectionError("deterministic_identity_collision");
  }
}

async function upsertCanonicalEntities(client, sourceId) {
  await client.query(
    `INSERT INTO outdoor_research_entities
       (entity_id, entity_category, canonical_geometry, lifecycle_state)
     SELECT entity_id, entity_category, geom, 'active'
       FROM tmp_osm_projection_lineage
     ON CONFLICT (entity_id) DO UPDATE
       SET entity_category = EXCLUDED.entity_category,
           canonical_geometry = EXCLUDED.canonical_geometry,
           lifecycle_state = 'active',
           updated_at = clock_timestamp()`
  );
  await client.query(
    `INSERT INTO outdoor_research_osm_entity_identities
       (source_id, osm_type, osm_id, entity_id, deterministic_id_version)
     SELECT $1, osm_type, osm_id, entity_id, 'trailmind-osm-identity-v1'
       FROM tmp_osm_projection_lineage
     ON CONFLICT (source_id, osm_type, osm_id) DO NOTHING`,
    [sourceId]
  );
  await client.query(
    `INSERT INTO outdoor_research_source_entities
       (source_entity_link_id, entity_id, source_id, external_type, external_id,
        matching_status, matching_method, matched_at, review_status)
     SELECT source_entity_link_id, entity_id, $1, osm_type, osm_id::text,
            'matched', 'exact_external_id', clock_timestamp(), 'not_reviewed'
       FROM tmp_osm_projection_lineage
     ON CONFLICT (source_entity_link_id) DO NOTHING`,
    [sourceId]
  );
  const invalid = await client.query(
    `SELECT (
       (SELECT count(*) FROM tmp_osm_projection_lineage) <>
       (
         SELECT count(*)
           FROM tmp_osm_projection_lineage candidate
           JOIN outdoor_research_osm_entity_identities identity
             ON identity.source_id = $1
            AND identity.osm_type = candidate.osm_type
            AND identity.osm_id = candidate.osm_id
            AND identity.entity_id = candidate.entity_id
       )
       OR
       (SELECT count(*) FROM tmp_osm_projection_lineage) <>
       (
         SELECT count(*)
           FROM tmp_osm_projection_lineage candidate
           JOIN outdoor_research_source_entities link
             ON link.source_entity_link_id = candidate.source_entity_link_id
            AND link.entity_id = candidate.entity_id
            AND link.source_id = $1
            AND link.external_type = candidate.osm_type
            AND link.external_id = candidate.osm_id::text
            AND link.matching_status = 'matched'
       )
     ) AS invalid`,
    [sourceId]
  );
  if (invalid.rows[0]?.invalid) throw new OsmProjectionError("identity_invariant_failed");
}

async function insertProjectionEntities(client, input) {
  await client.query(
    `INSERT INTO outdoor_research_projection_entities
       (projection_run_id, source_id, entity_id, source_entity_link_id,
        osm_type, osm_id, entity_category, projected_geometry, source_version,
        source_timestamp, record_provenance)
     SELECT $1, $2, entity_id, source_entity_link_id,
            osm_type, osm_id, entity_category, geom, source_version,
            source_timestamp, record_provenance
       FROM tmp_osm_projection_lineage`,
    [input.runId, input.sourceId]
  );
}

async function buildAssertionCandidates(client, input) {
  await client.query(
    `CREATE TEMP TABLE tmp_osm_assertion_values ON COMMIT DROP AS
     SELECT entity_id, osm_type, osm_id, entity_category, source_version,
            source_timestamp, record_provenance,
            'entity_category'::text AS predicate, 'text'::text AS value_type,
            entity_category::text AS value_text, NULL::boolean AS value_boolean
       FROM tmp_osm_projection_lineage
     UNION ALL
     SELECT entity_id, osm_type, osm_id, entity_category, source_version,
            source_timestamp, record_provenance,
            'name', 'text', trim(name), NULL
       FROM tmp_osm_projection_lineage
      WHERE name IS NOT NULL
        AND length(trim(name)) BETWEEN 1 AND 160
        AND name !~ '[[:cntrl:]]'
     UNION ALL
     SELECT entity_id, osm_type, osm_id, entity_category, source_version,
            source_timestamp, record_provenance,
            'operator', 'text', trim(operator), NULL
       FROM tmp_osm_projection_lineage
      WHERE entity_category = 'hiking_route'
        AND operator IS NOT NULL
        AND length(trim(operator)) BETWEEN 1 AND 160
        AND operator !~ '[[:cntrl:]]'
     UNION ALL
     SELECT entity_id, osm_type, osm_id, entity_category, source_version,
            source_timestamp, record_provenance,
            'trail_difficulty', 'text', sac_scale, NULL
       FROM tmp_osm_projection_lineage
      WHERE entity_category = 'trail_segment' AND sac_scale IN (
        'strolling', 'hiking', 'mountain_hiking', 'demanding_mountain_hiking',
        'alpine_hiking', 'demanding_alpine_hiking', 'difficult_alpine_hiking'
      )
     UNION ALL
     SELECT entity_id, osm_type, osm_id, entity_category, source_version,
            source_timestamp, record_provenance,
            'trail_visibility', 'text', trail_visibility, NULL
       FROM tmp_osm_projection_lineage
      WHERE entity_category = 'trail_segment' AND trail_visibility IN (
        'excellent', 'good', 'intermediate', 'bad', 'horrible', 'no'
      )
     UNION ALL
     SELECT entity_id, osm_type, osm_id, entity_category, source_version,
            source_timestamp, record_provenance,
            'viewpoint_presence', 'boolean', NULL, true
       FROM tmp_osm_projection_lineage WHERE entity_category = 'viewpoint'
     UNION ALL
     SELECT entity_id, osm_type, osm_id, entity_category, source_version,
            source_timestamp, record_provenance,
            'waterfall_presence', 'boolean', NULL, true
       FROM tmp_osm_projection_lineage WHERE entity_category = 'waterfall'
     UNION ALL
     SELECT entity_id, osm_type, osm_id, entity_category, source_version,
            source_timestamp, record_provenance,
            'access_restriction', 'text', access_restriction, NULL
       FROM tmp_osm_projection_lineage
      WHERE entity_category = 'trail_segment' AND access_restriction IS NOT NULL`
  );
  await client.query(
    `CREATE UNIQUE INDEX tmp_osm_assertion_values_cohort_idx
        ON tmp_osm_assertion_values (entity_id, predicate)`
  );
  await client.query(
    `CREATE TEMP TABLE tmp_osm_prior_assertions ON COMMIT DROP AS
     SELECT DISTINCT ON (assertion.entity_id, assertion.predicate)
            assertion.assertion_id, assertion.entity_id, assertion.predicate,
            assertion.value_type, assertion.value_text, assertion.value_boolean
       FROM outdoor_research_active_assertions assertion
       JOIN (
         SELECT DISTINCT entity_id
           FROM tmp_osm_projection_lineage
       ) lineage ON lineage.entity_id = assertion.entity_id
      WHERE assertion.source_id = $1::uuid
      ORDER BY assertion.entity_id, assertion.predicate,
               assertion.retrieved_at DESC, assertion.created_at DESC,
               assertion.assertion_id`,
    [input.sourceId]
  );
  await client.query(
    `CREATE UNIQUE INDEX tmp_osm_prior_assertions_cohort_idx
        ON tmp_osm_prior_assertions (entity_id, predicate)`
  );
  await client.query("ANALYZE tmp_osm_prior_assertions");
  await client.query(
    `CREATE TEMP TABLE tmp_osm_assertion_candidates ON COMMIT DROP AS
     WITH valued AS (
       SELECT value.*,
              prior.assertion_id AS prior_assertion_id,
              (
                prior.assertion_id IS NOT NULL AND
                prior.value_type = value.value_type AND
                prior.value_text IS NOT DISTINCT FROM value.value_text AND
                prior.value_boolean IS NOT DISTINCT FROM value.value_boolean
              ) AS prior_value_same,
              outdoor_research_deterministic_uuid_v3(
                'outdoor-research-assertion-content',
                $1::text || ':' || $2::text || ':' ||
                value.osm_type || ':' || value.osm_id::text || ':' ||
                value.source_version::text || ':' ||
                value.source_timestamp::text || ':' || value.predicate || ':' ||
                COALESCE(value.value_text, value.value_boolean::text)
              ) AS content_assertion_id
         FROM tmp_osm_assertion_values value
         LEFT JOIN tmp_osm_prior_assertions prior
           ON prior.entity_id = value.entity_id
          AND prior.predicate = value.predicate
     )
     SELECT CASE
              WHEN prior_assertion_id IS NOT NULL AND
                   NOT prior_value_same
                THEN outdoor_research_deterministic_uuid_v3(
                  'outdoor-research-assertion-supersession',
                  content_assertion_id::text || ':' || prior_assertion_id::text
                )
              ELSE content_assertion_id
            END AS assertion_id,
            valued.*, false AS is_retraction,
            CASE
              WHEN prior_assertion_id IS NOT NULL AND
                   NOT prior_value_same
                THEN 'supersedes'
              ELSE 'asserted'
            END::text AS assertion_state
       FROM valued`,
    [input.sourceId, input.importId]
  );
  await client.query(
    `INSERT INTO tmp_osm_assertion_candidates
       (assertion_id, entity_id, osm_type, osm_id, entity_category,
        source_version, source_timestamp, record_provenance, predicate,
        value_type, value_text, value_boolean, prior_assertion_id,
        content_assertion_id, is_retraction, assertion_state)
     SELECT outdoor_research_deterministic_uuid_v3(
              'outdoor-research-assertion-retraction',
              $1::text || ':' || $3::text || ':' ||
              lineage.osm_type || ':' || lineage.osm_id::text || ':' ||
              lineage.source_version::text || ':' || prior.predicate || ':' ||
              prior.assertion_id::text
            ),
            lineage.entity_id, lineage.osm_type, lineage.osm_id,
            lineage.entity_category, lineage.source_version, lineage.source_timestamp,
            lineage.record_provenance || jsonb_build_object(
              'retracts_assertion_id', prior.assertion_id::text
            ),
            prior.predicate, prior.value_type, prior.value_text, prior.value_boolean,
            prior.assertion_id, prior.assertion_id, true, 'retracts'
       FROM tmp_osm_projection_lineage lineage
       JOIN tmp_osm_prior_assertions prior
         ON prior.entity_id = lineage.entity_id
       JOIN outdoor_research_source_policy_scopes policy_scope
         ON policy_scope.source_policy_id = $2
        AND policy_scope.entity_category = lineage.entity_category
        AND policy_scope.predicate = prior.predicate
        AND policy_scope.lifecycle_state = 'active'
      WHERE prior.predicate <> 'entity_category'
        AND NOT EXISTS (
          SELECT 1 FROM tmp_osm_assertion_values value
           WHERE value.entity_id = lineage.entity_id
             AND value.predicate = prior.predicate
        )`,
    [input.sourceId, input.selected.sourcePolicyId, input.importId]
  );
  await client.query(
    `CREATE UNIQUE INDEX tmp_osm_assertion_candidates_cohort_idx
        ON tmp_osm_assertion_candidates (entity_id, predicate)`
  );
}

async function assertNoAssertionCollisions(client, sourceId) {
  const collision = await client.query(
    `SELECT EXISTS (
       SELECT 1
         FROM tmp_osm_assertion_candidates candidate
         JOIN outdoor_research_assertions assertion
           ON assertion.assertion_id = candidate.assertion_id
        WHERE assertion.entity_id <> candidate.entity_id OR
              assertion.source_id <> $1 OR
              assertion.predicate <> candidate.predicate OR
              assertion.value_type <> candidate.value_type OR
              assertion.value_text IS DISTINCT FROM candidate.value_text OR
              assertion.value_boolean IS DISTINCT FROM candidate.value_boolean
     ) AS collided`,
    [sourceId]
  );
  if (collision.rows[0]?.collided) {
    throw new OsmProjectionError("deterministic_assertion_collision");
  }
}

async function insertAssertions(client, input) {
  await client.query(
    `INSERT INTO outdoor_research_assertions
       (assertion_id, entity_id, source_id, predicate, value_type,
        value_text, value_boolean, evidence_class, observed_at, retrieved_at,
        freshness_state, provenance_identifier, assertion_state,
        supersedes_assertion_id, resolution_group_key)
     SELECT assertion_id, entity_id, $1, predicate, value_type,
            value_text, value_boolean, 'mapped', source_timestamp, $2,
            'current',
            left(
              'osm:' || osm_type || '/' || osm_id::text || '@' ||
              source_version::text || '#' ||
              CASE WHEN is_retraction THEN 'retract:' ELSE '' END ||
              predicate || ':' || assertion_id::text,
              500
            ),
            assertion_state,
            CASE WHEN assertion_state IN ('supersedes', 'retracts')
              THEN prior_assertion_id ELSE NULL END,
            left('osm:' || osm_type || ':' || osm_id::text || ':' || predicate, 120)
       FROM tmp_osm_assertion_candidates
     ON CONFLICT (assertion_id) DO NOTHING`,
    [input.sourceId, input.retrievedAt]
  );
  await client.query(
    `INSERT INTO outdoor_research_projection_assertions
       (projection_run_id, assertion_id, entity_id, predicate, record_provenance)
     SELECT $1, assertion_id, entity_id, predicate, record_provenance
       FROM tmp_osm_assertion_candidates`,
    [input.runId]
  );
}

async function buildRelationshipCandidates(client, input) {
  await client.query(
    `CREATE TEMP TABLE tmp_osm_relationship_candidates ON COMMIT DROP AS
     SELECT outdoor_research_deterministic_uuid_v3(
              'outdoor-research-osm-membership',
              $2::text || ':' || $1::text || ':relation:' ||
              relation.osm_id::text || ':' ||
              relation.source_version::text || ':' ||
              relation.source_timestamp::text || ':way:' || segment.osm_id::text || ':' ||
              md5(jsonb_agg(jsonb_build_array(
                member.member_role, member.member_sequence
              ) ORDER BY member.member_sequence, member.member_role)::text)
            ) AS relationship_id,
            segment.entity_id AS subject_entity_id,
            relation.entity_id AS object_entity_id,
            'trail_segment_member_of_route'::text AS relationship_type,
            relation.source_timestamp AS observed_at,
            jsonb_strip_nulls(jsonb_build_object(
              'source_key', $3::text,
              'evidence_authority', 'OpenStreetMap',
              'acquisition_channel', $4::text,
              'relation_osm_type', 'relation',
              'relation_osm_id', relation.osm_id::text,
              'relation_osm_version', relation.source_version,
              'relation_osm_timestamp', relation.source_timestamp,
              'segment_osm_type', 'way',
              'segment_osm_id', segment.osm_id::text,
              'segment_osm_version', segment.source_version,
              'member_occurrences', jsonb_agg(jsonb_build_object(
                'role', member.member_role,
                'sequence', member.member_sequence
              ) ORDER BY member.member_sequence, member.member_role),
              'input_import_id', $1::text,
              'dataset_name', $5::text,
              'extract_identifier', $6::text,
              'dataset_timestamp', $7::timestamptz,
              'retrieved_at', $8::timestamptz,
              'imported_at', $9::timestamptz,
              'source_checksum_algorithm', $10::text,
              'source_checksum', $11::text,
              'source_checksum_verified_at', $12::timestamptz,
              'input_file_sha256', $13::text,
              'projection_run_id', $14::text,
              'adapter_version', $15::text,
              'license', 'ODbL-1.0',
              'attribution', '© OpenStreetMap contributors'
            )) AS record_provenance,
            left(
              'osm:relation/' || relation.osm_id::text || '@' ||
              relation.source_version::text || '/member/way/' ||
              segment.osm_id::text,
              500
            ) AS provenance_identifier
       FROM outdoor_evidence_hiking_relation_members member
       JOIN tmp_osm_projection_lineage relation
         ON relation.record_kind = 'hiking_relation'
        AND relation.osm_type = member.relation_osm_type
        AND relation.osm_id = member.relation_osm_id
       JOIN tmp_osm_projection_lineage segment
         ON segment.record_kind = 'trail_segment'
        AND segment.osm_type = member.segment_osm_type
        AND segment.osm_id = member.segment_osm_id
      WHERE member.import_id = $1::uuid AND member.region_id = $16
      GROUP BY relation.osm_id, relation.source_version, relation.source_timestamp,
               relation.entity_id, segment.osm_id, segment.source_version,
               segment.entity_id`,
    [
      input.selected.importId, input.sourceId, OSM_RESEARCH_SOURCE_KEY,
      input.selected.acquisitionChannel, input.selected.sourceDatasetName,
      input.selected.sourceIdentifier, input.selected.sourceDataAt,
      input.selected.retrievedAt, input.selected.importedAt,
      input.selected.sourceChecksumAlgorithm, input.selected.sourceChecksum,
      input.selected.sourceChecksumVerifiedAt, input.selected.inputFileSha256,
      input.runId, OSM_PROJECTION_ADAPTER_VERSION, input.selected.regionId
    ]
  );
  await client.query(
    `CREATE UNIQUE INDEX tmp_osm_relationship_candidates_cohort_idx
        ON tmp_osm_relationship_candidates (
          relationship_type, subject_entity_id, object_entity_id
        )`
  );
}

async function assertNoRelationshipCollisions(client, sourceId) {
  const collision = await client.query(
    `SELECT EXISTS (
       SELECT 1
         FROM tmp_osm_relationship_candidates candidate
         JOIN outdoor_research_relationships relationship
           ON relationship.relationship_id = candidate.relationship_id
        WHERE relationship.source_id <> $1 OR
              relationship.relationship_type <> candidate.relationship_type OR
              relationship.subject_entity_id <> candidate.subject_entity_id OR
              relationship.object_entity_id <> candidate.object_entity_id
     ) AS collided`,
    [sourceId]
  );
  if (collision.rows[0]?.collided) {
    throw new OsmProjectionError("deterministic_relationship_collision");
  }
}

async function insertRelationships(client, input) {
  await client.query(
    `INSERT INTO outdoor_research_relationships
       (relationship_id, relationship_type, subject_entity_id, object_entity_id,
        source_id, evidence_class, provenance_identifier, observed_at,
        retrieved_at, freshness_state)
     SELECT relationship_id, relationship_type, subject_entity_id, object_entity_id,
            $1, 'mapped', provenance_identifier, observed_at, $2, 'current'
       FROM tmp_osm_relationship_candidates
     ON CONFLICT (relationship_id) DO NOTHING`,
    [input.sourceId, input.retrievedAt]
  );
  await client.query(
    `INSERT INTO outdoor_research_projection_relationships
       (projection_run_id, relationship_id, subject_entity_id, object_entity_id,
        relationship_type, record_provenance)
     SELECT $1, relationship_id, subject_entity_id, object_entity_id,
            relationship_type, record_provenance
       FROM tmp_osm_relationship_candidates`,
    [input.runId]
  );
}

async function appendMissingRelationshipQuarantines(client, selected) {
  await client.query(
    `INSERT INTO tmp_osm_projection_quarantine_candidates
       (reason_code, record_kind, osm_type, osm_id)
     SELECT DISTINCT
            'missing_related_entity', 'hiking_relation_member',
            'relation', member.relation_osm_id
       FROM outdoor_evidence_hiking_relation_members member
      WHERE member.import_id = $1 AND member.region_id = $2
        AND NOT EXISTS (
          SELECT 1 FROM tmp_osm_relationship_candidates relationship
           JOIN tmp_osm_projection_lineage relation
             ON relation.entity_id = relationship.object_entity_id
           JOIN tmp_osm_projection_lineage segment
             ON segment.entity_id = relationship.subject_entity_id
          WHERE relation.osm_id = member.relation_osm_id
            AND segment.osm_id = member.segment_osm_id
        )
     ON CONFLICT DO NOTHING`,
    [selected.importId, selected.regionId]
  );
}

async function validateDryProjection(client, input) {
  const result = await client.query(
    `SELECT
       (SELECT count(*)::integer FROM tmp_osm_projection_lineage) AS entities,
       (SELECT count(*)::integer FROM tmp_osm_projection_lineage
         WHERE entity_category = 'trail_segment') AS trail_segments,
       (SELECT count(*)::integer FROM tmp_osm_projection_lineage
         WHERE entity_category = 'hiking_route') AS hiking_routes,
       (SELECT count(*)::integer FROM tmp_osm_projection_lineage
         WHERE entity_category NOT IN ('trail_segment', 'hiking_route')) AS pois,
       (SELECT count(*)::integer FROM tmp_osm_assertion_candidates) AS assertions,
       (SELECT count(*)::integer FROM tmp_osm_assertion_candidates
         WHERE assertion_state = 'retracts') AS retractions,
       (SELECT count(*)::integer FROM tmp_osm_relationship_candidates)
         AS relationships,
       (SELECT count(*)::integer FROM tmp_osm_projection_quarantine_candidates)
         AS quarantined,
       (SELECT count(*)::integer
          FROM (
            SELECT DISTINCT record_kind, osm_type, osm_id
              FROM tmp_osm_projection_quarantine_candidates
             WHERE record_kind <> 'hiking_relation_member'
          ) quarantined_entity) AS quarantined_entity_rows,
       (SELECT count(*)::integer FROM tmp_osm_projection_lineage)
         AS stable_source_links,
       (SELECT count(*)::integer
          FROM tmp_osm_assertion_candidates assertion
         WHERE assertion.predicate = ANY($1::text[]) OR
               NOT (assertion.predicate = ANY($2::text[]))) AS forbidden_assertions,
       (SELECT count(*)::integer
          FROM tmp_osm_projection_lineage entity
         WHERE NOT (
           entity.record_provenance ?& ARRAY[
             'source_key', 'evidence_authority', 'acquisition_channel',
             'osm_type', 'osm_id', 'osm_version', 'osm_timestamp',
             'input_import_id', 'dataset_name', 'extract_identifier',
             'dataset_timestamp', 'retrieved_at', 'imported_at',
             'input_file_sha256', 'projection_run_id', 'license', 'attribution'
           ]
         ) OR (
           entity.record_provenance->>'acquisition_channel' =
             'geofabrik_regional_extract' AND
           NOT (entity.record_provenance ?& ARRAY[
             'source_checksum_algorithm', 'source_checksum',
             'source_checksum_verified_at'
           ])
         )) AS incomplete_provenance,
       (SELECT count(*)::integer
          FROM tmp_osm_relationship_candidates relationship
         WHERE NOT (
           relationship.record_provenance ?& ARRAY[
             'source_key', 'evidence_authority', 'acquisition_channel',
             'input_import_id', 'dataset_name', 'extract_identifier',
             'dataset_timestamp', 'retrieved_at', 'imported_at',
             'input_file_sha256', 'projection_run_id', 'license', 'attribution'
           ]
         ) OR (
           relationship.record_provenance->>'acquisition_channel' =
             'geofabrik_regional_extract' AND
           NOT (relationship.record_provenance ?& ARRAY[
             'source_checksum_algorithm', 'source_checksum',
             'source_checksum_verified_at'
           ])
         )) AS incomplete_relationship_provenance,
       (SELECT count(*)::integer
          FROM tmp_osm_projection_lineage entity
         WHERE NOT EXISTS (
           SELECT 1
             FROM tmp_osm_assertion_candidates assertion
            WHERE assertion.entity_id = entity.entity_id
              AND assertion.predicate = 'entity_category'
              AND assertion.assertion_state <> 'retracts'
         )) AS missing_category_assertions,
       (SELECT count(*)::integer
          FROM tmp_osm_assertion_candidates candidate
          LEFT JOIN outdoor_research_assertions target
            ON target.assertion_id = candidate.prior_assertion_id
         WHERE candidate.assertion_state IN ('supersedes', 'retracts') AND (
           target.assertion_id IS NULL OR
           target.entity_id <> candidate.entity_id OR
           target.predicate <> candidate.predicate OR
           target.source_id <> $3::uuid OR
           target.assertion_state = 'retracts' OR
           target.retrieved_at > $4::timestamptz OR
           (
             target.observed_at IS NOT NULL AND
             candidate.source_timestamp < target.observed_at
           )
         )) AS invalid_dry_assertions`,
    [
      OSM_FORBIDDEN_HIGH_STAKES_PREDICATES, OSM_ALLOWED_ASSERTION_PREDICATES,
      input.selected.sourceId, input.selected.retrievedAt
    ]
  );
  return validatedProjectionCounts(result.rows[0], input);
}

async function validateProjection(client, input) {
  const result = await client.query(
    `SELECT
       (SELECT count(*)::integer FROM tmp_osm_projection_lineage) AS entities,
       (SELECT count(*)::integer FROM tmp_osm_projection_lineage
         WHERE entity_category = 'trail_segment') AS trail_segments,
       (SELECT count(*)::integer FROM tmp_osm_projection_lineage
         WHERE entity_category = 'hiking_route') AS hiking_routes,
       (SELECT count(*)::integer FROM tmp_osm_projection_lineage
         WHERE entity_category NOT IN ('trail_segment', 'hiking_route')) AS pois,
       (SELECT count(*)::integer
          FROM outdoor_research_projection_assertions
         WHERE projection_run_id = $1) AS assertions,
       (SELECT count(*)::integer
          FROM outdoor_research_projection_assertions projection
          JOIN outdoor_research_assertions assertion
            ON assertion.assertion_id = projection.assertion_id
         WHERE projection.projection_run_id = $1
           AND assertion.assertion_state = 'retracts') AS retractions,
       (SELECT count(*)::integer
          FROM outdoor_research_projection_relationships
         WHERE projection_run_id = $1) AS relationships,
       (SELECT count(*)::integer
          FROM outdoor_research_projection_quarantines
         WHERE projection_run_id = $1) AS quarantined,
       (SELECT count(*)::integer
          FROM (
            SELECT DISTINCT record_kind, osm_type, osm_id
              FROM outdoor_research_projection_quarantines
             WHERE projection_run_id = $1
               AND record_kind <> 'hiking_relation_member'
          ) quarantined_entity) AS quarantined_entity_rows,
       (SELECT count(*)::integer
          FROM outdoor_research_source_entities source_entity
          JOIN outdoor_research_projection_entities projection
            ON projection.source_entity_link_id = source_entity.source_entity_link_id
         WHERE projection.projection_run_id = $1
           AND source_entity.matching_status = 'matched') AS stable_source_links,
       (SELECT count(*)::integer
          FROM outdoor_research_projection_assertions projection
          JOIN outdoor_research_assertions assertion
            ON assertion.assertion_id = projection.assertion_id
         WHERE projection.projection_run_id = $1
           AND (
             assertion.source_id <> $2 OR assertion.evidence_class <> 'mapped' OR
             assertion.predicate = ANY($3::text[]) OR
             NOT (assertion.predicate = ANY($4::text[]))
           )) AS forbidden_assertions,
       (SELECT count(*)::integer
          FROM outdoor_research_projection_entities entity
         WHERE entity.projection_run_id = $1
           AND (
             NOT (entity.record_provenance ?& ARRAY[
               'source_key', 'evidence_authority', 'acquisition_channel',
               'osm_type', 'osm_id', 'osm_version', 'osm_timestamp',
               'input_import_id', 'dataset_name', 'extract_identifier',
               'dataset_timestamp', 'retrieved_at', 'imported_at',
               'input_file_sha256', 'projection_run_id', 'license', 'attribution'
             ]) OR (
               entity.record_provenance->>'acquisition_channel' =
                 'geofabrik_regional_extract' AND
               NOT (entity.record_provenance ?& ARRAY[
                 'source_checksum_algorithm', 'source_checksum',
                 'source_checksum_verified_at'
               ])
             )
           )) AS incomplete_provenance,
       (SELECT count(*)::integer
          FROM outdoor_research_projection_relationships relationship
         WHERE relationship.projection_run_id = $1
           AND (
             NOT (relationship.record_provenance ?& ARRAY[
               'source_key', 'evidence_authority', 'acquisition_channel',
               'input_import_id', 'dataset_name', 'extract_identifier',
               'dataset_timestamp', 'retrieved_at', 'imported_at',
               'input_file_sha256', 'projection_run_id', 'license', 'attribution'
             ]) OR (
               relationship.record_provenance->>'acquisition_channel' =
                 'geofabrik_regional_extract' AND
               NOT (relationship.record_provenance ?& ARRAY[
                 'source_checksum_algorithm', 'source_checksum',
                 'source_checksum_verified_at'
               ])
             )
           )) AS incomplete_relationship_provenance,
       (SELECT count(*)::integer
          FROM tmp_osm_projection_lineage entity
         WHERE NOT EXISTS (
           SELECT 1
             FROM outdoor_research_projection_assertions projection
             JOIN outdoor_research_assertions assertion
               ON assertion.assertion_id = projection.assertion_id
            WHERE projection.projection_run_id = $1
              AND projection.entity_id = entity.entity_id
              AND assertion.predicate = 'entity_category'
              AND assertion.assertion_state <> 'retracts'
         )) AS missing_category_assertions`,
    [
      input.runId, input.selected.sourceId,
      OSM_FORBIDDEN_HIGH_STAKES_PREDICATES, OSM_ALLOWED_ASSERTION_PREDICATES
    ]
  );
  return validatedProjectionCounts(result.rows[0], input);
}

function validatedProjectionCounts(row, input) {
  const counts = Object.freeze({
    input: input.selected.inputCounts,
    entities: integerCount(row.entities),
    pois: integerCount(row.pois),
    trailSegments: integerCount(row.trail_segments),
    hikingRoutes: integerCount(row.hiking_routes),
    assertions: integerCount(row.assertions),
    retractions: integerCount(row.retractions),
    relationships: integerCount(row.relationships),
    quarantined: integerCount(row.quarantined),
    stableSourceLinks: integerCount(row.stable_source_links)
  });
  if (counts.entities < 1 || counts.trailSegments < 1 ||
      counts.stableSourceLinks !== counts.entities ||
      Number(row.forbidden_assertions) !== 0 ||
      Number(row.incomplete_provenance) !== 0 ||
      Number(row.incomplete_relationship_provenance) !== 0 ||
      Number(row.missing_category_assertions) !== 0 ||
      Number(row.invalid_dry_assertions ?? 0) !== 0) {
    throw new OsmProjectionError("projection_invariant_failed");
  }
  const projectedEntityRows = counts.entities + integerCount(row.quarantined_entity_rows);
  const inputEntityRows = input.selected.inputCounts.pois +
    input.selected.inputCounts.trails + input.selected.inputCounts.relations;
  if (projectedEntityRows !== inputEntityRows) {
    throw new OsmProjectionError("projection_count_mismatch");
  }
  return counts;
}

async function insertFailedProjectionRun(client, input) {
  const durationMilliseconds = elapsedMilliseconds(input.startedAt, input.completedAt);
  await client.query(
    `INSERT INTO outdoor_research_projection_runs
       (projection_run_id, projection_key, source_id, source_policy_id,
        source_policy_version, adapter_schema_version, region_id, input_import_id,
        input_source_dataset_name, input_source_identifier, input_source_data_at,
        input_retrieved_at, input_imported_at, input_acquisition_channel,
        input_source_checksum_algorithm, input_source_checksum,
        input_source_checksum_verified_at, input_file_sha256,
        operator_invoked, started_at, completed_at, duration_milliseconds,
        status, failure_code)
     VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
       $14, $15, $16, $17, $18, true, $19, $20, $21, 'failed', $22
     )
     ON CONFLICT (projection_run_id) DO NOTHING`,
    [
      input.runId, input.key, input.selected.sourceId, input.selected.sourcePolicyId,
      input.request.policyVersion, OSM_PROJECTION_ADAPTER_VERSION,
      input.request.regionId, input.selected.importId,
      input.selected.sourceDatasetName, input.selected.sourceIdentifier,
      input.selected.sourceDataAt, input.selected.retrievedAt, input.selected.importedAt,
      input.selected.acquisitionChannel, input.selected.sourceChecksumAlgorithm,
      input.selected.sourceChecksum, input.selected.sourceChecksumVerifiedAt,
      input.selected.inputFileSha256,
      input.startedAt.toISOString(), input.completedAt.toISOString(),
      durationMilliseconds, input.failureCode
    ]
  );
}

function validateProjectionRequest(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new OsmProjectionError("invalid_projection_request");
  }
  const allowed = new Set([
    "regionId", "importId", "policyVersion", "operatorConfirmation", "dryRun"
  ]);
  if (Object.keys(input).some((key) => !allowed.has(key))) {
    throw new OsmProjectionError("invalid_projection_request");
  }
  if (typeof input.regionId !== "string" || !REGION_PATTERN.test(input.regionId)) {
    throw new OsmProjectionError("invalid_region");
  }
  if (!OSM_PROJECTION_REGION_IDS.includes(input.regionId)) {
    throw new OsmProjectionError("unsupported_region");
  }
  if (input.importId !== undefined &&
      (typeof input.importId !== "string" || !UUID_PATTERN.test(input.importId))) {
    throw new OsmProjectionError("invalid_import_id");
  }
  if (typeof input.policyVersion !== "string" ||
      !recognizedOsmProjectionPolicy(input.policyVersion)) {
    throw new OsmProjectionError("unrecognized_policy_version");
  }
  if (input.operatorConfirmation !== OSM_PROJECTION_OPERATOR_CONFIRMATION) {
    throw new OsmProjectionError("operator_confirmation_required");
  }
  if (typeof input.dryRun !== "boolean") {
    throw new OsmProjectionError("invalid_dry_run");
  }
  return Object.freeze({ ...input });
}

function normalizeProjectionError(error) {
  if (error instanceof OsmProjectionError) return error;
  if (error?.code === "57014") {
    return new OsmProjectionError("projection_timed_out", { cause: error });
  }
  if (error?.code === "23505" || error?.code === "23514" || error?.code === "23503") {
    return new OsmProjectionError("projection_invariant_failed", { cause: error });
  }
  return new OsmProjectionError("projection_failed", { cause: error });
}

function normalizedNow(value) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new OsmProjectionError("invalid_clock");
  return date;
}

function validDatabaseDate(value, code) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new OsmProjectionError(code);
  return date;
}

function normalizedInputCounts(row) {
  const counts = {
    pois: integerCount(row?.pois),
    trails: integerCount(row?.trails),
    relations: integerCount(row?.relations),
    members: integerCount(row?.members)
  };
  return Object.freeze(counts);
}

function integerCount(value) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) {
    throw new OsmProjectionError("invalid_aggregate_count");
  }
  return number;
}

function elapsedMilliseconds(start, end) {
  return Math.max(0, Math.min(2_147_483_647, end.getTime() - start.getTime()));
}

function boundedInteger(value, fallback, minimum, maximum) {
  if (value === undefined) return fallback;
  const number = Number(value);
  return Number.isInteger(number) && number >= minimum && number <= maximum
    ? number
    : fallback;
}

function fromScopeRow(row) {
  return { predicate: row.predicate, entityCategory: row.entity_category };
}

function fromRelationshipScopeRow(row) {
  return {
    relationshipType: row.relationship_type,
    subjectEntityCategory: row.subject_entity_category,
    objectEntityCategory: row.object_entity_category
  };
}

function freezeSummary(summary) {
  return Object.freeze({
    schemaVersion: 1,
    adapterVersion: OSM_PROJECTION_ADAPTER_VERSION,
    ...summary
  });
}

export const osmProjectionPolicyScopesForTesting = Object.freeze({
  assertions: OSM_ASSERTION_POLICY_SCOPES,
  relationships: OSM_RELATIONSHIP_POLICY_SCOPES
});
