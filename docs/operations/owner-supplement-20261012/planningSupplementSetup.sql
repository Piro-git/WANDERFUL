-- PROPOSAL ONLY. Install only after exact operator/Root review.
-- Does not activate an allowance, alter the original guard or reset any ledger.
BEGIN;
DO $$ BEGIN
 IF current_user<>'postgres' OR to_regnamespace('wanderful_owner_budget_v1') IS NOT NULL THEN RAISE EXCEPTION 'Supplement setup refuses role/existing schema'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='wanderful_owner_v1' AND c.relname='windows' AND t.tgname='guard_planning_wave' AND t.tgenabled='O' AND NOT t.tgisinternal) THEN RAISE EXCEPTION 'Original wave guard required'; END IF;
END $$;
CREATE SCHEMA wanderful_owner_budget_v1;
REVOKE ALL ON SCHEMA wanderful_owner_budget_v1 FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE wanderful_owner_budget_v1.supplement (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 parent_wave text NOT NULL CHECK(parent_wave='wanderful-live-wave-20261003'),
 approval_sha256 text NOT NULL CHECK(approval_sha256 ~ '^[a-f0-9]{64}$'),
 key_id text NOT NULL REFERENCES wanderful_owner_v1.keys(key_id),
 origin text NOT NULL CHECK(origin='https://backend-zeta-amber-69.vercel.app'),
 backend_tree text NOT NULL CHECK(backend_tree ~ '^[a-f0-9]{40}$'),
 activated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 expires_at timestamptz NOT NULL CHECK(expires_at>activated_at AND expires_at<=activated_at+interval '30 minutes'),
 baseline_google integer NOT NULL DEFAULT 4 CHECK(baseline_google=4),
 baseline_graphhopper integer NOT NULL DEFAULT 0 CHECK(baseline_graphhopper=0),
 intent_used integer NOT NULL DEFAULT 0 CHECK(intent_used BETWEEN 0 AND 1),
 requests_used integer NOT NULL DEFAULT 0 CHECK(requests_used BETWEEN 0 AND 1),
 google_used integer NOT NULL DEFAULT 0 CHECK(google_used BETWEEN 0 AND 8),
 graphhopper_used integer NOT NULL DEFAULT 0 CHECK(graphhopper_used BETWEEN 0 AND 6),
 intent_lease_id uuid REFERENCES wanderful_owner_v1.leases(lease_id) DEFERRABLE INITIALLY DEFERRED,
 plan_lease_id uuid REFERENCES wanderful_owner_v1.leases(lease_id) DEFERRABLE INITIALLY DEFERRED,
 last_provider_lease_id uuid REFERENCES wanderful_owner_v1.leases(lease_id) DEFERRABLE INITIALLY DEFERRED,
 revoked_at timestamptz,
 CHECK((intent_used=0)=(intent_lease_id IS NULL)),
 CHECK((requests_used=0)=(plan_lease_id IS NULL))
);
ALTER TABLE wanderful_owner_budget_v1.supplement ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON wanderful_owner_budget_v1.supplement FROM PUBLIC,anon,authenticated,service_role;
CREATE POLICY supplement_runtime ON wanderful_owner_budget_v1.supplement TO wanderful_owner_runtime USING(true) WITH CHECK(true);
GRANT USAGE ON SCHEMA wanderful_owner_budget_v1 TO wanderful_owner_runtime;
GRANT SELECT ON wanderful_owner_budget_v1.supplement TO wanderful_owner_runtime;
GRANT UPDATE(intent_used,requests_used,google_used,graphhopper_used,intent_lease_id,plan_lease_id,last_provider_lease_id) ON wanderful_owner_budget_v1.supplement TO wanderful_owner_runtime;

