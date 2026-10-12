import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createServer} from 'node:net';
const exec=promisify(execFile),directory=await mkdtemp(join(tmpdir(),'wanderful-supplement-pg-'));
const socket=createServer();await new Promise((r,j)=>{socket.once('error',j);socket.listen(0,'127.0.0.1',r);});const port=socket.address().port;await new Promise(r=>socket.close(r));let started=false;
try{
 await exec('initdb',['-D',directory,'-A','trust','-U','postgres','--no-locale','-E','UTF8']);
 await exec('pg_ctl',['-D',directory,'-l',join(directory,'postgres.log'),'-o',`-h 127.0.0.1 -p ${port} -k ${directory}`,'-w','start']);started=true;
 await exec('createdb',['-h','127.0.0.1','-p',String(port),'-U','postgres','owner_followup_test']);
 const p=await exec(process.execPath,['--test','test/ownerFollowupEntitlementPostgres.test.js'],{env:{...process.env,OWNER_FOLLOWUP_TEST_POSTGRES_URL:`postgresql://postgres@127.0.0.1:${port}/owner_followup_test`},maxBuffer:2000000});process.stdout.write(p.stdout);
}catch(e){process.stderr.write(e.stdout??'Disposable test failed\n');process.stderr.write(e.stderr??'');process.exitCode=1;}
finally{if(started)await exec('pg_ctl',['-D',directory,'-m','immediate','-w','stop']);await rm(directory,{recursive:true,force:true});}
