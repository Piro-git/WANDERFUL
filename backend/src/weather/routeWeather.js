import {createHash} from 'node:crypto';

const HOUR = 3_600_000;
export const WEATHER_SOURCE = Object.freeze({name:'MET Norway',url:'https://api.met.no/',licenseURL:'https://creativecommons.org/licenses/by/4.0/'});
export function validateWeatherRequest(body) {
  if (!body || Object.keys(body).sort().join(',') !== 'durationHours,geometryJSON,plannedStartAt,version' || body.version !== 1 ||
      typeof body.geometryJSON !== 'string' || Buffer.byteLength(body.geometryJSON) > 500000 ||
      !Number.isFinite(body.durationHours) || body.durationHours <= 0 || body.durationHours > 1000 ||
      (body.plannedStartAt !== null && (typeof body.plannedStartAt !== 'string' || body.plannedStartAt.length > 40 ||
        !/T.*(Z|[+-]\d\d:\d\d)$/.test(body.plannedStartAt) || !Number.isFinite(Date.parse(body.plannedStartAt))))) throw new TypeError('invalid_weather_request');
  const path = JSON.parse(body.geometryJSON);
  if (!Array.isArray(path) || path.length < 2 || path.length > 20000 || path.some(p => !Array.isArray(p) || p.length !== 2 ||
      !p.every(Number.isFinite) || Math.abs(p[0]) > 180 || Math.abs(p[1]) > 90)) throw new TypeError('invalid_weather_request');
  return {...body,path,geometryDigest:createHash('sha256').update(body.geometryJSON).digest('hex')};
}
function distance(a,b) {
  const r = Math.PI / 180, lat = (b[1]-a[1])*r, lon = (b[0]-a[0])*r;
  return 2 * Math.asin(Math.min(1,Math.sqrt(Math.sin(lat/2)**2 + Math.cos(a[1]*r)*Math.cos(b[1]*r)*Math.sin(lon/2)**2)));
}
// Equal cumulative-distance fractions, not vertex indexes. Shortest longitude interpolation crosses the dateline correctly.
export function sampleRoute(path) {
  const cumulative = [0];
  for (let i=1;i<path.length;i++) cumulative.push(cumulative[i-1]+distance(path[i-1],path[i]));
  if (cumulative.at(-1) <= 0) throw new TypeError('degenerate_route');
  const isLoop = distance(path[0],path.at(-1))*6371000 < 50 && cumulative.at(-1)*6371000 > 100;
  return (isLoop ? [0,0.33,0.67] : [0,0.5,1]).map(fraction => {
    const target = fraction*cumulative.at(-1);
    let i = 1; while (i < path.length-1 && cumulative[i] < target) i++;
    const f = (target-cumulative[i-1])/(cumulative[i]-cumulative[i-1] || 1);
    let delta = path[i][0]-path[i-1][0]; if (delta>180) delta-=360; if (delta< -180) delta+=360;
    const lon = ((path[i-1][0]+delta*f+540)%360)-180;
    const truncate = n => Math.trunc(n*10000)/10000;
    return {fraction,latitude:truncate(path[i-1][1]+(path[i][1]-path[i-1][1])*f),longitude:truncate(lon)};
  });
}
export function summarizeForecast(document,start,end) {
  const meta = document?.properties?.meta, series = document?.properties?.timeseries;
  if (meta?.units?.air_temperature !== 'celsius' || meta?.units?.wind_speed !== 'm/s' || meta?.units?.precipitation_amount !== 'mm' ||
      !Number.isFinite(Date.parse(meta.updated_at)) || !Array.isArray(series) || series.length < 2 || series.length > 300) throw new TypeError('invalid_forecast');
  const times = series.map(s=>Date.parse(s.time));
  if (times.some((t,i)=>!Number.isFinite(t) || i>0 && t<=times[i-1])) throw new TypeError('invalid_forecast');
  if (start<times[0] || end>times.at(-1)) return null;
  const temperatures=[],winds=[],rain=[],intervals=[];
  for (let i=0;i<series.length-1;i++) {
    if (times[i]>=end || times[i+1]<=start) continue;
    const data=series[i].data, instant=data?.instant?.details, hours=(times[i+1]-times[i])/HOUR;
    const period=hours===1?data?.next_1_hours:hours===6?data?.next_6_hours:null;
    const temp=instant?.air_temperature,wind=instant?.wind_speed,amount=period?.details?.precipitation_amount;
    if (![temp,wind,amount].every(Number.isFinite) || temp < -100 || temp > 65 || wind < 0 || wind > 150 || amount < 0 || amount > 2000) throw new TypeError('incomplete_forecast');
    temperatures.push(temp); winds.push(wind*3.6); rain.push(amount/hours); intervals.push(hours);
    // Include the next instantaneous value as a conservative endpoint bound, never invent interpolation.
    const next=series[i+1].data?.instant?.details;
    if (!Number.isFinite(next?.air_temperature)||!Number.isFinite(next?.wind_speed)||next.air_temperature < -100||next.air_temperature>65||next.wind_speed<0||next.wind_speed>150) throw new TypeError('incomplete_forecast');
    temperatures.push(next.air_temperature); winds.push(next.wind_speed*3.6);
  }
  if (!temperatures.length) return null;
  return {temperatureMinC:Math.min(...temperatures),temperatureMaxC:Math.max(...temperatures),windMaxKmh:Math.max(...winds),
    precipitationMaxMmPerHour:Math.max(...rain),intervalHours:Math.max(...intervals),sourceUpdatedAt:new Date(meta.updated_at).toISOString()};
}
export function createRouteWeather({provider,now=Date.now}) {
  return async (request,{signal}={}) => {
    const base={version:1,geometryDigest:request.geometryDigest,plannedStartAt:request.plannedStartAt,
      durationHours:request.durationHours,checkedAt:new Date(now()).toISOString(),samples:[]};
    const state=s=>({...base,state:s});
    if (!request.plannedStartAt) return state('date_required');
    if (request.durationHours>24) return state('duration_unsupported');
    const start=Date.parse(request.plannedStartAt),end=start+request.durationHours*HOUR;
    if (start<now() || end>now()+9*24*HOUR) return state('outside_horizon');
    if (!provider) return state('unavailable');
    try {
      const samples=[];
      for (const point of sampleRoute(request.path)) {
        if (signal?.aborted) throw new Error('cancelled');
        const result=await provider(point,{signal});
        const updated=Date.parse(result.document?.properties?.meta?.updated_at);
        if (!Number.isFinite(updated) || updated>now()+300000 || updated<now()-86400000 ||
            !(Date.parse(result.expiresAt)>now())) throw new Error('stale_forecast');
        const values=summarizeForecast(result.document,start,end);
        if (!values) return state('outside_horizon');
        samples.push({...point,...values,retrievedAt:result.retrievedAt,expiresAt:result.expiresAt});
      }
      return {...base,state:'available',windowEnd:new Date(end).toISOString(),source:WEATHER_SOURCE,samples};
    } catch { return state('unavailable'); }
  };
}