CREATE FUNCTION wanderful_owner_budget_v1.guard_write() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE delta integer;
BEGIN
 PERFORM pg_advisory_xact_lock(78261642489301);
 IF TG_OP IN ('DELETE','TRUNCATE') THEN RAISE EXCEPTION 'Supplement history cannot be deleted'; END IF;
 IF TG_OP='INSERT' THEN
  IF current_user<>'postgres' OR NEW.intent_used<>0 OR NEW.requests_used<>0 OR NEW.google_used<>0 OR NEW.graphhopper_used<>0 OR NEW.revoked_at IS NOT NULL OR NEW.last_provider_lease_id IS NOT NULL OR NEW.activated_at>clock_timestamp() OR NEW.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'Reviewed operator activation only'; END IF;
  RETURN NEW;
 END IF;
 IF ROW(NEW.singleton,NEW.parent_wave,NEW.approval_sha256,NEW.key_id,NEW.origin,NEW.backend_tree,NEW.activated_at,NEW.expires_at,NEW.baseline_google,NEW.baseline_graphhopper) IS DISTINCT FROM ROW(OLD.singleton,OLD.parent_wave,OLD.approval_sha256,OLD.key_id,OLD.origin,OLD.backend_tree,OLD.activated_at,OLD.expires_at,OLD.baseline_google,OLD.baseline_graphhopper) THEN RAISE EXCEPTION 'Supplement authorization immutable'; END IF;
 IF NEW.intent_used<OLD.intent_used OR NEW.requests_used<OLD.requests_used OR NEW.google_used<OLD.google_used OR NEW.graphhopper_used<OLD.graphhopper_used OR (OLD.intent_lease_id IS NOT NULL AND NEW.intent_lease_id IS DISTINCT FROM OLD.intent_lease_id) OR (OLD.plan_lease_id IS NOT NULL AND NEW.plan_lease_id IS DISTINCT FROM OLD.plan_lease_id) THEN RAISE EXCEPTION 'Supplement cannot reset or replace leases'; END IF;
 IF NEW.revoked_at IS DISTINCT FROM OLD.revoked_at THEN
  IF current_user<>'postgres' OR OLD.revoked_at IS NOT NULL OR NEW.revoked_at IS NULL OR ROW(NEW.intent_used,NEW.requests_used,NEW.google_used,NEW.graphhopper_used,NEW.intent_lease_id,NEW.plan_lease_id,NEW.last_provider_lease_id) IS DISTINCT FROM ROW(OLD.intent_used,OLD.requests_used,OLD.google_used,OLD.graphhopper_used,OLD.intent_lease_id,OLD.plan_lease_id,OLD.last_provider_lease_id) THEN RAISE EXCEPTION 'Only irreversible operator revocation'; END IF;
  RETURN NEW;
 END IF;
 delta=(NEW.intent_used-OLD.intent_used)+(NEW.requests_used-OLD.requests_used)+(NEW.google_used-OLD.google_used)+(NEW.graphhopper_used-OLD.graphhopper_used);
 IF current_user<>'wanderful_owner_runtime' OR OLD.revoked_at IS NOT NULL OR clock_timestamp()>=OLD.expires_at OR delta<>1 THEN RAISE EXCEPTION 'Single monotonic active admission/reservation required'; END IF;
 IF NEW.intent_used>OLD.intent_used AND OLD.requests_used<>0 THEN RAISE EXCEPTION 'No new intent after planning'; END IF;
 IF NEW.google_used+NEW.graphhopper_used>OLD.google_used+OLD.graphhopper_used THEN
  IF NEW.last_provider_lease_id IS NULL OR NEW.last_provider_lease_id IS DISTINCT FROM (CASE WHEN NEW.requests_used=1 THEN NEW.plan_lease_id ELSE NEW.intent_lease_id END) THEN RAISE EXCEPTION 'Provider reservation must use admitted current lease'; END IF;
 ELSE
  IF NEW.last_provider_lease_id IS DISTINCT FROM OLD.last_provider_lease_id THEN RAISE EXCEPTION 'No uncharged provider lease rewrite'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER supplement_write BEFORE INSERT OR UPDATE OR DELETE ON wanderful_owner_budget_v1.supplement FOR EACH ROW EXECUTE FUNCTION wanderful_owner_budget_v1.guard_write();
