import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {randomBytes,randomUUID} from 'node:crypto';
import {createOwnerPhoneTestServer} from '../scripts/owner-phone-test-server.js';
import {createOwnerPhoneTestSession} from '../scripts/owner-phone-test-session.js';
import {createOwnerProviderBudget} from '../scripts/owner-phone-provider-budget.js';

// Synthetic provider fixtures, exercised through the real private HTTP routing/composition.
// This is deliberately not a live provider acceptance test.
for (const {web,revise,named=false} of [{web:false,revise:false},{web:false,revise:true},{web:true,revise:false},{web:true,revise:true},{web:true,revise:true,named:true}]) test(`native flow reaches evaluated route; web=${web}; revision=${revise}; named=${named}`,async t=>{
 const fixture=JSON.parse(fs.readFileSync(new URL('../../TrailMindTests/Fixtures/dynamic-research-offline.json',import.meta.url),'utf8'));
 const directory=fs.mkdtempSync('/private/tmp/wanderful-dynamic-native-offline-');fs.chmodSync(directory,0o700);
 const token=randomBytes(32).toString('base64url');
 const prompt='From the village, make a roughly six kilometre loop with a few hilltop places.';
 const env={NODE_ENV:'development',TRAILMIND_RELEASE_STAGE:'local',OWNER_PHONE_TEST_ENABLED:'true',OWNER_PHONE_RESEARCH_TEST_ENABLED:'true',
  DYNAMIC_RESEARCH_ENABLED:'true',...(web?{DYNAMIC_WEB_RESEARCH_ENABLED:'true'}:{}),DYNAMIC_RESEARCH_USER_AGENT:'Wanderful offline fixture',DYNAMIC_RESEARCH_BUDGET_APPROVAL_ID:'offline-fixture-only',DYNAMIC_RESEARCH_DAILY_REQUEST_LIMIT:'2',ROUTE_GLOBAL_MAX_COST:'24',APP_ATTEST_INSTALLATION_MAX_COST:'24',ROUTE_GLOBAL_WINDOW_SECONDS:'86400',APP_ATTEST_INSTALLATION_WINDOW_SECONDS:'86400',LLM_FIRST_PLANNING_ENABLED:'true',
  INTENT_PROVIDER_ENABLED:'true',ROUTE_PROVIDER_ENABLED:'true',OUTDOOR_RESEARCH_PLANNING_ENABLED:'true',OUTDOOR_ROUTABLE_HIGHLIGHT_ACCESS_ENABLED:'true',
  AI_PROVIDER:'google',GOOGLE_MODEL:'gemini-3.8-flash',GOOGLE_API_KEY:'offline-google',GRAPHHOPPER_API_KEY:'offline-routing'};
 const parsed={activityType:'hiking',routeType:'loop',startLocationQuery:'Fixture village',endLocationQuery:null,regionQuery:null,
  targetDistanceKm:6,targetDurationMinutes:null,difficulty:null,desiredFeatures:['viewpoint'],avoidFeatures:[],transportMode:'walking',rawPrompt:prompt,parserSource:'remoteAI',confidence:0.9};
 const call=(id,name,args)=>({type:'function_call',id,name,arguments:args});
 const turns=[
  named ? fixture.route.places.map((p,i)=>call(`resolve-${i}`,'resolve_named_place',{name:p.name,radiusMeters:5000})) : [call('search','search_places',{radiusMeters:5000,kinds:['viewpoint']})],
  [call('route','route_itinerary',{placeIds:fixture.route.places.map(p=>p.id)})],
  ...(revise ? [[call('route-revised','route_itinerary',{placeIds:fixture.route.places.map(p=>p.id).reverse()})]] : []),
 ];let turn=0,routeCalls=0;
 const groundedText='🥾 Schöne Aussicht 山頂 — source description.';
 const json=body=>new Response(JSON.stringify(body),{headers:{'Content-Type':'application/json'}});
 const budget=createOwnerProviderBudget({directory,dynamicResearch:true,limits:{google:8,graphhopper:3,osm:named?4:2,wikidata:10,commons:3,...(web?{grounding:1}:{})},fetchImpl:async(url,init)=>{
  const target=new URL(url);
  if(target.hostname==='generativelanguage.googleapis.com') {
   const body=JSON.parse(init.body);
   if(body.response_format)return json({output_text:JSON.stringify(parsed)});
   if(body.tools?.some(tool=>tool.type==='google_search'))return json({steps:[
    {type:'google_search_call',id:'web-s',arguments:{queries:['village hilltop places']}},
    {type:'google_search_result',call_id:'web-s',result:[{search_suggestions:'<div>Provider suggestions</div>'}]},
    {type:'url_context_call',id:'web-u',arguments:{urls:['https://park.example.org/ridge']}},
    {type:'url_context_result',call_id:'web-u',result:[{url:'https://park.example.org/ridge',status:'success'}]},
    {type:'model_output',content:[{type:'text',text:groundedText,annotations:[{type:'url_citation',url:'https://park.example.org/ridge',title:'Park source',start_index:0,end_index:Buffer.byteLength(groundedText)}]}]}
   ]});
   if(body.tools?.some(t=>t.name==='review_route_quality'))return json({steps:[call('review','review_route_quality',{decision:'complete',summary:'Measured route connecting the selected mapped stops.',remainingWishes:['Current access is unverified.'],evidenceIds:fixture.route.places.map(p=>p.id)})]});
   assert.equal(body.store,false);assert.ok(JSON.stringify(body.input).includes(prompt));
   if(revise && turn===2) assert.ok(JSON.stringify(body.input).includes('route_connection_not_found'));
   return json({steps:turns[turn++]});
  }
  if(target.hostname==='overpass-api.de') {
   const query=new URLSearchParams(init.body).get('data');
   return json({osm3s:{timestamp_osm_base:new Date().toISOString()},elements:fixture.route.places.map((p,i)=>({
   type:'node',id:i+1,version:1,timestamp:'2020-01-01T00:00:00Z',lat:p.coordinate.latitude,lon:p.coordinate.longitude,tags:{name:p.name,...(named?{}:{tourism:'viewpoint'})}})).filter(p=>!named||query.includes(JSON.stringify(p.tags.name)))});
  }
  if(target.hostname==='graphhopper.com') {
   const body=JSON.parse(init.body);assert.equal(body.profile,'foot');routeCalls++;
   if(revise && routeCalls===1)return new Response(JSON.stringify({message:'Connection not found'}),{status:422,headers:{'Content-Type':'application/json'}});
   const geometry={...fixture.route.path.points,coordinates:revise?[...fixture.route.path.points.coordinates].reverse():fixture.route.path.points.coordinates};
   assert.deepEqual(body.points,geometry.coordinates);
   return json({paths:[{...fixture.route.path,points:geometry}],snapped_waypoints:geometry});
  }
  assert.fail('unexpected upstream');
 }});
 const session=createOwnerPhoneTestSession({token,expiresAt:Date.now()+60000,env});
 const server=createOwnerPhoneTestServer({session,env,fetchImpl:budget.fetch});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));budget.close();fs.rmSync(directory,{recursive:true});});
 const post=(path,body)=>fetch(`http://127.0.0.1:${server.address().port}${path}`,{method:'POST',headers:{'content-type':'application/json',authorization:`TrailMindRouteSession ${token}`,'x-trailmind-request-id':randomUUID()},body:JSON.stringify(body)});
 const parseResponse=await post('/api/parse-intent',{prompt,locale:'en',userLocationHint:null});
 assert.equal(parseResponse.status,200);const remote=await parseResponse.json();assert.equal(remote.parserSource,'remoteAI');
 // Apple geocoding is represented by a fixture coordinate; no live Apple request is claimed.
 const body={schemaVersion:3,parserSource:remote.parserSource,prompt,...(web?{researchMode:'web_and_map',locationName:remote.startLocationQuery}:{}),anchor:{latitude:57.2,longitude:-4.7},end:null,
  intent:{activityType:remote.activityType,routeType:remote.routeType,targetDistanceKm:remote.targetDistanceKm,difficulty:remote.difficulty},
  constraints:{maximumDistanceKm:null,maximumDurationMinutes:null,maximumElevationGainMeters:null,hardAvoidances:[]}};
 const response=await post('/api/llm-plan-route',body);assert.equal(response.status,200);
 const result=await response.json();assert.equal(result.route.plannerSource,'gemini_tools');assert.equal(result.route.places.length,3);
 assert.equal(result.route.statistics.distanceMeters,fixture.route.path.distance);assert.equal(result.route.geometryProvider,'graphhopper');
 assert.equal(result.route.webResearch?.provider,web?'google_grounding':undefined);
 if(web) {const block=result.route.webResearch.blocks[0];assert.equal(block.text,groundedText);assert.equal(block.citations[0].endIndex,groundedText.length);}
 if(named) {assert.ok(result.route.places.every(p=>p.category==='named_place'));assert.equal(result.route.counts.resolutions,3);}
 assert.deepEqual(budget.remaining(),{google:(revise?3:4)-(web?1:0),graphhopper:revise?1:2,osm:0,wikidata:10,commons:3,...(web?{grounding:0}:{}),stopped:false});
});
