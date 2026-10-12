import test from 'node:test';
import assert from 'node:assert/strict';
import {safePrivateFailure,createPrivatePlanningLogger} from '../src/ownerAccess/privatePlanningDiagnostics.js';
import {createGeminiWebResearch} from '../src/dynamicResearch/webResearch.js';
const SECRET='SYNTHETIC_PRIVATE_PROMPT_COORD_TOKEN_KEY_MARKER';
test('private logger emits only exact closed enums and bounded counts/status; arbitrary bodies/URLs/errors never leave',()=>{
 const rows=[];const logger=createPrivatePlanningLogger({info:x=>rows.push(x)});
 logger.info({event:'owner_provider_attempt_completed',provider:'google',phase:'web_grounding',httpStatus:400,message:SECRET,body:SECRET,prompt:SECRET,url:SECRET,coordinates:[1,2],token:SECRET});
 logger.info({event:'llm_first_planning_completed',diagnosticCode:'provider_rejected',diagnosticStage:'web_search_http',errorCode:'research_unavailable',durationBucket:'1s_to_5s',stack:SECRET,requestId:SECRET,resultState:SECRET});
 assert.deepEqual(rows[0],{event:'owner_provider_attempt_completed',provider:'google',phase:'web_grounding',httpStatus:400});
 assert.equal(rows[1].diagnosticStage,'web_search_http');assert.ok(!JSON.stringify(rows).includes(SECRET));
 logger.info({event:SECRET,message:SECRET});assert.equal(rows.length,2);
 logger.info({event:'owner_provider_attempt_failed',provider:SECRET,phase:SECRET,httpStatus:999,diagnosticStage:SECRET,diagnosticCode:SECRET});assert.deepEqual(rows[2],{event:'owner_provider_attempt_failed'});
});
test('error code/stage summary never copies messages/stacks/provider data; logging failures cannot change response',()=>{
 assert.deepEqual(safePrivateFailure({code:'provider_rejected',privateResearchStage:'web_search_http',message:SECRET,stack:SECRET}),{diagnosticCode:'provider_rejected',diagnosticStage:'web_search_http'});
 assert.deepEqual(safePrivateFailure({code:SECRET,privateResearchStage:SECRET}),{diagnosticCode:'unclassified',diagnosticStage:'unclassified'});
 assert.doesNotThrow(()=>createPrivatePlanningLogger({info(){throw Error(SECRET);}}).info({event:'owner_provider_attempt_failed'}));
});
test('actual HTTP rejection category is tagged as web HTTP without parsing/reflecting secret provider body; no automatic retry',async()=>{
 for(const [status,code] of [[400,'provider_rejected'],[403,'configuration_missing'],[429,'rate_limited'],[503,'provider_unavailable']]){
  let calls=0;const fn=createGeminiWebResearch({apiKey:'offline-only',model:'gemini-3.8-flash',fetchImpl:async()=>{calls++;return new Response(SECRET,{status});}});
  await assert.rejects(fn({prompt:'Public test walk',locationName:'Public town'}),e=>e.code===code&&e.privateResearchStage==='web_search_http'&&!e.message.includes(SECRET));assert.equal(calls,1);
 }
});
test('HTTP success with invalid grounded shape is a distinct validation stage, unchanged failclosed outcome, no more network',async()=>{
 let calls=0;const fn=createGeminiWebResearch({apiKey:'offline-only',model:'gemini-3.8-flash',fetchImpl:async()=>{calls++;return Response.json({steps:[],sensitive:SECRET});}});
 await assert.rejects(fn({prompt:'Public test walk',locationName:'Public town'}),e=>e.code==='web_research_unverified'&&e.privateResearchStage==='web_search_validation'&&!JSON.stringify(safePrivateFailure(e)).includes(SECRET));assert.equal(calls,1);
});

test('closed validation subreason is preserved while arbitrary provider shape values remain private',()=>{
 const rows=[],logger=createPrivatePlanningLogger({info:x=>rows.push(x)});
 const summary=safePrivateFailure({code:'web_research_unverified',privateResearchStage:'web_search_validation',privateResearchValidationReason:'citation_range_missing',message:SECRET,body:SECRET});
 assert.deepEqual(summary,{diagnosticCode:'web_research_unverified',diagnosticStage:'web_search_validation',diagnosticValidationReason:'citation_range_missing'});
 logger.info({event:'llm_first_planning_completed',...summary,providerShape:SECRET});
 assert.equal(rows[0].diagnosticValidationReason,'citation_range_missing');
 const unknown=safePrivateFailure({code:'web_research_unverified',privateResearchStage:'web_search_validation',privateResearchValidationReason:SECRET});
 assert.equal(unknown.diagnosticValidationReason,undefined);
 logger.info({event:'llm_first_planning_completed',diagnosticValidationReason:SECRET});
 assert.deepEqual(rows[1],{event:'llm_first_planning_completed'});
 assert.ok(!JSON.stringify(rows).includes(SECRET));
});

test('non-completed provider lifecycle emits only documented closed states and never raw provider status/body',async()=>{
 const states=['in_progress','requires_action','failed','cancelled','incomplete','budget_exceeded','queued'];
 for(const status of [...states,SECRET,null,42,{private:SECRET}]){
  let calls=0;const research=createGeminiWebResearch({apiKey:'offline-only',model:'gemini-3.8-flash',fetchImpl:async()=>{calls++;return Response.json({status,steps:[],private:SECRET});}});
  await assert.rejects(research({prompt:'Public test walk',locationName:'Public town'}),error=>{
   const summary=safePrivateFailure(error),rows=[];
   assert.equal(summary.diagnosticValidationReason,'provider_not_completed');
   assert.equal(summary.diagnosticStage,'web_search_validation');
   assert.equal(summary.diagnosticProviderStatus,states.includes(status)?status:'unrecognized');
   createPrivatePlanningLogger({info:x=>rows.push(x)}).info({event:'llm_first_planning_completed',...summary,body:SECRET});
   assert.equal(rows[0].diagnosticProviderStatus,summary.diagnosticProviderStatus);
   assert.ok(!JSON.stringify(rows).includes(SECRET));return true;
  });assert.equal(calls,1);
 }
 const summary=safePrivateFailure({code:'web_research_unverified',privateResearchProviderStatus:SECRET});assert.equal(summary.diagnosticProviderStatus,undefined);
 const rows=[];createPrivatePlanningLogger({info:x=>rows.push(x)}).info({event:'llm_first_planning_completed',diagnosticProviderStatus:SECRET});assert.equal(rows[0].diagnosticProviderStatus,undefined);
});
