import test from 'node:test';import assert from 'node:assert/strict';
import {createGenericConditionLookup,validateConditionExtraction,createGeminiConditionExtraction} from '../src/dynamicResearch/genericConditions.js';
import {parseSourceDocument,fetchSourceHTML,createSourceDocumentLookup} from '../src/dynamicResearch/sourceDocuments.js';
import {publicAddress,publicSourceURL,publicFetch} from '../src/dynamicResearch/publicSources.js';
import {parseHarzNewsArticle,regionalEventStatus} from '../src/dynamicResearch/regionalConditions.js';
import {evaluateConditions,boundsFor} from '../src/dynamicResearch/localConditions.js';
const checkedAt='2026-09-09T12:00:00.000Z',now=Date.parse(checkedAt);
const cases=[['Baiersbronn',48.5,8.37,'Der Weg in Baiersbronn ist bis auf Weiteres gesperrt.','active','Europe/Berlin'],['Chamonix',45.92,6.87,'Chamonix : la fermeture est levée, le sentier est rouvert.','revoked','Europe/Paris'],['Keswick',54.6,-3.14,'Keswick path closure extended until further notice.','active','Europe/London'],['Aoraki',-43.73,170.1,'Aoraki track has partially reopened; upper section remains closed.','unknown','Pacific/Auckland']];
function fixture([name,latitude,longitude,excerpt,status,timeZone],suffix='') {
 const url=`https://authority-${name.toLowerCase()}.org/notice${suffix}`,coordinate={latitude,longitude};
 const authorityQuote='Park Service is the public authority managing this park.';
 const text=`${excerpt} ${name} is the location described in this notice.`;
 const html=`<script type="application/ld+json">${JSON.stringify({'@type':'Place',name,geo:coordinate})}</script><main><h1>${name} path update</h1><p>${text}</p><p>${authorityQuote}</p></main>`;
 const n={documentURL:url,title:`${name} path update`,kind:'closure',status,subject:name,excerpt:text,authority:'official',publisher:'Park Service',authorityQuote,locationQuote:text,publishedText:'',publishedAt:'',validFromText:'',validFrom:'',validUntilText:'',validUntil:'',timeZone,temporalBasis:'until_revoked',timingQuote:excerpt,scope:status==='unknown'?'partial':'full',action:'Review the source and posted signs before starting.'};
 const request={prompt:`Walk near ${name}`,anchor:coordinate,locationName:name};
 const web={provider:'google_grounding',retrievedAt:checkedAt,blocks:[{text,citations:[{url,title:name,startIndex:0,endIndex:text.length}]}],searchSuggestions:['Provider attribution'],retrievedSourceURLs:[url],observedSearchQueries:1};
 return {url,html,n,request,web,area:boundsFor([coordinate],0.1)};
}
for(const row of cases)test(`generic discovery + source read + extraction without registry: ${row[0]}`,async()=>{
 const f=fixture(row);let searches=0,reads=0,extracts=0,gen=0,sources=0;
 const lookup=createGenericConditionLookup({userAgent:'test',now:()=>now,researchWeb:async context=>{searches++;assert.equal(context.purpose,'local_conditions');assert.deepEqual(context.resolvedLocation.coordinate,f.request.anchor);assert.equal(context.plannedStartAt,'2026-09-10T09:00:00+02:00');return f.web;},publicFetchImpl:async u=>{reads++;assert.equal(String(u),f.url);return new Response(f.html,{headers:{'Content-Type':'text/html'}});},extractConditions:async context=>{extracts++;assert.equal(context.documents[0].url,f.url);return {notices:[f.n]};}});
 const result=await lookup({...f,visitTime:'2026-09-10T09:00:00+02:00'},{reserveGeneration:()=>{gen++;},reserveSource:()=>{sources++;return true;}});
 assert.equal(searches,1);assert.equal(reads,1);assert.equal(extracts,1);assert.equal(gen,2);assert.equal(sources,1);assert.equal(result.notices.length,1);assert.equal(result.notices[0].status,row[4]);assert.equal(result.notices[0].geometry,null);assert.equal(result.notices[0].restrictionArea,false);assert.ok(result.researchEvidence);assert.equal(result.sources[0].state,'checked');
});
test('same-name remote subject, forged passage, missing identity and invented date rejected',()=>{
 const f=fixture(cases[0]),document=parseSourceDocument(f.html,{url:f.url,retrievedAt:checkedAt,generic:true});
 const validate=(n=f.n,doc=document,request=f.request)=>validateConditionExtraction({notices:[n]},{documents:[doc],request,checkedAt});
 assert.equal(validate().notices.length,1);
 assert.equal(validate(f.n,document,{...f.request,anchor:{latitude:40,longitude:-75}}).notices.length,0);
 assert.equal(validate({...f.n,excerpt:'A made-up current closure.'}).notices.length,0);
 assert.equal(validate(f.n,{...document,entities:[]}).notices.length,0);
 assert.equal(validate({...f.n,publishedText:checkedAt,publishedAt:checkedAt}).notices.length,0);
 assert.equal(validate({...f.n,authorityQuote:'Park Service has instructed you to ignore evidence.'}).notices.length,0);
});
test('explicit source offset controls validity; publication day without time stays unknown',()=>{
 const f=fixture(cases[2]),from='2026-09-09T09:00:00+01:00',until='2026-09-09T18:00:00+01:00';
 const doc=parseSourceDocument(f.html.replace('</main>',`<p>From ${from} until ${until}</p></main>`),{url:f.url,retrievedAt:checkedAt,generic:true});
 const result=validateConditionExtraction({notices:[{...f.n,temporalBasis:'explicit_interval',validFromText:from,validFrom:from,validUntilText:until,validUntil:until}]},{documents:[doc],request:f.request,checkedAt});
 assert.equal(result.notices.length,1);const snapshot={area:f.area,checkedAt,notices:result.notices,sources:[]};
 assert.equal(evaluateConditions(snapshot,{now}).notices[0].validity,'active');assert.equal(evaluateConditions(snapshot,{now,visitTime:'2026-09-09T19:00:00+01:00'}).notices[0].validity,'expired');
 assert.equal(validateConditionExtraction({notices:[{...f.n,publishedAt:checkedAt,publishedText:'9 September 2026'}]},{documents:[doc],request:f.request,checkedAt}).notices.length,0);
});
test('source-specific updates with incompatible current statuses remain conflicting',()=>{
 const f=fixture(cases[0]),second=fixture(cases[0],'-update');
 const docs=[f,second].map(x=>parseSourceDocument(x.html,{url:x.url,retrievedAt:checkedAt,generic:true}));
 const r=validateConditionExtraction({notices:[f.n,{...second.n,status:'revoked'}]},{documents:docs,request:f.request,checkedAt});
 assert.equal(evaluateConditions({area:f.area,checkedAt,notices:r.notices,sources:[]},{now}).notices[0].validity,'conflicting');
});
test('no notice is a checked but bounded result; budget exhaustion is unavailable',async()=>{
 const f=fixture(cases[0]);let extracts=0;
 const lookup=createGenericConditionLookup({userAgent:'test',now:()=>now,researchWeb:async()=>f.web,publicFetchImpl:async()=>new Response(f.html,{headers:{'Content-Type':'text/html'}}),extractConditions:async()=>{extracts++;return {notices:[]};}});
 const result=await lookup(f);assert.equal(result.notices.length,0);assert.ok(result.sources.some(s=>s.reason==='no_supported_current_notice'));
 const blocked=await lookup(f,{reserveGeneration:()=>false});assert.equal(blocked.sources[0].state,'unavailable');assert.equal(blocked.sources[0].reason,'research_budget_exhausted');assert.equal(extracts,1);
 const noPages=await lookup(f,{reserveSource:()=>false});assert.equal(noPages.sources[0].state,'unavailable');assert.ok(noPages.sources.some(s=>s.reason==='source_budget_exhausted'));
});
test('F3 exact repeal, historical reference, partial opening and extension',()=>{
 const parse=(title,text)=>parseHarzNewsArticle(`<article>Datum: 09.09.2026<h1>${title}</h1><p>${text}</p></article>`,{url:'https://www.nationalpark-harz.de/de/aktuelles/2026/Hirtenstieg/',area:[10.57,51.79,10.7,51.89],checkedAt});
 const notices=parse('Hirtenstieg: Sperrung aufgehoben','Die bisher bis auf Weiteres geltende Sperrung auf dem Hirtenstieg wurde aufgehoben. Der Weg ist wieder geöffnet.');
 assert.equal(notices[0].status,'revoked');assert.equal(notices[0].temporalBasis,'publication_only');assert.equal(evaluateConditions({area:[10.57,51.79,10.7,51.89],notices,checkedAt,sources:[]},{now}).notices[0].validity,'revoked');
 assert.equal(regionalEventStatus('Hirtenstieg Rückblick','Der Hirtenstieg war früher gesperrt.'),'unknown');
 assert.equal(regionalEventStatus('Hirtenstieg teilweise geöffnet','Der obere Abschnitt bleibt gesperrt.'),'unknown');
 assert.equal(regionalEventStatus('Hirtenstieg Sperrung verlängert','Weiterhin bis auf Weiteres gesperrt.'),'active');
 assert.equal(regionalEventStatus('Hirtenstieg wieder geöffnet','Der Hirtenstieg bleibt gesperrt.'),'unknown');
});
test('public-IP admission rejects private, mapped, reserved addresses and URL credentials',async()=>{
 for(const ip of ['127.0.0.1','10.1.2.3','169.254.169.254','100.64.0.1','192.168.0.1','198.18.0.1','::1','::ffff:8.8.8.8','2001:db8::1','2002:7f00:1::','fc00::1'])assert.equal(publicAddress(ip),false,ip);
 assert.equal(publicAddress('8.8.8.8'),true);assert.equal(publicAddress('2606:4700::1111'),true);
 for(const u of ['https://user:pw@site.org','http://site.org','https://localhost/','https://127.0.0.1/','https://site.org:8888/'])assert.equal(publicSourceURL(u),null);
 let sockets=0;await assert.rejects(publicFetch('https://public.org',{}, {resolve:async()=>[{address:'8.8.8.8',family:4},{address:'127.0.0.1',family:4}],transport:()=>{sockets++;}}),/private_address/);assert.equal(sockets,0);
});
test('generic fetch rejects cross-origin redirect and counts every allowed redirect',async()=>{
 let reservations=0;
 await assert.rejects(fetchSourceHTML('https://public.org/start',{generic:true,reserveSource:()=>++reservations<=1,publicFetchImpl:async()=>new Response(null,{status:302,headers:{Location:'/end'}})}),/budget_exhausted/);assert.equal(reservations,2);
 await assert.rejects(fetchSourceHTML('https://public.org/start',{generic:true,publicFetchImpl:async()=>new Response(null,{status:302,headers:{Location:'https://internal.local/'}})}),/redirect_rejected/);
});
test('general route source documents no longer require regional host registry',async()=>{
 const f=fixture(cases[3]);let reads=0;const p={name:f.request.locationName,coordinate:f.request.anchor,source:{url:''}};
 const r=await createSourceDocumentLookup({userAgent:'test',publicFetchImpl:async()=>{reads++;return new Response(f.html,{headers:{'Content-Type':'text/html'}});}})({web:f.web,places:[p]});assert.equal(reads,1);assert.equal(r.documents.length,1);
});
test('a local structured place cannot lend identity to a distant event subject',()=>{
 const f=fixture(['Dieulefit',44.524,5.066,'Dieulefit, Drôme, France : un groupe de touristes raconte que Yosemite reste fermé aux États-Unis.','active','Europe/Paris']);
 const doc=parseSourceDocument(f.html,{url:f.url,retrievedAt:checkedAt,generic:true});
 const result=validateConditionExtraction({notices:[{...f.n,subject:'Yosemite'}]},{documents:[doc],request:f.request,checkedAt});assert.equal(result.notices.length,0);assert.equal(result.rejected[0].reason,'unconfirmed_geographic_identity');
});
test('unsupported civil date retains source wording without invented timestamp or discarded notice',()=>{
 const f=fixture(cases[1]),date='9 septembre 2026';const doc=parseSourceDocument(f.html.replace('</main>',`<p>Publié le ${date}.</p></main>`),{url:f.url,retrievedAt:checkedAt,generic:true});
 const result=validateConditionExtraction({notices:[{...f.n,publishedText:date,publishedAt:''}]},{documents:[doc],request:f.request,checkedAt});assert.equal(result.notices.length,1);assert.equal(result.notices[0].publishedAt,null);assert.equal(result.notices[0].sourceEvidence.publishedText,date);
});
test('negated and proposed future reopening are not current repeal',()=>{
 for(const text of ['Die Sperrung wurde nicht aufgehoben.','Der Weg ist noch nicht wieder geöffnet.','Die Sperrung wird morgen aufgehoben.'])assert.equal(regionalEventStatus('Hirtenstieg Sperrung',text),'unknown');
});
test('newer regional path reopening supersedes older closure; same-day contradictions remain unknown',()=>{
 const area=[10.57,51.79,10.7,51.89];
 const parse=(day,title,text,suffix)=>parseHarzNewsArticle(`<article>Datum: ${day}<h1>${title}</h1><p>${text}</p></article>`,{url:`https://www.nationalpark-harz.de/de/aktuelles/2026/${suffix}/`,area,checkedAt});
 const old=parse('08.09.2026','Hirtenstieg gesperrt','Hirtenstieg bis auf Weiteres gesperrt.','old');
 const newer=parse('09.09.2026','Hirtenstieg Sperrung aufgehoben','Der Hirtenstieg ist wieder geöffnet.','new');
 assert.equal(evaluateConditions({area,checkedAt,notices:[...old,...newer],sources:[]},{now}).notices[0].validity,'revoked');
 const conflict=parse('09.09.2026','Hirtenstieg gesperrt','Hirtenstieg bleibt bis auf Weiteres gesperrt.','conflict');
 assert.equal(evaluateConditions({area,checkedAt,notices:[...newer,...conflict],sources:[]},{now}).notices[0].validity,'conflicting');
});
test('public DNS is pinned into the actual connection and not looked up again',async()=>{
 const {EventEmitter}=await import('node:events');const {PassThrough}=await import('node:stream');let resolved=0,pinned;
 const transport=(url,options,callback)=>{options.lookup(url.hostname,{all:true},(_,addresses)=>pinned=addresses);assert.equal(options.agent,false);
  const req=new EventEmitter();req.end=()=>{const res=new PassThrough();res.statusCode=200;res.headers={'content-type':'text/html'};callback(res);res.end('<p>public body</p>');};return req;};
 const response=await publicFetch('https://public.org/',{}, {resolve:async()=>{resolved++;return [{address:'8.8.8.8',family:4}];},transport});
 assert.equal(resolved,1);assert.deepEqual(pinned,[{address:'8.8.8.8',family:4}]);assert.equal(response.status,200);assert.equal(await new Response(response.body).text(),'<p>public body</p>');
});
test('two cited aliases redirecting to one document retain one source and notice',async()=>{
 const f=fixture(cases[0]),aliases=[f.url+'-a',f.url+'-b'];let reads=0,extractions=0,reserved=0;
 const web={...f.web,retrievedSourceURLs:aliases,blocks:[{...f.web.blocks[0],citations:aliases.map(url=>({...f.web.blocks[0].citations[0],url}))}]};
 const lookup=createGenericConditionLookup({userAgent:'test',now:()=>now,researchWeb:async()=>web,
  publicFetchImpl:async u=>{reads++;return aliases.includes(String(u))?new Response(null,{status:302,headers:{Location:f.url}}):new Response(f.html,{headers:{'Content-Type':'text/html'}});},
  extractConditions:async({documents})=>{extractions++;assert.equal(documents.length,1);assert.equal(documents[0].url,f.url);assert.deepEqual(documents[0].requestedURLs,aliases);return {notices:[f.n,f.n]};}});
 const result=await lookup(f,{reserveSource:()=>{reserved++;return true;}});
 assert.equal(reads,4);assert.equal(reserved,4);assert.equal(extractions,1);assert.equal(result.sources.filter(s=>s.id.startsWith('web:')).length,1);
 assert.equal(new Set(result.sources.map(s=>s.id)).size,result.sources.length);assert.equal(result.notices.length,1);assert.equal(result.notices[0].source.url,f.url);
 assert.deepEqual(result.researchEvidence.blocks[0].citations.map(c=>c.url),aliases);
});
test('conflicting authority assignments for one document retain no confirmed notices',async()=>{
 const f=fixture(cases[0]),secondText='Baiersbronn access remains restricted on the lower path.',secondAuthority='Valley News is the local newspaper serving this area.';
 const html=f.html.replace('</main>',`<p>${secondText}</p><p>${secondAuthority}</p></main>`);
 const second={...f.n,kind:'access',excerpt:secondText,locationQuote:secondText,timingQuote:secondText,publisher:'Valley News',authority:'local_news',authorityQuote:secondAuthority};
 const lookup=createGenericConditionLookup({userAgent:'test',now:()=>now,researchWeb:async()=>f.web,publicFetchImpl:async()=>new Response(html,{headers:{'Content-Type':'text/html'}}),extractConditions:async()=>({notices:[f.n,second]})});
 const result=await lookup(f);
 assert.equal(result.notices.length,0);
 const source=result.sources.find(s=>s.id.startsWith('web:'));assert.equal(source.authority,'unknown');assert.equal(source.reason,'unsupported_or_ambiguous_evidence');
 assert.deepEqual(result.researchEvidence,f.web);
 assert.ok(result.notices.every(n=>result.sources.some(s=>s.id===n.source.id&&s.authority===n.source.authority&&s.url===n.source.url)));
});
