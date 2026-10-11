#!/usr/bin/env python3
"""Offline negative regressions for the artifact gate; no signing/live proof."""
import copy
import datetime as dt
import importlib.util
import pathlib
import sys
import unittest

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('gate', pathlib.Path(__file__).with_name('verify-live-iphone-artifact.py'))
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)


class ArtifactGateTests(unittest.TestCase):
    def setUp(self):
        self.expected = dict(bundle_id='com.trailmind.app.staging', bundle_version='1',
                             team_id='TESTTEAM01', app_id_prefix='TESTPREFIX', device_udid='test-device',
                             canonical_origin='https://backend.wanderful.app/', lane='staging',
                             app_attest_environment='production')
        self.info = {'CFBundleIdentifier': self.expected['bundle_id'], 'CFBundleVersion': '1',
                     'DTPlatformName': 'iphoneos', 'TRAILMIND_APP_ENVIRONMENT': 'staging',
                     'TRAILMIND_APP_ATTEST_ENVIRONMENT': 'production',
                     'INTENT_BACKEND_BASE_URL': self.expected['canonical_origin']}
        self.info.update({k: 'true' for k in gate.LIVE_FLAGS})
        self.info.update({k: 'false' for k in gate.OFF_FLAGS})
        self.ent = {'application-identifier': 'TESTPREFIX.com.trailmind.app.staging',
                    'com.apple.developer.team-identifier': 'TESTTEAM01',
                    gate.ATTEST: 'production', 'get-task-allow': True}
        self.now = dt.datetime(2026, 10, 3)
        self.cert = b'test-certificate-not-a-real-identity'
        self.profile = {'Entitlements': copy.deepcopy(self.ent), 'TeamIdentifier': ['TESTTEAM01'],
                        'ApplicationIdentifierPrefix': ['TESTPREFIX'], 'ProvisionedDevices': ['test-device'],
                        'CreationDate': self.now - dt.timedelta(days=1),
                        'ExpirationDate': self.now + dt.timedelta(days=1), 'DeveloperCertificates': [self.cert]}
        self.manifest = {'staging': {'baseURL': self.expected['canonical_origin'],
                                    'verificationReceipt': 'reviewed.json'}, 'production': None}

    def findings(self):
        return gate.evaluate(self.info, self.ent, self.profile, self.expected, self.manifest, self.cert, self.now)

    def test_reviewed_identity_with_distinct_team_and_prefix(self):
        self.assertEqual([], self.findings())

    def test_prefix_cannot_be_substituted_with_team(self):
        self.ent['application-identifier'] = 'TESTTEAM01.com.trailmind.app.staging'
        self.assertIn('application_identifier', self.findings())

    def test_local_offline_build_is_rejected(self):
        self.info['TRAILMIND_APP_ENVIRONMENT'] = 'local'
        self.info.update({k: 'false' for k in gate.LIVE_FLAGS})
        self.ent.pop(gate.ATTEST)
        self.assertTrue({'app_lane', 'live_flags', 'app_attest_entitlement'} <= set(self.findings()))

    def test_profile_must_authorize_actual_app_attest(self):
        for value in (None, 'development', '*'):
            with self.subTest(value=value):
                self.profile['Entitlements'][gate.ATTEST] = value
                self.assertIn('app_attest_entitlement', self.findings())

    def test_other_app_or_version_is_rejected(self):
        for field, value in [('CFBundleIdentifier', 'com.piroscheibe.wanderful.local'), ('CFBundleVersion', '2')]:
            with self.subTest(field=field):
                saved = self.info[field]
                self.info[field] = value
                self.assertIn('bundle_identity', self.findings())
                self.info[field] = saved

    def test_redirected_origin_or_unverified_manifest_is_rejected(self):
        self.info['INTENT_BACKEND_BASE_URL'] = 'https://other.wanderful.app/'
        self.manifest['staging'] = None
        self.assertTrue({'canonical_origin', 'deployment_manifest'} <= set(self.findings()))

    def test_every_bypass_or_unavailable_feature_is_rejected(self):
        for field in gate.OFF_FLAGS:
            with self.subTest(field=field):
                self.info[field] = 'true'
                self.assertIn('unsupported_or_insecure_flags', self.findings())
                self.info[field] = 'false'

    def test_missing_or_unresolved_flags_are_rejected(self):
        self.info.pop('IN_MEMORY_APP_ATTEST_ENABLED')
        self.info['REMOTE_INTENT_ENABLED'] = '$(REMOTE_INTENT_ENABLED)'
        self.assertTrue({'live_flags', 'unsupported_or_insecure_flags'} <= set(self.findings()))

    def test_owner_auth_override_is_rejected(self):
        self.info['WANDERFUL_OWNER_ACCESS_ORIGIN'] = self.expected['canonical_origin']
        self.assertIn('owner_auth_override', self.findings())

    def test_simulator_is_rejected(self):
        self.info['DTPlatformName'] = 'iphonesimulator'
        self.assertIn('physical_platform', self.findings())

    def test_wrong_device_certificate_or_expired_profile_is_rejected(self):
        self.profile['ProvisionedDevices'] = ['other-device']
        self.profile['DeveloperCertificates'] = [b'other-certificate']
        self.profile['ExpirationDate'] = self.now
        self.assertTrue({'provisioned_device', 'signing_certificate', 'profile_validity'} <= set(self.findings()))

    def test_wrong_team_or_profile_prefix_is_rejected(self):
        self.profile['TeamIdentifier'] = ['OTHERTEAM']
        self.profile['ApplicationIdentifierPrefix'] = ['OTHERPREFIX']
        self.assertTrue({'team_identity', 'app_id_prefix'} <= set(self.findings()))

    def test_mismatched_debug_category_is_rejected(self):
        self.ent['get-task-allow'] = False
        self.assertIn('development_signing_category', self.findings())

    def test_contract_cannot_select_local_or_weaken_transport(self):
        for field, value in [('lane', 'local'), ('app_attest_environment', 'development'),
                             ('canonical_origin', 'http://backend.wanderful.app/'),
                             ('canonical_origin', 'https://backend.wanderful.app/path'),
                             ('canonical_origin', 'https://api.example/'),
                             ('canonical_origin', 'https://127.0.0.1/'),
                             ('canonical_origin', 'https://owner.ngrok.io/'),
                             ('canonical_origin', 'https://token@backend.wanderful.app/')]:
            with self.subTest(field=field, value=value):
                expected = dict(self.expected, **{field: value})
                with self.assertRaises(ValueError):
                    gate.expected_contract(expected)


if __name__ == '__main__':
    unittest.main()
