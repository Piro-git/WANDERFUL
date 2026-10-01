import test from 'node:test';
import assert from 'node:assert/strict';
import { createPreparationEndpoint, createPreparationProvider, validatePreparationRequest, validatePreparationSelection, buildPreparationRequest } from '../src/preparation/preparationEndpoint.js';
const request = { version: 1, stay: 'Day hike', distanceKM: 12, durationHours: 4, additions: [], checks: [] };
const env = { NODE_ENV: 'test', PREPARATION_AI_ENABLED: 'true' };
const authorizer = { authorize: async () => ({ authorized: true, rateLimitKey: 'test', limitsConsumed: true }) };
test('strict request: explicit context, no claims, no missing facts', () => {
  assert.deepEqual(validatePreparationRequest(request), request);
  for (const bad of [{ ...request, stay: null }, { ...request, distanceKM: null }, { ...request, durationHours: Infinity }, { ...request, weather: 'sunny' }, { ...request, additions: ['tentRepair'] }]) {
    assert.throws(() => validatePreparationRequest(bad));
  }
});
test('all contexts validate controlled IDs; unknown claims, duplicate/oversized output rejected', () => {
  for (const stay of ['Day hike', 'Overnight · camping', 'Overnight · hut']) {
    const context = { ...request, stay };
    const selection = { additions: [stay.includes('camping') ? 'tentRepair' : stay.includes('hut') ? 'hutEarplugs' : 'spareSocks'], checks: ['mealPlan'] };
    assert.deepEqual(validatePreparationSelection(selection, context), { ...context, ...selection });
  }
  for (const bad of [null, { additions: ['tentRepair'], checks: [] }, { additions: ['hutEarplugs'], checks: [] }, { additions: ['waterAvailable'], checks: [] }, { additions: [], checks: [], weather: 'sunny' }, { additions: ['sitMat', 'sitMat'], checks: [] }, { additions: [], checks: ['layers', 'mealPlan', 'footwear', 'layers'] }]) {
    assert.throws(() => validatePreparationSelection(bad, request));
  }
});
test('default disabled and failed auth perform zero provider calls', async () => {
  let calls = 0;
  const provider = async () => { calls++; return { additions: [], checks: [] }; };
  assert.equal((await createPreparationEndpoint({ env: {}, preparationProvider: provider })(request)).statusCode, 503);
  assert.equal((await createPreparationEndpoint({ env, preparationProvider: provider, authorizer: { authorize: async () => ({ authorized: false }) } })(request)).statusCode, 401);
  assert.equal(calls, 0);
});
test('success and invalid/unavailable provider always release authorization, reflect no claims/errors', async () => {
  let released = 0;
  const auth = { authorize: async () => ({ authorized: true, rateLimitKey: 'test', limitsConsumed: true, release: async () => released++ }) };
  for (const selection of [{ additions: ['snackPouch'], checks: ['mealPlan'] }, { additions: [], checks: [], safe: true }, null]) {
    const result = await createPreparationEndpoint({ env, authorizer: auth, preparationProvider: async () => { if (!selection) throw Error('private upstream detail'); return selection; } })(request);
    assert.equal(result.statusCode, selection?.additions?.length ? 200 : 503);
    assert.ok(!JSON.stringify(result).includes('private upstream detail'));
    assert.ok(!JSON.stringify(result).includes('safe'));
  }
  assert.equal(released, 3);
});
test('both provider formats use strict controlled schema, no day camping IDs', () => {
  for (const provider of ['google', 'openrouter']) {
    const body = JSON.parse(buildPreparationRequest(request, { provider, model: 'fixture', apiKey: 'fixture' }).body);
    const schema = provider === 'google' ? body.response_format.schema : body.response_format.json_schema.schema;
    assert.equal(schema.additionalProperties, false);
    assert.ok(!schema.properties.additions.items.enum.includes('tentRepair'));
  }
});
test('offline adapter fixtures for both providers; malformed JSON rejected', async () => {
  for (const provider of ['google', 'openrouter']) {
    for (const malformed of [false, true]) {
      let calls = 0;
      const content = malformed ? 'not JSON' : JSON.stringify({ additions: ['sitMat'], checks: [] });
      const payload = provider === 'google' ? { output_text: content } : { choices: [{ message: { content } }] };
      const adapter = createPreparationProvider({ env: { AI_PROVIDER: provider, GOOGLE_API_KEY: 'offline-fixture', OPENROUTER_API_KEY: 'offline-fixture' }, fetchImpl: async () => { calls++; return new Response(JSON.stringify(payload), { headers: { 'Content-Type': 'application/json' } }); } });
      if (malformed) await assert.rejects(adapter(request, {}));
      else assert.deepEqual(await adapter(request, {}), { additions: ['sitMat'], checks: [] });
      assert.equal(calls, 1);
    }
  }
});
test('production requires durable consumed budget and cancelled calls do not invoke provider', async () => {
  let calls = 0;
  const preparationProvider = async () => { calls++; return { additions: [], checks: [] }; };
  assert.equal((await createPreparationEndpoint({ env: { ...env, NODE_ENV: 'production' }, authorizer: { authorize: async () => ({ authorized: true, rateLimitKey: 'test' }) }, preparationProvider })(request)).statusCode, 503);
  const controller = new AbortController(); controller.abort();
  assert.equal((await createPreparationEndpoint({ env, authorizer, preparationProvider })(request, { signal: controller.signal })).statusCode, 503);
  assert.equal(calls, 0);
});
test('HTTP dispatch reaches the additive preparation boundary, existing server defaults stay disabled', async () => {
  const { handleIntentHttpRequest } = await import('../src/server.js');
  const result = await handleIntentHttpRequest({ method: 'POST', url: '/api/preparation', body: request }, { env, authorizer, preparationProvider: async () => ({ additions: ['sitMat'], checks: ['layers'] }) });
  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.payload.additions, ['sitMat']);
  assert.equal((await handleIntentHttpRequest({ method: 'POST', url: '/api/preparation', body: request }, { env: {} })).statusCode, 503);
});
