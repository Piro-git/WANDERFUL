// Offline acceptance probes. Run explicitly: node --test backend/quality-gates/routeAcceptance.test.js
// All names and coordinates below are synthetic; no provider or device is contacted.
import test from 'node:test';
import assert from 'node:assert/strict';
import {parsePlaces} from '../src/dynamicResearch/places.js';
import {planDynamicResearch} from '../src/dynamicResearch/planner.js';
import {createDynamicItineraryRouter} from '../src/dynamicResearch/routing.js';
import {directOsmCommonsEvidence,licensedCommonsPhoto} from '../src/dynamicResearch/placeMedia.js';
import {routeError} from '../src/routing/routeErrors.js';

const observedAt=Date.parse('2026-09-30T12:00:00Z');
const radians=Math.PI/180;
function groundDistance(a,b) {
  const lat=(b.latitude-a.latitude)*radians, lon=(b.longitude-a.longitude)*radians;
  const x=Math.sin(lat/2)**2+Math.cos(a.latitude*radians)*Math.cos(b.latitude*radians)*Math.sin(lon/2)**2;
  return 6371000*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x));
}
const line=coordinates=>({type:'LineString',coordinates:coordinates.map(p=>[p.longitude,p.latitude])});
const length=coordinates=>coordinates.slice(1).reduce((sum,p,i)=>sum+groundDistance(coordinates[i],p),0);
function graphHopperFixture(path,waypoints,{distance=length(path),time=3_600_000,ascent=137,profile='foot'}={}) {
  return {provider:'graphhopper',snapped_waypoints:line(waypoints),paths:[{
    distance,time,ascend:ascent,descend:ascent-20,points:line(path),
    instructions:[{text:'Continue',distance,time,interval:[0,path.length-1],sign:0}],
    details:{road_class:[[0,path.length-1,profile==='foot'?'path':'cycleway']],surface:[],hike_rating:[]}
  }]};
}
const regions=[
  {name:'southern midlatitude',anchor:{latitude:-42.9,longitude:147.3},
    first:{latitude:-42.89,longitude:147.31},second:{latitude:-42.89,longitude:147.29},targetKm:4.5},
  {name:'northern high latitude and date line',anchor:{latitude:75,longitude:179.98},
    first:{latitude:75.01,longitude:179.99},second:{latitude:75.01,longitude:-179.99},targetKm:3}
];
function mappedPlaces(region) {
  const payload={osm3s:{timestamp_osm_base:'2026-09-30T11:00:00Z'},elements:
    [region.first,region.second].map((point,i)=>({type:'node',id:401+i,version:3,
      timestamp:'2026-09-20T00:00:00Z',lat:point.latitude,lon:point.longitude,
      tags:{name:`Synthetic stop ${i+1}`,tourism:'viewpoint',...(i===0?{wikimedia_commons:'File:Synthetic stop 1.jpg'}:{})}}))};
  return parsePlaces(payload,{anchor:region.anchor,radiusMeters:10000,kinds:['viewpoint']},observedAt);
}
const tool=(id,name,args)=>({type:'function_call',id,name,arguments:args});
function webFixture(place) {
  const text='A mapped synthetic stop appears in the source record.';
  return {provider:'google_grounding',retrievedAt:new Date(observedAt).toISOString(),observedSearchQueries:1,
    blocks:[{text,citations:[{url:place.source.url,title:'Mapped source',startIndex:0,endIndex:text.length}]}],
    searchSuggestions:['<div>Source search</div>'],retrievedSourceURLs:[place.source.url]};
}
function request(region,prompt) {
  return {prompt,anchor:region.anchor,locationName:'Synthetic start',researchMode:'web_and_map',
    intent:{routeType:'loop',activityType:'hiking',targetDistanceKm:region.targetKm,difficulty:null},
    constraints:{maximumDistanceKm:null,maximumDurationMinutes:null,maximumElevationGainMeters:null,hardAvoidances:[]}};
}

