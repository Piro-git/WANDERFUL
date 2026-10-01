import test from 'node:test';
import assert from 'node:assert/strict';
import {parseSourceDocument,createSourceDocumentLookup,fetchSourceHTML,mentionsName} from '../src/dynamicResearch/sourceDocuments.js';
import {reconcileRouteEvidence,validateRouteEvidence} from '../src/dynamicResearch/evidence.js';
const url='https://www.nationalpark-harz.de/de/orte/ilsefalle/',at='2026-09-09T08:00:00Z';
const place=(id=1,name='Ilsefälle')=>({id:`osm:node:${id}`,name,coordinate:{latitude:51.83,longitude:10.65},wikidataId:'Q123',source:{provider:'openstreetmap',url:`https://www.openstreetmap.org/node/${id}`}});
const web=(text='Ilsefälle liegen im Ilsetal.',u=url)=>({provider:'google_grounding',retrievedAt:at,blocks:[{text,citations:[{url:u,title:'Park',startIndex:0,endIndex:text.length}]}],searchSuggestions:['required provider attribution'],retrievedSourceURLs:[u],observedSearchQueries:1});
const doc=(html,u=url)=>parseSourceDocument(html,{url:u,retrievedAt:at});
const context=(documents=[],p=place())=>({routeId:'measured-1',selectedPlaces:[p],inspectedPlaces:[p],sourceDocuments:documents});
const html=`<main><p>Ilsefälle liegen im Ilsetal, hier der <a href="https://www.openstreetmap.org/node/1">Karteneintrag</a>.</p></main>`;
test('general official page can attribute a named passage through stable identity, preserving selected/excluded',()=>{
 const d=doc(html),r=reconcileRouteEvidence(web(),context([d]));assert.equal(r.claims[0].relationship,'source_passage');assert.equal(r.claims[0].identityMethod,'stable_reference');assert.equal(r.claims[0].placeId,place().id);assert.equal(r.claims[0].sourcePassage.url,url);
 const second=place(2,'Ilsestein'),c={routeId:'measured-2',selectedPlaces:[second],inspectedPlaces:[place(),second],sourceDocuments:[d]};
 const excluded=reconcileRouteEvidence(web(),c);assert.equal(excluded.places.find(p=>p.placeId==='osm:node:1').selection,'excluded');assert.equal(excluded.claims[0].placeId,'osm:node:1');
 assert.throws(()=>validateRouteEvidence({...excluded,routeId:'measured-1'},web(),c),/invalid_route_evidence/);
});
test('exact old OSM read behavior and output stay unchanged',()=>{
 const r=reconcileRouteEvidence(web('OSM entry',place().source.url),context());assert.deepEqual(r.claims[0],{id:'b0-c0',blockIndex:0,citationIndex:0,placeId:'osm:node:1',relationship:'source_identity'});
});
test('structured exact name and near coordinate identify a source subject, not semantic truth',()=>{
 const ld=(changes={})=>doc(`<script type="application/ld+json">${JSON.stringify({'@type':'TouristAttraction',name:'Ilsefälle',geo:{latitude:51.83,longitude:10.65},...changes})}</script><main><p>Ilsefälle liegen im Ilsetal.</p></main>`);
 assert.equal(reconcileRouteEvidence(web(),context([ld()])).claims[0].identityMethod,'structured_name_coordinate');
 for(const d of [ld({name:'Ilsefall'}),ld({geo:{latitude:47,longitude:11}}),doc('<p>Ilsefälle liegen im Ilsetal.</p>')])assert.equal(reconcileRouteEvidence(web(),context([d])).claims[0].relationship,'unconfirmed');
});
test('conflicting stable identity coordinate, same-name ambiguity and unrelated passage fail closed',()=>{
 const conflict=doc(`<script type="application/ld+json">{"@type":"Place","name":"Ilsefälle","geo":{"latitude":47,"longitude":11},"sameAs":"https://www.wikidata.org/wiki/Q123"}</script>${html}`);
 assert.equal(reconcileRouteEvidence(web(),context([conflict])).claims[0].relationship,'unconfirmed');
 assert.equal(reconcileRouteEvidence(web('Ilsefälle2 offers something.'),context([doc(html)])).claims[0].relationship,'unconfirmed');
 const same=place(2),d=doc(`<script type="application/ld+json">{"@type":"Place","name":"Ilsefälle","geo":{"latitude":51.83,"longitude":10.65}}</script><p>Ilsefälle liegen im Ilsetal.</p>`);
 assert.equal(reconcileRouteEvidence(web(),{...context([d]),inspectedPlaces:[place(),same]}).claims[0].relationship,'unconfirmed');
});
test('page variants need observed same document; query/path lookalikes do not equate',()=>{
 const d=parseSourceDocument(html,{url,requestedURL:url+'?utm_source=test',retrievedAt:at});
 assert.equal(reconcileRouteEvidence(web(undefined,url+'?utm_source=test'),context([d])).claims[0].relationship,'source_passage');
 assert.equal(reconcileRouteEvidence(web(undefined,url+'other'),context([d])).claims[0].relationship,'unconfirmed');
});
test('candidate cap accepts ten deliberate candidates and rejects eighty discovery hits',()=>{
 const ps=Array.from({length:10},(_,i)=>place(i+1,'Place '+i));assert.equal(reconcileRouteEvidence(web(),{routeId:'measured-1',selectedPlaces:[ps[0]],inspectedPlaces:ps}).places.length,10);
 assert.throws(()=>reconcileRouteEvidence(web(),{routeId:'measured-1',selectedPlaces:[ps[0]],inspectedPlaces:Array.from({length:80},(_,i)=>place(i+1))}),/invalid_route_evidence/);
});
test('bounded official lookup rejects arbitrary origins and degrades on failed page fetch',async()=>{
 let calls=0;const fetchImpl=async()=>{calls++;return new Response(html,{headers:{'Content-Type':'text/html'}});};
 const lookup=createSourceDocumentLookup({fetchImpl,userAgent:'test'});
 const r=await lookup({web:web(),places:[place()]});assert.equal(r.documents.length,1);assert.equal(calls,1);
 const bad=await lookup({web:web(undefined,'https://evil.example.org/place'),places:[place()]});assert.equal(bad.documents.length,0);assert.equal(calls,1);
 const failed=await createSourceDocumentLookup({fetchImpl:async()=>{throw Error('offline')},userAgent:'test'})({web:web(),places:[place()]});assert.equal(failed.sources[0].state,'unavailable');
});
test('each redirect is reserved, off-host redirects and oversized text are refused',async()=>{
 let reserve=0,calls=0;await assert.rejects(fetchSourceHTML(url,{reserveSource:()=>++reserve<=1,fetchImpl:async()=>{calls++;return new Response(null,{status:302,headers:{Location:url+'canonical'}})}}),/source_budget_exhausted/);assert.equal(calls,1);
 await assert.rejects(fetchSourceHTML(url,{fetchImpl:async()=>new Response(null,{status:302,headers:{Location:'https://127.0.0.1/'}})}),/source_redirect_rejected/);
 await assert.rejects(fetchSourceHTML(url,{fetchImpl:async()=>new Response('x'.repeat(262145),{headers:{'Content-Type':'text/html'}})}),/source_size_limit/);
});
test('cancellation stays cancellation, even for an uncooperative fetch',async()=>{
 const controller=new AbortController();const call=fetchSourceHTML(url,{signal:controller.signal,fetchImpl:()=>new Promise(()=>{})});controller.abort();await assert.rejects(call,/cancelled/);
});
test('Unicode name boundaries do not conflate similarly named places',()=>{
 assert.equal(mentionsName('An den Ilsefällen','Ilsefälle'),false);assert.equal(mentionsName('Die Ilsefälle.','Ilsefälle'),true);assert.equal(mentionsName('Brockenlauf','Brocken'),false);
});
