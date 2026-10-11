#!/usr/bin/env python3
"""Explicit owner-local pilot only. Never accepts an existing cluster or remote DSN.
Uses unchanged migration SQL and bounded privilege blocks; managed admission is untouched.
One attempt, stop cluster on any failure or 300 MiB measured use (100 MiB reserve).
"""
import argparse, datetime, hashlib, json, os, pathlib, pwd, signal, subprocess, time
from urllib.parse import quote

REPO = pathlib.Path(__file__).resolve().parents[3]
DB, PORT = 'wanderful_local_pilot', '55439'
ROLES = ['regional_import_role', 'projection_role', 'outdoor_research_runtime_role',
         'outdoor_research_cancellation_control_role']
MIGRATIONS = ['001_app_attest.sql','002_outdoor_evidence.sql','003_outdoor_research_graph.sql',
 '004_osm_outdoor_research_projection.sql','005_outdoor_research_projection_geometry.sql',
 '006_outdoor_route_membership_point_index.sql','007_routable_highlight_access_geography_index.sql',
 '009_supabase_postgis_isolated_runtime_read_contract.sql','010_bounded_outdoor_import_schema_provisioning.sql',
 '011_pin_security_invoker_function_search_paths.sql']
LIMIT = 300 * 1024 * 1024

def block(text, start, end):
    assert text.count(start) == 1 and text.count(end) == 1, 'upstream SQL boundary changed'
    return text[text.index(start):text.index(end)]

def bootstrap_sql():
    pre=(REPO/'docs/operations/staging-v1/database/PHASE_1_PRE_MIGRATION_V2.sql').read_text()
    post=(REPO/'docs/operations/staging-v1/database/PHASE_1_POST_MIGRATION_V2.sql').read_text()
    roles=block(pre, 'CREATE ROLE trailmind_app_owner', '-- PostgreSQL 17 gives')
    sql="""BEGIN;
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;
"""+roles+f"""
REVOKE ALL ON DATABASE {DB} FROM PUBLIC;
GRANT CONNECT ON DATABASE {DB} TO {', '.join(ROLES)};
GRANT CREATE ON DATABASE {DB} TO trailmind_import_schema_owner;
GRANT TEMPORARY ON DATABASE {DB} TO projection_role;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
CREATE SCHEMA trailmind_gis AUTHORIZATION postgres;
CREATE EXTENSION postgis WITH SCHEMA trailmind_gis;
REVOKE ALL ON SCHEMA trailmind_gis FROM PUBLIC;
GRANT USAGE ON SCHEMA trailmind_gis TO trailmind_app_owner, regional_import_role, projection_role;
CREATE SCHEMA trailmind_app AUTHORIZATION trailmind_app_owner;
CREATE SCHEMA trailmind_control AUTHORIZATION trailmind_control_owner;
REVOKE ALL ON SCHEMA trailmind_app, trailmind_control FROM PUBLIC;
GRANT USAGE ON SCHEMA trailmind_control TO outdoor_research_cancellation_control_role;
GRANT pg_signal_backend TO trailmind_control_owner WITH INHERIT TRUE, SET FALSE;
SET LOCAL ROLE trailmind_app_owner;
SET LOCAL search_path=trailmind_app,pg_catalog,trailmind_gis,pg_temp;
CREATE TABLE trailmind_schema_migrations(version text PRIMARY KEY, applied_at timestamptz DEFAULT clock_timestamp());
"""
    for name in MIGRATIONS:
        sql+=(REPO/'backend/migrations'/name).read_text()+f"\nSET LOCAL ROLE trailmind_app_owner;\nSET LOCAL search_path=trailmind_app,pg_catalog,trailmind_gis,pg_temp;\nINSERT INTO trailmind_schema_migrations(version) VALUES ('{name}');\n"
    sql+=block(post, 'SET LOCAL ROLE trailmind_app_owner;\nSET LOCAL search_path = pg_catalog, trailmind_app, trailmind_gis, pg_temp;\n\nALTER DEFAULT', 'SET LOCAL ROLE trailmind_control_owner;')
    sql+='RESET ROLE;\n'+block(pre, 'ALTER ROLE migration_role\n', '\nCOMMIT;')
    return sql+'\nCOMMIT;\n'

