CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS outdoor_research_sources (
    source_id uuid PRIMARY KEY,
    source_key text NOT NULL UNIQUE CHECK (
        length(source_key) BETWEEN 1 AND 80 AND
        source_key ~ '^[a-z0-9]+(?:[._-][a-z0-9]+)*$'
    ),
    source_name text NOT NULL CHECK (length(source_name) BETWEEN 1 AND 160),
    owner_operator text CHECK (owner_operator IS NULL OR length(owner_operator) BETWEEN 1 AND 160),
    source_category text NOT NULL CHECK (source_category IN (
        'official_authority', 'official_operator', 'openstreetmap_open_mapping',
        'wikimedia_open_knowledge', 'licensed_partner', 'trailmind_community',
        'derived_computation', 'model_inference'
    )),
    authority_class text NOT NULL CHECK (authority_class IN (
        'primary_authority', 'delegated_authority', 'operator', 'open_community',
        'licensed_provider', 'trailmind_community', 'derived', 'model', 'unknown'
    )),
    license_identifier text NOT NULL CHECK (length(license_identifier) BETWEEN 1 AND 120),
    attribution_requirements text NOT NULL CHECK (length(attribution_requirements) <= 1000),
    canonical_origin text NOT NULL CHECK (length(canonical_origin) BETWEEN 1 AND 500),
    normalized_facts_allowed boolean NOT NULL DEFAULT false,
    derived_features_allowed boolean NOT NULL DEFAULT false,
    geographic_coverage text NOT NULL CHECK (length(geographic_coverage) BETWEEN 1 AND 500),
    expected_refresh_interval_seconds integer CHECK (
        expected_refresh_interval_seconds IS NULL OR
        expected_refresh_interval_seconds BETWEEN 300 AND 31557600
    ),
    lifecycle_state text NOT NULL CHECK (lifecycle_state IN (
        'proposed', 'active', 'paused', 'retired', 'blocked'
    )),
    last_successful_retrieval_at timestamptz,
    adapter_schema_version text NOT NULL CHECK (length(adapter_schema_version) BETWEEN 1 AND 80),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CHECK (updated_at >= created_at)
);

CREATE INDEX IF NOT EXISTS outdoor_research_sources_category_lifecycle_idx
    ON outdoor_research_sources (source_category, lifecycle_state, source_key);
CREATE INDEX IF NOT EXISTS outdoor_research_sources_refresh_idx
    ON outdoor_research_sources (last_successful_retrieval_at)
    WHERE lifecycle_state = 'active';

CREATE TABLE IF NOT EXISTS outdoor_research_source_authority_scopes (
    source_authority_scope_id uuid PRIMARY KEY,
    source_id uuid NOT NULL REFERENCES outdoor_research_sources(source_id) ON DELETE RESTRICT,
    predicate text NOT NULL CHECK (predicate IN (
        'entity_category', 'name', 'operator', 'public_access', 'access_restriction',
        'current_opening', 'seasonal_opening', 'overnight_permission', 'bookability',
        'drinking_water_availability', 'trail_difficulty', 'trail_visibility',
        'viewpoint_presence', 'waterfall_presence', 'mapped_hiking_route_membership',
        'closure_status'
    )),
    entity_category text NOT NULL CHECK (entity_category IN (
        'viewpoint', 'waterfall', 'peak', 'lake', 'alpine_hut', 'wilderness_hut',
        'official_campsite', 'designated_bivouac', 'emergency_shelter', 'trailhead',
        'landmark', 'hiking_route', 'trail_segment', 'region', 'organization'
    )),
    review_reference text NOT NULL CHECK (length(review_reference) BETWEEN 1 AND 500),
    reviewed_at timestamptz NOT NULL,
    lifecycle_state text NOT NULL DEFAULT 'active' CHECK (lifecycle_state IN ('active', 'retired')),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CHECK (updated_at >= created_at),
    UNIQUE (source_id, predicate, entity_category)
);

CREATE INDEX IF NOT EXISTS outdoor_research_source_authority_scopes_lookup_idx
    ON outdoor_research_source_authority_scopes (source_id, predicate, entity_category)
    WHERE lifecycle_state = 'active';

