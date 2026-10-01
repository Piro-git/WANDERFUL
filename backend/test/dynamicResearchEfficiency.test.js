import test from 'node:test';
import assert from 'node:assert/strict';
import {planDynamicResearch,DYNAMIC_LIMITS} from '../src/dynamicResearch/planner.js';

const anchor={latitude:57.2,longitude:-4.7};
const request={prompt:'A twelve kilometre loop with mapped hilltop places.',anchor,
  intent:{routeType:'loop',activityType:'hiking',targetDistanceKm:12},
  constraints:{maximumElevationGainMeters:400,hardAvoidances:['majorRoads']}};
const places=Array.from({length:4},(_,i)=>({id:`osm:node:${i+1}`,name:`Fixture hill ${i+1}`,category:'viewpoint',
  coordinate:{latitude:57.21+i/100,longitude:-4.69},coordinateKind:'mapped_point',wikidataId:`Q${i+1}`,
  source:{provider:'openstreetmap',url:`https://www.openstreetmap.org/node/${i+1}`,version:2,
    attribution:'© OpenStreetMap contributors',license:'ODbL-1.0'},
  facts:[{code:'mapped_category',value:'viewpoint'}],limitations:['Current access and safety are not verified.']}));
const call=(id,name,args)=>({type:'function_call',id,name,arguments:args});
const search=()=>call('s','search_places',{radiusMeters:6000,kinds:['viewpoint']});
const route=(ids,id='r')=>call(id,'route_itinerary',{placeIds:ids.map(i=>places[i].id)});
const measured={accepted:true,statistics:{distanceMeters:12000},limitations:['Review conditions.']};
function fixture(turns=[[search()],[route([0,1,2])]]) {
  let turn=0;const history=[];
  return {history,interact:async input=>{history.push(structuredClone(input));return {steps:turns[turn++]??[]};},
    search:async()=>structuredClone(places),route:async()=>measured};
}
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('two model turns suffice: discovery includes complete evidence and acceptance needs no finish call',async()=>{
  const deps=fixture();
  const result=await planDynamicResearch(request,deps,{limits:{...DYNAMIC_LIMITS,generations:2,toolCalls:2}});
  assert.equal(result.counts.generations,2);assert.equal(result.counts.toolCalls,2);assert.equal(result.counts.routes,1);
  const context=JSON.parse(deps.history[0][0].content[0].text);
  assert.deepEqual(context.constraints,request.constraints);
  const discovered=JSON.parse(deps.history[1].find(s=>s.type==='function_result').result[0].text).places;
  for(let i=0;i<places.length;i++) {
    const {straightLineDistanceFromStartMeters,...record}=discovered[i];
    assert.ok(straightLineDistanceFromStartMeters>0);assert.deepEqual(record,places[i]);
  }
  assert.ok(result.places.every(p=>p.access.state==='unknown'));
  assert.deepEqual(result.places.map(({access,...p})=>p),places.slice(0,3).map(p=>({...p,photo:null})));
});

test('revision selects a newly disclosed candidate without reads or media for rejected places',async()=>{
  const deps=fixture([[search()],[route([0,1])],[route([1,2],'revision')]]);
  let attempts=0;const enriched=[];
  deps.route=async()=>++attempts===1
    ?{accepted:false,reasonCode:'place_approach_too_far',statistics:{distanceMeters:18000},unreachedPlaceIds:[places[0].id]}
    :measured;
  deps.enrich=async p=>{assert.equal(attempts,2);enriched.push(p.id);return null;};
  const result=await planDynamicResearch(request,deps);
  assert.equal(result.counts.generations,3);assert.equal(result.counts.routes,2);
  assert.deepEqual(enriched,[places[1].id,places[2].id]);
  const feedback=JSON.parse(deps.history[2].at(-1).result[0].text);
  assert.deepEqual(feedback.reachedPlaceIds,[places[1].id]);assert.equal(feedback.statistics.distanceMeters,18000);
  assert.deepEqual(feedback.acceptedDistanceRangeMeters,{minimum:9600,maximum:15600});
});

test('a rejected route at the route budget stops before another provider attempt or enrichment',async()=>{
  const deps=fixture([[search()],[route([0])],[route([1],'revision')]]);let attempted=0,enriched=0;
  deps.route=async()=>{attempted++;return {accepted:false,reasonCode:'hard_constraint_exceeded'};};
  deps.enrich=async()=>{enriched++;};
  await assert.rejects(planDynamicResearch(request,deps,{limits:{...DYNAMIC_LIMITS,routes:1}}),{code:'research_budget_exhausted'});
  assert.equal(attempted,1);assert.equal(enriched,0);
});

test('mixed terminal batches cannot launch lookups or abandon failing siblings',async()=>{
  for(const calls of [[route([0]),search()],[route([0]),route([1],'r2')],[search(),route([0])]]) {
    const deps=fixture([calls]);let started=0;deps.search=deps.route=async()=>{started++;};
    await assert.rejects(planDynamicResearch(request,deps),{code:'invalid_tool_call'});assert.equal(started,0);
  }
});

