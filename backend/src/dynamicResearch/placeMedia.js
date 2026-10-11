import {fetchBoundedJson} from '../llmPlanning/adapters/providerHttp.js';
import {distanceMeters,safeLabel,validCoordinate} from './places.js';

const QID=/^Q[1-9][0-9]{0,15}$/;
const supportedLicenses=new Map([
  ['CC0','https://creativecommons.org/publicdomain/zero/1.0/'],
  ['CC BY 4.0','https://creativecommons.org/licenses/by/4.0/'],
  ['CC BY-SA 4.0','https://creativecommons.org/licenses/by-sa/4.0/'],
  ['CC BY 3.0','https://creativecommons.org/licenses/by/3.0/'],
  ['CC BY-SA 3.0','https://creativecommons.org/licenses/by-sa/3.0/']
]);
const claims=(entity,property)=>Array.isArray(entity.claims?.[property])?entity.claims[property].filter(c=>c&&c.rank!=='deprecated'&&c.mainsnak?.snaktype==='value').map(c=>c.mainsnak.datavalue?.value):[];
const fileName=value=>safeLabel(value,240)&&!/^(?:File|Category):/i.test(value)&&!/[\\/]|\.\.|[\u0000-\u001f|{}[\]]/.test(value)?value:null;
// Conservative plain-text extraction. Ambiguous markup/entities cause omission, never HTML rendering.
function plainCredit(value) {
  if(typeof value!=='string'||value.length>4000||/<\s*(script|style|iframe)\b/i.test(value))return null;
  const text=value.replace(/<[^>]*>/g,' ').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&nbsp;/g,' ').replace(/\s+/g,' ').trim();
  if(/&(?:[a-z]+|#[^;]+);/i.test(text))return null;
  return safeLabel(text,500);
}
export function linkedWikidataEvidence(payload,place) {
  if(!QID.test(place?.wikidataId??''))return null;
  const entity=payload?.entities?.[place.wikidataId];
  if(entity?.id!==place.wikidataId||entity.type!=='item')return null;
  const locations=claims(entity,'P625');
  if(locations.length!==1||locations[0]?.globe!=='http://www.wikidata.org/entity/Q2'||
    !validCoordinate(locations[0])||distanceMeters(place.coordinate,locations[0])>250)return null;
  const images=claims(entity,'P18');
  const file=images.length===1?fileName(images[0]):null;
  return {id:entity.id,sourceURL:`https://www.wikidata.org/wiki/${entity.id}`,license:'CC0',
    imageFile:file};
}
export function directOsmCommonsEvidence(place) {
  const file=fileName(place?.commonsFile);
  if(!file||!validCoordinate(place?.coordinate)||typeof place?.id!=='string')return null;
  let sourceURL;
  try { sourceURL=new URL(place?.source?.url); } catch { return null; }
  if(sourceURL.protocol!=='https:'||sourceURL.hostname!=='www.openstreetmap.org'||
    sourceURL.href!==`https://www.openstreetmap.org/${place.id.slice(4).replace(':','/')}`)return null;
  return {id:place.id,sourceURL:sourceURL.href,license:'ODbL-1.0',imageFile:file};
}
export function licensedCommonsPhoto(payload,evidence) {
  if(!evidence?.imageFile)return null;
  const pages=payload?.query?.pages;
  const list=Array.isArray(pages)?pages:Object.values(pages??{});
  // No redirects, fuzzy filename search or cross-place substitution.
  if(list.length!==1)return null;
  const page=list[0];
  if(page.title?.replaceAll('_',' ')!==`File:${evidence.imageFile}`.replaceAll('_',' ')||page.missing!==undefined||page.imageinfo?.length!==1)return null;
  const info=page.imageinfo[0],meta=info.extmetadata;
  const license=supportedLicenses.get(meta?.LicenseShortName?.value);
  const rawLicense=meta?.LicenseUrl?.value;
  if(!license||typeof rawLicense!=='string')return null;
  let licenseURL;
  try{licenseURL=new URL(rawLicense.startsWith('//')?`https:${rawLicense}`:rawLicense);}catch{return null;}
  if(licenseURL.href.replace(/^http:/,'https:').replace(/\/?$/,'/')!==license)return null;
  const credit=meta.Attribution?.value ? plainCredit(meta.Attribution.value) : plainCredit(meta.Artist?.value);
  if(!credit||!['image/jpeg','image/png','image/webp'].includes(info.mime)||!['image/jpeg','image/png','image/webp'].includes(info.thumbmime??info.mime))return null;
  let url;
  try{url=new URL(info.thumburl);}catch{return null;}
  if(url.protocol!=='https:'||!['upload.wikimedia.org','thumb.wikimedia.org'].includes(url.hostname)||!url.pathname.startsWith('/wikipedia/commons/')||url.username||url.password||url.hash)return null;
  let parts;
  try{parts=decodeURIComponent(url.pathname).split('/');}catch{return null;}
  const mediaFile=parts.includes('thumb')?parts.at(-2):parts.at(-1);
  if(mediaFile?.replaceAll('_',' ')!==evidence.imageFile.replaceAll('_',' '))return null;
  return {url:url.href,sourceURL:`https://commons.wikimedia.org/wiki/${encodeURIComponent(page.title)}`,
    license:meta.LicenseShortName.value,licenseURL:license,credit,placeSourceURL:evidence.sourceURL};
}
export function createLinkedPlaceReader({fetchImpl=globalThis.fetch,userAgent}) {
  if(!safeLabel(userAgent,200))throw new TypeError('research_configuration_missing');
  const fetchJSON=(url,signal)=>fetchBoundedJson({url,fetchImpl,signal,
    init:{headers:{Accept:'application/json','User-Agent':userAgent}},deadlineMs:5000,maximumAttempts:1,
    maximumResponseBytes:262144,maximumErrorResponseBytes:8192,setTimeoutImpl:setTimeout,clearTimeoutImpl:clearTimeout});
  return {
    // Optional media metadata, never a prerequisite for inspecting mapped evidence.
    async enrich(place,{signal}={}) {
      const direct=directOsmCommonsEvidence(place);
      if(!QID.test(place?.wikidataId??''))return direct;
      try {
        const payload=await fetchJSON(new URL(`https://www.wikidata.org/wiki/Special:EntityData/${place.wikidataId}.json`),signal);
        const linked=linkedWikidataEvidence(payload,place);
        return linked?.imageFile ? linked : direct;
      } catch(error) { if(direct)return direct; throw error; }
    },
    async photo(evidence,{signal}={}) {
      if(!evidence?.imageFile)return null;
      const url=new URL('https://commons.wikimedia.org/w/api.php');
      url.search=new URLSearchParams({action:'query',format:'json',formatversion:'2',prop:'imageinfo',titles:`File:${evidence.imageFile}`,
        iiprop:'url|mime|thumbmime|extmetadata',iiurlwidth:'800',iiextmetadatafilter:'Artist|Attribution|LicenseShortName|LicenseUrl'}).toString();
      return licensedCommonsPhoto(await fetchJSON(url,signal),evidence);
    }
  };
}
