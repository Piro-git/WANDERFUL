import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {classifyGoogleErrorResponse, GOOGLE_ERROR_BODY_LIMITS, safeGoogleErrorMetadata} from '../scripts/owner-google-error-classification.js';
import {createOwnerProviderBudget} from '../scripts/owner-phone-provider-budget.js';
import {createOwnerDiagnostics} from '../scripts/owner-phone-diagnostics.js';
import {parseIntentEndpoint} from '../src/parseIntent.js';
import {intentJsonSchema} from '../src/intentSchema.js';
const google='https://generativelanguage.googleapis.com/v1beta/interactions';
const init={method:'POST',body:JSON.stringify({model:'gemini-3.8-flash'})};
const json=payload=>new Response(JSON.stringify(payload),{status:500,headers:{'content-type':'application/json'}});
function fixture(t){const directory=fs.mkdtempSync('/private/tmp/owner-google-error-offline-');fs.chmodSync(directory,0o700);
  const cleanups=[];t.after(()=>{for(const c of cleanups)c();fs.rmSync(directory,{recursive:true});});return {directory,cleanups};}

test('only exact canonical codes and RPC reasons survive hostile metadata',async()=>{
  assert.deepEqual(await classifyGoogleErrorResponse(json({error:{code:'api_error',status:'INTERNAL',message:'SECRET',
    details:[{'@type':'type.googleapis.com/google.rpc.ErrorInfo',domain:'googleapis.com',reason:'SERVICE_DISABLED',metadata:{consumer:'SECRET'}}],requestId:'SECRET'}})),
    {googleErrorCode:'api_error',googleErrorStatus:'INTERNAL',googleErrorReason:'SERVICE_DISABLED',errorBodyState:'classified'});
  assert.deepEqual(safeGoogleErrorMetadata({googleErrorCode:'SECRET',googleErrorStatus:'INTERNAL\nSECRET',googleErrorReason:'API_KEY_INVALID SECRET',errorBodyState:'SECRET',body:'SECRET'}),{});
  assert.deepEqual(await classifyGoogleErrorResponse(json({error:{code:'SECRET',status:'SECRET',message:'api_error',
    details:[{'@type':'wrong',domain:'googleapis.com',reason:'API_KEY_INVALID'},{'@type':'type.googleapis.com/google.rpc.ErrorInfo',domain:'wrong',reason:'API_KEY_INVALID'}]}})),{errorBodyState:'unrecognized'});
});
for(const [body,headers,state] of [
  ['{"error":',{'content-type':'application/json'},'malformed'],
  [new Uint8Array([0xff]),{'content-type':'application/json'},'malformed'],
  ['<html>SECRET</html>',{'content-type':'text/html'},'not_json'],
  ['x'.repeat(8193),{'content-type':'application/json'},'oversized'],
  ['{}',{'content-type':'application/json','content-length':'8193'},'oversized'],
  ['{}',{'content-type':'application/json','content-length':'invalid'},'oversized'],
  ['[]',{'content-type':'application/json'},'unrecognized'],
  ['{"error":null}',{'content-type':'application/json'},'unrecognized']
])test(`error body ${state}: ${Object.keys(headers).join(',')} ${typeof body==='string'?body.length:'bytes'}`,async()=>{
  assert.deepEqual(await classifyGoogleErrorResponse(new Response(body,{status:500,headers})),{errorBodyState:state});
});
test('declared oversized body is canceled without reading; chunked limit is enforced',async()=>{
  let reads=0,cancels=0;
  const body=new ReadableStream({pull(c){reads++;c.enqueue(new Uint8Array(8192));},cancel(){cancels++;}},{highWaterMark:0});
  assert.deepEqual(await classifyGoogleErrorResponse(new Response(body,{status:500,headers:{'content-type':'application/json','content-length':'99999'}})),{errorBodyState:'oversized'});
  assert.equal(reads,0);assert.equal(cancels,1);
  const chunks=new ReadableStream({pull(c){c.enqueue(new Uint8Array(4097));},cancel(){cancels++;}},{highWaterMark:0});
  assert.deepEqual(await classifyGoogleErrorResponse(new Response(chunks,{status:500,headers:{'content-type':'application/json'}})),{errorBodyState:'oversized'});assert.equal(cancels,2);
});
test('stalled bodies are canceled under a time bound without waiting for provider cancellation',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});let canceled=false;
  const body=new ReadableStream({cancel(){canceled=true;return new Promise(()=>{});}},{highWaterMark:0});
  const pending=classifyGoogleErrorResponse(new Response(body,{status:500,headers:{'content-type':'application/json'}}));
  t.mock.timers.tick(GOOGLE_ERROR_BODY_LIMITS.timeoutMs);
  assert.deepEqual(await pending,{errorBodyState:'deadline'});assert.equal(canceled,true);
});
test('caller abort and stream error do not escape as raw errors',async()=>{
  const c=new AbortController();const r=new Response(new ReadableStream(),{status:500,headers:{'content-type':'application/json'}});
  const pending=classifyGoogleErrorResponse(r,{signal:c.signal});c.abort();assert.deepEqual(await pending,{errorBodyState:'aborted'});
  const failing=new ReadableStream({pull(){throw Error('SECRET');}});
  assert.deepEqual(await classifyGoogleErrorResponse(new Response(failing,{status:500,headers:{'content-type':'application/json'}})),{errorBodyState:'read_failed'});
});
test('durable caps and every failure survive restart without retries or private text on disk',async t=>{
  const {directory,cleanups}=fixture(t);let calls=0;
  const diagnostics=createOwnerDiagnostics(directory);cleanups.push(()=>diagnostics.close());
  const options={directory,limits:{google:2,graphhopper:2},diagnostic:diagnostics.record,fetchImpl:async()=>{
    calls++;assert.equal(JSON.parse(fs.readFileSync(directory+'/provider-budget.json')).google,calls);
    return json({error:{code:'api_error',message:'SECRET',details:[{requestId:'SECRET'}]}});
  }};
  let budget=createOwnerProviderBudget(options);cleanups.push(()=>budget.close());
  await diagnostics.run('/api/parse-intent',()=>budget.fetch(google,init));budget.close();budget=createOwnerProviderBudget(options);
  await diagnostics.run('/api/parse-intent',()=>budget.fetch(google,init));
  await assert.rejects(budget.fetch(google,init),{message:'private_budget_exhausted'});
  assert.equal(calls,2);assert.deepEqual(budget.remaining(),{google:0,graphhopper:2,stopped:false});
  const rows=fs.readFileSync(directory+'/owner-diagnostics.jsonl','utf8').trim().split('\n').map(JSON.parse);
  assert.equal(rows.length,2);assert.ok(rows.every(r=>r.googleErrorCode==='api_error'&&r.phase==='intent_parsing'&&r.status===500));
  assert.notEqual(rows[0].requestSequence,rows[1].requestSequence);
  diagnostics.record({event:'provider_completed',provider:'google',googleErrorCode:'SECRET',googleErrorStatus:'SECRET',googleErrorReason:'SECRET',errorBodyState:'SECRET'});
  for(const name of fs.readdirSync(directory))assert.ok(!fs.readFileSync(directory+'/'+name,'utf8').includes('SECRET'));
});
test('success and GraphHopper bodies remain untouched; access stop persists before error-body IO',async t=>{
  const {directory,cleanups}=fixture(t);let response=new Response('success');
  const budget=createOwnerProviderBudget({directory,fetchImpl:async()=>response});cleanups.push(()=>budget.close());
  assert.equal(await (await budget.fetch(google,init)).text(),'success');
  response=new Response('routing error',{status:500});assert.equal(await (await budget.fetch('https://graphhopper.com/api/1/route',init)).text(),'routing error');
  response=new Response(new ReadableStream({pull(c){assert.equal(JSON.parse(fs.readFileSync(directory+'/provider-budget.json')).stopped,true);c.enqueue(new TextEncoder().encode('{"error":{"code":"permission_denied"}}'));c.close();}},{highWaterMark:0}),{status:403,headers:{'content-type':'application/json'}});
  assert.equal((await budget.fetch(google,init)).status,403);await assert.rejects(budget.fetch(google,init));
});
test('effective native request after budget wrapping pins model, keeps schema, and disables storage',async t=>{
  const {directory,cleanups}=fixture(t);let calls=0;
  const budget=createOwnerProviderBudget({directory,fetchImpl:async(url,request)=>{
    calls++;assert.equal(url,google);assert.equal(request.headers['x-goog-api-key'],'offline-key');assert.equal(request.redirect,'manual');assert.ok(request.signal instanceof AbortSignal);
    const body=JSON.parse(request.body);assert.deepEqual(Object.keys(body).sort(),['input','model','response_format','store']);
    assert.equal(body.model,'gemini-3.8-flash');assert.equal(body.store,false);
    assert.equal(body.response_format.type,'text');assert.equal(body.response_format.mime_type,'application/json');assert.deepEqual(body.response_format.schema,intentJsonSchema);
    assert.ok(body.input.includes('roughly fifteen kilometres'));return json({error:{code:'api_error'}});
  }});cleanups.push(()=>budget.close());
  await assert.rejects(parseIntentEndpoint({prompt:'A loop from Ilsenburg of roughly fifteen kilometres with viewpoints.',locale:'en',userLocationHint:null},
    {env:{AI_PROVIDER:'google',GOOGLE_API_KEY:'offline-key',GOOGLE_MODEL:'gemini-3.8-flash'},fetchImpl:budget.fetch}),{code:'intent_unavailable'});assert.equal(calls,1);
});

