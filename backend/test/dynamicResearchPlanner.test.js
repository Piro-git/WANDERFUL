import test from 'node:test';
import assert from 'node:assert/strict';
import {planDynamicResearch,DYNAMIC_LIMITS} from '../src/dynamicResearch/planner.js';
import {createGeminiResearchInteraction} from '../src/dynamicResearch/gemini.js';
const anchor={latitude:57.2,longitude:-4.7};
const request={prompt:'Make a walk from my chosen village, returning after a viewpoint and a quiet landmark.',anchor,intent:{routeType:'loop',activityType:'hiking',targetDistanceKm:12}};
const places=['1','2'].map((id,i)=>({id:`osm:node:${id}`,name:`Source place ${id}`,coordinate:{latitude:57.21+i/100,longitude:-4.69},category:'viewpoint',source:{provider:'openstreetmap',url:`https://www.openstreetmap.org/node/${id}`}}));
const call=(id,name,args)=>({type:'function_call',id,name,arguments:args});
const search=()=>call('s','search_places',{radiusMeters:5000,kinds:['viewpoint']});
const route=(id,ids)=>call(id,'route_itinerary',{placeIds:ids.map(n=>`osm:node:${n}`)});
const finish=()=>call('finish','finish_plan',{routeId:'measured-2'});
function dependencies(turns) {
  let index=0;
  const seen=[];
  return {seen,interact:async history=>{seen.push(structuredClone(history));return {steps:turns[index++]??[]};},search:async()=>places,enrich:async()=>null,
    route:async()=>({accepted:true,statistics:{distanceMeters:12000},limitations:[]})};
}
test('arbitrary original prompts preserve stateless steps and measured feedback through model-led revision',async()=>{
  for(const prompt of [request.prompt,'Ich starte in einem Dorf und möchte einen Wasserfall besuchen, dann wieder zurück.','A short afternoon walk around the village near our cabin in Japan.']) {
    const thought={type:'thought',signature:'opaque-provider-signature'};
    const deps=dependencies([[thought,search()],[route('r1',['1','2'])],[route('r2',['2'])]]);
    let attempts=0;
    deps.route=async input=>{
      attempts++;
      assert.deepEqual(input.places.map(p=>p.id),attempts===1?['osm:node:1','osm:node:2']:['osm:node:2']);
      return attempts===1?{accepted:false,reasonCode:'soft_distance_deviation',statistics:{distanceMeters:18000}}:
        {accepted:true,statistics:{distanceMeters:12500},limitations:['Review conditions.']};
    };
    const result=await planDynamicResearch({...request,prompt},deps);
    assert.equal(result.plannerSource,'gemini_tools');assert.equal(result.counts.routes,2);
    assert.equal(result.statistics.distanceMeters,12500);
    assert.deepEqual(deps.seen[1].find(step=>step.type==='thought'),thought);
    assert.ok(deps.seen[0][0].content[0].text.includes(prompt));
    assert.ok(JSON.stringify(deps.seen[2]).includes('18000'));
  }
});
test('invented and undisclosed IDs fail before any routing call',async()=>{
  for(const turns of [[[search(),route('r',['1'])]],[[search()],[route('r',['999'])]]]) {
    const deps=dependencies(turns);let routes=0;deps.route=async()=>{routes++;};
    await assert.rejects(planDynamicResearch(request,deps),error=>['unread_or_unknown_place_id','invalid_tool_call'].includes(error.code));assert.equal(routes,0);
  }
});
test('model coordinates and unverified final selection cannot escape tool contracts',async()=>{
  for(const c of [call('s','search_places',{radiusMeters:5000,kinds:['peak'],anchor:{latitude:0,longitude:0}}),finish()]) {
    await assert.rejects(planDynamicResearch(request,dependencies([[c]])));
  }
});
test('duplicate itineraries consume no second route and never trigger deterministic fallback',async()=>{
  const deps=dependencies([[search()],[route('r1',['1'])],[route('r2',['1'])],[]]);
  let routes=0;deps.route=async()=>{routes++;return {accepted:false,reasonCode:'soft_distance_deviation'};};
  await assert.rejects(planDynamicResearch(request,deps),{code:'model_did_not_finish_route'});assert.equal(routes,1);
  assert.ok(JSON.stringify(deps.seen.at(-1)).includes('duplicate_itinerary'));
});
test('generation cap and replay prevention stop further dependency calls',async()=>{
  const deps=dependencies([[search()]]);
  await assert.rejects(planDynamicResearch(request,deps,{limits:{...DYNAMIC_LIMITS,generations:1}}),{code:'research_budget_exhausted'});
  assert.equal(deps.seen.length,1);
  await assert.rejects(planDynamicResearch(request,dependencies([[search()],[search()]])),{code:'invalid_tool_call'});
});
test('caller cancellation and deadline stop stalled providers with no follow-on work',async()=>{
  const controller=new AbortController();controller.abort();let called=0;
  const deps=dependencies([]);deps.interact=async()=>{called++;return new Promise(()=>{});};
  await assert.rejects(planDynamicResearch(request,deps,{signal:controller.signal}),{code:'request_cancelled'});assert.equal(called,0);
  await assert.rejects(planDynamicResearch(request,deps,{limits:{...DYNAMIC_LIMITS,deadlineMs:10}}),{code:'research_timed_out'});assert.equal(called,1);
});
test('empty research and plain model text are not successful AI routes',async()=>{
  const deps=dependencies([[search()],[{type:'model_output',content:[{type:'text',text:'I found a wonderful route.'}]}]]);deps.search=async()=>[];
  await assert.rejects(planDynamicResearch(request,deps),{code:'model_did_not_finish_route'});
});
test('documented Google tool request uses stateless history, no schema or automatic retries',async()=>{
  const requests=[];
  const input=[{type:'user_input',content:[{type:'text',text:'original request'}]}];
  const interact=createGeminiResearchInteraction({apiKey:'offline-fixture',model:'gemini-3.8-flash',fetchImpl:async(url,init)=>{
    requests.push({url:url.href,body:JSON.parse(init.body)});
    return new Response(JSON.stringify({error:{code:'internal'}}),{status:500,headers:{'Content-Type':'application/json'}});
  }});
  await assert.rejects(interact(input));assert.equal(requests.length,1);
  const {url,body}=requests[0];
  assert.equal(url,'https://generativelanguage.googleapis.com/v1beta/interactions');
  assert.deepEqual(body.input,input);assert.equal(body.store,false);assert.equal(body.response_format,undefined);
  assert.deepEqual(body.tools.map(t=>t.name),['search_places','resolve_named_place','route_itinerary']);
});

