// Human-only local credential handoff, not an HTTP endpoint or persistent function.
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {randomBytes,pbkdf2Sync,createHmac,createHash} from 'node:crypto';
import {ownerVercelDatabaseConfiguration,OWNER_POOLER_HOST,OWNER_CA_FINGERPRINT,OWNER_PROJECT_REF} from '../../../backend/src/ownerAccess/vercelOwnerRuntime.js';
const require=createRequire(new URL('../../../backend/package.json',import.meta.url));
const pg=require('pg');
export function scramVerifier(password,salt=randomBytes(16)){
 if(typeof password!=='string'||!/^[\x21-\x7e]{20,512}$/.test(password))throw Error('invalid_owner_password');
 const salted=pbkdf2Sync(password,salt,4096,32,'sha256');
 const clientKey=createHmac('sha256',salted).update('Client Key').digest();
 const stored=createHash('sha256').update(clientKey).digest('base64');
 const server=createHmac('sha256',salted).update('Server Key').digest('base64');
 return `SCRAM-SHA-256$4096:${salt.toString('base64')}$${stored}:${server}`;
}
export function loggingGate(rows){
 const s=Object.fromEntries(rows.map(r=>[r.name,r.setting]));
 return ['none','ddl'].includes(s.log_statement)&&s.log_min_duration_statement==='-1'&&
 s.log_min_duration_sample==='-1'&&s.log_transaction_sample_rate==='0'&&
 s.log_parameter_max_length_on_error==='0'&&['none',''].includes(s['pgaudit.log']??'none')&&
 ['none','top'].includes(s['pg_stat_statements.track']??'none');
}
export const ACTIVATION_DO=`DO $owner_activation$
DECLARE verifier text := current_setting('wanderful.owner_verifier',true);
BEGIN
 IF current_user <> 'postgres' OR verifier IS NULL OR verifier NOT LIKE 'SCRAM-SHA-256$4096:%' THEN
   PERFORM set_config('wanderful.activation_status','activation_refused',true); RETURN;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_authid r WHERE rolname='wanderful_owner_runtime'
   AND rolpassword IS NULL AND rolcanlogin AND NOT rolinherit AND NOT rolsuper
   AND NOT rolbypassrls AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication
   AND rolconnlimit=4 AND NOT EXISTS(SELECT 1 FROM pg_auth_members WHERE member=r.oid)) THEN
   PERFORM set_config('wanderful.activation_status','activation_refused',true); RETURN;
 END IF;
 BEGIN
   EXECUTE format('ALTER ROLE wanderful_owner_runtime PASSWORD %L',verifier);
   PERFORM set_config('wanderful.activation_status','role_activated',true);
 EXCEPTION WHEN OTHERS THEN
   -- Do not rethrow the inner SQL/context, which could contain a verifier.
   PERFORM set_config('wanderful.activation_status','activation_failed',true);
 END;
END $owner_activation$;`;
export async function activateNewOwner(client,password){
 const settings=await client.query(`SELECT name,setting FROM pg_settings WHERE name IN
 ('log_statement','log_min_duration_statement','log_min_duration_sample','log_transaction_sample_rate',
 'log_parameter_max_length_on_error','pgaudit.log','pg_stat_statements.track')`);
 if(!loggingGate(settings.rows))return 'protected_channel_unavailable';
 try{
  await client.query('BEGIN');
  // The statement and pg_stat_statements text contain only $1, never this value.
  await client.query("SELECT set_config('wanderful.owner_verifier',$1,true)",[scramVerifier(password)]);
  await client.query(ACTIVATION_DO);
  const status=(await client.query("SELECT current_setting('wanderful.activation_status',true) AS status")).rows[0]?.status;
  if(status!=='role_activated'){await client.query('ROLLBACK');return 'activation_refused';}
  await client.query('COMMIT');return 'role_activated';
 }catch{
  try{await client.query('ROLLBACK');}catch{}
  return 'activation_unavailable';
 }
}
async function main(){
 let pool,client;
 try{
  const raw=readFileSync(0,'utf8');if(Buffer.byteLength(raw)>8192)throw Error();
  const input=JSON.parse(raw);
  if(Object.keys(input).sort().join()!=='caPath,newOwnerPassword,operatorPassword'||input.caPath!=='/private/tmp/wanderful-live-wave-20261003/supabase-public-ca-20261005.pem'||typeof input.operatorPassword!=='string'||!input.operatorPassword||input.operatorPassword.length>512)throw Error();
  scramVerifier(input.newOwnerPassword);
  const owner=new URL(`postgresql://wanderful_owner_runtime.${OWNER_PROJECT_REF}@${OWNER_POOLER_HOST}:5432/postgres?sslmode=verify-full&sslrootcert=/tmp/wanderful-app-attest-ca.pem`);owner.password=input.newOwnerPassword;
  const {connectionString,...config}=ownerVercelDatabaseConfiguration({OWNER_ACCESS_DATABASE_URL:owner.href,
   APP_ATTEST_DATABASE_CA_PEM:readFileSync(input.caPath,'utf8'),APP_ATTEST_DATABASE_CA_SHA256:OWNER_CA_FINGERPRINT});
  // Operator credential is confined to this local activation pool, never runtime.
  pool=new pg.Pool({...config,max:1,host:OWNER_POOLER_HOST,port:5432,database:'postgres',user:`postgres.${OWNER_PROJECT_REF}`,password:input.operatorPassword});pool.on('error',()=>{});
  client=await pool.connect();const tls=client.connection.stream;
  if(!tls.encrypted||!tls.authorized||tls.servername!==OWNER_POOLER_HOST)throw Error();
  const status=await activateNewOwner(client,input.newOwnerPassword);
  process.stdout.write(JSON.stringify({status,role:'wanderful_owner_runtime',providerCalls:0})+'\n');
  if(status!=='role_activated')process.exitCode=1;
 }catch{process.stdout.write(JSON.stringify({status:'activation_unavailable',providerCalls:0})+'\n');process.exitCode=1;}
 finally{if(client)client.release();if(pool){try{await pool.end();}catch{process.exitCode=1;}}}
}
if(process.argv[1]===fileURLToPath(import.meta.url))await main();
