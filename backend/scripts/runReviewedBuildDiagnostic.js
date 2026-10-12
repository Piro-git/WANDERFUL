// One reviewed operator-internal build job; no HTTP/admin route and no phone spoof.
import pg from 'pg';
import {randomUUID} from 'node:crypto';
import {ownerVercelDatabaseConfiguration} from '../src/ownerAccess/vercelOwnerRuntime.js';
import {PostgresOwnerRepository} from '../src/ownerAccess/postgresOwnerRepository.js';
import {reserveFollowupDiagnostic} from '../src/ownerAccess/planningFollowupEntitlement.js';
import {fetchBoundedJson} from '../src/llmPlanning/adapters/providerHttp.js';
import {buildWebResearchInput} from '../src/dynamicResearch/webResearch.js';
import {lifecycleShape,safeDiagnosticFailure} from '../src/ownerAccess/researchLifecycleDiagnostic.js';
export async function runReviewedBuildDiagnostic({env=process.env,Pool=pg.Pool,fetchImpl=globalThis.fetch}={}){
 if(env.WANDERFUL_OPERATOR_DIAGNOSTIC!=='approved_lifecycle_once')return {ran:false};
 if(env.VERCEL_ENV!=='production'||env.OWNER_ACCESS_ENABLED==='true'||env.OWNER_ACCESS_SUPPLEMENT_ENABLED==='true'||env.OWNER_ACCESS_FOLLOWUP_ENABLED==='true'||env.GOOGLE_MODEL!=='gemini-3.8-flash'||!env.GOOGLE_API_KEY)throw Error('diagnostic_context_unavailable');
 const p={approvalSHA256:env.WANDERFUL_DIAGNOSTIC_APPROVAL_SHA256,backendTree:env.WANDERFUL_DIAGNOSTIC_BACKEND_TREE,keyId:env.OWNER_ACCESS_KEY_ID,origin:env.OWNER_ACCESS_ORIGIN};
 const pool=new Pool(ownerVercelDatabaseConfiguration(env));pool.on('error',()=>{});const repo=new PostgresOwnerRepository({pool}),jobId=randomUUID();
 try{
  await repo.readiness();await repo.planningWaveReadiness();
  await repo.transaction(c=>reserveFollowupDiagnostic(c,p,jobId));
  let shape=null,failure='none',httpStatus=null;
  try{
   const input=buildWebResearchInput({prompt:['Plane eine ungefähr 15 km lange Rundwanderung ab Ilsenburg im Harz, die wieder am Start endet.','Baue echte, namentlich bekannte Aussichtspunkte ein.','Zeige passende Wikimedia-Fotos dieser Orte, sofern verfügbar.','Kleine Abweichungen von 15 km sind okay.'].join(' '),locationName:'Ilsenburg',intent:{activityType:'hiking',routeType:'loop',targetDistanceKm:15,interests:['views']}});
   const payload=await fetchBoundedJson({url:new URL('https://generativelanguage.googleapis.com/v1beta/interactions'),fetchImpl:async(url,init)=>{const response=await fetchImpl(url,{...init,redirect:'error'});httpStatus=response.status;return response;},init:{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json','x-goog-api-key':env.GOOGLE_API_KEY},body:JSON.stringify({model:'gemini-3.8-flash',store:false,input,tools:[{type:'google_search',search_types:['web_search']},{type:'url_context'}]})},deadlineMs:60000,maximumDeadlineMs:60000,maximumAttempts:1,maximumResponseBytes:262144,maximumErrorResponseBytes:8192,setTimeoutImpl:setTimeout,clearTimeoutImpl:clearTimeout});
   shape=lifecycleShape(payload);
  }catch(error){failure=safeDiagnosticFailure(error);}
  const s=shape??{status:'missing',statusType:'missing',stepsPresent:false,continuationTokenPresent:false,stepCount:0,searchCalls:0,pageCalls:0,modelOutputs:0,searchResults:0,pageResults:0,readSuccessCount:0,citationAnnotationCount:0,searchValidationOK:null,pageValidationOK:null,validationReason:null,functionCalls:0,functionSearchPlaces:0,functionRouteItinerary:0,functionReviewQuality:0,functionOther:0,errorArrayPresent:false,errorCount:0,modelErrorCode:null,totalInputTokens:null,totalOutputTokens:null,totalThoughtTokens:null,totalTokens:null};
  const saved=await repo.transaction(c=>c.query(`UPDATE wanderful_owner_budget_v1.entitlements SET result_status=$1,result_status_type=$2,has_steps=$3,has_continuation=$4,step_count=$5,search_calls=$6,page_calls=$7,model_outputs=$8,function_calls=$9,error_array_present=$10,error_count=$11,model_error_code=$12,total_input_tokens=$13,total_output_tokens=$14,total_thought_tokens=$15,total_tokens=$16,result_http_status=$17,result_failure=$18,function_search_places=$19,function_route_itinerary=$20,function_review_quality=$21,function_other=$22,search_results=$23,page_results=$24,read_success_count=$25,citation_annotation_count=$26,search_validation_ok=$27,page_validation_ok=$28,validation_reason=$29,result_finished_at=clock_timestamp() WHERE sequence=2 AND diagnostic_job_id=$30 AND result_finished_at IS NULL`,[s.status,s.statusType,s.stepsPresent,s.continuationTokenPresent,s.stepCount,s.searchCalls,s.pageCalls,s.modelOutputs,s.functionCalls,s.errorArrayPresent,s.errorCount,s.modelErrorCode,s.totalInputTokens,s.totalOutputTokens,s.totalThoughtTokens,s.totalTokens,httpStatus,failure,s.functionSearchPlaces,s.functionRouteItinerary,s.functionReviewQuality,s.functionOther,s.searchResults,s.pageResults,s.readSuccessCount,s.citationAnnotationCount,s.searchValidationOK,s.pageValidationOK,s.validationReason,jobId]));
  if(saved.rowCount!==1)throw Error('diagnostic_result_not_stored');
  // No payload, prompt, source URL, opaque token, ID or credential is logged.
  return {ran:true,shape:s,failure,httpStatus};
 }finally{await pool.end();}
}
if(process.argv[1]?.endsWith('/runReviewedBuildDiagnostic.js'))runReviewedBuildDiagnostic().then(result=>{if(result.ran)console.info({event:'reviewed_operator_lifecycle_finished',...result});}).catch(()=>{console.error('reviewed_operator_lifecycle_blocked');process.exitCode=1;});