for(const region of regions) {
  test(`free prompt to source IDs to ordered foot route and exact provider stats: ${region.name}`,async()=>{
    const places=mappedPlaces(region),path=[region.anchor,region.first,region.second,region.anchor];
    assert.equal(places.length,2);
    const providerResponse=graphHopperFixture(path,path,{time:4_321_000,ascent:137});
    let providerCalls=0,modelTurn=0;
    const deps={researchWeb:async()=>webFixture(places[0]),search:async()=>places,
      interact:async()=>({steps:[modelTurn++===0?
        tool('discover','search_places',{radiusMeters:10000,kinds:['viewpoint']}):
        tool('itinerary','route_itinerary',{placeIds:places.map(p=>p.id)})]}),
      route:createDynamicItineraryRouter({provider:{route:async routeRequest=>{
        providerCalls++;
        assert.equal(routeRequest.profile,'foot');
        assert.deepEqual(routeRequest.points,path);
        return providerResponse;
      }}}),
      reviewPlan:async()=>({decision:'complete',summary:'Only mapped stops and measured statistics are claimed.',remainingWishes:[],evidenceIds:[places[0].id]})};
    const result=await planDynamicResearch(request(region,`Plan a ${region.targetKm} km hike from my chosen start through two sourced stops and return.`),deps);
    assert.equal(providerCalls,1);
    assert.equal(result.plannerSource,'gemini_tools');
    assert.equal(result.geometryProvider,'graphhopper');
    assert.deepEqual(result.places.map(p=>p.id),places.map(p=>p.id));
    assert.deepEqual(result.path.points.coordinates,line(path).coordinates);
    assert.equal(result.statistics.distanceMeters,providerResponse.paths[0].distance);
    assert.equal(result.statistics.durationSeconds,4321);
    assert.equal(result.statistics.elevationGainMeters,137);
    assert.equal(result.webResearch.routeEvidence.claims[0].placeId,places[0].id);
    assert.equal(result.webResearch.routeEvidence.claims[0].relationship,'source_identity');
    assert.ok(groundDistance(path[0],path.at(-1))<1);
  });
}

test('a path that passes through a stop between encoded vertices satisfies the stop corridor',async()=>{
  const start={latitude:-42.9,longitude:147.3};
  const bend={latitude:-42.9,longitude:147.32};
  const stop={latitude:-42.9,longitude:147.31};
  const second={latitude:-42.88,longitude:147.31};
  const path=[start,bend,second,start],requested=[start,stop,second,start];
  const router=createDynamicItineraryRouter({provider:{route:async()=>graphHopperFixture(path,requested)}});
  const result=await router({request:{anchor:start,intent:{routeType:'loop',activityType:'hiking',targetDistanceKm:6,difficulty:null}},
    places:[{id:'osm:node:401',coordinate:stop},{id:'osm:node:402',coordinate:second}]});
  // The stop lies on the first segment. Vertex-only proximity incorrectly rejects it.
  assert.equal(result.accepted,true,`source stop lies on routed segment; observed ${result.reasonCode}`);
});

test('a mapped stop 200 m from the actual route does not become a reached highlight',async()=>{
  const region=regions[0],path=[region.anchor,region.first,region.second,region.anchor];
  const places=mappedPlaces(region);
  places[0].coordinate={...places[0].coordinate,latitude:places[0].coordinate.latitude+0.0018};
  const router=createDynamicItineraryRouter({provider:{route:async()=>graphHopperFixture(path,path)}});
  const result=await router({request:request(region,'Synthetic walk'),places});
  assert.equal(result.accepted,false);
  assert.equal(result.reasonCode,'waypoint_snap_exceeded');
});

test('hard walking profile and provider measurements are fail closed',async()=>{
  const region=regions[0],path=[region.anchor,region.first,region.second,region.anchor];
  for(const mutation of [
    r=>{r.provider='mock';},
    r=>{r.paths[0].distance*=2;},
    r=>{r.paths[0].points.coordinates.at(-1)[0]+=0.02;},
    r=>{r.snapped_waypoints.coordinates[1]=[0,0];}
  ]) {
    const response=graphHopperFixture(path,path);mutation(response);
    const router=createDynamicItineraryRouter({provider:{route:async input=>{
      assert.equal(input.profile,'foot');return response;
    }}});
    const result=await router({request:request(region,'Synthetic walk'),places:mappedPlaces(region)});
    assert.equal(result.accepted,false);
    assert.equal(result.statistics,undefined);
  }
});