CREATE TABLE IF NOT EXISTS outdoor_research_entities (
    entity_id uuid PRIMARY KEY,
    entity_category text NOT NULL CHECK (entity_category IN (
        'viewpoint', 'waterfall', 'peak', 'lake', 'alpine_hut', 'wilderness_hut',
        'official_campsite', 'designated_bivouac', 'emergency_shelter', 'trailhead',
        'landmark', 'hiking_route', 'trail_segment', 'region', 'organization'
    )),
    canonical_geometry geometry(Geometry, 4326),
    lifecycle_state text NOT NULL DEFAULT 'candidate' CHECK (lifecycle_state IN (
        'candidate', 'active', 'disputed', 'merged', 'retired'
    )),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CHECK (updated_at >= created_at),
    CHECK (
        canonical_geometry IS NULL OR (
            GeometryType(canonical_geometry) IN (
                'POINT', 'LINESTRING', 'MULTILINESTRING', 'POLYGON', 'MULTIPOLYGON'
            ) AND
            ST_NDims(canonical_geometry) = 2 AND
            ST_SRID(canonical_geometry) = 4326 AND
            NOT ST_IsEmpty(canonical_geometry) AND
            ST_IsValid(canonical_geometry) AND
            ST_CoveredBy(canonical_geometry, ST_MakeEnvelope(-180, -90, 180, 90, 4326))
        )
    )
);

CREATE INDEX IF NOT EXISTS outdoor_research_entities_geometry_gist_idx
    ON outdoor_research_entities USING GIST (canonical_geometry);
CREATE INDEX IF NOT EXISTS outdoor_research_entities_category_lifecycle_idx
    ON outdoor_research_entities (entity_category, lifecycle_state, entity_id);

