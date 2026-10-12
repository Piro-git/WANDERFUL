import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomBytes,randomUUID} from 'node:crypto';
import {request as httpRequest} from 'node:http';
import {ownerServiceConfiguration,createOwnerService} from '../src/ownerAccess/ownerService.js';
import {ownerDynamicPlanningConfiguration,createOwnerDynamicPlanningEndpoints,OWNER_PLANNING_CAPS} from '../src/ownerAccess/ownerDynamicPlanning.js';
import {appAttestError} from '../src/appAttest/appAttestErrors.js';
const clock=Date.now();
const keyId=randomBytes(32).toString('base64url');
const config=()=>({NODE_ENV:'production',OWNER_ACCESS_ENABLED:'true',OWNER_ACCESS_DYNAMIC_RESEARCH_ENABLED:'true',OWNER_ACCESS_ORIGIN:'https://owner.example.com',
  OWNER_ACCESS_KEY_ID:keyId,OWNER_ACCESS_TEST_EXPIRES_AT:new Date(clock+1800000).toISOString(),DYNAMIC_RESEARCH_USER_AGENT:'Wanderful offline owner test',
  AI_PROVIDER:'google',GOOGLE_MODEL:'gemini-3.8-flash',GOOGLE_API_KEY:'synthetic-google',GRAPHHOPPER_API_KEY:'synthetic-gh'});
const prompt='The original free prompt preserved through private global research.';
const body=()=>({schemaVersion:3,prompt,anchor:{latitude:57.2,longitude:-4.7},end:null,parserSource:'remoteAI',researchMode:'web_and_map',locationName:'Fixture village',
  intent:{activityType:'hiking',routeType:'loop',targetDistanceKm:6,difficulty:null},
  constraints:{maximumDistanceKm:null,maximumDurationMinutes:null,maximumElevationGainMeters:null,hardAvoidances:[]}});
const context=()=>({headers:{authorization:`TrailMindRouteSession ${randomBytes(32).toString('base64url')}`,'x-trailmind-request-id':randomUUID()}});
function repository(events=[],denied){return {isDurable:true,async authorizeSession(input){events.push(['authorize',input]);if(denied)throw appAttestError(denied);return {leaseId:randomUUID(),installationId:'owner:offline_physical_key',remainingCost:0};},
  async consumePlanningProviderAttempt(input){events.push(['reserve',input]);return true;},async releaseLease(){events.push(['release']);}};}

test('private global config pins identity, 30-minute expiry, model and shared caps; excludes inherited overrides',()=>{
  const env=config(),now=clock;
  assert.deepEqual(OWNER_PLANNING_CAPS,{requests:2,google:16,graphhopper:10});
  const result=ownerDynamicPlanningConfiguration({...env,GRAPHHOPPER_BASE_URL:'https://evil.example.com',INTENT_ALLOW_DETERMINISTIC_MOCK:'true',OWNER_ACCESS_REQUEST_LIMIT:'99'},{now});
  assert.equal(result.providerEnv.GRAPHHOPPER_BASE_URL,undefined);
  assert.equal(result.providerEnv.INTENT_ALLOW_DETERMINISTIC_MOCK,undefined);
  assert.equal(result.providerEnv.DYNAMIC_RESEARCH_DAILY_REQUEST_LIMIT,'2');
  for(const patch of [{OWNER_ACCESS_DYNAMIC_RESEARCH_ENABLED:'false'},{NODE_ENV:'development'},
    {OWNER_ACCESS_KEY_ID:'bad'},{GOOGLE_MODEL:'gemini-other'},{OWNER_ACCESS_TEST_EXPIRES_AT:new Date(clock).toISOString()},
    {OWNER_ACCESS_TEST_EXPIRES_AT:new Date(clock+1800001).toISOString()},{OWNER_ACCESS_ORIGIN:'https://temporary.trycloudflare.com'},
    {DYNAMIC_RESEARCH_USER_AGENT:'bad\nagent'}])assert.throws(()=>ownerDynamicPlanningConfiguration({...env,...patch},{now}));
});

for(const denied of ['route_session_invalid','route_session_expired','route_session_exhausted','request_replayed','app_attest_rate_limited'])
  test(`owner negative ${denied} never reaches upstream`,async()=>{
    let calls=0;const endpoint=createOwnerDynamicPlanningEndpoints({repository:repository([],denied),configuration:ownerDynamicPlanningConfiguration(config(),{now:clock}),now:()=>clock,
      fetchImpl:()=>{calls++;assert.fail('network after denied auth');}});
    const result=await endpoint.plan(body(),context());assert.notEqual(result.statusCode,200);assert.equal(result.payload.error.code,denied);assert.equal(calls,0);
  });