test('web mode requires grounded research before mapped selection and retains the complete display envelope',async()=>{
 const deps=dependencies([[search()],[route('r1',['1'])]]);
 const web={provider:'google_grounding',retrievedAt:'2026-09-09T00:00:00Z',observedSearchQueries:1,blocks:[{text:'Source-backed research text.',citations:[{url:'https://park.example.org/ridge',title:'Park',startIndex:0,endIndex:28}]}],
  searchSuggestions:['<div>Provider suggestions</div>'],retrievedSourceURLs:['https://park.example.org/ridge']};
 let readFirst=false;deps.researchWeb=async({prompt,locationName})=>{assert.equal(prompt,request.prompt);assert.equal(locationName,'Resolved village');readFirst=true;return web;};
 deps.reviewPlan=async()=>({decision:'complete',summary:'Source-based planning assessment.',remainingWishes:[],evidenceIds:[]});
 const originalInteract=deps.interact;deps.interact=async(...args)=>{assert.equal(readFirst,true);return originalInteract(...args);};
 const result=await planDynamicResearch({...request,researchMode:'web_and_map',locationName:'Resolved village'},deps);
 const {routeEvidence,...original}=result.webResearch;assert.deepEqual(original,web);assert.equal(routeEvidence.places[0].selection,'selected');assert.equal(result.counts.generations,4);
 assert.ok(JSON.stringify(deps.seen[0]).includes('Source-backed research text.'));
 assert.ok(!JSON.stringify(deps.seen[0]).includes('<div>'));
});
test('web-mode failure cannot silently downgrade to mapped-only success',async()=>{
 const deps=dependencies([[search()]]);let searches=0;deps.search=async()=>{searches++;return places;};
 await assert.rejects(planDynamicResearch({...request,researchMode:'web_and_map'},deps),{code:'web_research_unavailable'});
 deps.researchWeb=async()=>({provider:'google_grounding',blocks:[]});
 await assert.rejects(planDynamicResearch({...request,researchMode:'web_and_map'},deps),{code:'web_research_unverified'});
 assert.equal(searches,0);assert.equal(deps.seen.length,0);
});

