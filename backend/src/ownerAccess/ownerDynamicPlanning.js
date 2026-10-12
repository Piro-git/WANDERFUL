import {supplementConfiguration} from './planningSupplement.js';
import {canonicalOwnerOrigin} from './ownerAccessEndpoint.js';
import {assertRequestId,decodeBase64Url,hashOpaqueValue} from '../appAttest/clientData.js';
import {appAttestError,appAttestErrorResult} from '../appAttest/appAttestErrors.js';
import {createLLMFirstPlanningEndpoint} from '../llmPlanning/llmFirstPlanningEndpoint.js';
import {validateDynamicRequest} from '../dynamicResearch/contract.js';
import {publicFetch} from '../dynamicResearch/publicSources.js';
import {dwdQuery,harzQuery} from '../dynamicResearch/conditionSources.js';
import {REVIEWED_SOURCE_HOSTS} from '../dynamicResearch/sourceDocuments.js';
import {createIntentSessionEndpoint} from '../appAttest/intentSessionEndpoint.js';

// One shared wave, never an allowance per process, renewed session, key or agent.
export const OWNER_PLANNING_WAVE = 'wanderful-live-wave-20261003';
export const OWNER_PLANNING_CAPS = Object.freeze({requests:2,google:16,graphhopper:10});
export function ownerDynamicPlanningConfiguration(env,{now=Date.now()}={}) {
  if(env.NODE_ENV!=='production'||env.OWNER_ACCESS_ENABLED!=='true'||env.OWNER_ACCESS_DYNAMIC_RESEARCH_ENABLED!=='true'||
    env.AI_PROVIDER!=='google'||env.GOOGLE_MODEL!=='gemini-3.8-flash'||!env.GOOGLE_API_KEY?.trim()||!env.GRAPHHOPPER_API_KEY?.trim()) unavailable();
  const origin=canonicalOwnerOrigin(env.OWNER_ACCESS_ORIGIN);
  const keyId=env.OWNER_ACCESS_KEY_ID;decodeBase64Url(keyId,{expectedLength:32,maxLength:64});
  const expiry=env.OWNER_ACCESS_TEST_EXPIRES_AT,expiresAt=Date.parse(expiry);
  if(!Number.isFinite(now)||!Number.isFinite(expiresAt)||new Date(expiresAt).toISOString()!==expiry||expiresAt<=now||expiresAt-now>1800000||
    typeof env.DYNAMIC_RESEARCH_USER_AGENT!=='string'||!env.DYNAMIC_RESEARCH_USER_AGENT.trim()||env.DYNAMIC_RESEARCH_USER_AGENT.length>200||/[\u0000-\u001f]/.test(env.DYNAMIC_RESEARCH_USER_AGENT)) unavailable();
  const supplement=supplementConfiguration(env,{origin,keyId,expiresAt});
  return Object.freeze({origin,keyId,expiresAt,...(supplement?{supplement}:{}),providerEnv:Object.freeze({
    NODE_ENV:'production',AI_PROVIDER:'google',GOOGLE_MODEL:'gemini-3.8-flash',GOOGLE_API_KEY:env.GOOGLE_API_KEY,GRAPHHOPPER_API_KEY:env.GRAPHHOPPER_API_KEY,
    LLM_FIRST_PLANNING_ENABLED:'true',ROUTE_PROVIDER_ENABLED:'true',INTENT_PROVIDER_ENABLED:'true',INTENT_REQUEST_COST:'3',
    DYNAMIC_RESEARCH_ENABLED:'true',DYNAMIC_WEB_RESEARCH_ENABLED:'true',DYNAMIC_RESEARCH_USER_AGENT:env.DYNAMIC_RESEARCH_USER_AGENT,
    DYNAMIC_RESEARCH_BUDGET_APPROVAL_ID:OWNER_PLANNING_WAVE,DYNAMIC_RESEARCH_BUDGET_EXPIRES_AT:expiry,
    DYNAMIC_RESEARCH_DAILY_REQUEST_LIMIT:'2',ROUTE_GLOBAL_MAX_COST:'24',APP_ATTEST_INSTALLATION_MAX_COST:'24',
    ROUTE_GLOBAL_WINDOW_SECONDS:'86400',APP_ATTEST_INSTALLATION_WINDOW_SECONDS:'86400',
    DYNAMIC_RESEARCH_MAX_GENERATIONS:'8',DYNAMIC_RESEARCH_MAX_CURRENT_INFORMATION_GENERATIONS:'3',
    ROUTE_ALLOW_INSECURE_LOCAL_ROUTING:'false',INTENT_ALLOW_INSECURE_LOCAL_PARSING:'false',APP_ATTEST_ALLOW_IN_MEMORY:'false'
  })});
}

