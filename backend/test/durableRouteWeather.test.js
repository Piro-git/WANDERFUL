import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createWeatherEndpoint} from '../src/weather/weatherEndpoint.js';
import {createDurableMetNorwayProvider} from '../src/weather/durableMetNorway.js';
import {PostgresWeatherStore} from '../src/weather/postgresWeatherStore.js';

const fixture=JSON.parse(readFileSync(new URL('./fixtures/weather/met-compact.json',import.meta.url)));
const base=Date.parse('2026-09-29T00:30:00Z');
const body={version:1,geometryJSON:'[[10,50],[10.01,50],[10.1,50]]',plannedStartAt:'2026-09-29T03:00:00+02:00',durationHours:4};
const userAgent='WanderfulTests/1.0 https://example.org/contact';
const authorizer={authorize:async()=>({authorized:true,rateLimitKey:'fixture',limitsConsumed:true})};
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));

class FakeDurableStore {
  constructor(now,{spacingMs=600,leaseMs=12000,maximumEntries=128}={}) {
    this.now=now;this.spacingMs=spacingMs;this.leaseMs=leaseMs;this.maximumEntries=maximumEntries;
    this.rows=new Map();this.nextAdmit=0;this.blockedUntil=0;this.admissions=[];this.token=0;
  }
  async claim(key) {
    const time=this.now(),row=this.rows.get(key);
    if(row?.value && Date.parse(row.value.expiresAt)>time) return {kind:'hit',value:row.value};
    if(row?.token && row.leaseUntil>time) return {kind:'wait'};
    if(time<this.blockedUntil || time<this.nextAdmit) return {kind:'busy'};
    if(!row && this.rows.size>=this.maximumEntries) {
      for(const [candidate,entry] of this.rows) if(Date.parse(entry.value?.expiresAt??0)<=time && entry.leaseUntil<=time) this.rows.delete(candidate);
      if(this.rows.size>=this.maximumEntries) return {kind:'busy'};
    }
    const token=String(++this.token);
    this.rows.set(key,{value:row?.value,token,leaseUntil:time+this.leaseMs});
    this.nextAdmit=time+this.spacingMs;this.admissions.push(time);
    return {kind:'claim',token,old:row?.value};
  }
  async complete(key,token,value) {
    const row=this.rows.get(key);
    if(row?.token!==token || row.leaseUntil<=this.now() || Date.parse(value.expiresAt)<=this.now()) throw Error('lease_lost');
    this.rows.set(key,{value,token:null,leaseUntil:0});
  }
  async fail(key,token,{throttled=false}={}) {
    const row=this.rows.get(key);if(row?.token===token) this.rows.set(key,{...row,token:null,leaseUntil:0});
    this.blockedUntil=Math.max(this.blockedUntil,this.now()+(throttled?60000:10000));
  }
}

function endpoint(store,fetchImpl,now) {
  return createWeatherEndpoint({env:{NODE_ENV:'test',ROUTE_WEATHER_ENABLED:'true',ROUTE_WEATHER_USER_AGENT:userAgent},
    authorizer,weatherStore:store,fetchImpl,now});
}

test('two independent handlers share one fill per coordinate and an app-wide start budget',async()=>{
  const start=Date.now(),now=()=>base+Date.now()-start,store=new FakeDurableStore(now);
  const calls=[];
  const fetchImpl=async(url,init)=>{assert.deepEqual([...url.searchParams.keys()].sort(),['lat','lon']);
    assert.ok(!Object.keys(init.headers).some(key=>/authorization|account|prompt/i.test(key)));
    calls.push({key:url.search,time:now()});await pause(35);
    return new Response(JSON.stringify(fixture),{headers:{Expires:new Date(base+3600000).toUTCString(),
      'Last-Modified':new Date(base-300000).toUTCString()}});};
  const first=endpoint(store,fetchImpl,now),second=endpoint(store,fetchImpl,now);
  const [a,b]=await Promise.all([first(body),second(body)]);
  assert.equal(a.payload.state,'available');assert.equal(b.payload.state,'available');
  assert.equal(calls.length,3);assert.equal(new Set(calls.map(c=>c.key)).size,3);
  assert.ok(store.admissions.every((time,i)=>i===0||time-store.admissions[i-1]>=600));
  assert.deepEqual(a.payload.samples.map(s=>s.longitude),b.payload.samples.map(s=>s.longitude));
});

