ALTER TABLE outdoor_research_projection_entities
    DROP CONSTRAINT IF EXISTS
        outdoor_research_projection_entities_projected_geometry_check;

ALTER TABLE outdoor_research_projection_entities
    ADD CONSTRAINT
        outdoor_research_projection_entities_projected_geometry_check
    CHECK (
        projected_geometry IS NULL OR (
            GeometryType(projected_geometry) IN (
                'POINT', 'LINESTRING', 'MULTILINESTRING',
                'POLYGON', 'MULTIPOLYGON'
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
    );
