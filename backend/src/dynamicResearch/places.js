import {publicSourceURL} from './publicSources.js';
import {fetchBoundedJson} from '../llmPlanning/adapters/providerHttp.js';

export const PLACE_LIMITS = Object.freeze({maximumPlaces:80, maximumRadiusMeters:20000,
  maximumSnapshotAgeMs:7*86400000, maximumResponseBytes:262144, timeoutMs:30000});
const categories = Object.freeze({viewpoint:['tourism','viewpoint'], peak:['natural','peak'],
  waterfall:['waterway','waterfall'], lake:['water','lake'], hut:['tourism','alpine_hut'], landmark:['historic','monument'],
  alpine_hut:['tourism','alpine_hut'], wilderness_hut:['tourism','wilderness_hut'], campsite:['tourism','camp_site'],
  emergency_shelter:['amenity','shelter','shelter_type','basic_hut']});
const stayKinds=new Set(['alpine_hut','wilderness_hut','campsite','emergency_shelter']);
const pairs=kind=>Array.from({length:categories[kind].length/2},(_,i)=>categories[kind].slice(i*2,i*2+2));
const fail=()=>{throw new TypeError('invalid_place_evidence');};
export function validCoordinate(point) {
  return point && Number.isFinite(point.latitude)&&Math.abs(point.latitude)<=90&&
    Number.isFinite(point.longitude)&&Math.abs(point.longitude)<=180;
}
export function distanceMeters(a,b) {
  if(!validCoordinate(a)||!validCoordinate(b))fail();
  const rad=Math.PI/180, dlat=(b.latitude-a.latitude)*rad, dlon=(b.longitude-a.longitude)*rad;
  const x=Math.sin(dlat/2)**2+Math.cos(a.latitude*rad)*Math.cos(b.latitude*rad)*Math.sin(dlon/2)**2;
  return 6371000*2*Math.atan2(Math.sqrt(x),Math.sqrt(Math.max(0,1-x)));
}
export function safeLabel(value, maximum=180) {
  if(typeof value!=='string'||!value.trim()||value.length>maximum||/[\u0000-\u001f\u007f<>]/.test(value))return null;
  return value.trim();
}
// Only an explicit `File:` value is a direct Commons-media identity. Categories,
// URLs and secondary/attribute tags are deliberately not interchangeable with it.
function commonsFile(value) {
  if(typeof value!=='string'||!value.startsWith('File:'))return null;
  const file=safeLabel(value.slice(5),240);
  return file&&!/[\\/]|\.\.|[|{}\[\]]/.test(file)?file:null;
}
// Bounding boxes use Overpass's spatial index. The records are still checked
// against the exact requested circle below, so corners never widen admission.
function sourceBounds(anchor,radiusMeters) {
  const radians=radiusMeters/6371000, degrees=180/Math.PI;
  const south=Math.max(-90,anchor.latitude-radians*degrees),north=Math.min(90,anchor.latitude+radians*degrees);
  const delta=south===-90||north===90?180:Math.asin(Math.min(1,Math.sin(radians)/Math.cos(anchor.latitude/degrees)))*degrees;
  const wrap=x=>((x+540)%360)-180;
  return `${south},${delta===180?-180:wrap(anchor.longitude-delta)},${north},${delta===180?180:wrap(anchor.longitude+delta)}`;
}
export function buildPlaceSearch({anchor,radiusMeters,kinds}) {
  if(!validCoordinate(anchor)||!Number.isInteger(radiusMeters)||radiusMeters<250||radiusMeters>PLACE_LIMITS.maximumRadiusMeters||
    !Array.isArray(kinds)||kinds.length<1||kinds.length>6||new Set(kinds).size!==kinds.length||kinds.some(k=>!Object.hasOwn(categories,k)))fail();
  const bounds=sourceBounds(anchor,radiusMeters);
  // Model/source text never enters Overpass syntax. Only validated numbers and fixed predicates.
  const perKindLimit=Math.floor(PLACE_LIMITS.maximumPlaces/kinds.length);
  // Bound each category before combining: plentiful peaks must not crowd out viewpoints.
  const statements=kinds.map(k=>{const tags=pairs(k).map(([key,value])=>`["${key}"="${value}"]`).join('');return `nwr(${bounds})${tags}${stayKinds.has(k)?'':'["name"]'};out meta center ${perKindLimit};`;}).join('');
  return `[out:json][timeout:25][maxsize:16777216];${statements}`;
}
const nameKeys=Object.freeze(['name','name:en','name:de','official_name','short_name']);
export function buildNamedPlaceSearch({anchor,radiusMeters,name}) {
  if(!validCoordinate(anchor)||!Number.isInteger(radiusMeters)||radiusMeters<250||radiusMeters>PLACE_LIMITS.maximumRadiusMeters||
    !safeLabel(name)||name!==name.trim()||!name.isWellFormed())fail();
  // Exact tag values, JSON-escaped as QL string literals; model text is never regex or syntax.
  const statements=nameKeys.map(key=>`nwr(${sourceBounds(anchor,radiusMeters)})["${key}"=${JSON.stringify(name)}];`).join('');
  return `[out:json][timeout:25][maxsize:16777216];(${statements});out meta center 6;`;
}
function parseRecords(payload,request,now,named=false) {
  const snapshot=Date.parse(payload?.osm3s?.timestamp_osm_base);
  if(!Number.isFinite(now)||!Number.isFinite(snapshot)||snapshot>now+300000||now-snapshot>PLACE_LIMITS.maximumSnapshotAgeMs||
    payload?.remark||!Array.isArray(payload?.elements)||payload.elements.length>(named?6:PLACE_LIMITS.maximumPlaces))fail();
  const result=[],seen=new Set();
  for(const element of payload.elements) {
    if(!['node','way','relation'].includes(element?.type)||!Number.isSafeInteger(element.id)||element.id<=0||
      !Number.isSafeInteger(element.version)||element.version<1)continue;
    const label=safeLabel(element.tags?.name)??(named?safeLabel(request.name):null);
    if(named&&!nameKeys.some(key=>element.tags?.[key]===request.name))continue;
    const kind=(named?Object.keys(categories).slice(0,6):request.kinds).find(k=>pairs(k).every(([key,value])=>element.tags?.[key]===value))??(named?'named_place':null);
    const coordinate={latitude:element.type==='node'?element.lat:element.center?.lat,
      longitude:element.type==='node'?element.lon:element.center?.lon};
    const id=`osm:${element.type}:${element.id}`;
    const edited=Date.parse(element.timestamp);
    if((!label&&!stayKinds.has(kind))||!kind||!validCoordinate(coordinate)||distanceMeters(request.anchor,coordinate)>request.radiusMeters||
      !Number.isFinite(edited)||edited>snapshot+300000||seen.has(id))continue;
    if(stayKinds.has(kind) && (['no','private'].includes(element.tags?.access)||element.tags?.disused==='yes'||element.tags?.abandoned==='yes'||
      kind==='campsite' && (element.tags?.impromptu==='yes'||element.tags?.informal==='yes'||element.tags?.tents==='no')))continue;
    seen.add(id);
    const wikidataId=/^Q[1-9][0-9]{0,15}$/.test(element.tags?.wikidata??'')?element.tags.wikidata:null;
    const commonsFileName=commonsFile(element.tags?.wikimedia_commons)??commonsFile(element.tags?.image);
    result.push({id,name:label??id,category:kind,coordinate,coordinateKind:element.type==='node'?'mapped_point':'mapped_center',wikidataId,
      commonsFile:commonsFileName,
      ...(stayKinds.has(kind)?{stayIdentity:{nameKnown:label!==null,operator:safeLabel(element.tags?.operator),
        website:publicSourceURL(element.tags?.['contact:website']??element.tags?.website)?.href??null}}:{}),
      source:{provider:'openstreetmap',url:`https://www.openstreetmap.org/${element.type}/${element.id}`,
        license:'ODbL-1.0',attribution:'© OpenStreetMap contributors',version:element.version,
        updatedAt:new Date(edited).toISOString(),retrievedAt:new Date(now).toISOString(),snapshotAt:new Date(snapshot).toISOString()},
      facts:[kind==='named_place'?{code:'mapped_name',value:label}:{code:'mapped_category',value:kind}],
      limitations:['Mapped identity and location; current access, visibility and safety are not verified.']});
  }
  return result;
}
export function parsePlaces(payload,request,now=Date.now()) {
  buildPlaceSearch(request);return parseRecords(payload,request,now);
}
export function parseNamedPlace(payload,request,now=Date.now()) {
  buildNamedPlaceSearch(request);
  const records=parseRecords(payload,request,now,true);
  // Saturated output may hide other identities. Never pick the first ambiguous match.
  if(payload.elements.length===6||records.length>1)return {state:'ambiguous'};
  return records.length===1?{state:'resolved',place:records[0]}:{state:'no_match_in_region'};
}
function createSourceLookup({fetchImpl=globalThis.fetch,userAgent,now=Date.now}={},named=false) {
  if(!safeLabel(userAgent,200))throw new TypeError('research_configuration_missing');
  // Fixed endpoint for the bounded private pilot; replace through reviewed adapter configuration for deployment.
  return async(request,{signal}={})=>{
    const query=named?buildNamedPlaceSearch(request):buildPlaceSearch(request);
    const payload=await fetchBoundedJson({url:new URL('https://overpass-api.de/api/interpreter'),fetchImpl,signal,
      init:{method:'POST',headers:{Accept:'application/json','Content-Type':'application/x-www-form-urlencoded','User-Agent':userAgent},body:new URLSearchParams({data:query}).toString()},
      deadlineMs:PLACE_LIMITS.timeoutMs,maximumAttempts:1,maximumResponseBytes:PLACE_LIMITS.maximumResponseBytes,
      maximumErrorResponseBytes:8192,setTimeoutImpl:setTimeout,clearTimeoutImpl:clearTimeout});
    return named?parseNamedPlace(payload,request,now()):parsePlaces(payload,request,now());
  };
}

export const createDynamicPlaceSearch=options=>createSourceLookup(options);
export const createNamedPlaceResolver=options=>createSourceLookup(options,true);
