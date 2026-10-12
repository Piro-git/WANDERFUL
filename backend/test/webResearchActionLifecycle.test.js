import test from 'node:test';import assert from 'node:assert/strict';
import {safePrivateFailure} from '../src/ownerAccess/privatePlanningDiagnostics.js';
import {createGeminiWebResearch} from '../src/dynamicResearch/webResearch.js';
const url='https://official.example.org/viewpoint',text='A documented viewpoint.';
const pending=()=>({status:'requires_action',steps:[{type:'thought',summary:[{type:'text',text:'Opaque model thought.'}],signature:'SYNTHETIC_THOUGHT_SIGNATURE'},{type:'function_call',id:'actual-fixture-call',name:'unregistered_lookup',arguments:{query:'Synthetic source query'}}]});
const grounded=()=>({status:'completed',steps:[{type:'google_search_call',id:'real-search',arguments:{queries:['Synthetic source query']}},{type:'google_search_result',call_id:'real-search',result:[{search_suggestions:'<div>Provider attribution</div>'}]},{type:'url_context_call',id:'read-page',arguments:{urls:[url]}},{type:'url_context_result',call_id:'read-page',result:[{url,status:'success'}]},{type:'model_output',content:[{type:'text',text,annotations:[{type:'url_citation',url,start_index:0,end_index:Buffer.byteLength(text)}]}]}]});
const req={prompt:'Public free request with route and photos',locationName:'Public village'};
test('observed pending client call gets real error feedback; one reserved stateless followup needs completed genuine grounding',async()=>{
 let calls=0,reservations=0;const first=pending();
 const research=createGeminiWebResearch({apiKey:'offline-only',model:'gemini-3.8-flash',fetchImpl:async(_,init)=>{
  const b=JSON.parse(init.body);calls++;assert.equal(b.store,false);assert.equal(b.background,undefined);assert.equal(b.previous_interaction_id,undefined);
  if(calls===1)return Response.json(first);
  assert.equal(reservations,1);assert.deepEqual(b.input.slice(1,3),first.steps);
  const r=b.input[3];assert.equal(r.type,'function_result');assert.equal(r.call_id,first.steps[1].id);assert.equal(r.name,first.steps[1].name);assert.equal(r.is_error,true);assert.equal(r.result.error.code,'unsupported_client_tool_for_research');assert.ok(!r.result.sources);
  assert.deepEqual(b.tools,[{type:'google_search',search_types:['web_search']},{type:'url_context'}]);return Response.json(grounded());
 }});
 const web=await research(req,{reserveGeneration(){reservations++;}});assert.equal(calls,2);assert.deepEqual(web.retrievedSourceURLs,[url]);assert.equal(web.blocks[0].text,text);
});
test('no second action-pending/failed/incomplete/cancelled response is treated as research or triggers a third call',async()=>{
 for(const status of ['requires_action','failed','incomplete','cancelled','queued','in_progress','budget_exceeded',undefined]){let calls=0;const research=createGeminiWebResearch({apiKey:'offline-only',model:'gemini-3.8-flash',fetchImpl:async()=>{calls++;return Response.json(calls===1?pending():{...grounded(),status});}});await assert.rejects(research(req),{code:'web_research_unverified'});assert.equal(calls,2);}
});
test('missing/duplicate/replayed call IDs, malformed arguments and unsafe history never get feedback or a second call',async()=>{
 for(const mutate of [f=>{delete f.steps[1].id;},f=>{f.steps[1].id=' ';},f=>{f.steps[1].name=42;},f=>{f.steps[0].signature={malformed:true};},f=>{f.steps[0].summary=[{type:'text',text:42}];},f=>{f.steps.push({...f.steps[1]});},f=>{f.steps[1].arguments=[];},f=>{f.steps.push({type:'function_result',call_id:f.steps[1].id,result:'already answered'});},f=>{f.steps.push({type:'code_execution_call',id:'unsafe',arguments:{code:'must not execute'}});}]){
  let calls=0;const f=pending();mutate(f);const research=createGeminiWebResearch({apiKey:'offline-only',model:'gemini-3.8-flash',fetchImpl:async()=>{calls++;return Response.json(f);}});await assert.rejects(research(req),{code:'web_research_unverified'});assert.equal(calls,1);
 }
});
test('budget exhaustion or cancellation after pending response prevents the followup fetch',async()=>{
 let calls=0;const research=createGeminiWebResearch({apiKey:'offline-only',model:'gemini-3.8-flash',fetchImpl:async()=>{calls++;return Response.json(pending());}});
 await assert.rejects(research(req,{reserveGeneration(){throw Object.assign(Error(),{code:'research_budget_exhausted'});}}),{code:'research_budget_exhausted'});assert.equal(calls,1);
 const c=new AbortController();calls=0;await assert.rejects(research(req,{signal:c.signal,reserveGeneration(){c.abort();}}));assert.equal(calls,1);
});
test('completed without genuine search/read/citations after feedback still fails closed',async()=>{
 for(const mutate of [f=>{f.steps=f.steps.filter(s=>s.type!=='google_search_result');},f=>{f.steps[3].result[0].status='paywall';},f=>{f.steps[4].content[0].annotations=[];}]){let calls=0;const f=grounded();mutate(f);const research=createGeminiWebResearch({apiKey:'offline-only',model:'gemini-3.8-flash',fetchImpl:async()=>{calls++;return Response.json(calls===1?pending():f);}});await assert.rejects(research(req));assert.equal(calls,2);}
});

