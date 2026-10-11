import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
const root=process.env.QA_OWNER_CANDIDATE_ROOT;
assert.ok(root,'Explicit frozen owner candidate required');
const file=path.join(root,'docs/operations/vercel-live-20261004/prepare-owner-admission.mjs');
const before=await readFile(file);
const {validatePublicExport,enrollmentPreview,freshWindowConfiguration,ORIGIN,BACKEND_TREE}=await import(pathToFileURL(file));
const der=generateKeyPairSync('ec',{namedCurve:'prime256v1'}).publicKey.export({format:'der',type:'spki'});
const input={keyId:createHash('sha256').update(der).digest('base64url'),publicKeySPKI:der.toString('base64')};
const now=Date.UTC(2026,9,9,20,0,0);
const ready=()=>({keyId:input.keyId,origin:ORIGIN,backendTree:BACKEND_TREE,checkedAtUTC:new Date(now).toISOString(),
 signedProfileExpiresAtUTC:new Date(now+3600000).toISOString(),actualPhysicalPublicKeyProvenanceReviewed:true,
 currentSignedAppInstalled:true,deviceReachable:true,operatorEnrollmentVerified:true,sameWaveLedgerReconciled:true,restrictedRuntimeTLSVerified:true});
// Public fixtures only, no actual phone, DB, HTTP, Vercel, keys or live window.
test('QA public export rejects private/device fields, malformed DER and cross-curve key',()=>{
 const wrong=generateKeyPairSync('ec',{namedCurve:'secp384r1'}).publicKey.export({format:'der',type:'spki'});
 for(const value of [{...input,deviceUDID:'PUBLIC_SYNTHETIC_ID'}, {...input,privateKey:'SYNTHETIC_MARKER'},
  {...input,publicKeySPKI:Buffer.concat([der,Buffer.from([0])]).toString('base64')},
  {keyId:createHash('sha256').update(wrong).digest('base64url'),publicKeySPKI:wrong.toString('base64')},
  {...input,keyId:"' OR true--"},{...input,publicKeySPKI:input.publicKeySPKI+'\n'}]){
  assert.throws(()=>validatePublicExport(value),/^Error: owner_public_export_invalid$/);
 }
});
test('QA preview remains unproven and SQL is limited to operator-controlled insert-only public enrollment',()=>{
 const preview=enrollmentPreview(input);
 assert.equal(preview.physicalPhoneProvenanceVerified,false);assert.equal(preview.operatorWritePerformed,false);
 assert.equal(preview.freshWindowCreated,false);assert.equal(preview.providerCalls,0);
 const sql=preview.operatorEnrollmentSQLPreview;
 assert.match(sql,/current_user <> 'postgres'/);assert.match(sql,/pg_advisory_xact_lock/);
 assert.match(sql,/Existing owner revoked/);assert.match(sql,/Existing owner key conflicts or revoked/);
 assert.equal((sql.match(/INSERT INTO/g)||[]).length,2);assert.equal((sql.match(/ON CONFLICT\([^)]*\) DO NOTHING/g)||[]).length,2);
 assert.doesNotMatch(sql,/\b(UPDATE|DELETE|TRUNCATE|GRANT|ALTER|CREATE)\b|wanderful_owner_v1\.(windows|requests|sessions|leases|challenges)/);
});
test('QA every missing actual prerequisite, stale future time, profile expiry or identity mismatch fails before config',()=>{
 const required=['actualPhysicalPublicKeyProvenanceReviewed','currentSignedAppInstalled','deviceReachable','operatorEnrollmentVerified','sameWaveLedgerReconciled','restrictedRuntimeTLSVerified'];
 for(const field of required){for(const value of [false,undefined,'true']){
  assert.throws(()=>freshWindowConfiguration(input,{...ready(),[field]:value},{now}),/^Error: owner_window_prerequisites_not_verified$/);
 }}
 for(const evidence of [{...ready(),checkedAtUTC:new Date(now-300001).toISOString()},
  {...ready(),checkedAtUTC:new Date(now+1).toISOString()},
  {...ready(),signedProfileExpiresAtUTC:new Date(now+1800000).toISOString()},
  {...ready(),origin:'https://other.example.com'},{...ready(),keyId:'A'.repeat(43)},{...ready(),backendTree:'wrong'}])
  assert.throws(()=>freshWindowConfiguration(input,evidence,{now}),/^Error: owner_window_prerequisites_not_verified$/);
});
test('QA bounded public config adds no credential/allowance; original fixture-only evidence is not activation',async()=>{
 for(const minutes of [0,31,1.5,NaN])assert.throws(()=>freshWindowConfiguration(input,ready(),{now,minutes}),/owner_window_prerequisites_not_verified/);
 const config=freshWindowConfiguration(input,ready(),{now,minutes:1});assert.equal(Date.parse(config.OWNER_ACCESS_TEST_EXPIRES_AT)-now,60000);
 assert.equal(config.OWNER_ACCESS_ORIGIN,ORIGIN);assert.equal(config.OWNER_ACCESS_KEY_ID,input.keyId);
 assert.ok(Object.keys(config).every(k=>!/API_KEY|PASSWORD|DATABASE_URL|BYPASS|BUDGET|WAVE/.test(k)));
 assert.deepEqual(await readFile(file),before,'Frozen candidate changed during QA');
});
