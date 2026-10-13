// Inactive on import and normal builds. No public route or native impersonation.
import pg from 'pg';
import {randomUUID,createHash} from 'node:crypto';
import {ownerVercelDatabaseConfiguration} from '../src/ownerAccess/vercelOwnerRuntime.js';
import {PostgresOwnerRepository} from '../src/ownerAccess/postgresOwnerRepository.js';
import {createGeminiWebResearch,validateWebResearchEnvelope} from '../src/dynamicResearch/webResearch.js';
import {RESEARCH_SYSTEM_INSTRUCTION} from '../src/dynamicResearch/researchProtocol.js';
import {safePrivateFailure} from '../src/ownerAccess/privatePlanningDiagnostics.js';
import {PROTOCOL_PUBLIC_REQUEST,PROTOCOL_INPUT_SHA256} from '../src/ownerAccess/protocolVerificationRequest.js';
import {verificationConfiguration,claimProtocolVerification,reserveProtocolGoogle,authorizeProtocolReadback,finishProtocolVerification,FIRST_COLUMNS,summaryValues} from '../src/ownerAccess/protocolVerificationBudget.js';
const blocked=()=>{throw Object.assign(new Error('verification_unavailable'),{code:'verification_unavailable'});};
export async function runReviewedProtocolVerification({env=process.env,Pool=pg.Pool,fetchImpl=globalThis.fetch}={}){
 if(env.WANDERFUL_PROTOCOL_VERIFICATION!=='approved_research_once')return {ran:false};
 if(env.VERCEL_ENV!=='production'||['OWNER_ACCESS_ENABLED','OWNER_ACCESS_SUPPLEMENT_ENABLED','OWNER_ACCESS_FOLLOWUP_ENABLED'].some(k=>env[k]!=='false')||env.GOOGLE_MODEL!=='gemini-3.8-flash'||!env.GOOGLE_API_KEY?.trim())blocked();
 const expiry=Date.parse(env.WANDERFUL_PROTOCOL_EXPIRES_AT);if(!Number.isFinite(expiry)||new Date(expiry).toISOString()!==env.WANDERFUL_PROTOCOL_EXPIRES_AT||expiry-Date.now()<120000||expiry-Date.now()>600000||env.WANDERFUL_PROTOCOL_INPUT_SHA256!==PROTOCOL_INPUT_SHA256)blocked();
 const p=verificationConfiguration({approvalSHA256:env.WANDERFUL_PROTOCOL_APPROVAL_SHA256,backendTree:env.WANDERFUL_PROTOCOL_BACKEND_TREE,inputSHA256:PROTOCOL_INPUT_SHA256,keyId:env.OWNER_ACCESS_KEY_ID,origin:env.OWNER_ACCESS_ORIGIN,expiresAt:expiry});
 const pool=new Pool(ownerVercelDatabaseConfiguration(env));pool.on('error',()=>{});const repo=new PostgresOwnerRepository({pool}),jobId=randomUUID();
 const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),Math.min(120000,expiry-Date.now()));
 let attempts=0,readback=false,full=false,error=null,web=null;const statuses=[],shapes=[];
 try{
  await repo.readiness();await repo.planningWaveReadiness();await repo.transaction(c=>claimProtocolVerification(c,p,jobId));
  try{
   const accountedFetch=async(url,init)=>{
    const target=new URL(url),body=JSON.parse(init.body);
    if(controller.signal.aborted||target.href!=='https://generativelanguage.googleapis.com/v1beta/interactions'||init.method!=='POST'||attempts>=2||body.store!==false||body.background!==undefined||body.previous_interaction_id!==undefined||body.system_instruction!==RESEARCH_SYSTEM_INSTRUCTION||body.generation_config?.tool_choice!=='validated')blocked();
    if(attempts===0){if(createHash('sha256').update(init.body).digest('hex')!==PROTOCOL_INPUT_SHA256)blocked();}
    else if(!readback||JSON.stringify(body.tools)!==JSON.stringify([{type:'url_context'}]))blocked();
    await repo.transaction(c=>reserveProtocolGoogle(c,p,jobId));attempts++;
    if(controller.signal.aborted)blocked();
    const response=await fetchImpl(url,{...init,redirect:'error'});statuses[attempts-1]=response.status;return response;
   };
   const research=createGeminiWebResearch({apiKey:env.GOOGLE_API_KEY,model:'gemini-3.8-flash',fetchImpl:accountedFetch,observeResponse:s=>shapes.push(s)});
   web=await research(PROTOCOL_PUBLIC_REQUEST,{signal:controller.signal,reserveGeneration:async()=>{
    if(attempts!==1||readback||controller.signal.aborted)blocked();
    // Called by the exact adapter only after strict completed + genuine search/
    // citation validation. No raw payload or arbitrary URL/name is dispatched.
    await repo.transaction(c=>authorizeProtocolReadback(c,p,jobId,shapes[0],statuses[0]));readback=true;return true;
   }});
   if(controller.signal.aborted)blocked();
   validateWebResearchEnvelope(web);full=true;
  }catch(e){error=e;}
  const first=shapes[0],last=shapes.at(-1),summary=error?safePrivateFailure(error):null;
  const result=Object.fromEntries(FIRST_COLUMNS.map((k,i)=>[k,summaryValues(first,statuses[0])[i]]));
  Object.assign(result,{last_status:last?.status??null,last_http_status:statuses.at(-1)??null,last_pending_builtin:last?.pendingBuiltin??null,last_pending_planning:last?.pendingPlanning??null,last_pending_other:last?.pendingOther??null,last_total_tokens:last?.totalTokens??null,full_research_valid:full,result_failure:full?'none':error?.code==='verification_unavailable'?'verification_unavailable':summary?.diagnosticCode??'unclassified',result_stage:summary?.diagnosticStage??'unclassified',validation_reason:summary?.diagnosticValidationReason??null,validated_search_calls:full?web.observedSearchCalls:null,validated_query_count:full?web.observedSearchQueries:null,validated_read_count:full?web.retrievedSourceURLs.length:null,validated_citation_count:full?web.blocks.reduce((n,b)=>n+b.citations.length,0):null});
  await repo.transaction(c=>finishProtocolVerification(c,p,jobId,result));
  return {ran:true,attempts,readbackAuthorized:readback,...result};
 }finally{clearTimeout(timer);controller.abort();await pool.end();}
}
if(process.argv[1]?.endsWith('/runReviewedProtocolVerification.js'))runReviewedProtocolVerification().then(r=>{if(r.ran)console.info({event:'reviewed_protocol_verification_finished',...r});}).catch(()=>{console.error('reviewed_protocol_verification_blocked');process.exitCode=1;});
