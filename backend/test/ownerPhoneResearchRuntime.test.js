import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {loadOwnerResearchConfiguration,createOwnerResearchRuntime,verifyOwnerResearchReadiness} from '../scripts/owner-phone-research-runtime.js';
import {startOwnerPhoneTest} from '../scripts/start-owner-phone-test.js';
function fixture(t,content) {
  const directory=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'owner-research-'));fs.chmodSync(directory,0o700);
  const file=path.join(directory,'research.env');
  fs.writeFileSync(file,content??['OUTDOOR_RESEARCH_DATABASE_URL=postgresql://research_test:synthetic@db.mbvzwsrtqcrwhvykugcd.supabase.co:5432/postgres',
    'OUTDOOR_RESEARCH_CANCELLATION_DATABASE_URL=postgresql://cancel_test:synthetic@db.mbvzwsrtqcrwhvykugcd.supabase.co:5432/postgres'].join('\n'),{mode:0o600});
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));return {file,directory};
}
test('private file metadata, exact staging, distinct users, strict TLS and key allowlist',t=>{
  const {file,directory}=fixture(t);const original=fs.readFileSync(file,'utf8');
  const config=loadOwnerResearchConfiguration(file);assert.equal(config[0].ssl.rejectUnauthorized,true);assert.equal(config[0].host,config[1].host);
  for(const bad of [original+'\nGOOGLE_API_KEY=synthetic',original.replace('research_test','postgres'),original.replace('cancel_test','research_test'),original.replaceAll('mbvzwsrtqcrwhvykugcd','otherproject'),original.replaceAll('/postgres','/postgres?sslmode=disable')]) {
    fs.writeFileSync(file,bad);assert.throws(()=>loadOwnerResearchConfiguration(file),{message:'owner_research_unavailable'});
  }
  fs.writeFileSync(file,original);fs.chmodSync(file,0o644);assert.throws(()=>loadOwnerResearchConfiguration(file));fs.chmodSync(file,0o600);
  const link=path.join(directory,'link.env');fs.symlinkSync(file,link);assert.throws(()=>loadOwnerResearchConfiguration(link));
  fs.chmodSync(directory,0o755);assert.throws(()=>loadOwnerResearchConfiguration(file));fs.chmodSync(directory,0o700);
});
function poolHarness({privileged=false,failSecond=false,cancelAllowed=true}={}) {
  const pools=[];
  class FakePool {
    constructor(config){if(failSecond&&pools.length===1)throw Error('synthetic secret');this.config=config;this.ended=0;pools.push(this);}
    on(){} connect(){assert.fail('injected readiness owns queries');}
    async query(sql){if(sql.includes('has_function_privilege'))return {rows:[{can_cancel_research:cancelAllowed}]};return {rows:[{role:this.config.user,rolsuper:privileged,rolbypassrls:false,rolcreatedb:false,rolcreaterole:false,rolcanlogin:true}]};}
    async end(){this.ended++;}
  } return {pools,PoolClass:FakePool};
}
test('bounded separate pools and trailmind_app repository; closes on success and each failure',async t=>{
  const {file}=fixture(t);const harness=poolHarness();
  const runtime=await createOwnerResearchRuntime(file,{...harness,readiness:async repo=>{
    assert.equal(repo.cancellationFunction,'trailmind_control.cancel_active_outdoor_research_backend_integer');
    assert.notEqual(repo.pool,repo.cancellationPool);assert.match(repo.runtimeQueries.snapshotContext,/"trailmind_app"/);return {proposalCount:1};
  }});
  for(const pool of harness.pools){assert.equal(pool.config.max,1);assert.equal(pool.config.ssl.rejectUnauthorized,true);assert.ok(pool.config.statement_timeout<=2500);}
  await runtime.close();await runtime.close();assert.deepEqual(harness.pools.map(p=>p.ended),[1,1]);
  for(const settings of [{privileged:true},{failSecond:true},{cancelAllowed:false},{}]) {
    const h=poolHarness(settings);await assert.rejects(createOwnerResearchRuntime(file,{...h,readiness:async()=>{throw Error('secret detail');}}),{message:'owner_research_unavailable'});
    assert.ok(h.pools.every(p=>p.ended===1));
  }
});
test('readiness refuses empty/stale/no-access and unsupported selector sets without model calls',async()=>{
  const repository={};const base={state:'ready',dossier:{candidateHighlights:[{}]},trailAccessResolution:{candidates:[{}]}};
  const good={state:'partial',proposals:[{selectedHighlights:[{role:'preferred',evidenceClaimIds:['id'],selectionReasons:['reason'],trailAccessCandidate:{}}]}]};
  for(const result of [{state:'unsupported',availabilityState:'stale'}, {...base,dossier:{candidateHighlights:[]}}, {...base,trailAccessResolution:{candidates:[]}}])
    await assert.rejects(verifyOwnerResearchReadiness(repository,{research:async()=>result,plan:()=>assert.fail('no planner for missing evidence')}));
  for(const candidate of [{state:'insufficient_evidence',proposals:[]},{...good,proposals:[{selectedHighlights:[]}]},{...good,proposals:[{selectedHighlights:Array(4).fill({...good.proposals[0].selectedHighlights[0],role:'must_have'})}]}])
    await assert.rejects(verifyOwnerResearchReadiness(repository,{research:async()=>base,plan:()=>candidate}));
  assert.equal((await verifyOwnerResearchReadiness(repository,{research:async()=>base,plan:()=>good})).proposalCount,1);
});
test('launcher checks real research readiness before provider file/token and cleans budget on failure',async t=>{
  const {directory}=fixture(t);let closed=0,reads=0,tokens=0;
  await assert.rejects(startOwnerPhoneTest({enabled:true,researchEnabled:true,researchConfigPath:'/synthetic/research.env',credentialPath:'/synthetic/provider.env',
    publicURL:'https://synthetic.example/',outputPath:path.join(directory,'OwnerPhoneTest.json')},{
    createBudget:()=>({close(){closed++;}}),createResearchRuntime:async()=>{throw Error('owner_research_unavailable');},
    readProviderFile:()=>{reads++;},makeToken:()=>{tokens++;}
  }),{message:'owner_research_unavailable'});
  assert.equal(closed,1);assert.equal(reads,0);assert.equal(tokens,0);assert.equal(fs.existsSync(path.join(directory,'OwnerPhoneTest.json')),false);
});
test('provider-file failure after readiness closes research and budget without token',async t=>{
  const {directory}=fixture(t);let poolsClosed=0,budgetClosed=0,tokens=0;
  await assert.rejects(startOwnerPhoneTest({enabled:true,researchEnabled:true,researchConfigPath:'/synthetic/research.env',credentialPath:'/synthetic/provider.env',
    publicURL:'https://synthetic.example/',outputPath:path.join(directory,'OwnerPhoneTest.json')},{
    createBudget:()=>({close(){budgetClosed++;}}),createResearchRuntime:async()=>({repository:{},close:async()=>{poolsClosed++;}}),
    readProviderFile:()=>{throw Error('secret');},makeToken:()=>{tokens++;}
  }),{message:'owner_startup_unavailable'});
  assert.equal(poolsClosed,1);assert.equal(budgetClosed,1);assert.equal(tokens,0);
});
test('real executor rejects empty database snapshot through bounded trailmind_app function',async t=>{
  const {file}=fixture(t),h=poolHarness();const queries=[];
  h.PoolClass.prototype.connect=async function(){return {processID:123,release(){},async query(sql){queries.push(sql);return {rows:[]};}};};
  await assert.rejects(createOwnerResearchRuntime(file,h),{message:'owner_research_unavailable'});
  assert.ok(queries.some(sql=>sql.includes('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')));
  assert.ok(queries.some(sql=>sql.includes('"trailmind_app".trailmind_runtime_outdoor_research_snapshot_context_v1')));
  assert.ok(h.pools.every(pool=>pool.ended===1));
});
test('fully composed launcher shares budget and closes server/research/budget on shutdown',async t=>{
  const {directory}=fixture(t);const calls=[];const fetchImpl=()=>assert.fail('no provider calls at startup');
  const server={once(){},listen(port,host,callback){assert.equal(host,'127.0.0.1');callback();},closeAllConnections(){calls.push('connections');},close(callback){calls.push('server');callback();}};
  const runtime=await startOwnerPhoneTest({enabled:true,researchEnabled:true,researchConfigPath:'/synthetic/research.env',credentialPath:'/synthetic/provider.env',
    publicURL:'https://synthetic.example/',outputPath:path.join(directory,'OwnerPhoneTest.json')},{
    createBudget:({limits})=>{assert.deepEqual(limits,{google:2,graphhopper:2});return {fetch:fetchImpl,close(){calls.push('budget');}};},
    createResearchRuntime:async()=>{calls.push('readiness');return {repository:{withConsistentSnapshot(){}},summary:{proposalCount:1},close:async()=>{calls.push('research');}};},
    readProviderFile:()=>{calls.push('provider-file');return 'AI_PROVIDER=google\nGOOGLE_API_KEY=synthetic\nGRAPHHOPPER_API_KEY=synthetic';},
    makeToken:()=>{calls.push('placeholder');return 'not-a-valid-owner-token';},
    createSession:()=>({revoke(){calls.push('revoke');}}),
    createServer:options=>{assert.equal(options.fetchImpl,fetchImpl);assert.equal(options.env.GOOGLE_MODEL,'gemini-3.8-flash');assert.equal(options.env.OWNER_PHONE_RESEARCH_TEST_ENABLED,'true');return server;}
  });
  assert.deepEqual(calls,['readiness','provider-file','placeholder']);
  assert.ok(runtime.expiresAt<=Date.now()+1800000);await runtime.stop();await runtime.stop();
  assert.deepEqual(calls.slice(3),['revoke','connections','server','research','budget']);
});

