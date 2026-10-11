import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
const root=process.env.QA_OWNER_CANDIDATE_ROOT;
assert.ok(root,'Explicit recovered candidate required');
const {validateConditionRecheck}=await import(pathToFileURL(path.join(root,'backend/src/dynamicResearch/recheck.js')));
const {ownerDynamicPlanningConfiguration,createOwnerDynamicPlanningEndpoints}=await import(pathToFileURL(path.join(root,'backend/src/ownerAccess/ownerDynamicPlanning.js')));
// Passing this repro confirms the feature-contract gap; it is NOT a successful
// condition recheck. All admission, source, provider and DB methods refuse IO.
test('QA repro: valid public schema4 payload is rejected by the private schema3 gate',async t=>{
 const now=Date.now();const configuration=ownerDynamicPlanningConfiguration({NODE_ENV:'production',OWNER_ACCESS_ENABLED:'true',
  OWNER_ACCESS_DYNAMIC_RESEARCH_ENABLED:'true',OWNER_ACCESS_ORIGIN:'https://owner.example.com',
  OWNER_ACCESS_KEY_ID:randomBytes(32).toString('base64url'),OWNER_ACCESS_TEST_EXPIRES_AT:new Date(now+60000).toISOString(),
  AI_PROVIDER:'google',GOOGLE_MODEL:'gemini-3.8-flash',GOOGLE_API_KEY:'public-synthetic-only',
  GRAPHHOPPER_API_KEY:'public-synthetic-only',DYNAMIC_RESEARCH_USER_AGENT:'Offline QA'}, {now});
 const body={schemaVersion:4,geometryJSON:JSON.stringify([[168.66,-45.03],[168.661,-45.031]]),
  plannedStartAt:null,locationName:'Public synthetic location',routePlaces:[]};
 assert.ok(validateConditionRecheck(body).geometryDigest);
 let admissions=0,reservations=0,fetches=0;
 const endpoint=createOwnerDynamicPlanningEndpoints({configuration,now:()=>now,repository:{isDurable:true,
  authorizeSession(){admissions++;assert.fail('No DB admission');},
  consumePlanningProviderAttempt(){reservations++;assert.fail('No provider reservation');}},
  fetchImpl:async()=>{fetches++;assert.fail('No external IO');},publicFetchImpl:async()=>{fetches++;assert.fail('No external IO');}});
 const result=await endpoint.plan(body,{headers:{}});
 assert.equal(result.statusCode,400);assert.equal(result.payload.error.code,'invalid_request');
 assert.equal(admissions,0);assert.equal(reservations,0);assert.equal(fetches,0);
 t.diagnostic(JSON.stringify({featurePassed:false,reproducedPrivateContractGap:true,status:400,code:'invalid_request',admissions,reservations,fetches}));
});
