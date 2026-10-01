import test from 'node:test';
import assert from 'node:assert/strict';
import {planDynamicResearch,DYNAMIC_LIMITS} from '../src/dynamicResearch/planner.js';
import {validateQualityReview} from '../src/dynamicResearch/quality.js';
import {validateDynamicRequest} from '../src/dynamicResearch/contract.js';
import {validateConditionRecheck,recheckConditions} from '../src/dynamicResearch/recheck.js';
const anchor={latitude:51.86,longitude:10.68};
const places=Array.from({length:80},(_,i)=>({id:`osm:node:${i+1}`,name:`Mapped site ${i+1}`,coordinate:anchor,source:{provider:'openstreetmap',url:`https://www.openstreetmap.org/node/${i+1}`}}));
const request={schemaVersion:3,parserSource:'remoteAI',prompt:'15 km Rundwanderung, lieber Wald und höchstens 150 Höhenmeter.',researchMode:'web_and_map',locationName:'Ilsenburg',anchor,end:null,
 intent:{activityType:'hiking',routeType:'loop',targetDistanceKm:15,difficulty:'easy'},
 constraints:{maximumDistanceKm:null,maximumDurationMinutes:120,maximumElevationGainMeters:150,hardAvoidances:[]},
 preferences:{desiredFeatures:['Forest'],avoidFeatures:['Crowds'],targetDurationMinutes:110,distanceOrigin:'prompt',preferenceOrigin:'saved_profile'},plannedStartAt:'2026-10-01T08:00:00Z'};
const web={provider:'google_grounding',retrievedAt:'2026-09-09T00:00:00Z',observedSearchQueries:1,
 blocks:[{text:'Place evidence.',citations:[{url:places[0].source.url,title:'OSM',startIndex:0,endIndex:15}]}],retrievedSourceURLs:[places[0].source.url],searchSuggestions:['<div>Fixture attribution</div>']};
const call=(id,name,args)=>({type:'function_call',id,name,arguments:args});
test('accepted 12 km geometry can be reviewed and revised to 14.8 km while retaining all wishes and hard bounds',async()=>{
 let turns=0,routes=0,reviews=0;
 const result=await planDynamicResearch(validateDynamicRequest(request),{
 researchWeb:async input=>{assert.deepEqual(input.preferences,request.preferences);assert.deepEqual(input.constraints,request.constraints);assert.equal(input.plannedStartAt,request.plannedStartAt);return web;},
 search:async()=>places,
 interact:async history=>{turns++;if(turns===1)return {steps:[call('s','search_places',{radiusMeters:7000,kinds:['landmark']})]};
 if(turns===3)assert.match(JSON.stringify(history),/quality_revision_requested/);
 return {steps:[call(`r${turns}`,'route_itinerary',{placeIds:[places[turns-2].id]})]};},
 route:async({request:r})=>{assert.deepEqual(r.constraints,request.constraints);routes++;return {accepted:true,statistics:{distanceMeters:routes===1?12000:14800,durationSeconds:6600,elevationGainMeters:120}};},
 reviewPlan:async context=>{reviews++;assert.deepEqual(context.request,request);assert.equal(context.discoveredPlaces.length,80);
 assert.ok(context.webResearch.routeEvidence.places.length<=10);
 assert.equal(context.localConditions.visitTime,request.plannedStartAt);
 return {decision:reviews===1?'revise':'complete',summary:reviews===1?'Improve distance fit using a different discovered stop.':'Die gemessene Route entspricht der gewünschten Distanz.',remainingWishes:['Wald und wenig Betrieb sind nicht bestätigt.'],evidenceIds:context.selectedPlaces.map(p=>p.id)};}
 });
 assert.equal(routes,2);assert.equal(reviews,2);assert.equal(result.statistics.distanceMeters,14800);
 assert.equal(result.counts.generations,6);assert.equal(result.qualityReview.decision,'complete');
 assert.deepEqual(result.webResearch.routeEvidence.places.map(p=>p.selection),['selected','excluded']);
 assert.equal(result.places[0].id,places[1].id);
});
test('quality evidence references cannot promote an excluded candidate',()=>{
 const context={selectedPlaces:[places[1]],consideredPlaces:places.slice(0,2)};
 for(const review of [{summary:'A route assessment.',evidenceIds:[places[0].id]}]) {
 assert.throws(()=>validateQualityReview({decision:'complete',remainingWishes:[],...review},context),{code:'invalid_quality_review'});
 }
});
test('request contract carries preferences and rejects fabricated origins or malformed duration',()=>{
 assert.deepEqual(validateDynamicRequest(request),request);
 for(const preferences of [{...request.preferences,preferenceOrigin:'inferred_private_data'},{...request.preferences,targetDurationMinutes:-1}])assert.throws(()=>validateDynamicRequest({...request,preferences}));
});
test('saved geometry recheck returns a digest and notices without any route or model dependency',async()=>{
 const path=[[10.68,51.86],[10.69,51.87]],body={schemaVersion:4,geometryJSON:JSON.stringify(path),plannedStartAt:request.plannedStartAt};
 const validated=validateConditionRecheck(body);let calls=0;
 const result=await recheckConditions(validated,async({area,visitTime},{reserveSource})=>{calls++;assert.equal(visitTime,request.plannedStartAt);assert.ok(reserveSource());
 return {area,checkedAt:new Date().toISOString(),notices:[],sources:[{id:'coverage',name:'Local reports',url:null,authority:'unknown',state:'not_checked',reason:'no_reviewed_adapter',checkedAt:new Date().toISOString()}]};});
 assert.equal(calls,1);assert.equal(result.geometryDigest,validated.geometryDigest);assert.equal(result.localConditions.scope,'route_corridor');assert.deepEqual(validated.path,path);
 assert.equal(result.localConditions.coverage,'partial');assert.equal(result.path,undefined);
 assert.notEqual(validateConditionRecheck({...body,geometryJSON:JSON.stringify([...path,[10.7,51.88]])}).geometryDigest,result.geometryDigest);
});

