CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS outdoor_evidence_imports (
    import_id uuid PRIMARY KEY,
    region_id text NOT NULL,
    source_dataset_name text NOT NULL CHECK (length(source_dataset_name) BETWEEN 1 AND 160),
    source_identifier text NOT NULL CHECK (length(source_identifier) BETWEEN 1 AND 500),
    source_data_at timestamptz,
    retrieved_at timestamptz NOT NULL,
    imported_at timestamptz,
    tool_version text NOT NULL CHECK (length(tool_version) BETWEEN 1 AND 120),
    import_schema_version integer NOT NULL CHECK (import_schema_version > 0),
    status text NOT NULL CHECK (status IN ('pending', 'loading', 'ready', 'active', 'superseded', 'failed')),
    aggregate_counts jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(aggregate_counts) = 'object'),
    failure_code text CHECK (failure_code IS NULL OR length(failure_code) BETWEEN 1 AND 80),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS outdoor_evidence_imports_region_status_idx
    ON outdoor_evidence_imports (region_id, status, imported_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS outdoor_evidence_imports_identity_region_idx
    ON outdoor_evidence_imports (import_id, region_id);

CREATE TABLE IF NOT EXISTS outdoor_evidence_regions (
    region_id text PRIMARY KEY,
    name text NOT NULL CHECK (length(name) BETWEEN 1 AND 160),
    definition_version integer NOT NULL CHECK (definition_version > 0),
    boundary_kind text NOT NULL CHECK (boundary_kind = 'trailmind-operational-polygon'),
    coordinate_reference_system text NOT NULL CHECK (coordinate_reference_system = 'EPSG:4326'),
    metric_srid integer NOT NULL CHECK (metric_srid > 0),
    boundary geometry(MultiPolygon, 4326) NOT NULL,
    boundary_metric geometry NOT NULL CHECK (
        GeometryType(boundary_metric) = 'MULTIPOLYGON' AND
        ST_NDims(boundary_metric) = 2 AND ST_SRID(boundary_metric) > 0
    ),
    supported_feature_classes text[] NOT NULL,
    freshness_threshold_days integer NOT NULL CHECK (freshness_threshold_days BETWEEN 1 AND 365),
    path_match_tolerance_meters integer NOT NULL CHECK (path_match_tolerance_meters BETWEEN 1 AND 100),
    active_import_id uuid,
    enabled boolean NOT NULL DEFAULT true,
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

DO $migration$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'outdoor_evidence_imports'::regclass
          AND conname = 'outdoor_evidence_imports_region_fk'
    ) THEN
        ALTER TABLE outdoor_evidence_imports
            ADD CONSTRAINT outdoor_evidence_imports_region_fk
            FOREIGN KEY (region_id) REFERENCES outdoor_evidence_regions(region_id)
            DEFERRABLE INITIALLY DEFERRED;
    END IF;
END
$migration$;

DO $migration$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'outdoor_evidence_regions'::regclass
          AND conname = 'outdoor_evidence_regions_active_import_region_fk'
    ) THEN
        ALTER TABLE outdoor_evidence_regions
            ADD CONSTRAINT outdoor_evidence_regions_active_import_region_fk
            FOREIGN KEY (active_import_id, region_id)
            REFERENCES outdoor_evidence_imports(import_id, region_id)
            DEFERRABLE INITIALLY DEFERRED;
    END IF;
END
$migration$;

CREATE INDEX IF NOT EXISTS outdoor_evidence_regions_boundary_gist_idx
    ON outdoor_evidence_regions USING GIST (boundary);
CREATE INDEX IF NOT EXISTS outdoor_evidence_regions_boundary_metric_gist_idx
    ON outdoor_evidence_regions USING GIST (boundary_metric);
