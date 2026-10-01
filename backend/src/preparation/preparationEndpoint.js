import { randomUUID } from 'node:crypto';
import { selectedPlanningConfiguration } from '../llmPlanning/adapters/selectedIntentPlanningAdapter.js';
import { fetchBoundedJson } from '../llmPlanning/adapters/providerHttp.js';
import { googleResponseText } from '../parseIntent.js';
import { authorizeRouteRequest, createDefaultRouteAuthorizer } from '../routing/routeAuthorization.js';
import { InMemoryRouteRateLimiter } from '../routing/routeRateLimiter.js';
import { AppAttestError, appAttestErrorResult } from '../appAttest/appAttestErrors.js';
import { RouteError, routeErrorResult } from '../routing/routeErrors.js';

const stays = ['Day hike', 'Overnight · camping', 'Overnight · hut'];
const additions = ['spareSocks', 'snackPouch', 'sitMat', 'dryBags', 'tentRepair', 'hutEarplugs'];
const checks = ['layers', 'mealPlan', 'footwear', 'campingKit', 'hutRequirements'];
function exact(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
function allowed(id, stay) {
  if (id === 'spareSocks') return stay === stays[0];
  if (['tentRepair', 'campingKit'].includes(id)) return stay === stays[1];
  if (['hutEarplugs', 'hutRequirements'].includes(id)) return stay === stays[2];
  return true;
}
export function validatePreparationRequest(value) {
  if (!exact(value, ['version', 'stay', 'distanceKM', 'durationHours', 'additions', 'checks']) ||
      value.version !== 1 || !stays.includes(value.stay) ||
      !['distanceKM', 'durationHours'].every(key => Number.isFinite(value[key]) && value[key] > 0 && value[key] <= 1000) ||
      !Array.isArray(value.additions) || value.additions.length || !Array.isArray(value.checks) || value.checks.length) {
    throw new TypeError('Invalid preparation request');
  }
  return { ...value };
}
export function validatePreparationSelection(value, request) {
  if (!exact(value, ['additions', 'checks'])) throw new TypeError('Invalid selection');
  for (const [key, catalogue, maximum] of [['additions', additions, 4], ['checks', checks, 3]]) {
    const ids = value[key];
    if (!Array.isArray(ids) || ids.length > maximum || new Set(ids).size !== ids.length ||
        !ids.every(id => catalogue.includes(id) && allowed(id, request.stay))) throw new TypeError('Invalid selection');
  }
  return { ...request, additions: [...value.additions], checks: [...value.checks] };
}
export function buildPreparationRequest(request, config) {
  const schema = {
    type: 'object', additionalProperties: false, required: ['additions', 'checks'],
    properties: {
      additions: { type: 'array', maxItems: 4, items: { type: 'string', enum: additions.filter(id => allowed(id, request.stay)) } },
      checks: { type: 'array', maxItems: 3, items: { type: 'string', enum: checks.filter(id => allowed(id, request.stay)) } }
    }
  };
  const system = 'Select optional hiking packing additions and departure checks from the supplied IDs only. ' +
    'The general essentials, water, food, rain shell, emergency shelter, and selected overnight sleeping kit are already included. ' +
    'Use only the explicit stay and client-supplied mapped distance and duration. These statistics are planning data, not current-condition evidence. ' +
    'Do not infer weather, date, terrain, ability, water, access, legal camping or safety. No prose or extra fields. ' +
    'Select sparingly; empty lists are valid. spareSocks means spare walking socks; snackPouch means easy-to-reach snacks; ' +
    'sitMat means a break seat; dryBags means separating spare kit; tentRepair is camping-only; hutEarplugs is hut-only. ' +
    'checks: layers means choose clothing after checking forecast; mealPlan means plan breaks/meals for duration; footwear means review fit/terrain; ' +
    'campingKit means inspect tent/sleeping kit; hutRequirements means ask booked hut about meals/bedding/arrival. ' +
    'Output only JSON matching the supplied schema.';
  const input = JSON.stringify({ stay: request.stay, distanceKM: request.distanceKM, durationHours: request.durationHours });
  const google = config.provider === 'google';
  const body = google ? {
    model: config.model, input: `${system}\nInput: ${input}`,
    response_format: { type: 'text', mime_type: 'application/json', schema }
  } : {
    model: config.model, messages: [{ role: 'system', content: system }, { role: 'user', content: input }],
    temperature: 0.1, max_tokens: 512, provider: { require_parameters: true },
    response_format: { type: 'json_schema', json_schema: { name: 'preparation_selection_v1', strict: true, schema } }
  };
  return { method: 'POST', headers: {
    Accept: 'application/json', 'Content-Type': 'application/json',
    ...(google ? { 'x-goog-api-key': config.apiKey } : { Authorization: `Bearer ${config.apiKey}` })
  }, body: JSON.stringify(body) };
}
export function createPreparationProvider(options = {}) {
  const config = selectedPlanningConfiguration(options.env);
  return async (request, context) => {
    const payload = await fetchBoundedJson({
      fetchImpl: options.fetchImpl ?? globalThis.fetch, url: config.url,
      init: buildPreparationRequest(request, config), signal: context.signal,
      deadlineMs: Math.min(config.deadlineMs, 10000), maximumResponseBytes: 8192,
      maximumErrorResponseBytes: 1024, maximumAttempts: 1,
      setTimeoutImpl: setTimeout, clearTimeoutImpl: clearTimeout
    });
    const text = config.provider === 'google' ? googleResponseText(payload) :
      (payload?.choices?.length === 1 ? payload.choices[0]?.message?.content : undefined);
    if (typeof text !== 'string') throw new TypeError('Invalid provider response');
    return JSON.parse(text);
  };
}
export function createPreparationEndpoint(options = {}) {
  const env = options.env ?? process.env;
  let authorizer = options.authorizer;
  let provider = options.preparationProvider;
  const limiter = new InMemoryRouteRateLimiter({ maxCost: 6 });
  return async (body, context = {}) => {
    let authorization;
    if (env.PREPARATION_AI_ENABLED !== 'true') return unavailable();
    let request;
    try { request = validatePreparationRequest(body); }
    catch { return { statusCode: 400, payload: { error: { code: 'invalid_preparation_request' } } }; }
    try {
      authorizer ??= createDefaultRouteAuthorizer(env, options);
      const headerID = context.headers?.['x-trailmind-request-id'];
      const requestId = typeof headerID === 'string' && /^[0-9a-f-]{36}$/i.test(headerID) ? headerID : randomUUID();
      authorization = await authorizeRouteRequest(authorizer, { ...context, requestId, cost: 1 });
      if (authorization.limitsConsumed !== true) {
        // Production must use the existing durable session budget.
        if (env.NODE_ENV === 'production' || !limiter.consume({ key: authorization.rateLimitKey, cost: 1 }).allowed) return unavailable();
      }
      if (context.signal?.aborted) return unavailable();
      provider ??= createPreparationProvider(options);
      const selection = await provider(request, context);
      if (context.signal?.aborted) return unavailable();
      return { statusCode: 200, payload: validatePreparationSelection(selection, request) };
    } catch (error) {
      if (error instanceof AppAttestError) return appAttestErrorResult(error);
      if (error instanceof RouteError) return routeErrorResult(error);
      return unavailable();
    } finally { try { await authorization?.release?.(); } catch {} }
  };
}
function unavailable() {
  return { statusCode: 503, payload: { error: { code: 'preparation_unavailable', message: 'AI suggestions are unavailable. Your general list is unchanged.' } } };
}
