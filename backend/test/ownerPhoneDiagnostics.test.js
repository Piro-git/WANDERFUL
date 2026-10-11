import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createOwnerDiagnostics} from '../scripts/owner-phone-diagnostics.js';
import {createOwnerProviderBudget} from '../scripts/owner-phone-provider-budget.js';
import {fetchBoundedJson} from '../src/llmPlanning/adapters/providerHttp.js';
function fixture(t) {
  const dir=fs.mkdtempSync('/private/tmp/owner-diagnostics-test-');fs.chmodSync(dir,0o700);
  const cleanup=[];t.after(()=>{for(const close of cleanup)close();fs.rmSync(dir,{recursive:true,force:true});});
  const diagnostics=createOwnerDiagnostics(dir);
  cleanup.push(()=>diagnostics.close());
  return {dir,diagnostics,cleanup,read:()=>fs.readFileSync(dir+'/owner-diagnostics.jsonl','utf8').trim().split('\n').filter(Boolean).map(JSON.parse)};
}
test('private metadata is bounded, allowlisted, and correlated across async endpoints',async t=>{
  const {dir,diagnostics,cleanup,read}=fixture(t);
  await Promise.all(['/api/parse-intent','/api/llm-plan-route'].map(endpoint=>diagnostics.run(endpoint,async()=>{
    await Promise.resolve();diagnostics.record({event:'provider_completed',provider:'google',kind:'http',status:200,
      durationMs:12,prompt:'SECRET',coordinates:'SECRET',headers:'SECRET',code:'SECRET',response:'SECRET'});
  })));
  const rows=read();assert.deepEqual(rows.map(r=>r.phase),['intent_parsing','itinerary_selection']);
  assert.notEqual(rows[0].requestSequence,rows[1].requestSequence);
  assert.ok(!JSON.stringify(rows).includes('SECRET'));
  for(let i=0;i<1000;i++)diagnostics.record({event:'request_completed',status:200});
  assert.ok(fs.statSync(dir+'/owner-diagnostics.jsonl').size<=32768);
  assert.equal(fs.statSync(dir+'/owner-diagnostics.jsonl').mode&0o777,0o600);
});
test('4000ms selector HTTP deadline remains typed and consumes one call with abort evidence',async t=>{
  const {dir,diagnostics,cleanup,read}=fixture(t);let fire,clock=0,calls=0;
  const budget=createOwnerProviderBudget({directory:dir,limits:{google:2,graphhopper:2},diagnostic:diagnostics.record,now:()=>clock,
    fetchImpl:async(_url,{signal})=>{calls++;return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('SECRET','AbortError')),{once:true}));}});
  cleanup.push(()=>budget.close());
  await diagnostics.run('/api/llm-plan-route',async()=>{
    const pending=fetchBoundedJson({fetchImpl:budget.fetch,url:new URL('https://generativelanguage.googleapis.com/v1beta/interactions'),
      init:{method:'POST',body:JSON.stringify({model:'gemini-3.8-flash'})},deadlineMs:4000,maximumAttempts:1,
      maximumResponseBytes:4096,maximumErrorResponseBytes:256,setTimeoutImpl:(fn,ms)=>{assert.equal(ms,4000);fire=fn;return 1;},clearTimeoutImpl:()=>{}});
    clock=4000;fire();await assert.rejects(pending,{code:'timed_out'});
    diagnostics.record({event:'endpoint_outcome',code:'timed_out',status:504});
  });
  assert.equal(calls,1);assert.deepEqual(budget.remaining(),{google:1,graphhopper:2,stopped:false});
  const rows=read();assert.equal(rows[0].kind,'aborted');assert.equal(rows[0].phase,'itinerary_selection');
  assert.equal(rows[0].durationMs,4000);assert.equal(rows[1].code,'timed_out');
});
test('known transport failures stay distinct from cancellation',async t=>{
  const {dir,diagnostics,cleanup,read}=fixture(t);
  const budget=createOwnerProviderBudget({directory:dir,diagnostic:diagnostics.record,fetchImpl:async()=>{throw Object.assign(Error('SECRET'),{cause:{code:'ECONNRESET'}});}});
  cleanup.push(()=>budget.close());await assert.rejects(budget.fetch('https://generativelanguage.googleapis.com/v1beta/interactions',{method:'POST',body:'{"model":"gemini-3.8-flash"}'}));
  assert.equal(read()[0].code,'ECONNRESET');assert.equal(read()[0].kind,'transport_error');assert.equal(read()[0].signalAborted,false);
});
test('route validation failures retain typed status without route data or error text', async t => {
  const {diagnostics,read}=fixture(t);
  await diagnostics.run('/api/route',async()=>{
    diagnostics.logger.info({event:'route_request_completed',statusCode:400,errorCode:'invalid_coordinates',
      requestId:'PRIVATE_ID',points:'PRIVATE_COORDINATES',message:'PRIVATE_MESSAGE'});
    diagnostics.logger.info({event:'route_request_completed',statusCode:400,errorCode:'PRIVATE_UNKNOWN_CODE'});
  });
  const rows=read();
  assert.equal(rows[0].endpoint,'/api/route');
  assert.equal(rows[0].status,400);
  assert.equal(rows[0].code,'invalid_coordinates');
  assert.equal(rows[1].code,undefined);
  assert.ok(!JSON.stringify(rows).includes('PRIVATE_'));
});
