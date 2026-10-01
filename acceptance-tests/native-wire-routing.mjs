import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createDynamicItineraryRouter} from '../backend/src/dynamicResearch/routing.js';
import {validateDynamicRequest} from '../backend/src/dynamicResearch/contract.js';
import {distanceMeters} from '../backend/src/dynamicResearch/places.js';
const rows=JSON.parse(await fs.readFile(process.argv[2],'utf8'));
assert.ok(rows.length>=7,'must consume actual native XCTest export');
const points=[{latitude:57.2,longitude:-4.7},{latitude:57.21,longitude:-4.68},{latitude:57.22,longitude:-4.7},{latitude:57.21,longitude:-4.72},{latitude:57.2,longitude:-4.7}];
const geom={type:'LineString',coordinates:points.map(p=>[p.longitude,p.latitude])};
const distance=points.slice(1).reduce((n,p,i)=>n+distanceMeters(points[i],p),0);
const output=[];
for(const row of rows) {
 const request=validateDynamicRequest(row.request);
 assert.equal(request.prompt,row.prompt);
 const value=request.constraints[row.field];
 assert.ok(typeof value==='number');
 assert.equal(value<row.boundary,row.strict);
 for(const delta of [-0.001,0,0.001]) {
  const measurement=row.boundary+delta;
  const path={distance,time:3600000,ascend:100,descend:100,points:geom,
   instructions:[{text:'Continue',distance,time:3600000,interval:[0,4],sign:0}],details:{road_class:[[0,4,'path']],surface:[],hike_rating:[]}};
  if(row.field==='maximumDurationMinutes')path.time=measurement*60000;
  if(row.field==='maximumElevationGainMeters')path.ascend=measurement;
  if(row.field==='maximumDistanceKm')path.distance=measurement*1000;
  path.instructions[0].distance=path.distance;path.instructions[0].time=path.time;
  const route=createDynamicItineraryRouter({provider:{route:async()=>({provider:'graphhopper',snapped_waypoints:geom,paths:[path]})}});
  const result=await route({request,places:points.slice(1,-1).map((coordinate,i)=>({id:`osm:node:${i+1}`,coordinate}))});
  const expected=delta<0||(delta===0&&!row.strict);
  assert.equal(result.accepted,expected,`${row.prompt} at ${measurement}: ${result.reasonCode}`);
  if(!expected)assert.equal(result.reasonCode,'hard_constraint_exceeded');
  output.push({prompt:row.prompt,measurement,accepted:result.accepted,reason:result.reasonCode??null});
 }
}
console.log(JSON.stringify({scope:'actual native request JSON through backend contract and real route validator; provider geometry fixture',checks:output.length,results:output},null,2));
