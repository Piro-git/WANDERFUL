import test from 'node:test';
import assert from 'node:assert/strict';
import {parseGroundedWebResearch,validateWebResearchEnvelope} from '../src/dynamicResearch/webResearch.js';
const url='https://official.example.org/viewpoint';
const fixture=()=>({steps:[{type:'google_search_call',id:'s',arguments:{queries:['public viewpoint']}},{type:'google_search_result',call_id:'s',result:[{search_suggestions:'<div>Search attribution</div>'}]},{type:'url_context_call',id:'u',arguments:{urls:[url]}},{type:'url_context_result',call_id:'u',result:[{url,status:'success'}]},{type:'model_output',content:[{type:'text',text:'Documented viewpoint.',annotations:[{type:'url_citation',url,start_index:0,end_index:21}]}]}]});
test('documented optional title absence preserves actual source/citation/read evidence with host-only label',()=>{
 const envelope=parseGroundedWebResearch(fixture());assert.equal(envelope.blocks[0].citations[0].title,'official.example.org');assert.equal(envelope.blocks[0].citations[0].url,url);assert.deepEqual(envelope.retrievedSourceURLs,[url]);assert.equal(validateWebResearchEnvelope(envelope),envelope);
});
test('provided public title is preserved; missing display metadata never manufactures source facts',()=>{
 const f=fixture();f.steps[4].content[0].annotations[0].title='Official park page';assert.equal(parseGroundedWebResearch(f).blocks[0].citations[0].title,'Official park page');
});
test('title compatibility cannot bypass ranges, public URL, actual read, call correlation or attribution checks',()=>{
 for(const mutate of [f=>{delete f.steps[4].content[0].annotations[0].url;},f=>{f.steps[4].content[0].annotations[0].end_index=999;},f=>{f.steps[3].result[0].status='paywall';},f=>{f.steps[1].call_id='unmatched';},f=>{f.steps[4].content[0].annotations[0].url='http://127.0.0.1/';},f=>{f.steps[4].content[0].annotations[0].title={body:'untrusted'};}]){
  const f=fixture();mutate(f);assert.throws(()=>parseGroundedWebResearch(f),{code:'web_research_unverified'});
 }
});