// Filesystem injection models the engine-owned socket; tests never connect to it.
function localSocketFilesystem({badDirectory=false,badOwner=false,symlink=false,notSocket=false}={}) {
  return {realpathSync:value=>value,lstatSync:value=>({
    uid:badOwner?process.getuid()+1:process.getuid(),mode:badDirectory?0o755:0o700,
    isDirectory:()=>!value.includes('.s.PGSQL.'),isSymbolicLink:()=>symlink,isSocket:()=>!notSocket
  })};
}
const LOCAL_SOCKET='/private/tmp/wf-ilsenburg-local-iSXL9g/socket';
const LOCAL_CONFIG=`OWNER_RESEARCH_TRANSPORT=owner-local-unix\nOWNER_RESEARCH_LOCAL_SOCKET=${LOCAL_SOCKET}`;
test('local mode pins exact socket and roles; cannot weaken staging URL validation',t=>{
  const {file}=fixture(t,LOCAL_CONFIG);const socketFilesystem=localSocketFilesystem();
  const configs=loadOwnerResearchConfiguration(file,{socketFilesystem});
  assert.deepEqual(configs.map(c=>c.user),['outdoor_research_runtime_role','outdoor_research_cancellation_control_role']);
  for(const config of configs){assert.equal(config.host,LOCAL_SOCKET);assert.equal(config.port,55439);assert.equal(config.database,'wanderful_local_pilot');assert.equal(config.ssl,false);assert.equal(config.password(),'');}
  for(const config of [LOCAL_CONFIG.replace(LOCAL_SOCKET,'/private/tmp/other/socket'),LOCAL_CONFIG+'\nOUTDOOR_RESEARCH_DATABASE_URL=postgres://localhost/db',LOCAL_CONFIG.replace('owner-local-unix','local'),LOCAL_CONFIG+'\nOWNER_RESEARCH_ROLE=postgres']) {
    fs.writeFileSync(file,config);assert.throws(()=>loadOwnerResearchConfiguration(file,{socketFilesystem}));
  }
  fs.writeFileSync(file,LOCAL_CONFIG);
  for(const setting of [{badDirectory:true},{badOwner:true},{symlink:true},{notSocket:true}])
    assert.throws(()=>loadOwnerResearchConfiguration(file,{socketFilesystem:localSocketFilesystem(setting)}));
});
test('local runtime enforces socket-only server identity while retaining role/readiness/cleanup checks',async t=>{
  const {file}=fixture(t,LOCAL_CONFIG);
  for(const tcpEnabled of [false,true]) {
    const h=poolHarness();const inheritedQuery=h.PoolClass.prototype.query;
    h.PoolClass.prototype.query=async function(sql){
      assert.ok(!sql.includes('unix_socket_directories'));
      assert.ok(!sql.includes('pg_has_role'));
      if(sql.includes('current_database()'))return {rows:[{database:'wanderful_local_pilot',listen_addresses:tcpEnabled?'localhost':'',unix_socket_connection:true}]};
      return inheritedQuery.call(this,sql);
    };
    let checks=0;
    const promise=createOwnerResearchRuntime(file,{...h,socketFilesystem:localSocketFilesystem(),readiness:async repo=>{
      checks++;assert.match(repo.runtimeQueries.snapshotContext,/"trailmind_app"/);return {proposalCount:1};
    }});
    if(tcpEnabled){await assert.rejects(promise);assert.equal(checks,0);}else{const runtime=await promise;assert.equal(checks,1);assert.ok(h.pools.every(p=>p.config.max===1));await runtime.close();}
    assert.ok(h.pools.every(p=>p.ended===1));
  }
});

