#!/usr/bin/env python3
"""Human terminal handoff; fixed new role/project; no secret file/argv/output."""
import argparse
import datetime
import getpass
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import shutil
import sys
import warnings
from urllib.parse import quote

ROOT = Path(__file__).resolve().parents[3]
PUBLIC_CA = Path('/private/tmp/wanderful-live-wave-20261003/supabase-public-ca-20261005.pem')
PUBLIC_CA_PEM_SHA256 = '700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7'
PROJECT = 'prj_s58Xlu24J4AkuvUIjDaX5Uc454R7'
SCOPE = 'piros-projects-7e6430a1'
HOST = 'aws-0-eu-central-1.pooler.supabase.com'
REF = 'mbvzwsrtqcrwhvykugcd'
NODE = os.environ.get("WANDERFUL_NODE_BINARY") or shutil.which("node") or "node"
VC = os.environ.get("WANDERFUL_VERCEL_CLI_JS", "")
PROOF = Path(__file__).with_name('verify-owner-runtime-input.mjs')
ACTIVATOR = Path(__file__).with_name('activate-owner-credential-input.mjs')
RECEIPT = Path('/private/tmp/wanderful-live-wave-20261003/backend-human-owner-credential-receipt-20261005.json')

class SafeFailure(Exception):
    pass

def clean_environment():
    # HOME is passed unchanged for the existing Vercel CLI login. No token lookup.
    env = {k: os.environ[k] for k in ('HOME','PATH','TMPDIR','LANG','LC_ALL') if k in os.environ}
    env.update({'PGPASSFILE':'/dev/null','PSQL_HISTORY':'/dev/null','PSQL_PAGER':'cat','PAGER':'cat'})
    return env

def check_local_inputs():
    if PUBLIC_CA.is_symlink() or hashlib.sha256(PUBLIC_CA.read_bytes()).hexdigest() != PUBLIC_CA_PEM_SHA256:
        raise SafeFailure('Das geprüfte öffentliche Zertifikat fehlt oder wurde verändert.')
    link = json.loads((ROOT/'.deploy/private-owner-20261005/backend/.vercel/project.json').read_text())
    if link.get('projectId') != PROJECT or link.get('orgId') != 'team_nvtnn3IzOLpftJqVS6hMkqCh':
        raise SafeFailure('Der bestehende Vercel-Projektlink stimmt nicht überein.')
    if not all(Path(p).is_file() for p in (NODE,VC,str(PROOF),str(ACTIVATOR))):
        raise SafeFailure('Der vorbereitete lokale Eingabeflow ist unvollständig.')

def owner_url(password):
    if not isinstance(password,str) or not 16 <= len(password) <= 512 or any(c in password for c in '\x00\r\n'):
        raise SafeFailure('Bitte das neue starke Rollenpasswort verwenden; nichts gespeichert.')
    return (f'postgresql://wanderful_owner_runtime.{REF}:{quote(password,safe="")}@{HOST}:5432/postgres'
            '?sslmode=verify-full&sslrootcert=/tmp/wanderful-app-attest-ca.pem')

def vercel_arguments(*parts):
    return [NODE,VC,*parts,'--scope',SCOPE,'--cwd',str(ROOT/'.deploy/private-owner-20261005/backend'),'--non-interactive']

def capture(runner,args,**kwargs):
    try:
        return runner(args,capture_output=True,text=True,env=clean_environment(),**kwargs)
    except (OSError,subprocess.TimeoutExpired):
        raise SafeFailure('Verbindung oder Eingabe gestoppt; keine geheimen Fehlerdetails angezeigt.') from None

