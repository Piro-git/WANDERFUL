import {createHash} from 'node:crypto';
import {plainHTML,htmlAttributes,fetchSourceHTML,sourceURL,mentionsName} from './sourceDocuments.js';
import {intersectsBounds,validateNotice} from './localConditions.js';

export const REGIONAL_SOURCES=Object.freeze([
 {id:'harz-official-news',name:'Nationalpark Harz — aktuelle Meldungen',authority:'official',url:'https://www.nationalpark-harz.de/',bounds:[10.35,51.55,10.85,51.95],format:'harz_news'},
 {id:'innsbruck-path-notices',name:'Stadt Innsbruck — Wegsperren',authority:'official',url:'https://www.innsbruck.gv.at/freizeit/natur-umwelt/wald/wegsperren-lawinenwarnungen',bounds:[11.25,47.19,11.5,47.36],format:'innsbruck_notices'}
]);
// Geographic context only, deliberately NOT closure polygons. No shape is invented.
const AREAS=[
 {names:['Hirtenstieg','Heinrich-Heine-Weg','Brocken'],label:'Brocken / Hirtenstieg, Nationalpark Harz',bounds:[10.56,51.77,10.68,51.85]},
 {names:['Ilsenburg','Ilsetal','Ilsefälle','Zwißeltal','Zwiseltal'],label:'Ilsenburg / Ilsetal',bounds:[10.57,51.8,10.7,51.89]},
 {names:['Clausthaler Flutgraben','Bruchberg'],label:'Bruchberg / Clausthaler Flutgraben',bounds:[10.45,51.75,10.54,51.81]},
 {names:['Sillschlucht','Severinisteig','Gärberbach'],label:'Sillschlucht, Innsbruck',bounds:[11.37,47.22,11.42,47.26]},
 {names:['Emile-Béthouart-Steg'],label:'Emile-Béthouart-Steg, Innsbruck',bounds:[11.389,47.27,11.403,47.279]},
 {names:['Nordkette'],label:'Nordkette, Innsbruck',bounds:[11.28,47.29,11.47,47.36]}
];
function regionFor(text,area) {
 const matches=AREAS.filter(a=>a.names.some(n=>mentionsName(text,n)));
 return matches.find(a=>intersectsBounds(a.bounds,area))??(matches.length?false:null);
}
export function germanDay(value) {
 const m=value?.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);if(!m)return null;
 const iso=`${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
 const valueDate=new Date(`${iso}T00:00:00Z`);return Number.isFinite(valueDate.getTime())&&valueDate.toISOString().slice(0,10)===iso?iso:null;
}
// A date-only publication is not an invented midnight publication instant.
const dayInstant=day=>day?`${day}T00:00:00.000Z`:null;
const months=['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'];
function localMidnight(day,end=false,hour=0,minute=0) {
 if(!day)return null;
 const date=new Date(`${day}T00:00:00Z`);if(end)date.setUTCDate(date.getUTCDate()+1);date.setUTCHours(hour,minute);
 // Resolve German/Austrian civil date using the IANA zone (including DST).
 let candidate=date.getTime();for(let i=0;i<2;i++) {
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(candidate).map(p=>[p.type,p.value]));
  const viewed=Date.UTC(+parts.year,+parts.month-1,+parts.day,+parts.hour,+parts.minute,+parts.second);candidate+=date.getTime()-viewed;
 }return new Date(candidate).toISOString();
}
export function noticeTiming(text,publishedDay) {
 if(/bis auf (?:weiteres|widerruf)/i.test(text))return {temporalBasis:'until_revoked',validFrom:null,validUntil:null};
 const found=[...text.matchAll(new RegExp(`(\\d{1,2})\\.\\s*(${months.join('|')})(?:\\s+(20\\d{2}))?`,'gi'))];
 // Date interpretation only for explicitly bounded wording; event exceptions need human review.
 if(found.length===2&&/\b(?:vom|am)\b/i.test(text)&&/\b(?:bis|und)\b/i.test(text)&&!/(ausnahme|kurzzeitig|täglich|jeweils)/i.test(text)) {
  const year=found[1][3]??found[0][3];
  if(year) {
   const days=found.map(m=>germanDay(`${m[1]}.${months.findIndex(x=>x.toLowerCase()===m[2].toLowerCase())+1}.${m[3]??year}`));
   if(days.every(Boolean)&&days[0]<=days[1]) {
    if(!/\bbis\b/i.test(text)&&Date.parse(days[1])-Date.parse(days[0])>86400000)return {temporalBasis:'maintained_listing',validFrom:null,validUntil:null};
    const time=text.match(/\bab\s+(\d{1,2})[.:](\d{2})\s*Uhr/i);
    if(/\bUhr\b/i.test(text)&&!time)return {temporalBasis:'maintained_listing',validFrom:null,validUntil:null};
    if(time&&(+time[1]>23||+time[2]>59))return {temporalBasis:'maintained_listing',validFrom:null,validUntil:null};
    const from=localMidnight(days[0]);
    return {temporalBasis:'explicit_interval',validFrom:time?localMidnight(days[0],false,+time[1],+time[2]):from,validUntil:localMidnight(days[1],true)};
   }
  }
 }
 return {temporalBasis:'maintained_listing',validFrom:null,validUntil:null};
}
// Conservative fallback for the two reviewed German formats. General languages use
// source-bound semantic extraction. A keyword cannot establish current access.
export function regionalEventStatus(title,text) {
 const all=`${title}. ${text}`;
 if(/(?:nicht|nie|noch nicht).{0,30}(?:aufgehoben|geöffnet|freigegeben)|(?:wird|soll|könnte).{0,30}(?:aufgehoben|geöffnet|freigegeben)/i.test(all))return 'unknown';
 const partial=/(teilweise|abschnittsweise|nur .{0,45}(?:geöffnet|offen)|ausgenommen|mit Einschränkungen)/i.test(all);
 const reopened=/(sperrung.{0,50}(?:aufgehoben|beendet)|(?:wieder|wieder vollständig) (?:geöffnet|offen|freigegeben)|nicht mehr gesperrt)/i.test(all);
 const current=/(weiterhin|bleibt|bleiben|erneut|wieder|nach wie vor|verlängert).{0,60}(?:gesperrt|geschlossen|sperrung)|(?:sperrung|gesperrt).{0,60}(?:verlängert|bestehen)/i.test(all);
 if(partial||reopened&&current)return 'unknown';
 if(reopened)return 'revoked';
 if(/(?:war|waren|bisher|damals|ehemalig|früher).{0,100}(?:gesperrt|geschlossen|sperrung)/i.test(all)&&!current)return 'unknown';
 if(/(?:nicht|keine).{0,25}(?:sperrung|gesperrt|geschlossen)|(?:mögliche|drohende|könnte).{0,40}sperr/i.test(all))return 'unknown';
 return /(?:gesperrt|geschlossen|sperrung|umleitung|waldbrand|hochwasser|unwetter|steinschlag)/i.test(all)?'active':'unknown';
}
function noticeFrom({title,text,url,publishedDay,updatedDay,source,area,checkedAt,index,listing=false}) {
 const region=regionFor(`${title} ${text}`,area);if(region===false)return null;
 if(!/(sperr|gesperrt|geschlossen|umleitung|waldbrand|hochwasser|unwetter|steinschlag)/i.test(`${title} ${text}`))return null;
 if(!region)return null; // no same-name/global news without reviewed geographic context
 const status=regionalEventStatus(title,text);
 const timing=status==='active'?noticeTiming(text,publishedDay):{temporalBasis:'publication_only',validFrom:null,validUntil:null};
 const id=`${source.id}:${createHash('sha256').update(`${url}:${title}`).digest('hex').slice(0,20)}`;
 const published=dayInstant(publishedDay),updated=dayInstant(updatedDay);
 const headline=title.trim().slice(0,180);
 // Bind updates only when the same specific named path is in the heading.
 // Broad area names cannot merge separate restrictions.
 const pathNames=['Hirtenstieg','Heinrich-Heine-Weg','Clausthaler Flutgraben','Severinisteig','Emile-Béthouart-Steg'];
 const subjects=pathNames.filter(name=>mentionsName(title,name));
 const eventId=subjects.length===1?`${source.id}:path:${subjects[0]}`:id;
 return validateNotice({id,eventId,title:headline,kind:/waldbrand/i.test(title)?'fire':/hochwasser/i.test(title)?'flood':'closure',
  status,areaLabel:region.label,areaBounds:region.bounds,geometry:null,restrictionArea:false,
  publishedAt:published,sourceUpdatedAt:updated,publishedPrecision:publishedDay?'day':null,retrievedAt:checkedAt,
  ...timing,eventStart:timing.validFrom,eventEnd:timing.validUntil,
  sourceExcerpt:text.length<=600?text:text.slice(0,599).replace(/\s+\S*$/u,'')+'…',relevanceReason:'Named place in an independently reviewed regional context; exact route intersection is unverified.',
  action:'Review the official notice, affected named paths and dates before starting. A route intersection has not been verified.'}, {...source,url});
}
export function parseInnsbruckNotices(html,{area,checkedAt,source=REGIONAL_SOURCES[1]}) {
 const full=plainHTML(html),updatedDay=germanDay(html.match(/Zuletzt aktualisiert am (\d{2}\.\d{2}\.\d{4})/)?.[1]);
 if(!/Wo sind weitere Wegsperren\?/.test(full))throw new TypeError('source_format_changed');
 const section=html.split(/<h2\b[^>]*>Wo sind weitere Wegsperren\?/i)[1]?.split(/<h2\b/i)[0];if(!section)throw new TypeError('source_format_changed');
 const notices=[];
 for(const m of section.matchAll(/<h3\b[^>]*>([\s\S]*?)<\/h3>([\s\S]*?)(?=<h3\b|$)/gi)) {
  const title=plainHTML(m[1]),text=plainHTML(m[2]);if(!text)continue;
  const n=noticeFrom({title,text,url:source.url,publishedDay:null,updatedDay,source,area,checkedAt,listing:true});if(n)notices.push(n);
 }
 if(notices.length>12)throw new TypeError('incomplete_local_source');return notices;
}
export function discoverHarzNews(html,area) {
 if(!/<h2[^>]*>\s*Aktuelles/i.test(html))throw new TypeError('source_format_changed');
 const links=[];
 for(const m of html.matchAll(/<article\b[^>]*>([\s\S]*?)<\/article>/gi)) {
  const body=m[1],text=plainHTML(body),href=htmlAttributes(body.match(/<a\b[^>]*>/i)?.[0]??'').href;
  if(!href||!/(sperr|geschlossen|umleitung|waldbrand|hochwasser|unwetter|steinschlag)/i.test(text)||!regionFor(text,area))continue;
  const u=sourceURL(new URL(href,REGIONAL_SOURCES[0].url).href);
  if(!u||u.hostname!=='www.nationalpark-harz.de'||!/^\/de\/aktuelles\/20\d{2}\/[\w-]+(?:\.php|\/)$/.test(u.pathname))continue;
  // This site's observed .php links redirect to the slash canonical form. Still verify HTML after fetching.
  u.pathname=u.pathname.replace(/\.php$/,'/');links.push({url:u.href,title:text,publishedDay:germanDay(text.match(/\d{2}\.\d{2}\.\d{4}/)?.[0])});
 }
 const overlap=link=>{const r=regionFor(link.title,area);return r?Math.max(0,Math.min(area[2],r.bounds[2])-Math.max(area[0],r.bounds[0]))*Math.max(0,Math.min(area[3],r.bounds[3])-Math.max(area[1],r.bounds[1])):0;};
 return [...new Map(links.map(l=>[l.url,l])).values()].sort((a,b)=>overlap(b)-overlap(a)).slice(0,4);
}
export function parseHarzNewsArticle(html,{url,area,checkedAt,source=REGIONAL_SOURCES[0]}) {
 const article=html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1];if(!article)throw new TypeError('source_format_changed');
 const title=plainHTML(article.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1]??''),full=plainHTML(article);
 const publishedDay=germanDay(full.match(/Datum:\s*(\d{2}\.\d{2}\.\d{4})/)?.[1]);if(!title||!publishedDay)throw new TypeError('source_format_changed');
 const text=plainHTML(article.split(/<\/h1>/i)[1]??'');
 const n=noticeFrom({title,text,url,publishedDay,source,area,checkedAt});return n?[n]:[];
}
export async function readRegionalSource(source,{area,checkedAt,fetchImpl,signal,reserveSource}) {
 const first=await fetchSourceHTML(source.url,{fetchImpl,signal,reserveSource});
 if(source.format==='innsbruck_notices')return {notices:parseInnsbruckNotices(first.html,{area,checkedAt,source}),reason:'maintained_local_notices_only'};
 const links=discoverHarzNews(first.html,area),notices=[];let incomplete=false;
 // Read relevant full articles; do not present truncated teaser text as the notice.
 for(const link of links.slice(0,2))try {
  const page=await fetchSourceHTML(link.url,{fetchImpl,signal,reserveSource});notices.push(...parseHarzNewsArticle(page.html,{url:page.url,area,checkedAt,source}));
 }catch(error){if(signal?.aborted)throw error;incomplete=true;}
 return {notices,reason:incomplete||links.length>2?'partial_articles_or_budget_limit':'recent_front_page_only'};
}
