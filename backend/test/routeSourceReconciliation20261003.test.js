// Independent regression: entirely synthetic source text, no network/provider IO.
// QA's two reproductions fail on c8b061d. These synthetic cases establish the
// repaired backend admission contract, not provider or iOS live acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import {parseSourceDocument,createSourceDocumentLookup,fetchSourceHTML} from '../src/dynamicResearch/sourceDocuments.js';
import {reconcileRouteEvidence} from '../src/dynamicResearch/evidence.js';
import {planDynamicResearch} from '../src/dynamicResearch/planner.js';

const url='https://www.doc.govt.nz/parks-and-recreation/synthetic-qa-page/';
const at='2026-10-03T00:00:00.000Z';
const place={id:'osm:node:123',name:'Synthetic foreign viewpoint',category:'viewpoint',
  coordinate:{latitude:-45.03,longitude:168.66},
  source:{provider:'openstreetmap',url:'https://www.openstreetmap.org/node/123'}};
const text='Synthetic foreign viewpoint is identified in this synthetic source paragraph.';
const web={provider:'google_grounding',retrievedAt:at,observedSearchQueries:1,
  blocks:[{text,citations:[{url,title:'Synthetic source page',startIndex:0,endIndex:text.length}]}],
  searchSuggestions:['Synthetic provider credit'],retrievedSourceURLs:[url]};
const document=parseSourceDocument(`<main><p>${text} <a href="${place.source.url}">Synthetic mapped identity</a></p></main>`,
  {url,requestedURL:url,retrievedAt:at,generic:true});

test('global generic document with exact stable identity reconciles into a source passage',()=>{
  const result=reconcileRouteEvidence(web,{routeId:'measured-1',selectedPlaces:[place],
    inspectedPlaces:[place],sourceDocuments:[document]});
  assert.equal(result.claims[0].relationship,'source_passage');
  assert.equal(result.claims[0].placeId,place.id);
  assert.equal(result.claims[0].sourcePassage.url,url);
  assert.equal(result.claims[0].sourcePassage.retrievedAt,at);
  assert.equal(result.claims[0].identityMethod,'stable_reference');
});

test('successful foreign source enrichment does not crash an already accepted itinerary',async()=>{
  let turn=0;
  const call=(id,name,args)=>({type:'function_call',id,name,arguments:args});
  const result=await planDynamicResearch({prompt:'Synthetic free request outside regional registry',
    anchor:{latitude:-45.03,longitude:168.65},intent:{routeType:'loop',activityType:'hiking',targetDistanceKm:8},
    researchMode:'web_and_map',locationName:'Synthetic foreign start'}, {
    researchWeb:async()=>structuredClone(web), search:async()=>[structuredClone(place)],
    sourceDocuments:async()=>({documents:[structuredClone(document)]}),
    interact:async()=>({steps:[turn++===0?call('search','search_places',{radiusMeters:4000,kinds:['viewpoint']}):
      call('route','route_itinerary',{placeIds:[place.id]})]}),
    route:async()=>({accepted:true,statistics:{distanceMeters:8000}}),
    reviewPlan:async()=>({decision:'complete',summary:'Synthetic measured route and mapped identity.',
      remainingWishes:[],evidenceIds:[place.id]})
  });
  assert.equal(result.accepted,true);
  assert.equal(result.webResearch.routeEvidence.claims[0].relationship,'source_passage');
});

const context=docs=>({routeId:'measured-1',selectedPlaces:[place],inspectedPlaces:[place],sourceDocuments:docs});

test('global lookup uses the public fetch pipeline and reconciles the fetched observed document',async()=>{
  let publicCalls=0,reservations=0;
  const lookup=createSourceDocumentLookup({userAgent:'Synthetic backend regression',now:()=>Date.parse(at),
    fetchImpl:async()=>assert.fail('Generic pages must not use the regional/provider fetch'),
    publicFetchImpl:async requested=>{
      publicCalls++;assert.equal(String(requested),url);
      return new Response(`<main><p>${text} <a href="${place.source.url}">Mapped identity</a></p></main>`,{headers:{'Content-Type':'text/html'}});
    }});
  const read=await lookup({web,places:[place]},{reserveSource:()=>{reservations++;return true;}});
  assert.equal(publicCalls,1);assert.equal(reservations,1);assert.equal(read.sources[0].state,'checked');
  assert.equal(reconcileRouteEvidence(web,context(read.documents)).claims[0].relationship,'source_passage');
});

test('global evidence rejects private, credential, non-HTTPS and mismatched document origins',()=>{
  for(const field of ['url','requestedURL','canonicalURL']) {
    for(const invalid of ['https://localhost/','https://internal.local/','https://127.0.0.1/',
      'https://[::1]/','https://user:password@www.doc.govt.nz/path','http://www.doc.govt.nz/path',
      'https://www.doc.govt.nz:8443/path','https://different-public.org/path']) {
      assert.throws(()=>reconcileRouteEvidence(web,context([{...document,[field]:invalid}])),/invalid_route_evidence/);
    }
  }
  assert.throws(()=>reconcileRouteEvidence(web,context([{...document,retrievedAt:'invalid'}])),/invalid_route_evidence/);
});

test('unobserved citations and path lookalikes cannot borrow a successfully read global source',()=>{
  const unobserved={...web,retrievedSourceURLs:[url+'observed-other']};
  assert.throws(()=>reconcileRouteEvidence(unobserved,context([document])),/web_research_unverified/);
  const mixed={...unobserved,blocks:[{...web.blocks[0],citations:[web.blocks[0].citations[0],
    {...web.blocks[0].citations[0],url:unobserved.retrievedSourceURLs[0]}]}]};
  assert.equal(reconcileRouteEvidence(mixed,context([document])).claims[0].relationship,'unconfirmed');
  const otherURL=url+'other';
  const lookalike={...web,retrievedSourceURLs:[otherURL],blocks:[{...web.blocks[0],citations:[{...web.blocks[0].citations[0],url:otherURL}]}]};
  assert.equal(reconcileRouteEvidence(lookalike,context([document])).claims[0].relationship,'unconfirmed');
});

test('same-name global text cannot establish a mismatched mapped identity or distant coordinates',()=>{
  const wrongLink=parseSourceDocument(`<p>${text}<a href="https://www.openstreetmap.org/node/999">Other identity</a></p>`,
    {url,retrievedAt:at,generic:true});
  const conflict=parseSourceDocument(`<script type="application/ld+json">${JSON.stringify({'@type':'Place',name:place.name,
    geo:{latitude:45,longitude:12},sameAs:place.source.url})}</script><p>${text}<a href="${place.source.url}">Identity</a></p>`,
    {url,retrievedAt:at,generic:true});
  for(const doc of [wrongLink,conflict])assert.equal(reconcileRouteEvidence(web,context([doc])).claims[0].relationship,'unconfirmed');
  assert.throws(()=>reconcileRouteEvidence(web,{...context([document]),selectedPlaces:[{...place,name:'Altered selection'}]}),/invalid_route_evidence/);
});

test('malicious global redirects never reach a second fetch or become source evidence',async()=>{
  for(const location of ['https://127.0.0.1/','https://internal.local/',
    'https://user:password@www.doc.govt.nz/path','https://different-public.org/path']) {
    let calls=0;
    await assert.rejects(fetchSourceHTML(url,{generic:true,publicFetchImpl:async()=>{
      calls++;return new Response(null,{status:302,headers:{Location:location}});
    }}),/source_redirect_rejected/);
    assert.equal(calls,1);
  }
});
