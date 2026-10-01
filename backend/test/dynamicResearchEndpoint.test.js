import test from 'node:test';
import assert from 'node:assert/strict';
import {llmPlanningAdapterError} from '../src/llmPlanning/adapters/adapterErrors.js';
import {createLLMFirstPlanningEndpoint} from '../src/llmPlanning/llmFirstPlanningEndpoint.js';
const request={schemaVersion:3,parserSource:'remoteAI',prompt:'Walk from the village to a viewpoint and return before lunch.',anchor:{latitude:57.2,longitude:-4.7},end:null,
 intent:{activityType:'hiking',routeType:'loop',targetDistanceKm:6,difficulty:null},constraints:{maximumDistanceKm:null,maximumDurationMinutes:null,maximumElevationGainMeters:null,hardAvoidances:[]}};
const env={NODE_ENV:'test',LLM_FIRST_PLANNING_ENABLED:'true',INTENT_PROVIDER_ENABLED:'true',ROUTE_PROVIDER_ENABLED:'true',DYNAMIC_RESEARCH_ENABLED:'true',
 DYNAMIC_RESEARCH_BUDGET_APPROVAL_ID:'offline-fixture-only',DYNAMIC_RESEARCH_DAILY_REQUEST_LIMIT:'2',
 ROUTE_GLOBAL_MAX_COST:'24',APP_ATTEST_INSTALLATION_MAX_COST:'24',
 ROUTE_GLOBAL_WINDOW_SECONDS:'86400',APP_ATTEST_INSTALLATION_WINDOW_SECONDS:'86400'};
function fixture() {
 let turn=0,releases=0,authorizations=0;const logs=[];
 const calls=[['search_places',{radiusMeters:4000,kinds:['viewpoint']}],['route_itinerary',{placeIds:['osm:node:1']}]];
 const dependencies={interact:async()=>{const [name,args]=calls[turn++];return {steps:[{type:'function_call',id:`c${turn}`,name,arguments:args}]};},
  search:async()=>[{id:'osm:node:1',name:'Mapped hill',category:'viewpoint',coordinate:{latitude:57.21,longitude:-4.7},source:{provider:'openstreetmap'}}],enrich:async()=>null,
  route:async()=>({accepted:true,geometryProvider:'graphhopper',statistics:{distanceMeters:6100},limitations:[]})};
 const options={env,logger:{info:entry=>logs.push(entry)},dynamicResearchDependencies:dependencies,
  authorizer:{authorize:async()=>{authorizations++;return {authorized:true,limitsConsumed:true,rateLimitKey:'offline',release:async()=>{releases++;}};}}};
 return {options,logs,counts:()=>({turn,releases,authorizations})};
}
test('schema 3 passes original prompt through authorized tool loop with no fallback',async()=>{
 const f=fixture();const result=await createLLMFirstPlanningEndpoint(f.options)(request);
 assert.equal(result.statusCode,200);assert.equal(result.payload.schemaVersion,3);assert.equal(result.payload.route.plannerSource,'gemini_tools');
 assert.deepEqual(f.counts(),{turn:2,releases:1,authorizations:1});
 assert.equal(f.logs.at(-1).fallbackAttemptCount,0);assert.ok(!JSON.stringify(f.logs).includes(request.prompt));
});
test('new path is default off and rejects local-parser claims before provider work',async()=>{
 for(const [body,settings] of [[request,{...env,DYNAMIC_RESEARCH_ENABLED:undefined}],[{...request,parserSource:'localParser'},env],[{...request,extra:true},env]]) {
  const f=fixture();const result=await createLLMFirstPlanningEndpoint({...f.options,env:settings})(body);
  assert.notEqual(result.statusCode,200);assert.equal(f.counts().turn,0);
 }
});
test('hard unsupported request releases authorization without model or routing calls',async()=>{
 const f=fixture();const result=await createLLMFirstPlanningEndpoint(f.options)({...request,constraints:{...request.constraints,hardAvoidances:['crowds']}});
 assert.equal(result.statusCode,422);assert.deepEqual(f.counts(),{turn:0,releases:1,authorizations:1});
});
test('failed model generation produces service failure and releases lease',async()=>{
 const f=fixture();f.options.dynamicResearchDependencies.interact=async()=>{throw new Error('private upstream content');};
 const result=await createLLMFirstPlanningEndpoint(f.options)(request);
 assert.equal(result.statusCode,500);assert.ok(!JSON.stringify(result).includes('private'));assert.equal(f.counts().releases,1);
});

