import test from 'node:test';import assert from 'node:assert/strict';
import {lifecycleShape,safeDiagnosticFailure} from '../src/ownerAccess/researchLifecycleDiagnostic.js';
import {runReviewedBuildDiagnostic} from '../scripts/runReviewedBuildDiagnostic.js';
const privateMarker='SYNTHETIC_SECRET_PROMPT_URL_TOKEN_MESSAGE';
test('lifecycle diagnostic projects only fixed status/shape/bounded counts and usage',()=>{
 const s=lifecycleShape({status:'incomplete',continuation_token:privateMarker,errors:[{code:privateMarker,message:privateMarker}],steps:[{type:'google_search_call',id:privateMarker,arguments:{queries:[privateMarker]}},{type:'url_context_call',arguments:{urls:[privateMarker]}},{type:'model_output',content:[{type:'text',text:privateMarker}],error:{code:8,message:privateMarker}}],usage:{total_output_tokens:1200,total_tokens:2000}});
 assert.equal(s.status,'incomplete');assert.equal(s.continuationTokenPresent,true);assert.equal(s.searchCalls,1);assert.equal(s.pageCalls,1);assert.equal(s.modelErrorCode,8);assert.equal(s.totalOutputTokens,1200);assert.ok(!JSON.stringify(s).includes(privateMarker));
 for(const status of ['completed','failed','cancelled','queued','requires_action','in_progress','budget_exceeded'])assert.equal(lifecycleShape({status}).status,status);
 assert.equal(lifecycleShape({status:'COMPLETED'}).status,'upper_completed');assert.equal(lifecycleShape({status:privateMarker}).status,'unrecognized');assert.equal(lifecycleShape({status:200}).status,'unrecognized');
 assert.equal(lifecycleShape({usage:{total_tokens:Infinity,total_output_tokens:1000001}}).totalTokens,null);
 assert.equal(safeDiagnosticFailure({code:privateMarker}),'unclassified');
});
test('ordinary build/context cannot read secrets, connect a DB or fetch by importing inactive standalone operator',async()=>{
 let called=false;const result=await runReviewedBuildDiagnostic({env:{},Pool:class{constructor(){called=true;throw Error('must not construct');}},fetchImpl:()=>{called=true;}});assert.deepEqual(result,{ran:false});assert.equal(called,false);
 await assert.rejects(runReviewedBuildDiagnostic({env:{WANDERFUL_OPERATOR_DIAGNOSTIC:'approved_lifecycle_once',VERCEL_ENV:'preview'},Pool:class{constructor(){called=true;}},fetchImpl:()=>{called=true;}}));assert.equal(called,false);
});

test('completed payload is revalidated in memory only; no extra fetch/read/citation evidence is manufactured',()=>{
 const s=lifecycleShape({status:'completed',steps:[]});assert.equal(s.searchValidationOK,false);assert.equal(s.pageValidationOK,false);assert.equal(s.validationReason,'search_evidence_missing');
 const partial=lifecycleShape({status:'incomplete',steps:[]});assert.equal(partial.searchValidationOK,null);assert.equal(partial.pageValidationOK,null);
});
