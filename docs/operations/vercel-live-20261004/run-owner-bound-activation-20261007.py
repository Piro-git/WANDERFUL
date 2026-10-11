from pathlib import Path
import os,socket,subprocess,tempfile,shutil
repo=Path(__file__).resolve().parents[3];shared=repo/'.local-evidence';binpath=Path('/opt/homebrew/opt/postgresql@17/bin')
base=Path(tempfile.mkdtemp(prefix='wanderful-bound-owner-',dir='/private/tmp'));data=base/'data';pglog=base/'postgres-recovery-20261007.log';started=False
shared.mkdir(parents=True,exist_ok=True)
with (shared/'backend-bound-activation-postgres-20261005-recovery-20261007.log').open('w') as log:
 def run(args,**kwargs):return subprocess.run([str(a) for a in args],stdout=log,stderr=subprocess.STDOUT,check=True,**kwargs)
 try:
  with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
  run([binpath/'initdb','-D',data,'-U','postgres','--auth=trust','--no-sync','--encoding=UTF8'])
  hba=data/'pg_hba.conf';hba.write_text('host all wanderful_owner_runtime 127.0.0.1/32 scram-sha-256\n'+hba.read_text())
  run([binpath/'pg_ctl','-D',data,'-l',pglog,'-o',f'-h 127.0.0.1 -p {port} -k {base} -c shared_preload_libraries=pg_stat_statements -c log_statement=ddl -c log_parameter_max_length_on_error=0 -c pg_stat_statements.track=top','-w','start']);started=True
  run([binpath/'createdb','-h','127.0.0.1','-p',str(port),'-U','postgres','owner_credential_test'])
  env={**os.environ,'OWNER_LOCAL_GUARD_POSTGRES_URL':f'postgresql://postgres@127.0.0.1:{port}/owner_credential_test','OWNER_LOCAL_GUARD_PG_LOG':str(pglog)}
  run([shutil.which("node") or "node",'docs/operations/vercel-live-20261004/test_owner_bound_activation.mjs'],env=env,cwd=repo)
 finally:
  if started:run([binpath/'pg_ctl','-D',data,'-m','fast','-w','stop'])
  shutil.rmtree(base)
print('Bound activation local log/query-recording and real SCRAM-authentication evidence saved.')
