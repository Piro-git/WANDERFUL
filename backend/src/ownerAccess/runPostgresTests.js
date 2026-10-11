// Disposable local-only test cluster. Never accepts a remote database URL.
import { mkdtemp,rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { createServer } from "node:net";
const exec=promisify(execFile);
const directory=await mkdtemp(join(tmpdir(),"wanderful-owner-pg-"));
const socket=createServer();
await new Promise((resolve,reject)=>{socket.once("error",reject);socket.listen(0,"127.0.0.1",resolve);});
const port=socket.address().port;
await new Promise((resolve)=>socket.close(resolve));
let started=false;
try {
  await exec("initdb",["-D",directory,"-A","trust","-U","owner_test_operator","--no-locale","-E","UTF8"]);
  await exec("pg_ctl",["-D",directory,"-l",join(directory,"postgres.log"),"-o",`-h 127.0.0.1 -p ${port} -k ${directory}`,"-w","start"]);
  started=true;
  await exec("createdb",["-h","127.0.0.1","-p",String(port),"-U","owner_test_operator","owner_access_test"]);
  const result=await exec(process.execPath,["--test","test/ownerAccessPostgres.test.js"],{
    env:{...process.env,OWNER_TEST_POSTGRES_URL:`postgresql://owner_test_operator@127.0.0.1:${port}/owner_access_test`},maxBuffer:2_000_000});
  process.stdout.write(result.stdout);
} catch(error){
  process.stderr.write(error.stdout ?? "Disposable owner database test failed.\n");
  process.stderr.write(error.stderr ?? "");
  process.exitCode=1;
} finally {
  if(started) await exec("pg_ctl",["-D",directory,"-m","immediate","-w","stop"]);
  await rm(directory,{recursive:true,force:true});
}