CREATE INDEX IF NOT EXISTS outdoor_evidence_regions_active_import_idx
    ON outdoor_evidence_regions (active_import_id) WHERE active_import_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS outdoor_evidence_pois (
    import_id uuid NOT NULL REFERENCES outdoor_evidence_imports(import_id) ON DELETE CASCADE,
    region_id text NOT NULL REFERENCES outdoor_evidence_regions(region_id),
    osm_type text NOT NULL CHECK (osm_type IN ('node', 'way', 'relation')),
    osm_id bigint NOT NULL CHECK (osm_id > 0),
    category text NOT NULL CHECK (category IN ('viewpoint', 'peak', 'lake', 'waterfall', 'alpineHut', 'wildernessHut')),
    name text CHECK (name IS NULL OR length(name) <= 160),
    reference text CHECK (reference IS NULL OR length(reference) <= 80),
    geom geometry(Geometry, 4326) NOT NULL,
    geom_metric geometry NOT NULL CHECK (
        GeometryType(geom_metric) IN ('POINT', 'POLYGON', 'MULTIPOLYGON') AND
        ST_NDims(geom_metric) = 2 AND ST_SRID(geom_metric) > 0
    ),
    source_version integer CHECK (source_version IS NULL OR source_version > 0),
    source_timestamp timestamptz,
    evidence_tags jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(evidence_tags) = 'object'),
    PRIMARY KEY (import_id, osm_type, osm_id)
);

CREATE INDEX IF NOT EXISTS outdoor_evidence_pois_geom_gist_idx
    ON outdoor_evidence_pois USING GIST (geom);
CREATE INDEX IF NOT EXISTS outdoor_evidence_pois_geom_metric_gist_idx
    ON outdoor_evidence_pois USING GIST (geom_metric);
CREATE INDEX IF NOT EXISTS outdoor_evidence_pois_region_import_category_idx
    ON outdoor_evidence_pois (region_id, import_id, category);

DO $migration$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'outdoor_evidence_pois'::regclass
          AND conname = 'outdoor_evidence_pois_import_region_fk'
    ) THEN
        ALTER TABLE outdoor_evidence_pois
            ADD CONSTRAINT outdoor_evidence_pois_import_region_fk
            FOREIGN KEY (import_id, region_id)
            REFERENCES outdoor_evidence_imports(import_id, region_id) ON DELETE CASCADE;
    END IF;
END
$migration$;

CREATE TABLE IF NOT EXISTS outdoor_evidence_trail_segments (
    import_id uuid NOT NULL REFERENCES outdoor_evidence_imports(import_id) ON DELETE CASCADE,
    region_id text NOT NULL REFERENCES outdoor_evidence_regions(region_id),
    osm_type text NOT NULL DEFAULT 'way' CHECK (osm_type = 'way'),
    osm_id bigint NOT NULL CHECK (osm_id > 0),
    highway_class text NOT NULL CHECK (highway_class IN (
        'path', 'footway', 'track', 'steps', 'bridleway', 'cycleway', 'pedestrian',
        'service', 'unclassified', 'residential', 'living_street', 'tertiary',
        'secondary', 'primary', 'trunk', 'motorway', 'road', 'other'
    )),
    surface text CHECK (surface IS NULL OR surface IN (
        'paved', 'asphalt', 'concrete', 'concrete:lanes', 'concrete:plates',
        'paving_stones', 'sett', 'cobblestone', 'unhewn_cobblestone', 'compacted',
        'fine_gravel', 'gravel', 'pebblestone', 'rock', 'dirt', 'earth', 'ground',
        'grass', 'mud', 'sand', 'wood', 'metal', 'other'
    )),
    trail_visibility text CHECK (trail_visibility IS NULL OR trail_visibility IN (
        'excellent', 'good', 'intermediate', 'bad', 'horrible', 'no'
    )),
    sac_scale text CHECK (sac_scale IS NULL OR sac_scale IN (
        'strolling', 'hiking', 'mountain_hiking', 'demanding_mountain_hiking',
        'alpine_hiking', 'demanding_alpine_hiking', 'difficult_alpine_hiking'
    )),
    access_tag text CHECK (access_tag IS NULL OR length(access_tag) <= 40),
    foot_tag text CHECK (foot_tag IS NULL OR length(foot_tag) <= 40),
    access_conditional text CHECK (access_conditional IS NULL OR length(access_conditional) <= 256),
    foot_conditional text CHECK (foot_conditional IS NULL OR length(foot_conditional) <= 256),
    seasonal_tag text CHECK (seasonal_tag IS NULL OR length(seasonal_tag) <= 40),
    permit_tag text CHECK (permit_tag IS NULL OR length(permit_tag) <= 40),
    geom geometry(MultiLineString, 4326) NOT NULL,
    geom_metric geometry NOT NULL CHECK (
        GeometryType(geom_metric) = 'MULTILINESTRING' AND
        ST_NDims(geom_metric) = 2 AND ST_SRID(geom_metric) > 0
    ),
    source_version integer CHECK (source_version IS NULL OR source_version > 0),
    source_timestamp timestamptz,
    PRIMARY KEY (import_id, osm_type, osm_id)
);

