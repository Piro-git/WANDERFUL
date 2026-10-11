import {fetchBoundedJson} from '../llmPlanning/adapters/providerHttp.js';
import {REGIONAL_SOURCES,readRegionalSource} from './regionalConditions.js';
import {safeLabel} from './places.js';
import {CONDITION_LIMITS,conditionDate,intersectsBounds,validateNotice} from './localConditions.js';

const dwd={id:'dwd-warnings',name:'Deutscher Wetterdienst',authority:'official',url:'https://www.dwd.de/DE/wetter/warnungen_gemeinden/warnWetter_node.html',bounds:[5.5,47,15.6,55.2]};
const harz={id:'nationalpark-harz-paths',name:'Nationalpark Harz',authority:'official',url:'https://www.nationalpark-harz.de/de/startseite/Wegesperrungen_Aktuell/',bounds:[10.35,51.55,10.85,51.95]};
const harzEndpoint='https://services-eu1.arcgis.com/RI6KR4DmjUsvHdrR/arcgis/rest/services/wegeplan_2020_CM_Sicht_Sperrung_oeffentlich/FeatureServer/0/query';
function features(payload) {
  if(payload?.error||payload?.exceededTransferLimit||!Array.isArray(payload?.features)||payload.features.length>=CONDITION_LIMITS.notices)throw new TypeError('incomplete_local_source');
  return payload.features;
}
export function dwdQuery(area) {
  const url=new URL('https://maps.dwd.de/geoserver/wfs');
  url.search=new URLSearchParams({service:'WFS',version:'2.0.0',request:'GetFeature',typeNames:'dwd:Warnungen_Gemeinden',
    outputFormat:'application/json',srsName:'EPSG:4326',count:String(CONDITION_LIMITS.notices),
    bbox:`${area.join(',')},urn:ogc:def:crs:OGC:1.3:CRS84`,
    propertyName:'IDENTIFIER,SENT,STATUS,MSGTYPE,SCOPE,EVENT,HEADLINE,NAME,ONSET,EFFECTIVE,EXPIRES,THE_GEOM'}).toString();
  return url;
}
export function parseDWD(payload) {
  if(payload?.type!=='FeatureCollection'||Number(payload.numberMatched)>CONDITION_LIMITS.notices)throw new TypeError('incomplete_local_source');
  return features(payload).filter(f=>f.properties?.STATUS==='Actual'&&f.properties?.SCOPE==='Public').map(f=>{
    const p=f.properties;
    if(!safeLabel(p.IDENTIFIER,180))throw new TypeError('invalid_local_source');
    return {id:`dwd:${p.IDENTIFIER}`,eventId:p.IDENTIFIER,kind:'weather',title:safeLabel(p.HEADLINE)??safeLabel(p.EVENT)??'Official weather warning',
      areaLabel:safeLabel(p.NAME)??'DWD warning area',publishedAt:conditionDate(p.SENT),eventStart:conditionDate(p.ONSET),eventEnd:conditionDate(p.EXPIRES),
      temporalBasis:'explicit_interval',validFrom:conditionDate(p.EFFECTIVE??p.ONSET),validUntil:conditionDate(p.EXPIRES),status:p.MSGTYPE==='Cancel'?'revoked':p.MSGTYPE==='Alert'||p.MSGTYPE==='Update'?'active':'unknown',
      geometry:f.geometry,restrictionArea:false,action:'Read the official warning and review your departure time and plans.'};
  });
}
export function harzQuery(area) {
  const url=new URL(harzEndpoint);
  url.search=new URLSearchParams({f:'geojson',where:"Zustand IN ('Sperrung','Umleitung','temporär gesperrt','für Fahrzeugverkehr gesperrt')",geometry:area.join(','),geometryType:'esriGeometryEnvelope',inSR:'4326',outSR:'4326',
    spatialRel:'esriSpatialRelIntersects',outFields:'GlobalID,Name_neu,Zustand',orderByFields:'FID ASC',geometryPrecision:'5',returnGeometry:'true',resultRecordCount:String(CONDITION_LIMITS.notices)}).toString();
  return url;
}
export function parseHarz(payload) {
  if(payload?.type!=='FeatureCollection')throw new TypeError('invalid_local_source');
  return features(payload).filter(f=>f.properties?.Zustand!=null).map(f=>{
    const p=f.properties;
    if(!/^\{?[0-9a-f-]{36}\}?$/i.test(p?.GlobalID??''))throw new TypeError('invalid_local_source');
    const status=p.Zustand;
    if(!['Sperrung','Umleitung','temporär gesperrt','für Fahrzeugverkehr gesperrt'].includes(status))throw new TypeError('unknown_local_status');
    // No copying/caching free-form park prose. The published layer has no event/validity timestamps.
    return {id:`harz:${p.GlobalID}`,eventId:`harz:${p.GlobalID}`,kind:status==='Umleitung'?'access':'closure',
      title:status==='Umleitung'?'Mapped diversion':status==='für Fahrzeugverkehr gesperrt'?'Vehicle access restriction':'Mapped path restriction',
      areaLabel:safeLabel(p.Name_neu)??'Nationalpark Harz',publishedAt:null,eventStart:null,eventEnd:null,validFrom:null,validUntil:null,
      status:'unknown',temporalBasis:'maintained_listing',geometry:f.geometry,restrictionArea:false,action:'Open the park map for details and dates. Follow posted signs on site.'};
  });
}
export const OFFICIAL_CONDITION_SOURCES=Object.freeze([
  {...dwd,query:dwdQuery,parse:parseDWD}, {...harz,query:harzQuery,parse:parseHarz}, ...REGIONAL_SOURCES
]);

