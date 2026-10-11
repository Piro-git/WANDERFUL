import assert from 'node:assert/strict';
import { generateKeyPairSync, randomBytes, randomUUID, sign } from 'node:crypto';
import test from 'node:test';
import { canonicalOwnerSessionClientData, createOwnerAccessEndpoint, ownerKeyId,
  OWNER_CHALLENGE_PATH, OWNER_SESSION_PATH } from '../src/ownerAccess/ownerAccessEndpoint.js';
import { createOwnerService, ownerServiceConfiguration } from '../src/ownerAccess/ownerService.js';
import { createOwnerSessionAuthorizer } from '../src/ownerAccess/ownerSessionAuthorizer.js';
import { appAttestError } from '../src/appAttest/appAttestErrors.js';

// Offline cryptographic and loopback HTTP tests. Every provider is injected;
// repository fixtures do not establish real PostgreSQL durability.
test('QA: a valid owner key cannot sign for a different method, path or purpose', async () => {
  const origin = 'https://owner.example.com';
  const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const publicKeySPKI = pair.publicKey.export({ format: 'der', type: 'spki' });
  const keyId = ownerKeyId(publicKeySPKI);
  const records = new Map();
  let exchanged = 0;
  const repository = {
    async consumeOwnerOperation() { return true; },
    async findActiveOwnerKey() { return { publicKeySPKI, installationId: 'owner:qa_purpose_identity' }; },
    async createOwnerChallenge(input) { records.set(input.challengeId, input); return true; },
    async findOwnerChallenge({ challengeId }) { return records.get(challengeId); },
    async exchangeOwnerChallenge() { exchanged++; return true; }
  };
  const endpoint = createOwnerAccessEndpoint({ enabled: true, environment: 'test', origin, repository });
  const context = { edgeIdentity: 'qa-loopback' };
  for (const [field, replacement] of [[2, 'GET'], [3, '/api/route'], [0, 'another-owner-purpose-v1']]) {
    const result = await endpoint(OWNER_CHALLENGE_PATH, { keyId }, context);
    assert.equal(result.statusCode, 200);
    const { challengeId, challenge } = result.payload;
    const nonce = randomBytes(32);
    const canonical = canonicalOwnerSessionClientData({ origin, keyId, challengeId,
      challenge: Buffer.from(challenge, 'base64url'), sessionNonce: nonce });
    const fields = [];
    for (let offset = 0; offset < canonical.length;) {
      const length = canonical.readUInt32BE(offset); offset += 4;
      fields.push(canonical.subarray(offset, offset + length)); offset += length;
    }
    fields[field] = Buffer.from(replacement);
    const foreignPurpose = Buffer.concat(fields.flatMap(value => {
      const size = Buffer.alloc(4); size.writeUInt32BE(value.length); return [size, value];
    }));
    const signature = sign('sha256', foreignPurpose, { key: pair.privateKey, dsaEncoding: 'ieee-p1363' });
    const denied = await endpoint(OWNER_SESSION_PATH, { keyId, challengeId,
      sessionNonce: nonce.toString('base64url'), signature: signature.toString('base64url') }, context);
    assert.equal(denied.statusCode, 401);
  }
  assert.equal(exchanged, 0);
});

function configuration() {
  return ownerServiceConfiguration({ NODE_ENV: 'production', OWNER_ACCESS_ENABLED: 'true',
    OWNER_ACCESS_ORIGIN: 'https://owner.example.com', AI_PROVIDER: 'google', GOOGLE_MODEL: 'gemini-3.8-flash',
    GOOGLE_API_KEY: 'synthetic-only', GRAPHHOPPER_API_KEY: 'synthetic-only',
    OWNER_ACCESS_MAX_CONCURRENCY: '1', OWNER_ACCESS_ROUTE_DAILY_LIMIT: '10',
    OWNER_ACCESS_INTENT_DAILY_LIMIT: '16', OWNER_ACCESS_GLOBAL_ROUTE_DAILY_LIMIT: '10',
    OWNER_ACCESS_GLOBAL_INTENT_DAILY_LIMIT: '16', DYNAMIC_RESEARCH_ENABLED: 'true' });
}

test('QA: missing or revoked owner sessions and foreign paths cause zero provider calls', async () => {
  let authorizationCalls = 0, providerCalls = 0;
  const repository = { isDurable: true,
    async authorizeSession() { authorizationCalls++; throw appAttestError('route_session_invalid'); },
    async consumeProviderAttempt() { assert.fail('Denied session must not reserve providers'); },
    async releaseLease() {} };
  const server = createOwnerService({ repository, configuration: configuration(),
    fetchImpl: async () => { providerCalls++; assert.fail('No provider work is authorized'); } });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = { prompt: 'Public test input', locale: 'en' };
  const headers = { 'content-type': 'application/json',
    authorization: `TrailMindRouteSession ${randomBytes(32).toString('base64url')}`,
    'x-trailmind-request-id': randomUUID() };
  try {
    for (const auth of [undefined, headers.authorization]) {
      const h = { ...headers }; if (auth === undefined) delete h.authorization;
      const r = await fetch(base + '/api/parse-intent', { method: 'POST', headers: h, body: JSON.stringify(request) });
      assert.equal(r.status, 401);
    }
    assert.equal(authorizationCalls, 1);
    for (const path of ['/api/route?scope=intent', '/api/app-attest/challenge', '/api/preparation']) {
      const r = await fetch(base + path, { method: 'POST', headers, body: JSON.stringify(request) });
      assert.equal(r.status, 404);
    }
    assert.equal(authorizationCalls, 1);
    assert.equal(providerCalls, 0);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

test('QA: baseline owner service has no schema3 capability despite an inherited dynamic flag', async () => {
  const config = configuration();
  assert.equal(config.providerEnv.DYNAMIC_RESEARCH_ENABLED, undefined);
  const server = createOwnerService({ repository: { isDurable: true }, configuration: config,
    fetchImpl: async () => assert.fail('Unavailable research must not call providers') });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  try {
    const result = await fetch(`http://127.0.0.1:${server.address().port}/api/llm-plan-route`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ schemaVersion: 3, researchMode: 'web_and_map' }) });
    assert.equal(result.status, 404);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

test('QA: unsupported authorization scope fails before repository work', () => {
  let calls = 0;
  const repository = { isDurable: true, authorizeSession() { calls++; } };
  for (const scope of ['app-attest', 'preparation', 'anything']) {
    assert.throws(() => createOwnerSessionAuthorizer({ repository, scope, limits: {} }));
  }
  assert.equal(calls, 0);
});

test('QA: revoked/expired provider reservation cannot be ignored by the owner authorizer', async () => {
  let reservations = 0;
  const repository = { isDurable: true,
    async authorizeSession() { return { leaseId: randomUUID(), installationId: 'owner:qa_lease_identity', remainingCost: 9 }; },
    async consumeProviderAttempt(input) { reservations++; assert.equal(input.scope, 'route'); return false; },
    async releaseLease() {} };
  const authorizer = createOwnerSessionAuthorizer({ repository, scope: 'route',
    limits: { maximumConcurrency: 1, ownerDailyMaximum: 10, globalDailyMaximum: 10 } });
  const access = await authorizer.authorize({ cost: 3, headers: {
    authorization: `TrailMindRouteSession ${randomBytes(32).toString('base64url')}`,
    'x-trailmind-request-id': randomUUID() } });
  await assert.rejects(access.reserveProviderAttempt(), { code: 'app_attest_rate_limited' });
  assert.equal(reservations, 1);
  await access.release();
});
