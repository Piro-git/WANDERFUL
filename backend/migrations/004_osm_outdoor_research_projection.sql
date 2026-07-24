ALTER TABLE outdoor_evidence_imports
    ADD COLUMN IF NOT EXISTS acquisition_channel text,
    ADD COLUMN IF NOT EXISTS source_checksum_algorithm text,
    ADD COLUMN IF NOT EXISTS source_checksum text,
    ADD COLUMN IF NOT EXISTS source_checksum_verified_at timestamptz,
    ADD COLUMN IF NOT EXISTS input_file_sha256 text;

DO $migration$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conrelid = 'outdoor_evidence_imports'::regclass
           AND conname = 'outdoor_evidence_imports_acquisition_channel_check'
    ) THEN
        ALTER TABLE outdoor_evidence_imports
            ADD CONSTRAINT outdoor_evidence_imports_acquisition_channel_check
            CHECK (
                acquisition_channel IS NULL OR acquisition_channel IN (
                    'geofabrik_regional_extract', 'operator_supplied_local',
                    'other_reviewed_bulk'
                )
            );
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conrelid = 'outdoor_evidence_imports'::regclass
           AND conname = 'outdoor_evidence_imports_source_checksum_check'
    ) THEN
        ALTER TABLE outdoor_evidence_imports
            ADD CONSTRAINT outdoor_evidence_imports_source_checksum_check
            CHECK (
                (source_checksum_algorithm IS NULL AND source_checksum IS NULL) OR
                (source_checksum_algorithm = 'md5' AND source_checksum ~ '^[a-f0-9]{32}$') OR
                (source_checksum_algorithm = 'sha256' AND source_checksum ~ '^[a-f0-9]{64}$')
            );
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conrelid = 'outdoor_evidence_imports'::regclass
           AND conname = 'outdoor_evidence_imports_checksum_verification_check'
    ) THEN
        ALTER TABLE outdoor_evidence_imports
            ADD CONSTRAINT outdoor_evidence_imports_checksum_verification_check
            CHECK (
                (
                    source_checksum_algorithm IS NULL AND
                    source_checksum IS NULL AND
                    source_checksum_verified_at IS NULL
                ) OR (
                    source_checksum_verified_at IS NOT NULL AND (
                        (
                            source_checksum_algorithm = 'md5' AND
                            source_checksum ~ '^[a-f0-9]{32}$'
                        ) OR (
                            source_checksum_algorithm = 'sha256' AND
                            source_checksum ~ '^[a-f0-9]{64}$'
                        )
                    )
                )
            );
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conrelid = 'outdoor_evidence_imports'::regclass
           AND conname = 'outdoor_evidence_imports_checksum_timing_check'
    ) THEN
        ALTER TABLE outdoor_evidence_imports
            ADD CONSTRAINT outdoor_evidence_imports_checksum_timing_check
            CHECK (
                source_checksum_verified_at IS NULL OR (
                    source_checksum_verified_at >= retrieved_at AND
                    (
                        imported_at IS NULL OR
                        source_checksum_verified_at <= imported_at
                    )
                )
            );
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conrelid = 'outdoor_evidence_imports'::regclass
           AND conname = 'outdoor_evidence_imports_input_sha256_check'
    ) THEN
        ALTER TABLE outdoor_evidence_imports
            ADD CONSTRAINT outdoor_evidence_imports_input_sha256_check
            CHECK (input_file_sha256 IS NULL OR input_file_sha256 ~ '^[a-f0-9]{64}$');
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conrelid = 'outdoor_evidence_imports'::regclass
           AND conname = 'outdoor_evidence_imports_geofabrik_checksum_check'
    ) THEN
        ALTER TABLE outdoor_evidence_imports
            ADD CONSTRAINT outdoor_evidence_imports_geofabrik_checksum_check
            CHECK (
                acquisition_channel <> 'geofabrik_regional_extract' OR
                (
                    source_checksum_algorithm IS NOT NULL AND
                    source_checksum IS NOT NULL AND
                    source_checksum_verified_at IS NOT NULL
                )
            );
    END IF;
