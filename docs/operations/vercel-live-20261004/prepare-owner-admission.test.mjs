import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {ownerKeyId} from '../../../backend/src/ownerAccess/ownerAccessEndpoint.js';
import {validatePublicExport,enrollmentPreview,freshWindowConfiguration,ORIGIN,BACKEND_TREE} from './prepare-owner-admission.mjs';
// Synthetic PUBLIC fixture only. No key enrolled, no real-device provenance inferred.
const der=generateKeyPairSync('ec',{namedCurve:'prime256v1'}).publicKey.export({format:'der',type:'spki'});
const exported={keyId:ownerKeyId(der),publicKeySPKI:der.toString('base64')};
const now=Date.UTC(2026,9,9,19,0,0);
const ready=()=>({keyId:exported.keyId,origin:ORIGIN,backendTree:BACKEND_TREE,
 checkedAtUTC:new Date(now).toISOString(),signedProfileExpiresAtUTC:new Date(now+86400000).toISOString(),
 actualPhysicalPublicKeyProvenanceReviewed:true,currentSignedAppInstalled:true,deviceReachable:true,
 operatorEnrollmentVerified:true,sameWaveLedgerReconciled:true,restrictedRuntimeTLSVerified:true});
test('canonical real-contract public export yields deterministic key-bound principal and public-only SQL preview',()=>{
 const p=enrollmentPreview(exported);assert.equal(p.keyId,exported.keyId);assert.equal(p.installationId,`owner:${exported.keyId}`);
 assert.equal(p.physicalPhoneProvenanceVerified,false);assert.equal(p.operatorWritePerformed,false);assert.equal(p.freshWindowCreated,false);
 assert.match(p.operatorEnrollmentSQLPreview,/Existing owner revoked/);assert.match(p.operatorEnrollmentSQLPreview,/Existing owner key conflicts or revoked/);
 assert.ok(!/PASSWORD|GRANT|CREATE ROLE|DELETE|UPDATE|windows|sessions|reset_at/.test(p.operatorEnrollmentSQLPreview));
});
test('wrong keyID, curve, encoding, extra/private fields and injection input fail with fixed nonsecret error',()=>{
 const wrong=generateKeyPairSync('ec',{namedCurve:'secp384r1'}).publicKey.export({format:'der',type:'spki'});
 for(const bad of [null,[],{...exported,keyId:'A'.repeat(43)},{...exported,keyId:"' OR true"},
  {...exported,publicKeySPKI:exported.publicKeySPKI+'\n'},{...exported,privateKey:'SYNTHETIC_PRIVATE_MARKER'},
  {...exported,publicKeySPKI:wrong.toString('base64')},{...exported,publicKeySPKI:'-----BEGIN PRIVATE KEY-----'}])
  assert.throws(()=>validatePublicExport(bad),/^Error: owner_public_export_invalid$/);
});
test('key export alone cannot start a window; every actual prerequisite and matching source/origin/key is required',()=>{
 assert.throws(()=>freshWindowConfiguration(exported,{}, {now}),/owner_window_prerequisites_not_verified/);
 for(const field of ['actualPhysicalPublicKeyProvenanceReviewed','currentSignedAppInstalled','deviceReachable','operatorEnrollmentVerified','sameWaveLedgerReconciled','restrictedRuntimeTLSVerified'])
  assert.throws(()=>freshWindowConfiguration(exported,{...ready(),[field]:false},{now}),/owner_window_prerequisites_not_verified/);
 for(const evidence of [{...ready(),keyId:'A'.repeat(43)},{...ready(),origin:'https://example.com'},{...ready(),backendTree:'wrong'},
  {...ready(),checkedAtUTC:new Date(now-300001).toISOString()},{...ready(),checkedAtUTC:new Date(now+1).toISOString()},
  {...ready(),signedProfileExpiresAtUTC:new Date(now+60000).toISOString()}])
  assert.throws(()=>freshWindowConfiguration(exported,evidence,{now}),/owner_window_prerequisites_not_verified/);
});
test('fresh reviewed window is at most30minutes, public metadata only, same fixed model/origin/key; no new wave or credentials',()=>{
 const env=freshWindowConfiguration(exported,ready(),{now});assert.equal(Date.parse(env.OWNER_ACCESS_TEST_EXPIRES_AT)-now,1800000);
 assert.equal(env.OWNER_ACCESS_KEY_ID,exported.keyId);assert.equal(env.OWNER_ACCESS_ORIGIN,ORIGIN);assert.equal(env.GOOGLE_MODEL,'gemini-3.8-flash');
 assert.ok(!Object.keys(env).some(k=>/PASSWORD|DATABASE_URL|API_KEY|WAVE|BYPASS/.test(k)));
 for(const minutes of [0,31,1.2])assert.throws(()=>freshWindowConfiguration(exported,ready(),{now,minutes}),/owner_window_prerequisites_not_verified/);
});
