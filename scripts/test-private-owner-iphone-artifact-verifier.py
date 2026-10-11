#!/usr/bin/env python3
"""Negative offline checks for the separate Personal Team artifact contract."""
import copy
import datetime as dt
import importlib.util
import pathlib
import sys
import unittest

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('owner_gate', pathlib.Path(__file__).with_name('verify-private-owner-iphone-artifact.py'))
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)


class PrivateOwnerGateTests(unittest.TestCase):
    def setUp(self):
        self.now = dt.datetime(2026, 10, 5, tzinfo=dt.timezone.utc)
        self.expected = dict(bundle_id='com.piroscheibe.wanderful.local', bundle_version='1',
                             team_id='TESTTEAM01', app_id_prefix='TESTPREFIX', device_udid='test-device',
                             owner_origin='https://owner.example.com', expires_at=self.now.timestamp() + 3600,
                             source_commit='a' * 40, root_tree='b' * 40, keychain_groups=['TESTPREFIX.local'])
        self.info = dict(CFBundleIdentifier=self.expected['bundle_id'], CFBundleVersion='1',
                         DTPlatformName='iphoneos', TRAILMIND_APP_ENVIRONMENT='local',
                         TRAILMIND_APP_ATTEST_ENVIRONMENT='development', INTENT_BACKEND_BASE_URL='',
                         WANDERFUL_OWNER_ACCESS_ORIGIN=self.expected['owner_origin'],
                         WANDERFUL_OWNER_ACCESS_EXPIRES_AT=str(self.expected['expires_at']))
        self.info.update({key: 'true' for key in gate.LIVE})
        self.info.update({key: 'false' for key in gate.OFF})
        self.ent = {'application-identifier': 'TESTPREFIX.' + self.expected['bundle_id'],
                    'com.apple.developer.team-identifier': 'TESTTEAM01', 'get-task-allow': True,
                    'keychain-access-groups': ['TESTPREFIX.local']}
        now = self.now.replace(tzinfo=None)
        self.cert = b'synthetic-not-a-certificate'
        self.profile = dict(Entitlements=copy.deepcopy(self.ent), TeamIdentifier=['TESTTEAM01'],
                            ApplicationIdentifierPrefix=['TESTPREFIX'], ProvisionedDevices=['test-device'],
                            CreationDate=now - dt.timedelta(days=1), ExpirationDate=now + dt.timedelta(days=6),
                            DeveloperCertificates=[self.cert])
        self.build = dict(sourceCommit='a' * 40, rootTree='b' * 40, cleanSource=True, buildExit=0,
                          configuration='Debug', activeConditions=list(gate.CONDITIONS))

    def findings(self):
        return gate.evaluate(self.info, self.ent, self.profile, self.expected, self.build, self.cert, self.now)

    def test_explicit_personal_research_contract(self):
        self.assertEqual([], self.findings())

    def test_old_offline_build_is_not_research_acceptance(self):
        self.info.update({key: 'false' for key in gate.LIVE})
        self.assertIn('live_research_flags', self.findings())

    def test_every_unavailable_or_bypass_feature_rejected(self):
        for key in gate.OFF:
            with self.subTest(key=key):
                self.info[key] = 'true'
                self.assertIn('unsupported_or_insecure_flags', self.findings())
                self.info[key] = 'false'

    def test_wrong_bundle_or_profile_cannot_migrate_data(self):
        self.info['CFBundleIdentifier'] = 'com.trailmind.app.local'
        self.ent['application-identifier'] = 'OTHER.local'
        self.assertTrue({'in_place_bundle_identity', 'application_identifier'} <= set(self.findings()))

    def test_team_is_not_inferred_as_app_prefix(self):
        self.profile['ApplicationIdentifierPrefix'] = ['TESTTEAM01']
        self.assertIn('actual_app_id_prefix', self.findings())

    def test_keychain_groups_must_be_preserved(self):
        self.ent['keychain-access-groups'] = ['OTHER.local']
        self.assertIn('preserved_keychain_groups', self.findings())

    def test_expired_or_unbounded_or_changed_private_window_rejected(self):
        for expiry in [self.now.timestamp(), self.now.timestamp() + 7201, float('nan'), self.now.timestamp() + 300]:
            with self.subTest(expiry=expiry):
                self.info['WANDERFUL_OWNER_ACCESS_EXPIRES_AT'] = str(expiry)
                self.assertIn('fresh_bounded_private_window', self.findings())

    def test_permanent_exact_https_origin_required(self):
        for origin in ['http://owner.example.com', 'https://x.trycloudflare.com', 'https://127.0.0.1',
                       'https://user@owner.example.com', 'https://owner.example.com/', 'https://owner.example.com?key=x']:
            with self.subTest(origin=origin):
                with self.assertRaises(ValueError):
                    gate.contract(dict(self.expected, owner_origin=origin))
        self.info['WANDERFUL_OWNER_ACCESS_ORIGIN'] = 'https://different.example.com'
        self.assertIn('exact_owner_origin', self.findings())

    def test_app_attest_or_other_capabilities_not_claimed(self):
        self.ent[gate.ATTEST] = 'development'
        self.assertTrue({'no_app_attest_claim', 'unexpected_signed_capability'} <= set(self.findings()))
        self.ent.pop(gate.ATTEST)
        self.ent['com.apple.developer.applesignin'] = ['Default']
        self.assertIn('unexpected_signed_capability', self.findings())

    def test_separate_lane_does_not_override_public_host(self):
        self.info['INTENT_BACKEND_BASE_URL'] = self.expected['owner_origin']
        self.assertIn('public_host_override', self.findings())

    def test_real_device_and_matching_cert_required(self):
        self.info['DTPlatformName'] = 'iphonesimulator'
        self.profile['ProvisionedDevices'] = ['other']
        self.profile['DeveloperCertificates'] = [b'other']
        self.assertTrue({'physical_platform', 'provisioned_device', 'signing_certificate'} <= set(self.findings()))

    def test_personal_profile_must_be_current_and_seven_days(self):
        self.profile['ExpirationDate'] = self.now.replace(tzinfo=None)
        self.assertIn('personal_profile_validity', self.findings())
        self.profile['ExpirationDate'] = self.now.replace(tzinfo=None) + dt.timedelta(days=30)
        self.assertIn('personal_profile_validity', self.findings())

    def test_exact_clean_source_and_explicit_debug_marker_required(self):
        for key, value in [('sourceCommit', 'c' * 40), ('rootTree', 'c' * 40), ('cleanSource', False),
                           ('buildExit', 1), ('configuration', 'Release'), ('activeConditions', ['DEBUG']),
                           ('activeConditions', gate.CONDITIONS + ['WANDERFUL_OWNER_PHONE_TEST'])]:
            with self.subTest(key=key, value=value):
                previous = self.build[key]
                self.build[key] = value
                self.assertIn('exact_private_build_provenance', self.findings())
                self.build[key] = previous


if __name__ == '__main__':
    unittest.main()
