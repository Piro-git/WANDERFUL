// Non-mutating operator proposal. Never writes a database/cloud or starts a window.
export function prepareSupplementActivation({approvalSHA256,backendTree,keyId,origin,expiresAt},{now=Date.now()}={}){
 if(!/^[a-f0-9]{64}$/.test(approvalSHA256??'')||!/^[a-f0-9]{40}$/.test(backendTree??'')||!/^[A-Za-z0-9_-]{43}$/.test(keyId??'')||origin!=='https://backend-zeta-amber-69.vercel.app'||!Number.isSafeInteger(now))throw Error('supplement_proposal_invalid');
 const deadline=Date.parse(expiresAt);if(!Number.isFinite(deadline)||new Date(deadline).toISOString()!==expiresAt||deadline<=now||deadline-now>1800000)throw Error('supplement_proposal_invalid');
 // All interpolated values are restricted public metadata, never credentials.
 const activationSQL=`BEGIN;
SELECT pg_advisory_xact_lock(78261642489301);
DO $supplement_activation$
DECLARE r integer;g integer;h integer;
BEGIN
 IF current_user<>'postgres' THEN RAISE EXCEPTION 'Reviewed operator only'; END IF;
 SELECT COALESCE(max(cost) FILTER(WHERE scope='wanderful-live-wave-20261003:requests'),0),COALESCE(max(cost) FILTER(WHERE scope='wanderful-live-wave-20261003:google'),0),COALESCE(max(cost) FILTER(WHERE scope='wanderful-live-wave-20261003:graphhopper'),0) INTO r,g,h FROM wanderful_owner_v1.windows WHERE identity_hash='global';
 IF r<>2 OR g<>4 OR h<>0 OR EXISTS(SELECT 1 FROM wanderful_owner_budget_v1.supplement) OR EXISTS(SELECT 1 FROM wanderful_owner_v1.leases WHERE released_at IS NULL AND expires_at>clock_timestamp()) THEN RAISE EXCEPTION 'Ledger changed or supplement already exists'; END IF;
 IF NOT EXISTS(SELECT 1 FROM wanderful_owner_v1.keys k JOIN wanderful_owner_v1.owners o USING(installation_id) WHERE k.key_id='${keyId}' AND k.revoked_at IS NULL AND o.revoked_at IS NULL) THEN RAISE EXCEPTION 'Same active enrolled key required'; END IF;
 INSERT INTO wanderful_owner_budget_v1.supplement(parent_wave,approval_sha256,key_id,origin,backend_tree,expires_at) VALUES('wanderful-live-wave-20261003','${approvalSHA256}','${keyId}','${origin}','${backendTree}','${expiresAt}'::timestamptz);
END $supplement_activation$;
COMMIT;`;
 return {activationSQL,revocationSQL:"BEGIN;SELECT pg_advisory_xact_lock(78261642489301);UPDATE wanderful_owner_budget_v1.supplement SET revoked_at=clock_timestamp() WHERE singleton AND revoked_at IS NULL;COMMIT;",publicServerConfig:{OWNER_ACCESS_SUPPLEMENT_ENABLED:'true',OWNER_ACCESS_SUPPLEMENT_APPROVAL_SHA256:approvalSHA256,OWNER_ACCESS_SUPPLEMENT_BACKEND_TREE:backendTree,OWNER_ACCESS_TEST_EXPIRES_AT:expiresAt},additional:{nativeIntentAdmissions:1,planAdmissions:1,google:8,graphhopper:6},cumulativeProviderMaximum:{google:16,graphhopper:10},baseline:{requests:2,google:4,graphhopper:0},activationPerformed:false,providerCalls:0};
}
