import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseGroundedWebResearch,validateWebResearchEnvelope,createGeminiWebResearch} from '../src/dynamicResearch/webResearch.js';
import {createSourceDocumentLookup} from '../src/dynamicResearch/sourceDocuments.js';
import {reconcileRouteEvidence,validateRouteEvidence} from '../src/dynamicResearch/evidence.js';
const url='https://www.openstreetmap.org/node/1';
const text='🥾 Schöne 山 e\u0301 — synthetic source context.';
const fixture=()=>({status:'completed',steps:[
 {type:'google_search_call',id:'s',arguments:{}},
 {type:'google_search_result',call_id:'s',result:[{}]},
 {type:'url_context_call',id:'u',arguments:{urls:[url]}},
 {type:'url_context_result',call_id:'u',result:[{url,status:'success'}]},
 {type:'model_output',content:[{type:'text',text,annotations:[{type:'url_citation',url}]}]}
]});
const now=Date.parse('2026-09-07T00:00:00Z');
const parsed=f=>parseGroundedWebResearch(f,{now});
const citation=f=>f.steps[4].content[0].annotations[0];
const place={id:'osm:node:1',name:'Synthetic place',source:{provider:'openstreetmap',url}};
const context={routeId:'measured-1',selectedPlaces:[place],inspectedPlaces:[place]};