def flow(*,activate=False,runner=subprocess.run,prompt=getpass.getpass,tty=None):
    if tty is None: tty = sys.stdin.isatty() and sys.stderr.isatty()
    if not tty:
        raise SafeFailure('Bitte diesen Ablauf im eigenen Terminal öffnen; keine Passwort-Eingabe über Chat oder Tools.')
    check_local_inputs()
    listed = capture(runner,vercel_arguments('env','ls','production'),timeout=30)
    if listed.returncode:
        raise SafeFailure('Bestehender Vercel-Login/Projektzugang ist nicht bestätigt; nichts geändert.')
    output = re.sub(r'\x1b\[[0-9;]*m','',listed.stdout+'\n'+listed.stderr)
    if re.search(r'(?m)^\s*OWNER_ACCESS_DATABASE_URL\s',output):
        raise SafeFailure('Owner-Variable existiert bereits; sie wird nicht überschrieben. Backend prüft den vorhandenen Stand.')
    operator_password=None
    with warnings.catch_warnings():
        warnings.simplefilter('error',getpass.GetPassWarning)
        if activate:
            print('Ein privater Eingabeflow: bestehender DB-Betreiberzugang, danach nur neues Owner-Rollenpasswort.')
            operator_password=prompt('Bestehendes Supabase-Datenbankpasswort (verdeckt): ')
            password=prompt('Neues starkes Owner-Rollenpasswort, mindestens 20 ASCII-Zeichen (verdeckt): ')
            if not re.fullmatch(r'[!-~]{20,512}',password) or prompt('Neues Owner-Rollenpasswort erneut (verdeckt): ') != password:
                raise SafeFailure('Neue Passworteingaben stimmen nicht überein; nichts verändert.')
            activated=capture(runner,[NODE,str(ACTIVATOR)],input=json.dumps({'operatorPassword':operator_password,'newOwnerPassword':password,'caPath':str(PUBLIC_CA)}),timeout=30)
            try: activation=json.loads(activated.stdout)
            except (ValueError,TypeError): activation={}
            if activated.returncode or activation.get('status')!='role_activated' or activation.get('role')!='wanderful_owner_runtime':
                raise SafeFailure('Neue Rolle nicht aktiviert; bestehende Passwörter unverändert. Keine geheimen Fehlerdetails ausgegeben.')
            operator_password=None
        else:
            print('Nur das bereits sicher gesetzte Passwort der NEUEN Rolle eingeben. Es wird nicht angezeigt.')
            password=prompt('Neues Owner-Rollenpasswort (verdeckt): ')
    database_url = owner_url(password)
    request = json.dumps({'databaseURL':database_url,'caPath':str(PUBLIC_CA)})
    checked = capture(runner,[NODE,str(PROOF)],input=request,timeout=30)
    try: proof = json.loads(checked.stdout)
    except (ValueError,TypeError): proof = {}
    if checked.returncode or proof.get('status') != 'runtime_verified' or proof.get('role') != 'wanderful_owner_runtime' or proof.get('host') != HOST or proof.get('tlsAuthorized') is not True or proof.get('roleSchemaAndGuardVerified') is not True:
        raise SafeFailure('Echter eingeschränkter TLS-Zugang nicht bestätigt; keine Vercel-Variable gespeichert.')
    if proof.get('tlsProtocol') not in ('TLSv1.2','TLSv1.3') or not re.fullmatch('[0-9a-f]{64}',proof.get('peerCertificateSHA256','')) or not isinstance(proof.get('waveUsage'),dict) or set(proof['waveUsage']) != {'requests','google','graphhopper'} or any(type(proof['waveUsage'][k]) is not int or not 0 <= proof['waveUsage'][k] <= cap for k,cap in (('requests',2),('google',16),('graphhopper',10))):
        raise SafeFailure('Runtime-Beleg unvollständig; nichts gespeichert.')
    saved = capture(runner,vercel_arguments('env','add','OWNER_ACCESS_DATABASE_URL','production',
                    '--project',PROJECT,'--sensitive','--yes'),input=database_url,timeout=30)
    if saved.returncode:
        raise SafeFailure('Vercel-Übertragung nicht bestätigt. Das neue Rollenpasswort bleibt unverändert; später nur --store-only verwenden.')
    # Only an explicit allowlist of metadata can leave subprocess memory.
    metadata = {k:proof[k] for k in ('role','host','tlsAuthorized','tlsProtocol','peerCertificateSHA256','roleSchemaAndGuardVerified','waveUsage') if k in proof}
    return {'recordedAtUTC':datetime.datetime.now(datetime.timezone.utc).isoformat(),
            'project':PROJECT,'target':'production','variable':'OWNER_ACCESS_DATABASE_URL','sensitiveStdinAdd':True,
            'newRoleActivatedByThisFlow':activate,'overwriteRequested':False,'valuesLoggedOrPersisted':False,'actualRestrictedRuntime':metadata,
            'providerCalls':0,'deviceKeyReadiness':False,'deploymentPerformed':False,'ledgerReconciled':False}

def main():
    parser=argparse.ArgumentParser(description='Verdeckte neue Owner-Rollenverbindung prüfen und direkt sicher in Vercel speichern.')
    modes=parser.add_mutually_exclusive_group(required=True)
    modes.add_argument('--store-only',action='store_true',help='Nur bereits sicher aktiviertes neues Rollenpasswort prüfen/speichern; keine Passwortänderung.')
    modes.add_argument('--activate-new-role',action='store_true',help='Geprüfte lokale parametergebundene Aktivierung nur der neuen Rolle, danach Runtime prüfen und sicher speichern.')
    args=parser.parse_args()
    try:
        receipt=flow(activate=args.activate_new_role)
        # Metadata only. Exclusive creation avoids replacing earlier evidence.
        fd=os.open(RECEIPT,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
        with os.fdopen(fd,'w') as f: f.write(json.dumps(receipt,indent=2)+'\n')
        print('Echter eingeschränkter TLS-Zugang geprüft und sensitive Owner-Verbindung in Vercel gespeichert.')
        print('Keine Provideraufrufe. Backend übernimmt nun den Abgleich und die Aktivierung.')
    except SafeFailure as error:
        print(str(error),file=sys.stderr);return 1
    except (Exception,KeyboardInterrupt):
        print('Ablauf gestoppt. Keine Zugangsdaten oder Fehlerdetails ausgegeben.',file=sys.stderr);return 1
    return 0

if __name__ == '__main__': sys.exit(main())
