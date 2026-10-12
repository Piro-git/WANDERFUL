// Proposal generator only. No cloud/DB/provider execution and no secret input.
export function prepareOperatorDiagnostic(p,{now=Date.now()}={}){
 if(!/^[a-f0-9]{64}$/.test(p?.approvalSHA256??'')||!/^[a-f0-9]{40}$/.test(p?.backendTree??'')||!/^[A-Za-z0-9_-]{43}$/.test(p?.keyId??'')||p.origin!=='https://backend-zeta-amber-69.vercel.app')throw Error('diagnostic_proposal_invalid');
 const end=Date.parse(p.expiresAt);if(!Number.isFinite(end)||new Date(end).toISOString()!==p.expiresAt||end<=now||end-now>600000)throw Error('diagnostic_proposal_invalid');
 const sql=`BEGIN;
SELECT pg_advisory_xact_lock(78261642489301);
DO $diagnostic_entitlement$
DECLARE r integer;g integer;h integer;
BEGIN
 IF current_user<>'postgres' THEN RAISE EXCEPTION 'Reviewed operator only';END IF;
 SELECT COALESCE(max(cost) FILTER(WHERE scope='wanderful-live-wave-20261003:requests'),0),COALESCE(max(cost) FILTER(WHERE scope='wanderful-live-wave-20261003:google'),0),COALESCE(max(cost) FILTER(WHERE scope='wanderful-live-wave-20261003:graphhopper'),0) INTO r,g,h FROM wanderful_owner_v1.windows WHERE identity_hash='global';
 IF r<>2 OR g<>6 OR h<>0 OR EXISTS(SELECT 1 FROM wanderful_owner_budget_v1.entitlements) OR EXISTS(SELECT 1 FROM wanderful_owner_v1.leases WHERE released_at IS NULL AND expires_at>clock_timestamp()) THEN RAISE EXCEPTION 'Exact baseline/unused followup required';END IF;
 IF NOT EXISTS(SELECT 1 FROM wanderful_owner_budget_v1.supplement WHERE singleton AND intent_used=1 AND requests_used=1 AND google_used=2 AND graphhopper_used=0) THEN RAISE EXCEPTION 'Old spent grant must remain';END IF;
 IF NOT EXISTS(SELECT 1 FROM wanderful_owner_v1.keys k JOIN wanderful_owner_v1.owners o USING(installation_id) WHERE k.key_id='${p.keyId}' AND k.revoked_at IS NULL AND o.revoked_at IS NULL) THEN RAISE EXCEPTION 'Same active enrolled key';END IF;
 INSERT INTO wanderful_owner_budget_v1.entitlements(sequence,approval_sha256,key_id,origin,diagnostic_backend_tree,diagnostic_expires_at) VALUES(2,'${p.approvalSHA256}','${p.keyId}','${p.origin}','${p.backendTree}','${p.expiresAt}'::timestamptz);
END $diagnostic_entitlement$;
COMMIT;`;
 return {sql,executed:false,additionalDiagnosticGoogleCalls:1,additionalPhoneGoogleCalls:8,additionalPhoneGHCalls:6,phonePhaseBound:false,requiredPublicProjectConfigOff:['OWNER_ACCESS_ENABLED','OWNER_ACCESS_SUPPLEMENT_ENABLED','OWNER_ACCESS_FOLLOWUP_ENABLED'],oneOffDeploymentBuildOverrides:{WANDERFUL_OPERATOR_DIAGNOSTIC:'approved_lifecycle_once',WANDERFUL_DIAGNOSTIC_APPROVAL_SHA256:p.approvalSHA256,WANDERFUL_DIAGNOSTIC_BACKEND_TREE:p.backendTree},normalBuildHookInstalled:false,publicDiagnosticEndpoint:false};
}
