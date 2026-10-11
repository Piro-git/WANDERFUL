import assert from "node:assert/strict";
import { randomBytes,randomUUID } from "node:crypto";
import test from "node:test";
import { createOwnerService,ownerServiceConfiguration } from "../src/ownerAccess/ownerService.js";
import { ownerDatabaseURL } from "../src/ownerAccess/ownerDatabaseConfiguration.js";
import { graphHopperResponse,pointToPointRequest } from "./routeTestSupport.js";

function env(){return {NODE_ENV:"production",OWNER_ACCESS_ENABLED:"true",OWNER_ACCESS_ORIGIN:"https://owner.example.com",
  AI_PROVIDER:"google",GOOGLE_MODEL:"gemini-3.5-flash",GOOGLE_API_KEY:"synthetic-google",GRAPHHOPPER_API_KEY:"synthetic-gh",
  OWNER_ACCESS_MAX_CONCURRENCY:"2",OWNER_ACCESS_ROUTE_DAILY_LIMIT:"2",OWNER_ACCESS_INTENT_DAILY_LIMIT:"2",
  OWNER_ACCESS_GLOBAL_ROUTE_DAILY_LIMIT:"2",OWNER_ACCESS_GLOBAL_INTENT_DAILY_LIMIT:"2"};}

test("owner service config requires explicit opt-in/budgets and excludes inherited capabilities",()=>{
  const input=env();
  for(const change of [{OWNER_ACCESS_ENABLED:"false"},{OWNER_ACCESS_INTENT_DAILY_LIMIT:""},
    {OWNER_ACCESS_GLOBAL_ROUTE_DAILY_LIMIT:"101"},{GOOGLE_MODEL:""},{OWNER_ACCESS_MAX_CONCURRENCY:"3"}]){
    assert.throws(()=>ownerServiceConfiguration({...input,...change}));
  }
  const configuration=ownerServiceConfiguration({...input,GRAPHHOPPER_BASE_URL:"https://evil.example.com",DYNAMIC_RESEARCH_ENABLED:"true",
    INTENT_ALLOW_DETERMINISTIC_MOCK:"true",OPENROUTER_API_KEY:"synthetic-other"});
  assert.equal(configuration.providerEnv.GRAPHHOPPER_BASE_URL,undefined);
  assert.equal(configuration.providerEnv.OPENROUTER_API_KEY,undefined);
  assert.equal(configuration.providerEnv.DYNAMIC_RESEARCH_ENABLED,undefined);
  assert.equal(configuration.providerEnv.INTENT_ALLOW_DETERMINISTIC_MOCK,undefined);
});

test("database URL accepts explicit session pooler suffix and rejects wrong roles/protocol",()=>{
  const ref="abcdefghijklmnopqrst";
  const value=`postgresql://wanderful_owner_runtime.${ref}:synthetic@aws-0-eu-central-1.pooler.supabase.com:5432/postgres`;
  assert.equal(ownerDatabaseURL({OWNER_ACCESS_DATABASE_URL:value,OWNER_ACCESS_SUPABASE_PROJECT_REF:ref}).port,"5432");
  for(const change of [value.replace(":5432",":6543"),value.replace(ref,"aaaaaaaaaaaaaaaaaaaa"),value+"?sslmode=disable",
    value.replace(".pooler.supabase.com",".evil.example.com")]) {
    assert.throws(()=>ownerDatabaseURL({OWNER_ACCESS_DATABASE_URL:change,OWNER_ACCESS_SUPABASE_PROJECT_REF:ref}));
  }
});

test("standalone HTTP routes normalize real parser/provider envelopes and reserve each fetch",async()=>{
  const events=[];
  let allowed=true;
  const repository={isDurable:true,
    async readiness(){},
    async findActiveOwnerKey(){return undefined;},async consumeOwnerOperation(){return true;},async createOwnerChallenge(){return false;},
    async findOwnerChallenge(){return undefined;},async exchangeOwnerChallenge(){return false;},
    async authorizeSession(input){events.push(`authorize:${input.scope}`);return {leaseId:randomUUID(),installationId:"owner:http_test_identity",remainingCost:9};},
    async consumeProviderAttempt(input){events.push(`reserve:${input.scope}`);return allowed;},
    async releaseLease(){events.push("release");}
  };
  const server=createOwnerService({repository,configuration:ownerServiceConfiguration(env()),fetchImpl:async(url,init)=>{
    assert.equal(init.redirect,"error");
    const scope=new URL(url).hostname==="graphhopper.com"?"route":"intent";
    assert.equal(events.at(-1),`reserve:${scope}`);
    events.push(`fetch:${scope}`);
    if(scope==="route") return Response.json(graphHopperResponse());
    const request=JSON.parse(init.body);
    assert.equal(request.tools,undefined);
    assert.equal(request.model,"gemini-3.5-flash");
    return Response.json({steps:[{type:"model_output",content:[{type:"text",text:JSON.stringify({
      activityType:"hiking",routeType:"pointToPoint",startLocationQuery:"Brandenburger Tor, Berlin",
      endLocationQuery:"Siegessäule, Berlin",targetDistanceKm:null,confidence:0.95
    })}]}]});
  }});
  await new Promise((resolve,reject)=>{server.once("error",reject);server.listen(0,"127.0.0.1",resolve);});
  const base=`http://127.0.0.1:${server.address().port}`;
  const token=randomBytes(32).toString("base64url");
  const post=(path,body)=>fetch(`${base}${path}`,{method:"POST",headers:{"Content-Type":"application/json",
    Authorization:`TrailMindRouteSession ${token}`,"X-TrailMind-Request-ID":randomUUID()},body:JSON.stringify(body)});
  try {
    assert.deepEqual(await(await fetch(`${base}/healthz`)).json(),{status:"live"});
    assert.deepEqual(await(await fetch(`${base}/readyz`)).json(),{status:"ready"});
    const route=await post("/api/route",pointToPointRequest());
    assert.equal(route.status,200);
    assert.equal((await route.json()).provider,"graphhopper");
    const intent=await post("/api/parse-intent",{prompt:"Plan a hike from Brandenburger Tor, Berlin to Siegessäule, Berlin.",locale:"en"});
    assert.equal(intent.status,200);
    assert.equal((await intent.json()).routeType,"pointToPoint");
    assert.deepEqual(events,["authorize:route","reserve:route","fetch:route","release","authorize:intent","reserve:intent","fetch:intent","release"]);
    allowed=false;
    const denied=await post("/api/route",pointToPointRequest());
    assert.equal(denied.status,429);
    assert.equal((await denied.json()).error.code,"app_attest_rate_limited");
    assert.deepEqual(events.slice(-3),["authorize:route","reserve:route","release"]);
    assert.equal((await post("/api/app-attest/register",{})).status,404);
    assert.equal((await post("/api/research",{})).status,404);
    assert.equal((await post("/api/parse-intent",{prompt:"test",tools:["google_search"]})).status,400);
    assert.equal((await fetch(`${base}/api/route`,{method:"POST",headers:{"Content-Type":"text/plain"},body:"{}"})).status,415);
  } finally {await new Promise((resolve)=>server.close(resolve));}
});
