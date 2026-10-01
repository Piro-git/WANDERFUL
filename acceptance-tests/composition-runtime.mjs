import test from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const root=process.env.CANDIDATE_ROOT??process.cwd();
const {createDynamicDependencies}=await import(pathToFileURL(`${root}/backend/src/dynamicResearch/composition.js`));
const {planDynamicResearch}=await import(pathToFileURL(`${root}/backend/src/dynamicResearch/planner.js`));
test('production planner and composition attempt a current source search for independently resolved places',async()=>{
 for(const [name,latitude,longitude] of [['Bad Urach',48.492,9.4],['Dieulefit',44.523,5.065],['Port Townsend',48.117,-122.76]]){
  const anchor={latitude,longitude},place={id:'osm:node:123',name:'An independently mapped route stop',coordinate:{latitude:latitude+.003,longitude:longitude+.003},source:{provider:'openstreetmap',url:'https://www.openstreetmap.org/node/123'}};
  let requests=0,turns=0;const sent=[];
  const composed=createDynamicDependencies({webResearchEnabled:true,env:{AI_PROVIDER:'google',GOOGLE_API_KEY:'offline-fixture-only',GOOGLE_MODEL:'gemini-3.8-flash',DYNAMIC_RESEARCH_USER_AGENT:'Acceptance offline test'},
   fetchImpl:async(url,init)=>{requests++;sent.push({url:String(url),body:JSON.parse(init.body)});throw new TypeError('deliberately unavailable offline transport');},
   provider:{route:async()=>{throw Error('fixture routing replaces provider');}}});
  const request={prompt:`A short quiet walk from ${name}`,locationName:name,anchor,end:null,researchMode:'mapped_places',plannedStartAt:'2026-09-12T08:00:00-07:00',intent:{activityType:'hiking',routeType:'loop',targetDistanceKm:5}};
  const result=await planDynamicResearch(request,{currentInformation:composed.currentInformation,
   search:async()=>[place],interact:async()=>({steps:[++turns===1?{type:'function_call',id:'s',name:'search_places',arguments:{radiusMeters:4000,kinds:['viewpoint']}}:{type:'function_call',id:'r',name:'route_itinerary',arguments:{placeIds:[place.id]}}]}),
   route:async()=>({accepted:true,statistics:{distanceMeters:5000,durationSeconds:3600,elevationGainMeters:100},path:{points:{coordinates:[[longitude,latitude],[longitude+.003,latitude+.003],[longitude,latitude]]}}}),
   reviewPlan:async context=>({decision:'complete',summary:'Measured route fits; current source lookup was unavailable.',remainingWishes:[],evidenceIds:context.selectedPlaces.map(p=>p.id)})});
  assert.equal(requests,1,`${name} must attempt general current research exactly once here`);
  assert.equal(sent[0].url,'https://generativelanguage.googleapis.com/v1beta/interactions');const input=JSON.parse(sent[0].body.input);assert.equal(input.purpose,'local_conditions');assert.deepEqual(input.resolvedLocation.coordinate,anchor);assert.equal(input.locationName,name);assert.equal(input.plannedStartAt,'2026-09-12T08:00:00-07:00');assert.ok(input.routeContext.area[0]<=longitude);
  assert.equal(result.accepted,true);assert.equal(result.counts.currentInformationGenerations,1);
  assert.ok(result.localConditions.sources.some(s=>s.id==='generic-local-research'&&s.state==='unavailable'));
 }
});