test('unavailable durable storage, expired window, mapped-only/legacy schema and missing token fail closed',async()=>{
  const cfg=ownerDynamicPlanningConfiguration(config(),{now:clock}),events=[];
  assert.throws(()=>createOwnerDynamicPlanningEndpoints({repository:{...repository(),isDurable:false},configuration:cfg}));
  const endpoint=createOwnerDynamicPlanningEndpoints({repository:repository(events),configuration:cfg,now:()=>clock,
    fetchImpl:()=>assert.fail('network in invalid test')});
  for(const b of [{...body(),schemaVersion:2},{...body(),researchMode:'mapped_places'},{...body(),prompt:''}])assert.equal((await endpoint.plan(b,context())).statusCode,400);
  assert.equal(events.length,0);
  assert.equal((await endpoint.plan(body(),{headers:{}})).statusCode,401);
  const expired=createOwnerDynamicPlanningEndpoints({repository:repository(events),configuration:cfg,now:()=>cfg.expiresAt});
  assert.equal((await expired.plan(body(),context())).statusCode,403);
});

test('actual global composition keeps original prompt and consumes each Google/GH attempt before fetch',async()=>{
  const fixture=JSON.parse(readFileSync(new URL('../../TrailMindTests/Fixtures/dynamic-research-offline.json',import.meta.url))),events=[];
  const repo=repository(events);let turns=0;
  const call=(name,args)=>({type:'function_call',id:randomUUID(),name,arguments:args});
  const cfg=ownerDynamicPlanningConfiguration(config(),{now:clock});
  const endpoint=createOwnerDynamicPlanningEndpoints({repository:repo,configuration:cfg,now:()=>clock,fetchImpl:async(url,init)=>{
    const u=new URL(url);assert.equal(init.redirect,'error');
    if(['generativelanguage.googleapis.com','graphhopper.com'].includes(u.hostname)){
      assert.equal(events.at(-1)[0],'reserve');assert.equal(events.at(-1)[1].provider,u.hostname==='graphhopper.com'?'graphhopper':'google');
    }
    events.push(['fetch',u.hostname]);
    if(u.hostname==='generativelanguage.googleapis.com'){
      const input=JSON.parse(init.body);assert.equal(input.store,false);assert.equal(input.model,'gemini-3.8-flash');
      if(input.tools.some(t=>t.type==='google_search'))return Response.json({steps:[{type:'google_search_call',id:'web',arguments:{queries:['Fixture village']}},
        {type:'google_search_result',call_id:'web',result:[{search_suggestions:'<div>Suggestions</div>'}]},
        {type:'url_context_call',id:'read',arguments:{urls:['https://park.example.org/ridge']}},
        {type:'url_context_result',call_id:'read',result:[{url:'https://park.example.org/ridge',status:'success'}]},
        {type:'model_output',content:[{type:'text',text:'General source description.',annotations:[{type:'url_citation',url:'https://park.example.org/ridge',title:'Public source',start_index:0,end_index:27}]}]}]});
      if(input.tools.some(t=>t.name==='review_route_quality'))return Response.json({steps:[call('review_route_quality',{decision:'complete',summary:'Measured fixture route.',remainingWishes:['Access not verified.'],evidenceIds:fixture.route.places.map(p=>p.id)})]});
      assert.ok(JSON.stringify(input.input).includes(prompt));
      return Response.json({steps:turns++===0?[call('search_places',{radiusMeters:5000,kinds:['viewpoint']})]:[call('route_itinerary',{placeIds:fixture.route.places.map(p=>p.id)})]});
    }
    if(u.hostname==='overpass-api.de')return Response.json({osm3s:{timestamp_osm_base:new Date().toISOString()},elements:fixture.route.places.map((p,i)=>({type:'node',id:i+1,version:1,timestamp:'2020-01-01T00:00:00Z',lat:p.coordinate.latitude,lon:p.coordinate.longitude,tags:{name:p.name,tourism:'viewpoint'}}))});
    if(u.hostname==='graphhopper.com')return Response.json({paths:[fixture.route.path],snapped_waypoints:fixture.route.path.points});
    assert.fail('unexpected upstream');
  }});
  const response=await endpoint.plan(body(),context());assert.equal(response.statusCode,200,JSON.stringify(response.payload));
  assert.equal(response.payload.route.geometryProvider,'graphhopper');assert.equal(response.payload.route.statistics.distanceMeters,fixture.route.path.distance);
  assert.equal(response.payload.route.plannerSource,'gemini_tools');assert.equal(response.payload.route.places.length,3);
  assert.equal(events[0][1].planning.keyId,keyId);assert.equal(events[0][1].planning.admitRequest,true);
  assert.equal(events.filter(e=>e[0]==='reserve'&&e[1].provider==='google').length,5);
  assert.equal(events.filter(e=>e[0]==='reserve'&&e[1].provider==='graphhopper').length,1);
  assert.equal(events.at(-1)[0],'release');
});

