-- Pin the eight security-invoker helper functions reported by the Supabase
-- security advisor. The path contains only the system catalog and the
-- owner-controlled application schema; caller-writable schemas are excluded.
--
-- This migration is intentionally repeatable. It changes function metadata
-- only and does not create policies, grant privileges, or modify data.

ALTER FUNCTION trailmind_app.outdoor_research_reject_audit_mutation()
    SET search_path = pg_catalog, trailmind_app;
ALTER FUNCTION trailmind_app.outdoor_research_validate_assertion_write()
    SET search_path = pg_catalog, trailmind_app;
ALTER FUNCTION trailmind_app.outdoor_research_validate_relationship_source_class()
    SET search_path = pg_catalog, trailmind_app;
ALTER FUNCTION trailmind_app.outdoor_research_validate_derived_feature_write()
    SET search_path = pg_catalog, trailmind_app;
ALTER FUNCTION trailmind_app.outdoor_research_validate_policy_timestamps()
    SET search_path = pg_catalog, trailmind_app;
ALTER FUNCTION trailmind_app.outdoor_research_deterministic_uuid_v3(text, text)
    SET search_path = pg_catalog, trailmind_app;
ALTER FUNCTION trailmind_app.outdoor_research_validate_projection_assertion()
    SET search_path = pg_catalog, trailmind_app;
ALTER FUNCTION trailmind_app.outdoor_research_validate_projection_relationship()
    SET search_path = pg_catalog, trailmind_app;
