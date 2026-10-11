import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import test from 'node:test';
const { appAttestError } = await import(pathToFileURL(path.join(process.env.QA_OWNER_CANDIDATE_ROOT, 'backend/src/appAttest/appAttestErrors.js')));

// Explicit read-only review of the backend owner's current candidate. No live
// credentials or provider calls; captures file stability during this run.
const sourceRoot = process.env.QA_OWNER_CANDIDATE_ROOT;
test('QA actual owner candidate: expiry/admission/quota negatives', { skip: !sourceRoot }, async t => {
  const file = path.join(sourceRoot, 'backend/src/ownerAccess/ownerDynamicPlanning.js');
  const before = await readFile(file);
  t.diagnostic(`ownerDynamicPlanning SHA256 ${createHash('sha256').update(before).digest('hex')}`);
  const { ownerDynamicPlanningConfiguration, createOwnerDynamicPlanningEndpoints } = await import(pathToFileURL(file));
  const clock = Date.now();
  const keyId = randomBytes(32).toString('base64url');
  const env = { NODE_ENV: 'production', OWNER_ACCESS_ENABLED: 'true',
    OWNER_ACCESS_DYNAMIC_RESEARCH_ENABLED: 'true', OWNER_ACCESS_ORIGIN: 'https://owner.example.com',
    OWNER_ACCESS_KEY_ID: keyId, OWNER_ACCESS_TEST_EXPIRES_AT: new Date(clock + 60_000).toISOString(),
    AI_PROVIDER: 'google', GOOGLE_MODEL: 'gemini-3.8-flash', GOOGLE_API_KEY: 'synthetic-only',
    GRAPHHOPPER_API_KEY: 'synthetic-only', DYNAMIC_RESEARCH_USER_AGENT: 'Offline QA' };
  const configuration = ownerDynamicPlanningConfiguration(env, { now: clock });
  const body = { schemaVersion: 3, parserSource: 'remoteAI', researchMode: 'web_and_map',
    locationName: 'Queenstown, New Zealand', prompt: 'Public synthetic loop request, not a live pilot',
    anchor: { latitude: -45.03, longitude: 168.66 }, end: null,
    intent: { activityType: 'hiking', routeType: 'loop', targetDistanceKm: 8, difficulty: null },
    constraints: { maximumDistanceKm: null, maximumDurationMinutes: null,
      maximumElevationGainMeters: null, hardAvoidances: [] } };
  const headers = { authorization: `TrailMindRouteSession ${randomBytes(32).toString('base64url')}`,
    'x-trailmind-request-id': randomUUID() };

  await t.test('rejects absent opt-in, expired window and wrong model', () => {
    for (const change of [{ OWNER_ACCESS_DYNAMIC_RESEARCH_ENABLED: 'false' },
      { OWNER_ACCESS_TEST_EXPIRES_AT: new Date(clock).toISOString() },
      { GOOGLE_MODEL: 'gemini-other' }]) {
      assert.throws(() => ownerDynamicPlanningConfiguration({ ...env, ...change }, { now: clock }));
    }
  });

  await t.test('expired window blocks admission and all provider work', async () => {
    const endpoints = createOwnerDynamicPlanningEndpoints({ configuration, now: () => clock + 60_000,
      repository: { isDurable: true, consumePlanningProviderAttempt() { assert.fail('No reservation'); },
        authorizeSession() { assert.fail('No admission'); } },
      fetchImpl: async () => assert.fail('No external IO'), publicFetchImpl: async () => assert.fail('No sources') });
    assert.equal((await endpoints.plan(body, { headers })).statusCode, 403);
  });

  await t.test('missing token and denied/replayed sessions cannot reach providers', async () => {
    let fetches = 0, reservations = 0;
    const repository = { isDurable: true,
      async authorizeSession() { throw appAttestError('request_replayed'); },
      async consumePlanningProviderAttempt() { reservations++; return true; } };
    const endpoints = createOwnerDynamicPlanningEndpoints({ configuration, now: () => clock, repository,
      fetchImpl: async () => { fetches++; assert.fail('No provider'); },
      publicFetchImpl: async () => assert.fail('No source') });
    for (const context of [{}, { headers }]) {
      const response = await endpoints.plan(body, context);
      assert.notEqual(response.statusCode, 200);
    }
    assert.equal(fetches, 0); assert.equal(reservations, 0);
  });

  await t.test('actual remote parser reserves once and sends a nonpersistent pinned-model request', async () => {
    let fetches = 0, reservations = 0;
    const repository = { isDurable: true,
      async authorizeSession(input) {
        assert.equal(input.cost, 3); assert.equal(input.planning.admitRequest, false);
        return { leaseId: randomUUID(), installationId: 'owner:qa_parse_identity', remainingCost: 9 };
      },
      async consumePlanningProviderAttempt(input) { assert.equal(input.provider, 'google'); reservations++; return true; },
      async releaseLease() {} };
    const endpoints = createOwnerDynamicPlanningEndpoints({ configuration, now: () => clock, repository,
      fetchImpl: async (url, init) => {
        assert.equal(String(url), 'https://generativelanguage.googleapis.com/v1beta/interactions');
        assert.equal(reservations, 1); assert.equal(init.redirect, 'error');
        const payload = JSON.parse(init.body);
        assert.equal(payload.store, false); assert.equal(payload.model, 'gemini-3.8-flash'); fetches++;
        return Response.json({ output_text: JSON.stringify({ activityType: 'hiking', routeType: 'loop',
          startLocationQuery: 'Queenstown, New Zealand', endLocationQuery: null, regionQuery: null,
          targetDistanceKm: 8, targetDurationMinutes: null, difficulty: null, desiredFeatures: [],
          avoidFeatures: [], transportMode: 'walking', confidence: 0.9 }) });
      }, publicFetchImpl: async () => assert.fail('No source lookup during intent parse') });
    const result = await endpoints.parseIntent({ prompt: 'Plan an 8km loop hike in Queenstown', locale: 'en' }, { headers });
    assert.equal(result.statusCode, 200); assert.equal(result.payload.parserSource, 'remoteAI');
    assert.equal(fetches, 1); assert.equal(reservations, 1);
  });

  await t.test('exhausted provider reservation remains an actionable quota result', async () => {
    let fetches = 0, reservations = 0;
    const repository = { isDurable: true,
      async authorizeSession() { return { leaseId: randomUUID(), installationId: 'owner:qa_candidate_identity', remainingCost: 0 }; },
      async consumePlanningProviderAttempt() { reservations++; return false; },
      async releaseLease() {} };
    const endpoints = createOwnerDynamicPlanningEndpoints({ configuration, now: () => clock, repository,
      fetchImpl: async () => { fetches++; assert.fail('No provider'); },
      publicFetchImpl: async () => assert.fail('No source') });
    const response = await endpoints.parseIntent({ prompt: 'Plan a hiking loop in Queenstown', locale: 'en' }, { headers });
    assert.equal(fetches, 0); assert.equal(reservations, 1);
    assert.equal(response.statusCode, 429, 'A shared provider cap must not appear as a generic service outage');
  });
  assert.deepEqual(await readFile(file), before, 'Candidate changed during review; rerun only once it settles');
});
