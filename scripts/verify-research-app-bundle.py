#!/usr/bin/env python3
"""Inspect an already-built normal app. Emit findings only, never secret values."""
import json
import pathlib
import plistlib
import re
import sys

app = pathlib.Path(sys.argv[1]).resolve(strict=True)
if app.suffix != '.app' or not app.is_dir():
    raise SystemExit('Expected an existing .app bundle')
info = plistlib.loads((app / 'Info.plist').read_bytes())
findings = set()
for name in ['GOOGLE_API_KEY', 'GRAPHHOPPER_API_KEY', 'OPENAI_API_KEY', 'OPENROUTER_API_KEY', 'OWNER_PHONE_TEST_TOKEN']:
    value = info.get(name)
    if value and not (isinstance(value, str) and value.startswith('$(')):
        findings.add('provider_or_owner_secret_in_plist')
for path in app.rglob('*'):
    if not path.is_file():
        continue
    if path.is_symlink():
        findings.add('unexpected_bundle_symlink')
        continue
    if path.name == 'OwnerPhoneTest.json' or path.name.endswith('.xcconfig') or path.name == '.env':
        findings.add('configuration_or_owner_resource_in_bundle')
    # Bounded chunks; retain overlap to detect token text spanning a boundary.
    tail = b''
    with path.open('rb') as handle:
        while chunk := handle.read(1 << 20):
            data = tail + chunk
            if re.search(rb'AIza[0-9A-Za-z_-]{35}', data):
                findings.add('google_key_pattern_in_bundle')
            if re.search(rb'sk-(?:proj-|or-v1-)[0-9A-Za-z_-]{24,}', data):
                findings.add('provider_key_pattern_in_bundle')
            if any(marker in data for marker in [b'OwnerPhoneTest.json', b'OwnerPhoneTestAuthorizer', b'WANDERFUL_OWNER_PHONE_TEST']):
                findings.add('owner_test_code_in_bundle')
            tail = data[-256:]
print(json.dumps({'schemaVersion': 1, 'bundleIdentifier': info.get('CFBundleIdentifier'),
                  'environment': info.get('TRAILMIND_APP_ENVIRONMENT'),
                  'decision': 'pass' if not findings else 'fail', 'findingCategories': sorted(findings),
                  'limitation': 'Structural and known-pattern scan; not proof of absence of every possible credential format.'}, indent=2))
sys.exit(bool(findings))