test('registered identity cannot be replaced by later discovery or resolution',async()=>{
  const deps=fixture([[search()],[call('n','resolve_named_place',{name:'Fixture hill 1',radiusMeters:6000})],[route([0])]]);
  deps.resolve=async()=>({state:'resolved',place:{...places[0],coordinate:{latitude:0,longitude:0},name:'Changed'}});
  deps.route=async({places:selected})=>{assert.deepEqual(selected.map(({access,...p})=>p),[places[0]]);return measured;};
  await planDynamicResearch(request,deps);
  const resolved=JSON.parse(deps.history[2].at(-1).result[0].text).place;
  assert.deepEqual(resolved.coordinate,places[0].coordinate);assert.equal(resolved.name,places[0].name);
});

test('four stops never consume a provider route, but a valid three-stop revision can finish',async()=>{
  const deps=fixture([[search()],[route([0,1,2,3])],[route([0,1,2],'revision')]]);
  const result=await planDynamicResearch(request,deps);
  assert.equal(result.counts.routes,1);assert.equal(result.places.length,3);
  assert.equal(JSON.parse(deps.history[2].at(-1).result[0].text).maximumPlaces,3);
});

test('optional enrichment is bounded to two workers, reserved before IO, and preserves route order',async()=>{
  const deps=fixture();const pending=places.map(()=>deferred());const started=[];let active=0,peak=0;
  deps.enrich=async p=>{const i=places.findIndex(x=>x.id===p.id);started.push(i);peak=Math.max(peak,++active);
    try{return await pending[i].promise;}finally{active--;}};
  deps.photo=async evidence=>({url:`fixture:${evidence.imageFile}`});
  const promise=planDynamicResearch(request,deps);
  await tick();assert.deepEqual(started,[0,1]);
  pending[1].resolve({imageFile:'second'});await tick();assert.deepEqual(started,[0,1,2]);
  pending[2].resolve({imageFile:'third'});pending[0].resolve({imageFile:'first'});
  const result=await promise;assert.equal(peak,2);assert.equal(result.counts.enrichments,3);assert.equal(result.counts.photos,3);
  assert.deepEqual(result.places.map(p=>p.photo.url),['fixture:first','fixture:second','fixture:third']);
});

test('parallel media cannot overspend reduced enrichment or photo budgets',async()=>{
  for(const [enrichments,photos] of [[1,1],[3,1]]) {
    const deps=fixture();let enriched=0,photographed=0;
    deps.enrich=async()=>{enriched++;await tick();return {imageFile:'fixture'};};
    deps.photo=async()=>{photographed++;return null;};
    const result=await planDynamicResearch(request,deps,{limits:{...DYNAMIC_LIMITS,enrichments,photos}});
    assert.equal(enriched,enrichments);assert.equal(result.counts.enrichments,enrichments);
    assert.equal(photographed,1);assert.equal(result.counts.photos,1);
  }
});

for(const stage of ['enrich','photo'])test(`${stage} failure counts the attempt and opens the optional circuit without retries`,async()=>{
  const deps=fixture();const stalled=deferred();let enrichments=0,photos=0;
  deps.enrich=async()=>{enrichments++;if(stage==='enrich'&&enrichments===1)throw Object.assign(Error('limited'),{code:'rate_limited'});
    if(enrichments===2)return stalled.promise;return {imageFile:'fixture'};};
  deps.photo=async()=>{photos++;throw Object.assign(Error('limited'),{code:'rate_limited'});};
  const promise=planDynamicResearch(request,deps);await tick();stalled.resolve({imageFile:'peer'});
  const result=await promise;
  assert.equal(enrichments,2);assert.equal(photos,stage==='photo'?1:0);
  assert.equal(result.counts.enrichments,2);assert.equal(result.counts.photos,photos);
  assert.ok(result.places.every(p=>p.photo===null));
});

test('a non-provider media failure leaves other uniquely identified stops eligible',async()=>{
  const deps=fixture();let enrichments=0;
  deps.enrich=async place=>{
    enrichments++;
    if(place.id===places[0].id)throw new Error('bad metadata');
    return {imageFile:place.id};
  };
  deps.photo=async evidence=>({url:`fixture:${evidence.imageFile}`});
  const result=await planDynamicResearch(request,deps);
  assert.equal(enrichments,3);
  assert.equal(result.places[0].photo,null);
  assert.equal(result.places[1].photo.url,`fixture:${places[1].id}`);
  assert.equal(result.places[2].photo.url,`fixture:${places[2].id}`);
});

