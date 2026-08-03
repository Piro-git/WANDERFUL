-- Bound mapped-route proximity preselection to the same representative point
-- used by the authoritative geography-distance decision.
CREATE INDEX IF NOT EXISTS
    outdoor_research_projection_entities_trail_point_gist_idx
    ON outdoor_research_projection_entities
    USING GIST (ST_PointOnSurface(projected_geometry))
    WHERE entity_category = 'trail_segment'
      AND projected_geometry IS NOT NULL;
