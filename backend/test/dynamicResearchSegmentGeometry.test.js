import test from 'node:test';
import assert from 'node:assert/strict';
import {createDynamicItineraryRouter} from '../src/dynamicResearch/routing.js';
import {distanceMeters} from '../src/dynamicResearch/places.js';

const line=points=>({type:'LineString',coordinates:points.map(p=>[p.longitude,p.latitude])});

function routeFixture(corners,stops) {
  const path=[...corners,corners[0]];
  const waypoints=[corners[0],...stops,corners[0]];
  const distance=path.slice(1).reduce((sum,point,index)=>sum+distanceMeters(path[index],point),0);
  const response={provider:'graphhopper',snapped_waypoints:line(waypoints),paths:[{
    distance,time:Math.round(distance/1.2*1000),ascend:120,descend:120,
    points:line(path),instructions:[{text:'Continue',distance,time:Math.round(distance/1.2*1000),interval:[0,path.length-1],sign:0}],
    details:{road_class:[[0,path.length-1,'path']],surface:[],hike_rating:[]}
  }]};
  const input={request:{anchor:corners[0],intent:{activityType:'hiking',routeType:'loop',targetDistanceKm:null,difficulty:null}},
    places:stops.map((coordinate,index)=>({id:`osm:node:${index+1}`,coordinate}))};
  return {input,response,distance};
}

test('sparse GraphHopper geometry reaches stops in the middle of route segments',async()=>{
  const a={latitude:57.2,longitude:-4.7},b={latitude:57.2,longitude:-4.68};
  const c={latitude:57.21,longitude:-4.68},d={latitude:57.21,longitude:-4.7};
  const stops=[{latitude:57.2,longitude:-4.69},{latitude:57.21,longitude:-4.69}];
  const {input,response,distance}=routeFixture([a,b,c,d],stops);
  const result=await createDynamicItineraryRouter({provider:{route:async()=>response}})(input);
  assert.equal(result.accepted,true);
  assert.equal(result.statistics.distanceMeters,distance);
  assert.ok(result.waypointChecks.slice(1,3).every(check=>check.routeApproachMeters<1));
});

test('segment projection works across the date line and rejects a distant stop',async()=>{
  const a={latitude:10,longitude:179.98},b={latitude:10,longitude:-179.98};
  const c={latitude:10.01,longitude:-179.98},d={latitude:10.01,longitude:179.98};
  const stops=[{latitude:10,longitude:180},{latitude:10.01,longitude:180}];
  const {input,response}=routeFixture([a,b,c,d],stops);
  const route=createDynamicItineraryRouter({provider:{route:async()=>response}});
  assert.equal((await route(input)).accepted,true);
  const outside=structuredClone(input);
  outside.places[0].coordinate.latitude+=0.003;
  const offRouteResponse=structuredClone(response);
  offRouteResponse.snapped_waypoints.coordinates[1]=[
    outside.places[0].coordinate.longitude,outside.places[0].coordinate.latitude
  ];
  const result=await createDynamicItineraryRouter({provider:{route:async()=>offRouteResponse}})(outside);
  assert.equal(result.accepted,false);
  assert.equal(result.reasonCode,'waypoint_not_reached');
  assert.deepEqual(result.unreachedPlaceIds,['osm:node:1']);
  assert.equal(result.statistics,undefined);
  const unsnapped=await route(outside);
  assert.equal(unsnapped.reasonCode,'waypoint_snap_exceeded');
  assert.deepEqual(unsnapped.unreachedPlaceIds,['osm:node:1']);
  assert.equal(unsnapped.statistics,undefined);
});

test('an earlier sparse segment cannot satisfy a later stop out of order',async()=>{
  const a={latitude:40,longitude:-105},b={latitude:40,longitude:-104.98};
  const c={latitude:40.01,longitude:-104.98},d={latitude:40.01,longitude:-105};
  const first={latitude:40,longitude:-104.99},second={latitude:40.01,longitude:-104.99};
  const {input,response}=routeFixture([a,b,c,d],[second,first]);
  const result=await createDynamicItineraryRouter({provider:{route:async()=>response}})(input);
  assert.equal(result.accepted,false);
  assert.equal(result.reasonCode,'waypoint_order_invalid');
  assert.equal(result.unreachedPlaceIds,undefined);
  assert.equal(result.statistics,undefined);
});

test('dynamic stop corridor matches the native 100 metre boundary',async()=>{
  const a={latitude:57.2,longitude:-4.7},b={latitude:57.2,longitude:-4.68};
  const c={latitude:57.21,longitude:-4.68},d={latitude:57.21,longitude:-4.7};
  for(const [metres,accepted] of [[98,true],[102,false]]) {
    const stop={latitude:57.2+metres/111_195,longitude:-4.69};
    const {input,response}=routeFixture([a,b,c,d],[stop,{latitude:57.21,longitude:-4.69}]);
    const result=await createDynamicItineraryRouter({provider:{route:async()=>response}})(input);
    assert.equal(result.accepted,accepted);
    if(!accepted) {
      assert.equal(result.reasonCode,'waypoint_not_reached');
      assert.deepEqual(result.unreachedPlaceIds,['osm:node:1']);
      assert.equal(result.statistics,undefined);
    }
  }
});

test('the first valid segment wins when a later revisit is closer',async()=>{
  const a={latitude:40,longitude:-105},b={latitude:40,longitude:-104.98};
  const c={latitude:40.01,longitude:-104.98},d={latitude:40.01,longitude:-105};
  const e={latitude:40.0005,longitude:-105},f={latitude:40.0005,longitude:-104.995};
  const g={latitude:40,longitude:-104.995};
  const stops=[{latitude:40.0004,longitude:-104.9955},{latitude:40,longitude:-104.985}];
  const {input,response}=routeFixture([a,b,c,d,e,f,g],stops);
  const result=await createDynamicItineraryRouter({provider:{route:async()=>response}})(input);
  assert.equal(result.accepted,true);
  assert.equal(result.waypointChecks[1].routePointIndex,1);
  assert.equal(result.waypointChecks[2].routePointIndex,1);
});
