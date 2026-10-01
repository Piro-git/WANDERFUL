import fs from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { Pool } from 'pg';
import { researchDatabaseConfiguration } from '../src/operations/productionConfiguration.js';
import { PostgresOutdoorResearchRepository } from '../src/outdoorResearch/postgresOutdoorResearchRepository.js';
import { researchOutdoorAdventureWithTrailAccessV1 } from '../src/outdoorResearch/outdoorResearchExecutor.js';
import { buildResearchGuidedRouteCandidatePlanV2 } from '../src/routeResearch/researchGuidedRouteCandidatePlannerV2.js';

const STAGING_HOST='db.mbvzwsrtqcrwhvykugcd.supabase.co';
// Exact isolated pilot reserved by the engine task; never a general local-host override.
export const OWNER_LOCAL_RESEARCH = Object.freeze({
  socketDirectory:'/private/tmp/wf-ilsenburg-local-iSXL9g/socket',
  port:55439,database:'wanderful_local_pilot',
  researchRole:'outdoor_research_runtime_role',cancellationRole:'outdoor_research_cancellation_control_role'
});
function localConnections(values, filesystem) {
  const contract=OWNER_LOCAL_RESEARCH;
  if(Object.keys(values).sort().join(',')!=='OWNER_RESEARCH_LOCAL_SOCKET,OWNER_RESEARCH_TRANSPORT' ||
      values.OWNER_RESEARCH_LOCAL_SOCKET!==contract.socketDirectory) fail();
  for(const directory of [path.dirname(contract.socketDirectory),contract.socketDirectory]) {
    const info=filesystem.lstatSync(directory);
    if(!info.isDirectory() || info.isSymbolicLink() || info.uid!==process.getuid() ||
        (info.mode&0o777)!==0o700 || filesystem.realpathSync(directory)!==directory) fail();
  }
  const socket=filesystem.lstatSync(path.join(contract.socketDirectory,`.s.PGSQL.${contract.port}`));
  if(!socket.isSocket() || socket.isSymbolicLink() || socket.uid!==process.getuid()) fail();
  return [contract.researchRole,contract.cancellationRole].map(user=>({
    host:contract.socketDirectory,port:contract.port,database:contract.database,user,
    password:()=>'',ssl:false,options:'-c default_transaction_read_only=on'
  }));
}
const fail=()=>{throw Error('owner_research_unavailable');};
export function readOwnerPrivateFile(file, maximumBytes=16384) {
  const directory=path.dirname(file);
  const parent=fs.lstatSync(directory);
  if (!path.isAbsolute(file) || !parent.isDirectory() || parent.isSymbolicLink() ||
      parent.uid!==process.getuid() || (parent.mode&0o777)!==0o700 || fs.realpathSync(directory)!==directory) fail();
  const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
  try {
    const info=fs.fstatSync(fd);
    if (!info.isFile() || info.uid!==process.getuid() || (info.mode&0o777)!==0o600 || info.size>maximumBytes) fail();
    return fs.readFileSync(fd,'utf8');
  } finally {fs.closeSync(fd);}
}
export function loadOwnerResearchConfiguration(file, {socketFilesystem=fs}={}) {
  try {
    const values=parseEnv(readOwnerPrivateFile(file));
    if(values.OWNER_RESEARCH_TRANSPORT==='owner-local-unix') return localConnections(values,socketFilesystem);
    const required=['OUTDOOR_RESEARCH_DATABASE_URL','OUTDOOR_RESEARCH_CANCELLATION_DATABASE_URL'];
    if(Object.keys(values).some(key=>![...required,'OUTDOOR_RESEARCH_CA_FILE'].includes(key))) fail();
    const ca=values.OUTDOOR_RESEARCH_CA_FILE ? readOwnerPrivateFile(values.OUTDOOR_RESEARCH_CA_FILE,65536) : undefined;
    const connections=required.map(key=>{
      const url=new URL(values[key]);
      if (!['postgres:','postgresql:'].includes(url.protocol) || url.hostname!==STAGING_HOST ||
          (url.port && url.port!=='5432') || url.pathname!=='/postgres' || url.hash ||
          [...url.searchParams.keys()].some(key=>key!=='sslmode') ||
          (url.searchParams.has('sslmode') && url.searchParams.get('sslmode')!=='verify-full')) fail();
      const user=decodeURIComponent(url.username),password=decodeURIComponent(url.password);
      if(!user || !password || /[\u0000-\u001f\u007f]/.test(user+password) ||
          ['postgres','migration_role','supabase_admin'].includes(user)) fail();
      return {host:STAGING_HOST,port:5432,database:'postgres',user,password,ssl:{rejectUnauthorized:true,...(ca?{ca}:{})}};
    });
    if(connections[0].user===connections[1].user) fail();
    return connections;
  } catch {fail();}
}
export const OWNER_RESEARCH_INTENT=Object.freeze({
  schemaVersion:1,activity:'hiking',geographicAnchor:{state:'resolved',name:'Ilsenburg',
    coordinate:{latitude:51.866,longitude:10.678},regionEntityId:'30000000-0000-4000-8000-000000000002'},
  routeType:'loop',distanceRangeKm:{min:15,max:15},durationRangeMinutes:null,maximumElevationGainMeters:null,
  maximumTechnicalDifficulty:null,mustHaveExperiences:[],preferredExperiences:['viewpoint'],avoidedExperiences:[],requiredFacilities:[],
  groupContext:{partySize:1,includesChildren:false,youngestAge:null,mobility:'standard',experienceLevel:'intermediate'},
  dateOrSeason:null,overnightRequirements:{required:false,nights:0,allowedAccommodationTypes:[]},
  transportRequirements:{arrivalMode:'walking',returnToStart:true,publicTransportRequired:false},unresolvedClarificationQuestions:[]
});
export async function verifyOwnerResearchReadiness(repository, {
  research=researchOutdoorAdventureWithTrailAccessV1, plan=buildResearchGuidedRouteCandidatePlanV2, now=()=>new Date()
}={}) {
  const result=await research(OWNER_RESEARCH_INTENT,{repository,clock:now,signal:AbortSignal.timeout(15000),totalTimeoutMs:12000});
  if(result.state!=='ready' || !result.dossier?.candidateHighlights?.length || !result.trailAccessResolution?.candidates?.length) fail();
  const candidates=plan(result.dossier,result.trailAccessResolution,{maximumProposals:3});
  const usable=(candidates.proposals??[]).filter(proposal=>{
    const highlights=proposal.selectedHighlights??[];
    const mandatory=highlights.filter(item=>['must_have','facility_candidate','overnight_candidate'].includes(item.role));
    return highlights.length>0 && mandatory.length<=3 && highlights.every(item=>
      item.evidenceClaimIds?.length>0 && item.selectionReasons?.length>0 && item.trailAccessCandidate);
  });
  if(!['ready','partial'].includes(candidates.state) || usable.length===0) fail();
  return {highlightCount:result.dossier.candidateHighlights.length,accessCount:result.trailAccessResolution.candidates.length,
    proposalCount:usable.length};
}
const ROLE_QUERY=`SELECT current_user AS role, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole, rolcanlogin
  FROM pg_roles WHERE rolname=current_user`;
