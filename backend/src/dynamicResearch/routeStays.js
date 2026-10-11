import {createHash} from 'node:crypto';
import {distanceMeters, validCoordinate} from './places.js';

export const STAY_KINDS = Object.freeze(['alpine_hut', 'wilderness_hut', 'campsite', 'emergency_shelter']);
export const STAY_LIMITS = Object.freeze({maximumOffsetMeters: 2000, maximumCandidates: 12, timeoutMs: 2500});

// This only reveals optional evidence. It never changes intent, route geometry or overnight permission.
export function wantsRouteStays(prompt) {
  if (typeof prompt !== 'string') return false;
  if (/\b(?:no overnight|without overnight|ohne übernachtung|tageswanderung)\b/iu.test(prompt)) return false;
  return /(?:^|[^\p{L}\p{N}])(?:overnight|multi[ -]?day|mehrtägig\w*|mehrtagestour\w*|übernachten|übernachtung\w*|hüttentour|hut[ -]to[ -]hut|camping|zeltplatz|zeltplätze|[2-9][ -]*(?:days?|tage|tagen)|two[ -]day|three[ -]day|zwei tage|drei tage)(?=$|[^\p{L}\p{N}])/iu.test(prompt);
}

export function geometryDigest(coordinates) {
  return createHash('sha256').update(coordinates.map(p=>p.slice(0,2).map(value=>Math.round((value+180)*1e6)).join(',')).join(';')).digest('hex');
}
const point = p => ({longitude: p[0], latitude: p[1]});
const wrap = degrees => ((degrees + 540) % 360) - 180;
// Halfway by cumulative geometry length, independent of provider vertex density.
// Interpolate on the containing spherical segment, including the date line.
export function pathMidpoint(coordinates) {
  const lengths=coordinates.slice(1).map((coordinate,index)=>distanceMeters(point(coordinates[index]),point(coordinate)));
  const total=lengths.reduce((sum,length)=>sum+length,0);
  if(total===0)return point(coordinates[0]);
  let remaining=total/2;
  for(let index=0;index<lengths.length;index++) {
    const length=lengths[index];
    if(length===0)continue;
    if(remaining>length){remaining-=length;continue;}
    const a=point(coordinates[index]),b=point(coordinates[index+1]);
    const rad=Math.PI/180,phi=a.latitude*rad,lambda=a.longitude*rad,delta=remaining/6371000;
    const longitudeDelta=wrap(b.longitude-a.longitude)*rad;
    const bearing=Math.atan2(Math.sin(longitudeDelta)*Math.cos(b.latitude*rad),
      Math.cos(phi)*Math.sin(b.latitude*rad)-Math.sin(phi)*Math.cos(b.latitude*rad)*Math.cos(longitudeDelta));
    const latitude=Math.asin(Math.max(-1,Math.min(1,Math.sin(phi)*Math.cos(delta)+Math.cos(phi)*Math.sin(delta)*Math.cos(bearing))));
    const longitude=lambda+Math.atan2(Math.sin(bearing)*Math.sin(delta)*Math.cos(phi),Math.cos(delta)-Math.sin(phi)*Math.sin(latitude));
    return {latitude:latitude/rad,longitude:wrap(longitude/rad)};
  }
  return point(coordinates.at(-1));
}

// Spherical cross-track projection onto each finite great-circle segment, including the date line.
export function distanceToPathMeters(coordinate, coordinates) {
  const rad = Math.PI / 180, radius = 6371000;
  const bearing = (a,b) => Math.atan2(Math.sin(wrap(b.longitude-a.longitude)*rad)*Math.cos(b.latitude*rad),
    Math.cos(a.latitude*rad)*Math.sin(b.latitude*rad)-Math.sin(a.latitude*rad)*Math.cos(b.latitude*rad)*Math.cos(wrap(b.longitude-a.longitude)*rad));
  let closest = Infinity;
  for (let i=1; i<coordinates.length; i++) {
    const a=point(coordinates[i-1]), b=point(coordinates[i]);
    const length=distanceMeters(a,b), delta=distanceMeters(a,coordinate)/radius;
    const angle=bearing(a,coordinate)-bearing(a,b);
    const along=Math.atan2(Math.sin(delta)*Math.cos(angle),Math.cos(delta))*radius;
    const cross=Math.abs(Math.asin(Math.max(-1,Math.min(1,Math.sin(delta)*Math.sin(angle))))*radius);
    closest=Math.min(closest, along>=0 && along<=length ? cross : Math.min(distanceMeters(a,coordinate),distanceMeters(b,coordinate)));
  }
  return closest;
}