CREATE INDEX IF NOT EXISTS outdoor_evidence_trail_segments_geom_gist_idx
    ON outdoor_evidence_trail_segments USING GIST (geom);
CREATE INDEX IF NOT EXISTS outdoor_evidence_trail_segments_geom_metric_gist_idx
    ON outdoor_evidence_trail_segments USING GIST (geom_metric);
CREATE INDEX IF NOT EXISTS outdoor_evidence_trail_segments_region_import_highway_idx
    ON outdoor_evidence_trail_segments (region_id, import_id, highway_class);
CREATE UNIQUE INDEX IF NOT EXISTS outdoor_evidence_trail_segments_identity_region_idx
    ON outdoor_evidence_trail_segments (import_id, region_id, osm_type, osm_id);

DO $migration$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'outdoor_evidence_trail_segments'::regclass
          AND conname = 'outdoor_evidence_trail_segments_import_region_fk'
    ) THEN
        ALTER TABLE outdoor_evidence_trail_segments
            ADD CONSTRAINT outdoor_evidence_trail_segments_import_region_fk
            FOREIGN KEY (import_id, region_id)
            REFERENCES outdoor_evidence_imports(import_id, region_id) ON DELETE CASCADE;
    END IF;
END
$migration$;

CREATE TABLE IF NOT EXISTS outdoor_evidence_hiking_relations (
    import_id uuid NOT NULL REFERENCES outdoor_evidence_imports(import_id) ON DELETE CASCADE,
    region_id text NOT NULL REFERENCES outdoor_evidence_regions(region_id),
    osm_type text NOT NULL DEFAULT 'relation' CHECK (osm_type = 'relation'),
    osm_id bigint NOT NULL CHECK (osm_id > 0),
    route_type text NOT NULL CHECK (route_type IN ('hiking', 'foot')),
    network text CHECK (network IS NULL OR network IN ('iwn', 'nwn', 'rwn', 'lwn')),
    name text CHECK (name IS NULL OR length(name) <= 160),
    reference text CHECK (reference IS NULL OR length(reference) <= 80),
    operator text CHECK (operator IS NULL OR length(operator) <= 160),
    symbol text CHECK (symbol IS NULL OR length(symbol) <= 160),
    osmc_symbol text CHECK (osmc_symbol IS NULL OR length(osmc_symbol) <= 160),
    state text CHECK (state IS NULL OR state IN ('current', 'alternate', 'temporary', 'connection')),
    source_version integer CHECK (source_version IS NULL OR source_version > 0),
    source_timestamp timestamptz,
    PRIMARY KEY (import_id, osm_type, osm_id)
);

CREATE INDEX IF NOT EXISTS outdoor_evidence_hiking_relations_region_import_network_idx
    ON outdoor_evidence_hiking_relations (region_id, import_id, network);
CREATE UNIQUE INDEX IF NOT EXISTS outdoor_evidence_hiking_relations_identity_region_idx
    ON outdoor_evidence_hiking_relations (import_id, region_id, osm_type, osm_id);

