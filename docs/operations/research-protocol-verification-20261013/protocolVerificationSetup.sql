-- PROPOSAL ONLY: one separate fixed operator verification; no live execution.
-- Existing spent native records and original wave guard are never rewritten.
BEGIN;
SELECT pg_advisory_xact_lock(78261642489301);
DO $$ DECLARE r integer;g integer;h integer; BEGIN
 IF current_user<>'postgres' OR to_regclass('wanderful_owner_budget_v1.protocol_verification') IS NOT NULL THEN RAISE EXCEPTION 'Reviewed one-time protocol setup only';END IF;
 SELECT COALESCE(max(cost) FILTER(WHERE scope='wanderful-live-wave-20261003:requests'),0),COALESCE(max(cost) FILTER(WHERE scope='wanderful-live-wave-20261003:google'),0),COALESCE(max(cost) FILTER(WHERE scope='wanderful-live-wave-20261003:graphhopper'),0) INTO r,g,h FROM wanderful_owner_v1.windows WHERE identity_hash='global';
 IF r<>2 OR g<>10 OR h<>0 OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='wanderful_owner_v1.windows'::regclass AND tgname='guard_planning_wave' AND tgenabled='O' AND tgtype=31 AND NOT tgisinternal) THEN RAISE EXCEPTION 'Exact guarded global baseline required';END IF;
 IF md5(pg_get_functiondef('wanderful_owner_v1.guard_planning_wave()'::regprocedure))<>'d8b7ecca4776f5ae4346f9b16298da6d' THEN RAISE EXCEPTION 'Original wave guard changed';END IF;
 IF NOT EXISTS(SELECT 1 FROM wanderful_owner_budget_v1.supplement WHERE singleton AND intent_used=1 AND requests_used=1 AND google_used=2 AND graphhopper_used=0) OR
 NOT EXISTS(SELECT 1 FROM wanderful_owner_budget_v1.entitlements WHERE sequence=2 AND diagnostic_used=1 AND intent_used=1 AND requests_used=1 AND google_used=3 AND graphhopper_used=0 AND phone_expires_at<=clock_timestamp()) OR
 EXISTS(SELECT 1 FROM wanderful_owner_v1.leases WHERE released_at IS NULL AND expires_at>clock_timestamp()) THEN RAISE EXCEPTION 'Exact spent inactive native baseline required';END IF;
