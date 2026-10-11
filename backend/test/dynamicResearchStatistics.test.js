import test from 'node:test';
import assert from 'node:assert/strict';
import {createDynamicItineraryRouter} from '../src/dynamicResearch/routing.js';
import {distanceMeters} from '../src/dynamicResearch/places.js';

const points=[{latitude:-30,longitude:140},{latitude:-30,longitude:140.01},
  {latitude:-29.99,longitude:140.01},{latitude:-30,longitude:140}];
const length=points.slice(1).reduce((sum,p,i)=>sum+distanceMeters(points[i],p),0);
function fixture({factor=1,elevations=[0,0,0,0],ascent=0,twoDimensions=false}={}) {
  const distance=length*factor,time=3600000;
  const line=coordinates=>({type:'LineString',coordinates});
  return {provider:'graphhopper',snapped_waypoints:line(points.map(p=>[p.longitude,p.latitude])),paths:[{
    distance,time,ascend:ascent,descend:ascent,
    points:line(points.map((p,i)=>twoDimensions?[p.longitude,p.latitude]:[p.longitude,p.latitude,elevations[i]])),
    instructions:[{text:'Continue',distance,time,interval:[0,3],sign:0}],
    details:{road_class:[[0,3,'path']],surface:[],hike_rating:[]}
  }]};
}
const input={request:{anchor:points[0],intent:{activityType:'hiking',routeType:'loop',targetDistanceKm:null,difficulty:null}},
  places:points.slice(1,-1).map((coordinate,i)=>({id:`osm:node:${i+1}`,coordinate}))};
const route=async response=>createDynamicItineraryRouter({provider:{route:async(_request,context)=>{
  assert.equal(context.unsimplifiedGeometry,true);return response;
}}})(input);

test('flat full-precision geometry cannot emit 25 percent inflated or deflated statistics',async()=>{
  for(const factor of [1.25,0.75]) {
    const result=await route(fixture({factor}));
    assert.deepEqual(result,{accepted:false,reasonCode:'invalid_statistics'});
  }
});
test('consistent sparse flat 3D geometry and sub-percent model differences remain usable',async()=>{
  for(const factor of [1,1.005,0.995]) {
    const result=await route(fixture({factor}));
    assert.equal(result.accepted,true,result.reasonCode);
    assert.equal(result.statistics.distanceMeters,length*factor);
  }
});
test('subdividing the same flat route cannot increase its statistics allowance',async()=>{
  const response=fixture({factor:1.25});
  const dense=[];
  for(let i=1;i<points.length;i++) {
    for(let j=0;j<300;j++) {
      const t=j/300;
      dense.push([points[i-1].longitude+(points[i].longitude-points[i-1].longitude)*t,
        points[i-1].latitude+(points[i].latitude-points[i-1].latitude)*t,0]);
    }
  }
  dense.push([points[0].longitude,points[0].latitude,0]);
  response.paths[0].points.coordinates=dense;
  response.paths[0].instructions[0].interval=[0,dense.length-1];
  response.paths[0].details.road_class=[[0,dense.length-1,'path']];
  assert.deepEqual(await route(response),{accepted:false,reasonCode:'invalid_statistics'});
});
test('a flat-only guard does not reject sparse 2D chords or elevation-aware paths',async()=>{
  for(const response of [fixture({factor:1.25,twoDimensions:true,ascent:240}),
    fixture({factor:1.25,elevations:[0,1500,750,0],ascent:1500})]) {
    const result=await route(response);assert.equal(result.accepted,true,result.reasonCode);
  }
});
test('two individually small snap gaps cannot double the actual source-to-route allowance',async()=>{
  const start={latitude:0,longitude:0},b={latitude:0,longitude:0.02},c={latitude:0.01,longitude:0.02};
  const path=[start,b,c,{latitude:0.01,longitude:0},start];
  const source={latitude:0.0016,longitude:0.01},snap={latitude:0.0008,longitude:0.01};
  const response=fixture({twoDimensions:true});
  const distance=path.slice(1).reduce((sum,p,i)=>sum+distanceMeters(path[i],p),0);
  response.paths[0].distance=distance;
  response.paths[0].points.coordinates=path.map(p=>[p.longitude,p.latitude]);
  response.paths[0].instructions[0].distance=distance;
  response.paths[0].instructions[0].interval=[0,4];
  response.paths[0].details.road_class=[[0,4,'path']];
  response.snapped_waypoints.coordinates=[start,snap,c,start].map(p=>[p.longitude,p.latitude]);
  const result=await createDynamicItineraryRouter({provider:{route:async()=>response}})({
    request:{...input.request,anchor:start},places:[source,c].map((coordinate,i)=>({id:`osm:node:${i+1}`,coordinate}))
  });
  assert.equal(result.accepted,false);
  assert.equal(result.statistics,undefined);
  assert.deepEqual(result.unreachedPlaceIds,['osm:node:1']);
});
