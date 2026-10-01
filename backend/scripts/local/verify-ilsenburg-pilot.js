// Read-only aggregates and a bounded cancellation check against this task's socket.
import pg from 'pg';
import { writeFileSync } from 'node:fs';
const root='/private/tmp/wf-ilsenburg-local-iSXL9g';
const config={host:`${root}/socket`,port:55439,database:'wanderful_local_pilot',password:()=>'',max:1};
const admin=new pg.Pool({...config,user:'postgres'});
const research=new pg.Pool({...config,user:'outdoor_research_runtime_role'});
const control=new pg.Pool({...config,user:'outdoor_research_cancellation_control_role'});
try {
  const topology=(await admin.query(`SELECT current_database() AS database, current_setting('listen_addresses') AS listen_addresses,current_setting('unix_socket_directories') AS socket_directory,pg_database_size(current_database()) AS database_bytes`)).rows[0];
  if(topology.database!==config.database || topology.listen_addresses!=='' || topology.socket_directory!==config.host) throw Error('wrong local topology');
  const counts=(await admin.query(`SELECT
    (SELECT count(*) FROM trailmind_app.outdoor_evidence_imports WHERE status='active') AS active_imports,
    (SELECT count(*) FROM trailmind_app.outdoor_research_projection_runs WHERE status='active') AS active_projections,
    (SELECT count(*) FROM trailmind_app.outdoor_import_schema_leases WHERE state='active') AS active_import_leases,
    (SELECT count(*) FROM trailmind_app.outdoor_research_entities) AS entities,
    (SELECT count(*) FROM trailmind_app.outdoor_research_assertions) AS assertions,
    (SELECT count(*) FROM trailmind_app.outdoor_research_relationships) AS relationships`)).rows[0];
  const privileges=(await admin.query(`SELECT rolname,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls,
    has_schema_privilege(rolname,'trailmind_app','CREATE') AS app_create,
    has_table_privilege(rolname,'trailmind_app.outdoor_research_entities','SELECT') AS base_table_read
    FROM pg_roles WHERE rolname IN ('outdoor_research_runtime_role','outdoor_research_cancellation_control_role') ORDER BY rolname`)).rows;
  const client=await research.connect();
  let cancellation;
  try {
    const pid=(await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    const sleeping=client.query('SELECT pg_sleep(2)').then(()=>({code:null}),error=>({code:error.code}));
    await new Promise(resolve=>setTimeout(resolve,150));
    const cancelled=(await control.query('SELECT trailmind_control.cancel_active_outdoor_research_backend_integer($1) AS cancelled',[pid])).rows[0].cancelled;
    const result=await sleeping;
    if(!cancelled || result.code!=='57014') throw Error('scoped cancellation check failed');
    cancellation={cancelled,queryErrorCode:result.code};
  } finally {client.release();}
  const receipt={topology,counts,privileges,cancellation};
  writeFileSync(`${root}/verification.json`,JSON.stringify(receipt,null,2),{mode:0o600});
  process.stdout.write(JSON.stringify(receipt)+'\n');
} finally {await Promise.all([admin.end(),research.end(),control.end()]);}
