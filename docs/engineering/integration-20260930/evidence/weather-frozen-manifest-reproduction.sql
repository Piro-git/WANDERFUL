-- Exact unknown-relation condition used by the current app-security admission.
WITH expected(name) AS (VALUES ('app_attest_challenges'),('app_attest_keys'),
 ('app_attest_route_sessions'),('app_attest_request_ids'),
 ('app_attest_rate_windows'),('app_attest_provider_leases'))
SELECT NOT EXISTS (
 SELECT 1 FROM pg_catalog.pg_class r
 JOIN pg_catalog.pg_namespace n ON n.oid=r.relnamespace
 LEFT JOIN expected e ON e.name=r.relname
 WHERE n.nspname='trailmind_app' AND r.relkind IN ('r','p','v','m','f')
 AND e.name IS NULL AND (
 pg_catalog.has_table_privilege(current_user,r.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
 OR pg_catalog.has_any_column_privilege(current_user,r.oid,'SELECT,INSERT,UPDATE,REFERENCES'))
) AS frozen_manifest_accepts_weather_grants;
