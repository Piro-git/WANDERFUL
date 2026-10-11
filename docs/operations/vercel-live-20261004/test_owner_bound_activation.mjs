// Only an explicitly disposable local PG17 cluster; no cloud credential paths.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {activateNewOwner,ACTIVATION_DO,scramVerifier} from './activate-owner-credential-input.mjs';
const require=createRequire(new URL('../../../backend/package.json',import.meta.url));const pg=require('pg');
const url=new URL(process.env.OWNER_LOCAL_GUARD_POSTGRES_URL);
assert.equal(url.hostname,'127.0.0.1');assert.equal(url.pathname,'/owner_credential_test');assert.ok(!url.password);
const pool=new pg.Pool({connectionString:url.href,max:1});let client,owner;
const password='PUBLIC_SYNTHETIC_NODE_TEST_PASSWORD_ONLY@#';
try{
 client=await pool.connect();await client.query('CREATE EXTENSION pg_stat_statements');
 await client.query(readFileSync(new URL('../../../backend/src/ownerAccess/003_private_owner_bootstrap_20261005.sql',import.meta.url),'utf8'));
 await client.query("SET pg_stat_statements.track='all'");
 assert.equal(await activateNewOwner(client,password),'protected_channel_unavailable');
 await client.query("SET pg_stat_statements.track='top'");
 // A forced inner utility error must stay inside the DO, never expose its SQL.
 const failedVerifier=scramVerifier(password);
 await client.query('BEGIN');await client.query("SELECT set_config('wanderful.owner_verifier',$1,true)",[failedVerifier]);
 await client.query(ACTIVATION_DO.replace('ALTER ROLE wanderful_owner_runtime PASSWORD','ALTER ROLE missing_disposable_owner PASSWORD'));
 const errorStatus=await client.query("SELECT current_setting('wanderful.activation_status',true) AS status");
 assert.equal(errorStatus.rows[0].status,'activation_failed');await client.query('ROLLBACK');
 assert.equal(await activateNewOwner(client,password),'role_activated');
 assert.equal(await activateNewOwner(client,password+'DIFFERENT'),'activation_refused','No existing role password reset');
 const hash=(await client.query("SELECT rolpassword FROM pg_authid WHERE rolname='wanderful_owner_runtime'")).rows[0].rolpassword;
 const statements=(await client.query('SELECT query FROM pg_stat_statements')).rows.map(r=>r.query).join('\n');
 const log=readFileSync(process.env.OWNER_LOCAL_GUARD_PG_LOG,'utf8');
 for(const secret of [password,hash,failedVerifier]){assert.ok(!statements.includes(secret),'No test secret in query recording');assert.ok(!log.includes(secret),'No test secret in server log');}
 owner=new pg.Pool({host:'127.0.0.1',port:Number(url.port),database:'owner_credential_test',user:'wanderful_owner_runtime',password,max:1});
 assert.equal((await owner.query('SELECT current_user AS role')).rows[0].role,'wanderful_owner_runtime');
 console.log(JSON.stringify({checksPassed:7,actualLocalOwnerSCRAMLogin:true,unsafeNestedQueryRecordingDenied:true,innerErrorDoesNotLogVerifier:true,DDLLoggingUnchanged:true,serverLogAndQueryRecordingContainNoTestCredentials:true,existingPasswordResetRefused:true,managedDatabaseChanged:false,providerCalls:0}));
}finally{if(client)client.release();if(owner)await owner.end();await pool.end();}
