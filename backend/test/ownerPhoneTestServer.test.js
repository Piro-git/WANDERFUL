import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes,randomUUID } from 'node:crypto';
import { createOwnerPhoneTestSession } from '../scripts/owner-phone-test-session.js';
import { createOwnerPhoneTestServer } from '../scripts/owner-phone-test-server.js';
import fs from 'node:fs';
import { createOwnerProviderBudget } from '../scripts/owner-phone-provider-budget.js';
import { createOwnerDiagnostics } from '../scripts/owner-phone-diagnostics.js';

test('owner server rejects unauthorized and non-allowlisted traffic before work', async () => {
  const token=randomBytes(32).toString('base64url');
  const env={NODE_ENV:'development',TRAILMIND_RELEASE_STAGE:'local',OWNER_PHONE_TEST_ENABLED:'true',INTENT_PROVIDER_ENABLED:'true',ROUTE_PROVIDER_ENABLED:'true'};
  const session=createOwnerPhoneTestSession({token,expiresAt:Date.now()+60000,env});
  let calls=0;
  const directory=fs.mkdtempSync('/private/tmp/owner-server-diagnostics-');fs.chmodSync(directory,0o700);
  const diagnostics=createOwnerDiagnostics(directory);
  const server=createOwnerPhoneTestServer({session,env,diagnostics,parseIntent:async()=>{calls++;return {test:true};}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  try {
    for (const endpoint of ['/api/parse-intent','/api/route']) {
      assert.equal((await fetch(base+endpoint,{method:'POST',body:'{}'})).status,401);
    }
    const headers={authorization:`TrailMindRouteSession ${token}`,'x-trailmind-request-id':randomUUID(),'content-type':'application/json'};
    for (const endpoint of ['/api/llm-plan-route','/api/app-attest/challenge','/api/outdoor-research/plan-route','/api/route?override=true','/healthz']) {
      assert.equal((await fetch(base+endpoint,{method:'POST',headers,body:'{}'})).status,404);
    }
    assert.equal(calls,0);
    const response=await fetch(base+'/api/parse-intent',{method:'POST',headers,body:JSON.stringify({prompt:'A hike',locale:'en',userLocationHint:null})});
    assert.equal(response.status,200); assert.equal(calls,1);
    const rejectedRoute=await fetch(base+'/api/route',{method:'POST',headers:{...headers,'x-trailmind-request-id':randomUUID()},
      body:JSON.stringify({profile:'foot',routeType:'pointToPoint',points:[{latitude:0,longitude:0},{latitude:10,longitude:10}]})});
    assert.equal(rejectedRoute.status,400);
    for (const [contentType,body] of [['text/plain','PRIVATE_BODY'],['application/json','{"PRIVATE_BODY":']]) {
      const malformed=await fetch(base+'/api/route',{method:'POST',headers:{...headers,'content-type':contentType,'x-trailmind-request-id':randomUUID()},body});
      assert.equal(malformed.status,400);
    }
    session.revoke();
    assert.equal((await fetch(base+'/api/parse-intent',{method:'POST',headers,body:'{}'})).status,401);
    assert.equal(calls,1);
    const rows=fs.readFileSync(directory+'/owner-diagnostics.jsonl','utf8').trim().split('\n').map(JSON.parse);
    assert.ok(rows.some(row=>row.event==='endpoint_outcome'&&row.status===200&&row.endpoint==='/api/parse-intent'));
    assert.ok(rows.some(row=>row.event==='request_completed'&&row.status===200));
    assert.ok(rows.some(row=>row.event==='endpoint_outcome'&&row.endpoint==='/api/route'&&row.code==='route_distance_limit'&&row.validationReason==='distance_limit'));
    for(const reason of ['content_type','malformed_json']) {
      assert.ok(rows.some(row=>row.event==='route_http_rejected'&&row.status===400&&row.validationReason===reason));
    }
    assert.ok(!JSON.stringify(rows).includes('PRIVATE_BODY'));
    assert.ok(!JSON.stringify(rows).includes(token));
    assert.ok(!JSON.stringify(rows).includes('A hike'));
  } finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));diagnostics.close();fs.rmSync(directory,{recursive:true});}
});

test('native research extension requires explicit gates and repository capability', () => {
  const env={NODE_ENV:'development',TRAILMIND_RELEASE_STAGE:'local',OWNER_PHONE_TEST_ENABLED:'true',OWNER_PHONE_RESEARCH_TEST_ENABLED:'true'};
  assert.throws(()=>createOwnerPhoneTestServer({session:{},env}),/owner_research_configuration_unavailable/);
});

