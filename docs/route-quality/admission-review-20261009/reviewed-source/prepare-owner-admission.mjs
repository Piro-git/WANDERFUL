// Non-mutating operator preparation. Public SPKI only; no DB, Vercel, HTTP or secrets.
import {readFileSync,lstatSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {ownerKeyId} from '../../../backend/src/ownerAccess/ownerAccessEndpoint.js';
export const ORIGIN='https://backend-zeta-amber-69.vercel.app';
export const BACKEND_TREE='b58dd008c69dfeebc9692181bef8bf7ac3c51382';
export const PROJECT='mbvzwsrtqcrwhvykugcd';
export function validatePublicExport(input){
 try{
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).sort().join()!=='keyId,publicKeySPKI'||
   typeof input.keyId!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(input.keyId)||typeof input.publicKeySPKI!=='string'||
   input.publicKeySPKI.length>512||!input.publicKeySPKI.length||!/^[A-Za-z0-9+/]+={0,2}$/.test(input.publicKeySPKI))throw Error();
  const der=Buffer.from(input.publicKeySPKI,'base64');
  if(der.toString('base64')!==input.publicKeySPKI||der.length>256||ownerKeyId(der)!==input.keyId)throw Error();
  return Object.freeze({keyId:input.keyId,installationId:`owner:${input.keyId}`,publicKeySPKI:input.publicKeySPKI,
   publicDERHex:der.toString('hex'),publicSPKISHA256:createHash('sha256').update(der).digest('hex')});
 }catch{throw Error('owner_public_export_invalid');}
}
export function enrollmentPreview(input){
 const p=validatePublicExport(input);
 // All interpolated strings are canonical base64url/hash/hex, never untrusted SQL text.
 // Existing revoked/conflicting rows are refused. No UPDATE or counter/session reset.
 const sql=`BEGIN;
DO $owner_enrollment$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('wanderful_owner_v1_enrollment',0));
 IF current_user <> 'postgres' THEN RAISE EXCEPTION 'Owner operator required'; END IF;
 IF EXISTS(SELECT 1 FROM wanderful_owner_v1.owners WHERE installation_id='${p.installationId}' AND revoked_at IS NOT NULL) THEN
  RAISE EXCEPTION 'Existing owner revoked';
 END IF;
 IF EXISTS(SELECT 1 FROM wanderful_owner_v1.keys WHERE key_id='${p.keyId}' AND
  (installation_id <> '${p.installationId}' OR public_key_spki <> decode('${p.publicDERHex}','hex') OR revoked_at IS NOT NULL)) THEN
  RAISE EXCEPTION 'Existing owner key conflicts or revoked';
 END IF;
 INSERT INTO wanderful_owner_v1.owners(installation_id) VALUES('${p.installationId}') ON CONFLICT(installation_id) DO NOTHING;
 INSERT INTO wanderful_owner_v1.keys(key_id,installation_id,public_key_spki)
 VALUES('${p.keyId}','${p.installationId}',decode('${p.publicDERHex}','hex')) ON CONFLICT(key_id) DO NOTHING;
END $owner_enrollment$;
COMMIT;`;
 return {...p,project:PROJECT,origin:ORIGIN,backendTree:BACKEND_TREE,operatorEnrollmentSQLPreview:sql,
  physicalPhoneProvenanceVerified:false,operatorWritePerformed:false,providerCalls:0,
  freshWindowCreated:false,requires:'Integrator actual device export and provenance + exact operator/QA review; public DER validation alone is not device proof.'};
}
export function freshWindowConfiguration(input,evidence,{now=Date.now(),minutes=30}={}){
 const p=validatePublicExport(input);
 const fields=['actualPhysicalPublicKeyProvenanceReviewed','currentSignedAppInstalled','deviceReachable',
  'operatorEnrollmentVerified','sameWaveLedgerReconciled','restrictedRuntimeTLSVerified'];
 const checked=Date.parse(evidence?.checkedAtUTC),profile=Date.parse(evidence?.signedProfileExpiresAtUTC);
 if(!Number.isSafeInteger(now)||!Number.isInteger(minutes)||minutes<1||minutes>30||
  fields.some(k=>evidence?.[k]!==true)||evidence?.keyId!==p.keyId||evidence?.origin!==ORIGIN||
  evidence?.backendTree!==BACKEND_TREE||!Number.isFinite(checked)||checked>now||now-checked>300000||
  !Number.isFinite(profile)||profile<=now+minutes*60000)throw Error('owner_window_prerequisites_not_verified');
 return {NODE_ENV:'production',OWNER_ACCESS_ENABLED:'true',OWNER_ACCESS_DYNAMIC_RESEARCH_ENABLED:'true',
  OWNER_ACCESS_ORIGIN:ORIGIN,OWNER_ACCESS_KEY_ID:p.keyId,
  OWNER_ACCESS_TEST_EXPIRES_AT:new Date(now+minutes*60000).toISOString(),
  AI_PROVIDER:'google',GOOGLE_MODEL:'gemini-3.8-flash',
  DYNAMIC_RESEARCH_USER_AGENT:`WanderfulOwnerPilot/2026 (+${ORIGIN})`};
}
// CLI emits review material ONLY. It never creates a live window or writes cloud state.
if(process.argv[1]===fileURLToPath(import.meta.url)){
 try{
  const path=process.argv[2];if(!path||process.argv.length!==3)throw Error();
  const info=lstatSync(path);if(!info.isFile()||info.isSymbolicLink()||info.size>4096)throw Error();
  const packet=enrollmentPreview(JSON.parse(readFileSync(path,'utf8')));
  process.stdout.write(JSON.stringify(packet,null,2)+'\n');
 }catch{process.stderr.write('owner_public_export_preparation_failed\n');process.exitCode=1;}
}
