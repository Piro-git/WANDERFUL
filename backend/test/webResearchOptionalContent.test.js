import test from 'node:test';
import assert from 'node:assert/strict';
import {parseGroundedWebResearch,createGeminiWebResearch,validateWebResearchEnvelope} from '../src/dynamicResearch/webResearch.js';
const url='https://official.example.org/viewpoint';
const text='Documented viewpoint.';
const fixture=()=>({status:'completed',steps:[
 {type:'google_search_call',id:'search',arguments:{queries:['public viewpoint']}},
 {type:'google_search_result',call_id:'search',result:[{search_suggestions:'<div>Actual fixture attribution</div>'}]},
 {type:'url_context_call',id:'page',arguments:{urls:[url]}},
 {type:'url_context_result',call_id:'page',result:[{url,status:'success'}]},
 {type:'model_output',content:[{type:'text',text,annotations:[{type:'url_citation',url,start_index:0,end_index:Buffer.byteLength(text)}]}]}
]});
test('API-optional model content and unannotated fragments do not erase independently grounded read-backed text',()=>{
 const f=fixture();f.steps.unshift({type:'model_output'});
 f.steps[5].content.unshift({type:'text',text:'SYNTHETIC_UNGROUNDED_FRAGMENT'});
 f.steps[5].content.push({type:'text',text:'Other ungrounded text.',annotations:[]});
 const web=parseGroundedWebResearch(f);
 assert.deepEqual(web.blocks.map(b=>b.text),[text]);
 assert.equal(web.blocks[0].citations[0].startIndex,0);
 assert.equal(web.blocks[0].citations[0].endIndex,text.length);
 assert.deepEqual(web.retrievedSourceURLs,[url]);
 assert.ok(!JSON.stringify(web).includes('SYNTHETIC_UNGROUNDED_FRAGMENT'));
 assert.equal(validateWebResearchEnvelope(web),web);
});
test('documented optional-content HTTP200 fixture succeeds in one call without inventing search or page-read evidence',async()=>{
 let calls=0;const f=fixture();f.steps.unshift({type:'model_output',content:[{type:'text',text:'Preparing source review.'}]});
 const research=createGeminiWebResearch({apiKey:'offline-only',model:'gemini-3.8-flash',fetchImpl:async()=>{calls++;return Response.json(f);}});
 const web=await research({prompt:'Public viewpoint walk',locationName:'Public village'});
 assert.equal(calls,1);assert.deepEqual(web.blocks.map(b=>b.text),[text]);
});

test('API-optional metadata required by the current native envelope is refused precisely, never manufactured',()=>{
 const cases=[
  ['search_queries_missing',f=>{delete f.steps[0].arguments.queries;}],
  ['search_suggestions_missing',f=>{delete f.steps[1].result[0].search_suggestions;}],
  ['citation_range_missing',f=>{delete f.steps[4].content[0].annotations[0].start_index;}],
  ['citation_range_missing',f=>{delete f.steps[4].content[0].annotations[0].end_index;}]
 ];
 for(const [reason,mutate] of cases){const f=fixture();mutate(f);assert.throws(()=>parseGroundedWebResearch(f),{code:'web_research_unverified',privateResearchValidationReason:reason});}
});
test('only ungrounded text never becomes evidence even with a successful tool call and page read',()=>{
 for(const annotations of [undefined,[]]){const f=fixture();f.steps[4].content[0].annotations=annotations;assert.throws(()=>parseGroundedWebResearch(f),{code:'web_research_unverified',privateResearchValidationReason:'grounded_text_missing'});}
});
test('optional-content compatibility preserves call correlation, public URLs, citation bounds and genuine page-read gates',()=>{
 for(const [reason,mutate] of [
  ['search_call_invalid',f=>{delete f.steps[0].id;}],
  ['search_result_invalid',f=>{f.steps[1].call_id='not-the-call';}],
  ['citation_url_invalid',f=>{f.steps[4].content[0].annotations[0].url='https://127.0.0.1/';}],
  ['citation_range_invalid',f=>{f.steps[4].content[0].annotations[0].end_index=999;}],
  ['source_page_evidence_missing',f=>{f.steps[3].result[0].status='paywall';}],
  ['source_page_evidence_missing',f=>{f.steps[3].result[0].url='https://other.example.org/';}]
 ]){const f=fixture();mutate(f);f.steps[4].content.unshift({type:'text',text:'Unverified fragment.'});assert.throws(()=>parseGroundedWebResearch(f),{code:'web_research_unverified',privateResearchValidationReason:reason});}
});
test('ignored fragments still obey total text limits and Unicode scalar validation',()=>{
 for(const [text,reason] of [['x'.repeat(12001),'web_limits_exceeded'],['bad\ud800','unicode_invalid']]){
  const f=fixture();f.steps[4].content.unshift({type:'text',text});assert.throws(()=>parseGroundedWebResearch(f),{code:'web_research_unverified',privateResearchValidationReason:reason});
 }
});
test('optional absence is distinct from malformed content and annotations',()=>{
 for(const [reason,step] of [['model_content_invalid',{type:'model_output',content:{}}],['annotation_list_invalid',{type:'model_output',content:[{type:'text',text:'fragment',annotations:{}}]}]]){
  const f=fixture();f.steps.unshift(step);assert.throws(()=>parseGroundedWebResearch(f),{code:'web_research_unverified',privateResearchValidationReason:reason});
 }
});
test('partial or failed interaction/model output is never rescued by earlier grounded text',()=>{
 for(const status of ['in_progress','requires_action','failed','cancelled','incomplete','budget_exceeded','queued']){
  const f=fixture();f.status=status;assert.throws(()=>parseGroundedWebResearch(f),{code:'web_research_unverified',privateResearchValidationReason:'provider_not_completed'});
 }
 const f=fixture();f.steps.push({type:'model_output',error:{code:13,message:'SYNTHETIC_PROVIDER_ERROR'}});
 assert.throws(()=>parseGroundedWebResearch(f),{code:'web_research_unverified',privateResearchValidationReason:'model_output_failed'});
});
test('no undocumented outputs fallback or fabricated call IDs are accepted',()=>{
 const f=fixture();assert.throws(()=>parseGroundedWebResearch({outputs:f.steps}),{code:'web_research_unverified',privateResearchValidationReason:'provider_steps_invalid'});
 delete f.steps[0].id;assert.throws(()=>parseGroundedWebResearch(f),{code:'web_research_unverified',privateResearchValidationReason:'search_call_invalid'});
});
test('missing citation offsets from HTTP200 fail once with a closed reason before any page-read followup',async()=>{
 let calls=0;const f=fixture();delete f.steps[4].content[0].annotations[0].end_index;
 const research=createGeminiWebResearch({apiKey:'offline-only',model:'gemini-3.8-flash',fetchImpl:async()=>{calls++;return Response.json(f);}});
 await assert.rejects(research({prompt:'Public walk',locationName:'Public village'}),{code:'web_research_unverified',privateResearchStage:'web_search_validation',privateResearchValidationReason:'citation_range_missing'});
 assert.equal(calls,1);
});
