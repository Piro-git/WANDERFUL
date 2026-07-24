import {
  deterministicUuidV3,
  exactRelationshipScopeSetMatches,
  exactScopeSetMatches,
  OSM_POLICY_ACTIVATION_CONFIRMATION,
  OSM_POLICY_REVOCATION_CONFIRMATION,
  OSM_RESEARCH_SOURCE_KEY,
  OSM_SOURCE_CONTRACT,
  OsmProjectionError,
  recognizedOsmProjectionPolicy,
  strictUtcPolicyTimestamp
} from "./osmProjectionPolicy.js";

export async function configureOsmProjectionPolicy(options = {}) {
  const pool = options.pool;
  if (!pool?.connect) throw new OsmProjectionError("database_unavailable");
  const mode = options.mode;
  if (!new Set(["activate", "revoke"]).has(mode)) {
    throw new OsmProjectionError("invalid_policy_operation");
  }
  const policy = recognizedOsmProjectionPolicy(options.policyVersion);
  if (!policy) throw new OsmProjectionError("unrecognized_policy_version");
  const expectedConfirmation = mode === "activate"
    ? OSM_POLICY_ACTIVATION_CONFIRMATION
    : OSM_POLICY_REVOCATION_CONFIRMATION;
  if (options.operatorConfirmation !== expectedConfirmation) {
    throw new OsmProjectionError("operator_confirmation_required");
  }
  const reviewReference = reviewedText(options.reviewReference, 500, "invalid_review_reference");
  const reviewedAt = strictUtcPolicyTimestamp(options.reviewedAt, options.now);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('statement_timeout', '10000ms', true)");
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      [`trailmind-osm-policy:${OSM_RESEARCH_SOURCE_KEY}`]
    );
    await ensurePolicySchema(client);
    if (mode === "revoke") {
      const revoked = await client.query(
        `UPDATE outdoor_research_source_policies policy
            SET lifecycle_state = 'retired', retirement_reference = $3,
                retired_at = $4, updated_at = clock_timestamp()
           FROM outdoor_research_sources source
          WHERE source.source_id = policy.source_id
            AND source.source_key = $1
            AND policy.policy_version = $2
            AND policy.lifecycle_state = 'active'
          RETURNING policy.source_policy_id, policy.source_id`,
        [
          OSM_RESEARCH_SOURCE_KEY, policy.policyVersion,
          reviewReference, reviewedAt
        ]
      );
      if (revoked.rowCount !== 1) throw new OsmProjectionError("active_policy_not_found");
      const retiredPolicyId = revoked.rows[0].source_policy_id;
      const sourceId = revoked.rows[0].source_id;
      await client.query(
        `UPDATE outdoor_research_source_policy_scopes
            SET lifecycle_state = 'retired'
          WHERE source_policy_id = $1 AND lifecycle_state = 'active'`,
        [retiredPolicyId]
      );
      await client.query(
        `UPDATE outdoor_research_source_policy_relationship_scopes
            SET lifecycle_state = 'retired'
          WHERE source_policy_id = $1 AND lifecycle_state = 'active'`,
        [retiredPolicyId]
      );
      const remainingPolicies = await activeReviewedPolicies(client, sourceId);
      const requiredAuthorityScopes = remainingPolicies.flatMap(
        ({ policy: activePolicy }) => activePolicy.assertionScopes
      );
      await client.query(
        `UPDATE outdoor_research_source_authority_scopes authority
            SET lifecycle_state = 'retired', updated_at = clock_timestamp()
          WHERE authority.source_id = $1
            AND authority.lifecycle_state = 'active'
            AND NOT EXISTS (
              SELECT 1
                FROM jsonb_to_recordset($2::jsonb)
                  AS required(predicate text, entity_category text)
               WHERE required.predicate = authority.predicate
                 AND required.entity_category = authority.entity_category
            )`,
        [sourceId, JSON.stringify(requiredAuthorityScopes.map((scope) => ({
          predicate: scope.predicate,
          entity_category: scope.entityCategory
        })))]
      );
      const normalizedFactsAllowed = remainingPolicies.length > 0;
      await client.query(
        `UPDATE outdoor_research_sources
            SET normalized_facts_allowed = $2,
                derived_features_allowed = false,
                lifecycle_state = CASE WHEN $2 THEN 'active' ELSE 'paused' END,
                updated_at = clock_timestamp()
          WHERE source_id = $1`,
        [sourceId, normalizedFactsAllowed]
      );
      await client.query("COMMIT");
      return Object.freeze({
        mode,
        sourceKey: OSM_RESEARCH_SOURCE_KEY,
        policyVersion: policy.policyVersion,
        lifecycleState: "retired",
        remainingActivePolicyCount: remainingPolicies.length,
        sourceLifecycleState: normalizedFactsAllowed ? "active" : "paused",
        normalizedFactsAllowed,
        derivedFeaturesAllowed: false
      });
    }

    const sourceId = deterministicUuidV3("outdoor-research-source", OSM_RESEARCH_SOURCE_KEY);
    const existingSource = await client.query(
      "SELECT * FROM outdoor_research_sources WHERE source_key = $1 FOR UPDATE",
      [OSM_RESEARCH_SOURCE_KEY]
    );
    if (existingSource.rowCount === 0) {
      await client.query(
        `INSERT INTO outdoor_research_sources
           (source_id, source_key, source_name, source_category, authority_class,
            license_identifier, attribution_requirements, canonical_origin,
            normalized_facts_allowed, derived_features_allowed, geographic_coverage,
            expected_refresh_interval_seconds, lifecycle_state, adapter_schema_version)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, false, $9, $10, 'active', $11)`,
        [
          sourceId, OSM_SOURCE_CONTRACT.sourceKey, OSM_SOURCE_CONTRACT.sourceName,
          OSM_SOURCE_CONTRACT.sourceCategory, OSM_SOURCE_CONTRACT.authorityClass,
          OSM_SOURCE_CONTRACT.licenseIdentifier, OSM_SOURCE_CONTRACT.attributionRequirements,
          OSM_SOURCE_CONTRACT.canonicalOrigin, OSM_SOURCE_CONTRACT.geographicCoverage,
          OSM_SOURCE_CONTRACT.expectedRefreshIntervalSeconds,
          OSM_SOURCE_CONTRACT.adapterSchemaVersion
        ]
      );
    } else {
      validateExistingSource(existingSource.rows[0]);
      await client.query(
        `UPDATE outdoor_research_sources
            SET source_name = $2,
                attribution_requirements = $3,
                geographic_coverage = $4,
                expected_refresh_interval_seconds = $5,
                normalized_facts_allowed = true,
                derived_features_allowed = false,
                lifecycle_state = 'active',
                adapter_schema_version = $6,
                updated_at = clock_timestamp()
          WHERE source_id = $1`,
        [
          existingSource.rows[0].source_id, OSM_SOURCE_CONTRACT.sourceName,
          OSM_SOURCE_CONTRACT.attributionRequirements, OSM_SOURCE_CONTRACT.geographicCoverage,
          OSM_SOURCE_CONTRACT.expectedRefreshIntervalSeconds,
          OSM_SOURCE_CONTRACT.adapterSchemaVersion
        ]
      );
    }
    const persistedSource = await client.query(
      "SELECT source_id FROM outdoor_research_sources WHERE source_key = $1",
      [OSM_RESEARCH_SOURCE_KEY]
    );
    const persistedSourceId = persistedSource.rows[0]?.source_id;
    if (!persistedSourceId) throw new OsmProjectionError("source_configuration_failed");

    const policyId = deterministicUuidV3(
      "outdoor-research-source-policy",
      `${OSM_RESEARCH_SOURCE_KEY}:${policy.policyVersion}`
    );
    const existingPolicy = await client.query(
      `SELECT * FROM outdoor_research_source_policies
        WHERE source_id = $1 AND policy_version = $2
        FOR UPDATE`,
      [persistedSourceId, policy.policyVersion]
    );
    if (existingPolicy.rowCount === 0) {
      await client.query(
        `INSERT INTO outdoor_research_source_policies
           (source_policy_id, source_id, policy_version, policy_schema_version,
            adapter_schema_version, normalized_facts_allowed, derived_features_allowed,
            maximum_input_age_days, review_reference, reviewed_at, lifecycle_state)
         VALUES ($1, $2, $3, $4, $5, true, false, $6, $7, $8, 'active')`,
        [
          policyId, persistedSourceId, policy.policyVersion, policy.policySchemaVersion,
          policy.adapterSchemaVersion, policy.maximumInputAgeDays,
          reviewReference, reviewedAt
        ]
      );
    } else {
      validateExistingPolicy(existingPolicy.rows[0], policy, reviewReference, reviewedAt);
    }

    for (const scope of policy.assertionScopes) {
      const scopeIdentity = `${policyId}:${scope.predicate}:${scope.entityCategory}`;
      await client.query(
        `INSERT INTO outdoor_research_source_policy_scopes
           (source_policy_scope_id, source_policy_id, predicate, entity_category)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (source_policy_id, predicate, entity_category) DO NOTHING`,
        [
          deterministicUuidV3("outdoor-research-policy-scope", scopeIdentity),
          policyId, scope.predicate, scope.entityCategory
        ]
      );
      const authorityIdentity =
        `${persistedSourceId}:${scope.predicate}:${scope.entityCategory}`;
      await client.query(
        `INSERT INTO outdoor_research_source_authority_scopes
           (source_authority_scope_id, source_id, predicate, entity_category,
            review_reference, reviewed_at, lifecycle_state)
         VALUES ($1, $2, $3, $4, $5, $6, 'active')
         ON CONFLICT (source_id, predicate, entity_category) DO UPDATE
             SET review_reference = EXCLUDED.review_reference,
                 reviewed_at = EXCLUDED.reviewed_at,
                 lifecycle_state = 'active',
                 updated_at = clock_timestamp()`,
        [
          deterministicUuidV3("outdoor-research-authority-scope", authorityIdentity),
          persistedSourceId, scope.predicate, scope.entityCategory,
          reviewReference, reviewedAt
        ]
      );
    }
    for (const scope of policy.relationshipScopes) {
      const identity = [
        policyId, scope.relationshipType,
        scope.subjectEntityCategory, scope.objectEntityCategory
      ].join(":");
      await client.query(
        `INSERT INTO outdoor_research_source_policy_relationship_scopes
           (source_policy_relationship_scope_id, source_policy_id, relationship_type,
            subject_entity_category, object_entity_category)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (
           source_policy_id, relationship_type,
           subject_entity_category, object_entity_category
         ) DO NOTHING`,
        [
          deterministicUuidV3("outdoor-research-relationship-policy-scope", identity),
          policyId, scope.relationshipType,
          scope.subjectEntityCategory, scope.objectEntityCategory
        ]
      );
    }

    const policyScopes = await client.query(
      `SELECT predicate, entity_category
         FROM outdoor_research_source_policy_scopes
        WHERE source_policy_id = $1 AND lifecycle_state = 'active'`,
      [policyId]
    );
    const relationshipScopes = await client.query(
      `SELECT relationship_type, subject_entity_category, object_entity_category
         FROM outdoor_research_source_policy_relationship_scopes
        WHERE source_policy_id = $1 AND lifecycle_state = 'active'`,
      [policyId]
    );
    const authorityScopes = await client.query(
      `SELECT predicate, entity_category
         FROM outdoor_research_source_authority_scopes
        WHERE source_id = $1 AND lifecycle_state = 'active'`,
      [persistedSourceId]
    );
    if (!exactScopeSetMatches(
      policyScopes.rows.map(fromScopeRow), policy.assertionScopes
    ) ||
        !exactScopeSetMatches(
          authorityScopes.rows.map(fromScopeRow), policy.assertionScopes
        ) ||
        !exactRelationshipScopeSetMatches(
          relationshipScopes.rows.map(fromRelationshipScopeRow),
          policy.relationshipScopes
        )) {
      throw new OsmProjectionError("policy_scope_mismatch");
    }
    await client.query("COMMIT");
    return Object.freeze({
      mode,
      sourceKey: OSM_RESEARCH_SOURCE_KEY,
      sourceId: persistedSourceId,
      policyVersion: policy.policyVersion,
      assertionScopeCount: policy.assertionScopes.length,
      relationshipScopeCount: policy.relationshipScopes.length,
      lifecycleState: "active",
      normalizedFactsAllowed: true,
      derivedFeaturesAllowed: false
    });
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    if (error instanceof OsmProjectionError) throw error;
    throw new OsmProjectionError("policy_configuration_failed", { cause: error });
  } finally {
    client.release();
  }
}

