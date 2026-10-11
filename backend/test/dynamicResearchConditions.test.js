import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateConditions,validateNotice,spatialMatch} from '../src/dynamicResearch/localConditions.js';
import {createConditionLookup,parseDWD,parseHarz,dwdQuery} from '../src/dynamicResearch/conditionSources.js';
const now=Date.parse('2026-09-09T08:00:00Z'),area=[9,50,11,52],path=[[9.5,51],[10.5,51]];
const geometry={type:'Polygon',coordinates:[[[9.9,50.9],[10.1,50.9],[10.1,51.1],[9.9,51.1],[9.9,50.9]]]};
const source={id:'park',name:'Official park',url:'https://park.example.org/closures',authority:'official'};
const notice=(changes={})=>validateNotice({id:'notice-1',eventId:'event-1',title:'Path closure',areaLabel:'Test area',kind:'closure',status:'active',
 publishedAt:'2026-09-09T07:00:00Z',retrievedAt:'2026-09-09T08:00:00Z',validFrom:'2026-09-09T06:00:00Z',validUntil:'2026-09-09T20:00:00Z',
 geometry,restrictionArea:true,action:'Choose another route.',...changes},source);
const snapshot=notices=>({area,notices,sources:[{...source,state:'checked'}],checkedAt:'2026-09-09T08:00:00Z'});
const check=notices=>evaluateConditions(snapshot(notices),{path,now});
test('only fresh active official restriction polygons crossing actual route can block',()=>{
 assert.deepEqual(check([notice()]).blockingNoticeIds,['notice-1']);
 assert.equal(check([notice({restrictionArea:false,kind:'weather'})]).blockingNoticeIds.length,0);
 assert.equal(check([{...notice(),source:{...source,authority:'local_news'},restrictionArea:false}]).blockingNoticeIds.length,0);
 assert.equal(check([notice({geometry:{type:'LineString',coordinates:[[10,50.5],[10,51.5]]}})]).notices[0].spatial,'area');
});
test('expired, revoked, unknown validity and old news with a new fetch never release or block a route',()=>{
 for(const [change,state] of [[{validUntil:'2026-09-09T07:30:00Z'},'expired'],[{status:'revoked'},'revoked'],[{validUntil:null},'unknown'],
   [{publishedAt:'2026-08-01T07:00:00Z'},'stale']]) {
  const r=check([notice(change)]);assert.equal(r.notices[0].validity,state);assert.deepEqual(r.blockingNoticeIds,[]);assert.equal(r.coverage,'partial');
 }
});
test('geography beats same place name and same-name region results outside bounds are not included',()=>{
 assert.deepEqual(check([notice({geometry:{type:'Polygon',coordinates:[[[30,10],[31,10],[31,11],[30,11],[30,10]]]}})]).notices,[]);
 assert.equal(spatialMatch(null,path,area),'unknown');
});
test('source duplicates merge, newer revocation wins, conflicting sources remain uncertain',()=>{
 assert.equal(check([notice(),notice()]).notices.length,1);
 assert.equal(check([notice(),notice({status:'revoked',publishedAt:'2026-09-09T07:30:00Z'})]).notices[0].validity,'revoked');
 const other={...notice({id:'notice-2',status:'revoked'}),source:{...source,id:'municipality'}};
 const r=check([notice(),other]);assert.ok(r.notices.every(n=>n.validity==='conflicting'));assert.deepEqual(r.blockingNoticeIds,[]);
});
test('known hiking time controls validity; absence means current check, and reopening ages the snapshot',()=>{
 const r=evaluateConditions(snapshot([notice()]),{path,now,visitTime:'2026-09-10T08:00:00Z'});
 assert.equal(r.notices[0].validity,'expired');assert.deepEqual(r.blockingNoticeIds,[]);
 assert.equal(check([notice()]).visitTime,null);
 assert.equal(evaluateConditions(snapshot([notice()]),{path,now:now+7*3600000}).notices[0].validity,'stale');
});
test('source errors/caps stay visible, are budgeted before fetch, and open a per-request no-retry circuit',async()=>{
 let calls=0,reserved=0;const unavailableSources=new Set();
 const lookup=createConditionLookup({userAgent:'Wanderful offline',now:()=>now,sources:[{...source,bounds:area,query:()=>new URL(source.url),parse:()=>[]}],
 fetchImpl:async()=>{calls++;return new Response('{}',{status:429,headers:{'Content-Type':'application/json'}});}});
 const options={unavailableSources,reserveSource:()=>{reserved++;return true;}};
 const first=await lookup({area},options);await lookup({area},options);
 assert.equal(calls,1);assert.equal(reserved,1);assert.equal(first.sources[0].state,'unavailable');assert.equal(first.notices.length,0);
 const blocked=await lookup({area},{reserveSource:()=>false});assert.equal(blocked.sources[0].reason,'source_budget_exhausted');assert.equal(calls,1);
});
test('unsupported regions stay visibly not checked; queries contain geography and no user prompt',async()=>{
 const lookup=createConditionLookup({userAgent:'Wanderful offline',fetchImpl:()=>{throw Error('must not fetch');}});
 const r=await lookup({area:[135,34,136,35]});assert.equal(r.sources[0].state,'not_checked');assert.equal(r.notices.length,0);
 assert.equal(dwdQuery(area).searchParams.get('count'),'40');assert.ok(dwdQuery(area).searchParams.has('bbox'));
});
test('DWD distinguishes publication/onset/expiry; Harz missing dates stay unknown, without storing source prose',()=>{
 const r=parseDWD({type:'FeatureCollection',features:[{geometry,properties:{IDENTIFIER:'DWD-123',STATUS:'Actual',SCOPE:'Public',MSGTYPE:'Alert',SENT:'2026-09-09T07:00:00Z',ONSET:'2026-09-09T09:00:00Z',EFFECTIVE:'2026-09-09T08:00:00Z',EXPIRES:'2026-09-09T12:00:00Z',EVENT:'Storm',NAME:'Town'}}]})[0];
 assert.notEqual(r.publishedAt,r.eventStart);assert.notEqual(r.eventStart,r.validFrom);
 const h=parseHarz({type:'FeatureCollection',features:[{geometry:{type:'LineString',coordinates:[[10,51],[10.1,51.1]]},properties:{GlobalID:'12345678-1234-1234-1234-123456789abc',Name_neu:'Testweg',Zustand:'Sperrung',Bemerkung:'Untrusted full webpage prose'}}]})[0];
 assert.equal(h.validFrom,null);assert.equal(h.publishedAt,null);assert.equal(h.restrictionArea,false);assert.ok(!JSON.stringify(h).includes('Untrusted'));
});