test('a requested 10 km walk cannot be presented as an exact match when provider measures 4 km',async()=>{
  const region=regions[0],path=[region.anchor,region.first,region.second,region.anchor];
  const router=createDynamicItineraryRouter({provider:{route:async()=>graphHopperFixture(path,path)}});
  const result=await router({request:{...request(region,'Synthetic 10 km walk'),
    intent:{routeType:'loop',activityType:'hiking',targetDistanceKm:10,difficulty:null}},places:mappedPlaces(region)});
  assert.equal(result.accepted,false);
  assert.equal(result.reasonCode,'soft_distance_deviation');
  assert.ok(result.statistics.distanceMeters<5000);
});

test('missing walkable graph connection stays a route failure',async()=>{
  const region=regions[0];
  const router=createDynamicItineraryRouter({provider:{route:async()=>{throw routeError('route_not_found');}}});
  assert.deepEqual(await router({request:request(region,'Synthetic walk'),places:mappedPlaces(region)}),
    {accepted:false,reasonCode:'route_connection_not_found'});
});

test('missing research and missing mapped identities never yield an AI route',async()=>{
  const region=regions[0];let calls=0;
  const deps={researchWeb:async()=>({provider:'google_grounding',blocks:[]}),
    search:async()=>{calls++;return [];},route:async()=>{calls++;throw Error('route must not run');},
    interact:async()=>({steps:[tool('search','search_places',{radiusMeters:5000,kinds:['viewpoint']})]}),
    reviewPlan:async()=>({decision:'complete',summary:'Synthetic',remainingWishes:[],evidenceIds:[]})};
  await assert.rejects(planDynamicResearch(request(region,'Synthetic walk'),deps),{code:'web_research_unverified'});
  assert.equal(calls,0);
  deps.researchWeb=async()=>webFixture(mappedPlaces(region)[0]);
  let turn=0;deps.interact=async()=>({steps:[turn++===0?
    tool('search','search_places',{radiusMeters:5000,kinds:['viewpoint']}):
    tool('route','route_itinerary',{placeIds:['osm:node:401']})]});
  await assert.rejects(planDynamicResearch(request(region,'Synthetic walk'),deps),{code:'unread_or_unknown_place_id'});
  assert.equal(calls,1);
});

test('photo credit must bind the selected OSM File identity and exact Commons file',()=>{
  const place=mappedPlaces(regions[0])[0],evidence=directOsmCommonsEvidence(place);
  assert.equal(evidence.imageFile,'Synthetic stop 1.jpg');
  const payload={query:{pages:[{title:'File:Different stop.jpg',imageinfo:[{mime:'image/jpeg',thumbmime:'image/jpeg',
    thumburl:'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Different_stop.jpg/800px-Different_stop.jpg',
    extmetadata:{LicenseShortName:{value:'CC BY-SA 4.0'},LicenseUrl:{value:'https://creativecommons.org/licenses/by-sa/4.0/'},Artist:{value:'Synthetic photographer'}}}]}]}};
  assert.equal(licensedCommonsPhoto(payload,evidence),null);
});

test('a final reviewer cannot promote an unsupported safety and water guarantee to UI copy',async()=>{
  const region=regions[0],places=mappedPlaces(region),path=[region.anchor,region.first,region.second,region.anchor];
  let turn=0;
  const deps={researchWeb:async()=>webFixture(places[0]),search:async()=>places,
    interact:async()=>({steps:[turn++===0?
      tool('discover','search_places',{radiusMeters:10000,kinds:['viewpoint']}):
      tool('itinerary','route_itinerary',{placeIds:places.map(p=>p.id)})]}),
    route:createDynamicItineraryRouter({provider:{route:async()=>graphHopperFixture(path,path)}}),
    reviewPlan:async()=>({decision:'complete',summary:'This route is guaranteed safe and has drinking water.',
      remainingWishes:[],evidenceIds:[]})};
  await assert.rejects(planDynamicResearch(request(region,'Synthetic walk with a viewpoint'),deps),
    {code:'invalid_quality_review'});
});
