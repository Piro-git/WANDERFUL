import { readFile } from "node:fs/promises";
import pg from "pg";
import { PostgresOwnerRepository } from "./postgresOwnerRepository.js";
import { createOwnerService, ownerServiceConfiguration } from "./ownerService.js";
import { ownerDatabaseURL } from "./ownerDatabaseConfiguration.js";

async function start() {
  const env=process.env;
  const configuration=ownerServiceConfiguration(env);
  const url=ownerDatabaseURL(env);
  const ca=await readFile(env.OWNER_ACCESS_DATABASE_CA_FILE,"utf8");
  const pool=new pg.Pool({connectionString:url.href,ssl:{rejectUnauthorized:true,ca},max:4,
    connectionTimeoutMillis:5000,idleTimeoutMillis:30000,statement_timeout:5000,
    query_timeout:6000,idle_in_transaction_session_timeout:10000});
  pool.on("error",()=>{ /* No database connection data in logs. Requests fail closed. */ });
  const repository=new PostgresOwnerRepository({pool});
  try { await repository.readiness(); } catch(error) { await pool.end();throw error; }
  const server=createOwnerService({repository,configuration});
  server.headersTimeout=10000;server.requestTimeout=15000;server.keepAliveTimeout=5000;
  server.maxHeadersCount=32;
  const port=Number(env.PORT ?? 3000);
  if(!Number.isInteger(port)||port<1||port>65535) throw new Error("Owner port unavailable");
  await new Promise((resolve,reject)=>{server.once("error",reject);server.listen(port,"0.0.0.0",resolve);});
  process.stdout.write("Owner service ready.\n");
  let closing=false;
  const stop=()=>{
    if(closing)return;closing=true;
    const timeout=setTimeout(()=>{server.closeAllConnections();pool.end().finally(()=>process.exit(0));},10000);
    timeout.unref();
    server.close(()=>pool.end().finally(()=>{clearTimeout(timeout);process.exit(0);}));
  };
  process.on("SIGINT",stop);process.on("SIGTERM",stop);
}
start().catch(()=>{process.stderr.write("Owner service startup blocked.\n");process.exitCode=1;});