test('cancelled saved-route check settles even when an adapter ignores its signal',async()=>{
 const controller=new AbortController();
 const request=validateConditionRecheck({schemaVersion:4,geometryJSON:'[[10.68,51.86],[10.69,51.87]]',plannedStartAt:null});
 const pending=recheckConditions(request,async()=>new Promise(()=>{}),{signal:controller.signal});
 const outcome=assert.rejects(pending,{code:'request_cancelled'});
 controller.abort();await outcome;
});

test('point-to-point may preserve a direct itinerary without inventing intermediate interests',async()=>{
 const direct={...request,end:{latitude:51.8,longitude:10.7},intent:{...request.intent,routeType:'pointToPoint'}};
 let routed;
 const result=await planDynamicResearch(direct,{researchWeb:async()=>web,search:async()=>[],
 interact:async()=>({steps:[call('direct','route_itinerary',{placeIds:[]})]}),
 route:async input=>{routed=input;return {accepted:true,statistics:{distanceMeters:15000}};},
 reviewPlan:async()=>({decision:'complete',summary:'Direkte Verbindung zwischen Start und Ziel.',remainingWishes:['Wald bleibt unbestätigt.'],evidenceIds:[]})});
 assert.equal(result.places.length,0);assert.deepEqual(routed.request.end,direct.end);assert.equal(result.webResearch.routeEvidence,undefined);
});

test('honest exclusion explanations and overlapping German place names do not invalidate a measured route',()=>{
 for(const [excluded,selected,summary] of [
 ['Ilsenstein','Paternosterklippe','Ilsenstein war nicht erreichbar. Die Route führt stattdessen zur Paternosterklippe.'],
 ['Brocken','Kleiner Brocken','Die Route führt zum Kleinen Brocken.']]) {
 const first={...places[0],name:excluded},second={...places[1],name:selected};
 assert.doesNotThrow(()=>validateQualityReview({decision:'complete',summary,remainingWishes:[],evidenceIds:[second.id]},
 {selectedPlaces:[second],consideredPlaces:[first,second]}));
 }
});

