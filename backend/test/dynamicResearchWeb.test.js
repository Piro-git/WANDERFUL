import test from 'node:test';
import assert from 'node:assert/strict';
import {parseGroundedWebResearch,createGeminiWebResearch} from '../src/dynamicResearch/webResearch.js';
const url='https://park.example.org/places/ridge';
const fixture=()=>({steps:[
 {type:'google_search_call',id:'s',arguments:{queries:['village hiking viewpoints']}},
 {type:'google_search_result',call_id:'s',result:[{search_suggestions:'<div>Provider search suggestions</div>'}]},
 {type:'url_context_call',id:'u',arguments:{urls:[url]}},
 {type:'url_context_result',call_id:'u',result:[{url,status:'success'}]},
 {type:'model_output',content:[{type:'text',text:'The park describes a ridge viewpoint.',annotations:[{type:'url_citation',url,title:'Park source',start_index:0,end_index:36}]}]}
]});
test('UTF-8 provider citations become exact native UTF-16 ranges for accented, emoji and mixed-script text',()=>{
 for(const [prefix,segment] of [['','Schöne Aussicht'],['🥾 Weg: ','Schöne Aussicht 🌄'],['日本語: ','山と滝'],['e\u0301 — ','العربية']]) {
  const f=fixture(),block=f.steps[4].content[0];
  block.text=prefix+segment+' Ende';
  Object.assign(block.annotations[0],{start_index:Buffer.byteLength(prefix),end_index:Buffer.byteLength(prefix+segment)});
  const output=parseGroundedWebResearch(f).blocks[0],citation=output.citations[0];
  assert.equal(citation.startIndex,prefix.length);
  assert.equal(citation.endIndex,(prefix+segment).length);
  assert.equal(output.text.slice(citation.startIndex,citation.endIndex),segment);
 }
});
test('partial UTF-8 scalars and malformed Unicode cannot produce native citation ranges',()=>{
 for(const [text,start,end] of [['ö',0,1],['ö',1,2],['🌄',0,3],['🌄',1,4],['山',0,2],['x\ud800',0,1]]) {
  const f=fixture(),block=f.steps[4].content[0];block.text=text;
  Object.assign(block.annotations[0],{start_index:start,end_index:end});
  assert.throws(()=>parseGroundedWebResearch(f),{code:'web_research_unverified'});
 }
});
test('grounded answer preserves full text, citation offsets, suggestions and retrieval provenance',()=>{
 const value=parseGroundedWebResearch(fixture());
 assert.equal(value.blocks[0].text,'The park describes a ridge viewpoint.');
 assert.equal(value.searchSuggestions[0],'<div>Provider search suggestions</div>');
 assert.deepEqual(value.retrievedSourceURLs,[url]);assert.equal(value.observedSearchQueries,1);
});
test('model claims alone, search without page read, and failed page retrieval cannot count as completed research',()=>{
 for(const mutate of [f=>{f.steps=f.steps.filter(s=>s.type==='model_output');},f=>{f.steps=f.steps.filter(s=>!s.type.startsWith('url_context'));},
  f=>{f.steps[3].result[0].status='paywall';},f=>{f.steps[3].result[0].url='https://different.example.org/';},
  f=>{f.steps[1].call_id='invented';},f=>{f.steps[1].result=[];}]) {
  const f=fixture();mutate(f);assert.throws(()=>parseGroundedWebResearch(f),{code:'web_research_unverified'});
 }
});
test('malformed citations, private URLs and oversized provider suggestions are rejected',()=>{
 for(const mutate of [f=>{f.steps[4].content[0].annotations[0].end_index=1000;},f=>{f.steps[4].content[0].annotations[0].url='http://127.0.0.1/';},
  f=>{f.steps[1].result[0].search_suggestions='x'.repeat(65537);},f=>{f.steps[4].content[0].annotations=[];}]) {
  const f=fixture();mutate(f);assert.throws(()=>parseGroundedWebResearch(f));
 }
});
test('documented web-search and URL-context request preserves original prompt without model coordinates or schema guessing',async()=>{
 let calls=0;
 const research=createGeminiWebResearch({apiKey:'offline-only',model:'gemini-3.8-flash',fetchImpl:async(_,init)=>{
  calls++;const body=JSON.parse(init.body);assert.equal(body.store,false);assert.equal(body.response_format,undefined);
  assert.deepEqual(body.tools,[{type:'google_search',search_types:['web_search']},{type:'url_context'}]);
  assert.equal(JSON.parse(body.input).prompt,'A waterfall walk near our cabin, please.');
  return new Response(JSON.stringify(fixture()),{headers:{'Content-Type':'application/json'}});
 }});
 assert.equal((await research({prompt:'A waterfall walk near our cabin, please.',locationName:'Resolved village'})).provider,'google_grounding');
 assert.equal(calls,1);
});