END $$;
CREATE TABLE wanderful_owner_budget_v1.protocol_verification (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 approval_sha256 text NOT NULL CHECK(approval_sha256 ~ '^[a-f0-9]{64}$'),
 backend_tree text NOT NULL CHECK(backend_tree ~ '^[a-f0-9]{40}$'),
 input_sha256 text NOT NULL CHECK(input_sha256 ~ '^[a-f0-9]{64}$'),
 key_id text NOT NULL REFERENCES wanderful_owner_v1.keys(key_id),
 origin text NOT NULL CHECK(origin='https://backend-zeta-amber-69.vercel.app'),
 activated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 expires_at timestamptz NOT NULL CHECK(expires_at>activated_at AND expires_at<=activated_at+interval '10 minutes'),
 google_used integer NOT NULL DEFAULT 0 CHECK(google_used BETWEEN 0 AND 2),
 job_id uuid,claimed_at timestamptz,
 readback_authorized boolean NOT NULL DEFAULT false,
 revoked_at timestamptz,
 first_status text CHECK(first_status IN ('completed','in_progress','requires_action','failed','cancelled','incomplete','budget_exceeded','queued','missing','unrecognized')),
 first_http_status integer CHECK(first_http_status BETWEEN 100 AND 599),
 first_search_calls integer CHECK(first_search_calls BETWEEN 0 AND 60),
 first_page_calls integer CHECK(first_page_calls BETWEEN 0 AND 60),
 first_citation_count integer CHECK(first_citation_count BETWEEN 0 AND 60),
 first_pending_builtin integer CHECK(first_pending_builtin BETWEEN 0 AND 60),
 first_pending_planning integer CHECK(first_pending_planning BETWEEN 0 AND 60),
 first_pending_other integer CHECK(first_pending_other BETWEEN 0 AND 60),
 first_total_tokens integer CHECK(first_total_tokens BETWEEN 0 AND 1000000),
 last_status text CHECK(last_status IN ('completed','in_progress','requires_action','failed','cancelled','incomplete','budget_exceeded','queued','missing','unrecognized')),
 last_http_status integer CHECK(last_http_status BETWEEN 100 AND 599),
 last_pending_builtin integer CHECK(last_pending_builtin BETWEEN 0 AND 60),
 last_pending_planning integer CHECK(last_pending_planning BETWEEN 0 AND 60),
 last_pending_other integer CHECK(last_pending_other BETWEEN 0 AND 60),
 last_total_tokens integer CHECK(last_total_tokens BETWEEN 0 AND 1000000),
 full_research_valid boolean,
 result_failure text CHECK(result_failure IN ('configuration_missing','cancelled','timed_out','rate_limited','provider_rejected','provider_unavailable','redirect_rejected','invalid_content_type','response_too_large','invalid_response','web_research_unverified','web_research_unavailable','research_budget_exhausted','research_timed_out','invalid_route_evidence','quality_review_unavailable','invalid_quality_review','research_no_acceptable_route','invalid_request','route_session_invalid','route_session_expired','route_session_exhausted','app_attest_rate_limited','none','verification_unavailable','unclassified')),
 result_stage text CHECK(result_stage IN ('web_action_http','web_action_validation','web_search_http','web_search_validation','web_page_validation','web_followup_http','web_followup_validation','unclassified')),
 validation_reason text CHECK(validation_reason IN ('research_action_invalid','provider_not_completed','model_output_failed','provider_steps_invalid', 'search_call_invalid', 'search_queries_missing', 'search_result_invalid', 'search_suggestions_missing', 'search_suggestions_invalid', 'page_call_invalid', 'page_result_invalid', 'model_content_invalid', 'answer_text_invalid', 'annotation_list_invalid', 'citation_url_invalid', 'citation_title_invalid', 'citation_range_missing', 'citation_range_invalid', 'grounded_text_missing', 'search_evidence_missing', 'source_page_evidence_missing', 'web_limits_exceeded', 'unicode_invalid', 'web_envelope_invalid')),
 validated_search_calls integer CHECK(validated_search_calls BETWEEN 1 AND 60),
 validated_query_count integer CHECK(validated_query_count BETWEEN 0 AND 1200),
 validated_read_count integer CHECK(validated_read_count BETWEEN 1 AND 20),
 validated_citation_count integer CHECK(validated_citation_count BETWEEN 1 AND 40),
 result_finished_at timestamptz,
 CHECK((job_id IS NULL)=(claimed_at IS NULL)),
 CHECK(google_used<2 OR readback_authorized),
 CHECK(NOT readback_authorized OR (google_used>=1 AND first_status='completed' AND first_search_calls>=1 AND first_page_calls=0 AND first_citation_count>=1)),
 CHECK(full_research_valid IS TRUE OR (validated_search_calls IS NULL AND validated_query_count IS NULL AND validated_read_count IS NULL AND validated_citation_count IS NULL)),
 CHECK(full_research_valid IS NULL OR full_research_valid=(result_failure='none')),
 CHECK(full_research_valid IS DISTINCT FROM true OR COALESCE((result_failure='none' AND google_used>=1 AND first_status='completed' AND last_status='completed' AND first_http_status BETWEEN 200 AND 299 AND last_http_status BETWEEN 200 AND 299 AND validated_search_calls IS NOT NULL AND validated_read_count IS NOT NULL AND validated_citation_count IS NOT NULL),false))
);
ALTER TABLE wanderful_owner_budget_v1.protocol_verification ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON wanderful_owner_budget_v1.protocol_verification FROM PUBLIC,anon,authenticated,service_role;
CREATE POLICY protocol_verification_runtime ON wanderful_owner_budget_v1.protocol_verification TO wanderful_owner_runtime USING(true) WITH CHECK(true);
GRANT SELECT ON wanderful_owner_budget_v1.protocol_verification TO wanderful_owner_runtime;
GRANT UPDATE(job_id,claimed_at,google_used,readback_authorized,first_status,first_http_status,first_search_calls,first_page_calls,first_citation_count,first_pending_builtin,first_pending_planning,first_pending_other,first_total_tokens,last_status,last_http_status,last_pending_builtin,last_pending_planning,last_pending_other,last_total_tokens,full_research_valid,result_failure,result_stage,validation_reason,validated_search_calls,validated_query_count,validated_read_count,validated_citation_count,result_finished_at) ON wanderful_owner_budget_v1.protocol_verification TO wanderful_owner_runtime;
CREATE FUNCTION wanderful_owner_budget_v1.guard_protocol_verification_write() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE result_fields text[] := ARRAY['first_status','first_http_status','first_search_calls','first_page_calls','first_citation_count','first_pending_builtin','first_pending_planning','first_pending_other','first_total_tokens','last_status','last_http_status','last_pending_builtin','last_pending_planning','last_pending_other','last_total_tokens','full_research_valid','result_failure','result_stage','validation_reason','validated_search_calls','validated_query_count','validated_read_count','validated_citation_count','result_finished_at']; first_fields text[] := ARRAY['first_status','first_http_status','first_search_calls','first_page_calls','first_citation_count','first_pending_builtin','first_pending_planning','first_pending_other','first_total_tokens'];
BEGIN
 PERFORM pg_advisory_xact_lock(78261642489301);
 IF TG_OP IN ('DELETE','TRUNCATE') THEN RAISE EXCEPTION 'Protocol history cannot be deleted';END IF;
 IF TG_OP='INSERT' THEN
  IF current_user<>'postgres' OR NEW.activated_at>clock_timestamp() OR NEW.expires_at<=clock_timestamp() OR NEW.google_used<>0 OR NEW.job_id IS NOT NULL OR NEW.claimed_at IS NOT NULL OR NEW.readback_authorized OR NEW.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'Initially unused future operator record only';END IF;
  IF EXISTS(SELECT 1 FROM jsonb_each(to_jsonb(NEW)) e WHERE e.key=ANY(result_fields) AND e.value<>'null'::jsonb) THEN RAISE EXCEPTION 'No prefilled result';END IF;
  RETURN NEW;
 END IF;
 IF ROW(NEW.singleton,NEW.approval_sha256,NEW.backend_tree,NEW.input_sha256,NEW.key_id,NEW.origin,NEW.activated_at,NEW.expires_at) IS DISTINCT FROM ROW(OLD.singleton,OLD.approval_sha256,OLD.backend_tree,OLD.input_sha256,OLD.key_id,OLD.origin,OLD.activated_at,OLD.expires_at) THEN RAISE EXCEPTION 'Immutable protocol binding';END IF;
 IF NEW.revoked_at IS DISTINCT FROM OLD.revoked_at THEN
  IF current_user<>'postgres' OR OLD.revoked_at IS NOT NULL OR NEW.revoked_at IS NULL OR to_jsonb(NEW)-'revoked_at' IS DISTINCT FROM to_jsonb(OLD)-'revoked_at' THEN RAISE EXCEPTION 'Irreversible operator revocation only';END IF;
  RETURN NEW;
 END IF;
 IF current_user<>'wanderful_owner_runtime' OR OLD.revoked_at IS NOT NULL OR OLD.result_finished_at IS NOT NULL THEN RAISE EXCEPTION 'Restricted unfinished job only';END IF;
 IF OLD.job_id IS NULL THEN
  IF clock_timestamp()>=OLD.expires_at OR NEW.job_id IS NULL OR NEW.claimed_at IS NULL OR NEW.claimed_at>clock_timestamp() OR NEW.claimed_at<OLD.activated_at OR (to_jsonb(NEW)-ARRAY['job_id','claimed_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['job_id','claimed_at']) THEN RAISE EXCEPTION 'Exactly one untouched job claim';END IF;
 ELSIF NEW.job_id IS DISTINCT FROM OLD.job_id OR NEW.claimed_at IS DISTINCT FROM OLD.claimed_at THEN RAISE EXCEPTION 'Job identity immutable';
 ELSIF NEW.readback_authorized IS DISTINCT FROM OLD.readback_authorized THEN
  IF clock_timestamp()>=OLD.expires_at OR OLD.readback_authorized OR NOT NEW.readback_authorized OR OLD.google_used<>1 OR NEW.first_status IS DISTINCT FROM 'completed' OR NEW.first_http_status IS NULL OR NEW.first_http_status NOT BETWEEN 200 AND 299 OR NEW.first_search_calls IS NULL OR NEW.first_search_calls<1 OR NEW.first_page_calls IS DISTINCT FROM 0 OR NEW.first_citation_count IS NULL OR NEW.first_citation_count<1 OR (to_jsonb(NEW)-(first_fields||ARRAY['readback_authorized'])) IS DISTINCT FROM (to_jsonb(OLD)-(first_fields||ARRAY['readback_authorized'])) THEN RAISE EXCEPTION 'One readback after validated completed search only';END IF;
 ELSIF NEW.google_used=OLD.google_used+1 THEN
  IF clock_timestamp()>=OLD.expires_at OR (OLD.google_used=1 AND NOT OLD.readback_authorized) OR OLD.google_used>=2 OR to_jsonb(NEW)-'google_used' IS DISTINCT FROM to_jsonb(OLD)-'google_used' THEN RAISE EXCEPTION 'One bounded charged provider attempt';END IF;
 ELSIF NEW.result_finished_at IS DISTINCT FROM OLD.result_finished_at THEN
  IF NEW.result_finished_at IS NULL OR NEW.result_finished_at>clock_timestamp() OR NEW.result_finished_at<OLD.claimed_at OR clock_timestamp()>OLD.expires_at+interval '2 minutes' OR NEW.full_research_valid IS NULL OR NEW.result_failure IS NULL OR NEW.result_stage IS NULL THEN RAISE EXCEPTION 'Single bounded result finish';END IF;
  IF (to_jsonb(NEW)-result_fields) IS DISTINCT FROM (to_jsonb(OLD)-result_fields) THEN RAISE EXCEPTION 'Finish cannot change reservations';END IF;
  IF OLD.readback_authorized AND EXISTS(SELECT 1 FROM jsonb_each(to_jsonb(NEW)) e WHERE e.key=ANY(first_fields) AND e.value IS DISTINCT FROM to_jsonb(OLD)->e.key) THEN RAISE EXCEPTION 'Validated first response immutable';END IF;
 ELSE RAISE EXCEPTION 'No reset, no-op or untyped protocol write';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER protocol_verification_write BEFORE INSERT OR UPDATE OR DELETE ON wanderful_owner_budget_v1.protocol_verification FOR EACH ROW EXECUTE FUNCTION wanderful_owner_budget_v1.guard_protocol_verification_write();
CREATE TRIGGER protocol_verification_no_truncate BEFORE TRUNCATE ON wanderful_owner_budget_v1.protocol_verification FOR EACH STATEMENT EXECUTE FUNCTION wanderful_owner_budget_v1.guard_protocol_verification_write();
CREATE OR REPLACE FUNCTION wanderful_owner_budget_v1.guard_totals() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE s wanderful_owner_budget_v1.supplement%ROWTYPE; f wanderful_owner_budget_v1.entitlements%ROWTYPE; v wanderful_owner_budget_v1.protocol_verification%ROWTYPE; g integer;h integer;r integer;
BEGIN
 IF TG_TABLE_NAME='windows' THEN IF NEW.scope NOT IN ('wanderful-live-wave-20261003:google','wanderful-live-wave-20261003:graphhopper','wanderful-live-wave-20261003:requests') THEN RETURN NULL;END IF;END IF;
 PERFORM pg_advisory_xact_lock(78261642489301);
 SELECT * INTO s FROM wanderful_owner_budget_v1.supplement WHERE singleton;
 SELECT * INTO f FROM wanderful_owner_budget_v1.entitlements WHERE sequence=2;
 SELECT * INTO v FROM wanderful_owner_budget_v1.protocol_verification WHERE singleton;
 SELECT COALESCE(max(cost) FILTER(WHERE scope='wanderful-live-wave-20261003:requests'),0),COALESCE(max(cost) FILTER(WHERE scope='wanderful-live-wave-20261003:google'),0),COALESCE(max(cost) FILTER(WHERE scope='wanderful-live-wave-20261003:graphhopper'),0) INTO r,g,h FROM wanderful_owner_v1.windows WHERE identity_hash='global';
 IF r<>2 OR g<>s.baseline_google+s.google_used+COALESCE(f.diagnostic_used,0)+COALESCE(f.google_used,0)+COALESCE(v.google_used,0) OR h<>s.baseline_graphhopper+s.graphhopper_used+COALESCE(f.graphhopper_used,0) OR g>16 OR h>10 THEN RAISE EXCEPTION 'Cumulative old+all-phase accounting mismatch'; END IF;
 IF s.intent_used=1 AND NOT EXISTS(SELECT 1 FROM wanderful_owner_v1.leases l JOIN wanderful_owner_v1.sessions ss USING(token_hash) WHERE l.lease_id=s.intent_lease_id AND l.scope='intent' AND ss.key_id=s.key_id) THEN RAISE EXCEPTION 'Prior intent link missing';END IF;
 IF s.requests_used=1 AND NOT EXISTS(SELECT 1 FROM wanderful_owner_v1.leases l JOIN wanderful_owner_v1.sessions ss USING(token_hash) WHERE l.lease_id=s.plan_lease_id AND l.scope='intent' AND ss.key_id=s.key_id) THEN RAISE EXCEPTION 'Prior plan link missing';END IF;
 IF f.sequence IS NOT NULL THEN
  IF f.intent_used=1 AND NOT EXISTS(SELECT 1 FROM wanderful_owner_v1.leases l JOIN wanderful_owner_v1.sessions ss USING(token_hash) WHERE l.lease_id=f.intent_lease_id AND l.scope='intent' AND ss.key_id=f.key_id) THEN RAISE EXCEPTION 'Followup intent/key link missing';END IF;
  IF f.requests_used=1 AND NOT EXISTS(SELECT 1 FROM wanderful_owner_v1.leases l JOIN wanderful_owner_v1.sessions ss USING(token_hash) WHERE l.lease_id=f.plan_lease_id AND l.scope='intent' AND ss.key_id=f.key_id) THEN RAISE EXCEPTION 'Followup plan/key link missing';END IF;
 END IF;
 IF TG_TABLE_NAME='supplement' AND TG_OP='UPDATE' THEN
 IF NEW.google_used+NEW.graphhopper_used>OLD.google_used+OLD.graphhopper_used THEN
 IF NOT EXISTS(SELECT 1 FROM wanderful_owner_v1.leases l JOIN wanderful_owner_v1.sessions ss USING(token_hash) JOIN wanderful_owner_v1.keys k ON k.key_id=ss.key_id JOIN wanderful_owner_v1.owners o ON o.installation_id=ss.installation_id WHERE l.lease_id=s.last_provider_lease_id AND ss.key_id=s.key_id AND l.released_at IS NULL AND l.expires_at>clock_timestamp() AND ss.expires_at>clock_timestamp() AND ss.revoked_at IS NULL AND k.revoked_at IS NULL AND o.revoked_at IS NULL) THEN RAISE EXCEPTION 'Prior active provider lease required';END IF;
 END IF;
 END IF;
 IF TG_TABLE_NAME='entitlements' AND TG_OP='UPDATE' THEN
  IF NEW.google_used+NEW.graphhopper_used>OLD.google_used+OLD.graphhopper_used THEN
   IF NOT EXISTS(SELECT 1 FROM wanderful_owner_v1.leases l JOIN wanderful_owner_v1.sessions ss USING(token_hash) JOIN wanderful_owner_v1.keys k ON k.key_id=ss.key_id JOIN wanderful_owner_v1.owners o ON o.installation_id=ss.installation_id WHERE l.lease_id=f.last_provider_lease_id AND ss.key_id=f.key_id AND l.released_at IS NULL AND l.expires_at>clock_timestamp() AND ss.expires_at>clock_timestamp() AND ss.revoked_at IS NULL AND k.revoked_at IS NULL AND o.revoked_at IS NULL) THEN RAISE EXCEPTION 'Actual active native provider lease required';END IF;
  END IF;
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER protocol_verification_totals AFTER INSERT OR UPDATE ON wanderful_owner_budget_v1.protocol_verification DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION wanderful_owner_budget_v1.guard_totals();
REVOKE ALL ON FUNCTION wanderful_owner_budget_v1.guard_protocol_verification_write() FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
