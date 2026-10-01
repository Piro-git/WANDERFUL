import {publicSourceURL,publicFetch} from './publicSources.js';
import {safeLabel,validCoordinate,distanceMeters} from './places.js';

export const SOURCE_DOCUMENT_LIMITS=Object.freeze({calls:3,bytes:262144,timeoutMs:6000,passages:80,entities:30});
export const REVIEWED_SOURCE_HOSTS=Object.freeze(['www.nationalpark-harz.de','nationalpark-harz.de','www.innsbruck.gv.at','www.innsbruck.info','www.harzinfo.de','www.tirol.gv.at']);
export function sourceURL(value) {
  try {const u=new URL(value);return u.protocol==='https:'&&!u.port&&!u.username&&!u.password&&REVIEWED_SOURCE_HOSTS.includes(u.hostname)?u:null;}catch{return null;}
}
export function decodeHTML(text) {
  return text.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp|uuml|ouml|auml|Uuml|Ouml|Auml|szlig);/gi,(all,key)=>{
    const named={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' ',uuml:'ü',ouml:'ö',auml:'ä',Uuml:'Ü',Ouml:'Ö',Auml:'Ä',szlig:'ß'};
    if(key[0]!=='#')return named[key]??all;
    const n=key[1].toLowerCase()==='x'?parseInt(key.slice(2),16):Number(key.slice(1));
    return n>0&&n<=0x10ffff&&!(n>=0xd800&&n<=0xdfff)?String.fromCodePoint(n):'';
  });
}
export const plainHTML=html=>decodeHTML(html.replace(/<(script|style|nav|footer)\b[^>]*>[\s\S]*?<\/\1>/gi,' ').replace(/<[^>]*>/g,' ')).replace(/\s+/g,' ').trim();
export function htmlAttributes(tag) {
  const out={};for(const m of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g))out[m[1].toLowerCase()]=decodeHTML(m[2]??m[3]);return out;
}
export function identityURL(value) {
  try {const u=new URL(value);if(!['https:','http:'].includes(u.protocol)||u.username||u.password||u.port)return null;
    if(['openstreetmap.org','www.openstreetmap.org'].includes(u.hostname)&&/^\/(node|way|relation)\/[1-9]\d*\/?$/.test(u.pathname))return `https://www.openstreetmap.org${u.pathname.replace(/\/$/,'')}`;
    if(['wikidata.org','www.wikidata.org'].includes(u.hostname)&&/^\/(wiki|entity)\/Q[1-9]\d*$/.test(u.pathname))return `https://www.wikidata.org/wiki/${u.pathname.split('/').at(-1)}`;
  }catch{}return null;
}
export async function fetchSourceHTML(url,{fetchImpl=globalThis.fetch,signal,reserveSource=()=>true,generic=false,publicFetchImpl=publicFetch}={}) {
  const allowedURL=generic?publicSourceURL:sourceURL;
  const fetchPage=generic?publicFetchImpl:fetchImpl;
  let current=allowedURL(url);if(!current)throw new TypeError('unreviewed_source');
  const controller=new AbortController(),abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  const timer=setTimeout(abort,SOURCE_DOCUMENT_LIMITS.timeoutMs);
  let cancel;
  const cancelled=new Promise((_,reject)=>{cancel=()=>reject(new Error('source_cancelled_or_timed_out'));controller.signal.addEventListener('abort',cancel,{once:true});if(controller.signal.aborted)cancel();});
  const operation=(async()=>{
    for(let redirect=0;redirect<=1;redirect++) {
      if(controller.signal.aborted)throw new Error('source_cancelled_or_timed_out');
      if(!reserveSource())throw new Error('source_budget_exhausted');
      const r=await fetchPage(current,{redirect:'manual',signal:controller.signal,headers:{Accept:'text/html','User-Agent':'Wanderful official source check/1.0'}});
      if(r.redirected)throw new TypeError('unobserved_redirect');
      if(r.status>=300&&r.status<400) {
        await r.body?.cancel();const next=allowedURL(new URL(r.headers.get('location'),current).href);
        if(redirect===1||!next||next.hostname!==current.hostname)throw new TypeError('source_redirect_rejected');current=next;continue;
      }
      if(!r.ok||!/^text\/html(?:;|$)/i.test(r.headers.get('content-type')??'')){await r.body?.cancel();throw new TypeError('invalid_source_response');}
      if(Number(r.headers.get('content-length'))>SOURCE_DOCUMENT_LIMITS.bytes){await r.body?.cancel();throw new TypeError('source_size_limit');}
      const reader=r.body?.getReader();if(!reader)throw new TypeError('invalid_source_response');
      const chunks=[];let length=0;
      try {while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>SOURCE_DOCUMENT_LIMITS.bytes)throw new TypeError('source_size_limit');chunks.push(value);}}
      finally {await reader.cancel().catch(()=>{});reader.releaseLock();}
      return {html:new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)),url:current.href};
    }
  })();
  try{return await Promise.race([operation,cancelled]);}finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);controller.signal.removeEventListener('abort',cancel);controller.abort();}
}
export function parseSourceDocument(html,{url,requestedURL=url,retrievedAt,generic=false}) {
  if(typeof html!=='string'||Buffer.byteLength(html)>SOURCE_DOCUMENT_LIMITS.bytes||!(generic?publicSourceURL:sourceURL)(url)||!(generic?publicSourceURL:sourceURL)(requestedURL)||!Number.isFinite(Date.parse(retrievedAt)))throw new TypeError('invalid_source_document');
  const canonicalTag=[...html.matchAll(/<link\b[^>]*>/gi)].map(m=>htmlAttributes(m[0])).find(a=>a.rel==='canonical');
  let canonicalURL=null;try{const c=(generic?publicSourceURL:sourceURL)(new URL(canonicalTag?.href,url).href);if(c&&c.hostname===new URL(url).hostname)canonicalURL=c.href;}catch{}
  const entities=[];
  const visit=(node,depth=0)=>{
    if(!node||typeof node!=='object'||depth>8||entities.length>=SOURCE_DOCUMENT_LIMITS.entities)return;
    if(Array.isArray(node)){node.slice(0,60).forEach(n=>visit(n,depth+1));return;}
    const types=[node['@type']].flat();
    if(types.some(t=>['Place','TouristAttraction','LandmarksOrHistoricalBuildings','Mountain','LakeBodyOfWater','Park'].includes(t))&&safeLabel(node.name)) {
      const lat=node.geo?.latitude,lon=node.geo?.longitude;
      const coordinate={latitude:typeof lat==='string'&&lat.trim()?Number(lat):lat,longitude:typeof lon==='string'&&lon.trim()?Number(lon):lon};
      const identityURLs=[node.sameAs,node['@id'],node.url].flat(2).map(identityURL).filter(Boolean);
      entities.push({name:node.name,coordinate:validCoordinate(coordinate)?coordinate:null,identityURLs});
    }
    for(const key of ['@graph','mainEntity','about','hasPart','itemListElement','item'])visit(node[key],depth+1);
  };
  for(const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi))if(htmlAttributes(m[1]).type==='application/ld+json')try{visit(JSON.parse(m[2]));}catch{}
  const body=html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1]??html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1]??html;
  const clean=body.replace(/<(script|style|nav|footer)\b[^>]*>[\s\S]*?<\/\1>/gi,'');
  const passages=[...clean.matchAll(/<(p|li)\b[^>]*>([\s\S]*?)<\/\1>/gi)].map(m=>({text:plainHTML(m[2]),identityURLs:[...m[2].matchAll(/<a\b[^>]*>/gi)].map(a=>identityURL(htmlAttributes(a[0]).href)).filter(Boolean)}))
    .filter(p=>p.text.length>=12&&p.text.length<=1200).slice(0,SOURCE_DOCUMENT_LIMITS.passages);
  const title=plainHTML(html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1]??html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]??'').slice(0,180);
  const metadata=[...html.matchAll(/<meta\b[^>]*>/gi)].map(m=>htmlAttributes(m[0])).filter(a=>/date|time|author|site_name|geo\./i.test(a.name??a.property??'')).slice(0,30);
  return {url,requestedURL,canonicalURL,retrievedAt,title,metadata,entities,passages};
}
const normalized=s=>s.normalize('NFC').toLocaleLowerCase('de-DE').replace(/\s+/g,' ').trim();
export function mentionsName(text,name) {
  const hay=normalized(text),needle=normalized(name);let at=hay.indexOf(needle);
  while(at>=0){const before=hay.slice(0,at).at(-1),after=hay[at+needle.length];if(!/[\p{L}\p{N}]/u.test(before??'')&&!/[\p{L}\p{N}]/u.test(after??''))return true;at=hay.indexOf(needle,at+1);}return false;
}
export function matchSourcePassage(document,place,citationText) {
  if(!mentionsName(citationText,place.name))return null;
  const expected=[place.source.url,place.wikidataId?`https://www.wikidata.org/wiki/${place.wikidataId}`:null].filter(Boolean);
  const entities=document.entities.filter(e=>normalized(e.name)===normalized(place.name));
  // Conflicting structured coordinates defeat even same-name declarations.
  if(entities.some(e=>e.coordinate&&validCoordinate(place.coordinate)&&distanceMeters(e.coordinate,place.coordinate)>150))return null;
  for(const passage of document.passages) {
    if(!mentionsName(passage.text,place.name))continue;
    const linked=passage.identityURLs.some(u=>expected.includes(u));
    const stable=entities.some(e=>e.identityURLs.some(u=>expected.includes(u)));
    const geo=entities.some(e=>e.coordinate&&validCoordinate(place.coordinate)&&distanceMeters(e.coordinate,place.coordinate)<=100);
    if(linked||stable||geo)return {identityMethod:linked||stable?'stable_reference':'structured_name_coordinate',sourcePassage:{url:document.url,text:passage.text,retrievedAt:document.retrievedAt}};
  }return null;
}
export function createSourceDocumentLookup({fetchImpl=globalThis.fetch,userAgent,now=Date.now,publicFetchImpl=publicFetch}={}) {
  if(!safeLabel(userAgent,200))throw new TypeError('research_configuration_missing');
  return async({web,places},{signal,reserveSource=()=>true}={})=>{
    if(!Array.isArray(places)||places.length>10)throw new TypeError('invalid_route_evidence');
    let calls=0;const documents=[],sources=[];
    const urls=[...new Set(web.blocks.flatMap(b=>b.citations.filter(c=>places.some(p=>mentionsName(b.text.slice(c.startIndex,c.endIndex),p.name))).map(c=>c.url)))];
    for(const url of urls.slice(0,20)) {
      if(!web.retrievedSourceURLs.includes(url)||!publicSourceURL(url)){sources.push({url,state:'not_checked',reason:'unread_or_unreviewed_source'});continue;}
      try {
        const fetched=await fetchSourceHTML(url,{fetchImpl,signal,generic:!sourceURL(url),publicFetchImpl,reserveSource:()=>calls<SOURCE_DOCUMENT_LIMITS.calls&&reserveSource()&&(++calls>0)});
        documents.push(parseSourceDocument(fetched.html,{url:fetched.url,requestedURL:url,retrievedAt:new Date(now()).toISOString(),generic:true}));sources.push({url,state:'checked'});
      }catch(error){if(signal?.aborted)throw error;sources.push({url,state:'unavailable',reason:calls>=SOURCE_DOCUMENT_LIMITS.calls?'source_budget_exhausted':'source_unavailable_or_invalid'});}
    }
    return {documents,sources};
  };
}
