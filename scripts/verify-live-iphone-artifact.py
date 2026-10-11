#!/usr/bin/env python3
"""Gate a signed physical live-pilot app against private, operator-reviewed identity.

No provisioning identifiers, certificates, or raw tool errors enter the receipt.
Passing this gate does not prove backend readiness or physical App Attest.
"""
import argparse
import datetime as dt
import hashlib
import json
import pathlib
import plistlib
import re
import subprocess
import sys
import tempfile
from urllib.parse import urlsplit

ATTEST = 'com.apple.developer.devicecheck.appattest-environment'
LIVE_FLAGS = ('RESEARCH_GUIDED_PLANNING_ENABLED', 'REMOTE_INTENT_ENABLED')
OFF_FLAGS = ('DIRECT_GRAPHHOPPER_ENABLED', 'INSECURE_LOCAL_BACKEND_AUTH_ENABLED',
             'IN_MEMORY_APP_ATTEST_ENABLED', 'ROUTE_WEATHER_ENABLED',
             'WANDERFUL_ACCOUNT_ENABLED', 'WANDERFUL_APPLE_SIGN_IN_ENABLED',
             'MONETIZATION_ENABLED', 'SUPERWALL_ENABLED', 'SUPABASE_ONBOARDING_SYNC_ENABLED',
             'OUTDOOR_EVIDENCE_ENABLED', 'ROUTABLE_HIGHLIGHT_ACCESS_ENABLED')


def expected_contract(expected):
    fields = {'bundle_id', 'bundle_version', 'team_id', 'app_id_prefix', 'device_udid',
              'canonical_origin', 'lane', 'app_attest_environment'}
    if set(expected) != fields or any(not isinstance(v, str) or not v for v in expected.values()):
        raise ValueError('invalid_expected_contract')
    u = urlsplit(expected['canonical_origin'])
    if (u.scheme != 'https' or not u.hostname or '.' not in u.hostname or u.username
            or u.password or u.port or u.path != '/' or u.query or u.fragment
            or not re.fullmatch(r'[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?', u.hostname)
            or '..' in u.hostname or re.fullmatch(r'\d+(?:\.\d+){3}', u.hostname)
            or re.search(r'(^|\.)(localhost|local|invalid|example|test|trycloudflare\.com|ngrok-free\.app|ngrok\.io)$', u.hostname)
            or expected['canonical_origin'] != 'https://' + u.hostname + '/'):
        raise ValueError('invalid_expected_origin')
    if expected['lane'] not in ('staging', 'production') or expected['app_attest_environment'] != 'production':
        raise ValueError('invalid_expected_lane')


def evaluate(info, entitlements, profile, expected, manifest, certificate, now):
    expected_contract(expected)
    failures = []

    def require(condition, category):
        if not condition:
            failures.append(category)

    pe = profile.get('Entitlements', {})
    identity = expected['app_id_prefix'] + '.' + expected['bundle_id']
    require(info.get('CFBundleIdentifier') == expected['bundle_id'] and
            info.get('CFBundleVersion') == expected['bundle_version'], 'bundle_identity')
    require(info.get('DTPlatformName') == 'iphoneos', 'physical_platform')
    require(info.get('TRAILMIND_APP_ENVIRONMENT') == expected['lane'], 'app_lane')
    require(info.get('TRAILMIND_APP_ATTEST_ENVIRONMENT') == expected['app_attest_environment'], 'app_attest_config')
    require(info.get('INTENT_BACKEND_BASE_URL') == expected['canonical_origin'], 'canonical_origin')
    entry = manifest.get(expected['lane'])
    require(isinstance(entry, dict) and entry.get('baseURL') == expected['canonical_origin'] and
            isinstance(entry.get('verificationReceipt'), str) and bool(entry['verificationReceipt']), 'deployment_manifest')
    require(all(info.get(k) == 'true' for k in LIVE_FLAGS), 'live_flags')
    require(all(info.get(k) == 'false' for k in OFF_FLAGS), 'unsupported_or_insecure_flags')
    owner = info.get('WANDERFUL_OWNER_ACCESS_ORIGIN')
    require(not owner or owner == '$(WANDERFUL_OWNER_ACCESS_ORIGIN)', 'owner_auth_override')
    require(entitlements.get('application-identifier') == identity and
            pe.get('application-identifier') == identity, 'application_identifier')
    require(entitlements.get('com.apple.developer.team-identifier') == expected['team_id'] and
            pe.get('com.apple.developer.team-identifier') == expected['team_id'] and
            profile.get('TeamIdentifier') == [expected['team_id']], 'team_identity')
    require(profile.get('ApplicationIdentifierPrefix') == [expected['app_id_prefix']], 'app_id_prefix')
    require(entitlements.get(ATTEST) == expected['app_attest_environment'] and
            pe.get(ATTEST) == expected['app_attest_environment'], 'app_attest_entitlement')
    require(entitlements.get('get-task-allow') is True and pe.get('get-task-allow') is True,
            'development_signing_category')
    require(expected['device_udid'] in profile.get('ProvisionedDevices', []), 'provisioned_device')
    creation, expiry = profile.get('CreationDate'), profile.get('ExpirationDate')
    require(isinstance(creation, dt.datetime) and isinstance(expiry, dt.datetime) and
            creation <= now < expiry, 'profile_validity')
    require(bool(certificate) and certificate in profile.get('DeveloperCertificates', []), 'signing_certificate')
    return failures