test('launcher enables web mode only with a separate explicit grounding-request allowance',async t=>{
 for(const grounded of [false,true]) {
  const {directory}=fixture(t);
  const limits={google:9,graphhopper:3,osm:2,wikidata:4,commons:2,...(grounded?{grounding:1}:{})};
  const server={once(){},listen(_port,_host,callback){callback();},closeAllConnections(){},close(callback){callback();}};
  const runtime=await startOwnerPhoneTest({enabled:true,dynamicResearchAllowance:limits,dynamicResearchUserAgent:'Offline test',
   credentialPath:'/synthetic/provider.env',publicURL:'https://synthetic.example/',outputPath:path.join(directory,'OwnerPhoneTest.json')},{
   createBudget:options=>{assert.deepEqual(options.limits,limits);assert.equal(options.dynamicResearch,true);return {fetch:()=>assert.fail('no startup probes'),close(){}};},
   readProviderFile:()=> 'AI_PROVIDER=google\nGOOGLE_API_KEY=synthetic\nGRAPHHOPPER_API_KEY=synthetic',
   makeToken:()=> 'synthetic-token',createSession:()=>({revoke(){}}),
   createResearchRuntime:()=>assert.fail('dynamic web mode cannot depend on an imported regional database'),
   createServer:options=>{assert.equal(options.env.DYNAMIC_WEB_RESEARCH_ENABLED,grounded?'true':undefined);return server;}
  });
  await runtime.stop();
 }
});