async function ensurePolicySchema(client) {
  const result = await client.query(
    `SELECT
       to_regclass('outdoor_research_sources') IS NOT NULL AS sources,
       to_regclass('outdoor_research_source_policies') IS NOT NULL AS policies,
       to_regclass('outdoor_research_projection_runs') IS NOT NULL AS projections`
  );
  if (!result.rows[0]?.sources || !result.rows[0]?.policies ||
      !result.rows[0]?.projections) {
    throw new OsmProjectionError("missing_migrations");
  }
}

function validateExistingSource(source) {
  const exact = source.source_category === OSM_SOURCE_CONTRACT.sourceCategory &&
    source.authority_class === OSM_SOURCE_CONTRACT.authorityClass &&
    source.license_identifier === OSM_SOURCE_CONTRACT.licenseIdentifier &&
    source.canonical_origin === OSM_SOURCE_CONTRACT.canonicalOrigin;
  if (!exact) throw new OsmProjectionError("source_contract_mismatch");
  if (source.lifecycle_state === "blocked" || source.lifecycle_state === "retired") {
    throw new OsmProjectionError("source_lifecycle_blocked");
  }
}

function validateExistingPolicy(row, policy, reviewReference, reviewedAt) {
  const exact = row.policy_schema_version === policy.policySchemaVersion &&
    row.adapter_schema_version === policy.adapterSchemaVersion &&
    row.normalized_facts_allowed === true &&
    row.derived_features_allowed === false &&
    row.maximum_input_age_days === policy.maximumInputAgeDays &&
    row.review_reference === reviewReference &&
    new Date(row.reviewed_at).toISOString() === reviewedAt &&
    row.lifecycle_state === "active";
  if (!exact) throw new OsmProjectionError("policy_version_conflict");
}

