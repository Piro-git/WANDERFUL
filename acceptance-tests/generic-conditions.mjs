import test from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const root=process.env.CANDIDATE_ROOT??process.cwd();
const imp=p=>import(pathToFileURL(`${root}/backend/src/dynamicResearch/${p}.js`));
const {createGenericConditionLookup,validateConditionExtraction}=await imp('genericConditions');
const {parseSourceDocument,fetchSourceHTML}=await imp('sourceDocuments');
const {evaluateConditions}=await imp('localConditions');
const {publicFetch,publicSourceURL,publicAddress}=await imp('publicSources');
const now=Date.parse('2026-09-09T12:00:00Z'),checkedAt=new Date(now).toISOString();
function fixture({name='Dieulefit',latitude=44.523,longitude=5.065,country='France',admin='Drôme',timeZone='Europe/Paris',text}={}) {
 const url='https://www.communes-information.fr/actualites/sentiers';
 const locationQuote=`${name}, ${admin}, ${country}`;
 const excerpt=text??`${locationQuote} : la fermeture du sentier a été levée. Le sentier est de nouveau ouvert.`;
 const authorityQuote='Mairie de Dieulefit : autorité municipale responsable des chemins.';
 const html=`<article><h1>Informations des sentiers</h1><script type="application/ld+json">${JSON.stringify({'@type':'Place',name,geo:{latitude,longitude}})}</script><p>${authorityQuote}</p><p>${excerpt}</p></article>`;
 const request={prompt:`Une promenade calme à ${name}`,locationName:name,anchor:{latitude,longitude},locationContext:{locality:name,administrativeArea:admin,country,timeZone},intent:{activityType:'hiking',routeType:'loop',targetDistanceKm:8}};
 const n={documentURL:url,title:'Réouverture du sentier',kind:'closure',status:'revoked',subject:name,excerpt,authority:'official',publisher:'Mairie de Dieulefit',authorityQuote,locationQuote,publishedText:'',publishedAt:'',validFromText:'',validFrom:'',validUntilText:'',validUntil:'',timeZone,temporalBasis:'until_revoked',timingQuote:excerpt,scope:'full',action:'Consulter la source avant le départ.'};
 const doc=parseSourceDocument(html,{url,retrievedAt:checkedAt,generic:true});
 return {url,html,request,n,doc,area:[longitude-.05,latitude-.05,longitude+.05,latitude+.05]};
}
function web(url){return {provider:'google_grounding',retrievedAt:checkedAt,observedSearchQueries:1,blocks:[{text:'Information locale',citations:[{url,title:'Source locale',startIndex:0,endIndex:18}]}],retrievedSourceURLs:[url],searchSuggestions:['<div>Source attribution</div>']};}
test('unregistered places in different countries invoke discovery and public document parsing with resolved context',async()=>{
 for(const place of [{},{name:'Settle',latitude:54.069,longitude:-2.277,admin:'North Yorkshire',country:'United Kingdom',timeZone:'Europe/London'},{name:'Port Townsend',latitude:48.117,longitude:-122.76,admin:'Washington',country:'United States',timeZone:'America/Los_Angeles'}]) {
  const f=fixture(place);let searches=0,reads=0,extractions=0,generations=0,sources=0;
  const lookup=createGenericConditionLookup({userAgent:'Acceptance offline transport',now:()=>now,
   researchWeb:async request=>{searches++;assert.equal(request.purpose,'local_conditions');assert.deepEqual(request.resolvedLocation.coordinate,f.request.anchor);assert.equal(request.resolvedLocation.context.country,f.request.locationContext.country);return web(f.url);},
   publicFetchImpl:async(url,options)=>{reads++;assert.equal(String(url),f.url);assert.equal(options.redirect,'manual');return new Response(f.html,{headers:{'content-type':'text/html'}});},
   extractConditions:async context=>{extractions++;assert.equal(context.documents[0].passages.at(-1).text,f.n.excerpt);assert.equal(context.visitTime,'2026-09-10T08:00:00-07:00');return {notices:[f.n]};}});
  const result=await lookup({request:f.request,area:f.area,visitTime:'2026-09-10T08:00:00-07:00'},{reserveGeneration:()=>++generations<=3,reserveSource:()=>++sources<=6});
  assert.equal(searches,1);assert.equal(reads,1);assert.equal(extractions,1);assert.equal(result.notices.length,1);assert.equal(result.notices[0].status,'revoked');assert.equal(result.notices[0].sourceExcerpt,f.n.excerpt);assert.ok(result.researchEvidence);
 }
});
test('same name with conflicting structured coordinate is not local evidence',()=>{
 const f=fixture();const wrong={...f.doc,entities:[{...f.doc.entities[0],coordinate:{latitude:45.9,longitude:6.86}}]};
 const r=validateConditionExtraction({notices:[f.n]},{documents:[wrong],request:f.request,checkedAt});
 assert.equal(r.notices.length,0);
});
test('locality mention does not locate a different subject from unrelated travel news',()=>{
 const f=fixture({text:'Dieulefit, Drôme, France : un groupe de touristes raconte que Yosemite reste fermé aux États-Unis.'});
 f.n.subject='Yosemite';f.n.status='active';f.n.title='Yosemite fermé';
 const r=validateConditionExtraction({notices:[f.n]},{documents:[f.doc],request:f.request,checkedAt});
 assert.equal(r.notices.length,0,'locality identity must not authenticate an unrelated event subject');
});
test('no discovery results remain explicit unknown and still prove a search attempt',async()=>{
 const f=fixture();let searched=0;
 const lookup=createGenericConditionLookup({userAgent:'Acceptance offline',now:()=>now,researchWeb:async()=>{searched++;return {...web(f.url),retrievedSourceURLs:[]};},extractConditions:async()=>{throw Error('no documents to extract');},publicFetchImpl:async()=>{throw Error('no URL authorized');}});
 const r=await lookup({request:f.request,area:f.area});assert.equal(searched,1);assert.equal(r.notices.length,0);assert.notEqual(r.sources[0].state,'not_checked');
});
test('private DNS and invalid URLs stop before public transport',async()=>{
 for(const u of ['https://127.0.0.1/','https://[::1]/','https://user:pass@host.com/','http://host.com/','https://host.local/'])assert.equal(publicSourceURL(u),null);
 for(const ip of ['127.0.0.1','10.2.3.4','169.254.169.254','::1','::ffff:127.0.0.1'])assert.equal(publicAddress(ip),false);
 let transport=0;await assert.rejects(publicFetch('https://www.communes-information.fr/',{}, {resolve:async()=>[{address:'10.0.0.3',family:4}],transport:()=>{transport++;}}));assert.equal(transport,0);
});
test('redirect, size and shared source reservation limits remain enforced',async()=>{
 const f=fixture();let calls=0;
 await assert.rejects(fetchSourceHTML(f.url,{generic:true,publicFetchImpl:async()=>{calls++;return new Response(null,{status:302,headers:{location:'https://127.0.0.1/'}});}}));assert.equal(calls,1);
 await assert.rejects(fetchSourceHTML(f.url,{generic:true,publicFetchImpl:async()=>new Response('x'.repeat(262145),{headers:{'content-type':'text/html'}})}));
 calls=0;await assert.rejects(fetchSourceHTML(f.url,{generic:true,reserveSource:()=>false,publicFetchImpl:async()=>{calls++;}}));assert.equal(calls,0);
});
