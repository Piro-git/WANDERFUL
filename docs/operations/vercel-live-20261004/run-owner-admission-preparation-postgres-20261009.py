from pathlib import Path
import os,socket,subprocess,tempfile,shutil
root=Path(__file__).resolve().parents[3];e=root.parent/'evidence';binpath=Path('/opt/homebrew/opt/postgresql@17/bin')
base=Path(tempfile.mkdtemp(prefix='wanderful-public-enrollment-local-',dir='/private/tmp'));data=base/'data';started=False
with (e/'backend-owner-admission-preparation-postgres-20261009.log').open('w') as log:
 def run(args,**kwargs):return subprocess.run([str(a) for a in args],stdout=log,stderr=subprocess.STDOUT,check=True,**kwargs)
 try:
  with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
  run([binpath/'initdb','-D',data,'-U','postgres','--auth=trust','--no-sync','--encoding=UTF8'])
  run([binpath/'pg_ctl','-D',data,'-l',base/'postgres.log','-o',f'-h 127.0.0.1 -p {port} -k {base}','-w','start']);started=True
  run([binpath/'createdb','-h','127.0.0.1','-p',str(port),'-U','postgres','owner_admission_preparation'])
  env={k:os.environ[k] for k in ('HOME','PATH','TMPDIR','LANG') if k in os.environ};env['OWNER_PREPARATION_LOCAL_PG_URL']=f'postgresql://postgres@127.0.0.1:{port}/owner_admission_preparation'
  run([shutil.which("node") or "node",'docs/operations/vercel-live-20261004/test-owner-admission-preparation-postgres.mjs'],cwd=root,env=env)
 finally:
  if started:run([binpath/'pg_ctl','-D',data,'-m','fast','-w','stop'])
  shutil.rmtree(base)
print('Local public-enrollment protocol test passed; disposable cluster removed; cloud/provider0.')