// Regression: live Google search returned citations but omitted URL context entirely.
test('search-only success completes exactly one separately accounted page-read stage',async()=>{
 const first=fixture();first.steps=first.steps.filter(s=>!s.type.startsWith('url_context'));
 let calls=0,reservations=0;
 const research=createGeminiWebResearch({apiKey:'offline-only',model:'gemini-3.8-flash',fetchImpl:async(_,init)=>{
  const body=JSON.parse(init.body);calls++;
  if(calls===1)return Response.json(first);
  assert.equal(calls,2);assert.equal(reservations,1);
  assert.deepEqual(body.tools,[{type:'url_context'}]);
  assert.deepEqual(body.input.slice(1,-1),first.steps);
  assert.deepEqual(JSON.parse(body.input.at(-1).content[0].text).urls,[url]);
  return Response.json({steps:fixture().steps.slice(2)});
 }});
 const value=await research({prompt:'Public village viewpoints',locationName:'Village'},{reserveGeneration:()=>reservations++});
 assert.equal(calls,2);assert.equal(value.blocks.length,1);assert.equal(value.observedSearchQueries,1);
 assert.deepEqual(value.retrievedSourceURLs,[url]);
});
test('failed or omitted page reads never become research success and are not retried',async()=>{
 for(const attempted of [false,true]) {
  let calls=0;const first=fixture();
  if(attempted)first.steps[3].result[0].status='paywall';
  else first.steps=first.steps.filter(s=>!s.type.startsWith('url_context'));
  const research=createGeminiWebResearch({apiKey:'offline-only',model:'gemini-3.8-flash',fetchImpl:async()=>{calls++;return Response.json(first);}});
  await assert.rejects(research({prompt:'Public walk',locationName:'Village'}),{code:'web_research_unverified'});
  assert.equal(calls,attempted?1:2);
 }
});
test('exhausted generation budget prevents the second page-read request',async()=>{
 let calls=0;const first=fixture();first.steps=first.steps.filter(s=>!s.type.startsWith('url_context'));
 const research=createGeminiWebResearch({apiKey:'offline-only',model:'gemini-3.8-flash',fetchImpl:async()=>{calls++;return Response.json(first);}});
 await assert.rejects(research({prompt:'Public walk',locationName:'Village'},{reserveGeneration:()=>{throw Object.assign(Error(),{code:'research_budget_exhausted'});}}),{code:'research_budget_exhausted'});
 assert.equal(calls,1);
});

test('full final request, preferences, constraints and hiking date reach web research unchanged',async()=>{
 const request={prompt:'Bitte Wasserfall, keine Gipfeltour; zwei Stunden.',locationName:'Ilsenburg',preferences:{interests:['waterfall'],avoid:['steep']},intent:{routeType:'loop',targetDurationMinutes:120},constraints:{maxDistanceKm:8},plannedStartAt:'2026-09-20T08:00:00+02:00'};
 const research=createGeminiWebResearch({apiKey:'offline-only',model:'gemini-3.8-flash',fetchImpl:async(_,init)=>{const input=JSON.parse(JSON.parse(init.body).input);for(const [key,value]of Object.entries(request))assert.deepEqual(input[key],value);return Response.json(fixture());}});
 await research(request);
 for(const bad of [{plannedStartAt:'tomorrow'},{preferences:'x'.repeat(4001)},{constraints:{maxDistanceKm:Infinity}}])await assert.rejects(research({...request,...bad}),/invalid_research_request/);
});
