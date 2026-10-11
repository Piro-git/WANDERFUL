// Independent regression: entirely synthetic source text, no network/provider IO.
// Desired behavior intentionally fails on c8b061d; owner must repair both backend
// reconciliation and the iOS source-passage validator before worldwide acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import {parseSourceDocument} from '../src/dynamicResearch/sourceDocuments.js';
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
