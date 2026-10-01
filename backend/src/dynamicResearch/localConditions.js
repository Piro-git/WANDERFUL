import {validCoordinate,safeLabel} from './places.js';

export const CONDITION_LIMITS=Object.freeze({sourceCalls:4,notices:40,vertices:6000,timeoutMs:6000,responseBytes:262144,maxAgeMs:6*3600000,refreshMs:3600000});
export const instant=x=>typeof x==='string'&&/T.*(Z|[+-]\d\d:\d\d)$/.test(x)&&Number.isFinite(Date.parse(x))?Date.parse(x):null;
export const conditionDate=x=>instant(x)===null?null:new Date(instant(x)).toISOString();
export const safeSourceURL=value=>{try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port?u.href:null;}catch{return null;}};
export function boundsFor(points,padding=0.01) {
  if(!Array.isArray(points)||!points.length||points.length>100000||points.some(p=>!validCoordinate(p)))throw new TypeError('invalid_condition_area');
  let west=180,south=90,east=-180,north=-90;
  for(const p of points){west=Math.min(west,p.longitude);east=Math.max(east,p.longitude);south=Math.min(south,p.latitude);north=Math.max(north,p.latitude);}
  return [Math.max(-180,west-padding),Math.max(-90,south-padding),Math.min(180,east+padding),Math.min(90,north+padding)];
}
export const intersectsBounds=(a,b)=>a[0]<=b[2]&&a[2]>=b[0]&&a[1]<=b[3]&&a[3]>=b[1];
export const containsBounds=(a,b)=>a[0]<=b[0]&&a[1]<=b[1]&&a[2]>=b[2]&&a[3]>=b[3];
const coordinate=p=>Array.isArray(p)&&p.length>=2&&validCoordinate({longitude:p[0],latitude:p[1]});
function geometryLines(g) {
  return g?.type==='MultiPolygon'?g.coordinates?.flat():g?.type==='LineString'?[g.coordinates]:g?.coordinates;
}
export function geometryValid(g) {
  if(!g||!['Polygon','MultiPolygon','LineString','MultiLineString'].includes(g.type))return false;
  const lines=geometryLines(g);
  return Array.isArray(lines)&&lines.length>0&&lines.every(line=>Array.isArray(line)&&line.length>=2&&line.every(coordinate)&&(!g.type.includes('Polygon')||(line.length>=4&&line[0][0]===line.at(-1)[0]&&line[0][1]===line.at(-1)[1])))&&lines.reduce((n,l)=>n+l.length,0)<=CONDITION_LIMITS.vertices;
}
function segments(line){return line.slice(1).map((b,i)=>[line[i],b]);}
function cross(a,b,c){return (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);}
function crosses(a,b,c,d){return cross(a,b,c)*cross(a,b,d)<0&&cross(c,d,a)*cross(c,d,b)<0;}
function inside(p,ring) {
  let yes=false;
  for(let i=0,j=ring.length-1;i<ring.length;j=i++) {
    const a=ring[i],b=ring[j];
    if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])yes=!yes;
  }
  return yes;
}
export function spatialMatch(geometry,path,area) {
  if(!geometryValid(geometry))return 'unknown';
  const bbox=boundsFor(geometryLines(geometry).flat().map(p=>({longitude:p[0],latitude:p[1]})),0);
  if(!intersectsBounds(bbox,area))return 'outside';
  if(!path?.length)return 'area';
  if(path.length*geometryLines(geometry).reduce((n,l)=>n+l.length,0)>2000000)return 'unknown';
  const polygons=geometry.type==='Polygon'?[geometry.coordinates]:geometry.type==='MultiPolygon'?geometry.coordinates:[];
  const routeSegments=segments(path);
  for(const rings of polygons) {
    if(path.some(p=>inside(p,rings[0])&&!rings.slice(1).some(h=>inside(p,h))))return 'route';
    if(segments(rings[0]).some(([a,b])=>routeSegments.some(([c,d])=>crosses(a,b,c,d))))return 'route';
  }
  // Lines can cross at bridges or run beside a route. No identity/access inference from proximity.
  return 'area';
}
export function validateNotice(n,source) {
  if(!n||!safeLabel(n.id,240)||!safeLabel(n.eventId,240)||!safeLabel(n.title,180)||!safeLabel(n.areaLabel,180)||
    !['closure','weather','fire','flood','access','transport'].includes(n.kind)||!['active','revoked','unknown'].includes(n.status)||
    !safeLabel(n.action,300)||!source||!safeSourceURL(source.url)||!safeLabel(source.id)||!safeLabel(source.name)||
    !['official','local_news'].includes(source.authority))throw new TypeError('invalid_local_notice');
  for(const key of ['publishedAt','sourceUpdatedAt','eventStart','eventEnd','validFrom','validUntil'])if(n[key]!=null&&instant(n[key])===null)throw new TypeError('invalid_local_notice');
  if(n.validFrom&&n.validUntil&&instant(n.validUntil)<=instant(n.validFrom))throw new TypeError('invalid_local_notice');
  if(n.temporalBasis!=null&&!['explicit_interval','until_revoked','maintained_listing','publication_only'].includes(n.temporalBasis))throw new TypeError('invalid_local_notice');
  if(n.sourceExcerpt!=null&&(typeof n.sourceExcerpt!=='string'||n.sourceExcerpt.length>600||/[\u0000-\u001f<>]/.test(n.sourceExcerpt)))throw new TypeError('invalid_local_notice');
  if(n.areaBounds!=null&&(!Array.isArray(n.areaBounds)||n.areaBounds.length!==4||n.areaBounds.some(x=>!Number.isFinite(x))||n.areaBounds[0]>=n.areaBounds[2]||n.areaBounds[1]>=n.areaBounds[3]))throw new TypeError('invalid_local_notice');
  if(n.geometry!=null&&!geometryValid(n.geometry))throw new TypeError('invalid_local_notice');
  return {...n,source:{id:source.id,name:source.name,url:source.url,authority:source.authority},restrictionArea:n.restrictionArea===true&&source.authority==='official',
    publishedAt:n.publishedAt??null,eventStart:n.eventStart??null,eventEnd:n.eventEnd??null,validFrom:n.validFrom??null,validUntil:n.validUntil??null};
}
export function evaluateConditions(snapshot,{path=null,area=snapshot.area,visitTime=null,now=Date.now(),maxAgeMs=CONDITION_LIMITS.maxAgeMs}={}) {
  const target=visitTime==null?now:instant(visitTime);
  if(target===null||!Number.isInteger(maxAgeMs)||maxAgeMs<1||maxAgeMs>7*86400000)throw new TypeError('invalid_condition_time');
  const groups=new Map();
  for(const n of snapshot.notices) {
    const key=`${n.source.id}:${n.eventId}`,prior=groups.get(key);
    if(!prior)groups.set(key,n);
    else if(instant(n.publishedAt)!==null&&(instant(prior.publishedAt)===null||instant(n.publishedAt)>instant(prior.publishedAt)))groups.set(key,n);
    else if(instant(n.publishedAt)===instant(prior.publishedAt)) {
      if(n.status!==prior.status||n.validFrom!==prior.validFrom||n.validUntil!==prior.validUntil)groups.set(key,{...prior,conflict:true});
      else if(n.geometry&&prior.geometry&&JSON.stringify(n.geometry)!==JSON.stringify(prior.geometry)) {
        const polygons=g=>g.type==='Polygon'?[g.coordinates]:g.type==='MultiPolygon'?g.coordinates:[];
        const merged={type:'MultiPolygon',coordinates:[...polygons(prior.geometry),...polygons(n.geometry)]};
        groups.set(key,{...prior,geometry:geometryValid(merged)?merged:null,areaLabel:'Multiple reported areas'});
      }
    }
  }
  const notices=[...groups.values()].map(n=>{
    const fetched=instant(n.retrievedAt),published=instant(n.publishedAt),from=instant(n.validFrom),until=instant(n.validUntil);
    const retrievalFresh=fetched!==null&&fetched<=now+300000&&now-fetched<=maxAgeMs;
    const temporalBasis=n.temporalBasis??'publication_only';
    const publicationFresh=published!==null&&published<=now+300000&&now-published<=maxAgeMs;
    const officialCurrent=n.source.authority==='official'&&['explicit_interval','until_revoked','maintained_listing'].includes(temporalBasis)&&
      (published===null||published<=now+300000)&&(instant(n.sourceUpdatedAt)===null||instant(n.sourceUpdatedAt)<=now+300000);
    const fresh=retrievalFresh&&(publicationFresh||officialCurrent);
    const ongoingNow=officialCurrent&&temporalBasis==='until_revoked'&&target>=now-300000&&target<=now+86400000;
    const conflicts=n.conflict||[...groups.values()].some(other=>other.source.id!==n.source.id&&other.eventId===n.eventId&&other.status!==n.status);
    const validity=conflicts?'conflicting':n.status==='revoked'?'revoked':until!==null&&until<=target?'expired':
      !retrievalFresh?'stale':!fresh?(published===null?'unknown':'stale'):n.status==='unknown'?'unknown':ongoingNow?'active':from===null||until===null?'unknown':from>target?'future':'active';
    const spatial=n.areaBounds&&!intersectsBounds(n.areaBounds,area)?'outside':n.geometry?spatialMatch(n.geometry,path,area):n.areaBounds?'area':'unknown';
    const blocksRoute=validity==='active'&&spatial==='route'&&n.restrictionArea&&['closure','access'].includes(n.kind);
    const {geometry,restrictionArea,conflict,...display}=n;
    return {...display,validity,spatial,blocksRoute,freshness:retrievalFresh?'fresh':fetched===null?'unknown':'stale',temporalBasis};
  }).filter(n=>n.spatial!=='outside');
  if(notices.length>CONDITION_LIMITS.notices)throw Object.assign(new Error('research_history_limit'),{code:'research_history_limit'});
  return {schemaVersion:1,checkedAt:snapshot.checkedAt,expiresAt:new Date(instant(snapshot.checkedAt)+CONDITION_LIMITS.refreshMs).toISOString(),
    visitTime,scope:path?'route_corridor':'area',coverage:'partial',sources:snapshot.sources,notices,
    ...(snapshot.researchEvidence?{researchEvidence:snapshot.researchEvidence}:{}),
    blockingNoticeIds:notices.filter(n=>n.blocksRoute).map(n=>n.id),
    limitations:[...(snapshot.limitations??[]),'Only the listed sources were checked. No report does not mean paths are open or safe.',
      visitTime?'Information may change before your planned start.':'Current information only; no hiking date was provided.']};
}

// Empty or failed subsequent reads are not revocations. Keep original timestamps and references.
export function mergeConditionSnapshots(previous,next) {
  const notices=[...previous.notices,...next.notices];
  if(notices.length>80)throw Object.assign(new Error('research_history_limit'),{code:'research_history_limit'});
  const sources=[...new Map([...previous.sources,...next.sources].map(s=>[s.id,s])).values()];
  return {...next,sources,notices,...((next.researchEvidence??previous.researchEvidence)?{researchEvidence:next.researchEvidence??previous.researchEvidence}:{}),limitations:[...new Set([...(previous.limitations??[]),...(next.limitations??[])])]};
}