END
$migration$;

CREATE INDEX IF NOT EXISTS outdoor_evidence_imports_source_checksum_idx
    ON outdoor_evidence_imports (source_checksum_algorithm, source_checksum)
    WHERE source_checksum IS NOT NULL;

CREATE TABLE IF NOT EXISTS outdoor_research_source_policies (
    source_policy_id uuid PRIMARY KEY,
    source_id uuid NOT NULL REFERENCES outdoor_research_sources(source_id) ON DELETE RESTRICT,
    policy_version text NOT NULL CHECK (
        length(policy_version) BETWEEN 1 AND 80 AND
        policy_version ~ '^[a-z0-9]+(?:[._-][a-z0-9]+)*$'
    ),
    policy_schema_version integer NOT NULL CHECK (policy_schema_version > 0),
    adapter_schema_version text NOT NULL CHECK (length(adapter_schema_version) BETWEEN 1 AND 80),
    normalized_facts_allowed boolean NOT NULL DEFAULT false,
    derived_features_allowed boolean NOT NULL DEFAULT false,
    maximum_input_age_days integer NOT NULL CHECK (maximum_input_age_days BETWEEN 1 AND 14),
    review_reference text NOT NULL CHECK (length(review_reference) BETWEEN 1 AND 500),
    reviewed_at timestamptz NOT NULL,
    lifecycle_state text NOT NULL CHECK (lifecycle_state IN (
        'proposed', 'active', 'retired', 'blocked'
    )),
    retirement_reference text CHECK (
        retirement_reference IS NULL OR length(retirement_reference) BETWEEN 1 AND 500
    ),
    retired_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CHECK (updated_at >= created_at),
    CHECK (reviewed_at <= created_at),
    CHECK (
        (lifecycle_state = 'retired' AND retirement_reference IS NOT NULL AND retired_at IS NOT NULL) OR
        (lifecycle_state <> 'retired' AND retirement_reference IS NULL AND retired_at IS NULL)
    ),
    CHECK (retired_at IS NULL OR retired_at >= reviewed_at),
    CHECK (retired_at IS NULL OR retired_at <= updated_at),
    UNIQUE (source_id, policy_version),
    UNIQUE (source_policy_id, source_id)
);

CREATE OR REPLACE FUNCTION outdoor_research_validate_policy_timestamps()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
    IF NEW.reviewed_at > clock_timestamp() THEN
        RAISE EXCEPTION 'policy review timestamp cannot be in the future'
            USING ERRCODE = '23514';
    END IF;
    IF NEW.retired_at IS NOT NULL AND NEW.retired_at > clock_timestamp() THEN
        RAISE EXCEPTION 'policy retirement timestamp cannot be in the future'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END
$function$;

DO $migration$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
         WHERE tgrelid = 'outdoor_research_source_policies'::regclass
           AND tgname = 'outdoor_research_source_policies_timestamp_guard'
           AND NOT tgisinternal
    ) THEN
        CREATE TRIGGER outdoor_research_source_policies_timestamp_guard
        BEFORE INSERT OR UPDATE ON outdoor_research_source_policies
        FOR EACH ROW EXECUTE FUNCTION outdoor_research_validate_policy_timestamps();
    END IF;
END
$migration$;

CREATE INDEX IF NOT EXISTS outdoor_research_source_policies_active_idx
    ON outdoor_research_source_policies (source_id, policy_version)
    WHERE lifecycle_state = 'active';

CREATE TABLE IF NOT EXISTS outdoor_research_source_policy_scopes (
    source_policy_scope_id uuid PRIMARY KEY,
    source_policy_id uuid NOT NULL
        REFERENCES outdoor_research_source_policies(source_policy_id) ON DELETE RESTRICT,
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
    lifecycle_state text NOT NULL DEFAULT 'active' CHECK (
        lifecycle_state IN ('active', 'retired')
    ),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (source_policy_id, predicate, entity_category)
);

