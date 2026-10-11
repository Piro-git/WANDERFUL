#!/usr/bin/env python3
"""Separate Personal Team research gate. Never replaces public App Attest admission."""
import argparse
import datetime as dt
import hashlib
import json
import pathlib
import plistlib
import re
import subprocess
import tempfile
from urllib.parse import urlsplit

LIVE = ('REMOTE_INTENT_ENABLED', 'RESEARCH_GUIDED_PLANNING_ENABLED', 'ROUTABLE_HIGHLIGHT_ACCESS_ENABLED')
OFF = ('DIRECT_GRAPHHOPPER_ENABLED', 'INSECURE_LOCAL_BACKEND_AUTH_ENABLED',
       'IN_MEMORY_APP_ATTEST_ENABLED', 'OUTDOOR_EVIDENCE_ENABLED', 'ROUTE_WEATHER_ENABLED',
       'WANDERFUL_ACCOUNT_ENABLED', 'WANDERFUL_APPLE_SIGN_IN_ENABLED', 'MONETIZATION_ENABLED',
       'SUPERWALL_ENABLED', 'SUPABASE_ONBOARDING_SYNC_ENABLED')
CONDITIONS = ['DEBUG', 'TRAILMIND_ENV_LOCAL', 'WANDERFUL_PRIVATE_RESEARCH_OWNER']
ATTEST = 'com.apple.developer.devicecheck.appattest-environment'


def contract(expected):
    fields = {'bundle_id', 'bundle_version', 'team_id', 'app_id_prefix', 'device_udid',
              'owner_origin', 'expires_at', 'source_commit', 'root_tree', 'keychain_groups'}
    if set(expected) != fields:
        raise ValueError('invalid_contract')
    if expected['bundle_id'] != 'com.piroscheibe.wanderful.local':
        raise ValueError('in_place_identity_required')
    for key in fields - {'expires_at', 'keychain_groups'}:
        if not isinstance(expected[key], str) or not expected[key]:
            raise ValueError('invalid_contract')
    for key in ('source_commit', 'root_tree'):
        if not re.fullmatch('[a-f0-9]{40}', expected[key]):
            raise ValueError('invalid_source_identity')
    if type(expected['expires_at']) not in (float, int) or not isinstance(expected['keychain_groups'], list):
        raise ValueError('invalid_contract')
    origin = expected['owner_origin']
    u = urlsplit(origin)
    host = u.hostname or ''
    if (u.scheme != 'https' or '.' not in host or u.username or u.password or u.port or
            u.path or u.query or u.fragment or origin != 'https://' + host or '..' in host or
            not re.fullmatch(r'[a-z0-9]+(?:[a-z0-9.-]*[a-z0-9])?', host) or
            re.fullmatch(r'\d+(?:\.\d+){3}', host) or
            re.search(r'(^|\.)(localhost|local|invalid|test|trycloudflare\.com|ngrok\.io|ngrok-free\.app)$', host)):
        raise ValueError('invalid_private_origin')


def evaluate(info, ent, profile, expected, build, certificate, now):
    contract(expected)
    failures = []

    def require(ok, category):
        if not ok:
            failures.append(category)

    pe = profile.get('Entitlements', {})
    identity = expected['app_id_prefix'] + '.' + expected['bundle_id']
    require(info.get('CFBundleIdentifier') == expected['bundle_id'] and
            info.get('CFBundleVersion') == expected['bundle_version'], 'in_place_bundle_identity')
    require(info.get('DTPlatformName') == 'iphoneos', 'physical_platform')
    require(info.get('TRAILMIND_APP_ENVIRONMENT') == 'local' and
            info.get('TRAILMIND_APP_ATTEST_ENVIRONMENT') == 'development', 'private_local_lane')
    require(all(info.get(k) == 'true' for k in LIVE), 'live_research_flags')
    require(all(info.get(k) == 'false' for k in OFF), 'unsupported_or_insecure_flags')
    require(info.get('WANDERFUL_OWNER_ACCESS_ORIGIN') == expected['owner_origin'], 'exact_owner_origin')
    # Public host selection remains untouched. The separate owner client selects its own exact host.
    require(info.get('INTENT_BACKEND_BASE_URL') in ('', '$(LOCAL_BACKEND_BASE_URL)'), 'public_host_override')
    try:
        expiry = float(info.get('WANDERFUL_OWNER_ACCESS_EXPIRES_AT', ''))
        require(expiry == expected['expires_at'] and now.timestamp() < expiry <= now.timestamp() + 7200,
                'fresh_bounded_private_window')
    except (TypeError, ValueError):
        failures.append('fresh_bounded_private_window')
    require(ent.get('application-identifier') == identity and pe.get('application-identifier') == identity,
            'application_identifier')
    require(ent.get('com.apple.developer.team-identifier') == expected['team_id'] and
            pe.get('com.apple.developer.team-identifier') == expected['team_id'] and
            profile.get('TeamIdentifier') == [expected['team_id']], 'team_identity')
    require(profile.get('ApplicationIdentifierPrefix') == [expected['app_id_prefix']], 'actual_app_id_prefix')
    require(ent.get('keychain-access-groups', []) == expected['keychain_groups'], 'preserved_keychain_groups')
    require(ent.get('get-task-allow') is True and pe.get('get-task-allow') is True, 'development_signing')
    require(ATTEST not in ent and ATTEST not in pe, 'no_app_attest_claim')
    require(set(ent) <= {'application-identifier', 'com.apple.developer.team-identifier',
                         'keychain-access-groups', 'get-task-allow'}, 'unexpected_signed_capability')
    require(expected['device_udid'] in profile.get('ProvisionedDevices', []), 'provisioned_device')
    creation, expiry = profile.get('CreationDate'), profile.get('ExpirationDate')
    naive = now.replace(tzinfo=None)
    require(isinstance(creation, dt.datetime) and isinstance(expiry, dt.datetime) and
            creation <= naive < expiry and expiry - creation <= dt.timedelta(days=7, minutes=5),
            'personal_profile_validity')
    require(bool(certificate) and certificate in profile.get('DeveloperCertificates', []), 'signing_certificate')
    require(build.get('sourceCommit') == expected['source_commit'] and build.get('rootTree') == expected['root_tree'] and
            build.get('cleanSource') is True and build.get('buildExit') == 0 and
            build.get('configuration') == 'Debug' and build.get('activeConditions') == CONDITIONS,
            'exact_private_build_provenance')
    return failures