test('municipal duplicates retain all warning polygons and sparse segments cross polygons correctly',()=>{
 const elsewhere={type:'Polygon',coordinates:[[[9.1,50.1],[9.2,50.1],[9.2,50.2],[9.1,50.2],[9.1,50.1]]]};
 const r=check([notice({geometry:elsewhere}),notice()]);
 assert.equal(r.notices.length,1);assert.equal(r.notices[0].spatial,'route');
 assert.deepEqual(r.blockingNoticeIds,['notice-1']);
});
test('polygon holes and geometry work caps preserve uncertainty',()=>{
 const withHole={...geometry,coordinates:[geometry.coordinates[0],[[9.95,50.95],[10.05,50.95],[10.05,51.05],[9.95,51.05],[9.95,50.95]]]};
 assert.equal(spatialMatch(withHole,[[10,51],[10.01,51]],area),'area');
 assert.equal(spatialMatch(geometry,Array(400001).fill([10,51]),area),'unknown');
});
test('a failed corridor refresh or empty response cannot erase an earlier active restriction',async()=>{
 const {mergeConditionSnapshots}=await import('../src/dynamicResearch/localConditions.js');
 const earlier=snapshot([notice()]);
 for(const state of ['unavailable','checked']) {
  const later={...snapshot([]),checkedAt:'2026-09-09T08:01:00Z',sources:[{...source,state}]};
  const merged=mergeConditionSnapshots(earlier,later);
  const result=evaluateConditions(merged,{path,now:now+60000});
  assert.deepEqual(result.blockingNoticeIds,['notice-1']);
  assert.equal(result.notices[0].retrievedAt,'2026-09-09T08:00:00Z');
  assert.equal(result.sources[0].state,state);
 }
});
