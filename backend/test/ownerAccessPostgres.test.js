import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { generateKeyPairSync,randomBytes,randomUUID,sign } from "node:crypto";
import test from "node:test";
import pg from "pg";
import { PostgresOwnerRepository } from "../src/ownerAccess/postgresOwnerRepository.js";
import { createOwnerAccessEndpoint,canonicalOwnerSessionClientData,ownerKeyId,OWNER_CHALLENGE_PATH,OWNER_SESSION_PATH } from "../src/ownerAccess/ownerAccessEndpoint.js";
import { createOwnerSessionAuthorizer } from "../src/ownerAccess/ownerSessionAuthorizer.js";
import { hashOpaqueValue } from "../src/appAttest/clientData.js";

const url=process.env.OWNER_TEST_POSTGRES_URL;
test("real PostgreSQL owner lifecycle, budgets, replay and revocation",{skip:!url},async()=>{
  const parsed=new URL(url);
  assert.equal(parsed.hostname,"127.0.0.1","Only disposable local PostgreSQL is permitted");
  assert.equal(parsed.pathname,"/owner_access_test");
  const operator=new pg.Pool({connectionString:url,max:4});
  let runtime;
  try {
    await operator.query("CREATE ROLE wanderful_owner_runtime LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS");
    await operator.query("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role");
    await operator.query("ALTER DEFAULT PRIVILEGES GRANT SELECT ON TABLES TO anon,authenticated,service_role");
    await operator.query(await readFile(new URL("../src/ownerAccess/001_owner_access.sql",import.meta.url),"utf8"));
    parsed.username="wanderful_owner_runtime";
    runtime=new pg.Pool({connectionString:parsed.href,max:4});
    const repo=new PostgresOwnerRepository({pool:runtime});
    const worker=new PostgresOwnerRepository({pool:runtime});
    const operatorRepo=new PostgresOwnerRepository({pool:operator});
    await repo.readiness();
    await operator.query("GRANT DELETE ON wanderful_owner_v1.sessions TO wanderful_owner_runtime");
    await assert.rejects(()=>repo.readiness());
    await operator.query("REVOKE DELETE ON wanderful_owner_v1.sessions FROM wanderful_owner_runtime");
    await repo.readiness();
    await assert.rejects(()=>operatorRepo.readiness());
    await assert.rejects(()=>runtime.query("INSERT INTO wanderful_owner_v1.owners VALUES('owner:not_allowed_here',NULL)"));
    const pair=generateKeyPairSync("ec",{namedCurve:"prime256v1"});
    const spki=pair.publicKey.export({type:"spki",format:"der"});
    const keyId=ownerKeyId(spki),installationId="owner:integration_owner_01",origin="https://owner.example.com";
    await operator.query("INSERT INTO wanderful_owner_v1.owners(installation_id) VALUES($1)",[installationId]);
    await operator.query("INSERT INTO wanderful_owner_v1.keys(key_id,installation_id,public_key_spki) VALUES($1,$2,$3)",[keyId,installationId,spki]);
    const endpoint=createOwnerAccessEndpoint({enabled:true,origin,environment:"production",repository:repo});
    const context={edgeIdentity:"disposable-loopback-peer"};
    async function proof(){
      const response=await endpoint(OWNER_CHALLENGE_PATH,{keyId},context);
      assert.equal(response.statusCode,200);
      const nonce=randomBytes(32),challenge=response.payload;
      const data=canonicalOwnerSessionClientData({origin,keyId,challengeId:challenge.challengeId,
        challenge:Buffer.from(challenge.challenge,"base64url"),sessionNonce:nonce});
      return {keyId,challengeId:challenge.challengeId,sessionNonce:nonce.toString("base64url"),
        signature:sign("sha256",data,{key:pair.privateKey,dsaEncoding:"ieee-p1363"}).toString("base64url")};
    }
    const body=await proof();
    const exchanges=await Promise.all(Array.from({length:3},()=>endpoint(OWNER_SESSION_PATH,body,context)));
    assert.deepEqual(exchanges.map((r)=>r.statusCode).sort(),[200,401,401]);
    const token=exchanges.find((r)=>r.statusCode===200).payload.routeSessionToken;
    const limits={maximumConcurrency:2,ownerDailyMaximum:2,globalDailyMaximum:2};
    const auth=createOwnerSessionAuthorizer({repository:repo,scope:"route",limits});
    const authOther=createOwnerSessionAuthorizer({repository:worker,scope:"route",limits});
    const requestId=randomUUID();
    const headers={authorization:`TrailMindRouteSession ${token}`,"x-trailmind-request-id":requestId};
    const a=await auth.authorize({headers,cost:1});
    await assert.rejects(()=>authOther.authorize({headers,cost:1}),{code:"request_replayed"});
    const b=await authOther.authorize({headers:{...headers,"x-trailmind-request-id":randomUUID()},cost:1});
    await assert.rejects(()=>auth.authorize({headers:{...headers,"x-trailmind-request-id":randomUUID()},cost:1}),{code:"app_attest_rate_limited"});
    const results=await Promise.allSettled([a.reserveProviderAttempt(),b.reserveProviderAttempt(),a.reserveProviderAttempt()]);
    assert.equal(results.filter((r)=>r.status==="fulfilled").length,2);
    await a.release();await b.release();
    // Renew session and instantiate a fresh repository worker: durable budgets remain spent.
    const renewed=await endpoint(OWNER_SESSION_PATH,await proof(),context);
    assert.equal(renewed.statusCode,200);
    assert.notEqual(renewed.payload.routeSessionToken,token);
    const freshAuth=createOwnerSessionAuthorizer({repository:new PostgresOwnerRepository({pool:runtime}),scope:"route",limits});
    const c=await freshAuth.authorize({headers:{authorization:`TrailMindRouteSession ${renewed.payload.routeSessionToken}`,
      "x-trailmind-request-id":randomUUID()},cost:1});
    await assert.rejects(()=>c.reserveProviderAttempt(),{code:"app_attest_rate_limited"});
    await c.release();
    await operator.query("UPDATE wanderful_owner_v1.sessions SET expires_at=clock_timestamp()-interval '1 second' WHERE token_hash=$1",[hashOpaqueValue(renewed.payload.routeSessionToken)]);
    await assert.rejects(()=>freshAuth.authorize({headers:{authorization:`TrailMindRouteSession ${renewed.payload.routeSessionToken}`,
      "x-trailmind-request-id":randomUUID()},cost:1}),{code:"route_session_expired"});
    const expiredProof=await proof();
    await operator.query("UPDATE wanderful_owner_v1.challenges SET expires_at=clock_timestamp()-interval '1 second' WHERE challenge_id=$1",[expiredProof.challengeId]);
    assert.equal((await endpoint(OWNER_SESSION_PATH,expiredProof,context)).statusCode,401);
    // The Google scope has its own cap; revocation denies an already-issued session.
    const intentAuth=createOwnerSessionAuthorizer({repository:repo,scope:"intent",limits});
    const intent=await intentAuth.authorize({headers:{...headers,"x-trailmind-request-id":randomUUID()},cost:3});
    await intent.reserveProviderAttempt();
    await operatorRepo.revokeOwner(installationId);
    await assert.rejects(()=>intent.reserveProviderAttempt());
    await intent.release();
    await assert.rejects(()=>auth.authorize({headers:{...headers,"x-trailmind-request-id":randomUUID()},cost:1}));
    assert.equal((await endpoint(OWNER_CHALLENGE_PATH,{keyId},context)).statusCode,403);
    const budgets=await operator.query("SELECT cost FROM wanderful_owner_v1.windows WHERE scope='route-provider-global'");
    assert.equal(budgets.rows[0].cost,2);
    await operator.query(await readFile(new URL("../src/ownerAccess/002_owner_prune.sql",import.meta.url),"utf8"));
    const afterPrune=await operator.query("SELECT cost FROM wanderful_owner_v1.windows WHERE scope='route-provider-global'");
    assert.equal(afterPrune.rows[0].cost,2,"Cleanup preserves active provider counters");
  } finally {await runtime?.end();await operator.end();}
});
