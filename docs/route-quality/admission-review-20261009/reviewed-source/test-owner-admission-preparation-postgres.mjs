// Explicit disposable localhost PG only. No actual phone key, credential or provider.
import {createRequire} from 'node:module';
import {generateKeyPairSync} from 'node:crypto';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {enrollmentPreview} from './prepare-owner-admission.mjs';
import {ownerKeyId} from '../../../backend/src/ownerAccess/ownerAccessEndpoint.js';
const require=createRequire(new URL('../../../backend/package.json',import.meta.url));const pg=require('pg');
const url=new URL(process.env.OWNER_PREPARATION_LOCAL_PG_URL);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.pathname,'/owner_admission_preparation');assert.ok(!url.password);
const pool=new pg.Pool({connectionString:url.href,max:1});let client;
function fixture(){const der=generateKeyPairSync('ec',{namedCurve:'prime256v1'}).publicKey.export({format:'der',type:'spki'});return enrollmentPreview({keyId:ownerKeyId(der),publicKeySPKI:der.toString('base64')});}
async function refused(p){try{await assert.rejects(()=>client.query(p.operatorEnrollmentSQLPreview),/Existing owner/);}finally{await client.query('ROLLBACK');}}
try{
 client=await pool.connect();await client.query(readFileSync(new URL('../../../backend/src/ownerAccess/003_private_owner_bootstrap_20261005.sql',import.meta.url),'utf8'));
 await client.query("INSERT INTO wanderful_owner_v1.windows(scope,identity_hash,cost,reset_at) VALUES('wanderful-live-wave-20261003:google','global',1,'infinity')");
 const a=fixture();await client.query(a.operatorEnrollmentSQLPreview);await client.query(a.operatorEnrollmentSQLPreview);
 assert.equal((await client.query('SELECT count(*)::int AS n FROM wanderful_owner_v1.keys')).rows[0].n,1);
 const b=fixture();await client.query(b.operatorEnrollmentSQLPreview);await client.query('UPDATE wanderful_owner_v1.owners SET revoked_at=clock_timestamp() WHERE installation_id=$1',[b.installationId]);await refused(b);
 assert.ok((await client.query('SELECT revoked_at IS NOT NULL AS revoked FROM wanderful_owner_v1.owners WHERE installation_id=$1',[b.installationId])).rows[0].revoked);
 const c=fixture();await client.query(c.operatorEnrollmentSQLPreview);await client.query("UPDATE wanderful_owner_v1.keys SET public_key_spki=decode('00','hex') WHERE key_id=$1",[c.keyId]);await refused(c);
 assert.equal((await client.query('SELECT octet_length(public_key_spki) AS n FROM wanderful_owner_v1.keys WHERE key_id=$1',[c.keyId])).rows[0].n,1);
 const d=fixture();await client.query(d.operatorEnrollmentSQLPreview);await client.query('UPDATE wanderful_owner_v1.keys SET revoked_at=clock_timestamp() WHERE key_id=$1',[d.keyId]);await refused(d);
 assert.ok((await client.query('SELECT revoked_at IS NOT NULL AS revoked FROM wanderful_owner_v1.keys WHERE key_id=$1',[d.keyId])).rows[0].revoked);
 const wave=(await client.query("SELECT cost,reset_at::text AS reset FROM wanderful_owner_v1.windows WHERE scope='wanderful-live-wave-20261003:google' AND identity_hash='global'")).rows[0];assert.equal(wave.cost,1);assert.equal(wave.reset,'infinity');
 assert.equal((await client.query("SELECT rolpassword IS NULL AS unset FROM pg_authid WHERE rolname='wanderful_owner_runtime'")).rows[0].unset,true);
 console.log(JSON.stringify({realLocalPGAssertionsPass:6,idempotentExactPublicEnrollment:true,revokedOwnerNotRevived:true,conflictingKeyNotOverwritten:true,revokedKeyNotRevived:true,existingWaveCostAndInfinityUnchanged:true,rolePasswordUnchanged:true,actualPhoneEnrollment:false,cloudMutations:0,providerCalls:0}));
}finally{if(client)client.release();await pool.end();}