CREATE INDEX IF NOT EXISTS outdoor_research_source_policy_scopes_active_idx
    ON outdoor_research_source_policy_scopes (
        source_policy_id, predicate, entity_category
    ) WHERE lifecycle_state = 'active';

CREATE TABLE IF NOT EXISTS outdoor_research_source_policy_relationship_scopes (
    source_policy_relationship_scope_id uuid PRIMARY KEY,
    source_policy_id uuid NOT NULL
        REFERENCES outdoor_research_source_policies(source_policy_id) ON DELETE RESTRICT,
    relationship_type text NOT NULL CHECK (relationship_type IN (
        'entity_contained_in_region', 'poi_connected_to_hiking_route',
        'hut_operated_by_organization', 'trail_segment_member_of_route',
        'viewpoint_overlooks_feature', 'entity_near_entity',
        'assertion_supersedes_assertion'
    )),
    subject_entity_category text NOT NULL CHECK (subject_entity_category IN (
        'viewpoint', 'waterfall', 'peak', 'lake', 'alpine_hut', 'wilderness_hut',
        'official_campsite', 'designated_bivouac', 'emergency_shelter', 'trailhead',
        'landmark', 'hiking_route', 'trail_segment', 'region', 'organization'
    )),
    object_entity_category text NOT NULL CHECK (object_entity_category IN (
        'viewpoint', 'waterfall', 'peak', 'lake', 'alpine_hut', 'wilderness_hut',
        'official_campsite', 'designated_bivouac', 'emergency_shelter', 'trailhead',
        'landmark', 'hiking_route', 'trail_segment', 'region', 'organization'
    )),
    lifecycle_state text NOT NULL DEFAULT 'active' CHECK (
        lifecycle_state IN ('active', 'retired')
    ),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (
        source_policy_id, relationship_type,
        subject_entity_category, object_entity_category
    )
);

CREATE INDEX IF NOT EXISTS outdoor_research_source_policy_relationship_scopes_active_idx
    ON outdoor_research_source_policy_relationship_scopes (
        source_policy_id, relationship_type,
        subject_entity_category, object_entity_category
    ) WHERE lifecycle_state = 'active';

