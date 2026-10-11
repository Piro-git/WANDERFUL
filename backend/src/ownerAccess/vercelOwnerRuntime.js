import {createPrivatePlanningLogger} from './privatePlanningDiagnostics.js';
import pg from 'pg';
import {prepareVercelDatabaseCA,VERCEL_DATABASE_CA_PATH} from '../operations/vercelDatabaseCA.js';
import {ownerServiceConfiguration,createOwnerRequestHandler} from './ownerService.js';
import {PostgresOwnerRepository} from './postgresOwnerRepository.js';

export const OWNER_PROJECT_REF='mbvzwsrtqcrwhvykugcd';
export const OWNER_POOLER_HOST='aws-0-eu-central-1.pooler.supabase.com';
export const OWNER_CA_FINGERPRINT='807025ad50d4ed219d2c9c7d299c004f824eb00cf7f65afef607d07b72e6cafa';
export function ownerVercelDatabaseConfiguration(env){
  const url=new URL(env.OWNER_ACCESS_DATABASE_URL);
  const direct=url.hostname===`db.${OWNER_PROJECT_REF}.supabase.co`&&decodeURIComponent(url.username)==='wanderful_owner_runtime';
  const session=url.hostname===OWNER_POOLER_HOST&&decodeURIComponent(url.username)===`wanderful_owner_runtime.${OWNER_PROJECT_REF}`;
  if(env.NODE_TLS_REJECT_UNAUTHORIZED==='0'||!['postgres:','postgresql:'].includes(url.protocol)||!(direct||session)||
    !url.password||url.port!=='5432'||url.pathname!=='/postgres'||url.hash||
    url.searchParams.getAll('sslmode').length!==1||url.searchParams.get('sslmode')!=='verify-full'||
    url.searchParams.getAll('sslrootcert').length!==1||url.searchParams.get('sslrootcert')!==VERCEL_DATABASE_CA_PATH||
    [...url.searchParams.keys()].some(k=>!['sslmode','sslrootcert'].includes(k))||
    env.APP_ATTEST_DATABASE_CA_SHA256!==OWNER_CA_FINGERPRINT)throw Error('owner_database_configuration_unavailable');
  prepareVercelDatabaseCA({...env,APP_ATTEST_DATABASE_URL:url.href});
  // Remove libpq URL TLS switches before pg parses the URL, so the explicit
  // Node TLS CA/hostname validation cannot be replaced by connection options.
  url.search='';
  return {connectionString:url.href,ssl:{rejectUnauthorized:true,ca:env.APP_ATTEST_DATABASE_CA_PEM},max:2,
    connectionTimeoutMillis:5000,idleTimeoutMillis:30000,statement_timeout:5000,query_timeout:6000,idle_in_transaction_session_timeout:10000};
}

// Independent owner admission; public App-Attest configuration stays separate.
// This adds only reserved owner paths to the existing project, never a fallback
// from public authentication. Request headers cannot select a different role.
export function createVercelPrivateOwnerHandler({env=process.env,PoolClass=pg.Pool,fetchImpl=globalThis.fetch}={}){
  let runtime,inFlight;
  async function admit(){
    if(inFlight)return inFlight;
    inFlight=(async()=>{
      if(env.OWNER_ACCESS_DYNAMIC_RESEARCH_ENABLED!=='true'||env.OWNER_ACCESS_ENABLED!=='true')return false;
      try{
        if(!runtime){
          const configuration=ownerServiceConfiguration(env);
          const pool=new PoolClass(ownerVercelDatabaseConfiguration(env));
          pool.on('error',()=>{});
          try{
            const repository=new PostgresOwnerRepository({pool});
            await repository.readiness();
            const handler=createOwnerRequestHandler({repository,configuration,fetchImpl,privatePrefix:true,logger:createPrivatePlanningLogger(console)});
            runtime={pool,repository,handler,configuration};
          }catch{await pool.end();return false;}
        }
        if(Date.now()>=runtime.configuration.dynamic.expiresAt)return false;
        await runtime.repository.readiness();
        await runtime.repository.planningWaveReadiness();
        if(!await runtime.repository.findActiveOwnerKey({keyId:runtime.configuration.dynamic.keyId}))return false;
        return true;
      }catch{return false;}
    })();
    try{return await inFlight;}finally{inFlight=undefined;}
  }
  return async(request,response)=>{
    if(!await admit()){
      response.writeHead(503,{'Content-Type':'application/json','Cache-Control':'no-store'});
      response.end(JSON.stringify({error:{code:'owner_access_unavailable',message:'Private owner access is unavailable.'}}));return;
    }
    return runtime.handler(request,response);
  };
}

export function isPrivateOwnerPath(path){
  return typeof path==='string'&&(path.startsWith('/api/private-owner/')||path.startsWith('/api/owner-access/'));
}
