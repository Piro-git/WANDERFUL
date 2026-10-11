import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateWeatherRequest,sampleRoute,summarizeForecast,createRouteWeather} from '../src/weather/routeWeather.js';
import {createMetNorwayProvider} from '../src/weather/metNorway.js';
import {createWeatherEndpoint} from '../src/weather/weatherEndpoint.js';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/weather/met-compact.json',import.meta.url)));
const now=Date.parse('2026-09-29T00:30:00Z');
const body={version:1,geometryJSON:'[[10,50],[10.01,50],[10.1,50]]',plannedStartAt:'2026-09-29T03:00:00+02:00',durationHours:4};
const provider=async()=>({document:fixture,retrievedAt:new Date(now).toISOString(),expiresAt:'2026-09-29T02:00:00Z'});

test('strict request binds full geometry and zoned instant; invalid inputs fail closed',()=>{
  assert.equal(validateWeatherRequest(body).geometryDigest.length,64);
  for(const bad of [{...body,extra:true},{...body,plannedStartAt:'2026-09-29T03:00:00'}, {...body,durationHours:0},
    {...body,geometryJSON:'[[200,50],[10,50]]'},{...body,geometryJSON:'[[10,50]]'},{...body,geometryJSON:'null'}]) assert.throws(()=>validateWeatherRequest(bad));
});
test('sampling uses distance rather than dense vertex indexes, closes loops, crosses dateline',()=>{
  const sample=sampleRoute(validateWeatherRequest(body).path);
  assert.ok(Math.abs(sample[1].longitude-10.05)<0.0002);
  const loop=sampleRoute([[10,50],[10.1,50],[10,50]]);
  assert.deepEqual(loop.map(p=>p.fraction),[0,0.33,0.67]);
  assert.ok(loop[1].longitude>10.06 && loop[2].longitude>10.06);
  assert.ok(Math.abs(sampleRoute([[179.9,0],[-179.9,0]])[1].longitude)>179.9);
  assert.throws(()=>sampleRoute([[10,50],[10,50]]));
});
test('forecast summarizes all three route locations over full time window, converting wind and timezone',async()=>{
  const points=[];const weather=createRouteWeather({provider:async p=>{points.push(p);return provider();},now:()=>now});
  const result=await weather(validateWeatherRequest(body));
  assert.equal(result.state,'available');assert.equal(points.length,3);assert.equal(result.windowEnd,'2026-09-29T05:00:00.000Z');
  assert.equal(result.samples[0].temperatureMinC,11);assert.equal(result.samples[0].temperatureMaxC,15);
  assert.equal(result.samples[0].windMaxKmh,16.2);assert.equal(result.samples[0].precipitationMaxMmPerHour,0.5);
});
test('six-hour precipitation is an interval average, not an invented hourly maximum',()=>{
  const value=summarizeForecast(fixture,Date.parse('2026-09-29T07:00Z'),Date.parse('2026-09-29T08:00Z'));
  assert.equal(value.intervalHours,6);assert.equal(value.precipitationMaxMmPerHour,2);
});
test('missing null rain, units, temperatures or source timestamp never turn into dry weather',()=>{
  for(const edit of [d=>d.properties.timeseries[1].data.next_1_hours.details.precipitation_amount=null,
    d=>d.properties.meta.units.wind_speed='km/h',d=>delete d.properties.meta.updated_at,
    d=>d.properties.timeseries[1].data.instant.details.air_temperature=null]) {
    const data=structuredClone(fixture);edit(data);
    assert.throws(()=>summarizeForecast(data,Date.parse('2026-09-29T01:00Z'),Date.parse('2026-09-29T05:00Z')));
  }
});
test('no date, past, beyond horizon, unsupported duration avoid provider calls',async()=>{
  let calls=0;const weather=createRouteWeather({provider:async()=>{calls++;return provider();},now:()=>now});
  for(const [change,state] of [[{plannedStartAt:null},'date_required'],[{plannedStartAt:'2026-09-28T01:00Z'},'outside_horizon'],
    [{plannedStartAt:'2026-10-09T01:00Z'},'outside_horizon'],[{durationHours:25},'duration_unsupported']]) {
    assert.equal((await weather(validateWeatherRequest({...body,...change}))).state,state);
  }
  assert.equal(calls,0);
});
test('actual forecast coverage constrains horizon; missing provider or failed sample is unavailable',async()=>{
  assert.equal((await createRouteWeather({provider,now:()=>now})(validateWeatherRequest({...body,durationHours:15}))).state,'outside_horizon');
  assert.equal((await createRouteWeather({now:()=>now})(validateWeatherRequest(body))).state,'unavailable');
  let count=0;
  const result=await createRouteWeather({provider:async()=>{if(++count===2)throw Error('sensitive upstream error');return provider();},now:()=>now})(validateWeatherRequest(body));
  assert.equal(result.state,'unavailable');assert.deepEqual(result.samples,[]);assert.ok(!JSON.stringify(result).includes('sensitive'));
});
const headers={Expires:'Tue, 29 Sep 2026 01:30:00 GMT','Last-Modified':'Tue, 29 Sep 2026 00:00:00 GMT'};
const userAgent='WanderfulTests/1.0 https://example.org/contact';
test('cache deduplicates concurrent coordinates and respects Expires, conditional 304 refresh',async()=>{
  let clock=now,calls=0;
  const cached=createMetNorwayProvider({userAgent,now:()=>clock,fetchImpl:async(url,init)=>{
    calls++;assert.equal(url.origin,'https://api.met.no');assert.ok(init.headers['User-Agent'].includes('Wanderful'));
    if(calls===1)return new Response(JSON.stringify(fixture),{headers});
    assert.equal(init.headers['If-Modified-Since'],headers['Last-Modified']);
    return new Response(null,{status:304,headers:{Expires:'Tue, 29 Sep 2026 03:30:00 GMT'}});
  }});
  const point={latitude:50,longitude:10};
  await Promise.all([cached(point),cached(point)]); await cached(point); assert.equal(calls,1);
  clock+=3600001;await cached(point);assert.equal(calls,2);
});
test('cache saturation, provider throttle and oversized response are bounded',async()=>{
  let calls=0;const cached=createMetNorwayProvider({userAgent,now:()=>now,maximumEntries:1,fetchImpl:async()=>{calls++;return new Response(JSON.stringify(fixture),{headers});}});
  await cached({latitude:50,longitude:10});await assert.rejects(cached({latitude:51,longitude:10}));assert.equal(calls,1);
  const throttled=createMetNorwayProvider({userAgent,now:()=>now,fetchImpl:async()=>{calls++;return new Response('',{status:429});}});
  await assert.rejects(throttled({latitude:50,longitude:10})); await assert.rejects(throttled({latitude:50,longitude:11}));assert.equal(calls,2);
  const huge=createMetNorwayProvider({userAgent,now:()=>now,fetchImpl:async()=>new Response('x'.repeat(256001),{headers})});
  await assert.rejects(huge({latitude:50,longitude:10}));
});
test('provider timeout aborts, cancellation does not expose a partial forecast',async()=>{
  const timed=createMetNorwayProvider({userAgent,timeoutMs:5,now:()=>now,fetchImpl:async(_url,{signal})=>new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Error('timeout'))))});
  await assert.rejects(timed({latitude:50,longitude:10}));
  const controller=new AbortController();controller.abort();
  assert.equal((await createRouteWeather({provider,now:()=>now})(validateWeatherRequest(body),{signal:controller.signal})).state,'unavailable');
});
test('endpoint authenticates, charges one unit, releases lease, stays disabled by default',async()=>{
  let released=0,calls=0;
  const authorizer={async authorize(ctx){assert.equal(ctx.cost,1);return {authorized:true,rateLimitKey:'fixture',limitsConsumed:true,release:()=>released++};}};
  const endpoint=createWeatherEndpoint({env:{NODE_ENV:'test'},authorizer,weatherProvider:async()=>{calls++;return provider();},now:()=>now});
  assert.equal((await endpoint(body)).payload.state,'unavailable');assert.equal(calls,0);assert.equal(released,1);
  const active=createWeatherEndpoint({env:{NODE_ENV:'test',ROUTE_WEATHER_ENABLED:'true'},authorizer,weatherProvider:provider,now:()=>now});
  assert.equal((await active(body)).payload.state,'available');assert.equal(released,2);
  const denied=createWeatherEndpoint({env:{NODE_ENV:'test',ROUTE_WEATHER_ENABLED:'true'},authorizer:{authorize:async()=>({authorized:false})},weatherProvider:async()=>{throw Error('must not run');}});
  assert.notEqual((await denied(body)).statusCode,200);
});
test('HTTP dispatch reaches weather boundary independently of LLM planning flags',async()=>{
  const {handleIntentHttpRequest}=await import('../src/server.js');
  const result=await handleIntentHttpRequest({method:'POST',url:'/api/route-weather',body}, {
    env:{NODE_ENV:'test',ROUTE_WEATHER_ENABLED:'true'},now:()=>now,weatherProvider:provider,
    authorizer:{authorize:async()=>({authorized:true,rateLimitKey:'test',limitsConsumed:true})}
  });
  assert.equal(result.statusCode,200); assert.equal(result.payload.state,'available');
});
test('old model update, future update and expired cache cannot produce available weather',async()=>{
  for(const change of ['old','future','expired']) {
    const source=structuredClone(fixture);
    if(change!=='expired')source.properties.meta.updated_at=new Date(now+(change==='old'?-90000000:3600000)).toISOString();
    const forecast=createRouteWeather({now:()=>now,provider:async()=>({document:source,retrievedAt:new Date(now).toISOString(),expiresAt:new Date(now+(change==='expired'?-1000:3600000)).toISOString()})});
    assert.equal((await forecast(validateWeatherRequest(body))).state,'unavailable');
  }
});
test('saturated cache admits a new route after expiry without evicting fresh entries',async()=>{
  let clock=now,calls=0;
  const cached=createMetNorwayProvider({userAgent,now:()=>clock,maximumEntries:1,fetchImpl:async()=>{
    calls++;return new Response(JSON.stringify(fixture),{headers:{Expires:new Date(clock+3600000).toUTCString()}});
  }});
  await cached({latitude:50,longitude:10});
  await assert.rejects(cached({latitude:51,longitude:11}));assert.equal(calls,1);
  clock+=3600001;
  await cached({latitude:51,longitude:11});assert.equal(calls,2);
});