CREATE TABLE IF NOT EXISTS outdoor_research_projection_runs (
    projection_run_id uuid PRIMARY KEY,
    projection_key text NOT NULL CHECK (projection_key ~ '^[a-f0-9]{64}$'),
    source_id uuid NOT NULL REFERENCES outdoor_research_sources(source_id) ON DELETE RESTRICT,
    source_policy_id uuid NOT NULL,
    source_policy_version text NOT NULL CHECK (length(source_policy_version) BETWEEN 1 AND 80),
    adapter_schema_version text NOT NULL CHECK (length(adapter_schema_version) BETWEEN 1 AND 80),
    region_id text NOT NULL REFERENCES outdoor_evidence_regions(region_id) ON DELETE RESTRICT,
    input_import_id uuid NOT NULL,
    input_source_dataset_name text NOT NULL CHECK (
        length(input_source_dataset_name) BETWEEN 1 AND 160
    ),
    input_source_identifier text NOT NULL CHECK (
        length(input_source_identifier) BETWEEN 1 AND 500
    ),
    input_source_data_at timestamptz NOT NULL,
    input_retrieved_at timestamptz NOT NULL,
    input_imported_at timestamptz NOT NULL,
    input_acquisition_channel text NOT NULL CHECK (
        input_acquisition_channel IN (
            'geofabrik_regional_extract', 'operator_supplied_local',
            'other_reviewed_bulk'
        )
    ),
    input_source_checksum_algorithm text,
    input_source_checksum text,
    input_source_checksum_verified_at timestamptz,
    input_file_sha256 text NOT NULL CHECK (
        input_file_sha256 ~ '^[a-f0-9]{64}$'
    ),
    operator_invoked boolean NOT NULL CHECK (operator_invoked),
    started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    completed_at timestamptz,
    duration_milliseconds integer CHECK (
        duration_milliseconds IS NULL OR duration_milliseconds >= 0
    ),
    status text NOT NULL CHECK (status IN (
        'loading', 'validating', 'active', 'superseded', 'failed'
    )),
    aggregate_counts jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (
        jsonb_typeof(aggregate_counts) = 'object'
    ),
    failure_code text CHECK (
        failure_code IS NULL OR (
            length(failure_code) BETWEEN 1 AND 80 AND
            failure_code ~ '^[a-z0-9_]+$'
        )
    ),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CHECK (completed_at IS NULL OR completed_at >= started_at),
    CHECK (
        input_source_data_at <= input_retrieved_at AND
        input_retrieved_at <= input_imported_at AND
        input_imported_at <= started_at
    ),
    CHECK (
        (
            input_source_checksum_algorithm IS NULL AND
            input_source_checksum IS NULL AND
            input_source_checksum_verified_at IS NULL
        ) OR (
            input_source_checksum_verified_at BETWEEN
                input_retrieved_at AND input_imported_at AND (
                (
                    input_source_checksum_algorithm = 'md5' AND
                    input_source_checksum ~ '^[a-f0-9]{32}$'
                ) OR (
                    input_source_checksum_algorithm = 'sha256' AND
                    input_source_checksum ~ '^[a-f0-9]{64}$'
                )
            )
        )
    ),
    CHECK (
        input_acquisition_channel <> 'geofabrik_regional_extract' OR
        input_source_checksum_verified_at IS NOT NULL
    ),
    CHECK (
        (status IN ('active', 'superseded') AND completed_at IS NOT NULL AND failure_code IS NULL) OR
        (status = 'failed' AND completed_at IS NOT NULL AND failure_code IS NOT NULL) OR
        (status IN ('loading', 'validating') AND completed_at IS NULL AND failure_code IS NULL)
    ),
    FOREIGN KEY (source_policy_id, source_id)
        REFERENCES outdoor_research_source_policies(source_policy_id, source_id)
        ON DELETE RESTRICT,
    FOREIGN KEY (input_import_id, region_id)
        REFERENCES outdoor_evidence_imports(import_id, region_id)
        ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS outdoor_research_projection_runs_active_idx
    ON outdoor_research_projection_runs (source_id, region_id)
    WHERE status = 'active';
CREATE UNIQUE INDEX IF NOT EXISTS outdoor_research_projection_runs_active_key_idx
    ON outdoor_research_projection_runs (projection_key)
    WHERE status = 'active';
CREATE INDEX IF NOT EXISTS outdoor_research_projection_runs_input_idx
    ON outdoor_research_projection_runs (
        region_id, input_import_id, source_policy_version, status
    );

CREATE TABLE IF NOT EXISTS outdoor_research_osm_entity_identities (
    source_id uuid NOT NULL REFERENCES outdoor_research_sources(source_id) ON DELETE RESTRICT,
    osm_type text NOT NULL CHECK (osm_type IN ('node', 'way', 'relation')),
    osm_id bigint NOT NULL CHECK (osm_id > 0),
    entity_id uuid NOT NULL REFERENCES outdoor_research_entities(entity_id) ON DELETE RESTRICT,
    deterministic_id_version text NOT NULL CHECK (
        deterministic_id_version = 'trailmind-osm-identity-v1'
    ),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (source_id, osm_type, osm_id),
    UNIQUE (source_id, entity_id)
);

CREATE INDEX IF NOT EXISTS outdoor_research_osm_entity_identities_entity_idx
    ON outdoor_research_osm_entity_identities (entity_id);

CREATE TABLE IF NOT EXISTS outdoor_research_projection_entities (
    projection_run_id uuid NOT NULL
        REFERENCES outdoor_research_projection_runs(projection_run_id) ON DELETE RESTRICT,
    source_id uuid NOT NULL REFERENCES outdoor_research_sources(source_id) ON DELETE RESTRICT,
    entity_id uuid NOT NULL REFERENCES outdoor_research_entities(entity_id) ON DELETE RESTRICT,
    source_entity_link_id uuid NOT NULL
        REFERENCES outdoor_research_source_entities(source_entity_link_id) ON DELETE RESTRICT,
    osm_type text NOT NULL CHECK (osm_type IN ('node', 'way', 'relation')),
    osm_id bigint NOT NULL CHECK (osm_id > 0),
    entity_category text NOT NULL CHECK (entity_category IN (
        'viewpoint', 'waterfall', 'peak', 'lake', 'alpine_hut', 'wilderness_hut',
        'hiking_route', 'trail_segment'
    )),
    projected_geometry geometry(Geometry, 4326),
    source_version integer NOT NULL CHECK (source_version > 0),
    source_timestamp timestamptz NOT NULL,
    record_provenance jsonb NOT NULL CHECK (jsonb_typeof(record_provenance) = 'object'),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (projection_run_id, entity_id),
    UNIQUE (projection_run_id, osm_type, osm_id),
    FOREIGN KEY (source_id, osm_type, osm_id)
        REFERENCES outdoor_research_osm_entity_identities(source_id, osm_type, osm_id)
        ON DELETE RESTRICT,
    CHECK (
        projected_geometry IS NULL OR (
            GeometryType(projected_geometry) IN (
                'POINT', 'LINESTRING', 'MULTILINESTRING'
            ) AND
            ST_NDims(projected_geometry) = 2 AND
            ST_SRID(projected_geometry) = 4326 AND
            NOT ST_IsEmpty(projected_geometry) AND
            ST_IsValid(projected_geometry) AND
            ST_CoveredBy(
                projected_geometry,
                ST_MakeEnvelope(-180, -90, 180, 90, 4326)
            )
        )
    )
);

CREATE INDEX IF NOT EXISTS outdoor_research_projection_entities_identity_idx
    ON outdoor_research_projection_entities (source_id, osm_type, osm_id, projection_run_id);
CREATE INDEX IF NOT EXISTS outdoor_research_projection_entities_geometry_gist_idx
    ON outdoor_research_projection_entities USING GIST (projected_geometry);

CREATE TABLE IF NOT EXISTS outdoor_research_projection_assertions (
    projection_run_id uuid NOT NULL
        REFERENCES outdoor_research_projection_runs(projection_run_id) ON DELETE RESTRICT,
    assertion_id uuid NOT NULL
        REFERENCES outdoor_research_assertions(assertion_id) ON DELETE RESTRICT,
    entity_id uuid NOT NULL REFERENCES outdoor_research_entities(entity_id) ON DELETE RESTRICT,
    predicate text NOT NULL,
    record_provenance jsonb NOT NULL CHECK (jsonb_typeof(record_provenance) = 'object'),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (projection_run_id, assertion_id),
    UNIQUE (projection_run_id, entity_id, predicate),
    FOREIGN KEY (projection_run_id, entity_id)
        REFERENCES outdoor_research_projection_entities(projection_run_id, entity_id)
        ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS outdoor_research_projection_assertions_lookup_idx
    ON outdoor_research_projection_assertions (
        projection_run_id, entity_id, predicate, assertion_id
    );

CREATE TABLE IF NOT EXISTS outdoor_research_projection_relationships (
    projection_run_id uuid NOT NULL
        REFERENCES outdoor_research_projection_runs(projection_run_id) ON DELETE RESTRICT,
    relationship_id uuid NOT NULL
        REFERENCES outdoor_research_relationships(relationship_id) ON DELETE RESTRICT,
    subject_entity_id uuid NOT NULL
        REFERENCES outdoor_research_entities(entity_id) ON DELETE RESTRICT,
    object_entity_id uuid NOT NULL
        REFERENCES outdoor_research_entities(entity_id) ON DELETE RESTRICT,
    relationship_type text NOT NULL,
    record_provenance jsonb NOT NULL CHECK (jsonb_typeof(record_provenance) = 'object'),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (projection_run_id, relationship_id),
    UNIQUE (
        projection_run_id, relationship_type, subject_entity_id, object_entity_id
    ),
    FOREIGN KEY (projection_run_id, subject_entity_id)
        REFERENCES outdoor_research_projection_entities(projection_run_id, entity_id)
        ON DELETE RESTRICT,
    FOREIGN KEY (projection_run_id, object_entity_id)
        REFERENCES outdoor_research_projection_entities(projection_run_id, entity_id)
        ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS outdoor_research_projection_relationships_subject_idx
    ON outdoor_research_projection_relationships (
        projection_run_id, subject_entity_id, relationship_type
    );
CREATE INDEX IF NOT EXISTS outdoor_research_projection_relationships_object_idx
    ON outdoor_research_projection_relationships (
        projection_run_id, object_entity_id, relationship_type
    );

CREATE TABLE IF NOT EXISTS outdoor_research_projection_quarantines (
    quarantine_id uuid PRIMARY KEY,
    projection_run_id uuid NOT NULL
        REFERENCES outdoor_research_projection_runs(projection_run_id) ON DELETE RESTRICT,
    reason_code text NOT NULL CHECK (reason_code IN (
        'missing_source_version', 'missing_source_timestamp',
        'ambiguous_entity_category', 'invalid_geometry',
        'unsupported_category', 'missing_related_entity', 'invalid_value'
    )),
    record_kind text NOT NULL CHECK (record_kind IN (
        'poi', 'trail_segment', 'hiking_relation', 'hiking_relation_member'
    )),
    osm_type text NOT NULL CHECK (osm_type IN ('node', 'way', 'relation')),
    osm_id bigint NOT NULL CHECK (osm_id > 0),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (projection_run_id, reason_code, record_kind, osm_type, osm_id)
);

CREATE INDEX IF NOT EXISTS outdoor_research_projection_quarantines_run_idx
    ON outdoor_research_projection_quarantines (projection_run_id, reason_code, record_kind);

CREATE OR REPLACE FUNCTION outdoor_research_deterministic_uuid_v3(
    namespace_key text,
    identity_key text
)
RETURNS uuid
LANGUAGE sql
IMMUTABLE
STRICT
AS $function$
    SELECT (
        substr(digest, 1, 8) || '-' ||
        substr(digest, 9, 4) || '-3' ||
        substr(digest, 14, 3) || '-a' ||
        substr(digest, 18, 3) || '-' ||
        substr(digest, 21, 12)
    )::uuid
      FROM (SELECT md5(namespace_key || E'\x1f' || identity_key) AS digest) hashed
$function$;

CREATE OR REPLACE FUNCTION outdoor_research_validate_projection_assertion()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
    assertion_record outdoor_research_assertions%ROWTYPE;
    projection_source_id uuid;
BEGIN
    SELECT * INTO assertion_record
      FROM outdoor_research_assertions
     WHERE assertion_id = NEW.assertion_id;
    SELECT source_id INTO projection_source_id
      FROM outdoor_research_projection_runs
     WHERE projection_run_id = NEW.projection_run_id;
    IF assertion_record.entity_id <> NEW.entity_id OR
       assertion_record.predicate <> NEW.predicate OR
       assertion_record.source_id <> projection_source_id THEN
        RAISE EXCEPTION 'projection assertion lineage does not match graph assertion'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END
$function$;

CREATE OR REPLACE FUNCTION outdoor_research_validate_projection_relationship()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
    relationship_record outdoor_research_relationships%ROWTYPE;
    projection_source_id uuid;
BEGIN
    SELECT * INTO relationship_record
      FROM outdoor_research_relationships
     WHERE relationship_id = NEW.relationship_id;
    SELECT source_id INTO projection_source_id
      FROM outdoor_research_projection_runs
     WHERE projection_run_id = NEW.projection_run_id;
    IF relationship_record.subject_entity_id <> NEW.subject_entity_id OR
       relationship_record.object_entity_id <> NEW.object_entity_id OR
       relationship_record.relationship_type <> NEW.relationship_type OR
       relationship_record.source_id <> projection_source_id THEN
        RAISE EXCEPTION 'projection relationship lineage does not match graph relationship'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END
$function$;

DO $migration$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
         WHERE tgrelid = 'outdoor_research_projection_assertions'::regclass
           AND tgname = 'outdoor_research_projection_assertions_lineage'
           AND NOT tgisinternal
    ) THEN
        CREATE TRIGGER outdoor_research_projection_assertions_lineage
        BEFORE INSERT ON outdoor_research_projection_assertions
        FOR EACH ROW EXECUTE FUNCTION outdoor_research_validate_projection_assertion();
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
         WHERE tgrelid = 'outdoor_research_projection_relationships'::regclass
           AND tgname = 'outdoor_research_projection_relationships_lineage'
           AND NOT tgisinternal
    ) THEN
        CREATE TRIGGER outdoor_research_projection_relationships_lineage
        BEFORE INSERT ON outdoor_research_projection_relationships
        FOR EACH ROW EXECUTE FUNCTION outdoor_research_validate_projection_relationship();
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
         WHERE tgrelid = 'outdoor_research_osm_entity_identities'::regclass
           AND tgname = 'outdoor_research_osm_entity_identities_append_only'
           AND NOT tgisinternal
    ) THEN
        CREATE TRIGGER outdoor_research_osm_entity_identities_append_only
        BEFORE UPDATE OR DELETE ON outdoor_research_osm_entity_identities
        FOR EACH ROW EXECUTE FUNCTION outdoor_research_reject_audit_mutation();
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
         WHERE tgrelid = 'outdoor_research_projection_entities'::regclass
           AND tgname = 'outdoor_research_projection_entities_append_only'
           AND NOT tgisinternal
    ) THEN
        CREATE TRIGGER outdoor_research_projection_entities_append_only
        BEFORE UPDATE OR DELETE ON outdoor_research_projection_entities
        FOR EACH ROW EXECUTE FUNCTION outdoor_research_reject_audit_mutation();
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
         WHERE tgrelid = 'outdoor_research_projection_assertions'::regclass
           AND tgname = 'outdoor_research_projection_assertions_append_only'
           AND NOT tgisinternal
    ) THEN
        CREATE TRIGGER outdoor_research_projection_assertions_append_only
        BEFORE UPDATE OR DELETE ON outdoor_research_projection_assertions
        FOR EACH ROW EXECUTE FUNCTION outdoor_research_reject_audit_mutation();
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
         WHERE tgrelid = 'outdoor_research_projection_relationships'::regclass
           AND tgname = 'outdoor_research_projection_relationships_append_only'
           AND NOT tgisinternal
    ) THEN
        CREATE TRIGGER outdoor_research_projection_relationships_append_only
        BEFORE UPDATE OR DELETE ON outdoor_research_projection_relationships
        FOR EACH ROW EXECUTE FUNCTION outdoor_research_reject_audit_mutation();
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
         WHERE tgrelid = 'outdoor_research_projection_quarantines'::regclass
           AND tgname = 'outdoor_research_projection_quarantines_append_only'
           AND NOT tgisinternal
    ) THEN
        CREATE TRIGGER outdoor_research_projection_quarantines_append_only
        BEFORE UPDATE OR DELETE ON outdoor_research_projection_quarantines
        FOR EACH ROW EXECUTE FUNCTION outdoor_research_reject_audit_mutation();
    END IF;
