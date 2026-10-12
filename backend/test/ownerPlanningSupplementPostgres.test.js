import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomBytes,randomUUID,generateKeyPairSync} from 'node:crypto';
import pg from 'pg';
import {PostgresOwnerRepository} from '../src/ownerAccess/postgresOwnerRepository.js';
import {ownerKeyId} from '../src/ownerAccess/ownerAccessEndpoint.js';
import {supplementConfiguration} from '../src/ownerAccess/planningSupplement.js';
const url=process.env.OWNER_SUPPLEMENT_TEST_POSTGRES_URL;
test('supplement is opt-in and requires an explicit reviewed public manifest/source binding',()=>{
 const binding={keyId:'synthetic',origin:'https://backend-zeta-amber-69.vercel.app',expiresAt:Date.now()+1000};
 assert.equal(supplementConfiguration({},binding),undefined);
 assert.throws(()=>supplementConfiguration({OWNER_ACCESS_SUPPLEMENT_ENABLED:'true'},binding));
 const c=supplementConfiguration({OWNER_ACCESS_SUPPLEMENT_ENABLED:'true',OWNER_ACCESS_SUPPLEMENT_APPROVAL_SHA256:'a'.repeat(64),OWNER_ACCESS_SUPPLEMENT_BACKEND_TREE:'b'.repeat(40)},binding);
 assert.ok(Object.isFrozen(c));assert.equal(c.approvalSHA256,'a'.repeat(64));
});
test('real disposable PostgreSQL enforces single supplement, cumulative original counters and monotonic guards',{skip:!url},async t=>{
 const parsed=new URL(url);assert.equal(parsed.hostname,'127.0.0.1');assert.equal(parsed.pathname,'/owner_supplement_test');
 const operator=new pg.Pool({connectionString:url,max:2});let runtime;
 try{
  await operator.query('CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role');
  await operator.query(await readFile(new URL('../src/ownerAccess/003_private_owner_bootstrap_20261005.sql',import.meta.url),'utf8'));
  const oldDefinition=(await operator.query("SELECT pg_get_functiondef('wanderful_owner_v1.guard_planning_wave()'::regprocedure) AS d")).rows[0].d;
  await operator.query(await readFile(new URL('../../docs/operations/owner-supplement-20261012/planningSupplementSetup.sql',import.meta.url),'utf8'));
  assert.equal((await operator.query("SELECT pg_get_functiondef('wanderful_owner_v1.guard_planning_wave()'::regprocedure) AS d")).rows[0].d,oldDefinition);
  const publicKey=generateKeyPairSync('ec',{namedCurve:'prime256v1'}).publicKey.export({format:'der',type:'spki'});
  const keyId=ownerKeyId(publicKey),owner='owner:'+keyId,origin='https://backend-zeta-amber-69.vercel.app',expiresAt=Date.now()+25*60000;
  await operator.query('INSERT INTO wanderful_owner_v1.owners(installation_id) VALUES($1)',[owner]);
  await operator.query('INSERT INTO wanderful_owner_v1.keys(key_id,installation_id,public_key_spki) VALUES($1,$2,$3)',[keyId,owner,publicKey]);
  await operator.query("INSERT INTO wanderful_owner_v1.windows(scope,identity_hash,cost,reset_at) VALUES('wanderful-live-wave-20261003:requests','global',2,'infinity'),('wanderful-live-wave-20261003:google','global',4,'infinity')");
  for(const deadline of [Date.now()-1,Date.now()+31*60000])await assert.rejects(()=>operator.query("INSERT INTO wanderful_owner_budget_v1.supplement(parent_wave,approval_sha256,key_id,origin,backend_tree,expires_at) VALUES('wanderful-live-wave-20261003',$1,$2,$3,$4,to_timestamp($5/1000.0))",['a'.repeat(64),keyId,origin,'b'.repeat(40),deadline]));
  await operator.query("INSERT INTO wanderful_owner_budget_v1.supplement(parent_wave,approval_sha256,key_id,origin,backend_tree,expires_at) VALUES('wanderful-live-wave-20261003',$1,$2,$3,$4,to_timestamp($5/1000.0))",['a'.repeat(64),keyId,origin,'b'.repeat(40),expiresAt]);
  parsed.username='wanderful_owner_runtime';runtime=new pg.Pool({connectionString:parsed.href,max:4});const repo=new PostgresOwnerRepository({pool:runtime});
  const supplement={approvalSHA256:'a'.repeat(64),backendTree:'b'.repeat(40),keyId,origin,expiresAt};
  await repo.readiness();await repo.planningWaveReadiness();await repo.planningSupplementReadiness(supplement);
  await t.test('private RLS/permissions and enabled invoker guards are required',async()=>{
   for(const role of ['anon','authenticated','service_role'])assert.equal((await operator.query("SELECT has_schema_privilege($1,'wanderful_owner_budget_v1','USAGE') AS allowed",[role])).rows[0].allowed,false);
   await operator.query('ALTER TABLE wanderful_owner_budget_v1.supplement DISABLE TRIGGER supplement_write');await assert.rejects(()=>repo.planningSupplementReadiness(supplement));
   await operator.query('ALTER TABLE wanderful_owner_budget_v1.supplement ENABLE TRIGGER supplement_write');await repo.planningSupplementReadiness(supplement);
  });

  async function auth(cost,p=supplement){
   const tokenHash=randomBytes(32).toString('hex');
   await operator.query("INSERT INTO wanderful_owner_v1.sessions(token_hash,key_id,installation_id,expires_at,remaining_cost) VALUES($1,$2,$3,clock_timestamp()+interval '120 seconds',12)",[tokenHash,keyId,owner]);
   const input={tokenHash,requestId:randomUUID(),cost,scope:'intent',maximumConcurrency:1,planning:{keyId,expiresAt,admitRequest:cost===12,supplement:p}};
   const result=await repo.authorizeSession(input);return {...input,...result};
  }
  await t.test('one intent admitted, real reservation charges both supplemental and original Google even without successful upstream result',async()=>{
   const a=await auth(3);assert.equal(await repo.consumePlanningProviderAttempt({...a,keyId,expiresAt,supplement,provider:'google'}),true);await repo.releaseLease(a.leaseId);
   assert.equal((await operator.query("SELECT cost FROM wanderful_owner_v1.windows WHERE scope='wanderful-live-wave-20261003:google' AND identity_hash='global'")).rows[0].cost,5);
   await assert.rejects(()=>auth(3),{code:'route_session_exhausted'});
  });
  await t.test('approval/source/origin/expiry mismatch cannot admit a plan',async()=>{
   for(const p of [{...supplement,approvalSHA256:'c'.repeat(64)},{...supplement,backendTree:'c'.repeat(40)},{...supplement,origin:'https://other.example.org'},{...supplement,expiresAt:expiresAt+1}])await assert.rejects(()=>auth(12,p));
  });
  const plan=await auth(12);
  await t.test('one new plan is separate and never raises/reset original request count',async()=>{
   assert.equal((await operator.query("SELECT cost FROM wanderful_owner_v1.windows WHERE scope='wanderful-live-wave-20261003:requests' AND identity_hash='global'")).rows[0].cost,2);
   assert.equal((await operator.query('SELECT requests_used FROM wanderful_owner_budget_v1.supplement')).rows[0].requests_used,1);
   await assert.rejects(()=>repo.planningSupplementReadiness(supplement));
  });
  await t.test('parallel successes and failed-operation reservations share strict eight/six cumulative bounds',async()=>{
   const g=await Promise.all(Array.from({length:12},()=>repo.consumePlanningProviderAttempt({...plan,keyId,expiresAt,supplement,provider:'google'})));assert.equal(g.filter(Boolean).length,7);
   const h=await Promise.all(Array.from({length:9},()=>repo.consumePlanningProviderAttempt({...plan,keyId,expiresAt,supplement,provider:'graphhopper'})));assert.equal(h.filter(Boolean).length,6);
   const r=(await operator.query('SELECT google_used,graphhopper_used FROM wanderful_owner_budget_v1.supplement')).rows[0];assert.deepEqual(r,{google_used:8,graphhopper_used:6});
   assert.equal((await operator.query("SELECT cost FROM wanderful_owner_v1.windows WHERE scope='wanderful-live-wave-20261003:google' AND identity_hash='global'")).rows[0].cost,12);
  });
  await repo.releaseLease(plan.leaseId);
  await t.test('renewed sessions or direct SQL cannot reset, extend, bypass accounting, delete or hide another namespace',async()=>{
   await assert.rejects(()=>auth(12),{code:'route_session_exhausted'});
   for(const q of ["UPDATE wanderful_owner_budget_v1.supplement SET google_used=0","UPDATE wanderful_owner_budget_v1.supplement SET expires_at=expires_at+interval '1 minute'","DELETE FROM wanderful_owner_budget_v1.supplement","TRUNCATE wanderful_owner_budget_v1.supplement","UPDATE wanderful_owner_v1.windows SET cost=0 WHERE scope='wanderful-live-wave-20261003:google'","UPDATE wanderful_owner_v1.windows SET cost=3 WHERE scope='wanderful-live-wave-20261003:requests'","UPDATE wanderful_owner_v1.windows SET cost=cost+1 WHERE scope='wanderful-live-wave-20261003:google'"])await assert.rejects(()=>runtime.query(q));
   await assert.rejects(()=>operator.query('DELETE FROM wanderful_owner_budget_v1.supplement'));
   await assert.rejects(()=>operator.query('TRUNCATE wanderful_owner_budget_v1.supplement'));
   await assert.rejects(()=>operator.query("UPDATE wanderful_owner_budget_v1.supplement SET approval_sha256='d'||substring(approval_sha256 from 2)"));
  });
  await t.test('rollback is irreversible revocation and retains every consumed counter',async()=>{
   await operator.query('UPDATE wanderful_owner_budget_v1.supplement SET revoked_at=clock_timestamp()');
   await assert.rejects(()=>operator.query('UPDATE wanderful_owner_budget_v1.supplement SET revoked_at=NULL'));
   await assert.rejects(()=>auth(12));assert.equal((await operator.query('SELECT google_used FROM wanderful_owner_budget_v1.supplement')).rows[0].google_used,8);
  });
 }finally{await runtime?.end();await operator.end();}
});
