import os, pathlib, shutil, socket, subprocess, tempfile
base=pathlib.Path(tempfile.mkdtemp(prefix='wanderful-owner-bootstrap-',dir='/private/tmp'))
data=base/'data'; log=pathlib.Path(__file__).resolve().parents[3]/'.local-evidence'/'backend-owner-bootstrap-postgres-20261005-recovery-20261007.log'
binpath=pathlib.Path('/opt/homebrew/opt/postgresql@17/bin')
started=False
log.parent.mkdir(parents=True,exist_ok=True)
with log.open('w') as output:
    def run(args,**kwargs):
        return subprocess.run([str(a) for a in args],stdout=output,stderr=subprocess.STDOUT,check=True,**kwargs)
    try:
        with socket.socket() as sock:
            sock.bind(('127.0.0.1',0)); port=sock.getsockname()[1]
        run([binpath/'initdb','-D',data,'-U','postgres','--auth=trust','--no-sync','--encoding=UTF8'])
        run([binpath/'pg_ctl','-D',data,'-l',base/'postgres-recovery-20261007.log','-o',f'-h 127.0.0.1 -p {port} -k {base}','-w','start']); started=True
        run([binpath/'createdb','-h','127.0.0.1','-p',str(port),'-U','postgres','owner_access_test'])
        env={**os.environ,'OWNER_TEST_POSTGRES_URL':f'postgresql://postgres@127.0.0.1:{port}/owner_access_test'}
        run([shutil.which("node") or "node",'--test','test/ownerAccessPostgres.test.js'],env=env,cwd=pathlib.Path(__file__).resolve().parents[3]/"backend")
    finally:
        if started:
            run([binpath/'pg_ctl','-D',data,'-m','fast','-w','stop'])
        shutil.rmtree(base)
print('Disposable Owner PostgreSQL log saved; no remote database or provider calls.')