test('overlapping error-body classification keeps each provider outcome independent',async t=>{
  const {directory,cleanups}=fixture(t);let release;const rows=[];
  const body=new ReadableStream({start(c){release=()=>{c.enqueue(new TextEncoder().encode('{"error":{"code":"api_error"}}'));c.close();};}});
  const budget=createOwnerProviderBudget({directory,diagnostic:r=>rows.push(r),fetchImpl:async url=>
    url===google?new Response(body,{status:500,headers:{'content-type':'application/json'}}):new Response('route',{status:200})});
  cleanups.push(()=>budget.close());
  const pending=budget.fetch(google,init);
  await budget.fetch('https://graphhopper.com/api/1/route',init);release();await pending;
  assert.deepEqual(rows.map(r=>[r.provider,r.status,r.googleErrorCode]),[['graphhopper',200,undefined],['google',500,'api_error']]);
});

test('overlapping error-body classification keeps each provider outcome independent',async t=>{
  const {directory,cleanups}=fixture(t);let release;const rows=[];
  const body=new ReadableStream({start(c){release=()=>{c.enqueue(new TextEncoder().encode('{"error":{"code":"api_error"}}'));c.close();};}});
  const budget=createOwnerProviderBudget({directory,diagnostic:r=>rows.push(r),fetchImpl:async url=>
    url===google?new Response(body,{status:500,headers:{'content-type':'application/json'}}):new Response('route',{status:200})});
  cleanups.push(()=>budget.close());
  const pending=budget.fetch(google,init);
  await budget.fetch('https://graphhopper.com/api/1/route',init);release();await pending;
  assert.deepEqual(rows.map(r=>[r.provider,r.status,r.googleErrorCode]),[['graphhopper',200,undefined],['google',500,'api_error']]);
});