export async function createOwnerResearchRuntime(file, {PoolClass=Pool, readiness=verifyOwnerResearchReadiness, socketFilesystem=fs}={}) {
  let pools=[];let closed=false;
  const close=async()=>{if(!closed){closed=true;await Promise.allSettled(pools.map(pool=>pool.end()));}};
  try {
    const connections=loadOwnerResearchConfiguration(file,{socketFilesystem});
    const configuration=researchDatabaseConfiguration({OUTDOOR_RESEARCH_DATABASE_POOL_MAX:'1'});
    for (const [index,connection] of connections.entries()) {
      const pool=new PoolClass({...connection,max:1,connectionTimeoutMillis:configuration.connectionTimeoutMs,
        idleTimeoutMillis:configuration.idleTimeoutMs,query_timeout:index?1000:configuration.statementTimeoutMs,
        statement_timeout:index?1000:configuration.statementTimeoutMs,idle_in_transaction_session_timeout:10000,
        allowExitOnIdle:true});
      pools.push(pool);
      pool.on('error',()=>{});
    }
    for(let index=0;index<pools.length;index++) {
      const {rows}=await pools[index].query(ROLE_QUERY);
      const role=rows?.[0];
      if(rows?.length!==1 || role.role!==connections[index].user || role.rolcanlogin!==true ||
          ['rolsuper','rolbypassrls','rolcreatedb','rolcreaterole'].some(key=>role[key]!==false)) fail();
    }
    if(connections[0].host===OWNER_LOCAL_RESEARCH.socketDirectory) {
      for(const pool of pools) {
        const result=await pool.query("SELECT current_database() AS database, current_setting('listen_addresses') AS listen_addresses, inet_server_addr() IS NULL AS unix_socket_connection");
        const actual=result.rows?.[0];
        if(result.rows?.length!==1 || actual.database!==OWNER_LOCAL_RESEARCH.database ||
            actual.listen_addresses!=='' || actual.unix_socket_connection!==true) fail();
      }
      // Recheck the exact owned filesystem binding after connecting.
      localConnections({OWNER_RESEARCH_TRANSPORT:'owner-local-unix',OWNER_RESEARCH_LOCAL_SOCKET:OWNER_LOCAL_RESEARCH.socketDirectory},socketFilesystem);
    }
    const permission=await pools[1].query("SELECT has_function_privilege(current_user, 'trailmind_control.cancel_active_outdoor_research_backend_integer(integer)', 'EXECUTE') AS can_cancel_research");
    if(permission.rows?.[0]?.can_cancel_research!==true) fail();
    const repository=new PostgresOutdoorResearchRepository({pool:pools[0],cancellationPool:pools[1],
      runtimeSchema:'trailmind_app',cancellationFunction:'trailmind_control.cancel_active_outdoor_research_backend_integer',statementTimeoutMs:configuration.statementTimeoutMs});
    if(repository.cancellationFunction!=='trailmind_control.cancel_active_outdoor_research_backend_integer') fail();
    const summary=await readiness(repository);
    return {repository,summary,close};
  } catch {await close();fail();}
}
