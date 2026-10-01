import {isDeepStrictEqual} from 'node:util';
import {validateWebResearchEnvelope} from './webResearch.js';
import {matchSourcePassage,sourceURL} from './sourceDocuments.js';

const fail=()=>{throw Object.assign(new TypeError('invalid_route_evidence'),{code:'invalid_route_evidence'});};
export function osmSourceURL(id) {
  if(typeof id!=='string'||!/^osm:(node|way|relation):[1-9][0-9]*$/.test(id))fail();
  return `https://www.openstreetmap.org/${id.slice(4).replace(':','/')}`;
}

/** Display-only provenance for this response. Conservative identity matching; no semantic truth or route-access inference.
 * A citation to the exact, successfully read OSM record attributes a passage to that
 * record. It does NOT prove that every statement in the passage describes that place.
 * Other pages require independently extracted identity plus a named source passage.
 */
export function reconcileRouteEvidence(web,{routeId,selectedPlaces,inspectedPlaces,sourceDocuments=[]}) {
  validateWebResearchEnvelope(web);
  if(typeof routeId!=='string'||!/^measured-[1-9][0-9]*$/.test(routeId)||
    !Array.isArray(selectedPlaces)||!selectedPlaces.length||selectedPlaces.length>3||
    !Array.isArray(inspectedPlaces)||inspectedPlaces.length>10)fail();
  if(!Array.isArray(sourceDocuments)||sourceDocuments.length>3)fail();
  for(const doc of sourceDocuments) {
    if(!sourceURL(doc?.url)||!sourceURL(doc?.requestedURL)||!Number.isFinite(Date.parse(doc.retrievedAt))||
      !Array.isArray(doc.entities)||doc.entities.length>30||!Array.isArray(doc.passages)||doc.passages.length>80||
      doc.passages.some(p=>typeof p.text!=='string'||p.text.length>1200||!Array.isArray(p.identityURLs))||
      doc.entities.some(e=>typeof e.name!=='string'||!Array.isArray(e.identityURLs)))fail();
  }
  const registry=new Map();
  for(const p of inspectedPlaces) {
    if(registry.has(p.id)||p.source?.provider!=='openstreetmap'||p.source.url!==osmSourceURL(p.id)||
      typeof p.name!=='string'||!p.name.trim()||p.name.length>180||/[\u0000-\u001f<>]/.test(p.name))fail();
    registry.set(p.id,p);
  }
  const selected=new Set();
  for(const p of selectedPlaces) {
    if(selected.has(p.id)||!registry.has(p.id)||!isDeepStrictEqual(p,registry.get(p.id)))fail();
    selected.add(p.id);
  }
  const places=[...selectedPlaces,...inspectedPlaces.filter(p=>!selected.has(p.id)).sort((a,b)=>a.id.localeCompare(b.id))]
    .map(p=>({placeId:p.id,name:p.name,sourceURL:p.source.url,selection:selected.has(p.id)?'selected':'excluded'}));
  const claims=web.blocks.flatMap((block,blockIndex)=>block.citations.map((citation,citationIndex)=>{
    const identity=web.retrievedSourceURLs.includes(citation.url)?places.find(p=>p.sourceURL===citation.url):null;
    if(identity)return {id:`b${blockIndex}-c${citationIndex}`,blockIndex,citationIndex,placeId:identity.placeId,relationship:'source_identity'};
    const documents=web.retrievedSourceURLs.includes(citation.url)?sourceDocuments.filter(d=>[d.url,d.requestedURL,d.canonicalURL].includes(citation.url)):[];
    const matches=inspectedPlaces.flatMap(place=>documents.map(d=>({place,...matchSourcePassage(d,place,block.text.slice(citation.startIndex,citation.endIndex))})).filter(m=>m.identityMethod));
    const ids=new Set(matches.map(m=>m.place.id)),match=ids.size===1?matches[0]:null;
    return {id:`b${blockIndex}-c${citationIndex}`,blockIndex,citationIndex,
      placeId:match?.place.id??null,relationship:match?'source_passage':'unconfirmed',
      ...(match?{identityMethod:match.identityMethod,sourcePassage:match.sourcePassage}:{})};
  }));
  return {schemaVersion:1,routeId,places,claims};
}

export function validateRouteEvidence(evidence,web,context) {
  if(!isDeepStrictEqual(evidence,reconcileRouteEvidence(web,context)))fail();
  return evidence;
}