test('false, asynchronous rejection and expired entitlement cannot start recovery IO',async()=>{
 for(const reserveGeneration of [()=>false,async()=>{throw Object.assign(Error(),{code:'research_budget_exhausted'});},()=>{throw Object.assign(Error(),{code:'route_session_expired'});}]){
  let calls=0;const research=createGeminiWebResearch({apiKey:'offline-only',model:'gemini-3.8-flash',fetchImpl:async()=>{calls++;return Response.json(pending());}});
  await assert.rejects(research(req,{reserveGeneration}));assert.equal(calls,1);
 }
});
test('provider rejection after truthful feedback stops after one attempt',async()=>{
 let calls=0;const research=createGeminiWebResearch({apiKey:'offline-only',model:'gemini-3.8-flash',fetchImpl:async()=>{calls++;return calls===1?Response.json(pending()):new Response('Unretained rejection body',{status:503});}});
 await assert.rejects(research(req),e=>e.code==='provider_unavailable'&&e.privateResearchStage==='web_action_http');assert.equal(calls,2);
});

test('actual search records before pending action survive into the completed read-backed answer',async()=>{
 let calls=0;const initial=pending(),complete=grounded();initial.steps.unshift(...complete.steps.slice(0,2));
 initial.steps.push({type:'model_output',content:[{type:'text',text:'Unfinished text must not be promoted.'}]});
 const research=createGeminiWebResearch({apiKey:'offline-only',model:'gemini-3.8-flash',fetchImpl:async(_,init)=>{
  calls++;if(calls===1)return Response.json(initial);
  assert.deepEqual(JSON.parse(init.body).input.slice(1,1+initial.steps.length),initial.steps);
  return Response.json({...complete,steps:complete.steps.slice(2)});
 }});const web=await research(req);assert.equal(calls,2);assert.equal(web.observedSearchCalls,1);assert.equal(web.blocks.length,1);assert.equal(web.blocks[0].text,text);
});
test('page read following recovery preserves the exact entire stateless prefix and every opaque signature',async()=>{
 let calls=0,reservations=0,recoveryInput;const first=pending(),complete=grounded();
 const resumed={status:'completed',steps:[{type:'thought',signature:'SYNTHETIC_RESUMED_SIGNATURE'},...complete.steps.slice(0,2),complete.steps[4]]};
 const read={status:'completed',steps:complete.steps.slice(2)};
 const research=createGeminiWebResearch({apiKey:'offline-only',model:'gemini-3.8-flash',fetchImpl:async(_,init)=>{
  calls++;const body=JSON.parse(init.body);assert.equal(body.store,false);assert.equal(body.previous_interaction_id,undefined);
  if(calls===1)return Response.json(first);
  assert.equal(reservations,calls-1);
  if(calls===2){recoveryInput=body.input;return Response.json(resumed);}
  assert.deepEqual(body.input.slice(0,-1),[...recoveryInput,...resumed.steps]);
  assert.deepEqual(body.tools,[{type:'url_context'}]);return Response.json(read);
 }});const web=await research(req,{reserveGeneration(){reservations++;}});assert.equal(calls,3);assert.equal(reservations,2);assert.deepEqual(web.retrievedSourceURLs,[url]);
});
test('duplicate or conflicting earlier tool IDs and pending readback never authorize research',async()=>{
 for(const change of [r=>{r.steps[0].id='actual-fixture-call';},r=>{r.steps.unshift({type:'code_execution_call',id:'never-execute',arguments:{code:'unsafe'}});},r=>{r.steps.unshift({type:'thought',signature:42});},r=>{r.steps.unshift({type:'function_call',id:'next-client',name:'unknown',arguments:{}});},r=>{r.steps[1].call_id='nonexistent';}]){
  let calls=0;const r=grounded();change(r);const research=createGeminiWebResearch({apiKey:'offline-only',model:'gemini-3.8-flash',fetchImpl:async()=>{calls++;return Response.json(calls===1?pending():r);}});
  await assert.rejects(research(req));assert.equal(calls,2);
 }
 for(const status of ['requires_action','incomplete','failed',undefined]){
  let calls=0;const g=grounded();const search={status:'completed',steps:[...g.steps.slice(0,2),g.steps[4]]};
  const research=createGeminiWebResearch({apiKey:'offline-only',model:'gemini-3.8-flash',fetchImpl:async()=>{calls++;return Response.json(calls===1?pending():calls===2?search:{...g,status,steps:g.steps.slice(2)});}});
  await assert.rejects(research(req));assert.equal(calls,3);
 }
});
test('bounded invalid histories and exhausted readback reservation cannot start another fetch',async()=>{
 const cases=[f=>{f.steps[1].arguments.query='x'.repeat(65537);},f=>{f.steps[1].arguments.query={a:{a:{a:{a:{a:{a:{a:{a:{a:{}}}}}}}}}};},f=>{f.steps.unshift({type:'google_search_result',call_id:'unknown',result:[]});},f=>{f.steps.unshift({type:'url_context_call',id:'read',arguments:{urls:['http://localhost/']}});}];
 for(const change of cases){let calls=0;const first=pending();change(first);const research=createGeminiWebResearch({apiKey:'offline-only',model:'gemini-3.8-flash',fetchImpl:async()=>{calls++;return Response.json(first);}});await assert.rejects(research(req));assert.equal(calls,1);}
 let calls=0,reserves=0;const g=grounded(),search={status:'completed',steps:[...g.steps.slice(0,2),g.steps[4]]};
 const research=createGeminiWebResearch({apiKey:'offline-only',model:'gemini-3.8-flash',fetchImpl:async()=>{calls++;return Response.json(calls===1?pending():search);}});
 await assert.rejects(research(req,{reserveGeneration(){return ++reserves<2;}}),{code:'research_budget_exhausted'});assert.equal(calls,2);
});

test('invalid completed recovery never invents a requires-action status in diagnostics',async()=>{
 let calls=0;const completed=grounded();completed.steps.unshift({type:'function_call',id:'invalid-extra',name:'unknown',arguments:{}});
 const research=createGeminiWebResearch({apiKey:'offline-only',model:'gemini-3.8-flash',fetchImpl:async()=>{calls++;return Response.json(calls===1?pending():completed);}});
 await assert.rejects(research(req),error=>{
  const summary=safePrivateFailure(error);assert.equal(summary.diagnosticValidationReason,'research_action_invalid');
  assert.equal(summary.diagnosticStage,'web_action_validation');assert.equal(summary.diagnosticProviderStatus,undefined);return true;
 });assert.equal(calls,2);
});