test('parallel stalled enrichment observes caller cancellation and starts no follow-on work',async()=>{
  const deps=fixture();const controller=new AbortController(),signals=[];
  let photos=0;deps.enrich=async(_,{signal})=>{signals.push(signal);return new Promise(()=>{});};deps.photo=async()=>{photos++;};
  const promise=planDynamicResearch(request,deps,{signal:controller.signal,limits:{...DYNAMIC_LIMITS,deadlineMs:1000}});
  const rejected=assert.rejects(promise,{code:'request_cancelled'});
  await tick();assert.equal(signals.length,2);controller.abort();
  await rejected;assert.ok(signals.every(s=>s.aborted));assert.equal(photos,0);assert.equal(signals.length,2);
});

test('optional stalled media ends before the deadline and preserves the measured core',async()=>{
  for(const deadlineMs of [30,180]) {
    const deps=fixture(),signals=[];let photos=0;
    deps.enrich=async(_,{signal})=>{signals.push(signal);return new Promise(()=>{});};
    deps.photo=async()=>{photos++;};
    const result=await planDynamicResearch(request,deps,{limits:{...DYNAMIC_LIMITS,deadlineMs}});
    assert.equal(result.accepted,true);assert.ok(result.places.every(p=>p.photo===null));
    assert.ok(signals.every(s=>s.aborted));assert.equal(photos,0);
    assert.equal(signals.length,deadlineMs===30?0:2);
  }
});

test('large bundled evidence still fails closed at the history bound before another model call',async()=>{
  const deps=fixture();deps.search=async()=>places.map(p=>({...p,limitations:['x'.repeat(10000)]}));
  await assert.rejects(planDynamicResearch(request,deps,{limits:{...DYNAMIC_LIMITS,historyBytes:10000}}),{code:'research_history_limit'});
  assert.equal(deps.history.length,1);
});

test('late photo completions after cancellation cannot schedule the third place',async()=>{
  const deps=fixture(),controller=new AbortController(),photos=[deferred(),deferred()];let enriched=0,started=0;
  deps.enrich=async()=>{enriched++;return {imageFile:'fixture'};};
  deps.photo=async()=>photos[started++].promise;
  const promise=planDynamicResearch(request,deps,{signal:controller.signal});
  const rejected=assert.rejects(promise,{code:'request_cancelled'});
  await tick();assert.equal(started,2);controller.abort();await rejected;
  photos.forEach(p=>p.resolve({url:'fixture:late'}));await tick();
  assert.equal(enriched,2);assert.equal(started,2);
});

test('real media adapters durably reserve both concurrent attempts including a 429, with no later HTTP calls',async t=>{
  const fs=await import('node:fs');
  const {createOwnerProviderBudget}=await import('../scripts/owner-phone-provider-budget.js');
  const {createLinkedPlaceReader}=await import('../src/dynamicResearch/placeMedia.js');
  const directory=fs.mkdtempSync('/private/tmp/wanderful-efficiency-budget-');fs.chmodSync(directory,0o700);
  let requests=0;const peer=deferred();
  const budget=createOwnerProviderBudget({directory,dynamicResearch:true,
    limits:{google:2,graphhopper:1,osm:1,wikidata:3,commons:1},fetchImpl:async()=>{
      requests++;
      const ledger=JSON.parse(fs.readFileSync(`${directory}/provider-budget.json`,'utf8'));
      assert.equal(ledger.wikidata,requests); // Persisted BEFORE even the injected network starts.
      if(requests===1)return new Response('{}',{status:429,headers:{'Content-Type':'application/json'}});
      return peer.promise;
    }});
  t.after(()=>{budget.close();fs.rmSync(directory,{recursive:true,force:true});});
  const reader=createLinkedPlaceReader({fetchImpl:budget.fetch,userAgent:'Wanderful offline efficiency regression'});
  const deps={...fixture(),enrich:reader.enrich,photo:reader.photo};
  const promise=planDynamicResearch(request,deps);await tick();await tick();
  peer.resolve(new Response('{}',{headers:{'Content-Type':'application/json'}}));
  const result=await promise;assert.equal(requests,2);assert.equal(result.counts.enrichments,2);
  assert.equal(budget.remaining().wikidata,1);assert.equal(budget.remaining().commons,1);
  assert.equal(JSON.parse(fs.readFileSync(`${directory}/provider-budget.json`,'utf8')).rateLimits,1);
});

test('evidence-aware replay needs only discovery plus one model turn per genuine route attempt',async()=>{
  const {scenarios,replayScenario}=await import('../evaluation/dynamicResearchEfficiency/fixture.js');
  for(const scenario of scenarios) {
    const run=await replayScenario(planDynamicResearch,scenario);
    assert.equal(run.calls.selection,1+scenario.itineraries.length);
    assert.equal(run.calls.graphhopper,scenario.itineraries.length);assert.equal(run.calls.web,1);
    assert.equal(run.calls.wikidata,scenario.itineraries.at(-1).length);
    assert.deepEqual(run.attemptedItineraries,scenario.itineraries.map(ids=>ids.map(i=>`osm:node:${i+1}`)));
  }
});