test('named resolution preserves mapped coordinates, requires inspection and bounds duplicate lookups',async()=>{
 const resolve=(id,name='Source place 1')=>call(id,'resolve_named_place',{name,radiusMeters:5000});
 const deps=dependencies([[resolve('n1'),resolve('n2')],[route('r',['1'])]]);
 let lookups=0,routed=0;
 deps.resolve=async args=>{lookups++;assert.deepEqual(args.anchor,anchor);assert.equal(args.name,'Source place 1');return {state:'resolved',place:{...places[0],category:'named_place'}};};
 deps.route=async({places:selected})=>{routed++;assert.deepEqual(selected[0].coordinate,places[0].coordinate);return {accepted:true,statistics:{distanceMeters:12000},limitations:[]};};
 const result=await planDynamicResearch(request,deps);
 assert.equal(lookups,1);assert.equal(routed,1);assert.equal(result.counts.resolutions,1);
 assert.ok(JSON.stringify(deps.seen[1]).includes('duplicate_resolution'));
 const capped=dependencies([[resolve('n1','One'),resolve('n2','Two'),resolve('n3','Three'),resolve('n4','Four')]]);
 let attempts=0;capped.resolve=async()=>{attempts++;return {state:'no_match_in_region'};};
 await assert.rejects(planDynamicResearch(request,capped),{code:'research_budget_exhausted'});assert.equal(attempts,3);
});
test('ambiguous names, absent names and model coordinates cannot enter a route',async()=>{
 for(const state of ['ambiguous','no_match_in_region']) {
  const deps=dependencies([[call('n','resolve_named_place',{name:'Source place 1',radiusMeters:5000})],[route('r',['1'])]]);
  let routed=0;deps.resolve=async()=>({state});deps.route=async()=>{routed++;};
  await assert.rejects(planDynamicResearch(request,deps),{code:'unread_or_unknown_place_id'});assert.equal(routed,0);
 }
 const deps=dependencies([[call('n','resolve_named_place',{name:'Source place 1',radiusMeters:5000,anchor:{latitude:0,longitude:0}})]]);
 let lookedUp=0;deps.resolve=async()=>{lookedUp++;};
 await assert.rejects(planDynamicResearch(request,deps),{code:'invalid_tool_arguments'});assert.equal(lookedUp,0);
});


test('optional source outage retains only inspected identities and opens a no-retry circuit',async()=>{
 for(const code of ['rate_limited','timed_out','provider_unavailable']) {
  const resolve=id=>call(id,'resolve_named_place',{name:id,radiusMeters:5000});
  const deps=dependencies([[search()],[resolve('missing')],[resolve('again'),call('s2','search_places',{radiusMeters:6000,kinds:['peak']})],[route('r',['1'])]]);
  let lookups=0,searches=0;
  deps.search=async()=>{searches++;return places;};
  deps.resolve=async()=>{lookups++;throw Object.assign(new Error(code),{code});};
  const result=await planDynamicResearch(request,deps);
  assert.equal(lookups,1);assert.equal(searches,1);
  assert.deepEqual(result.places.map(p=>p.id),['osm:node:1']);
  assert.equal(result.counts.resolutions,1);assert.equal(result.counts.searches,1);
  assert.ok(JSON.stringify(deps.seen[3]).includes('source_temporarily_unavailable'));
 }
});
test('source failure without inspected places and source configuration failures remain fatal',async()=>{
 for(const [priorPlaces,code] of [[false,'rate_limited'],[true,'configuration_missing']]) {
  const deps=dependencies([...(priorPlaces?[[search()]]:[]),[call('n','resolve_named_place',{name:'Missing',radiusMeters:5000})]]);
  deps.resolve=async()=>{throw Object.assign(new Error(code),{code});};
  await assert.rejects(planDynamicResearch(request,deps),{code});
 }
});


