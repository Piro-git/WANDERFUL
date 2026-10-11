import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash, X509Certificate} from 'node:crypto';
import {APPLE_APP_ATTESTATION_ROOT_PEM} from '../../../backend/src/appAttest/appleAppAttestationRoot.js';
import {inspectPublicDatabaseCA} from './prepare-public-ca.mjs';

// Public Apple root is a TEST input only, never this database's trust anchor.
const pem = APPLE_APP_ATTESTATION_ROOT_PEM;
const certificate = new X509Certificate(pem);
const now = (Date.parse(certificate.validFrom) + Date.parse(certificate.validTo)) / 2;

test('DER fingerprint agrees with X509 and differs from hashing PEM text', () => {
  const receipt = inspectPublicDatabaseCA(pem, {now});
  assert.equal(receipt.fingerprintDER_SHA256, certificate.fingerprint256.replaceAll(':', '').toLowerCase());
  assert.notEqual(receipt.fingerprintDER_SHA256, createHash('sha256').update(pem).digest('hex'));
  assert.equal(receipt.normalizedPEM, certificate.toString());
  assert.equal(receipt.runtimeCertificateValidationPassed, true);
});
test('a valid public certificate does not imply authenticated project provenance or DB admission', () => {
  const receipt = inspectPublicDatabaseCA(pem, {now});
  assert.equal(receipt.authenticatedProjectProvenanceVerified, false);
  assert.equal(receipt.databaseTLSAdmissionVerified, false);
});
test('expired and not-yet-valid certificates fail without emitting certificate contents', () => {
  for(const time of [Date.parse(certificate.validFrom) - 1, Date.parse(certificate.validTo)])
    assert.throws(() => inspectPublicDatabaseCA(pem, {now: time}), /^Error: public_ca_invalid$/);
});
test('private keys, malformed, concatenated and oversized inputs fail with a fixed message', () => {
  for(const input of ['-----BEGIN PRIVATE KEY-----\nSENSITIVE_TEST_ONLY\n-----END PRIVATE KEY-----',
    pem + pem, pem.replaceAll('\n', '\\n'), 'x'.repeat(32769), '', undefined])
    assert.throws(() => inspectPublicDatabaseCA(input, {now}), /^Error: public_ca_invalid$/);
});
