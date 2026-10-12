import test from 'node:test';import assert from 'node:assert/strict';
import {prepareSupplementActivation} from './prepareSupplementActivation.mjs';
const now=Date.UTC(2026,9,12,22,0,0),input={approvalSHA256:'a'.repeat(64),backendTree:'b'.repeat(40),keyId:'K'.repeat(43),origin:'https://backend-zeta-amber-69.vercel.app',expiresAt:new Date(now+1800000).toISOString()};
test('proposal freezes public binding, keeps original ledger and scopes one intent/plan plus all provider calls',()=>{
 const p=prepareSupplementActivation(input,{now});assert.equal(p.activationPerformed,false);assert.equal(p.providerCalls,0);assert.deepEqual(p.additional,{nativeIntentAdmissions:1,planAdmissions:1,google:8,graphhopper:6});assert.deepEqual(p.cumulativeProviderMaximum,{google:16,graphhopper:10});
 assert.ok(!/UPDATE wanderful_owner_v1|DELETE|TRUNCATE|PASSWORD|DATABASE_URL|API_KEY|ALTER ROLE|DISABLE TRIGGER/.test(p.activationSQL));
 assert.match(p.activationSQL,/r<>2 OR g<>4 OR h<>0/);assert.match(p.activationSQL,/supplement already exists/);assert.match(p.revocationSQL,/revoked_at=clock_timestamp/);
});
test('expired/extended/noncanonical/unbound/injected public metadata cannot generate activation SQL',()=>{
 for(const patch of [{expiresAt:new Date(now).toISOString()},{expiresAt:new Date(now+1800001).toISOString()},{expiresAt:'tomorrow'},{origin:'https://other.example.org'},{approvalSHA256:"' OR true"},{backendTree:'b'.repeat(39)},{keyId:'K'.repeat(42)}])assert.throws(()=>prepareSupplementActivation({...input,...patch},{now}));
});