test('denied per-fetch durable budget never invokes network and releases admission',async()=>{
  const events=[],repo=repository(events);repo.consumePlanningProviderAttempt=async()=>false;
  const endpoint=createOwnerDynamicPlanningEndpoints({repository:repo,configuration:ownerDynamicPlanningConfiguration(config(),{now:clock}),now:()=>clock,
    fetchImpl:()=>assert.fail('network after provider budget rejection')});
  const result=await endpoint.plan(body(),context());assert.equal(result.statusCode,429);assert.equal(result.payload.error.code,'app_attest_rate_limited');
  assert.equal(events.at(-1)[0],'release');
  const intent=await endpoint.parseIntent({prompt,locale:'en'},context());
  assert.equal(intent.statusCode,429);assert.equal(intent.payload.error.code,'app_attest_rate_limited');
});

test('real remote intent parsing uses approved-key admission and same durable Google wave counter',async()=>{
  const events=[];
  const endpoint=createOwnerDynamicPlanningEndpoints({repository:repository(events),configuration:ownerDynamicPlanningConfiguration(config(),{now:clock}),now:()=>clock,
    fetchImpl:async(_url,init)=>{
      assert.equal(events.at(-1)[0],'reserve');assert.equal(events.at(-1)[1].provider,'google');
      assert.ok(JSON.parse(init.body).input.includes(prompt));
      return Response.json({output_text:JSON.stringify({activityType:'hiking',routeType:'loop',startLocationQuery:'Fixture village',endLocationQuery:null,
        regionQuery:null,targetDistanceKm:6,targetDurationMinutes:null,difficulty:null,desiredFeatures:[],avoidFeatures:[],transportMode:'walking',confidence:0.9})});
    }});
  const result=await endpoint.parseIntent({prompt,locale:'en',userLocationHint:null},context());
  assert.equal(result.statusCode,200,JSON.stringify(result.payload));
  assert.equal(result.payload.parserSource,'remoteAI');assert.equal(events[0][1].planning.admitRequest,false);assert.equal(events[0][1].cost,3);
});

test('owner service private global opt-in closes old route and App Attest mounts',async t=>{
  const repo={...repository(),async readiness(){},async findActiveOwnerKey(){return undefined;},async consumeOwnerOperation(){return true;},async createOwnerChallenge(){},async findOwnerChallenge(){},async exchangeOwnerChallenge(){}};
  const server=createOwnerService({repository:repo,configuration:ownerServiceConfiguration(config()),fetchImpl:()=>assert.fail('network')});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
  const origin=`http://127.0.0.1:${server.address().port}`;
  // Native HTTP allows an explicit Host for local ingress-policy testing. Fetch
  // uses its URL host rather than the requested override on this Node runtime.
  const send=(path,{method='GET',headers={},body}={})=>new Promise((resolve,reject)=>{
    const req=httpRequest(origin+path,{method,headers},res=>{res.resume();res.once('end',()=>resolve({status:res.statusCode}));});
    req.once('error',reject);req.end(body);
  });
  for(const path of ['/api/route','/api/app-attest/register'])assert.equal((await send(path,{method:'POST',headers:{host:'owner.example.com'}})).status,404);
  assert.equal((await send('/readyz',{headers:{host:'owner.example.com'}})).status,200);
  assert.equal((await send('/readyz',{headers:{'x-forwarded-host':'owner.example.com'}})).status,404);
  const unknown=await send('/api/owner-access/challenge',{method:'POST',headers:{host:'owner.example.com','content-type':'application/json'},body:JSON.stringify({keyId:randomBytes(32).toString('base64url')})});
  assert.equal(unknown.status,403);
});


test('reviewed supplement binding is server-selected and schema4 cannot spend its single plan',async()=>{
 const env={...config(),OWNER_ACCESS_ORIGIN:'https://backend-zeta-amber-69.vercel.app',OWNER_ACCESS_SUPPLEMENT_ENABLED:'true',OWNER_ACCESS_SUPPLEMENT_APPROVAL_SHA256:'a'.repeat(64),OWNER_ACCESS_SUPPLEMENT_BACKEND_TREE:'b'.repeat(40)};
 const cfg=ownerDynamicPlanningConfiguration(env,{now:clock});
 assert.equal(cfg.supplement.keyId,keyId);assert.equal(cfg.supplement.expiresAt,cfg.expiresAt);
 assert.ok(Object.isFrozen(cfg.supplement));
 for(const patch of [{OWNER_ACCESS_SUPPLEMENT_APPROVAL_SHA256:'bad'},{OWNER_ACCESS_SUPPLEMENT_BACKEND_TREE:'bad'}])assert.throws(()=>ownerDynamicPlanningConfiguration({...env,...patch},{now:clock}));
 const events=[];const endpoint=createOwnerDynamicPlanningEndpoints({repository:repository(events,'route_session_exhausted'),configuration:cfg,now:()=>clock,fetchImpl:()=>assert.fail('network after denied allocation')});
 assert.equal((await endpoint.plan({...body(),schemaVersion:4},context())).statusCode,400);assert.equal(events.length,0);
 await endpoint.plan(body(),context());assert.deepEqual(events[0][1].planning.supplement,cfg.supplement);
 await endpoint.parseIntent({prompt,locale:'en'},context());assert.deepEqual(events.at(-1)[1].planning.supplement,cfg.supplement);
});
