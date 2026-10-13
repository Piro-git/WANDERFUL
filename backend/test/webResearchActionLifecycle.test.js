import test from 'node:test';
import assert from 'node:assert/strict';
import {createGeminiWebResearch,parseGroundedWebResearch} from '../src/dynamicResearch/webResearch.js';
import {researchInteractionBody,RESEARCH_SYSTEM_INSTRUCTION,validateResearchHistory} from '../src/dynamicResearch/researchProtocol.js';
import {safePrivateFailure} from '../src/ownerAccess/privatePlanningDiagnostics.js';
const url='https://official.example.org/viewpoint',text='A documented viewpoint.';
const pending=()=>({status:'requires_action',steps:[{type:'thought',signature:'SYNTHETIC_SIGNATURE'},{type:'function_call',id:'synthetic-call',name:'unknown_fixture_function',arguments:{query:'Synthetic query'}}]});
const grounded=()=>({status:'completed',steps:[{type:'google_search_call',id:'s',arguments:{queries:['Synthetic source query']}},{type:'google_search_result',call_id:'s',result:[{}]},{type:'url_context_call',id:'u',arguments:{urls:[url]}},{type:'url_context_result',call_id:'u',result:[{url,status:'success'}]},{type:'model_output',content:[{type:'text',text,annotations:[{type:'url_citation',url,start_index:0,end_index:Buffer.byteLength(text)}]}]}]});
const req={prompt:'Build a route with real viewpoints and Wikimedia photos',locationName:'Public village'};
const expectedTools=[{type:'google_search',search_types:['web_search']},{type:'url_context'}];
test('first source-research request sets documented validated mode and system phase scope while preserving full user wishes',async()=>{
 let calls=0;const request={...req,preferences:{interests:['viewpoint']},constraints:{maxDistanceKm:15},plannedStartAt:'2026-11-01T08:00:00Z'};
 const research=createGeminiWebResearch({apiKey:'offline-only',model:'gemini-3.8-flash',fetchImpl:async(url,init)=>{
  calls++;assert.equal(url.href,'https://generativelanguage.googleapis.com/v1beta/interactions');const b=JSON.parse(init.body);
  assert.deepEqual(b.generation_config,{tool_choice:'validated'});assert.equal(b.system_instruction,RESEARCH_SYSTEM_INSTRUCTION);
  assert.equal(b.store,false);assert.equal(b.background,undefined);assert.equal(b.previous_interaction_id,undefined);assert.equal(b.response_format,undefined);
  assert.deepEqual(b.tools,expectedTools);for(const [key,value] of Object.entries(request))assert.deepEqual(JSON.parse(b.input)[key],value);
  return Response.json(grounded());
 }});await research(request);assert.equal(calls,1);
});
test('observed repeated-requires-action pattern stops after the first response, without dispatcher feedback or recovery spend',async()=>{
 let calls=0,reserves=0;const research=createGeminiWebResearch({apiKey:'offline-only',model:'gemini-3.8-flash',fetchImpl:async()=>{calls++;return Response.json(pending());}});
 await assert.rejects(research(req,{reserveGeneration(){reserves++;}}),error=>{
  const summary=safePrivateFailure(error);assert.deepEqual(summary,{diagnosticCode:'web_research_unverified',diagnosticStage:'web_search_validation',diagnosticValidationReason:'provider_not_completed',diagnosticProviderStatus:'requires_action',diagnosticPendingBuiltinCalls:0,diagnosticPendingPlanningCalls:0,diagnosticPendingOtherCalls:1});return true;
 });assert.equal(calls,1);assert.equal(reserves,0);
});
test('every noncompleted provider state stays terminal without tool execution or another HTTP request',async()=>{
 for(const status of ['requires_action','incomplete','failed','cancelled','queued','in_progress','budget_exceeded']){
  let calls=0;const f=grounded();f.status=status;const research=createGeminiWebResearch({apiKey:'offline-only',model:'gemini-3.8-flash',fetchImpl:async()=>{calls++;return Response.json(f);}});
  await assert.rejects(research(req),{code:'web_research_unverified'});assert.equal(calls,1);
 }
});
test('research request builder cannot introduce client/MCP/extra tools or guessed allowed-tools builtin names',()=>{
 for(const tools of [[{type:'function',name:'unknown',parameters:{}}],[{type:'mcp_server',url:'https://untrusted.example.org'}],[...expectedTools,{type:'function'}],[{type:'google_search',search_types:['image_search']}],[{type:'url_context',name:'invented'}],[{type:'url_context'},{type:'url_context'}]])assert.throws(()=>researchInteractionBody({input:'Public request',tools,model:'gemini-3.8-flash'}));
 const body=researchInteractionBody({input:'Public request',tools:expectedTools,model:'gemini-3.8-flash'});assert.equal(body.generation_config.tool_choice,'validated');assert.equal(body.generation_config.allowed_tools,undefined);
});
test('completed payload containing any client function or undeclared executable step cannot become research',()=>{
 for(const step of [{type:'function_call',id:'x',name:'unknown',arguments:{}},{type:'function_result',call_id:'x',result:'invented'},{type:'code_execution_call',id:'x',arguments:{code:'unsafe'}}]){
  const f=grounded();f.steps.push(step);assert.throws(()=>parseGroundedWebResearch(f),{code:'web_research_unverified'});
 }
});
test('one existing page read retains the exact successful history/signatures and validated policy, with its own reservation',async()=>{
 let calls=0,reserves=0;const first=grounded();first.steps=first.steps.filter(s=>!s.type.startsWith('url_context'));first.steps.unshift({type:'thought',signature:'SYNTHETIC_OPAQUE_SIGNATURE'});
 const research=createGeminiWebResearch({apiKey:'offline-only',model:'gemini-3.8-flash',fetchImpl:async(_,init)=>{
  calls++;const body=JSON.parse(init.body);assert.deepEqual(body.generation_config,{tool_choice:'validated'});assert.equal(body.system_instruction,RESEARCH_SYSTEM_INSTRUCTION);
  if(calls===1)return Response.json(first);
  assert.equal(reserves,1);assert.deepEqual(body.input.slice(1,-1),first.steps);assert.deepEqual(body.tools,[{type:'url_context'}]);return Response.json({...grounded(),steps:grounded().steps.slice(2)});
 }});await research(req,{reserveGeneration(){reserves++;}});assert.equal(calls,2);
});
test('pending/failed/incomplete page read does not trigger a retry or accept earlier search output',async()=>{
 for(const status of ['requires_action','incomplete','failed']){let calls=0;const first=grounded();first.steps=first.steps.filter(s=>!s.type.startsWith('url_context'));
  const research=createGeminiWebResearch({apiKey:'offline-only',model:'gemini-3.8-flash',fetchImpl:async()=>{calls++;return Response.json(calls===1?first:{...grounded(),status,steps:grounded().steps.slice(2)});}});
  await assert.rejects(research(req));assert.equal(calls,2);
 }
});
test('false/asynchronously rejected/expired reservations and cancellation prevent source-read IO',async()=>{
 for(const reserve of [()=>false,async()=>{throw Object.assign(Error(),{code:'research_budget_exhausted'});},()=>{throw Object.assign(Error(),{code:'route_session_expired'});}]){
  let calls=0;const first=grounded();first.steps=first.steps.filter(s=>!s.type.startsWith('url_context'));const research=createGeminiWebResearch({apiKey:'offline-only',model:'gemini-3.8-flash',fetchImpl:async()=>{calls++;return Response.json(first);}});await assert.rejects(research(req,{reserveGeneration:reserve}));assert.equal(calls,1);
 }
 const controller=new AbortController();let calls=0;const first=grounded();first.steps=first.steps.filter(s=>!s.type.startsWith('url_context'));const research=createGeminiWebResearch({apiKey:'offline-only',model:'gemini-3.8-flash',fetchImpl:async()=>{calls++;return Response.json(first);}});await assert.rejects(research(req,{signal:controller.signal,reserveGeneration(){controller.abort();}}));assert.equal(calls,1);
});
test('malformed/oversized request history is rejected before any followup IO',()=>{
 for(const h of [[{type:'thought',signature:'x'.repeat(65537)}],[{type:'thought',value:{a:{a:{a:{a:{a:{a:{a:{a:{a:{}}}}}}}}}}}]])assert.throws(()=>validateResearchHistory(h));
});