END
$migration$;

CREATE OR REPLACE VIEW outdoor_research_active_projection_runs AS
SELECT run.*
  FROM outdoor_research_projection_runs run
  JOIN outdoor_research_sources source
    ON source.source_id = run.source_id
   AND source.lifecycle_state = 'active'
   AND source.normalized_facts_allowed = true
  JOIN outdoor_research_source_policies policy
    ON policy.source_policy_id = run.source_policy_id
   AND policy.source_id = run.source_id
   AND policy.policy_version = run.source_policy_version
   AND policy.adapter_schema_version = run.adapter_schema_version
   AND policy.lifecycle_state = 'active'
   AND policy.normalized_facts_allowed = true
   AND policy.derived_features_allowed = false
 WHERE run.status = 'active';

CREATE OR REPLACE VIEW outdoor_research_active_assertions AS
SELECT assertion.*
  FROM outdoor_research_active_projection_runs run
  JOIN outdoor_research_projection_assertions projection
    ON projection.projection_run_id = run.projection_run_id
  JOIN outdoor_research_assertions assertion
    ON assertion.assertion_id = projection.assertion_id
   AND assertion.assertion_state IN ('asserted', 'supersedes')
  JOIN outdoor_research_projection_entities projection_entity
    ON projection_entity.projection_run_id = run.projection_run_id
   AND projection_entity.entity_id = assertion.entity_id
  JOIN outdoor_research_source_policy_scopes policy_scope
    ON policy_scope.source_policy_id = run.source_policy_id
   AND policy_scope.predicate = assertion.predicate
   AND policy_scope.entity_category = projection_entity.entity_category
   AND policy_scope.lifecycle_state = 'active'
  JOIN outdoor_research_source_authority_scopes authority_scope
    ON authority_scope.source_id = run.source_id
   AND authority_scope.predicate = assertion.predicate
   AND authority_scope.entity_category = projection_entity.entity_category
   AND authority_scope.lifecycle_state = 'active';