function closingFixture(decision,limits={}) {
 let routes=0,reviews=0,turns=0;const contexts=[];
 const deps={search:async()=>places,interact:async()=>({steps:[++turns===1?call('s','search_places',{radiusMeters:5000,kinds:['landmark']}):call(`r${turns}`,'route_itinerary',{placeIds:[places[turns-2].id]})]}),
 route:async()=>({accepted:true,statistics:{distanceMeters:[12000,13000,14900][routes++]}}),
 reviewPlan:async context=>{contexts.push(context);reviews++;return {decision:reviews===1?'revise':decision,summary:'This measured route still misses some of the distance wish.',remainingWishes:['The requested distance remains a partial match.'],evidenceIds:[]};}};
 return {run:()=>planDynamicResearch({...request,researchMode:'mapped_places'},deps,{limits:{...DYNAMIC_LIMITS,...limits}}),deps,contexts,counts:()=>({routes,reviews})};
}
test('two revise decisions terminate honestly before a third unreviewable route',async()=>{
 const f=closingFixture('revise');await assert.rejects(f.run(),{code:'research_no_acceptable_route'});
 assert.deepEqual(f.counts(),{routes:2,reviews:2});
 assert.equal(f.contexts[0].canRevise,true);assert.equal(f.contexts[1].canRevise,false);assert.equal(f.contexts[1].finalReview,true);
});
test('the final reviewer may explicitly offer a checked partial match with remaining wishes',async()=>{
 const f=closingFixture('partial');const result=await f.run();
 assert.deepEqual(f.counts(),{routes:2,reviews:2});assert.equal(result.statistics.distanceMeters,13000);
 assert.equal(result.qualityReview.decision,'partial');assert.equal(result.qualityReview.remainingWishes.length,1);
});
test('unsupported safety and drinking-water assurances cannot become a reviewed route',async()=>{
 const f=closingFixture('complete');
 f.deps.reviewPlan=async()=>({decision:'complete',summary:'This route is guaranteed safe and has drinking water.',remainingWishes:[],evidenceIds:[]});
 await assert.rejects(f.run(),{code:'invalid_quality_review'});
 for(const summary of ['Die Route ist garantiert sicher.','Die Route hat Trinkwasser.']) {
   assert.throws(()=>validateQualityReview({decision:'complete',summary,remainingWishes:[],evidenceIds:[]},{selectedPlaces:[]}),{code:'invalid_quality_review'});
 }
});
test('final review copy uses measured data even when model prose makes an unknown-language claim',async()=>{
 const f=closingFixture('complete');
 f.deps.reviewPlan=async()=>({decision:'complete',summary:'Questa escursione è sicura e offre acqua potabile.',
   remainingWishes:['Acqua disponibile.'],evidenceIds:[]});
 const result=await f.run();
 assert.equal(result.qualityReview.summary,'GraphHopper measured 12.0 km. Review the mapped stops and current conditions before starting.');
 assert.deepEqual(result.qualityReview.remainingWishes,['Some requested preferences remain unverified.']);
 assert.doesNotMatch(JSON.stringify(result.qualityReview),/acqua|sicura/i);
});
test('review capacity is held before a route, even at generation and route boundaries',async()=>{
 for(const limits of [{generations:2},{generations:3},{routes:1},{qualityReviews:1}]) {
  const f=closingFixture('complete',limits);await assert.rejects(f.run(),{code:'research_no_acceptable_route'});
  assert.equal(f.counts().routes,limits.generations===2?0:1);
  assert.equal(f.counts().reviews,f.counts().routes);
 }
});
test('rejected geometry releases its held review turn, without spending a review or loosening validation',async()=>{
 const f=closingFixture('complete');let calls=0;
 f.deps.route=async()=>++calls===1?{accepted:false,reasonCode:'maximum_elevation_exceeded'}:{accepted:true,statistics:{distanceMeters:13000}};
 f.deps.reviewPlan=async()=>({decision:'partial',summary:'Checked partial match.',remainingWishes:['Views remain unverified.'],evidenceIds:[]});
 const result=await f.run();assert.equal(calls,2);assert.equal(result.counts.qualityReviews,1);
});
test('a partial decision requires explicit open wishes; rejected or malformed reviews never become routes',async()=>{
 assert.throws(()=>validateQualityReview({decision:'partial',summary:'Fine.',remainingWishes:[],evidenceIds:[]},{selectedPlaces:[]}),{code:'invalid_quality_review'});
 const f=closingFixture('reject');await assert.rejects(f.run(),{code:'research_no_acceptable_route'});assert.deepEqual(f.counts(),{routes:2,reviews:2});
});

