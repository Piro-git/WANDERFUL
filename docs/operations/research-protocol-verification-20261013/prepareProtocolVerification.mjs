// Pure proposal generator. Never reads secrets or executes cloud/DB/provider work.
export function prepareProtocolVerification(p,{now=Date.now()}={}){
 if(!/^[a-f0-9]{64}$/.test(p?.approvalSHA256??'')||!/^[a-f0-9]{40}$/.test(p?.backendTree??'')||p.inputSHA256!=='83d775c8fa33b6ecfc3377235967816aca745dc7b3daf010aaed3664674ab870'||!/^[A-Za-z0-9_-]{43}$/.test(p?.keyId??'')||p.origin!=='https://backend-zeta-amber-69.vercel.app')throw Error('protocol_proposal_invalid');
 const expires=Date.parse(p.expiresAtUTC);if(!Number.isFinite(expires)||new Date(expires).toISOString()!==p.expiresAtUTC||expires-now<120000||expires-now>600000)throw Error('protocol_proposal_invalid');
 const sql=`BEGIN;
SELECT pg_advisory_xact_lock(78261642489301);
DO $protocol_operator$ DECLARE r integer;g integer;h integer;
BEGIN
 IF current_user<>'postgres' OR EXISTS(SELECT 1 FROM wanderful_owner_budget_v1.protocol_verification) THEN RAISE EXCEPTION 'Unused reviewed operator singleton required';END IF;
 SELECT COALESCE(max(cost) FILTER(WHERE scope='wanderful-live-wave-20261003:requests'),0),COALESCE(max(cost) FILTER(WHERE scope='wanderful-live-wave-20261003:google'),0),COALESCE(max(cost) FILTER(WHERE scope='wanderful-live-wave-20261003:graphhopper'),0) INTO r,g,h FROM wanderful_owner_v1.windows WHERE identity_hash='global';
 IF r<>2 OR g<>10 OR h<>0 OR EXISTS(SELECT 1 FROM wanderful_owner_v1.leases WHERE released_at IS NULL AND expires_at>clock_timestamp()) THEN RAISE EXCEPTION 'Exact no-lease spent baseline required';END IF;
 IF NOT EXISTS(SELECT 1 FROM wanderful_owner_budget_v1.supplement WHERE singleton AND key_id='${p.keyId}' AND intent_used=1 AND requests_used=1 AND google_used=2 AND graphhopper_used=0) OR NOT EXISTS(SELECT 1 FROM wanderful_owner_budget_v1.entitlements WHERE sequence=2 AND key_id='${p.keyId}' AND origin='${p.origin}' AND diagnostic_used=1 AND intent_used=1 AND requests_used=1 AND google_used=3 AND graphhopper_used=0 AND phone_expires_at<=clock_timestamp()) THEN RAISE EXCEPTION 'Old grants remain spent and expired';END IF;
 IF NOT EXISTS(SELECT 1 FROM wanderful_owner_v1.keys k JOIN wanderful_owner_v1.owners o USING(installation_id) WHERE k.key_id='${p.keyId}' AND k.revoked_at IS NULL AND o.revoked_at IS NULL) THEN RAISE EXCEPTION 'Same active enrolled owner/key';END IF;
 INSERT INTO wanderful_owner_budget_v1.protocol_verification(approval_sha256,backend_tree,input_sha256,key_id,origin,expires_at) VALUES('${p.approvalSHA256}','${p.backendTree}','${p.inputSHA256}','${p.keyId}','${p.origin}','${p.expiresAtUTC}'::timestamptz);
END $protocol_operator$;
COMMIT;`;
 return {sql,executed:false,maximumJobs:1,maximumGoogle:2,GraphHopper:0,nativeCalls:0,requiredPublicConfigOff:['OWNER_ACCESS_ENABLED','OWNER_ACCESS_SUPPLEMENT_ENABLED','OWNER_ACCESS_FOLLOWUP_ENABLED'],buildOverrides:{WANDERFUL_PROTOCOL_VERIFICATION:'approved_research_once',WANDERFUL_PROTOCOL_APPROVAL_SHA256:p.approvalSHA256,WANDERFUL_PROTOCOL_BACKEND_TREE:p.backendTree,WANDERFUL_PROTOCOL_INPUT_SHA256:p.inputSHA256,WANDERFUL_PROTOCOL_EXPIRES_AT:p.expiresAtUTC}};
}