async function activeReviewedPolicies(client, sourceId) {
  const policyRows = await client.query(
    `SELECT source_policy_id, policy_version, policy_schema_version,
            adapter_schema_version, normalized_facts_allowed,
            derived_features_allowed, maximum_input_age_days, lifecycle_state
       FROM outdoor_research_source_policies
      WHERE source_id = $1 AND lifecycle_state = 'active'
      ORDER BY policy_version`,
    [sourceId]
  );
  const reviewed = [];
  for (const row of policyRows.rows) {
    const policy = recognizedOsmProjectionPolicy(row.policy_version);
    if (!policy ||
        row.policy_schema_version !== policy.policySchemaVersion ||
        row.adapter_schema_version !== policy.adapterSchemaVersion ||
        row.normalized_facts_allowed !== true ||
        row.derived_features_allowed !== false ||
        row.maximum_input_age_days !== policy.maximumInputAgeDays) {
      continue;
    }
    const assertionScopes = await client.query(
      `SELECT predicate, entity_category
         FROM outdoor_research_source_policy_scopes
        WHERE source_policy_id = $1 AND lifecycle_state = 'active'`,
      [row.source_policy_id]
    );
    const relationshipScopes = await client.query(
      `SELECT relationship_type, subject_entity_category, object_entity_category
         FROM outdoor_research_source_policy_relationship_scopes
        WHERE source_policy_id = $1 AND lifecycle_state = 'active'`,
      [row.source_policy_id]
    );
    const authorityScopes = await client.query(
      `SELECT predicate, entity_category
         FROM outdoor_research_source_authority_scopes
        WHERE source_id = $1 AND lifecycle_state = 'active'`,
      [sourceId]
    );
    if (exactScopeSetMatches(
      assertionScopes.rows.map(fromScopeRow), policy.assertionScopes
    ) && exactScopeSetMatches(
      authorityScopes.rows.map(fromScopeRow), policy.assertionScopes
    ) && exactRelationshipScopeSetMatches(
      relationshipScopes.rows.map(fromRelationshipScopeRow),
      policy.relationshipScopes
    )) {
      reviewed.push({ sourcePolicyId: row.source_policy_id, policy });
    }
  }
  return reviewed;
}

function reviewedText(value, maximum, code) {
  if (typeof value !== "string" || value !== value.trim() ||
      value.length < 1 || value.length > maximum ||
      /[\u0000-\u001f\u007f]/.test(value)) {
    throw new OsmProjectionError(code);
  }
  return value;
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