for (const [code,status,expected] of [
 ['rate_limited',429,'rate_limited'], ['provider_unavailable',503,'research_unavailable'],
 ['provider_rejected',503,'research_unavailable'], ['invalid_response',503,'research_unavailable'],
 ['configuration_missing',503,'feature_unavailable'], ['timed_out',504,'timed_out'], ['cancelled',499,'cancelled']
]) test(`grounded provider ${code} retains its native service outcome and releases authorization`,async()=>{
 const f=fixture();let searches=0,routes=0;
 f.options.env={...env,DYNAMIC_WEB_RESEARCH_ENABLED:'true'};
 f.options.dynamicResearchDependencies.reviewPlan=async()=>({decision:'complete',summary:'Fixture assessment.',remainingWishes:[],evidenceIds:[]});
 f.options.dynamicResearchDependencies.researchWeb=async()=>{throw llmPlanningAdapterError(code);};
 f.options.dynamicResearchDependencies.search=async()=>{searches++;assert.fail('no places after failed research');};
 f.options.dynamicResearchDependencies.route=async()=>{routes++;assert.fail('no route after failed research');};
 const result=await createLLMFirstPlanningEndpoint(f.options)({...request,researchMode:'web_and_map',locationName:'Public village'});
 assert.equal(result.statusCode,status);assert.equal(result.payload.error.code,expected);
 assert.deepEqual(f.counts(),{turn:0,releases:1,authorizations:1});assert.equal(searches,0);assert.equal(routes,0);
 assert.equal(f.logs.at(-1).errorCode,expected);assert.ok(!JSON.stringify(result).includes('llm_planning_adapter_'));
});

test('unverified web evidence is unavailable, never an internal failure or fallback route',async()=>{
 const f=fixture();f.options.env={...env,DYNAMIC_WEB_RESEARCH_ENABLED:'true'};
 f.options.dynamicResearchDependencies.reviewPlan=async()=>({decision:'complete',summary:'Fixture assessment.',remainingWishes:[],evidenceIds:[]});
 f.options.dynamicResearchDependencies.researchWeb=async()=>{throw Object.assign(Error('private content'),{code:'web_research_unverified'});};
 const result=await createLLMFirstPlanningEndpoint(f.options)({...request,researchMode:'web_and_map',locationName:'Village'});
 assert.equal(result.statusCode,503);assert.equal(result.payload.error.code,'research_unavailable');
 assert.equal(f.counts().turn,0);assert.equal(f.counts().releases,1);assert.ok(!JSON.stringify(result).includes('private'));
});


test('invalid final evidence fails closed without publishing route or provider text',async()=>{
 const f=fixture();f.options.env={...env,DYNAMIC_WEB_RESEARCH_ENABLED:'true'};
 const text='Synthetic private research text.';
 f.options.dynamicResearchDependencies.reviewPlan=async()=>({decision:'complete',summary:'Fixture assessment.',remainingWishes:[],evidenceIds:[]});
 f.options.dynamicResearchDependencies.researchWeb=async()=>({provider:'google_grounding',retrievedAt:'2026-09-09T00:00:00Z',
  observedSearchQueries:1,blocks:[{text,citations:[{url:'https://park.example.org/source',title:'Source',startIndex:0,endIndex:text.length}]}],
  searchSuggestions:['<div>Offline suggestions</div>'],retrievedSourceURLs:['https://park.example.org/source']});
 // The source stub lacks the canonical OSM record URL; final evidence must reject it.
 const result=await createLLMFirstPlanningEndpoint(f.options)({...request,researchMode:'web_and_map',locationName:'Village'});
 assert.equal(result.statusCode,503);assert.equal(result.payload.error.code,'research_unavailable');
 assert.equal(result.payload.route,undefined);assert.equal(f.counts().releases,1);
 for(const value of [result,f.logs])assert.ok(!JSON.stringify(value).includes(text));
});

test('quality exhaustion is a bounded no-match outcome, not an outage or an unreviewed route',async()=>{
 const f=fixture();let routes=0;
 f.options.dynamicResearchDependencies.route=async()=>{routes++;return {accepted:true,statistics:{distanceMeters:6100}};};
 f.options.dynamicResearchDependencies.reviewPlan=async()=>({decision:'reject',summary:'The checked route does not meet the important wishes.',remainingWishes:['A named destination is absent.'],evidenceIds:[]});
 const result=await createLLMFirstPlanningEndpoint(f.options)(request);
 assert.equal(result.statusCode,422);assert.equal(result.payload.error.code,'research_no_acceptable_route');
 assert.equal(result.payload.route,undefined);assert.equal(routes,1);assert.equal(f.counts().releases,1);
 assert.match(result.payload.error.message,/hard limits were preserved/);
});