// This factory is NOT mounted by public server.js/api/index.js. Owner-only service
// opts in explicitly and supplies its existing durable P256 session repository.
export function createOwnerDynamicPlanningEndpoints({repository,configuration,fetchImpl=globalThis.fetch,now=Date.now,logger,
  publicFetchImpl=publicFetch}) {
  if(repository?.isDurable!==true||typeof repository.consumePlanningProviderAttempt!=='function') unavailable();
  const run=async (body,context={},intentOnly=false)=>{
    if(now()>=configuration.expiresAt)return failure(403,'owner_access_expired');
    try {if(intentOnly){if(!body||typeof body.prompt!=='string'||Object.keys(body).some(k=>!['prompt','locale','userLocationHint'].includes(k)))throw Error();}
      else {validateDynamicRequest(body);if(body.researchMode!=='web_and_map'||configuration.supplement&&body.schemaVersion!==3)throw Error();}}
    catch{return failure(400,'invalid_request');}
    let access,providerBudgetError;
    const authorizer={async authorize({headers,cost,signal}){
      if(signal?.aborted||now()>=configuration.expiresAt)throw appAttestError('authorization_unavailable');
      const value=headers.authorization;
      if(typeof value!=='string'||!value.startsWith('TrailMindRouteSession '))throw appAttestError('route_session_invalid');
      const token=value.slice('TrailMindRouteSession '.length);decodeBase64Url(token,{expectedLength:32,maxLength:64});
      const tokenHash=hashOpaqueValue(token),requestId=assertRequestId(headers['x-trailmind-request-id']);
      const result=await repository.authorizeSession({tokenHash,requestId,cost,scope:'intent',maximumConcurrency:1,
        planning:{keyId:configuration.keyId,expiresAt:configuration.expiresAt,admitRequest:!intentOnly,...(configuration.supplement?{supplement:configuration.supplement}:{})}});
      access={tokenHash,leaseId:result.leaseId};
      return {authorized:true,limitsConsumed:true,rateLimitKey:result.installationId,remainingCost:result.remainingCost,
        async release(){await repository.releaseLease(result.leaseId);}};
    }};
    const boundedFetch=async(url,init={})=>{
      if(!access||context.signal?.aborted||init.signal?.aborted||now()>=configuration.expiresAt)throw appAttestError('authorization_unavailable');
      const target=new URL(url);
      if(target.username||target.password||target.hash)throw Error('owner_provider_unavailable');
      const provider=target.origin==='https://generativelanguage.googleapis.com'&&target.pathname==='/v1beta/interactions'?'google':
        target.origin==='https://graphhopper.com'&&target.pathname==='/api/1/route'?'graphhopper':undefined;
      if(provider){
        if(init.method!=='POST')throw Error('owner_provider_unavailable');
        if(provider==='google'){
          const request=JSON.parse(init.body);
          if(request.model!=='gemini-3.8-flash'||(request.store!==undefined&&request.store!==false)||[...target.searchParams.keys()].length||
            request.tools?.some(t=>!['function','google_search','url_context'].includes(t?.type)))throw Error('owner_provider_unavailable');
          request.store=false;init={...init,body:JSON.stringify(request)};
        } else if([...target.searchParams.keys()].some(k=>k!=='key'))throw Error('owner_provider_unavailable');
        try {
          const reserved=await repository.consumePlanningProviderAttempt({...access,provider,keyId:configuration.keyId,expiresAt:configuration.expiresAt,...(configuration.supplement?{supplement:configuration.supplement}:{})});
          if(!reserved)throw appAttestError('app_attest_rate_limited');
        } catch(error){
          if(error.code==='app_attest_rate_limited')providerBudgetError=error;
          throw error;
        }
        if(context.signal?.aborted||init.signal?.aborted)throw appAttestError('authorization_unavailable');
        const phase=provider==='graphhopper'?'graphhopper':JSON.parse(init.body).tools?.some(t=>t.type==='google_search')?'web_grounding':JSON.parse(init.body).tools?.some(t=>t.type==='url_context')?'page_read':JSON.parse(init.body).tools?.some(t=>t.type==='function')?'place_routing':'intent';
        try{const response=await fetchImpl(url,{...init,redirect:'error'});try{logger?.info({event:'owner_provider_attempt_completed',provider,phase,httpStatus:response?.status});}catch{}return response;}
        catch(error){try{logger?.info({event:'owner_provider_attempt_failed',provider,phase});}catch{}throw error;}
      }
      const mapped=target.origin==='https://overpass-api.de'&&target.pathname==='/api/interpreter'&&init.method==='POST'||
        target.origin==='https://www.wikidata.org'&&/^\/wiki\/Special:EntityData\/Q[1-9][0-9]*\.json$/.test(target.pathname)&&(init.method??'GET')==='GET'||
        target.origin==='https://commons.wikimedia.org'&&target.pathname==='/w/api.php'&&target.searchParams.get('action')==='query'&&target.searchParams.get('prop')==='imageinfo'&&(init.method??'GET')==='GET';
      if(mapped)return fetchImpl(url,{...init,redirect:'error'});
      const official=(init.method??'GET')==='GET'&&target.protocol==='https:'&&!target.port&&
        (REVIEWED_SOURCE_HOSTS.includes(target.hostname)||target.origin===new URL(dwdQuery([5,47,6,48])).origin&&target.pathname==='/geoserver/wfs'||
          target.origin===new URL(harzQuery([10.5,51.7,10.6,51.8])).origin&&target.pathname===new URL(harzQuery([10.5,51.7,10.6,51.8])).pathname);
      // Reviewed regional reads use the same DNS-pinned, verified-TLS transport as
      // generic sourceDocuments. Never forward provider credentials to a source.
      if(official)return publicFetchImpl(target,{signal:init.signal,headers:{Accept:init.headers?.Accept??'application/json','User-Agent':configuration.providerEnv.DYNAMIC_RESEARCH_USER_AGENT}});
      throw Error('owner_provider_unavailable');
    };
    const options={env:configuration.providerEnv,authorizer,intentAuthorizer:authorizer,fetchImpl:boundedFetch,logger};
    const result=await (intentOnly?createIntentSessionEndpoint(options):createLLMFirstPlanningEndpoint(options))(body,context);
    return providerBudgetError?appAttestErrorResult(providerBudgetError):result;
  };
  return {plan:(body,context)=>run(body,context),parseIntent:(body,context)=>run(body,context,true)};
}
function unavailable(){throw Error('owner_dynamic_configuration_unavailable');}
function failure(statusCode,code){return {statusCode,payload:{error:{code,message:'Private planning could not be accepted.'}},headers:{'Cache-Control':'no-store'}};}