parser=argparse.ArgumentParser()
parser.add_argument('--mode', required=True, choices=['isolated-unix-v1'])
parser.add_argument('--root',required=True)
parser.add_argument('--pbf',required=True)
parser.add_argument('--resume-import',action='store_true')
parser.add_argument('--resume-project',action='store_true')
args=parser.parse_args()
if args.resume_project: args.resume_import=True
subprocess.run(['node','--input-type=module','-e',"await import('pg')"],cwd=REPO/'backend',check=True)
root=pathlib.Path(args.root)
assert root.parent == pathlib.Path('/private/tmp') and root.name.startswith('wf-ilsenburg-local-')
assert not root.is_symlink() and root.stat().st_uid == os.getuid() and root.stat().st_mode & 0o777 == 0o700
if args.resume_import:
    assert root == pathlib.Path('/private/tmp/wf-ilsenburg-local-iSXL9g'), 'resume only this task cluster'
    assert (root/'data/PG_VERSION').read_text().strip() == '17'
    assert not (root/'data/postmaster.pid').exists(), 'running cluster forbidden'
    assert 'COMMIT' in (root/'bootstrap.log').read_text()
else:
    assert not (root/'data').exists(), 'existing cluster forbidden'
pbf=pathlib.Path(args.pbf).resolve()
assert pbf.stat().st_size == 1904897
assert hashlib.sha256(pbf.read_bytes()).hexdigest() == '4deedb15628a4c69263299aef3550665b8e2a9bf8860cf13b0cb788d9b7882f7'
os.umask(0o077)
socket=root/'socket';socket.mkdir(mode=0o700, exist_ok=True)
assert not socket.is_symlink() and socket.stat().st_uid == os.getuid() and socket.stat().st_mode & 0o777 == 0o700
assert not list(socket.iterdir()), 'socket directory must be empty'
data=root/'data'
env={'PATH':'/opt/homebrew/bin:/usr/bin:/bin', 'LANG':'C', 'PGHOST':str(socket), 'PGPORT':PORT, 'PGUSER':'postgres', 'PGDATABASE':DB, 'PGSSLMODE':'disable', 'PGPASSWORD':''}
started=False
peak=0

def measured():
    global peak
    used=int(subprocess.check_output(['/usr/bin/du','-sk',str(root)]).split()[0])*1024
    peak=max(peak,used)
    return used

