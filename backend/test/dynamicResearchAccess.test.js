import test from 'node:test';
import assert from 'node:assert/strict';
import {assessAccess,buildAccessQuery,createAccessLookup} from '../src/dynamicResearch/access.js';
const now=Date.parse('2026-09-09T08:00:00Z');
const node=(id,lat,lon,tags={})=>({type:'node',id,lat,lon,tags,version:1,timestamp:'2026-09-08T08:00:00Z'});
const way=(id,nodes,tags={highway:'path',foot:'yes'})=>({type:'way',id,nodes,tags,version:1,timestamp:'2026-09-08T08:00:00Z'});
const place={id:'osm:node:1',coordinate:{latitude:51,longitude:10},source:{version:1}};
const payload=elements=>({osm3s:{timestamp_osm_base:'2026-09-09T07:59:00Z'},elements});
const inspect=elements=>assessAccess([place],payload(elements),{now})[0];
test('isolated POI and nearby disconnected path stay unknown; no inferred foot access from path class',()=>{
 for(const elements of [[node(1,51,10)],[node(1,51,10),node(2,51.00001,10),way(10,[2,3]),way(11,[3,4])],
   [node(1,51,10),way(10,[1,2],{highway:'path'}),way(11,[2,3])]])assert.equal(inspect(elements).state,'unknown');
});
test('shared OSM identity and explicit permitted onward topology yield map evidence, never a visit or safety guarantee',()=>{
 const a=inspect([node(1,51,10),way(10,[1,2]),way(11,[2,3])]);
 assert.equal(a.state,'documented');assert.equal(a.target.kind,'poi');assert.equal(a.target.poiVisitConfirmed,false);
 assert.deepEqual(a.evidence.map(e=>e.id),['osm:node:1','osm:way:10','osm:way:11']);
 assert.equal(a.target.remainingWalkMeters,null);
});
test('area center remains distinct from an explicitly mapped boundary entrance',()=>{
 const area={...place,id:'osm:way:8',coordinate:{latitude:51.003,longitude:10.002}};
 const a=assessAccess([area],payload([way(8,[1,7,6,1],{water:'lake'}),node(1,51,10,{entrance:'yes',foot:'yes'}),way(10,[1,2]),way(11,[2,3])]),{now})[0];
 assert.equal(a.state,'documented');assert.equal(a.target.kind,'entrance');assert.ok(a.target.straightLineOffsetMeters>300);
 assert.equal(a.target.relationship,'entrance_node_on_poi_boundary');assert.equal(a.target.remainingWalkMeters,null);assert.equal(a.target.poiVisitConfirmed,false);
 const unrelated=assessAccess([area],payload([way(8,[7,6,5,7],{water:'lake'}),node(1,51,10,{entrance:'yes',foot:'yes'}),way(10,[1,2]),way(11,[2,3])]),{now})[0];
 assert.equal(unrelated.state,'unknown');assert.equal(unrelated.target,null);
});
test('explicit restrictions exclude the candidate; conditional rights and barriers remain unknown',()=>{
 assert.equal(inspect([node(1,51,10,{access:'private'}),way(10,[1,2]),way(11,[2,3])]).state,'excluded');
 for(const tags of [{foot:'no'},{access:'private'},{foot:'yes','foot:conditional':'no @ (sunset-sunrise)'}]) {
  assert.notEqual(inspect([node(1,51,10),way(10,[1,2],{highway:'path',...tags}),way(11,[2,3])]).state,'documented');
 }
 assert.equal(inspect([node(1,51,10),node(2,51.001,10,{barrier:'gate'}),way(10,[1,2]),way(11,[2,3])]).state,'unknown');
});
test('bicycle access is activity-specific and foot permission does not admit biking',()=>{
 const elements=[node(1,51,10),way(10,[1,2]),way(11,[2,3])];
 assert.equal(assessAccess([place],payload(elements),{now,activityType:'biking'})[0].state,'unknown');
});
test('invalid IDs, truncated responses, old snapshots and poisoned metadata fail closed',()=>{
 assert.throws(()=>buildAccessQuery([{id:'osm:node:1);out;'}]));
 for(const mutate of [p=>p.remark='timeout',p=>p.osm3s.timestamp_osm_base='2025-01-01T00:00:00Z',p=>p.elements.push({...p.elements[0]})]) {
  const p=payload([node(1,51,10)]);mutate(p);assert.throws(()=>assessAccess([place],p,{now}));
 }
});
test('one batch query for many candidates, no retry on 429 and caller cancellation spends nothing',async()=>{
 let calls=0;const lookup=createAccessLookup({userAgent:'Wanderful offline test',now:()=>now,fetchImpl:async()=>{calls++;return new Response('{}',{status:429,headers:{'Content-Type':'application/json'}});}});
 await assert.rejects(lookup({places:[place],activityType:'hiking'}),{code:'rate_limited'});assert.equal(calls,1);
 await assert.rejects(lookup({places:[place],activityType:'hiking'},{signal:AbortSignal.abort()}),{code:'cancelled'});assert.equal(calls,1);
 const query=buildAccessQuery([place,{...place,id:'osm:node:2'}]);assert.ok(query.includes('node(id:1,2)'));assert.ok(!query.includes('around'));
});

test('invalid shared-node identities cannot manufacture a connected path',()=>{
 assert.throws(()=>inspect([node(1,51,10),way(10,[1,-1]),way(11,[-1,3])]));
 assert.throws(()=>inspect([node(1,51,10),way(10,[1,'2']),way(11,['2',3])]));
});

test('node and way sharing a numeric ID remain separate entrance and POI identities',()=>{
 const area={...place,id:'osm:way:1',coordinate:{latitude:51.003,longitude:10.002}};
 const elements=[way(1,[1,7,6,1],{water:'lake'}),node(1,51,10,{entrance:'yes',foot:'yes'}),way(10,[1,2]),way(11,[2,3])];
 const result=assessAccess([area],payload(elements),{now})[0];
 assert.equal(result.target.kind,'entrance');assert.equal(result.target.osmId,'osm:node:1');
 elements[1].tags={entrance:'yes'};
 assert.equal(assessAccess([area],payload(elements),{now})[0].state,'unknown');
});