def run(*args):
    result = subprocess.run(args, capture_output=True, timeout=90)
    if result.returncode:
        raise ValueError('artifact_tool_failed')
    return result.stdout


def inspect(app, expected, manifest):
    if app.suffix != '.app' or not app.is_dir() or app.is_symlink():
        raise ValueError('invalid_app_bundle')
    run('codesign', '--verify', '--deep', '--strict', str(app))
    entitlements = plistlib.loads(run('codesign', '-d', '--entitlements', ':-', str(app)))
    profile = plistlib.loads(run('security', 'cms', '-D', '-i', str(app / 'embedded.mobileprovision')))
    info = plistlib.loads((app / 'Info.plist').read_bytes())
    with tempfile.TemporaryDirectory(prefix='wanderful-live-certificate-') as temp:
        prefix = pathlib.Path(temp) / 'signer'
        run('codesign', '-d', '--extract-certificates=' + str(prefix), str(app))
        certificate = prefix.with_name('signer0').read_bytes()
    failures = evaluate(info, entitlements, profile, expected, manifest, certificate, dt.datetime.now(dt.timezone.utc).replace(tzinfo=None))
    scan = subprocess.run([sys.executable, str(pathlib.Path(__file__).with_name('verify-research-app-bundle.py')), str(app)],
                          capture_output=True, timeout=90)
    if scan.returncode:
        failures.append('bundle_credential_or_owner_code_scan')
    executable = info.get('CFBundleExecutable')
    if not isinstance(executable, str) or pathlib.Path(executable).name != executable:
        raise ValueError('invalid_bundle_executable')
    binary_hash = hashlib.sha256((app / executable).read_bytes()).hexdigest()
    return {'schemaVersion': 1, 'observedAtUTC': dt.datetime.now(dt.timezone.utc).isoformat(),
            'decision': 'pass' if not failures else 'fail', 'findingCategories': sorted(failures),
            'bundleIdentifier': info.get('CFBundleIdentifier'), 'bundleVersion': info.get('CFBundleVersion'),
            'lane': info.get('TRAILMIND_APP_ENVIRONMENT'), 'binarySHA256': binary_hash,
            'limitation': 'Artifact gate only. Backend readiness, build source provenance, physical launch, App Attest and provider results need independent receipts.'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--app', type=pathlib.Path, required=True)
    parser.add_argument('--expected', type=pathlib.Path, required=True, help='Private reviewed identity JSON; never committed.')
    parser.add_argument('--manifest', type=pathlib.Path, required=True)
    parser.add_argument('--output', type=pathlib.Path, required=True)
    args = parser.parse_args()
    try:
        expected = json.loads(args.expected.read_text())
        expected_contract(expected)
        receipt = inspect(args.app, expected, json.loads(args.manifest.read_text()))
    except (ValueError, OSError, TypeError, AttributeError, KeyError, subprocess.SubprocessError, plistlib.InvalidFileException):
        receipt = {'schemaVersion': 1, 'decision': 'fail', 'findingCategories': ['invalid_contract_or_unverified_artifact']}
    args.output.write_text(json.dumps(receipt, indent=2) + '\n')
    print(json.dumps(receipt))
    return 0 if receipt['decision'] == 'pass' else 1


if __name__ == '__main__':
    sys.exit(main())
