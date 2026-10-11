import test from 'node:test';
import assert from 'node:assert/strict';
import {reconcileRouteEvidence,validateRouteEvidence} from '../src/dynamicResearch/evidence.js';
import {planDynamicResearch} from '../src/dynamicResearch/planner.js';
const place=(id,name='Similar ridge')=>({id:`osm:node:${id}`,name,coordinate:{latitude:57.21,longitude:-4.69},category:'viewpoint',source:{provider:'openstreetmap',url:`https://www.openstreetmap.org/node/${id}`}});
const a=place(1),b=place(2),c=place(3,'Later stop');
function fixture(url=a.source.url,text='🥾 Schöne 山 e\u0301 — source statement.') {
 return {provider:'google_grounding',retrievedAt:'2026-09-09T00:00:00Z',observedSearchQueries:1,blocks:[{text,citations:[{url,title:'Identity record',startIndex:3,endIndex:text.length}]}],searchSuggestions:['<div>Offline suggestions</div>'],retrievedSourceURLs:[url]};
}
const context={routeId:'measured-2',selectedPlaces:[b,c],inspectedPlaces:[a,b,c]};
test('reconciliation follows final IDs; replacement and similar names never inherit web attribution',()=>{
 const web=fixture(),original=structuredClone(web),value=reconcileRouteEvidence(web,context);
 assert.deepEqual(value.places.map(p=>[p.placeId,p.selection]),[[b.id,'selected'],[c.id,'selected'],[a.id,'excluded']]);
 assert.equal(value.claims[0].placeId,a.id);assert.equal(value.claims[0].relationship,'source_identity');
 assert.deepEqual(web,original);assert.equal(web.blocks[0].text.slice(3),'Schöne 山 e\u0301 — source statement.');
 assert.deepEqual(validateRouteEvidence(value,web,context),value);
});
test('search mentions, foreign pages, redirects and names never establish identity or current conditions',()=>{
 for(const url of ['https://park.example.org/similar-ridge',a.source.url+'?other=1','https://www.openstreetmap.org/node/999']) {
  const value=reconcileRouteEvidence(fixture(url,'Similar ridge is open. Similar ridge is closed.'),context);
  assert.equal(value.claims[0].placeId,null);assert.equal(value.claims[0].relationship,'unconfirmed');
 }
 const web=fixture();web.retrievedSourceURLs=['https://park.example.org/read'];
 web.blocks[0].citations.push({...web.blocks[0].citations[0],url:web.retrievedSourceURLs[0]});
 assert.ok(reconcileRouteEvidence(web,context).claims.every(c=>c.placeId===null));
});
test('invented references, IDs, quote boundaries and stale selection bindings are rejected',()=>{
 const web=fixture();
 for(const mutate of [v=>v.claims[0].id='invented',v=>v.claims[0].blockIndex=9,v=>v.claims[0].citationIndex=9,
  v=>v.claims[0].placeId=b.id,v=>v.claims[0].relationship='verified',v=>v.places[0].selection='excluded',
  v=>v.places[2].placeId='osm:node:999',v=>v.routeId='measured-1',v=>v.claims=[],v=>v.schemaVersion=2]) {
  const value=reconcileRouteEvidence(web,context);mutate(value);assert.throws(()=>validateRouteEvidence(value,web,context));
 }
 for(const startIndex of [-1,1,999]) {const invalid=fixture();invalid.blocks[0].citations[0].startIndex=startIndex;assert.throws(()=>reconcileRouteEvidence(invalid,context));}
 assert.throws(()=>reconcileRouteEvidence(web,{...context,selectedPlaces:[place(999)]}));
});
test('finish reconciles a failed itinerary and newly added stop with a source-bound quality review',async()=>{
 const call=(id,name,args)=>({type:'function_call',id,name,arguments:args});
 const turns=[
  [call('s','search_places',{radiusMeters:5000,kinds:['viewpoint']})],
  [call('r1','route_itinerary',{placeIds:[a.id]})],
  [call('r2','route_itinerary',{placeIds:[c.id]})],
 ];let turn=0,routes=0,webCalls=0;
 const web=fixture();
 const result=await planDynamicResearch({prompt:'A loop',anchor:{latitude:57.2,longitude:-4.7},intent:{routeType:'loop',targetDistanceKm:12},researchMode:'web_and_map',locationName:'Village'}, {
  reviewPlan:async()=>({decision:'complete',summary:'The revised route connects the final stop.',remainingWishes:[],evidenceIds:[c.id]}),
  interact:async()=>({steps:turns[turn++]}),search:async()=>[a,c],read:async()=>null,
  researchWeb:async()=>{webCalls++;return web;},route:async()=>++routes===1?{accepted:false,reasonCode:'place_approach_too_far',unreachedPlaceIds:[a.id]}:{accepted:true,statistics:{distanceMeters:12000}}
 });
 assert.equal(webCalls,1);assert.equal(turn,3);assert.equal(result.counts.generations,5);
 assert.equal(result.places[0].id,c.id);
 assert.deepEqual(result.webResearch.routeEvidence.places.map(p=>[p.placeId,p.selection]),[[c.id,'selected'],[a.id,'excluded']]);
 assert.equal(result.webResearch.routeEvidence.claims[0].placeId,a.id);
 assert.deepEqual(result.webResearch.blocks,web.blocks);
});

test('shared native fixture is a valid backend reconciliation, with overlapping Unicode citations preserved',async()=>{
 const {readFile}=await import('node:fs/promises');
 const fixture=JSON.parse(await readFile(new URL('../../TrailMindTests/Fixtures/dynamic-evidence-revised-offline.json',import.meta.url),'utf8'));
 const route=fixture.route,web=route.webResearch;
 const old={...route.places[0],id:'osm:node:4',name:'Earlier ridge (offline fixture)',source:{...route.places[0].source,url:'https://www.openstreetmap.org/node/4'}};
 assert.deepEqual(validateRouteEvidence(web.routeEvidence,web,{routeId:route.routeId,selectedPlaces:route.places,inspectedPlaces:[...route.places,old]}),web.routeEvidence);
 assert.equal(web.blocks[0].text.slice(web.blocks[0].citations[1].startIndex,web.blocks[0].citations[1].endIndex),'Earlier ridge is an alternative.');
 assert.equal(web.routeEvidence.claims[2].placeId,null);
});