CREATE TABLE IF NOT EXISTS outdoor_research_entity_aliases (
    alias_id uuid PRIMARY KEY,
    entity_id uuid NOT NULL REFERENCES outdoor_research_entities(entity_id) ON DELETE RESTRICT,
    source_id uuid REFERENCES outdoor_research_sources(source_id) ON DELETE RESTRICT,
    alias_kind text NOT NULL CHECK (alias_kind IN (
        'primary_name', 'alternate_name', 'localized_name', 'historical_name', 'external_label'
    )),
    alias_text text NOT NULL CHECK (length(alias_text) BETWEEN 1 AND 240),
    language_code text CHECK (
        language_code IS NULL OR
        (length(language_code) BETWEEN 2 AND 15 AND language_code ~ '^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$')
    ),
    lifecycle_state text NOT NULL DEFAULT 'active' CHECK (lifecycle_state IN (
        'active', 'disputed', 'retired'
    )),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE UNIQUE INDEX IF NOT EXISTS outdoor_research_entity_aliases_unique_idx
    ON outdoor_research_entity_aliases (
        entity_id,
        COALESCE(source_id, '00000000-0000-0000-0000-000000000000'::uuid),
        alias_kind,
        lower(alias_text),
        COALESCE(language_code, '')
    );
CREATE INDEX IF NOT EXISTS outdoor_research_entity_aliases_lookup_idx
    ON outdoor_research_entity_aliases (lower(alias_text), alias_kind);

CREATE TABLE IF NOT EXISTS outdoor_research_source_entities (
    source_entity_link_id uuid PRIMARY KEY,
    entity_id uuid NOT NULL REFERENCES outdoor_research_entities(entity_id) ON DELETE RESTRICT,
    source_id uuid NOT NULL REFERENCES outdoor_research_sources(source_id) ON DELETE RESTRICT,
    external_type text NOT NULL CHECK (
        length(external_type) BETWEEN 1 AND 80 AND external_type ~ '^[A-Za-z0-9._:-]+$'
    ),
    external_id text NOT NULL CHECK (length(external_id) BETWEEN 1 AND 256),
    matching_status text NOT NULL CHECK (matching_status IN (
        'candidate', 'matched', 'conflicted', 'rejected'
    )),
    matching_method text NOT NULL CHECK (matching_method IN (
        'exact_external_id', 'operator_review', 'imported_mapping',
        'spatial_candidate', 'name_candidate'
    )),
    matched_at timestamptz,
    review_status text NOT NULL DEFAULT 'not_reviewed' CHECK (review_status IN (
        'not_reviewed', 'confirmed', 'rejected'
    )),
    reviewed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CHECK ((matching_status = 'matched') = (matched_at IS NOT NULL)),
    CHECK ((review_status = 'not_reviewed') = (reviewed_at IS NULL)),
    CHECK (review_status <> 'confirmed' OR matching_status = 'matched'),
    CHECK (review_status <> 'rejected' OR matching_status = 'rejected'),
    UNIQUE (entity_id, source_id, external_type, external_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS outdoor_research_source_entities_resolved_identity_idx
    ON outdoor_research_source_entities (source_id, external_type, external_id)
    WHERE matching_status = 'matched';
CREATE INDEX IF NOT EXISTS outdoor_research_source_entities_candidate_idx
    ON outdoor_research_source_entities (source_id, external_type, external_id, matching_status);
CREATE INDEX IF NOT EXISTS outdoor_research_source_entities_entity_idx
    ON outdoor_research_source_entities (entity_id, matching_status, source_id);

CREATE TABLE IF NOT EXISTS outdoor_research_assertions (
    assertion_id uuid PRIMARY KEY,
    entity_id uuid NOT NULL REFERENCES outdoor_research_entities(entity_id) ON DELETE RESTRICT,
    source_id uuid NOT NULL REFERENCES outdoor_research_sources(source_id) ON DELETE RESTRICT,
    predicate text NOT NULL CHECK (predicate IN (
        'entity_category', 'name', 'operator', 'public_access', 'access_restriction',
        'current_opening', 'seasonal_opening', 'overnight_permission', 'bookability',
        'drinking_water_availability', 'trail_difficulty', 'trail_visibility',
        'viewpoint_presence', 'waterfall_presence', 'mapped_hiking_route_membership',
        'closure_status'
    )),
    value_type text NOT NULL CHECK (value_type IN (
        'text', 'boolean', 'number', 'integer', 'timestamp', 'entity_reference'
    )),
    value_text text CHECK (value_text IS NULL OR length(value_text) BETWEEN 1 AND 500),
    value_boolean boolean,
    value_number double precision,
    value_integer bigint,
    value_timestamp timestamptz,
    value_entity_id uuid REFERENCES outdoor_research_entities(entity_id) ON DELETE RESTRICT,
    evidence_class text NOT NULL CHECK (evidence_class IN (
        'official', 'mapped', 'community_observed', 'derived', 'model_inferred', 'unknown'
    )),
    observed_at timestamptz,
    retrieved_at timestamptz NOT NULL,
    valid_from timestamptz,
    valid_until timestamptz,
    freshness_state text NOT NULL CHECK (freshness_state IN (
        'current', 'stale', 'expired', 'unknown'
    )),
    provenance_identifier text NOT NULL CHECK (length(provenance_identifier) BETWEEN 1 AND 500),
    assertion_state text NOT NULL DEFAULT 'asserted' CHECK (assertion_state IN (
        'asserted', 'supersedes', 'retracts'
    )),
    supersedes_assertion_id uuid REFERENCES outdoor_research_assertions(assertion_id) ON DELETE RESTRICT,
    resolution_group_key text CHECK (
        resolution_group_key IS NULL OR length(resolution_group_key) BETWEEN 1 AND 120
    ),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CHECK (
        (CASE WHEN value_text IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN value_boolean IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN value_number IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN value_integer IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN value_timestamp IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN value_entity_id IS NOT NULL THEN 1 ELSE 0 END) = 1
    ),
    CHECK (
        (value_type = 'text' AND value_text IS NOT NULL) OR
        (value_type = 'boolean' AND value_boolean IS NOT NULL) OR
        (value_type = 'number' AND value_number IS NOT NULL) OR
        (value_type = 'integer' AND value_integer IS NOT NULL) OR
        (value_type = 'timestamp' AND value_timestamp IS NOT NULL) OR
        (value_type = 'entity_reference' AND value_entity_id IS NOT NULL)
    ),
    CHECK (value_number IS NULL OR value_number::text NOT IN ('NaN', 'Infinity', '-Infinity')),
    CHECK (
        (predicate IN ('name', 'operator') AND value_type = 'text') OR
        (predicate = 'entity_category' AND value_type = 'text' AND value_text IN (
            'viewpoint', 'waterfall', 'peak', 'lake', 'alpine_hut', 'wilderness_hut',
            'official_campsite', 'designated_bivouac', 'emergency_shelter', 'trailhead',
            'landmark', 'hiking_route', 'trail_segment', 'region', 'organization'
        )) OR
        (predicate IN (
            'public_access', 'current_opening', 'overnight_permission', 'bookability',
            'drinking_water_availability', 'viewpoint_presence', 'waterfall_presence'
        ) AND value_type = 'boolean') OR
        (predicate = 'access_restriction' AND value_type = 'text' AND value_text IN (
            'restricted', 'prohibited', 'conditional', 'permit_required'
        )) OR
        (predicate = 'seasonal_opening' AND value_type = 'text' AND value_text IN (
            'open_seasonally', 'closed_seasonally', 'conditional'
        )) OR
        (predicate = 'trail_difficulty' AND value_type = 'text' AND value_text IN (
            'strolling', 'hiking', 'mountain_hiking', 'demanding_mountain_hiking',
            'alpine_hiking', 'demanding_alpine_hiking', 'difficult_alpine_hiking'
        )) OR
        (predicate = 'trail_visibility' AND value_type = 'text' AND value_text IN (
            'excellent', 'good', 'intermediate', 'bad', 'horrible', 'no'
        )) OR
        (predicate = 'closure_status' AND value_type = 'text' AND value_text IN (
            'open', 'closed', 'partial', 'conditional'
        )) OR
        (predicate = 'mapped_hiking_route_membership' AND value_type = 'entity_reference')
    ),
    CHECK (observed_at IS NULL OR observed_at <= retrieved_at),
    CHECK (valid_from IS NULL OR valid_until IS NULL OR valid_until > valid_from),
    CHECK (freshness_state <> 'expired' OR valid_until IS NOT NULL),
    CHECK (freshness_state <> 'current' OR valid_until IS NULL OR valid_until > retrieved_at),
    CHECK (
        (assertion_state = 'asserted' AND supersedes_assertion_id IS NULL) OR
        (assertion_state IN ('supersedes', 'retracts') AND supersedes_assertion_id IS NOT NULL)
    ),
    CHECK (supersedes_assertion_id IS NULL OR supersedes_assertion_id <> assertion_id),
    UNIQUE (source_id, provenance_identifier, entity_id, predicate)
);

CREATE INDEX IF NOT EXISTS outdoor_research_assertions_current_lookup_idx
    ON outdoor_research_assertions (entity_id, predicate, evidence_class, retrieved_at DESC)
    WHERE freshness_state = 'current' AND assertion_state IN ('asserted', 'supersedes');
CREATE INDEX IF NOT EXISTS outdoor_research_assertions_source_provenance_idx
    ON outdoor_research_assertions (source_id, provenance_identifier);
CREATE INDEX IF NOT EXISTS outdoor_research_assertions_validity_idx
    ON outdoor_research_assertions (valid_until, freshness_state)
    WHERE valid_until IS NOT NULL;
CREATE INDEX IF NOT EXISTS outdoor_research_assertions_supersedes_idx
    ON outdoor_research_assertions (supersedes_assertion_id)
    WHERE supersedes_assertion_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS outdoor_research_relationships (
    relationship_id uuid PRIMARY KEY,
    relationship_type text NOT NULL CHECK (relationship_type IN (
        'entity_contained_in_region', 'poi_connected_to_hiking_route',
        'hut_operated_by_organization', 'trail_segment_member_of_route',
        'viewpoint_overlooks_feature', 'entity_near_entity',
        'assertion_supersedes_assertion'
    )),
    subject_entity_id uuid REFERENCES outdoor_research_entities(entity_id) ON DELETE RESTRICT,
    object_entity_id uuid REFERENCES outdoor_research_entities(entity_id) ON DELETE RESTRICT,
    subject_assertion_id uuid REFERENCES outdoor_research_assertions(assertion_id) ON DELETE RESTRICT,
    object_assertion_id uuid REFERENCES outdoor_research_assertions(assertion_id) ON DELETE RESTRICT,
    source_id uuid REFERENCES outdoor_research_sources(source_id) ON DELETE RESTRICT,
    evidence_class text NOT NULL CHECK (evidence_class IN (
        'official', 'mapped', 'community_observed', 'derived', 'model_inferred', 'unknown'
    )),
    provenance_identifier text NOT NULL CHECK (length(provenance_identifier) BETWEEN 1 AND 500),
    computation_version text CHECK (computation_version IS NULL OR length(computation_version) BETWEEN 1 AND 120),
    observed_at timestamptz,
    retrieved_at timestamptz NOT NULL,
    valid_from timestamptz,
    valid_until timestamptz,
    freshness_state text NOT NULL CHECK (freshness_state IN (
        'current', 'stale', 'expired', 'unknown'
    )),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CHECK (
        (relationship_type = 'assertion_supersedes_assertion' AND
         subject_entity_id IS NULL AND object_entity_id IS NULL AND
         subject_assertion_id IS NOT NULL AND object_assertion_id IS NOT NULL) OR
        (relationship_type <> 'assertion_supersedes_assertion' AND
         subject_entity_id IS NOT NULL AND object_entity_id IS NOT NULL AND
         subject_assertion_id IS NULL AND object_assertion_id IS NULL)
    ),
    CHECK (subject_entity_id IS NULL OR subject_entity_id <> object_entity_id),
    CHECK (subject_assertion_id IS NULL OR subject_assertion_id <> object_assertion_id),
    CHECK (source_id IS NOT NULL OR evidence_class = 'derived'),
    CHECK ((evidence_class = 'derived') = (computation_version IS NOT NULL)),
    CHECK (observed_at IS NULL OR observed_at <= retrieved_at),
    CHECK (valid_from IS NULL OR valid_until IS NULL OR valid_until > valid_from),
    CHECK (freshness_state <> 'expired' OR valid_until IS NOT NULL),
    CHECK (freshness_state <> 'current' OR valid_until IS NULL OR valid_until > retrieved_at)
);

CREATE INDEX IF NOT EXISTS outdoor_research_relationships_subject_entity_idx
    ON outdoor_research_relationships (subject_entity_id, relationship_type)
    WHERE subject_entity_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS outdoor_research_relationships_object_entity_idx
    ON outdoor_research_relationships (object_entity_id, relationship_type)
    WHERE object_entity_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS outdoor_research_relationships_assertion_idx
    ON outdoor_research_relationships (subject_assertion_id, object_assertion_id)
    WHERE subject_assertion_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS outdoor_research_relationships_source_idx
    ON outdoor_research_relationships (source_id, provenance_identifier);

CREATE TABLE IF NOT EXISTS outdoor_research_derived_features (
    derived_feature_id uuid PRIMARY KEY,
    entity_id uuid REFERENCES outdoor_research_entities(entity_id) ON DELETE RESTRICT,
    relationship_id uuid REFERENCES outdoor_research_relationships(relationship_id) ON DELETE RESTRICT,
    source_id uuid NOT NULL REFERENCES outdoor_research_sources(source_id) ON DELETE RESTRICT,
    feature_key text NOT NULL CHECK (feature_key IN (
        'terrain_viewshed', 'horizon_openness', 'prominence', 'detour_cost',
        'poi_to_route_distance', 'official_hiking_network_coverage',
        'trail_quality_ratio', 'evidence_confidence', 'seasonal_relevance',
        'aggregated_community_value'
    )),
    value_type text NOT NULL CHECK (value_type IN ('number', 'integer', 'boolean', 'text')),
    value_number double precision,
    value_integer bigint,
    value_boolean boolean,
    value_text text CHECK (value_text IS NULL OR length(value_text) BETWEEN 1 AND 160),
    evidence_class text NOT NULL DEFAULT 'derived' CHECK (evidence_class = 'derived'),
    computation_version text NOT NULL CHECK (length(computation_version) BETWEEN 1 AND 120),
    input_data_version text NOT NULL CHECK (length(input_data_version) BETWEEN 1 AND 500),
    provenance_reference text NOT NULL CHECK (length(provenance_reference) BETWEEN 1 AND 500),
    calculated_at timestamptz NOT NULL,
    valid_until timestamptz,
    freshness_state text NOT NULL CHECK (freshness_state IN ('current', 'stale', 'expired', 'unknown')),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CHECK ((entity_id IS NOT NULL)::integer + (relationship_id IS NOT NULL)::integer = 1),
    CHECK (
        (CASE WHEN value_number IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN value_integer IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN value_boolean IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN value_text IS NOT NULL THEN 1 ELSE 0 END) = 1
    ),
    CHECK (
        (value_type = 'number' AND value_number IS NOT NULL) OR
        (value_type = 'integer' AND value_integer IS NOT NULL) OR
        (value_type = 'boolean' AND value_boolean IS NOT NULL) OR
        (value_type = 'text' AND value_text IS NOT NULL)
    ),
    CHECK (value_number IS NULL OR value_number::text NOT IN ('NaN', 'Infinity', '-Infinity')),
    CHECK (
        feature_key <> 'seasonal_relevance' OR
        (value_type = 'text' AND value_text IN ('in_season', 'out_of_season', 'conditional'))
    ),
    CHECK (
        feature_key NOT IN ('horizon_openness', 'official_hiking_network_coverage',
            'trail_quality_ratio', 'evidence_confidence', 'aggregated_community_value') OR
        (value_type = 'number' AND value_number BETWEEN 0 AND 1)
    ),
    CHECK (valid_until IS NULL OR valid_until > calculated_at),
    CHECK (freshness_state <> 'expired' OR valid_until IS NOT NULL),
    CHECK (freshness_state <> 'current' OR valid_until IS NULL OR valid_until > calculated_at)
);

CREATE INDEX IF NOT EXISTS outdoor_research_derived_features_entity_idx
    ON outdoor_research_derived_features (entity_id, feature_key, calculated_at DESC)
    WHERE entity_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS outdoor_research_derived_features_relationship_idx
    ON outdoor_research_derived_features (relationship_id, feature_key, calculated_at DESC)
    WHERE relationship_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS outdoor_research_derived_features_current_idx
    ON outdoor_research_derived_features (feature_key, valid_until)
    WHERE freshness_state = 'current';

CREATE TABLE IF NOT EXISTS outdoor_research_observations (
    observation_id uuid PRIMARY KEY,
    entity_id uuid NOT NULL REFERENCES outdoor_research_entities(entity_id) ON DELETE RESTRICT,
    source_id uuid NOT NULL REFERENCES outdoor_research_sources(source_id) ON DELETE RESTRICT,
    observation_type text NOT NULL CHECK (observation_type IN (
        'temporary_trail_condition', 'closure_observation', 'waterfall_flow_observation',
        'hut_status_observation', 'route_finding_difficulty', 'crowding_observation',
        'highlight_confirmation'
    )),
    value_type text NOT NULL CHECK (value_type IN ('text', 'boolean')),
    value_text text CHECK (value_text IS NULL OR length(value_text) BETWEEN 1 AND 120),
    value_boolean boolean,
    observed_at timestamptz NOT NULL,
    retrieved_at timestamptz NOT NULL,
    valid_until timestamptz,
    provenance_identifier text NOT NULL CHECK (length(provenance_identifier) BETWEEN 1 AND 500),
    moderation_state text NOT NULL DEFAULT 'unreviewed' CHECK (moderation_state IN (
        'unreviewed', 'corroborated', 'disputed', 'rejected'
    )),
    observation_state text NOT NULL DEFAULT 'active' CHECK (observation_state IN (
        'active', 'retracted'
    )),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CHECK (
        (value_type = 'text' AND value_text IS NOT NULL AND value_boolean IS NULL) OR
        (value_type = 'boolean' AND value_boolean IS NOT NULL AND value_text IS NULL)
    ),
    CHECK (
        (observation_type = 'temporary_trail_condition' AND value_type = 'text' AND value_text IN (
            'clear', 'muddy', 'snow', 'icy', 'flooded', 'blocked', 'damaged'
        )) OR
        (observation_type IN ('closure_observation', 'hut_status_observation') AND
            value_type = 'text' AND value_text IN ('open', 'closed', 'partial', 'conditional')) OR
        (observation_type = 'waterfall_flow_observation' AND value_type = 'text' AND
            value_text IN ('dry', 'low', 'moderate', 'high')) OR
        (observation_type = 'route_finding_difficulty' AND value_type = 'text' AND
            value_text IN ('easy', 'moderate', 'difficult', 'impassable')) OR
        (observation_type = 'crowding_observation' AND value_type = 'text' AND
            value_text IN ('low', 'moderate', 'high')) OR
        (observation_type = 'highlight_confirmation' AND value_type = 'boolean')
    ),
    CHECK (observed_at <= retrieved_at),
    CHECK (valid_until IS NULL OR valid_until > observed_at),
    UNIQUE (source_id, provenance_identifier, entity_id, observation_type)
);

CREATE INDEX IF NOT EXISTS outdoor_research_observations_entity_time_idx
    ON outdoor_research_observations (entity_id, observation_type, observed_at DESC);
CREATE INDEX IF NOT EXISTS outdoor_research_observations_source_idx
    ON outdoor_research_observations (source_id, provenance_identifier);
CREATE INDEX IF NOT EXISTS outdoor_research_observations_validity_idx
    ON outdoor_research_observations (valid_until, moderation_state)
    WHERE valid_until IS NOT NULL;

CREATE OR REPLACE FUNCTION outdoor_research_reject_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
    RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = '55000';
END
$function$;

CREATE OR REPLACE FUNCTION outdoor_research_validate_assertion_write()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
    category text;
    source_lifecycle text;
    normalized_allowed boolean;
    assertion_entity_category text;
    target outdoor_research_assertions%ROWTYPE;
BEGIN
    SELECT source_category, lifecycle_state, normalized_facts_allowed
      INTO category, source_lifecycle, normalized_allowed
      FROM outdoor_research_sources
     WHERE source_id = NEW.source_id;

    IF category IS NULL THEN
        RAISE EXCEPTION 'evidence source does not exist' USING ERRCODE = '23503';
    END IF;

    IF source_lifecycle <> 'active' OR NOT normalized_allowed THEN
        RAISE EXCEPTION 'source is not active and approved for normalized facts' USING ERRCODE = '23514';
    END IF;

    IF (category IN ('official_authority', 'official_operator') AND NEW.evidence_class <> 'official') OR
       (category IN ('openstreetmap_open_mapping', 'wikimedia_open_knowledge') AND NEW.evidence_class <> 'mapped') OR
       (category = 'trailmind_community' AND NEW.evidence_class <> 'community_observed') OR
       (category = 'derived_computation' AND NEW.evidence_class <> 'derived') OR
       (category = 'model_inference' AND NEW.evidence_class <> 'model_inferred') THEN
        RAISE EXCEPTION 'evidence class does not match source category' USING ERRCODE = '23514';
    END IF;

    SELECT entity_category INTO assertion_entity_category
      FROM outdoor_research_entities
     WHERE entity_id = NEW.entity_id;

    IF assertion_entity_category IS NULL THEN
        RAISE EXCEPTION 'assertion entity does not exist' USING ERRCODE = '23503';
    END IF;

    PERFORM 1
      FROM outdoor_research_source_authority_scopes
     WHERE source_id = NEW.source_id
       AND predicate = NEW.predicate
       AND entity_category = assertion_entity_category
       AND lifecycle_state = 'active';
    IF NOT FOUND THEN
        RAISE EXCEPTION 'source lacks reviewed authority for assertion scope' USING ERRCODE = '23514';
    END IF;

    IF NEW.assertion_state IN ('supersedes', 'retracts') THEN
        SELECT * INTO target
          FROM outdoor_research_assertions
         WHERE assertion_id = NEW.supersedes_assertion_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'supersession target does not exist' USING ERRCODE = '23503';
        END IF;
        IF target.entity_id <> NEW.entity_id OR target.predicate <> NEW.predicate OR
           target.source_id <> NEW.source_id THEN
            RAISE EXCEPTION 'supersession target must share entity, predicate and source' USING ERRCODE = '23514';
        END IF;
        IF target.assertion_state = 'retracts' THEN
            RAISE EXCEPTION 'a retraction cannot be superseded or retracted' USING ERRCODE = '23514';
        END IF;
        IF NEW.retrieved_at < target.retrieved_at OR NEW.created_at <= target.created_at OR
           (NEW.observed_at IS NOT NULL AND target.observed_at IS NOT NULL AND
            NEW.observed_at < target.observed_at) THEN
            RAISE EXCEPTION 'supersession must be temporally later than its target' USING ERRCODE = '23514';
        END IF;
    END IF;

    RETURN NEW;
END
$function$;

CREATE OR REPLACE FUNCTION outdoor_research_validate_relationship_source_class()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
    category text;
BEGIN
    IF NEW.source_id IS NULL AND NEW.evidence_class = 'derived' THEN
        RETURN NEW;
    END IF;
    SELECT source_category INTO category
      FROM outdoor_research_sources
     WHERE source_id = NEW.source_id AND lifecycle_state = 'active';
    IF category IS NULL THEN
        RAISE EXCEPTION 'active evidence source does not exist' USING ERRCODE = '23503';
    END IF;
    IF (category IN ('official_authority', 'official_operator') AND NEW.evidence_class <> 'official') OR
       (category IN ('openstreetmap_open_mapping', 'wikimedia_open_knowledge') AND NEW.evidence_class <> 'mapped') OR
       (category = 'trailmind_community' AND NEW.evidence_class <> 'community_observed') OR
       (category = 'derived_computation' AND NEW.evidence_class <> 'derived') OR
       (category = 'model_inference' AND NEW.evidence_class <> 'model_inferred') THEN
        RAISE EXCEPTION 'evidence class does not match source category' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END
$function$;

CREATE OR REPLACE FUNCTION outdoor_research_validate_derived_feature_write()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
    source_lifecycle text;
    derivation_allowed boolean;
BEGIN
    SELECT lifecycle_state, derived_features_allowed
      INTO source_lifecycle, derivation_allowed
      FROM outdoor_research_sources
     WHERE source_id = NEW.source_id;
    IF source_lifecycle IS NULL THEN
        RAISE EXCEPTION 'derived feature source does not exist' USING ERRCODE = '23503';
    END IF;
    IF source_lifecycle <> 'active' OR NOT derivation_allowed THEN
        RAISE EXCEPTION 'source is not active and approved for derived features' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END
$function$;

DO $migration$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
         WHERE tgrelid = 'outdoor_research_assertions'::regclass
           AND tgname = 'outdoor_research_assertions_append_only'
           AND NOT tgisinternal
    ) THEN
        CREATE TRIGGER outdoor_research_assertions_append_only
        BEFORE UPDATE OR DELETE ON outdoor_research_assertions
        FOR EACH ROW EXECUTE FUNCTION outdoor_research_reject_audit_mutation();
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
         WHERE tgrelid = 'outdoor_research_observations'::regclass
           AND tgname = 'outdoor_research_observations_append_only'
           AND NOT tgisinternal
    ) THEN
        CREATE TRIGGER outdoor_research_observations_append_only
        BEFORE UPDATE OR DELETE ON outdoor_research_observations
        FOR EACH ROW EXECUTE FUNCTION outdoor_research_reject_audit_mutation();
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
         WHERE tgrelid = 'outdoor_research_relationships'::regclass
           AND tgname = 'outdoor_research_relationships_append_only'
           AND NOT tgisinternal
    ) THEN
        CREATE TRIGGER outdoor_research_relationships_append_only
        BEFORE UPDATE OR DELETE ON outdoor_research_relationships
        FOR EACH ROW EXECUTE FUNCTION outdoor_research_reject_audit_mutation();
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
         WHERE tgrelid = 'outdoor_research_derived_features'::regclass
           AND tgname = 'outdoor_research_derived_features_append_only'
           AND NOT tgisinternal
    ) THEN
        CREATE TRIGGER outdoor_research_derived_features_append_only
        BEFORE UPDATE OR DELETE ON outdoor_research_derived_features
        FOR EACH ROW EXECUTE FUNCTION outdoor_research_reject_audit_mutation();
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
         WHERE tgrelid = 'outdoor_research_assertions'::regclass
           AND tgname = 'outdoor_research_assertions_source_class'
           AND NOT tgisinternal
    ) THEN
        CREATE TRIGGER outdoor_research_assertions_source_class
        BEFORE INSERT ON outdoor_research_assertions
        FOR EACH ROW EXECUTE FUNCTION outdoor_research_validate_assertion_write();
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
         WHERE tgrelid = 'outdoor_research_relationships'::regclass
           AND tgname = 'outdoor_research_relationships_source_class'
           AND NOT tgisinternal
    ) THEN
        CREATE TRIGGER outdoor_research_relationships_source_class
        BEFORE INSERT ON outdoor_research_relationships
        FOR EACH ROW EXECUTE FUNCTION outdoor_research_validate_relationship_source_class();
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
         WHERE tgrelid = 'outdoor_research_derived_features'::regclass
           AND tgname = 'outdoor_research_derived_features_source_permission'
           AND NOT tgisinternal
    ) THEN
        CREATE TRIGGER outdoor_research_derived_features_source_permission
        BEFORE INSERT ON outdoor_research_derived_features
        FOR EACH ROW EXECUTE FUNCTION outdoor_research_validate_derived_feature_write();
    END IF;
END
$migration$;

ALTER TABLE outdoor_research_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE outdoor_research_source_authority_scopes ENABLE ROW LEVEL SECURITY;
ALTER TABLE outdoor_research_entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE outdoor_research_entity_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE outdoor_research_source_entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE outdoor_research_assertions ENABLE ROW LEVEL SECURITY;
ALTER TABLE outdoor_research_relationships ENABLE ROW LEVEL SECURITY;
ALTER TABLE outdoor_research_derived_features ENABLE ROW LEVEL SECURITY;
ALTER TABLE outdoor_research_observations ENABLE ROW LEVEL SECURITY;