test('planning context exposes verified geography without granting model-coordinate routing',async()=>{
 const deps=dependencies([[search()],[route('r',['1'])]]);
 await planDynamicResearch(request,deps);
 const context=JSON.parse(deps.seen[0][0].content[0].text);
 assert.deepEqual(context.verifiedStart,anchor);
 const discovery=deps.seen[1].find(s=>s.type==='function_result'&&s.name==='search_places');
 const found=JSON.parse(discovery.result[0].text).places[0];
 assert.deepEqual(found.coordinate,places[0].coordinate);
 assert.ok(found.straightLineDistanceFromStartMeters>1000&&found.straightLineDistanceFromStartMeters<1500);
 assert.equal(found.distanceMeters,undefined);
});


test('failed stop feedback preserves reached IDs and the measured distance target for revision',async()=>{
  const deps=dependencies([[search()],[route('r1',['1','2'])],[route('r2',['2'])]]);
  let attempts=0;
  deps.route=async()=>++attempts===1
    ?{accepted:false,reasonCode:'place_approach_too_far',unreachedPlaceIds:['osm:node:1'],statistics:{distanceMeters:18000}}
    :{accepted:true,statistics:{distanceMeters:12500},limitations:[]};
  await planDynamicResearch(request,deps);
  const feedback=deps.seen[2].filter(x=>x.type==='function_result'&&x.name==='route_itinerary').map(x=>JSON.parse(x.result[0].text)).at(-1);
  assert.deepEqual(feedback.reachedPlaceIds,['osm:node:2']);
  assert.deepEqual(feedback.unreachedPlaceIds,['osm:node:1']);
  assert.deepEqual(feedback.acceptedDistanceRangeMeters,{minimum:9600,maximum:15600});
  assert.equal(feedback.remainingRouteAttempts,DYNAMIC_LIMITS.routes-1);
  assert.equal(feedback.statistics.distanceMeters,18000);
  assert.equal(attempts,2);
});

test('early exclusion avoids a provider attempt; repeated failed stop cannot spend another route',async()=>{
 const turns=[[search()],[route('r1',['1'])],[route('r2',['1','2'])],[route('r3',['2'])]];
 const deps=dependencies(turns);let attempts=0,accessCalls=0;
 deps.access=async({places:found})=>{accessCalls++;return found.map(p=>({schemaVersion:1,placeId:p.id,state:'unknown',reason:'connection_not_documented',checkedAt:new Date().toISOString(),evidence:[],target:null}));};
 deps.route=async()=>++attempts===1?{accepted:false,reasonCode:'place_approach_too_far',unreachedPlaceIds:['osm:node:1']}:{accepted:true,statistics:{distanceMeters:12000}};
 const result=await planDynamicResearch(request,deps);
 assert.equal(accessCalls,1);assert.equal(attempts,2);assert.equal(result.counts.avoidedRouteCalls,1);
 assert.equal(result.counts.generations,4); // no added model round: access runs within existing turn boundaries.
 const excluded=dependencies([[search()],[route('r1',['1'])],[route('r2',['2'])]]);
 let actual=0;excluded.access=async({places:found})=>found.map(p=>({schemaVersion:1,placeId:p.id,state:p.id.endsWith(':1')?'excluded':'unknown',reason:'explicit_access_restriction',checkedAt:new Date().toISOString(),evidence:[],target:null}));
 excluded.route=async()=>{actual++;return {accepted:true,statistics:{distanceMeters:12000}};};
 const early=await planDynamicResearch(request,excluded);assert.equal(actual,1);assert.equal(early.counts.avoidedRouteCalls,1);
});
test('access cancellation and source budget exhaustion cannot bypass cancellation or quietly grant permission',async()=>{
 const deps=dependencies([[search()],[route('r',['1'])]]);
 deps.access=async()=>new Promise(()=>{});
 await assert.rejects(planDynamicResearch(request,deps,{limits:{...DYNAMIC_LIMITS,deadlineMs:20}}),{code:'research_timed_out'});
 const controller=new AbortController();controller.abort();
 await assert.rejects(planDynamicResearch(request,deps,{signal:controller.signal}),{code:'request_cancelled'});
});