test('generic current information uses resolved route context once and cannot spend the held review',async()=>{
 const f=closingFixture('partial');let calls=0;
 f.deps.currentInformation=async(input,options)=>{
  calls++;assert.deepEqual(input.request.anchor,request.anchor);assert.equal(input.request.locationName,'Ilsenburg');
  assert.equal(input.visitTime,request.plannedStartAt);assert.equal(input.path.length,2);assert.equal(input.routePlaces.length,1);
  for(let i=0;i<3;i++)assert.equal(options.reserveGeneration(),true);
  assert.equal(options.reserveGeneration(),false);
  for(let i=0;i<6;i++)assert.equal(options.reserveSource(),true);
  assert.equal(options.reserveSource(),false);
  const checkedAt=new Date().toISOString();
  return {area:input.area,checkedAt,notices:[],sources:[{id:'generic',name:'Local source search',url:'https://authority.example.org/notices',authority:'unknown',state:'checked',reason:'no_supported_current_notice',checkedAt}]};
 };
 f.deps.route=async()=>({accepted:true,path:{points:{coordinates:[[10.68,51.86],[10.69,51.87]]}},statistics:{distanceMeters:13000}});
 const result=await f.run();assert.equal(calls,1);assert.equal(result.counts.qualityReviews,2);
 assert.equal(result.counts.currentInformationGenerations,3);assert.equal(result.counts.currentInformationSources,6);
 assert.ok(f.contexts.every(c=>c.localConditions.sources.some(s=>s.id==='generic')));
});
test('global information budget is reserved before the first route; no doomed paid route with a small generation budget',async()=>{
 const f=closingFixture('complete',{generations:5});f.deps.currentInformation=async()=>assert.fail('no route could be reviewed');
 await assert.rejects(f.run(),{code:'research_no_acceptable_route'});assert.deepEqual(f.counts(),{routes:0,reviews:0});
});
test('saved geometry current lookup is bounded and receives the same path and trip time',async()=>{
 const validated=validateConditionRecheck({schemaVersion:4,geometryJSON:'[[10.68,51.86],[10.69,51.87]]',plannedStartAt:request.plannedStartAt});
 let genericCalls=0;
 const snapshot=area=>({area,checkedAt:new Date().toISOString(),notices:[],sources:[]});
 const result=await recheckConditions(validated,async({area})=>snapshot(area),{currentInformation:async(input,options)=>{
   genericCalls++;assert.deepEqual(input.path,validated.path);assert.equal(input.visitTime,request.plannedStartAt);
   assert.deepEqual(input.request.anchor,request.anchor);
   assert.deepEqual(Array.from({length:4},()=>options.reserveGeneration()),[true,true,true,false]);
   assert.deepEqual(Array.from({length:7},()=>options.reserveSource()),[true,true,true,true,true,true,false]);
   return snapshot(input.area);
 }});
 assert.equal(genericCalls,1);assert.equal(result.geometryDigest,validated.geometryDigest);assert.equal(result.localConditions.scope,'route_corridor');
});

test('saved route names and canonical sourced stops survive the recheck request contract',()=>{
 const body={schemaVersion:4,geometryJSON:'[[10.68,51.86],[10.69,51.87]]',plannedStartAt:null,locationName:'A resolved village',routePlaces:[{name:'A mapped stop',coordinate:anchor,source:{url:'https://www.openstreetmap.org/node/1'}}]};
 const parsed=validateConditionRecheck(body);assert.equal(parsed.locationName,body.locationName);assert.deepEqual(parsed.routePlaces,body.routePlaces);
 for(const changed of [{...body,routePlaces:[{...body.routePlaces[0],source:{url:'http://127.0.0.1/private'}}]},{...body,locationName:'<script>'}])assert.throws(()=>validateConditionRecheck(changed),{code:'invalid_request'});
});

test('a revised final corridor cannot inherit full current-source coverage from its earlier option',async()=>{
 const f=closingFixture('partial');let routes=0,lookups=0;
 f.deps.route=async()=>({accepted:true,path:{points:{coordinates:++routes===1?[[10.68,51.86],[10.69,51.87]]:[[10.68,51.86],[10.9,52.0]]}},statistics:{distanceMeters:13000}});
 f.deps.currentInformation=async({area},{reserveGeneration})=>{lookups++;assert.equal(reserveGeneration(),true);const checkedAt=new Date().toISOString();return {area,checkedAt,notices:[],sources:[{id:'generic-local-research',name:'Local research',url:'https://authority.example.org/notices',authority:'unknown',checkedAt,state:'checked',reason:'bounded_discovery_and_read'}]};};
 const result=await f.run();assert.equal(lookups,1);assert.equal(result.localConditions.sources.find(s=>s.id==='generic-local-research').reason,'final_itinerary_changed');
 assert.equal(f.contexts[1].localConditions.sources.find(s=>s.id==='generic-local-research').state,'not_checked');
 assert.ok(result.localConditions.limitations.some(s=>s.includes('earlier route option')));
});