CREATE OR REPLACE VIEW outdoor_research_active_relationships AS
SELECT relationship.*
  FROM outdoor_research_active_projection_runs run
  JOIN outdoor_research_projection_relationships projection
    ON projection.projection_run_id = run.projection_run_id
  JOIN outdoor_research_relationships relationship
    ON relationship.relationship_id = projection.relationship_id
  JOIN outdoor_research_projection_entities subject
    ON subject.projection_run_id = run.projection_run_id
   AND subject.entity_id = relationship.subject_entity_id
  JOIN outdoor_research_projection_entities object
    ON object.projection_run_id = run.projection_run_id
   AND object.entity_id = relationship.object_entity_id
  JOIN outdoor_research_source_policy_relationship_scopes policy_scope
    ON policy_scope.source_policy_id = run.source_policy_id
   AND policy_scope.relationship_type = relationship.relationship_type
   AND policy_scope.subject_entity_category = subject.entity_category
   AND policy_scope.object_entity_category = object.entity_category
   AND policy_scope.lifecycle_state = 'active';

CREATE OR REPLACE VIEW outdoor_research_active_entities AS
SELECT DISTINCT entity.*
  FROM outdoor_research_active_projection_runs run
  JOIN outdoor_research_projection_entities projection
    ON projection.projection_run_id = run.projection_run_id
  JOIN outdoor_research_entities entity
    ON entity.entity_id = projection.entity_id
  JOIN outdoor_research_active_assertions category_assertion
    ON category_assertion.entity_id = entity.entity_id
   AND category_assertion.source_id = run.source_id
   AND category_assertion.predicate = 'entity_category';

CREATE OR REPLACE VIEW outdoor_research_active_source_entities AS
SELECT DISTINCT source_entity.*
  FROM outdoor_research_active_projection_runs run
  JOIN outdoor_research_projection_entities projection
    ON projection.projection_run_id = run.projection_run_id
  JOIN outdoor_research_source_entities source_entity
    ON source_entity.source_entity_link_id = projection.source_entity_link_id
 WHERE source_entity.matching_status = 'matched';

ALTER TABLE outdoor_research_source_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE outdoor_research_source_policy_scopes ENABLE ROW LEVEL SECURITY;
ALTER TABLE outdoor_research_source_policy_relationship_scopes ENABLE ROW LEVEL SECURITY;
ALTER TABLE outdoor_research_projection_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE outdoor_research_osm_entity_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE outdoor_research_projection_entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE outdoor_research_projection_assertions ENABLE ROW LEVEL SECURITY;
ALTER TABLE outdoor_research_projection_relationships ENABLE ROW LEVEL SECURITY;
ALTER TABLE outdoor_research_projection_quarantines ENABLE ROW LEVEL SECURITY;