/** Reviewed registry entries only; source/model URLs never become fetch destinations.
 * Region names are display-only. Selection and source queries use bounded geography.
 */
export function createConditionLookup({fetchImpl=globalThis.fetch,userAgent,now=Date.now,sources=OFFICIAL_CONDITION_SOURCES}={}) {
  if(!safeLabel(userAgent,200)||!Array.isArray(sources)||sources.length>8)throw new TypeError('research_configuration_missing');
  return async({area},{signal,reserveSource=()=>true,unavailableSources=new Set()}={})=>{
    if(!Array.isArray(area)||area.length!==4||area.some(x=>!Number.isFinite(x))||area[0]>=area[2]||area[1]>=area[3]||area[2]-area[0]>5||area[3]-area[1]>3)throw new TypeError('invalid_condition_area');
    const checkedAt=new Date(now()).toISOString();
    const innsbruck=area[0]>=11.25&&area[2]<=11.5&&area[1]>=47.19&&area[3]<=47.36;
    const selected=sources.filter(s=>intersectsBounds(s.bounds,area)&&!(innsbruck&&s.id==='dwd-warnings')).slice(0,4);
    let calls=0;const reserve=()=>calls<CONDITION_LIMITS.sourceCalls&&reserveSource()&&(++calls>0);
    const results=await Promise.all(selected.map(async source=>{
      const display={id:source.id,name:source.name,url:source.url,authority:source.authority,checkedAt};
      if(unavailableSources.has(source.id))return {source:{...display,state:'unavailable',reason:'source_circuit_open'},notices:[]};
      if(!source.format&&!reserve())return {source:{...display,state:'unavailable',reason:'source_budget_exhausted'},notices:[]};
      try {
        if(source.format) {
          const result=await readRegionalSource(source,{area,checkedAt,fetchImpl,signal,reserveSource:reserve});
          return {source:{...display,state:'checked',reason:result.reason},notices:result.notices};
        }
        const data=await fetchBoundedJson({url:source.query(area),fetchImpl,signal,init:{headers:{Accept:'application/json','User-Agent':userAgent}},
          deadlineMs:CONDITION_LIMITS.timeoutMs,maximumAttempts:1,maximumResponseBytes:CONDITION_LIMITS.responseBytes,maximumErrorResponseBytes:8192,
          setTimeoutImpl:setTimeout,clearTimeoutImpl:clearTimeout});
        const notices=source.parse(data).map(n=>({...validateNotice(n,source),retrievedAt:checkedAt}));
        return {source:{...display,state:'checked',reason:source.id==='dwd-warnings'?'german_warning_areas_only':source.id==='nationalpark-harz-paths'?'dated_validity_unavailable':'bounded_source_only'},notices};
      } catch(error) {
        if(signal?.aborted)throw error;
        unavailableSources.add(source.id);
        return {source:{...display,state:'unavailable',reason:'source_unavailable_or_incomplete'},notices:[]};
      }
    }));
    const coverage=results.map(r=>r.source);
    // This is not a comprehensive closure/news search, including where weather data is available.
    if(innsbruck)coverage.push({id:'weather-coverage',name:'Austrian weather and avalanche warnings',url:null,authority:'unknown',checkedAt,state:'not_checked',reason:'no_reviewed_austrian_warning_adapter'});
    coverage.push({id:'regional-coverage',name:'Other local sources',url:null,authority:'unknown',checkedAt,state:'not_checked',reason:'no_reviewed_adapter'});
    const priority=n=>n.source.id==='harz-official-news'||n.source.id==='innsbruck-path-notices'?0:n.kind==='weather'?1:2;
    const all=results.flatMap(r=>r.notices).sort((a,b)=>priority(a)-priority(b));
    if(all.length>CONDITION_LIMITS.notices) {
      const omitted=new Set(all.slice(CONDITION_LIMITS.notices).map(n=>n.source.id));
      return {area,checkedAt,sources:coverage.map(s=>omitted.has(s.id)?{...s,reason:'partial_combined_notice_limit'}:s),notices:all.slice(0,CONDITION_LIMITS.notices)};
    }
    return {area,checkedAt,sources:coverage,notices:all};
  };
}
