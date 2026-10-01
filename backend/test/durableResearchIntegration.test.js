import {operationalEvent} from '../src/operations/operationalEvents.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import {generateResearchAppConfiguration} from '../scripts/configure-research-app.js';
import {evaluateStagingContainerEnvironment} from '../container/stagingAdmission.js';
import {validateDynamicResearchConfiguration} from '../src/operations/productionConfiguration.js';
import {routeAuthorizationConfiguration,createRouteSessionAuthorizer} from '../src/appAttest/routeSessionAuthorizer.js';
import {appAttestError} from '../src/appAttest/appAttestErrors.js';
import {createLLMFirstPlanningEndpoint} from '../src/llmPlanning/llmFirstPlanningEndpoint.js';
import {InMemoryAppAttestRepository} from '../src/appAttest/appAttestRepository.js';
import {hashOpaqueValue} from '../src/appAttest/clientData.js';
const body={schemaVersion:3,parserSource:'remoteAI',prompt:'Public village loop',locationName:'Village',researchMode:'web_and_map',anchor:{latitude:57.2,longitude:-4.7},end:null,intent:{activityType:'hiking',routeType:'loop',targetDistanceKm:6,difficulty:null},constraints:{maximumDistanceKm:null,maximumDurationMinutes:null,maximumElevationGainMeters:null,hardAvoidances:[]}};
function env() {
 return {NODE_ENV:'production',TRAILMIND_RELEASE_STAGE:'staging',TRAILMIND_RUNTIME_PROFILE:'dynamic-research-v1',
  TRAILMIND_STAGING_PROJECT_REF_SHA256:createHash('sha256').update('mbvzwsrtqcrwhvykugcd').digest('hex'),TRAILMIND_APPLICATION_SCHEMA:'trailmind_app',
  APP_ATTEST_RUNTIME_ROLE:'app_runtime',APP_ATTEST_CONTROL_ROLE:'app_control',APP_ATTEST_OPERATOR_ROLE:'app_operator',
  APP_ATTEST_DATABASE_URL:'postgresql://app_runtime:fixture@db.mbvzwsrtqcrwhvykugcd.supabase.co:5432/postgres?sslmode=verify-full&sslrootcert=%2Fetc%2Fsecrets%2Fca.crt',
  AI_PROVIDER:'google',GOOGLE_API_KEY:'offline-provider-fixture',GRAPHHOPPER_API_KEY:'offline-route-fixture',
  LLM_FIRST_PLANNING_ENABLED:'true',INTENT_PROVIDER_ENABLED:'true',ROUTE_PROVIDER_ENABLED:'true',DYNAMIC_RESEARCH_ENABLED:'true',DYNAMIC_WEB_RESEARCH_ENABLED:'true',
  DYNAMIC_RESEARCH_USER_AGENT:'Wanderful/1.0 (https://wanderful.test/support)',DYNAMIC_RESEARCH_BUDGET_APPROVAL_ID:'offline-fixture-only',DYNAMIC_RESEARCH_DAILY_REQUEST_LIMIT:'2',
  ROUTE_GLOBAL_MAX_COST:'24',APP_ATTEST_INSTALLATION_MAX_COST:'24',INTENT_GLOBAL_MAX_COST:'6',APP_ATTEST_INTENT_INSTALLATION_MAX_COST:'6',
  ROUTE_GLOBAL_MAX_CONCURRENCY:'1',INTENT_GLOBAL_MAX_CONCURRENCY:'1',ROUTE_GLOBAL_WINDOW_SECONDS:'86400',APP_ATTEST_INSTALLATION_WINDOW_SECONDS:'86400',INTENT_GLOBAL_WINDOW_SECONDS:'86400',APP_ATTEST_INTENT_INSTALLATION_WINDOW_SECONDS:'86400',
  OUTDOOR_EVIDENCE_PROVIDER_ENABLED:'false',OUTDOOR_RESEARCH_PLANNING_ENABLED:'false',OUTDOOR_ROUTABLE_HIGHLIGHT_ACCESS_ENABLED:'false',ROUTE_ALLOW_INSECURE_LOCAL_ROUTING:'false',INTENT_ALLOW_INSECURE_LOCAL_PARSING:'false',INTENT_ALLOW_DETERMINISTIC_MOCK:'false',OUTDOOR_RESEARCH_PLANNING_ALLOW_INSECURE_LOCAL:'false',APP_ATTEST_ALLOW_IN_MEMORY:'false'};
}
test('dynamic rollout remains opt-in and requires bounded explicit budgets and safe lease',()=>{
 assert.doesNotThrow(()=>validateDynamicResearchConfiguration(env()));
 assert.equal(routeAuthorizationConfiguration(env()).leaseTtlMs,180000);
 for(const changes of [{ROUTE_GLOBAL_LEASE_TTL_SECONDS:'90'},{ROUTE_GLOBAL_MAX_COST:undefined},{ROUTE_GLOBAL_MAX_COST:'121'},{ROUTE_GLOBAL_WINDOW_SECONDS:'60'},{DYNAMIC_WEB_RESEARCH_ENABLED:'false'},{DYNAMIC_RESEARCH_BUDGET_APPROVAL_ID:''},{DYNAMIC_RESEARCH_DAILY_REQUEST_LIMIT:'1'},{DYNAMIC_RESEARCH_ENABLED:'yes'}]) {
  assert.throws(()=>validateDynamicResearchConfiguration({...env(),...changes}));
 }
});
test('explicit research container retains database, secret and runtime hardening',()=>{
 assert.equal(evaluateStagingContainerEnvironment(env(),{execArgv:[]}).decision,'ready');
 for(const changes of [{TRAILMIND_RUNTIME_PROFILE:undefined},{APP_ATTEST_DATABASE_URL:'postgresql://postgres:fixture@db.mbvzwsrtqcrwhvykugcd.supabase.co/postgres'},{NODE_OPTIONS:'--inspect'},{APP_ATTEST_CONTROL_DATABASE_URL:'fixture'},{OPENROUTER_API_KEY:'fixture'},{APP_ATTEST_ALLOW_IN_MEMORY:'true'},{OUTDOOR_RESEARCH_PLANNING_ENABLED:'true'},{TRAILMIND_RUNTIME_PROFILE:'typo'}]) {
  const result=evaluateStagingContainerEnvironment({...env(),...changes},{execArgv:[]});
  assert.equal(result.decision,'blocked');assert.ok(!JSON.stringify(result).includes('offline-provider-fixture'));
 }
});
for(const [code,status] of [['route_session_expired',401],['route_session_invalid',401],['route_session_exhausted',429],['request_replayed',409],['app_attest_rate_limited',429],['authorization_unavailable',503]]) {
 test(`schema3 preserves pre-provider ${code} and never invokes providers`,async()=>{
  let calls=0;const result=await createLLMFirstPlanningEndpoint({env:env(),authorizer:{authorize:()=>{throw appAttestError(code);}},dynamicResearchDependencies:{interact:()=>{calls++;}}})(body);
  assert.equal(result.statusCode,status);assert.equal(result.payload.error.code,code);assert.equal(calls,0);
 });
}
test('point-to-point reaches the normal authorization boundary',async()=>{
 let calls=0;const result=await createLLMFirstPlanningEndpoint({env:env(),authorizer:{authorize:()=>{calls++;}}})({...body,end:{latitude:57.3,longitude:-4.7},intent:{...body.intent,routeType:'pointToPoint'}});
 assert.equal(result.statusCode,401);assert.equal(calls,1);
});
test('production authorizer fails closed on an in-memory repository',async()=>{
 await assert.rejects(createRouteSessionAuthorizer({env:env(),repository:new InMemoryAppAttestRepository()}).authorize({}),{code:'authorization_unavailable'});
});
test('session refresh does not reset installation/global budget or replay records (simulated repository)',async()=>{
 const settings={...env(),NODE_ENV:'test'};const repository=new InMemoryAppAttestRepository();
 const authorizer=createRouteSessionAuthorizer({env:settings,repository});const requestID=randomUUID();
 const open=async(n)=>{const token=Buffer.alloc(32,n).toString('base64url');await repository.createRouteSession({tokenHash:hashOpaqueValue(token),installationId:'fixture-installation',expiresAt:Date.now()+300000,maximumCost:24});return token;};
 const authorize=(token,id=randomUUID())=>authorizer.authorize({headers:{authorization:`TrailMindRouteSession ${token}`,'x-trailmind-request-id':id},cost:12});
 const first=await open(1);await (await authorize(first,requestID)).release();
 await assert.rejects(authorize(first,requestID),{code:'request_replayed'});
 await (await authorize(await open(2))).release();
 await assert.rejects(authorize(await open(3)),{code:'app_attest_rate_limited'});
});
test('public app config pins exact distinct HTTPS origins and stays disabled without deployment',()=>{
 const disabled=generateResearchAppConfiguration({staging:null,production:null});assert.match(disabled.swift,/stagingHost: String\? = nil/);assert.match(disabled.xcconfig,/STAGING_RESEARCH_ENABLED = false/);
 const active=generateResearchAppConfiguration({staging:{baseURL:'https://wanderful-staging.onrender.com/',verificationReceipt:'receipts/deployment-1.json'},production:null});
 assert.match(active.swift,/stagingHost: String\? = "wanderful-staging.onrender.com"/);assert.match(active.xcconfig,/STAGING_RESEARCH_ENABLED = true/);
 for(const url of ['http://localhost/','https://example.invalid/','https://a.trycloudflare.com/','https://user:password@host.com/','https://host.com/path','https://host.com/?token=x','https://host.com/#x','https://host.com:8443/']) {
  assert.throws(()=>generateResearchAppConfiguration({staging:{baseURL:url,verificationReceipt:'receipts/test.json'},production:null}));
 }
});

test('production dynamic events expose outcomes and buckets, never prompts, tokens or locations',()=>{
 const result=operationalEvent({event:'llm_first_planning_completed',resultState:'routed',acceptedCount:1,rejectedCount:0,fallbackAttemptCount:0,durationBucket:'over_30s',prompt:'private-sentinel',token:'private-sentinel',coordinates:'private-sentinel',requestId:'private-sentinel'});
 assert.equal(result.eventName,'llm_first_planning_completed');assert.ok(result.acceptedCount);assert.ok(!JSON.stringify(result).includes('private-sentinel'));
 assert.equal(operationalEvent({event:'runtime_capability_state',capability:'dynamic_research',state:'enabled'}).capability,'dynamic_research');
});