CREATE TRIGGER supplement_no_truncate BEFORE TRUNCATE ON wanderful_owner_budget_v1.supplement FOR EACH STATEMENT EXECUTE FUNCTION wanderful_owner_budget_v1.guard_write();

CREATE FUNCTION wanderful_owner_budget_v1.guard_totals() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE s wanderful_owner_budget_v1.supplement%ROWTYPE; g integer; h integer; r integer;
BEGIN
 IF TG_TABLE_NAME='windows' THEN
  IF NEW.scope NOT IN ('wanderful-live-wave-20261003:google','wanderful-live-wave-20261003:graphhopper','wanderful-live-wave-20261003:requests') THEN RETURN NULL; END IF;
 END IF;
 PERFORM pg_advisory_xact_lock(78261642489301);
 SELECT * INTO s FROM wanderful_owner_budget_v1.supplement WHERE singleton;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT COALESCE(max(cost) FILTER(WHERE scope='wanderful-live-wave-20261003:requests'),0),COALESCE(max(cost) FILTER(WHERE scope='wanderful-live-wave-20261003:google'),0),COALESCE(max(cost) FILTER(WHERE scope='wanderful-live-wave-20261003:graphhopper'),0) INTO r,g,h FROM wanderful_owner_v1.windows WHERE identity_hash='global';
 IF r<>2 OR g<>s.baseline_google+s.google_used OR h<>s.baseline_graphhopper+s.graphhopper_used OR g>16 OR h>10 THEN RAISE EXCEPTION 'Original and supplemental cumulative accounting must agree'; END IF;
 IF s.intent_used=1 AND NOT EXISTS(SELECT 1 FROM wanderful_owner_v1.leases l JOIN wanderful_owner_v1.sessions ss USING(token_hash) WHERE l.lease_id=s.intent_lease_id AND l.scope='intent' AND ss.key_id=s.key_id) THEN RAISE EXCEPTION 'Intent lease/key missing'; END IF;
 IF s.requests_used=1 AND NOT EXISTS(SELECT 1 FROM wanderful_owner_v1.leases l JOIN wanderful_owner_v1.sessions ss USING(token_hash) WHERE l.lease_id=s.plan_lease_id AND l.scope='intent' AND ss.key_id=s.key_id) THEN RAISE EXCEPTION 'Plan lease/key missing'; END IF;
 IF TG_TABLE_NAME='supplement' AND TG_OP='UPDATE' THEN
 IF NEW.google_used+NEW.graphhopper_used>OLD.google_used+OLD.graphhopper_used THEN
  IF NOT EXISTS(SELECT 1 FROM wanderful_owner_v1.leases l JOIN wanderful_owner_v1.sessions ss USING(token_hash) JOIN wanderful_owner_v1.keys k ON k.key_id=ss.key_id JOIN wanderful_owner_v1.owners o ON o.installation_id=ss.installation_id WHERE l.lease_id=s.last_provider_lease_id AND ss.key_id=s.key_id AND l.released_at IS NULL AND l.expires_at>clock_timestamp() AND ss.expires_at>clock_timestamp() AND ss.revoked_at IS NULL AND k.revoked_at IS NULL AND o.revoked_at IS NULL) THEN RAISE EXCEPTION 'Active authenticated provider lease required'; END IF;
 END IF;
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER supplement_totals AFTER INSERT OR UPDATE ON wanderful_owner_budget_v1.supplement DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION wanderful_owner_budget_v1.guard_totals();
CREATE CONSTRAINT TRIGGER supplement_cumulative_totals AFTER INSERT OR UPDATE ON wanderful_owner_v1.windows DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION wanderful_owner_budget_v1.guard_totals();
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA wanderful_owner_budget_v1 FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