export function selectRouteStays(records, coordinates) {
  const admitted=[];
  for (const place of records) {
    if (!STAY_KINDS.includes(place.category)||!validCoordinate(place.coordinate)||!place.stayIdentity) continue;
    const offset=distanceToPathMeters(place.coordinate,coordinates);
    if (offset>STAY_LIMITS.maximumOffsetMeters) continue;
    admitted.push({id:place.id, name:place.name, category:place.category, coordinate:place.coordinate,
      coordinateKind:place.coordinateKind, source:place.source, ...place.stayIdentity,
      straightLineDistanceToPathMeters:Math.round(offset)});
  }
  // Preserve a source identity; do not merge nearby places just because their names are missing.
  const seen=new Set(), result=[];
  for (const candidate of admitted.sort((a,b)=>a.straightLineDistanceToPathMeters-b.straightLineDistanceToPathMeters||a.id.localeCompare(b.id))) {
    if (seen.has(candidate.id)) continue;
    seen.add(candidate.id);
    if (result.some(other=>other.category===candidate.category && other.nameKnown && candidate.nameKnown &&
      other.name.normalize('NFKC').toLocaleLowerCase('en')===candidate.name.normalize('NFKC').toLocaleLowerCase('en') &&
      distanceMeters(other.coordinate,candidate.coordinate)<=50)) continue;
    result.push(candidate);
  }
  return result.slice(0,STAY_LIMITS.maximumCandidates);
}

/** Optional, bounded enrichment inside the existing search allowance. Always a partial inventory.
 * Source failure does not discard a verified route; caller cancellation still propagates.
 */
export async function researchRouteStays({coordinates, search, signal, now=Date.now}) {
  if (!Array.isArray(coordinates)||coordinates.length<2||coordinates.length>20000||coordinates.some(p=>!Array.isArray(p)||!validCoordinate(point(p)))) return null;
  const base={schemaVersion:1,geometryDigest:geometryDigest(coordinates),checkedAt:new Date(now()).toISOString(),
    coverage:'partial',maximumOffsetMeters:STAY_LIMITS.maximumOffsetMeters,candidates:[]};
  if (!search) return {...base,state:'unavailable'};
  const controller=new AbortController();
  const abort=()=>controller.abort();
  signal?.addEventListener('abort',abort,{once:true});
  if(signal?.aborted)abort();
  let timer, rejectAbort;
  try {
    const unavailable=new Promise((_,reject)=>{
      rejectAbort=()=>reject(new Error('stay_lookup_unavailable'));
      controller.signal.addEventListener('abort',rejectAbort,{once:true});
      timer=setTimeout(abort,STAY_LIMITS.timeoutMs);
      if(controller.signal.aborted)rejectAbort();
    });
    // One bounded area around a point ON the accepted route. No region or private-location defaults.
    // Search limits and filtering mean empty never means "no accommodation exists".
    const anchor=pathMidpoint(coordinates);
    const records=await Promise.race([Promise.resolve().then(()=> {
      if(controller.signal.aborted)throw new Error('stay_lookup_unavailable');
      return search({anchor,radiusMeters:20000,kinds:[...STAY_KINDS]},{signal:controller.signal});
    }),unavailable]);
    if (!Array.isArray(records)||records.length>80) throw new Error('invalid_stay_evidence');
    const candidates=selectRouteStays(records,coordinates);
    return {...base,state:candidates.length?'available':'empty',candidates};
  } catch {
    if(signal?.aborted)throw Object.assign(new Error('request_cancelled'),{code:'request_cancelled'});
    return {...base,state:'unavailable'};
  } finally {
    clearTimeout(timer);controller.signal.removeEventListener('abort',rejectAbort);
    signal?.removeEventListener('abort',abort);controller.abort();
  }
}
