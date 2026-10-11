import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {randomBytes,generateKeyPairSync} from 'node:crypto';
import {ownerKeyId} from '../src/ownerAccess/ownerAccessEndpoint.js';
import {createVercelPrivateOwnerHandler,ownerVercelDatabaseConfiguration,OWNER_CA_FINGERPRINT,isPrivateOwnerPath} from '../src/ownerAccess/vercelOwnerRuntime.js';
import {createVercelEntrypoint} from '../api/index.js';
// Public vendor CA from authenticated Root project download, never a private key.
const pem=readFileSync(new URL('./fixtures/supabase-public-ca-20261005.pem',import.meta.url),'utf8');
const pair=generateKeyPairSync('ec',{namedCurve:'prime256v1'}),spki=pair.publicKey.export({format:'der',type:'spki'}),keyId=ownerKeyId(spki);
const env=()=>({NODE_ENV:'production',OWNER_ACCESS_ENABLED:'true',OWNER_ACCESS_DYNAMIC_RESEARCH_ENABLED:'true',OWNER_ACCESS_ORIGIN:'https://owner.example.com',
 OWNER_ACCESS_KEY_ID:keyId,OWNER_ACCESS_TEST_EXPIRES_AT:new Date(Date.now()+1800000).toISOString(),DYNAMIC_RESEARCH_USER_AGENT:'Offline Vercel owner fixture',
 AI_PROVIDER:'google',GOOGLE_MODEL:'gemini-3.8-flash',GOOGLE_API_KEY:'synthetic-google',GRAPHHOPPER_API_KEY:'synthetic-gh',
 OWNER_ACCESS_DATABASE_URL:'postgresql://wanderful_owner_runtime.mbvzwsrtqcrwhvykugcd:synthetic@aws-0-eu-central-1.pooler.supabase.com:5432/postgres?sslmode=verify-full&sslrootcert=/tmp/wanderful-app-attest-ca.pem',
 APP_ATTEST_DATABASE_CA_PEM:pem,APP_ATTEST_DATABASE_CA_SHA256:OWNER_CA_FINGERPRINT});

test('private Vercel database pins authenticated project, exact role/session5432 and verified CA/TLS',()=>{
 const e=env(),cfg=ownerVercelDatabaseConfiguration(e),url=new URL(cfg.connectionString);
 assert.equal(url.search,'');assert.equal(cfg.ssl.rejectUnauthorized,true);assert.equal(cfg.ssl.ca,pem);
 for(const patch of [{OWNER_ACCESS_DATABASE_URL:e.OWNER_ACCESS_DATABASE_URL.replace('wanderful_owner_runtime','postgres')},
  {OWNER_ACCESS_DATABASE_URL:e.OWNER_ACCESS_DATABASE_URL.replace(':5432',':6543')},
  {OWNER_ACCESS_DATABASE_URL:e.OWNER_ACCESS_DATABASE_URL.replace('aws-0-eu-central-1.pooler.supabase.com','evil.example.com')},
  {OWNER_ACCESS_DATABASE_URL:e.OWNER_ACCESS_DATABASE_URL.replace('verify-full','require')},
  {OWNER_ACCESS_DATABASE_URL:e.OWNER_ACCESS_DATABASE_URL+'&sslmode=disable'},
  {APP_ATTEST_DATABASE_CA_SHA256:'0'.repeat(64)},{NODE_TLS_REJECT_UNAUTHORIZED:'0'}])assert.throws(()=>ownerVercelDatabaseConfiguration({...e,...patch}));
});

test('owner namespace selector never selects ordinary public endpoints or client headers',()=>{
 for(const p of ['/api/route','/api/parse-intent','/api/llm-plan-route','/api/app-attest/register','/readyz','/healthz'])assert.equal(isPrivateOwnerPath(p),false);
 for(const p of ['/api/private-owner/parse-intent','/api/private-owner/llm-plan-route','/api/owner-access/route-session'])assert.equal(isPrivateOwnerPath(p),true);
});

function response(){return {status:0,body:null,writeHead(status){this.status=status;},end(body){this.body=JSON.parse(body);}};}
test('disabled/missing owner credentials cannot weaken public Vercel admission',async()=>{
 const handler=createVercelEntrypoint({env:{NODE_ENV:'production'},PoolClass:class{constructor(){assert.fail('pool with disabled config');}}});
 const health=response();await handler({method:'GET',url:'/healthz',headers:{}},health);assert.equal(health.status,200);
 const pub=response();await handler({method:'POST',url:'/api/llm-plan-route',headers:{'x-owner':'true'}},pub);assert.equal(pub.status,503);assert.equal(pub.body.error.code,'service_unavailable');
 const owner=response();await handler({method:'GET',url:'/api/private-owner/readyz',headers:{}},owner);assert.equal(owner.status,503);assert.equal(owner.body.error.code,'owner_access_unavailable');
});

class SyntheticPool {
 constructor(config){assert.equal(config.ssl.rejectUnauthorized,true);this.roleValid=true;this.guardActive=true;this.keyActive=true;this.queries=0;}
 on(){}async end(){}
 async connect(){assert.fail('no transaction/auth in readiness mock');}
 async query(sql){
  this.queries++;
  if(sql.includes('FROM pg_trigger'))return {rows:this.guardActive?[{}]:[],rowCount:this.guardActive?1:0};
  if(sql.includes('current_user AS role'))return {rows:[{role:this.roleValid?'wanderful_owner_runtime':'postgres',rolsuper:false,rolbypassrls:false,rolcreatedb:false,rolcreaterole:false,rolinherit:false,rolreplication:false}]};
  if(sql.includes('SELECT k.*'))return {rows:this.keyActive?[{installation_id:'owner:offline_vercel_identity',public_key_spki:spki}]:[]};
  if(sql.includes('SELECT c.relname'))return {rows:['challenges','keys','leases','owners','requests','sessions','windows'].map(relname=>({relname,relrowsecurity:true,owned:false,sel:true,ins:!['keys','owners'].includes(relname),upd:!['keys','owners','requests'].includes(relname),del:false,trunc:false,trig:false,refs:false}))};
  return {rows:[],rowCount:0};
 }
}

test('actual additive Vercel HTTP mount accepts only private paths, exact host and repeatedly checked role/key readiness',async t=>{
 let pool;
 const HandlerPool=class extends SyntheticPool{constructor(cfg){super(cfg);pool=this;}};
 const handler=createVercelPrivateOwnerHandler({env:env(),PoolClass:HandlerPool,fetchImpl:()=>assert.fail('no provider in readiness test')});
 const server=createServer(handler);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
 const {request}=await import('node:http');
 const get=(path,host='owner.example.com')=>new Promise((resolve,reject)=>{
  const req=request(`http://127.0.0.1:${server.address().port}${path}`,{headers:{host}},res=>{res.resume();res.once('end',()=>resolve(res.statusCode));});req.once('error',reject);req.end();
 });
 assert.equal(await get('/api/private-owner/readyz'),200);
 assert.equal(await get('/api/private-owner/readyz','evil.example.com'),404);
 assert.equal(await get('/api/parse-intent'),404);
 pool.roleValid=false;assert.equal(await get('/api/private-owner/readyz'),503);
 pool.roleValid=true;pool.guardActive=false;assert.equal(await get('/api/private-owner/readyz'),503);
 pool.guardActive=true;pool.keyActive=false;assert.equal(await get('/api/private-owner/readyz'),503);
});