test('error JSON at the byte limit is classified and pre-aborted reads are bounded',async()=>{
  const head='{"error":{"code":"api_error"}}';
  assert.deepEqual(await classifyGoogleErrorResponse(new Response(head+' '.repeat(8192-head.length),{status:500,headers:{'content-type':'application/json'}})),
    {googleErrorCode:'api_error',errorBodyState:'classified'});
  assert.deepEqual(await classifyGoogleErrorResponse(json({error:{code:'api_error'}}),{signal:AbortSignal.abort()}),{errorBodyState:'aborted'});
});

test('reviewed schema diagnostic changes only the four string-length constraints',()=>{
  const variant=JSON.parse(fs.readFileSync(new URL('./fixtures/googleIntentSchemaDiagnosticWithoutStringLengths.json',import.meta.url)));
  for(const key of ['startLocationQuery','endLocationQuery','regionQuery']){
    assert.equal(variant.properties[key].anyOf[0].maxLength,undefined);
    variant.properties[key].anyOf[0].maxLength=intentJsonSchema.properties[key].anyOf[0].maxLength;
  }
  assert.equal(variant.properties.rawPrompt.maxLength,undefined);
  variant.properties.rawPrompt.maxLength=intentJsonSchema.properties.rawPrompt.maxLength;
  assert.deepEqual(variant,intentJsonSchema);
});

test('bounded numeric retry-after is retained without arbitrary provider headers',async()=>{
 for(const [header,expected] of [['60',60],['0',0],['86400',86400],['86401',undefined],['secret',undefined],['1\nsecret',undefined]]) {
  const response={...json({error:{code:'too_many_requests'}}),body:json({error:{code:'too_many_requests'}}).body,
   headers:{get:name=>name==='content-type'?'application/json':name==='retry-after'?header:null}};
  const result=await classifyGoogleErrorResponse(response);
  assert.equal(result.retryAfterSeconds,expected);assert.ok(!JSON.stringify(result).includes('secret'));
 }
 assert.deepEqual(safeGoogleErrorMetadata({retryAfterSeconds:'60',headers:'secret'}),{});
});
