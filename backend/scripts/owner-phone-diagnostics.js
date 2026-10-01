import fs from 'node:fs';
import path from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import { safeGoogleErrorMetadata } from './owner-google-error-classification.js';

const endpoints = new Set(['/api/parse-intent', '/api/llm-plan-route', '/api/route']);
const codes = new Set(['timed_out', 'cancelled', 'intent_timed_out', 'request_cancelled',
  'research_unavailable', 'provider_unavailable', 'intent_unavailable', 'invalid_provider_response',
  'configuration_unavailable', 'invalid_request', 'route_distance_limit', 'rate_limited',
  'invalid_coordinates', 'unsupported_profile', 'unsupported_algorithm',
  'flexible_mode_unavailable', 'route_not_found', 'route_timed_out',
  'routing_unavailable', 'routing_rate_limited', 'configuration_missing',
  'request_too_large', 'unauthorized',
  'ENOTFOUND', 'ECONNRESET', 'ETIMEDOUT', 'UND_ERR_SOCKET',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE']);
const events = new Set(['request_completed', 'endpoint_outcome', 'provider_completed',
  'route_request_completed', 'route_http_rejected',
  'llm_first_planning_completed', 'outdoor_adventure_planning_completed']);

// Private, bounded metadata only. Never serialize caller objects or upstream text.
export function createOwnerDiagnostics(directory, { now = Date.now } = {}) {
  const info = fs.lstatSync(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid() ||
      (info.mode & 0o777) !== 0o700 || fs.realpathSync(directory) !== directory) throw Error('private_diagnostics_invalid');
  const file = path.join(directory, 'owner-diagnostics.jsonl');
  const fd = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_APPEND | fs.constants.O_NOFOLLOW, 0o600);
  const stat = fs.fstatSync(fd);
  if (!stat.isFile() || stat.uid !== process.getuid() || (stat.mode & 0o777) !== 0o600 || stat.size > 32768) {
    fs.closeSync(fd); throw Error('private_diagnostics_invalid');
  }
  const context = new AsyncLocalStorage();
  let bytes = stat.size, closed = false, sequence = 0;
  function record(input) {
    if (closed || !events.has(input?.event)) return;
    const active = context.getStore();
    const endpoint = endpoints.has(input.endpoint) ? input.endpoint : active?.endpoint;
    const value = { at: new Date(now()).toISOString(), event: input.event };
    if (endpoint) value.endpoint = endpoint;
    if (active) value.requestSequence = active.sequence;
    if (Number.isFinite(input.durationMs)) value.durationMs = Math.max(0, Math.min(180000, Math.round(input.durationMs)));
    const status = input.status ?? input.statusCode;
    if (Number.isInteger(status) && status >= 100 && status <= 599) value.status = status;
    if (codes.has(input.code ?? input.errorCode)) value.code = input.code ?? input.errorCode;
    if (['distance_limit', 'route_type', 'locale', 'activity', 'difficulty', 'avoid', 'preferences_route_type', 'malformed_json', 'content_type'].includes(input.validationReason)) value.validationReason = input.validationReason;
    if (['ready', 'routed', 'partial', 'unsupported', 'needs_clarification', 'no_viable_route', 'failed'].includes(input.state)) value.state = input.state;
    if (['google', 'graphhopper', 'osm', 'wikidata', 'commons'].includes(input.provider)) {
      value.provider = input.provider;
      if (input.provider === 'google') Object.assign(value, safeGoogleErrorMetadata(input));
      value.phase = input.provider === 'commons' ? 'photo' : ['osm','wikidata'].includes(input.provider) ? 'research' : input.provider === 'graphhopper' ? 'routing' :
        endpoint === '/api/parse-intent' ? 'intent_parsing' : input.groundingEnabled === true && endpoint === '/api/llm-plan-route' ? 'web_research' : endpoint === '/api/llm-plan-route' ? 'itinerary_selection' : 'unknown';
    }
    if (['http', 'aborted', 'transport_error'].includes(input.kind)) value.kind = input.kind;
    if (typeof input.signalAborted === 'boolean') value.signalAborted = input.signalAborted;
    const line = JSON.stringify(value) + '\n';
    if (bytes + Buffer.byteLength(line) > 32768) return;
    try { fs.writeSync(fd, line); fs.fsyncSync(fd); bytes += Buffer.byteLength(line); } catch { /* Diagnostics never change routing or allowance. */ }
  }
  return { record, logger: { info: record },
    run(endpoint, work) { return context.run({ endpoint: endpoints.has(endpoint) ? endpoint : undefined, sequence: ++sequence }, work); },
    close() { if (!closed) { closed = true; fs.closeSync(fd); } }
  };
}
