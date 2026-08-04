-- Support authoritative metre-bounded trail-access lookup without a
-- latitude-blind degree prefilter. Projection rows remain append-only.
CREATE INDEX IF NOT EXISTS
    outdoor_research_projection_entities_trail_geography_gist_idx
    ON outdoor_research_projection_entities
    USING GIST ((projected_geometry::geography))
    WHERE entity_category = 'trail_segment'
      AND projected_geometry IS NOT NULL;