test('shared expiry uses exact Last-Modified in conditional revalidation and 304 extends freshness',async()=>{
  let clock=base,calls=0;const now=()=>clock,store=new FakeDurableStore(now,{spacingMs:0});
  const modified=new Date(base-300000).toUTCString();
  const fetchImpl=async(_url,init)=>{calls++;
    if(calls===1) return new Response(JSON.stringify(fixture),{headers:{Expires:new Date(base+3600000).toUTCString(),'Last-Modified':modified}});
    assert.equal(init.headers['If-Modified-Since'],modified);
    return new Response(null,{status:304,headers:{Expires:new Date(base+7200000).toUTCString()}});
  };
  const a=createDurableMetNorwayProvider({store,userAgent,now,fetchImpl});
  const b=createDurableMetNorwayProvider({store,userAgent,now,fetchImpl});
  const point={latitude:50,longitude:10};
  const original=await a(point);await b(point);assert.equal(calls,1);
  clock=base+3600001;
  const refreshed=await b(point);
  assert.equal(calls,2);assert.equal(refreshed.retrievedAt,original.retrievedAt);
  assert.equal(refreshed.expiresAt,new Date(base+7200000).toISOString());
  await a(point);assert.equal(calls,2);
});

test('a crashed filler loses its lease; expired data never becomes fresh',async()=>{
  let clock=base;const now=()=>clock,store=new FakeDurableStore(now,{spacingMs:0});
  const claim=await store.claim('50,10');assert.equal(claim.kind,'claim');
  assert.equal((await store.claim('50,10')).kind,'wait');
  clock+=12001;
  const next=await store.claim('50,10');assert.equal(next.kind,'claim');
  assert.notEqual(next.token,claim.token);
  await assert.rejects(store.complete('50,10',claim.token,{document:fixture,retrievedAt:new Date(clock).toISOString(),expiresAt:new Date(clock+10000).toISOString()}));
  assert.equal(store.rows.get('50,10').value,undefined);
});

test('bounded fleet cache refuses a new coordinate while full of fresh entries',async()=>{
  let clock=base;const store=new FakeDurableStore(()=>clock,{spacingMs:0,maximumEntries:2});
  const value={document:fixture,retrievedAt:new Date(base).toISOString(),expiresAt:new Date(base+3600000).toISOString()};
  for(const key of ['50,10','51,11']) {
    const claim=await store.claim(key);assert.equal(claim.kind,'claim');
    await store.complete(key,claim.token,value);
  }
  assert.equal((await store.claim('52,12')).kind,'busy');
  assert.equal((await store.claim('50,10')).kind,'hit');
  assert.equal((await store.claim('51,11')).kind,'hit');
  clock=base+3600001;
  assert.equal((await store.claim('52,12')).kind,'claim');
});

test('provider error and 429 block new fleet admissions without returning old data',async()=>{
  let clock=base,calls=0;const now=()=>clock,store=new FakeDurableStore(now,{spacingMs:0});
  const bad=createDurableMetNorwayProvider({store,userAgent,now,fetchImpl:async()=>{calls++;return new Response('',{status:429});}});
  await assert.rejects(bad({latitude:50,longitude:10}));
  assert.equal((await store.claim('51,11')).kind,'busy');assert.equal(calls,1);
  clock+=60001;
  assert.equal((await store.claim('51,11')).kind,'claim');
});

test('missing migration or database failure leaves weather unavailable and never calls MET',async()=>{
  let calls=0;
  const failingStore={claim:async()=>{throw Error('relation route_weather_control does not exist');},complete:async()=>{},fail:async()=>{}};
  const result=await endpoint(failingStore,async()=>{calls++;throw Error('must not call');},()=>base)(body);
  assert.equal(result.payload.state,'unavailable');assert.equal(calls,0);
  assert.ok(!JSON.stringify(result).includes('relation'));
  const pool={query:async()=>{throw Error('database unavailable');},
    connect:async()=>({query:async()=>{throw Error('database unavailable');},release(){}})};
  await assert.rejects(new PostgresWeatherStore({pool}).claim('50,10'));
});

test('enabled endpoint without a durable pool stays unavailable; ignored abort still times out',async()=>{
  let calls=0;
  const noStore=createWeatherEndpoint({env:{NODE_ENV:'production',ROUTE_WEATHER_ENABLED:'true',ROUTE_WEATHER_USER_AGENT:userAgent},
    authorizer,fetchImpl:async()=>{calls++;throw Error('must not call');},now:()=>base});
  assert.equal((await noStore(body)).payload.state,'unavailable');assert.equal(calls,0);
  const store=new FakeDurableStore(()=>base,{spacingMs:0});
  const hung=createDurableMetNorwayProvider({store,userAgent,now:()=>base,timeoutMs:10,
    fetchImpl:async()=>new Promise(()=>{})});
  await assert.rejects(hung({latitude:50,longitude:10}),/weather_timeout/);
  assert.equal(store.rows.get('50,10').value,undefined);
  assert.equal((await store.claim('51,11')).kind,'busy');
});
