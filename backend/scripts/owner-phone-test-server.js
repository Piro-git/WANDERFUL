// Private operator-only entrypoint. No production server imports this module.
import { createServer } from 'node:http';
import { createIntentRequestHandler } from '../src/server.js';
import { createLLMFirstPlanningEndpoint } from '../src/llmPlanning/llmFirstPlanningEndpoint.js';
import { appAttestErrorResult } from '../src/appAttest/appAttestErrors.js';
import { createIntentSessionEndpoint } from '../src/appAttest/intentSessionEndpoint.js';
import { createRouteEndpoint } from '../src/routing/routeEndpoint.js';

const allowed = new Set(['/api/parse-intent', '/api/route']);
export function createOwnerPhoneTestServer({ session, env, diagnostics, ...dependencies }) {
  if (env?.NODE_ENV !== 'development' || env?.TRAILMIND_RELEASE_STAGE !== 'local' ||
      env?.OWNER_PHONE_TEST_ENABLED !== 'true') throw Error('owner_test_configuration_invalid');
  const allowDynamic = env.DYNAMIC_RESEARCH_ENABLED === 'true';
  const allowResearch = env.OWNER_PHONE_RESEARCH_TEST_ENABLED === 'true';
  if (allowResearch && (env.LLM_FIRST_PLANNING_ENABLED !== 'true' ||
      env.INTENT_PROVIDER_ENABLED !== 'true' || env.ROUTE_PROVIDER_ENABLED !== 'true' ||
      env.OUTDOOR_RESEARCH_PLANNING_ENABLED !== 'true' ||
      env.OUTDOOR_ROUTABLE_HIGHLIGHT_ACCESS_ENABLED !== 'true' ||
      (!allowDynamic && typeof dependencies.repository?.withConsistentSnapshot !== 'function'))) {
    throw Error('owner_research_configuration_unavailable');
  }
  const options = { ...dependencies, logger: dependencies.logger ?? diagnostics?.logger,
    env, authorizer: session, intentAuthorizer: session };
  const reportOutcome = result => {
    diagnostics?.record({ event: 'endpoint_outcome', status: result.statusCode,
      code: result.payload?.error?.code, state: result.payload?.state,
      validationReason: routeValidationReason(result.payload?.error?.message) });
    return result;
  };
  if (diagnostics) {
    const intentEndpoint = options.intentEndpoint ?? createIntentSessionEndpoint(options);
    options.intentEndpoint = async (body, context) => reportOutcome(await intentEndpoint(body, context));
    const routeEndpoint = options.routeEndpoint ?? createRouteEndpoint(options);
    options.routeEndpoint = async (body, context) => reportOutcome(await routeEndpoint(body, context));
  }
  const combined = allowResearch
    ? dependencies.llmFirstPlanningEndpoint ?? createLLMFirstPlanningEndpoint(options)
    : null;
  const handler = createIntentRequestHandler({ ...options,
    llmFirstPlanningEndpoint: async (body, context) => {
      if (!allowResearch || body?.schemaVersion !== (allowDynamic ? 3 : 2)) {
        return { statusCode: 400, payload: { error: { code: 'invalid_request', message: 'Native research request required.' } } };
      }
      return reportOutcome(await combined(body, context));
    }
  });
  const server = createServer((request, response) => {
    const reject = (status, code) => {
      response.writeHead(status, { 'Content-Type':'application/json', 'Cache-Control':'no-store', 'Connection':'close' });
      response.end(JSON.stringify({ error: { code, message:'Private test request could not be accepted.' } }));
    };
    if (request.method !== 'POST' || !(allowed.has(request.url) ||
        (allowResearch && request.url === '/api/llm-plan-route'))) return reject(404,'not_found');
    try { session.verify(request.headers); }
    catch (error) { const result=appAttestErrorResult(error); return reject(result.statusCode,result.payload.error.code); }
    // Only an authenticated, allowed request reaches existing bounded parsers/providers.
    const run = () => {
      const startedAt = Date.now();
      response.once('finish', () => diagnostics?.record({ event: 'request_completed', endpoint: request.url,
        status: response.statusCode, durationMs: Date.now() - startedAt }));
      return handler(request,response);
    };
    Promise.resolve(diagnostics ? diagnostics.run(request.url, run) : run()).catch(() => {
      if (!response.headersSent) reject(503,'service_unavailable'); else response.destroy();
    });
  });
  server.headersTimeout=10000;
  server.requestTimeout=45000;
  server.keepAliveTimeout=1000;
  server.maxHeadersCount=32;
  return server;
}

// Classify only known validation text; never retain arbitrary upstream/user text.
function routeValidationReason(message) {
  if (typeof message !== 'string') return undefined;
  if (/^The route points exceed the [0-9]+ metre request limit\.$/.test(message)) return 'distance_limit';
  if (message === 'routeType must be loop or pointToPoint.') return 'route_type';
  if (message === 'The requested locale is not supported.') return 'locale';
  if (message === 'preferences.activityType is invalid.' || message === 'preferences.activityType does not match the routing profile.') return 'activity';
  if (message === 'Only the easy route-engine difficulty preference is supported.') return 'difficulty';
  if (message === 'preferences.avoid is invalid.') return 'avoid';
  if (message === 'Typed route preferences are supported only for point-to-point requests.') return 'preferences_route_type';
  return undefined;
}
