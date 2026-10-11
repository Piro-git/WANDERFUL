// Independent source-boundary review. Entirely synthetic; no network or provider calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import {parseSourceDocument} from '../src/dynamicResearch/sourceDocuments.js';
import {reconcileRouteEvidence} from '../src/dynamicResearch/evidence.js';

const at='2026-10-03T00:00:00.000Z';
const make=(url='https://www.doc.govt.nz/synthetic-qa-source/')=>{
  const place={id:'osm:node:321',name:'Synthetic sourced overlook',
    coordinate:{latitude:-45.04,longitude:168.65},wikidataId:'Q321',
    source:{provider:'openstreetmap',url:'https://www.openstreetmap.org/node/321'}};
  const text='Synthetic sourced overlook appears in this synthetic named paragraph.';
  const web={provider:'google_grounding',retrievedAt:at,observedSearchQueries:1,
    blocks:[{text,citations:[{url,title:'Synthetic QA source',startIndex:0,endIndex:text.length}]}],
    searchSuggestions:['Synthetic required credit'],retrievedSourceURLs:[url]};
  const document=parseSourceDocument(`<main><p>${text} <a href="${place.source.url}">Source identity</a></p></main>`,
    {url,requestedURL:url,retrievedAt:at,generic:true});
  return {web,context:{routeId:'measured-1',selectedPlaces:[place],inspectedPlaces:[place],sourceDocuments:[document]}};
};

for(const host of ['www.doc.govt.nz','www.nps.gov','www.parks.vic.gov.au']) {
  test(`global exact named stable source passage accepted: ${host}`,()=>{
    const {web,context}=make(`https://${host}/synthetic-qa-source/`);
    const claim=reconcileRouteEvidence(web,context).claims[0];
    assert.equal(claim.relationship,'source_passage');
    assert.equal(claim.placeId,context.selectedPlaces[0].id);
    assert.equal(claim.identityMethod,'stable_reference');
  });
}
for(const bad of ['http://www.doc.govt.nz/qa','https://user:pass@www.doc.govt.nz/qa',
  'https://www.doc.govt.nz:8443/qa','https://127.0.0.1/qa','https://[::1]/qa',
  'https://source.local/qa','https://source.internal/qa']) {
  test(`unsafe source document admission rejected: ${bad}`,()=>{
    const {web,context}=make();
    context.sourceDocuments[0].requestedURL=bad;
    assert.throws(()=>reconcileRouteEvidence(web,context),/invalid_route_evidence/);
  });
}
for(const mutation of ['not_observed','wrong_citation','wrong_stable_identity','unnamed_passage','conflicting_coordinate','ambiguous_name']) {
  test(`global source does not inherit unproved attribution: ${mutation}`,()=>{
    const {web,context}=make();
    const doc=context.sourceDocuments[0],place=context.selectedPlaces[0];
    if(mutation==='not_observed') {
      // Keep the whole web envelope valid via a different observed citation;
      // that other read must not lend attribution to the unobserved first one.
      web.retrievedSourceURLs=['https://www.nps.gov/other-source/'];
      web.blocks[0].citations.push({...web.blocks[0].citations[0],url:web.retrievedSourceURLs[0]});
    }
    if(mutation==='wrong_citation') {
      web.blocks[0].citations[0].url='https://www.nps.gov/other-source/';
      web.retrievedSourceURLs.push(web.blocks[0].citations[0].url);
    }
    if(mutation==='wrong_stable_identity')doc.passages[0].identityURLs=['https://www.openstreetmap.org/node/999'];
    if(mutation==='unnamed_passage')doc.passages[0].text='Another unrelated synthetic place is described in this paragraph.';
    if(mutation==='conflicting_coordinate')doc.entities=[{name:place.name,coordinate:{latitude:40,longitude:-70},identityURLs:[place.source.url]}];
    if(mutation==='ambiguous_name') {
      doc.passages[0].identityURLs=[];
      doc.entities=[{name:place.name,coordinate:place.coordinate,identityURLs:[]}];
      context.inspectedPlaces.push({...structuredClone(place),id:'osm:node:322',
        source:{provider:'openstreetmap',url:'https://www.openstreetmap.org/node/322'}});
    }
    const claim=reconcileRouteEvidence(web,context).claims[0];
    assert.equal(claim.relationship,'unconfirmed');
    assert.equal(claim.placeId,null);
  });
}
test('selected record cannot replace the inspected source identity',()=>{
  const {web,context}=make();
  context.selectedPlaces=[{...structuredClone(context.selectedPlaces[0]),name:'Replaced source name'}];
  assert.throws(()=>reconcileRouteEvidence(web,context),/invalid_route_evidence/);
});
for(const mutation of ['requested_other_host','canonical_other_host','canonical_private','canonical_credentials']) {
  test(`document aliases retain one public observed host: ${mutation}`,()=>{
    const {web,context}=make(),doc=context.sourceDocuments[0];
    if(mutation==='requested_other_host')doc.requestedURL='https://www.nps.gov/synthetic-qa-source/';
    if(mutation==='canonical_other_host')doc.canonicalURL='https://www.nps.gov/synthetic-qa-source/';
    if(mutation==='canonical_private')doc.canonicalURL='https://127.0.0.1/qa';
    if(mutation==='canonical_credentials')doc.canonicalURL='https://user:pass@www.doc.govt.nz/qa';
    assert.throws(()=>reconcileRouteEvidence(web,context),/invalid_route_evidence/);
  });
}
for(const mutation of ['document_count','passage_count','passage_length','entity_count']) {
  test(`global URL acceptance retains source-document bounds: ${mutation}`,()=>{
    const {web,context}=make(),doc=context.sourceDocuments[0];
    if(mutation==='document_count')context.sourceDocuments=Array.from({length:4},()=>structuredClone(doc));
    if(mutation==='passage_count')doc.passages=Array.from({length:81},()=>structuredClone(doc.passages[0]));
    if(mutation==='passage_length')doc.passages[0].text='x'.repeat(1201);
    if(mutation==='entity_count')doc.entities=Array.from({length:31},()=>({name:'Synthetic',identityURLs:[]}));
    assert.throws(()=>reconcileRouteEvidence(web,context),/invalid_route_evidence/);
  });
}
