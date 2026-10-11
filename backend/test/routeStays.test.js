import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildPlaceSearch,parsePlaces} from '../src/dynamicResearch/places.js';
import {wantsRouteStays,pathMidpoint,distanceToPathMeters,researchRouteStays,selectRouteStays,geometryDigest,STAY_KINDS} from '../src/dynamicResearch/routeStays.js';
import {planDynamicResearch,DYNAMIC_LIMITS} from '../src/dynamicResearch/planner.js';
const now=Date.parse('2026-09-29T10:00:00Z');
const request=(lat=47,lon=10)=>({anchor:{latitude:lat,longitude:lon},radiusMeters:20000,kinds:[...STAY_KINDS]});
const element=(id,tags={},lat=47.001,lon=10.01)=>({type:'node',id,version:2,timestamp:'2024-01-01T00:00:00Z',lat,lon,tags:{name:'Fixture hut',tourism:'alpine_hut',...tags}});
const payload=elements=>({osm3s:{timestamp_osm_base:'2026-09-29T09:00:00Z'},elements});
const path=[[10,47],[10.02,47]];
const parse=(elements,r=request())=>parsePlaces(payload(elements),r,now);

test('overnight intent reveals evidence, ordinary day and negated requests remain quiet',()=>{
 for(const prompt of ['2 Tage wandern','Eine mehrtägige Tour','Mit Übernachtung in einer Hütte','An overnight hike','A two-day hike','Hut-to-hut walk']) assert.equal(wantsRouteStays(prompt),true,prompt);
 for(const prompt of ['A walk past a hut','Eine Tageswanderung mit Hüttenpause','Ohne Übernachtung','No overnight stay','A day hike with a campsite nearby']) assert.equal(wantsRouteStays(prompt),false,prompt);
});
for(const [name,lat,lon] of [['Alps',47,10],['Scotland',57.2,-4.7],['Japan',35.6,139.2],['New Zealand',-45,168.7]]) {
 test(`bounded source discovery and segment distance without regional defaults: ${name}`,async()=>{
  const coordinates=[[lon-.02,lat],[lon+.02,lat]], r=request(lat,lon);
  const records=parse([element(1,{},lat+.001,lon),element(2,{},lat+.04,lon)],r);
  const result=await researchRouteStays({coordinates,now:()=>now,search:async input=>{
   assert.equal(input.radiusMeters,20000);assert.ok(buildPlaceSearch(input).includes('["shelter_type"="basic_hut"]'));return records;
  }});
  assert.equal(result.state,'available');assert.equal(result.coverage,'partial');assert.equal(result.candidates.length,1);
  assert.ok(result.candidates[0].straightLineDistanceToPathMeters>=100&&result.candidates[0].straightLineDistanceToPathMeters<=120);
  assert.equal(result.geometryDigest,geometryDigest(coordinates));
 });
}
test('category taxonomy excludes informal/private/disused camps and separates basic shelters',()=>{
 const records=parse([element(1),element(2,{tourism:'wilderness_hut'}),element(3,{tourism:'camp_site',name:'Fixture campsite'}),
  element(4,{tourism:null,amenity:'shelter',shelter_type:'basic_hut'}),element(5,{tourism:'camp_site',impromptu:'yes'}),
  element(6,{tourism:'camp_site',informal:'yes'}),element(7,{tourism:'camp_site',access:'private'}),element(8,{tourism:'camp_site',tents:'no'}),
  element(9,{disused:'yes'}),element(10,{tourism:null,amenity:'shelter',shelter_type:'picnic_shelter'})]);
 assert.deepEqual(records.map(p=>p.category),STAY_KINDS);
 assert.ok(records.every(p=>!Object.hasOwn(p,'overnightPermission')));
});
test('stable source identity, conservative duplicate removal, unnamed distinct places, unchecked website',()=>{
 const records=parse([element(1,{website:'https://operator.example.org/visit'}),element(1),element(2),element(3,{name:undefined}),element(4,{name:undefined}),
  element(5,{name:'Other hut',website:'http://127.0.0.1/secret'}),element(6,{name:'Other hut 2',website:'https://127.0.0.1/'})]);
 const result=selectRouteStays(records,path);
 assert.equal(result.length,5);assert.equal(result[0].id,'osm:node:1');assert.equal(result[0].website,'https://operator.example.org/visit');
 assert.equal(result[0].source.url,'https://www.openstreetmap.org/node/1');assert.equal(result[0].source.updatedAt,'2024-01-01T00:00:00.000Z');
 assert.equal(result[1].nameKnown,false);assert.equal(result[1].name,'osm:node:3');assert.equal(result[3].website,null);
});
test('distance is to finite segments, handles duplicates/date line and changes with geometry',()=>{
 assert.ok(distanceToPathMeters({latitude:47.001,longitude:10.01},path)<120); // Sparse endpoints >700 m away.
 assert.ok(distanceToPathMeters({latitude:47,longitude:10.1},path)>5000);
 assert.ok(distanceToPathMeters({latitude:0.001,longitude:180},[[179.99,0],[-179.99,0]])<112);
 assert.ok(distanceToPathMeters({latitude:47.001,longitude:10},[[10,47],[10,47]])>100);
 const records=parse([element(1)]);
 assert.equal(selectRouteStays(records,[[11,48],[11.1,48]]).length,0);
 assert.notEqual(geometryDigest(path),geometryDigest([[10,47],[10.03,47]]));
});
test('unavailable, empty, stale source, offline, invalid geometry and cancellation remain distinct',async()=>{
 assert.equal((await researchRouteStays({coordinates:path,now:()=>now})).state,'unavailable');
 assert.equal((await researchRouteStays({coordinates:path,search:async()=>[],now:()=>now})).state,'empty');
 assert.equal((await researchRouteStays({coordinates:path,search:async()=>{throw new Error('offline');},now:()=>now})).state,'unavailable');
 assert.equal(await researchRouteStays({coordinates:[[NaN,47],[10,47]],search:async()=>[]}),null);
 const stale=payload([element(1)]);stale.osm3s.timestamp_osm_base='2020-01-01T00:00:00Z';
 assert.equal((await researchRouteStays({coordinates:path,search:async()=>parsePlaces(stale,request(),now)})).state,'unavailable');
 await assert.rejects(researchRouteStays({coordinates:path,search:async()=>[],signal:AbortSignal.abort()}),{code:'request_cancelled'});
});
test('optional lookup timebox returns route evidence unavailable when provider ignores abort',async()=>{
 const result=await researchRouteStays({coordinates:path,search:()=>new Promise(()=>{})});assert.equal(result.state,'unavailable');
});
test('planner reuses remaining search allowance after accepted geometry, never reroutes to stays',async()=>{
 const planning={prompt:'An overnight hike',anchor:{latitude:47,longitude:10},end:{latitude:47,longitude:10.02},intent:{routeType:'pointToPoint',activityType:'hiking'}};
 const deps={interact:async()=>({steps:[{type:'function_call',id:'r',name:'route_itinerary',arguments:{placeIds:[]}}]}),
  route:async()=>({accepted:true,path:{points:{coordinates:path}},statistics:{distanceMeters:2000}}),search:async()=>parse([element(1)])};
 const result=await planDynamicResearch(planning,deps);assert.equal(result.counts.routes,1);assert.equal(result.counts.searches,1);assert.equal(result.routeStays.state,'available');
 const normal=await planDynamicResearch({...planning,prompt:'A day hike'},deps);assert.equal(normal.routeStays,undefined);assert.equal(normal.counts.searches,0);
 let turn=0;
 const used=await planDynamicResearch(planning,{...deps,interact:async()=>({steps:turn++===0?[{type:'function_call',id:'s',name:'search_places',arguments:{radiusMeters:5000,kinds:['hut']}}]:[{type:'function_call',id:'r',name:'route_itinerary',arguments:{placeIds:[]}}]})},{limits:{...DYNAMIC_LIMITS,searches:1}});
 assert.equal(used.routeStays.state,'unavailable');assert.equal(used.counts.searches,1);
});
test('shared native fixture binds identical quantized geometry and source records',()=>{
 const fixture=JSON.parse(readFileSync(new URL('../../TrailMindTests/Fixtures/route-stays-offline.json',import.meta.url),'utf8'));
 assert.equal(fixture.evidence.geometryDigest,geometryDigest(fixture.coordinates));
 assert.deepEqual(fixture.evidence.candidates,selectRouteStays(parse([element(1,{website:'https://operator.example.org/visit'})]),fixture.coordinates));
});

// 100 vertices cover only the first kilometre; the final segment spans the rest.
// Vertex-count midpoint would put the sole search ~110 km away from the true midpoint.
test('search anchor follows cumulative path length despite strongly uneven vertex density',async()=>{
 const coordinates=[...Array.from({length:100},(_,index)=>[index/10000,0]),[2,0]];
 let searched;
 const result=await researchRouteStays({coordinates,now:()=>now,search:async request=>{searched=request;return [];}});
 assert.ok(Math.abs(searched.anchor.longitude-1)<1e-9);
 assert.ok(Math.abs(searched.anchor.latitude)<1e-9);
 assert.equal(searched.radiusMeters,20000);assert.equal(result.coverage,'partial');assert.equal(result.state,'empty');
 assert.ok(Math.abs(pathMidpoint([[179.9,0],[-179.9,0]]).longitude)===180);
 assert.deepEqual(pathMidpoint([[10,47],[10,47]]),{longitude:10,latitude:47});
 const bend=pathMidpoint([[0,0],[0,1],[1,1]]);assert.ok(bend.latitude>.99&&bend.longitude<.01);
});