DO $migration$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'outdoor_evidence_hiking_relations'::regclass
          AND conname = 'outdoor_evidence_hiking_relations_import_region_fk'
    ) THEN
        ALTER TABLE outdoor_evidence_hiking_relations
            ADD CONSTRAINT outdoor_evidence_hiking_relations_import_region_fk
            FOREIGN KEY (import_id, region_id)
            REFERENCES outdoor_evidence_imports(import_id, region_id) ON DELETE CASCADE;
    END IF;
END
$migration$;

CREATE TABLE IF NOT EXISTS outdoor_evidence_hiking_relation_members (
    import_id uuid NOT NULL,
    region_id text NOT NULL,
    relation_osm_type text NOT NULL DEFAULT 'relation' CHECK (relation_osm_type = 'relation'),
    relation_osm_id bigint NOT NULL CHECK (relation_osm_id > 0),
    segment_osm_type text NOT NULL DEFAULT 'way' CHECK (segment_osm_type = 'way'),
    segment_osm_id bigint NOT NULL CHECK (segment_osm_id > 0),
    member_role text NOT NULL DEFAULT '' CHECK (length(member_role) <= 80),
    member_sequence integer NOT NULL CHECK (member_sequence >= 0),
    PRIMARY KEY (import_id, relation_osm_type, relation_osm_id, segment_osm_type, segment_osm_id, member_sequence),
    FOREIGN KEY (import_id, relation_osm_type, relation_osm_id)
        REFERENCES outdoor_evidence_hiking_relations(import_id, osm_type, osm_id) ON DELETE CASCADE,
    FOREIGN KEY (import_id, segment_osm_type, segment_osm_id)
        REFERENCES outdoor_evidence_trail_segments(import_id, osm_type, osm_id) ON DELETE CASCADE,
    FOREIGN KEY (region_id) REFERENCES outdoor_evidence_regions(region_id)
);

CREATE INDEX IF NOT EXISTS outdoor_evidence_relation_members_segment_idx
    ON outdoor_evidence_hiking_relation_members (import_id, segment_osm_type, segment_osm_id);
CREATE INDEX IF NOT EXISTS outdoor_evidence_relation_members_relation_idx
    ON outdoor_evidence_hiking_relation_members (region_id, import_id, relation_osm_id);

DO $migration$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'outdoor_evidence_hiking_relation_members'::regclass
          AND conname = 'outdoor_evidence_relation_members_relation_region_fk'
    ) THEN
        ALTER TABLE outdoor_evidence_hiking_relation_members
            ADD CONSTRAINT outdoor_evidence_relation_members_relation_region_fk
            FOREIGN KEY (import_id, region_id, relation_osm_type, relation_osm_id)
            REFERENCES outdoor_evidence_hiking_relations(import_id, region_id, osm_type, osm_id)
            ON DELETE CASCADE;
    END IF;
END
$migration$;

DO $migration$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'outdoor_evidence_hiking_relation_members'::regclass
          AND conname = 'outdoor_evidence_relation_members_segment_region_fk'
    ) THEN
        ALTER TABLE outdoor_evidence_hiking_relation_members
            ADD CONSTRAINT outdoor_evidence_relation_members_segment_region_fk
            FOREIGN KEY (import_id, region_id, segment_osm_type, segment_osm_id)
            REFERENCES outdoor_evidence_trail_segments(import_id, region_id, osm_type, osm_id)
            ON DELETE CASCADE;
    END IF;
END
$migration$;

ALTER TABLE outdoor_evidence_regions ENABLE ROW LEVEL SECURITY;
ALTER TABLE outdoor_evidence_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE outdoor_evidence_pois ENABLE ROW LEVEL SECURITY;
ALTER TABLE outdoor_evidence_trail_segments ENABLE ROW LEVEL SECURITY;
ALTER TABLE outdoor_evidence_hiking_relations ENABLE ROW LEVEL SECURITY;
ALTER TABLE outdoor_evidence_hiking_relation_members ENABLE ROW LEVEL SECURITY;