test('native research extension rejects wrong token and schema1 before combined work; reuses session budget', async () => {
  const token=randomBytes(32).toString('base64url');
  const env={NODE_ENV:'development',TRAILMIND_RELEASE_STAGE:'local',OWNER_PHONE_TEST_ENABLED:'true',
    OWNER_PHONE_RESEARCH_TEST_ENABLED:'true',LLM_FIRST_PLANNING_ENABLED:'true',INTENT_PROVIDER_ENABLED:'true',
    ROUTE_PROVIDER_ENABLED:'true',OUTDOOR_RESEARCH_PLANNING_ENABLED:'true',OUTDOOR_ROUTABLE_HIGHLIGHT_ACCESS_ENABLED:'true'};
  const session=createOwnerPhoneTestSession({token,expiresAt:Date.now()+60000,env});
  let calls=0;
  const server=createOwnerPhoneTestServer({session,env,repository:{withConsistentSnapshot(){assert.fail('no database in HTTP adapter test');}},
    llmFirstPlanningEndpoint:async(body,context)=>{
      const access=await session.authorize({...context,cost:12});
      try {calls++;return {statusCode:200,payload:{schemaVersion:2,state:'needs_clarification'}};}
      finally {await access.release();}
    }});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url=`http://127.0.0.1:${server.address().port}/api/llm-plan-route`;
  const headers={'content-type':'application/json',authorization:`TrailMindRouteSession ${token}`,'x-trailmind-request-id':randomUUID()};
  try {
    assert.equal((await fetch(url,{method:'POST',headers:{...headers,authorization:'wrong'},body:'{"schemaVersion":2}'})).status,401);
    assert.equal((await fetch(url,{method:'POST',headers,body:'{"schemaVersion":1}'})).status,400);
    assert.equal(calls,0);
    assert.equal((await fetch(url,{method:'POST',headers,body:'{"schemaVersion":2}'})).status,200);
    assert.equal(calls,1);
    assert.equal((await fetch(url,{method:'POST',headers,body:'{"schemaVersion":2}'})).status,409);
    assert.equal(calls,1);
    session.revoke();
    assert.equal((await fetch(url,{method:'POST',headers,body:'{"schemaVersion":2}'})).status,401);
  } finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});

test('native intent HTTP 500 stays a service failure for original prompts without another provider phase', async () => {
  const token=randomBytes(32).toString('base64url');
  const env={NODE_ENV:'development',TRAILMIND_RELEASE_STAGE:'local',OWNER_PHONE_TEST_ENABLED:'true',
    INTENT_PROVIDER_ENABLED:'true',ROUTE_PROVIDER_ENABLED:'true',AI_PROVIDER:'google',GOOGLE_API_KEY:'offline-test-only',GOOGLE_MODEL:'gemini-3.8-flash'};
  const session=createOwnerPhoneTestSession({token,expiresAt:Date.now()+60000,env});
  const directory=fs.mkdtempSync('/private/tmp/owner-server-500-');fs.chmodSync(directory,0o700);
  const diagnostics=createOwnerDiagnostics(directory);
  let calls=0;
  const server=createOwnerPhoneTestServer({session,env,diagnostics,fetchImpl:async(url,init)=>{
    calls++;assert.equal(new URL(url).pathname,'/v1beta/interactions');
    assert.equal(JSON.parse(init.body).response_format.mime_type,'application/json');
    return new Response('private upstream content',{status:500});
  }});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const prompts=[
    'I am starting in Ilsenburg and would love a walk of roughly fifteen kilometres that brings me back there, with a couple of viewpoints along the way.',
    "I'd like to stretch my legs above Ilsenburg and return after about twelve kilometres.",
    'Von Ilsenburg aus möchte ich heute zu Aussichtspunkten wandern und nach ungefähr 15 km wieder dort ankommen.'
  ];
  try {
    for (const prompt of prompts) {
      const response=await fetch(`http://127.0.0.1:${server.address().port}/api/parse-intent`,{method:'POST',
        headers:{'content-type':'application/json',authorization:`TrailMindRouteSession ${token}`,'x-trailmind-request-id':randomUUID()},
        body:JSON.stringify({prompt,locale:'en',userLocationHint:null})});
      assert.equal(response.status,503);
      const payload=await response.json();
      assert.equal(payload.error.code,'intent_unavailable');assert.equal(payload.parserSource,undefined);
    }
    assert.equal(calls,prompts.length); // Exactly one attempt per request, no hidden retries.
    const log=fs.readFileSync(directory+'/owner-diagnostics.jsonl','utf8');
    assert.equal(log.split('\n').filter(line=>line.includes('"code":"intent_unavailable"')).length,prompts.length);
    assert.ok(!log.includes(token)&&!log.includes('private upstream content'));
    for(const prompt of prompts)assert.ok(!log.includes(prompt));
  } finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));diagnostics.close();fs.rmSync(directory,{recursive:true});}
});