test('documented optional metadata shared fixture decodes to truthful source references and unknown query count',()=>{
 const web=parsed(fixture());validateWebResearchEnvelope(web);
 assert.equal(web.observedSearchQueries,null);assert.equal(web.observedSearchCalls,1);
 assert.deepEqual(web.searchSuggestions,[]);assert.deepEqual(web.blocks,[{text,citations:[{url,title:'www.openstreetmap.org',scope:'source'}]}]);
 assert.deepEqual(JSON.parse(readFileSync(new URL('../../TrailMindTests/Fixtures/dynamic-web-optional-metadata.json',import.meta.url))),web);
});
test('empty documented lists and mixed disclosed/undisclosed calls never fabricate the query total',()=>{
 const f=fixture();f.steps[0].arguments.queries=[];f.steps[1].result=[];
 assert.equal(parsed(f).observedSearchQueries,0);validateWebResearchEnvelope(parsed(f));
 for(const unknownFirst of [false,true]) {
  const g=fixture();if(!unknownFirst)g.steps[0].arguments.queries=['actual fixture query'];
  g.steps.splice(2,0,{type:'google_search_call',id:'second',arguments:unknownFirst?{queries:['actual fixture query']}:{}},
   {type:'google_search_result',call_id:'second',result:[{}]});
  assert.equal(parsed(g).observedSearchQueries,null);assert.equal(parsed(g).observedSearchCalls,2);
 }
});
test('missing one/both byte offsets produce no invented span; supplied complete spans still convert to UTF16',()=>{
 for(const annotation of [{},{start_index:0},{end_index:Buffer.byteLength(text)}]) {
  const f=fixture();Object.assign(citation(f),annotation);assert.equal(parsed(f).blocks[0].citations[0].scope,'source');
  assert.equal(parsed(f).blocks[0].citations[0].startIndex,undefined);validateWebResearchEnvelope(parsed(f));
 }
 const f=fixture();Object.assign(citation(f),{start_index:5,end_index:Buffer.byteLength(text)});
 assert.equal(parsed(f).blocks[0].citations[0].scope,'passage');assert.equal(parsed(f).blocks[0].citations[0].startIndex,3);
});
test('partial metadata cannot hide malformed values, unsafe URLs, scalar splits or incomplete tool evidence',()=>{
 const cases=[
  ['provider_steps_invalid',f=>{f.steps.unshift(null);}],
  ['search_call_invalid',f=>{delete f.steps[0].arguments;}],
  ['search_call_invalid',f=>{f.steps[0].arguments.queries=null;}],
  ['search_call_invalid',f=>{f.steps[0].arguments.queries=[''];}],
  ['search_result_invalid',f=>{f.steps[1].result=[null];}],
  ['search_result_invalid',f=>{f.steps[1].call_id='other';}],
  ['search_result_invalid',f=>{f.steps[1].is_error=true;}],
  ['search_result_invalid',f=>{f.steps[1].is_error='false';}],
  ['search_suggestions_invalid',f=>{f.steps[1].result[0].search_suggestions=null;}],
  ['search_suggestions_invalid',f=>{f.steps[1].result[0].search_suggestions=' ';}],
  ['page_call_invalid',f=>{f.steps[2].id='s';}],
  ['page_result_invalid',f=>{f.steps[3].call_id='other';}],
  ['page_result_invalid',f=>{f.steps[3].result=[null];}],
  ['page_result_invalid',f=>{f.steps[3].result[0].url='https://different.example.org/';}],
  ['source_page_evidence_missing',f=>{f.steps[3].is_error=true;}],
  ['source_page_evidence_missing',f=>{f.steps[3].result=[];}],
  ['source_page_evidence_missing',f=>{delete f.steps[3].result[0].status;}],
  ['source_page_evidence_missing',f=>{f.steps[3].result[0].status='paywall';}],
  ['citation_url_invalid',f=>{delete citation(f).url;}],
  ['citation_url_invalid',f=>{citation(f).url='https://host.local/';}],
  ['citation_range_invalid',f=>{citation(f).start_index=1;}],
  ['citation_range_invalid',f=>{citation(f).end_index=3;}],
  ['citation_range_invalid',f=>{citation(f).end_index=999;}],
  ['citation_range_invalid',f=>{citation(f).start_index=null;}],
  ['citation_range_invalid',f=>{Object.assign(citation(f),{start_index:5,end_index:5});}],
  ['search_evidence_missing',f=>{f.steps=f.steps.filter(s=>!s.type.startsWith('google_search'));}],
  ['search_evidence_missing',f=>{f.steps.splice(1,1);}],
  ['page_result_invalid',f=>{f.steps.splice(4,0,structuredClone(f.steps[3]));}],
  ['search_result_invalid',f=>{f.steps.splice(2,0,structuredClone(f.steps[1]));}]
 ];
 for(const [reason,mutate] of cases){const f=fixture();mutate(f);assert.throws(()=>parsed(f),{code:'web_research_unverified',privateResearchValidationReason:reason});}
});
test('source-only references cannot acquire sentence/stop claims even for an exact successfully read OSM identity',()=>{
 const web=parsed(fixture()),evidence=reconcileRouteEvidence(web,context);
 assert.deepEqual(evidence.claims,[{id:'b0-c0',blockIndex:0,citationIndex:0,placeId:null,relationship:'unconfirmed'}]);
 evidence.claims[0].placeId=place.id;evidence.claims[0].relationship='source_identity';
 assert.throws(()=>validateRouteEvidence(evidence,web,context),{code:'invalid_route_evidence'});
});
test('source-only references each need their own successful read; one other read cannot authorize a URL',()=>{
 const f=fixture();f.steps[4].content[0].annotations.push({type:'url_citation',url:'https://other.example.org/source'});
 assert.throws(()=>parsed(f),{privateResearchValidationReason:'source_page_evidence_missing'});
 const web=parsed(fixture());web.blocks[0].citations.push({url:'https://other.example.org/source',title:'Other',scope:'source'});
 assert.throws(()=>validateWebResearchEnvelope(web),{privateResearchValidationReason:'source_page_evidence_missing'});
});
test('unknown totals require separate call evidence and unknown scopes / synthetic spans fail closed',()=>{
 for(const mutate of [w=>{delete w.observedSearchCalls;},w=>{w.observedSearchCalls=0;},w=>{w.observedSearchCalls=null;},
  w=>{w.blocks[0].citations[0].scope='verified';},w=>{w.blocks[0].citations[0].startIndex=0;},w=>{w.observedSearchQueries=-1;},w=>{w.observedSearchQueries=1201;}]) {
  const web=parsed(fixture());mutate(web);assert.throws(()=>validateWebResearchEnvelope(web));
 }
});
test('optional metadata retains original history/IDs in the separately accounted page-read followup and partial followup is refused',async()=>{
 for(const status of ['completed','incomplete']) {
  const first=fixture();first.steps=first.steps.filter(s=>!s.type.startsWith('url_context'));
  let calls=0,reserves=0;
  const research=createGeminiWebResearch({apiKey:'offline-only',model:'gemini-3.8-flash',fetchImpl:async(_,init)=>{
   if(++calls===1)return Response.json(first);
   const body=JSON.parse(init.body);assert.deepEqual(body.input.slice(1,-1),first.steps);assert.equal(reserves,1);
   return Response.json({status,steps:fixture().steps.slice(2)});
  }});
  if(status==='completed') {const web=await research({prompt:'Synthetic walk',locationName:'Synthetic village'},{reserveGeneration:()=>reserves++});validateWebResearchEnvelope(web);assert.equal(web.observedSearchQueries,null);}
  else await assert.rejects(research({prompt:'Synthetic walk',locationName:'Synthetic village'},{reserveGeneration:()=>reserves++}),{privateResearchValidationReason:'provider_not_completed'});
  assert.equal(calls,2);
 }
});

test('source references cannot trigger sentence-based document matching or source-passage collection',async()=>{
 let calls=0;
 const lookup=createSourceDocumentLookup({userAgent:'Synthetic contract test',fetchImpl:async()=>{calls++;throw Error('unexpected fetch');},publicFetchImpl:async()=>{calls++;throw Error('unexpected fetch');}});
 const web=parsed(fixture());web.blocks[0].text=place.name+' is only synthetic context.';
 assert.deepEqual(await lookup({web,places:[place]}),{documents:[],sources:[]});assert.equal(calls,0);
});
