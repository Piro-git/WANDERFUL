-- REVIEW PROPOSAL ONLY: additive second entitlement in the existing private schema.
-- Original wave and consumed singleton are never reset/replaced/revived.
BEGIN;
DO $$ BEGIN
 IF current_user<>'postgres' OR to_regclass('wanderful_owner_budget_v1.entitlements') IS NOT NULL THEN RAISE EXCEPTION 'Reviewed one-time setup only'; END IF;
 IF NOT EXISTS(SELECT 1 FROM wanderful_owner_budget_v1.supplement WHERE singleton AND requests_used=1 AND intent_used=1 AND google_used=2 AND graphhopper_used=0) THEN RAISE EXCEPTION 'Consumed prior allocation required'; END IF;
END $$;
CREATE TABLE wanderful_owner_budget_v1.entitlements (
 sequence integer PRIMARY KEY CHECK(sequence=2),
 approval_sha256 text NOT NULL CHECK(approval_sha256 ~ '^[a-f0-9]{64}$'),
 key_id text NOT NULL REFERENCES wanderful_owner_v1.keys(key_id),
 origin text NOT NULL CHECK(origin='https://backend-zeta-amber-69.vercel.app'),
 diagnostic_backend_tree text NOT NULL CHECK(diagnostic_backend_tree ~ '^[a-f0-9]{40}$'),
 activated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 diagnostic_expires_at timestamptz NOT NULL CHECK(diagnostic_expires_at>activated_at AND diagnostic_expires_at<=activated_at+interval '10 minutes'),
 phone_backend_tree text CHECK(phone_backend_tree ~ '^[a-f0-9]{40}$'),
 phone_approval_sha256 text CHECK(phone_approval_sha256 ~ '^[a-f0-9]{64}$'),
 phone_activated_at timestamptz,
 phone_expires_at timestamptz,
 diagnostic_used integer NOT NULL DEFAULT 0 CHECK(diagnostic_used BETWEEN 0 AND 1),
 intent_used integer NOT NULL DEFAULT 0 CHECK(intent_used BETWEEN 0 AND 1),
 requests_used integer NOT NULL DEFAULT 0 CHECK(requests_used BETWEEN 0 AND 1),
 google_used integer NOT NULL DEFAULT 0 CHECK(google_used BETWEEN 0 AND 8),
 graphhopper_used integer NOT NULL DEFAULT 0 CHECK(graphhopper_used BETWEEN 0 AND 6),
 diagnostic_job_id uuid,
 intent_lease_id uuid REFERENCES wanderful_owner_v1.leases(lease_id) DEFERRABLE INITIALLY DEFERRED,
 plan_lease_id uuid REFERENCES wanderful_owner_v1.leases(lease_id) DEFERRABLE INITIALLY DEFERRED,
 last_provider_lease_id uuid REFERENCES wanderful_owner_v1.leases(lease_id) DEFERRABLE INITIALLY DEFERRED,
 result_status text CHECK(result_status IN ('completed','in_progress','requires_action','failed','cancelled','incomplete','budget_exceeded','queued','upper_completed','upper_in_progress','upper_requires_action','upper_failed','upper_cancelled','upper_incomplete','upper_budget_exceeded','upper_queued','missing','unrecognized')),
 result_status_type text CHECK(result_status_type IN ('string','number','boolean','object','array','null','missing')),
 has_steps boolean,has_continuation boolean,step_count integer CHECK(step_count BETWEEN 0 AND 60),search_calls integer CHECK(search_calls BETWEEN 0 AND 60),page_calls integer CHECK(page_calls BETWEEN 0 AND 60),model_outputs integer CHECK(model_outputs BETWEEN 0 AND 60),
 search_results integer CHECK(search_results BETWEEN 0 AND 60),page_results integer CHECK(page_results BETWEEN 0 AND 60),read_success_count integer CHECK(read_success_count BETWEEN 0 AND 60),citation_annotation_count integer CHECK(citation_annotation_count BETWEEN 0 AND 60),search_validation_ok boolean,page_validation_ok boolean,validation_reason text CHECK(validation_reason IN ('provider_not_completed','model_output_failed','provider_steps_invalid','search_call_invalid','search_queries_missing','search_result_invalid','search_suggestions_missing','search_suggestions_invalid','page_call_invalid','page_result_invalid','model_content_invalid','answer_text_invalid','annotation_list_invalid','citation_url_invalid','citation_title_invalid','citation_range_missing','citation_range_invalid','grounded_text_missing','search_evidence_missing','source_page_evidence_missing','web_limits_exceeded','unicode_invalid','web_envelope_invalid')),function_calls integer CHECK(function_calls BETWEEN 0 AND 60),function_search_places integer CHECK(function_search_places BETWEEN 0 AND 60),function_route_itinerary integer CHECK(function_route_itinerary BETWEEN 0 AND 60),function_review_quality integer CHECK(function_review_quality BETWEEN 0 AND 60),function_other integer CHECK(function_other BETWEEN 0 AND 60),error_array_present boolean,error_count integer CHECK(error_count BETWEEN 0 AND 16),model_error_code integer CHECK(model_error_code BETWEEN 0 AND 16),total_input_tokens integer CHECK(total_input_tokens BETWEEN 0 AND 1000000),total_output_tokens integer CHECK(total_output_tokens BETWEEN 0 AND 1000000),total_thought_tokens integer CHECK(total_thought_tokens BETWEEN 0 AND 1000000),total_tokens integer CHECK(total_tokens BETWEEN 0 AND 1000000),
 result_http_status integer CHECK(result_http_status BETWEEN 100 AND 599),
 result_failure text CHECK(result_failure IN ('none','timed_out','provider_rejected','configuration_missing','rate_limited','provider_unavailable','invalid_response','response_too_large','cancelled','unclassified')),
 result_finished_at timestamptz,
 revoked_at timestamptz,
 CHECK((diagnostic_used=0)=(diagnostic_job_id IS NULL)),
 CHECK((intent_used=0)=(intent_lease_id IS NULL)),
 CHECK((requests_used=0)=(plan_lease_id IS NULL)),
 CHECK((phone_backend_tree IS NULL AND phone_approval_sha256 IS NULL AND phone_activated_at IS NULL AND phone_expires_at IS NULL) OR (phone_backend_tree IS NOT NULL AND phone_approval_sha256 IS NOT NULL AND phone_activated_at IS NOT NULL AND phone_expires_at>phone_activated_at AND phone_expires_at<=phone_activated_at+interval '30 minutes'))
);
ALTER TABLE wanderful_owner_budget_v1.entitlements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON wanderful_owner_budget_v1.entitlements FROM PUBLIC,anon,authenticated,service_role;
CREATE POLICY entitlement_runtime ON wanderful_owner_budget_v1.entitlements TO wanderful_owner_runtime USING(true) WITH CHECK(true);
GRANT SELECT ON wanderful_owner_budget_v1.entitlements TO wanderful_owner_runtime;
GRANT UPDATE(diagnostic_used,intent_used,requests_used,google_used,graphhopper_used,diagnostic_job_id,intent_lease_id,plan_lease_id,last_provider_lease_id,result_status,result_status_type,has_steps,has_continuation,step_count,search_calls,page_calls,model_outputs,search_results,page_results,read_success_count,citation_annotation_count,search_validation_ok,page_validation_ok,validation_reason,function_calls,function_search_places,function_route_itinerary,function_review_quality,function_other,error_array_present,error_count,model_error_code,total_input_tokens,total_output_tokens,total_thought_tokens,total_tokens,result_http_status,result_failure,result_finished_at) ON wanderful_owner_budget_v1.entitlements TO wanderful_owner_runtime;
CREATE FUNCTION wanderful_owner_budget_v1.guard_entitlement_write() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE delta integer;
BEGIN
 PERFORM pg_advisory_xact_lock(78261642489301);
 IF TG_OP IN ('DELETE','TRUNCATE') THEN RAISE EXCEPTION 'Audit entitlement cannot be deleted'; END IF;
 IF TG_OP='INSERT' THEN
  IF current_user<>'postgres' OR NEW.diagnostic_used<>0 OR NEW.intent_used<>0 OR NEW.requests_used<>0 OR NEW.google_used<>0 OR NEW.graphhopper_used<>0 OR NEW.phone_backend_tree IS NOT NULL OR NEW.phone_approval_sha256 IS NOT NULL OR NEW.phone_activated_at IS NOT NULL OR NEW.phone_expires_at IS NOT NULL OR NEW.result_finished_at IS NOT NULL OR NEW.result_status IS NOT NULL OR NEW.result_status_type IS NOT NULL OR NEW.result_http_status IS NOT NULL OR NEW.result_failure IS NOT NULL OR NEW.has_steps IS NOT NULL OR NEW.has_continuation IS NOT NULL OR NEW.step_count IS NOT NULL OR NEW.search_calls IS NOT NULL OR NEW.page_calls IS NOT NULL OR NEW.model_outputs IS NOT NULL OR NEW.search_results IS NOT NULL OR NEW.page_results IS NOT NULL OR NEW.read_success_count IS NOT NULL OR NEW.citation_annotation_count IS NOT NULL OR NEW.search_validation_ok IS NOT NULL OR NEW.page_validation_ok IS NOT NULL OR NEW.validation_reason IS NOT NULL OR NEW.function_calls IS NOT NULL OR NEW.function_search_places IS NOT NULL OR NEW.function_route_itinerary IS NOT NULL OR NEW.function_review_quality IS NOT NULL OR NEW.function_other IS NOT NULL OR NEW.error_array_present IS NOT NULL OR NEW.error_count IS NOT NULL OR NEW.model_error_code IS NOT NULL OR NEW.total_input_tokens IS NOT NULL OR NEW.total_output_tokens IS NOT NULL OR NEW.total_thought_tokens IS NOT NULL OR NEW.total_tokens IS NOT NULL OR NEW.intent_lease_id IS NOT NULL OR NEW.plan_lease_id IS NOT NULL OR NEW.last_provider_lease_id IS NOT NULL OR NEW.revoked_at IS NOT NULL OR NEW.activated_at>clock_timestamp() OR NEW.diagnostic_expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'Reviewed unused diagnostic entitlement only'; END IF;
  RETURN NEW;
 END IF;
 IF ROW(NEW.sequence,NEW.approval_sha256,NEW.key_id,NEW.origin,NEW.diagnostic_backend_tree,NEW.activated_at,NEW.diagnostic_expires_at) IS DISTINCT FROM ROW(OLD.sequence,OLD.approval_sha256,OLD.key_id,OLD.origin,OLD.diagnostic_backend_tree,OLD.activated_at,OLD.diagnostic_expires_at) THEN RAISE EXCEPTION 'Diagnostic binding immutable'; END IF;
 IF NEW.diagnostic_used<OLD.diagnostic_used OR NEW.intent_used<OLD.intent_used OR NEW.requests_used<OLD.requests_used OR NEW.google_used<OLD.google_used OR NEW.graphhopper_used<OLD.graphhopper_used OR (OLD.diagnostic_job_id IS NOT NULL AND NEW.diagnostic_job_id IS DISTINCT FROM OLD.diagnostic_job_id) OR (OLD.intent_lease_id IS NOT NULL AND NEW.intent_lease_id IS DISTINCT FROM OLD.intent_lease_id) OR (OLD.plan_lease_id IS NOT NULL AND NEW.plan_lease_id IS DISTINCT FROM OLD.plan_lease_id) THEN RAISE EXCEPTION 'No entitlement reset/replay'; END IF;
 IF OLD.result_finished_at IS NOT NULL AND ROW(NEW.result_status,NEW.result_status_type,NEW.has_steps,NEW.has_continuation,NEW.step_count,NEW.search_calls,NEW.page_calls,NEW.model_outputs,NEW.search_results,NEW.page_results,NEW.read_success_count,NEW.citation_annotation_count,NEW.search_validation_ok,NEW.page_validation_ok,NEW.validation_reason,NEW.function_calls,NEW.function_search_places,NEW.function_route_itinerary,NEW.function_review_quality,NEW.function_other,NEW.error_array_present,NEW.error_count,NEW.model_error_code,NEW.total_input_tokens,NEW.total_output_tokens,NEW.total_thought_tokens,NEW.total_tokens,NEW.result_http_status,NEW.result_failure,NEW.result_finished_at) IS DISTINCT FROM ROW(OLD.result_status,OLD.result_status_type,OLD.has_steps,OLD.has_continuation,OLD.step_count,OLD.search_calls,OLD.page_calls,OLD.model_outputs,OLD.search_results,OLD.page_results,OLD.read_success_count,OLD.citation_annotation_count,OLD.search_validation_ok,OLD.page_validation_ok,OLD.validation_reason,OLD.function_calls,OLD.function_search_places,OLD.function_route_itinerary,OLD.function_review_quality,OLD.function_other,OLD.error_array_present,OLD.error_count,OLD.model_error_code,OLD.total_input_tokens,OLD.total_output_tokens,OLD.total_thought_tokens,OLD.total_tokens,OLD.result_http_status,OLD.result_failure,OLD.result_finished_at) THEN RAISE EXCEPTION 'Diagnostic result immutable';END IF;
 IF ROW(NEW.phone_backend_tree,NEW.phone_approval_sha256,NEW.phone_activated_at,NEW.phone_expires_at) IS DISTINCT FROM ROW(OLD.phone_backend_tree,OLD.phone_approval_sha256,OLD.phone_activated_at,OLD.phone_expires_at) THEN
  IF current_user<>'postgres' OR OLD.phone_backend_tree IS NOT NULL OR NEW.phone_backend_tree IS NULL OR NEW.phone_approval_sha256 IS NULL OR NEW.phone_activated_at IS NULL OR NEW.phone_expires_at IS NULL OR OLD.revoked_at IS NOT NULL OR OLD.diagnostic_used<>1 OR OLD.result_finished_at IS NULL OR NEW.phone_activated_at>clock_timestamp() OR NEW.phone_expires_at<=clock_timestamp() OR ROW(NEW.diagnostic_used,NEW.intent_used,NEW.requests_used,NEW.google_used,NEW.graphhopper_used) IS DISTINCT FROM ROW(OLD.diagnostic_used,OLD.intent_used,OLD.requests_used,OLD.google_used,OLD.graphhopper_used) THEN RAISE EXCEPTION 'One reviewed phone binding after diagnostic only'; END IF;
  RETURN NEW;
 END IF;
 IF NEW.revoked_at IS DISTINCT FROM OLD.revoked_at THEN
  IF current_user<>'postgres' OR OLD.revoked_at IS NOT NULL OR NEW.revoked_at IS NULL OR ROW(NEW.diagnostic_used,NEW.intent_used,NEW.requests_used,NEW.google_used,NEW.graphhopper_used) IS DISTINCT FROM ROW(OLD.diagnostic_used,OLD.intent_used,OLD.requests_used,OLD.google_used,OLD.graphhopper_used) THEN RAISE EXCEPTION 'Irreversible operator revocation only'; END IF;
  RETURN NEW;
 END IF;
 IF current_user<>'wanderful_owner_runtime' OR OLD.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'Restricted runtime only'; END IF;
 delta=(NEW.diagnostic_used-OLD.diagnostic_used)+(NEW.intent_used-OLD.intent_used)+(NEW.requests_used-OLD.requests_used)+(NEW.google_used-OLD.google_used)+(NEW.graphhopper_used-OLD.graphhopper_used);
 IF delta=0 THEN
  IF OLD.result_finished_at IS NOT NULL OR OLD.diagnostic_used<>1 OR NEW.result_finished_at IS NULL OR clock_timestamp()>OLD.diagnostic_expires_at+interval '2 minutes' THEN RAISE EXCEPTION 'Single bounded safe diagnostic result only'; END IF;
 ELSE
  IF delta<>1 OR NEW.result_finished_at IS DISTINCT FROM OLD.result_finished_at THEN RAISE EXCEPTION 'Single monotonic reservation'; END IF;
  IF NEW.diagnostic_used>OLD.diagnostic_used THEN
   IF clock_timestamp()>=OLD.diagnostic_expires_at OR OLD.phone_backend_tree IS NOT NULL THEN RAISE EXCEPTION 'Diagnostic phase expired/not current'; END IF;
  ELSE
   IF OLD.phone_backend_tree IS NULL OR clock_timestamp()>=OLD.phone_expires_at THEN RAISE EXCEPTION 'Phone phase not authorized/expired'; END IF;
   IF NEW.intent_used>OLD.intent_used AND OLD.requests_used<>0 THEN RAISE EXCEPTION 'No second intent'; END IF;
   IF NEW.google_used+NEW.graphhopper_used>OLD.google_used+OLD.graphhopper_used AND NEW.last_provider_lease_id IS DISTINCT FROM (CASE WHEN NEW.requests_used=1 THEN NEW.plan_lease_id ELSE NEW.intent_lease_id END) THEN RAISE EXCEPTION 'Admitted native lease required'; END IF;
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER entitlement_write BEFORE INSERT OR UPDATE OR DELETE ON wanderful_owner_budget_v1.entitlements FOR EACH ROW EXECUTE FUNCTION wanderful_owner_budget_v1.guard_entitlement_write();
CREATE TRIGGER entitlement_no_truncate BEFORE TRUNCATE ON wanderful_owner_budget_v1.entitlements FOR EACH STATEMENT EXECUTE FUNCTION wanderful_owner_budget_v1.guard_entitlement_write();