def command(*args):
    r = subprocess.run(args, capture_output=True, timeout=90)
    if r.returncode:
        raise ValueError('artifact_inspection_failed')
    return r.stdout


def fingerprint(app):
    digest = hashlib.sha256()
    for path in sorted(app.rglob('*')):
        if path.is_symlink():
            raise ValueError('bundle_symlink')
        if path.is_file():
            digest.update(path.relative_to(app).as_posix().encode() + b'\0')
            content = hashlib.sha256()
            with path.open('rb') as handle:
                while chunk := handle.read(1 << 20):
                    content.update(chunk)
            digest.update(content.digest())
    return digest.hexdigest()


def inspect(app, expected, build):
    if app.suffix != '.app' or not app.is_dir() or app.is_symlink():
        raise ValueError('invalid_app')
    command('codesign', '--verify', '--deep', '--strict', str(app))
    ent = plistlib.loads(command('codesign', '-d', '--entitlements', ':-', str(app)))
    profile = plistlib.loads(command('security', 'cms', '-D', '-i', str(app / 'embedded.mobileprovision')))
    info = plistlib.loads((app / 'Info.plist').read_bytes())
    with tempfile.TemporaryDirectory(prefix='wanderful-owner-certificate-') as folder:
        prefix = pathlib.Path(folder) / 'signer'
        command('codesign', '-d', '--extract-certificates=' + str(prefix), str(app))
        certificate = prefix.with_name('signer0').read_bytes()
    failures = evaluate(info, ent, profile, expected, build, certificate, dt.datetime.now(dt.timezone.utc))
    require_hash = fingerprint(app)
    if build.get('bundleContentSHA256') != require_hash:
        failures.append('build_bundle_hash')
    # Deliberately allow P256 owner code, never a bundled bearer, provider key, or private-key file.
    owner_code_seen = False
    for path in app.rglob('*'):
        if not path.is_file():
            continue
        if path.name == 'OwnerPhoneTest.json' or path.suffix in ('.xcconfig', '.pem', '.key') or path.name == '.env':
            failures.append('embedded_credential_resource')
        tail = b''
        with path.open('rb') as f:
            while chunk := f.read(1 << 20):
                data = tail + chunk
                if re.search(rb'AIza[0-9A-Za-z_-]{35}|sk-(?:proj-|or-v1-)[0-9A-Za-z_-]{24,}|-----BEGIN (?:EC |RSA )?PRIVATE KEY-----', data):
                    failures.append('embedded_provider_or_private_key')
                owner_code_seen |= b'OwnerResearchSessionAuthorizer' in data
                if b'OwnerPhoneTestAuthorizer' in data:
                    failures.append('embedded_bearer_lane')
                tail = data[-256:]
    if not owner_code_seen:
        failures.append('missing_private_research_code')
    for name in ('GOOGLE_API_KEY', 'GRAPHHOPPER_API_KEY', 'OPENAI_API_KEY', 'OPENROUTER_API_KEY', 'OWNER_PHONE_TEST_TOKEN'):
        value = info.get(name)
        if value and not (isinstance(value, str) and value.startswith('$(')):
            failures.append('embedded_secret_in_plist')
    return {'schemaVersion': 1, 'evidenceClass': 'private_personal_team_artifact_only',
            'observedAtUTC': dt.datetime.now(dt.timezone.utc).isoformat(),
            'decision': 'fail' if failures else 'pass', 'findingCategories': sorted(set(failures)),
            'bundleIdentifier': info.get('CFBundleIdentifier'), 'sourceCommit': build.get('sourceCommit'),
            'bundleContentSHA256': require_hash, 'publicReleaseAccepted': False,
            'limitation': 'Build receipt is separately reviewed provenance. This gate does not prove enrollment, hosted admission, provider output, image motif, persistence or phone UI.'}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    for key in ('app', 'expected', 'build-receipt', 'output'):
        p.add_argument('--' + key, required=True, type=pathlib.Path)
    a = p.parse_args()
    try:
        expected = json.loads(a.expected.read_text())
        contract(expected)
        receipt = inspect(a.app, expected, json.loads(a.build_receipt.read_text()))
    except (ValueError, OSError, TypeError, AttributeError, KeyError, subprocess.SubprocessError, plistlib.InvalidFileException):
        receipt = {'decision': 'fail', 'findingCategories': ['invalid_contract_or_unverified_artifact'], 'publicReleaseAccepted': False}
    a.output.write_text(json.dumps(receipt, indent=2) + '\n')
    print(json.dumps(receipt))
    return 0 if receipt['decision'] == 'pass' else 1


if __name__ == '__main__':
    raise SystemExit(main())