def run(command, label, extra=None):
    with (root/(label+'.log')).open('wb') as log:
        child=subprocess.Popen(command,cwd=REPO/'backend',env=env | (extra or {}),stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
        try:
            while child.poll() is None:
                if measured() >= LIMIT: raise RuntimeError('300 MiB stop threshold reached; 100 MiB reserve')
                if os.statvfs(root).f_bavail * os.statvfs(root).f_frsize < 250*1024*1024: raise RuntimeError('free space below 250 MiB reserve')
                time.sleep(0.2)
            if child.returncode: raise RuntimeError(f'{label} failed: inspect {log.name}; no retry')
            if measured() >= LIMIT: raise RuntimeError('disk threshold reached')
        except BaseException:
            if child.poll() is None: os.killpg(child.pid, signal.SIGTERM)
            raise

def sql(text, label, database=DB):
    path=root/(label+'.sql');path.write_text(text)
    run(['psql','-X','-v','ON_ERROR_STOP=1','-d',database,'-f',str(path)],label)

def url(role):
    return f'postgresql://{role}@localhost:{PORT}/{DB}?host={quote(str(socket),safe="")}&sslmode=disable'

try:
    if not args.resume_import:
        run(['initdb','-D',str(data),'-U','postgres','--auth-local=peer','--auth-host=reject','--encoding=UTF8','--no-locale','--wal-segsize=1'],'initdb')
        (data/'postgresql.conf').write_text(f"listen_addresses=''\nport={PORT}\nunix_socket_directories='{socket}'\nunix_socket_permissions=0700\nshared_buffers=16MB\nmax_connections=12\nmax_wal_size=32MB\nmin_wal_size=2MB\ncheckpoint_timeout=30s\nwork_mem=2MB\nmaintenance_work_mem=16MB\ntemp_file_limit=32768\nlogging_collector=off\n")
        (data/'pg_hba.conf').write_text('local all all peer map=pilot\n')
        username=pwd.getpwuid(os.getuid()).pw_name
        assert username.replace('_','').isalnum()
        (data/'pg_ident.conf').write_text(''.join(f'pilot {username} {role}\n' for role in ['postgres']+ROLES))
    if args.resume_import:
        config=data/'postgresql.conf'
        config.write_text(config.read_text().replace('max_connections=8', 'max_connections=12'))
    run(['pg_ctl','-D',str(data),'-l',str(root/'postgres.log'),'-w','start'],'start')
    started=True
    if not args.resume_import:
        sql(f'CREATE DATABASE {DB};','create-database','postgres')
        sql(bootstrap_sql(),'bootstrap')
    else:
        sql(f"""DO $$ BEGIN
          IF current_database() <> '{DB}' OR current_setting('listen_addresses') <> ''
          OR current_setting('unix_socket_directories') <> '{socket}'
          OR current_setting('port') <> '{PORT}'
          OR (SELECT count(*) FROM trailmind_app.trailmind_schema_migrations) <> 10
          OR (SELECT count(*) FROM trailmind_app.outdoor_evidence_imports WHERE status <> 'failed') <> {1 if args.resume_project else 0}
          OR (SELECT count(*) FROM trailmind_app.outdoor_evidence_imports WHERE status = 'active' AND input_file_sha256 = '4deedb15628a4c69263299aef3550665b8e2a9bf8860cf13b0cb788d9b7882f7') <> {1 if args.resume_project else 0}
          OR (SELECT count(*) FROM trailmind_app.outdoor_research_projection_runs) <> 0
          OR (SELECT count(*) FROM trailmind_app.outdoor_import_schema_leases WHERE state = 'active') <> 0 THEN
            RAISE EXCEPTION 'local resume contract rejected';
          END IF; END $$;""", 'resume-check')
    regions=root/'regions';regions.mkdir(exist_ok=args.resume_import)
    region=json.loads((REPO/'backend/config/outdoor-regions/harz-v1.json').read_text())
    region['name']='Ilsenburg local pilot — partial Sachsen-Anhalt source coverage'
    region['requiredAnchors']=[region['requiredAnchors'][0]]
    (regions/'harz-v1.json').write_text(json.dumps(region))
    (regions/'harz-v1.geojson').write_text(json.dumps({'type':'Feature','properties':{'regionId':'harz-v1'},'geometry':{'type':'Polygon','coordinates':[[[10.59,51.80],[10.77,51.80],[10.77,51.92],[10.59,51.92],[10.59,51.80]]]}}))
    if not args.resume_project:
        run(['node','scripts/import-outdoor-evidence.js','--region','harz-v1','--pbf',str(pbf),'--dataset-name','Ilsenburg pilot; clipped Sachsen-Anhalt 2026-09-05; partial state-source coverage','--source-id','https://download.geofabrik.de/europe/germany/sachsen-anhalt-260905.osm.pbf','--source-timestamp','2026-09-05T20:22:06Z','--retrieved-at',datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='milliseconds').replace('+00:00','Z'),'--acquisition-channel','operator_supplied_local'], 'import', {'DATABASE_URL':url('regional_import_role'),'TRAILMIND_OWNER_LOCAL_PILOT':args.mode,'TRAILMIND_LOCAL_PILOT_REGION_DIRECTORY':str(regions),'OUTDOOR_EVIDENCE_MAX_PBF_BYTES':'2000000'})
    run(['node','scripts/configure-osm-outdoor-research-policy.js','--mode','activate','--policy-version','osm-foundational-mapped-v1','--operator-confirmation','activate-reviewed-osm-mapped-policy','--review-reference','urn:trailmind:owner-local-ilsenburg-real-source-20260906','--reviewed-at',datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='milliseconds').replace('+00:00','Z')], 'source-policy', {'DATABASE_URL':url('projection_role')})
    run(['node','scripts/project-osm-outdoor-research.js','--region','harz-v1','--policy-version','osm-foundational-mapped-v1','--operator-confirmation','project-reviewed-osm-mapped-facts','--dry-run','false'],'project',{'DATABASE_URL':url('projection_role')})
    # Fresh imports can retain zero-row estimates before autovacuum catches up.
    # Collect local planner statistics before declaring data ready; budgets stay fixed.
    sql(r"""SET statement_timeout='2500ms';
SELECT format('ANALYZE %I.%I;', schemaname, relname)
FROM pg_stat_user_tables WHERE schemaname='trailmind_app'
AND relname LIKE 'outdoor_%' ORDER BY relname
\gexec
""", 'analyze-pilot')
    sql('CHECKPOINT;','checkpoint')
    receipt={'mode':args.mode,'root':str(root),'socket':str(socket),'database':DB,'port':int(PORT),'roles':ROLES,'measuredBytes':measured(),'peakMeasuredBytes':peak,'stopBytes':LIMIT,'reserveBytes':100*1024*1024,'status':'imported-and-projected','coverage':'partial Sachsen-Anhalt source clipped to Ilsenburg bounding box; not full Harz'}
    (root/'receipt.json').write_text(json.dumps(receipt,indent=2))
    print(json.dumps(receipt))
except BaseException as error:
    if started: subprocess.run(['pg_ctl','-D',str(data),'-m','immediate','stop'],env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    (root/'failure.json').write_text(json.dumps({'error':str(error),'peakMeasuredBytes':peak,'stopped':started},indent=2))
    raise
