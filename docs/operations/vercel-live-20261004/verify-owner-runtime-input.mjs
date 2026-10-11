import {fileURLToPath} from 'node:url';
// Credential stdin only; never print raw provider/database errors or URLs.
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {ownerVercelDatabaseConfiguration,OWNER_CA_FINGERPRINT,OWNER_POOLER_HOST} from '../../../backend/src/ownerAccess/vercelOwnerRuntime.js';
import {PostgresOwnerRepository} from '../../../backend/src/ownerAccess/postgresOwnerRepository.js';
const require=createRequire(new URL('../../../backend/package.json',import.meta.url));
const pg=require('pg');
let pool,client;
try {
  const raw=readFileSync(0,'utf8');
  if(Buffer.byteLength(raw)>8192)throw Error();
  const input=JSON.parse(raw);
  if(Object.keys(input).sort().join()!=='caPath,databaseURL'||input.caPath!==fileURLToPath(new URL('../../../../evidence/supabase-public-ca-20261005.pem',import.meta.url)))throw Error();
  const env={OWNER_ACCESS_DATABASE_URL:input.databaseURL,
    APP_ATTEST_DATABASE_CA_PEM:readFileSync(input.caPath,'utf8'),APP_ATTEST_DATABASE_CA_SHA256:OWNER_CA_FINGERPRINT};
  const config=ownerVercelDatabaseConfiguration(env);config.max=1;
  pool=new pg.Pool(config);pool.on('error',()=>{});
  client=await pool.connect();
  const tls=client.connection.stream;
  if(!tls.encrypted||tls.authorized!==true||tls.servername!==OWNER_POOLER_HOST||!['TLSv1.2','TLSv1.3'].includes(tls.getProtocol()))throw Error();
  await client.query('BEGIN READ ONLY');
  const repository=new PostgresOwnerRepository({pool:client});
  await repository.readiness();await repository.planningWaveReadiness();
  const usage=await repository.planningWaveUsage();
  await client.query('ROLLBACK');
  const peer=tls.getPeerCertificate();
  process.stdout.write(JSON.stringify({status:'runtime_verified',role:'wanderful_owner_runtime',host:OWNER_POOLER_HOST,
    tlsAuthorized:true,tlsProtocol:tls.getProtocol(),peerCertificateSHA256:createHash('sha256').update(peer.raw).digest('hex'),
    roleSchemaAndGuardVerified:true,waveUsage:usage,providerCalls:0,phoneKeyReadiness:false})+'\n');
}catch{
  process.stdout.write(JSON.stringify({status:'runtime_unavailable',providerCalls:0})+'\n');process.exitCode=1;
}finally{
  if(client){try{await client.query('ROLLBACK');}catch{}client.release();}
  if(pool){try{await pool.end();}catch{process.exitCode=1;}}
}