-- Strengthen/extend additive totals only. Original guard_planning_wave remains untouched.
CREATE OR REPLACE FUNCTION wanderful_owner_budget_v1.guard_totals() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE s wanderful_owner_budget_v1.supplement%ROWTYPE; f wanderful_owner_budget_v1.entitlements%ROWTYPE; g integer;h integer;r integer;
BEGIN
 IF TG_TABLE_NAME='windows' THEN IF NEW.scope NOT IN ('wanderful-live-wave-20261003:google','wanderful-live-wave-20261003:graphhopper','wanderful-live-wave-20261003:requests') THEN RETURN NULL;END IF;END IF;
 PERFORM pg_advisory_xact_lock(78261642489301);
 SELECT * INTO s FROM wanderful_owner_budget_v1.supplement WHERE singleton;
 SELECT * INTO f FROM wanderful_owner_budget_v1.entitlements WHERE sequence=2;
 SELECT COALESCE(max(cost) FILTER(WHERE scope='wanderful-live-wave-20261003:requests'),0),COALESCE(max(cost) FILTER(WHERE scope='wanderful-live-wave-20261003:google'),0),COALESCE(max(cost) FILTER(WHERE scope='wanderful-live-wave-20261003:graphhopper'),0) INTO r,g,h FROM wanderful_owner_v1.windows WHERE identity_hash='global';
 IF r<>2 OR g<>s.baseline_google+s.google_used+COALESCE(f.diagnostic_used,0)+COALESCE(f.google_used,0) OR h<>s.baseline_graphhopper+s.graphhopper_used+COALESCE(f.graphhopper_used,0) OR g>16 OR h>10 THEN RAISE EXCEPTION 'Cumulative old+all-phase accounting mismatch'; END IF;
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
CREATE CONSTRAINT TRIGGER entitlement_totals AFTER INSERT OR UPDATE ON wanderful_owner_budget_v1.entitlements DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION wanderful_owner_budget_v1.guard_totals();
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA wanderful_owner_budget_v1 FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
