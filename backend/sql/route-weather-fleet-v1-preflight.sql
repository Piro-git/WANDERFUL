-- Run using the exact app-security runtime login and search_path used by the
-- backend. This checks the weather component only, not service admission.
-- Activation also requires a separately reviewed extension of the frozen
-- App Attest privilege manifest; its current exact allowlist rejects these grants.
SELECT current_user = 'app_security_runtime_role'
  -- Match the existing app-security pool's admitted catalog-first path.
  -- current_schema() is pg_catalog here, not the application schema.
  AND pg_catalog.replace(pg_catalog.replace(current_setting('search_path'), ' ', ''), '"', '')
      = 'pg_catalog,trailmind_app,pg_temp'
  AND pg_catalog.to_regclass('route_weather_control') = 'trailmind_app.route_weather_control'::regclass
  AND pg_catalog.to_regclass('route_weather_cache') = 'trailmind_app.route_weather_cache'::regclass
  AND (SELECT pg_catalog.count(*) FROM trailmind_app.route_weather_control) = 1
  AND (SELECT singleton FROM trailmind_app.route_weather_control) = true
  AND (SELECT relrowsecurity FROM pg_catalog.pg_class
       WHERE oid = 'trailmind_app.route_weather_control'::regclass) = true
  AND (SELECT relrowsecurity FROM pg_catalog.pg_class
       WHERE oid = 'trailmind_app.route_weather_cache'::regclass) = true
  AND pg_catalog.has_table_privilege(current_user,'trailmind_app.route_weather_control','SELECT,UPDATE')
  AND pg_catalog.has_table_privilege(current_user,'trailmind_app.route_weather_cache','SELECT,INSERT,UPDATE,DELETE')
  AS ready;
