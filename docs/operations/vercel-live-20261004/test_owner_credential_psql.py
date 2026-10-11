from pathlib import Path
import importlib.util,json,socket,subprocess,tempfile,shutil
root=Path(__file__).resolve().parents[3];shared=Path('/private/tmp/wanderful-live-wave-20261003')
helper=root/'docs/operations/vercel-live-20261004/complete-owner-credential.py'
LEGACY_PSQL_GUARD = """DO $$ BEGIN
 IF current_user <> 'postgres' OR current_setting('password_encryption') <> 'scram-sha-256'
 OR current_setting('log_statement') <> 'none'
 OR current_setting('log_min_error_statement') <> 'panic'
 OR current_setting('log_min_duration_statement') <> '-1'
 OR current_setting('log_min_duration_sample') <> '-1'
 OR current_setting('log_transaction_sample_rate') <> '0'
 OR coalesce(current_setting('pgaudit.log',true),'none') NOT IN ('none','')
 OR (coalesce(current_setting('pg_stat_statements.track',true),'none') <> 'none'
     AND coalesce(current_setting('pg_stat_statements.track_utility',true),'on') <> 'off') THEN
   RAISE EXCEPTION 'Protected credential channel required';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_authid r WHERE rolname='wanderful_owner_runtime'
   AND rolpassword IS NULL AND rolcanlogin AND NOT rolinherit AND NOT rolsuper
   AND NOT rolbypassrls AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication
   AND rolconnlimit=4 AND NOT EXISTS(SELECT 1 FROM pg_auth_members WHERE member=r.oid)) THEN
   RAISE EXCEPTION 'Fresh restricted owner role required';
 END IF;
END $$;"""

base=Path(tempfile.mkdtemp(prefix='wanderful-owner-credential-pg-',dir='/private/tmp'));data=base/'data';pglog=base/'postgres.log';binpath=Path('/opt/homebrew/opt/postgresql@17/bin')
started=False;test_password='SYNTHETIC_PUBLIC_TEST_ONLY$@#-never-production'
with (shared/'backend-credential-psql-postgres-20261005.log').open('w') as log:
 def tool(args,**kwargs):
  return subprocess.run([str(a) for a in args],stdout=log,stderr=subprocess.STDOUT,check=True,**kwargs)
 def psql(commands,secret_input=None):
  args=[str(binpath/'psql'),'-X','-q','-v','ON_ERROR_STOP=1','-d',f'host=127.0.0.1 port={port} user=postgres dbname=owner_credential_test']
  for command in commands:args+=['-c',command]
  return subprocess.run(args,input=secret_input,text=True,capture_output=True)
 def start(protected=False):
  global started
  settings="-c log_statement=none -c log_min_error_statement=panic" if protected else '-c log_statement=ddl'
  tool([binpath/'pg_ctl','-D',data,'-l',pglog,'-o',f'-h 127.0.0.1 -p {port} -k {base} {settings}','-w','start']);started=True
 try:
  with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
  tool([binpath/'initdb','-D',data,'-U','postgres','--auth=trust','--no-sync','--encoding=UTF8'])
  start();tool([binpath/'createdb','-h','127.0.0.1','-p',str(port),'-U','postgres','owner_credential_test'])
  bootstrap=(root/'backend/src/ownerAccess/003_private_owner_bootstrap_20261005.sql').read_text()
  assert psql([bootstrap]).returncode==0
  denied=psql([LEGACY_PSQL_GUARD,r'\password wanderful_owner_runtime'],test_password+'\n'+test_password+'\n')
  assert denied.returncode==3 and 'Enter new password' not in denied.stderr
  assert 'unset' in psql(["SELECT CASE WHEN rolpassword IS NULL THEN 'unset' ELSE 'set' END AS status FROM pg_authid WHERE rolname='wanderful_owner_runtime'"]).stdout
  # Explicit public fixture demonstrates why a naked command is not sufficient.
  unguarded=psql([r'\password wanderful_owner_runtime'],test_password+'\n'+test_password+'\n');assert unguarded.returncode==0
  recorded=pglog.read_text();assert 'SCRAM-SHA-256$' in recorded;assert test_password not in recorded
  assert psql(["ALTER ROLE wanderful_owner_runtime PASSWORD NULL"]).returncode==0
  tool([binpath/'pg_ctl','-D',data,'-m','fast','-w','stop']);started=False
  start(True);offset=pglog.stat().st_size
  protected=psql([LEGACY_PSQL_GUARD,r'\password wanderful_owner_runtime'],test_password+'\n'+test_password+'\n');assert protected.returncode==0
  assert psql(["SELECT CASE WHEN rolpassword IS NULL THEN 'unset' ELSE 'set' END AS status FROM pg_authid WHERE rolname='wanderful_owner_runtime'"]).stdout.find(' set')>=0
  tail=pglog.read_bytes()[offset:].decode();assert test_password not in tail and 'SCRAM-SHA-256$' not in tail
  log.write(json.dumps({'checksPassed':5,'unsafeDDLGuardStopsBeforePrompt':True,'unguardedDDLLogsVerifier':True,'guardedProtectedChannelSetsOnlyNewRole':True,'protectedChannelDoesNotLogPasswordOrVerifier':True,'credentials':'public synthetic test fixture only','managedDatabaseChanged':False,'providerCalls':0})+'\n')
 finally:
  if started:tool([binpath/'pg_ctl','-D',data,'-m','fast','-w','stop'])
  shutil.rmtree(base)
print('Local PostgreSQL credential guard evidence saved; no real credential or remote write.')