test('native web research preserves provider 429 through accounting, transport and endpoint',async()=>{
 const directory=fs.mkdtempSync('/private/tmp/owner-grounding-rate-limit-');fs.chmodSync(directory,0o700);
 const token=randomBytes(32).toString('base64url');
 const env={NODE_ENV:'development',TRAILMIND_RELEASE_STAGE:'local',OWNER_PHONE_TEST_ENABLED:'true',
  OWNER_PHONE_RESEARCH_TEST_ENABLED:'true',LLM_FIRST_PLANNING_ENABLED:'true',INTENT_PROVIDER_ENABLED:'true',
  ROUTE_PROVIDER_ENABLED:'true',OUTDOOR_RESEARCH_PLANNING_ENABLED:'true',OUTDOOR_ROUTABLE_HIGHLIGHT_ACCESS_ENABLED:'true',
  DYNAMIC_RESEARCH_ENABLED:'true',DYNAMIC_WEB_RESEARCH_ENABLED:'true',DYNAMIC_RESEARCH_USER_AGENT:'Offline test',DYNAMIC_RESEARCH_BUDGET_APPROVAL_ID:'offline-fixture-only',DYNAMIC_RESEARCH_DAILY_REQUEST_LIMIT:'2',ROUTE_GLOBAL_MAX_COST:'24',APP_ATTEST_INSTALLATION_MAX_COST:'24',ROUTE_GLOBAL_WINDOW_SECONDS:'86400',APP_ATTEST_INSTALLATION_WINDOW_SECONDS:'86400',
  AI_PROVIDER:'google',GOOGLE_API_KEY:'offline-test-only',GOOGLE_MODEL:'gemini-3.8-flash',GRAPHHOPPER_API_KEY:'offline-test-only'};
 const session=createOwnerPhoneTestSession({token,expiresAt:Date.now()+60000,env});
 const diagnostics=createOwnerDiagnostics(directory);const calls=[];
 const budget=createOwnerProviderBudget({directory,dynamicResearch:true,
  limits:{google:3,grounding:2,graphhopper:1,osm:1,wikidata:1,commons:1},diagnostic:diagnostics.record,
  fetchImpl:async(url,init)=>{calls.push({url:String(url),body:JSON.parse(init.body)});return new Response(JSON.stringify({error:{code:'too_many_requests',message:'PRIVATE_PROVIDER_TEXT'}}),
   {status:429,headers:{'content-type':'application/json','retry-after':'60'}});}});
 const server=createOwnerPhoneTestServer({session,env,diagnostics,logger:diagnostics.logger,fetchImpl:budget.fetch});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try {
  const body={schemaVersion:3,parserSource:'remoteAI',researchMode:'web_and_map',locationName:'Ilsenburg',
   prompt:'Plan an approximately15km hiking loop from Ilsenburg with viewpoints',anchor:{latitude:51.8667349,longitude:10.6831785},end:null,
   intent:{activityType:'hiking',routeType:'loop',targetDistanceKm:15,difficulty:null},
   constraints:{maximumDistanceKm:null,maximumDurationMinutes:null,maximumElevationGainMeters:null,hardAvoidances:[]}};
  const response=await fetch(`http://127.0.0.1:${server.address().port}/api/llm-plan-route`,{method:'POST',
   headers:{'content-type':'application/json',authorization:`TrailMindRouteSession ${token}`,'x-trailmind-request-id':randomUUID()},body:JSON.stringify(body)});
  assert.equal(response.status,429);const result=await response.json();assert.equal(result.error.code,'rate_limited');assert.equal(result.route,undefined);
  assert.equal(calls.length,1);assert.equal(calls[0].url,'https://generativelanguage.googleapis.com/v1beta/interactions');
  assert.deepEqual(calls[0].body.tools.map(t=>t.type),['google_search','url_context']);assert.equal(calls[0].body.store,false);
  assert.deepEqual(budget.remaining(),{google:2,grounding:1,graphhopper:1,osm:1,wikidata:1,commons:1,stopped:false});
  const access=await session.authorize({headers:{authorization:`TrailMindRouteSession ${token}`,'x-trailmind-request-id':randomUUID()},cost:1});await access.release();
  const log=fs.readFileSync(directory+'/owner-diagnostics.jsonl','utf8');const rows=log.trim().split('\n').map(JSON.parse);
  assert.ok(rows.some(r=>r.event==='provider_completed'&&r.status===429&&r.phase==='web_research'&&r.retryAfterSeconds===60));
  assert.ok(rows.some(r=>r.event==='endpoint_outcome'&&r.status===429&&r.code==='rate_limited'));
  assert.ok(!log.includes(token)&&!log.includes(body.prompt)&&!log.includes('PRIVATE_PROVIDER_TEXT'));
  assert.ok(!JSON.stringify(result).includes('PRIVATE_PROVIDER_TEXT'));
 } finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));budget.close();diagnostics.close();session.revoke();fs.rmSync(directory,{recursive:true});}
});
