import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createOwnerProviderBudget} from '../scripts/owner-phone-provider-budget.js';
import {createOwnerPhoneTestSession} from '../scripts/owner-phone-test-session.js';
import {startOwnerPhoneTest} from '../scripts/start-owner-phone-test.js';
const google='https://generativelanguage.googleapis.com/v1beta/interactions';
const gh='https://graphhopper.com/api/1/route';
const gi={method:'POST',body:JSON.stringify({model:'gemini-3.8-flash',input:'A nonpersonal test',response_format:{mime_type:'application/json'}})};
const ri={method:'POST',body:JSON.stringify({points:[[10,51],[10.1,51.1]],profile:'foot'})};
function fixture(t){const directory=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'acceptance-offline-'));fs.chmodSync(directory,0o700);t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));return directory;}
test('acceptance enforces1/2 durable caps and refuses contract downgrade',async t=>{
 const directory=fixture(t);let calls=0;
 const opts={directory,acceptanceMode:true,limits:{google:1,graphhopper:2},fetchImpl:async()=>{calls++;return {status:200};}};
 let budget=createOwnerProviderBudget(opts);
 await budget.fetch(google,gi);await assert.rejects(budget.fetch(google,gi));
 await budget.fetch(gh,ri);await budget.fetch(gh,ri);await assert.rejects(budget.fetch(gh,ri));
 assert.equal(calls,3);budget.close();
 assert.throws(()=>createOwnerProviderBudget({...opts,acceptanceMode:false}));
 budget=createOwnerProviderBudget(opts);assert.deepEqual(budget.remaining(),{google:0,graphhopper:0,stopped:false});budget.close();
});
test('acceptance rejects cost-expanding inputs before IO and accounting',async t=>{
 const budget=createOwnerProviderBudget({directory:fixture(t),acceptanceMode:true,limits:{google:1,graphhopper:2},fetchImpl:()=>assert.fail('no network')});
 try {
  for(const extra of [{tools:[]},{previous_interaction_id:'old'},{service_tier:'priority'},{input:[]},{input:'x'.repeat(65537)}])
   await assert.rejects(budget.fetch(google,{...gi,body:JSON.stringify({...JSON.parse(gi.body),...extra})}));
  for(const extra of [{optimize:true},{points:Array(11).fill([10,51])},{algorithm:'other'}])
   await assert.rejects(budget.fetch(gh,{...ri,body:JSON.stringify({...JSON.parse(ri.body),...extra})}));
  await assert.rejects(budget.fetch(gh+'?optimize=true',ri));
  assert.deepEqual(budget.remaining(),{google:1,graphhopper:2,stopped:false});
 }finally{budget.close();}
});
test('acceptance session rejects excess requests and revocation; cannot widen normal ceilings',async()=>{
 const env={NODE_ENV:'development',TRAILMIND_RELEASE_STAGE:'local',OWNER_PHONE_TEST_ENABLED:'true'};
 const token=Buffer.alloc(32,1).toString('base64url');
 const session=createOwnerPhoneTestSession({token,expiresAt:Date.now()+10000,env,maxRequests:4,maxCost:12});
 const headers=()=>({authorization:`TrailMindRouteSession ${token}`,'x-trailmind-request-id':randomUUID()});
 for(let i=0;i<4;i++){const access=await session.authorize({headers:headers(),cost:1});await access.release();}
 await assert.rejects(session.authorize({headers:headers(),cost:1}));session.revoke();assert.throws(()=>session.verify(headers()));
 assert.throws(()=>createOwnerPhoneTestSession({token,expiresAt:Date.now()+10000,env,maxRequests:31}));
});
test('launcher pins acceptance limits and30minutes, refuses research before credential read',async t=>{
 const directory=fixture(t);let reads=0;
 const options={enabled:true,acceptanceMode:true,credentialPath:'/synthetic/provider.env',publicURL:'https://new.example/',outputPath:path.join(directory,'OwnerPhoneTest.json')};
 const dependencies={readProviderFile:()=>{reads++;return 'AI_PROVIDER=google\nGOOGLE_API_KEY=synthetic\nGRAPHHOPPER_API_KEY=synthetic';},
 createBudget:options=>{assert.equal(options.acceptanceMode,true);assert.deepEqual(options.limits,{google:1,graphhopper:2});return {fetch:()=>assert.fail('no provider IO'),close(){}};},
 createSession:options=>{assert.equal(options.maxRequests,4);assert.equal(options.maxCost,12);return {revoke(){}};},
 createServer:()=>({once(){},listen(port,host,cb){assert.equal(host,'127.0.0.1');cb();},closeAllConnections(){},close(cb){cb();}})};
 await assert.rejects(startOwnerPhoneTest({...options,researchEnabled:true},dependencies));assert.equal(reads,0);
 await assert.rejects(startOwnerPhoneTest({...options,expiresAt:Date.now()+1801000},dependencies));assert.equal(reads,0);
 const runtime=await startOwnerPhoneTest(options,dependencies);assert.ok(runtime.expiresAt<=Date.now()+1800000);await runtime.stop();assert.equal(reads,1);
});
