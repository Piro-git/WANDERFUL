import test from 'node:test';
import assert from 'node:assert/strict';
import {createDynamicItineraryRouter} from '../src/dynamicResearch/routing.js';
import {routeError} from '../src/routing/routeErrors.js';
import {distanceMeters} from '../src/dynamicResearch/places.js';
const points=[{latitude:57.2,longitude:-4.7},{latitude:57.21,longitude:-4.68},{latitude:57.22,longitude:-4.7},{latitude:57.21,longitude:-4.72},{latitude:57.2,longitude:-4.7}];
const geom=points=>({type:'LineString',coordinates:points.map(p=>[p.longitude,p.latitude])});
function response() {
 const distance=points.slice(1).reduce((total,p,i)=>total+distanceMeters(points[i],p),0);
 return {provider:'graphhopper',snapped_waypoints:geom(points),paths:[{distance,time:Math.round(distance/1.2*1000),ascend:100,descend:100,
  points:geom(points),instructions:[{text:'Continue',distance,time:Math.round(distance/1.2*1000),interval:[0,4],sign:0}],
  details:{road_class:[[0,4,'path']],surface:[],hike_rating:[]}}]};
}
const input={request:{anchor:points[0],intent:{activityType:'hiking',routeType:'loop',targetDistanceKm:6,difficulty:null}},places:points.slice(1,-1).map((coordinate,i)=>({id:`osm:node:${i+1}`,coordinate}))};
test('central routing receives source coordinates and evaluated path yields honest measured statistics',async()=>{
 let calls=0;
 const route=createDynamicItineraryRouter({provider:{route:async request=>{calls++;assert.deepEqual(request.points,points);assert.equal(request.profile,'foot');assert.equal(request.algorithm,undefined);return response();}}});
 const result=await route(input);
 assert.equal(result.accepted,true);assert.equal(calls,1);assert.equal(result.statistics.distanceMeters,response().paths[0].distance);
 assert.equal(result.geometryProvider,'graphhopper');assert.equal(result.waypointChecks.length,5);
});
test('strict distance, duration and missing elevation evidence reject with measured revision feedback',async()=>{
 for(const constraints of [{maximumDistanceKm:4},{maximumDurationMinutes:10},{maximumElevationGainMeters:50}]) {
  const route=createDynamicItineraryRouter({provider:{route:async()=>response()}});
  const result=await route({...input,request:{...input.request,constraints}});
  assert.equal(result.accepted,false);assert.equal(result.reasonCode,'hard_constraint_exceeded');assert.ok(result.statistics.distanceMeters>4000);
 }
});
test('unsupported strict exclusions fail without spending a route call',async()=>{
 let calls=0;const route=createDynamicItineraryRouter({provider:{route:async()=>{calls++;return response();}}});
 const result=await route({...input,request:{...input.request,constraints:{hardAvoidances:['crowds']}}});
 assert.equal(result.reasonCode,'hard_constraint_evidence_unavailable');assert.equal(calls,0);
});
test('soft distance deviation gives feedback but cannot become final success',async()=>{
 const route=createDynamicItineraryRouter({provider:{route:async()=>response()}});
 const result=await route({...input,request:{...input.request,intent:{...input.request.intent,targetDistanceKm:15}}});
 assert.equal(result.reasonCode,'soft_distance_deviation');assert.ok(result.statistics.distanceMeters>0);
});
test('incorrect provenance, missing snaps and fabricated statistics are rejected',async()=>{
 for(const mutate of [r=>{r.provider='mock';},r=>{delete r.snapped_waypoints;},r=>{r.paths[0].distance=15000;}]) {
  const r=response();mutate(r);const route=createDynamicItineraryRouter({provider:{route:async()=>r}});
  const result=await route(input);assert.equal(result.accepted,false);assert.equal(result.statistics,undefined);
 }
});
test('strict road avoidance needs continuous allowed evidence',async()=>{
 const r=response();r.paths[0].details.road_class=[[1,4,'path']];
 const route=createDynamicItineraryRouter({provider:{route:async()=>r}});
 const result=await route({...input,request:{...input.request,constraints:{hardAvoidances:['majorRoads']}}});
 assert.equal(result.reasonCode,'road_exclusion_unverified');
});

test('confirmed missing connection is revision feedback; service errors and cancellation remain failures',async()=>{
 const route=createDynamicItineraryRouter({provider:{route:async()=>{throw routeError('route_not_found');}}});
 assert.deepEqual(await route(input),{accepted:false,reasonCode:'route_connection_not_found'});
 for(const code of ['routing_unavailable','routing_rate_limited','configuration_missing','request_cancelled','route_timed_out']) {
  const error=routeError(code);
  const failing=createDynamicItineraryRouter({provider:{route:async()=>{throw error;}}});
  await assert.rejects(failing(input),error);
 }
 await assert.rejects(route(input,{signal:AbortSignal.abort()}),{code:'route_not_found'});
});


test('a place beyond the strict approach threshold is identified for model revision',async()=>{
 const route=createDynamicItineraryRouter({provider:{route:async()=>response()}});
 const selected=structuredClone(input.places);selected[0].coordinate.latitude+=0.0011;
 const result=await route({...input,places:selected});
 assert.equal(result.accepted,false);assert.equal(result.reasonCode,'place_approach_too_far');
 assert.deepEqual(result.unreachedPlaceIds,['osm:node:1']);
 assert.equal(result.statistics.distanceMeters,response().paths[0].distance);
});


test('pilot location limit reserves start and end before spending provider calls',async()=>{
 let calls=0;const route=createDynamicItineraryRouter({provider:{route:async()=>{calls++;return response();}}});
 const result=await route({...input,places:[...input.places,input.places[0]]});
 assert.deepEqual(result,{accepted:false,reasonCode:'too_many_places'});assert.equal(calls,0);
});

test('documented boundary entrance is routed without moving the POI or claiming a visit',async()=>{
 const selected=structuredClone(input.places),poi=selected[0];
 const entrance=structuredClone(poi.coordinate);poi.coordinate.latitude+=0.005;poi.id='osm:way:8';
 poi.access={state:'documented',placeId:poi.id,evidence:[{id:poi.id,nodeIds:[999,7,6,999]},{id:'osm:node:999'}],
 target:{kind:'entrance',osmId:'osm:node:999',relationship:'entrance_node_on_poi_boundary',coordinate:entrance,remainingWalkMeters:null,poiVisitConfirmed:false}};
 const router=createDynamicItineraryRouter({provider:{route:async req=>{assert.deepEqual(req.points[1],entrance);return response();}}});
 const result=await router({...input,places:selected});assert.equal(result.accepted,true);
 assert.equal(result.stopVisits[0].targetKind,'entrance');assert.equal(result.stopVisits[0].poiVisitConfirmed,false);
 assert.notDeepEqual(poi.coordinate,entrance);
 poi.access.evidence[0].nodeIds=[7,6,5,7];
 await assert.rejects(router({...input,places:selected}),{message:'invalid_access_evidence'});
});
