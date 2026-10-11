import {fetchBoundedJson} from '../llmPlanning/adapters/providerHttp.js';
import {distanceMeters,validCoordinate,safeLabel} from './places.js';

export const ACCESS_LIMITS=Object.freeze({places:80,elements:6000,responseBytes:262144,timeoutMs:8000,snapshotAgeMs:7*86400000});
const osmID=/^osm:(node|way|relation):([1-9][0-9]{0,15})$/;
const denied=new Set(['no','private']);
const allowed=new Set(['yes','designated','permissive']);
const idOf=e=>`osm:${e.type}:${e.id}`;
const fail=()=>{throw new TypeError('invalid_access_evidence');};
export function unknownAccess(place,reason='connection_not_documented',now=Date.now()) {
  return {schemaVersion:1,placeId:place.id,state:'unknown',reason,checkedAt:new Date(now).toISOString(),evidence:[],target:null};
}
// Spatial proximity is deliberately absent: topology comes from shared OSM node IDs.
export function buildAccessQuery(places) {
  if(!Array.isArray(places)||!places.length||places.length>ACCESS_LIMITS.places||places.some(p=>!osmID.test(p.id)))fail();
  const ids={node:[],way:[],relation:[]};
  for(const p of places){const [,type,id]=p.id.match(osmID);ids[type].push(id);}
  const select=Object.entries(ids).filter(([,v])=>v.length).map(([t,v])=>`${t}(id:${v.join(',')});`).join('');
  return `[out:json][timeout:7][maxsize:16777216];(${select})->.pois;(.pois;node(w.pois);)->.targets;way(bn.targets)[highway]->.paths;node(w.paths)->.junctions;way(bn.junctions)[highway]->.connections;(.pois;.targets;.paths;.junctions;.connections;);out meta geom ${ACCESS_LIMITS.elements};`;
}
function permission(tags={},activity) {
  const key=activity==='biking'?'bicycle':'foot';
  if(tags[`${key}:conditional`]||tags['access:conditional']||tags.highway==='construction'||tags.highway==='proposed')return 'unknown';
  const value=tags[key]??tags.access;
  if(denied.has(value))return 'excluded';
  if(tags.barrier&&!allowed.has(tags[key]))return 'unknown';
  return allowed.has(value)?'documented':'unknown';
}
export function assessAccess(places,payload,{activityType='hiking',now=Date.now()}={}) {
  buildAccessQuery(places);
  const snapshot=Date.parse(payload?.osm3s?.timestamp_osm_base);
  if(!Number.isFinite(snapshot)||snapshot>now+300000||now-snapshot>ACCESS_LIMITS.snapshotAgeMs||payload?.remark||
    !Array.isArray(payload?.elements)||payload.elements.length>=ACCESS_LIMITS.elements)fail();
  const records=new Map();
  for(const e of payload.elements) {
    if(!['node','way','relation'].includes(e?.type)||!Number.isSafeInteger(e.id)||e.id<=0||!Number.isSafeInteger(e.version)||e.version<1||
      !Number.isFinite(Date.parse(e.timestamp))||Date.parse(e.timestamp)>snapshot+300000)fail();
    if(e.type==='way'&&e.nodes!==undefined&&(!Array.isArray(e.nodes)||e.nodes.length>ACCESS_LIMITS.elements||e.nodes.some(id=>!Number.isSafeInteger(id)||id<=0)))fail();
    if(records.has(idOf(e)))fail();records.set(idOf(e),e);
  }
  const ways=[...records.values()].filter(e=>e.type==='way'&&e.tags?.highway&&Array.isArray(e.nodes)&&e.nodes.length>=2);
  const evidence=e=>({id:idOf(e),url:`https://www.openstreetmap.org/${e.type}/${e.id}`,version:e.version,
    updatedAt:e.timestamp,snapshotAt:new Date(snapshot).toISOString(),retrievedAt:new Date(now).toISOString(),
    nodeIds:e.type==='way'&&Array.isArray(e.nodes)&&e.nodes.length<=500?e.nodes:null,access:e.tags?.access??null,activityAccess:e.tags?.[activityType==='biking'?'bicycle':'foot']??null});
  return places.map(place=>{
    const result=unknownAccess(place,undefined,now),poi=records.get(place.id);
    if(!poi)return result;
    result.evidence=[evidence(poi)];
    if(place.source?.version&&poi.version!==place.source.version)return {...result,reason:'source_identity_changed'};
    if(permission(poi.tags,activityType)==='excluded')return {...result,state:'excluded',reason:'explicit_access_restriction'};
    if(poi.tags?.['access:conditional']||poi.tags?.[`${activityType==='biking'?'bicycle':'foot'}:conditional`])return {...result,reason:'conditional_access'};
    const targets=poi.type==='node'?[poi]:poi.type==='way'&&Array.isArray(poi.nodes)&&poi.nodes.length>=4&&poi.nodes[0]===poi.nodes.at(-1)&&poi.nodes.length<=500
      ?poi.nodes.map(id=>records.get(`osm:node:${id}`)).filter(e=>e&&e.tags?.entrance&&e.tags.entrance!=='no'):[];
    let restricted=false;
    for(const target of targets) {
      const point={latitude:target.lat,longitude:target.lon};
      if(!validCoordinate(point))continue;
      if(permission(target.tags,activityType)==='excluded'){restricted=true;continue;}
      // Entrance permission must itself be documented. A POI node on a way inherits no implied legal right;
      // the way below must explicitly carry the activity/access grant.
      if(poi.type==='node'&&target.tags?.barrier&&permission(target.tags,activityType)!=='documented')continue;
      if(idOf(target)!==idOf(poi)&&permission(target.tags,activityType)!=='documented')continue;
      const adjacent=ways.filter(w=>w.nodes.includes(target.id));
      if(adjacent.length&&adjacent.every(w=>permission(w.tags,activityType)==='excluded'))restricted=true;
      for(const path of adjacent.filter(w=>permission(w.tags,activityType)==='documented')) {
        const join=ways.find(w=>w.id!==path.id&&permission(w.tags,activityType)==='documented'&&
          w.nodes.some(n=>n!==target.id&&path.nodes.includes(n)));
        if(!join)continue;
        const blocked=path.nodes.map(id=>records.get(`osm:node:${id}`)).some(n=>n&&
          (permission(n.tags,activityType)==='excluded'||(n.tags?.barrier&&permission(n.tags,activityType)!=='documented')));
        if(blocked)continue;
        const entrance=idOf(target)!==idOf(poi);
        return {...result,state:'documented',reason:entrance?'mapped_entrance_connected':'mapped_point_connected',
          evidence:[...new Map([poi,target,path,join].map(e=>[idOf(e),evidence(e)])).values()],
          target:{kind:entrance?'entrance':'poi',osmId:idOf(target),coordinate:point,
            relationship:entrance?'entrance_node_on_poi_boundary':'same_osm_node',
            straightLineOffsetMeters:Math.round(distanceMeters(place.coordinate,point)),remainingWalkMeters:null,poiVisitConfirmed:false}};
      }
    }
    // Missing alternative entrances never prove that the entire attraction is inaccessible.
    return {...result,state:restricted&&poi.type==='node'?'excluded':'unknown',reason:restricted?'mapped_connection_restricted':'connection_not_documented'};
  });
}
export function createAccessLookup({fetchImpl=globalThis.fetch,userAgent,now=Date.now}={}) {
  if(!safeLabel(userAgent,200))throw new TypeError('research_configuration_missing');
  return async({places,activityType},{signal}={})=>{
    const data=await fetchBoundedJson({url:new URL('https://overpass-api.de/api/interpreter'),fetchImpl,signal,
      init:{method:'POST',headers:{Accept:'application/json','Content-Type':'application/x-www-form-urlencoded','User-Agent':userAgent},body:new URLSearchParams({data:buildAccessQuery(places)}).toString()},
      deadlineMs:ACCESS_LIMITS.timeoutMs,maximumAttempts:1,maximumResponseBytes:ACCESS_LIMITS.responseBytes,maximumErrorResponseBytes:8192,
      setTimeoutImpl:setTimeout,clearTimeoutImpl:clearTimeout});
    return assessAccess(places,data,{activityType,now:now()});
  };
}