test('HTTP rejection of validated protocol never falls back to auto or another endpoint/model',async()=>{
 let calls=0;const research=createGeminiWebResearch({apiKey:'offline-only',model:'gemini-3.8-flash',fetchImpl:async()=>{calls++;return new Response('UNRETAINED_PROVIDER_MESSAGE',{status:400});}});
 await assert.rejects(research(req),{code:'provider_rejected',privateResearchStage:'web_search_http'});assert.equal(calls,1);
});
test('pending diagnostics classify only exact declared builtin/planning/unknown names with counts and no raw values',async()=>{
 const marker='SYNTHETIC_PRIVATE_NAME_ARGS_ID_URL';const f=pending();f.steps=[...['google_search','url_context','search_places','resolve_named_place','route_itinerary','review_route_quality',marker].map(name=>({type:'function_call',name,id:marker,arguments:{private:marker}}))];
 const research=createGeminiWebResearch({apiKey:'offline-only',model:'gemini-3.8-flash',fetchImpl:async()=>Response.json(f)});
 await assert.rejects(research(req),e=>{const s=safePrivateFailure(e);assert.equal(s.diagnosticPendingBuiltinCalls,2);assert.equal(s.diagnosticPendingPlanningCalls,4);assert.equal(s.diagnosticPendingOtherCalls,1);assert.ok(!JSON.stringify(s).includes(marker));return true;});
 let calls=0;const first=grounded();first.steps=first.steps.filter(s=>!s.type.startsWith('url_context'));
 const read=createGeminiWebResearch({apiKey:'offline-only',model:'gemini-3.8-flash',fetchImpl:async()=>{calls++;return Response.json(calls===1?first:{status:'requires_action',steps:[{type:'function_call',name:'google_search',id:marker,arguments:{}}]});}});
 await assert.rejects(read(req),e=>{const s=safePrivateFailure(e);assert.equal(s.diagnosticPendingBuiltinCalls,0);assert.equal(s.diagnosticPendingOtherCalls,1);return true;});assert.equal(calls,2);
});

test('live adapter requires actual completed status on both HTTP responses, even with otherwise valid grounded steps',async()=>{
 for(const status of [undefined,null,'NOT_A_REAL_STATUS',42,{private:'must not log'}]){
  let calls=0,reserves=0;const f=grounded();f.status=status;const research=createGeminiWebResearch({apiKey:'offline-only',model:'gemini-3.8-flash',fetchImpl:async()=>{calls++;return Response.json(f);}});
  await assert.rejects(research(req,{reserveGeneration(){reserves++;}}),{code:'web_research_unverified',privateResearchValidationReason:'provider_not_completed',privateResearchProviderStatus:'unrecognized'});assert.equal(calls,1);assert.equal(reserves,0);
  calls=0;const first=grounded();first.steps=first.steps.filter(s=>!s.type.startsWith('url_context'));const read=createGeminiWebResearch({apiKey:'offline-only',model:'gemini-3.8-flash',fetchImpl:async()=>{calls++;return Response.json(calls===1?first:{...f,steps:f.steps.slice(2)});}});
  await assert.rejects(read(req),{code:'web_research_unverified',privateResearchValidationReason:'provider_not_completed'});assert.equal(calls,2);
 }
});
