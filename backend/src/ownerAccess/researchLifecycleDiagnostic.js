import {parseGroundedWebResearch} from '../dynamicResearch/webResearch.js';
import {safePrivateFailure} from './privatePlanningDiagnostics.js';
// Closed structure-only projection. Never copies messages, IDs, URLs or tokens.
const statuses=new Set(['completed','in_progress','requires_action','failed','cancelled','incomplete','budget_exceeded','queued']);
const failureCodes=new Set(['timed_out','provider_rejected','configuration_missing','rate_limited','provider_unavailable','invalid_response','response_too_large','cancelled']);
export function lifecycleShape(payload){
 const raw=payload?.status;
 const status=statuses.has(raw)?raw:typeof raw==='string'&&statuses.has(raw.toLowerCase())&&raw===raw.toUpperCase()?'upper_'+raw.toLowerCase():raw===undefined?'missing':'unrecognized';
 const statusType=raw===undefined?'missing':raw===null?'null':Array.isArray(raw)?'array':['string','number','boolean','object'].includes(typeof raw)?typeof raw:'missing';
 const steps=Array.isArray(payload?.steps)?payload.steps:[],bounded=steps.slice(0,60);
 const out={status,statusType,stepsPresent:Array.isArray(payload?.steps),continuationTokenPresent:typeof payload?.continuation_token==='string'&&payload.continuation_token.length>0,stepCount:Math.min(steps.length,60),searchCalls:0,searchResults:0,pageCalls:0,pageResults:0,readSuccessCount:0,citationAnnotationCount:0,searchValidationOK:null,pageValidationOK:null,validationReason:null,modelOutputs:0,functionCalls:0,functionSearchPlaces:0,functionRouteItinerary:0,functionReviewQuality:0,functionOther:0,errorArrayPresent:Array.isArray(payload?.errors),errorCount:Math.min(Array.isArray(payload?.errors)?payload.errors.length:0,16),modelErrorCode:null,totalInputTokens:null,totalOutputTokens:null,totalThoughtTokens:null,totalTokens:null};
 for(const s of bounded){
  if(s?.type==='google_search_call')out.searchCalls++;
  if(s?.type==='google_search_result')out.searchResults++;
  if(s?.type==='url_context_call')out.pageCalls++;
  if(s?.type==='url_context_result'){out.pageResults++;for(const item of Array.isArray(s.result)?s.result.slice(0,20):[])if(item?.status==='success')out.readSuccessCount=Math.min(60,out.readSuccessCount+1);}
  if(s?.type==='function_call'){out.functionCalls++;if(s.name==='search_places')out.functionSearchPlaces++;else if(s.name==='route_itinerary')out.functionRouteItinerary++;else if(s.name==='review_route_quality')out.functionReviewQuality++;else out.functionOther++;}
  if(s?.type==='model_output'){out.modelOutputs++;for(const c of Array.isArray(s.content)?s.content.slice(0,8):[])for(const a of Array.isArray(c?.annotations)?c.annotations.slice(0,40):[])if(a?.type==='url_citation')out.citationAnnotationCount=Math.min(60,out.citationAnnotationCount+1);if(Number.isInteger(s.error?.code)&&s.error.code>=0&&s.error.code<=16)out.modelErrorCode=s.error.code;}
 }
 for(const [target,key] of [['totalInputTokens','total_input_tokens'],['totalOutputTokens','total_output_tokens'],['totalThoughtTokens','total_thought_tokens'],['totalTokens','total_tokens']]){
  const v=payload?.usage?.[key];if(Number.isSafeInteger(v)&&v>=0&&v<=1000000)out[target]=v;
 }
 if(raw==='completed'){
  try{parseGroundedWebResearch(payload,{requirePageRead:false});out.searchValidationOK=true;}catch(e){out.searchValidationOK=false;out.validationReason=safePrivateFailure(e).diagnosticValidationReason??'web_envelope_invalid';}
  try{parseGroundedWebResearch(payload,{requirePageRead:true});out.pageValidationOK=true;}catch(e){out.pageValidationOK=false;out.validationReason??=safePrivateFailure(e).diagnosticValidationReason??'web_envelope_invalid';}
 }
 return out;
}
export function safeDiagnosticFailure(error){return failureCodes.has(error?.code)?error.code:'unclassified';}
