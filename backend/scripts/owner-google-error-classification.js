// Private diagnostic boundary. These are provider-reported categories, not a root-cause verdict.
// Interactions: https://ai.google.dev/gemini-api/docs/api-errors
// RPC fallback: https://docs.cloud.google.com/php/docs/reference/common-protos/latest/Api.ErrorReason
const interactionCodes = new Set([
  'invalid_request', 'failed_precondition', 'out_of_range', 'parameter_unknown',
  'authentication', 'permission_denied', 'not_found', 'model_not_found',
  'already_exists', 'aborted', 'rate_limit_exceeded', 'quota_exceeded',
  'too_many_requests', 'cancelled', 'api_error', 'unimplemented',
  'service_unavailable', 'deadline_exceeded', 'safety', 'recitation', 'language',
  'prohibited_content', 'spii', 'blocklist', 'content_blocked'
]);
const rpcStatuses = new Set([
  'CANCELLED', 'UNKNOWN', 'INVALID_ARGUMENT', 'DEADLINE_EXCEEDED', 'NOT_FOUND',
  'ALREADY_EXISTS', 'PERMISSION_DENIED', 'RESOURCE_EXHAUSTED', 'FAILED_PRECONDITION',
  'ABORTED', 'OUT_OF_RANGE', 'UNIMPLEMENTED', 'INTERNAL', 'UNAVAILABLE',
  'DATA_LOSS', 'UNAUTHENTICATED'
]);
const rpcReasons = new Set([
  'API_KEY_INVALID', 'API_KEY_SERVICE_BLOCKED', 'API_KEY_HTTP_REFERRER_BLOCKED',
  'API_KEY_IP_ADDRESS_BLOCKED', 'SERVICE_DISABLED', 'BILLING_DISABLED',
  'RATE_LIMIT_EXCEEDED', 'RESOURCE_QUOTA_EXCEEDED'
]);
const bodyStates = new Set(['classified', 'unrecognized', 'malformed', 'oversized',
  'not_json', 'unavailable', 'aborted', 'deadline', 'read_failed']);
export const GOOGLE_ERROR_BODY_LIMITS = Object.freeze({ maximumBytes: 8192, timeoutMs: 250 });

// Reapply at the file logger as well: never trust metadata supplied by a caller.
export function safeGoogleErrorMetadata(input) {
  const output = {};
  for (const [field, allowed] of [
    ['googleErrorCode', interactionCodes], ['googleErrorStatus', rpcStatuses],
    ['googleErrorReason', rpcReasons], ['errorBodyState', bodyStates]
  ]) {
    if (allowed.has(input?.[field])) output[field] = input[field];
  }
  if(Number.isInteger(input?.retryAfterSeconds)&&input.retryAfterSeconds>=0&&input.retryAfterSeconds<=86400)output.retryAfterSeconds=input.retryAfterSeconds;
  return output;
}

function classify(payload) {
  const error = payload?.error;
  if (!error || typeof error !== 'object' || Array.isArray(error)) return {errorBodyState: 'unrecognized'};
  const details = Array.isArray(error.details) ? error.details : [];
  const reason = details.find(item => item?.['@type'] === 'type.googleapis.com/google.rpc.ErrorInfo' &&
    item.domain === 'googleapis.com' && rpcReasons.has(item.reason))?.reason;
  const safe = safeGoogleErrorMetadata({googleErrorCode: error.code,
    googleErrorStatus: error.status, googleErrorReason: reason});
  return {...safe, errorBodyState: Object.keys(safe).length ? 'classified' : 'unrecognized'};
}

// Consumes only an error body; never clones/tees it (which could buffer without a bound).
// Production callers discard error bodies anyway. Successful responses remain untouched.
export async function classifyGoogleErrorResponse(response, {signal} = {}) {
  let reader, timer, abort;
  const stop = state => { throw state; };
  try {
    if (!response?.body?.getReader) return {errorBodyState: 'unavailable'};
    reader = response.body.getReader();
    if (signal?.aborted) return {errorBodyState: 'aborted'};
    const type = response.headers?.get?.('content-type');
    if (typeof type !== 'string' || !/^application\/(?:[a-z0-9!#$&^_.+-]+\+)?json(?:\s*;|\s*$)/i.test(type)) {
      return {errorBodyState: 'not_json'};
    }
    const declared = response.headers?.get?.('content-length');
    if (declared !== null && declared !== undefined &&
        (!/^\d+$/.test(declared) || !Number.isSafeInteger(Number(declared)) || Number(declared) > GOOGLE_ERROR_BODY_LIMITS.maximumBytes)) {
      return {errorBodyState: 'oversized'};
    }
    const cancellation = new Promise((_, reject) => {
      abort = () => reject('aborted');
      signal?.addEventListener('abort', abort, {once: true});
      timer = setTimeout(() => reject('deadline'), GOOGLE_ERROR_BODY_LIMITS.timeoutMs);
    });
    const bytes = new Uint8Array(GOOGLE_ERROR_BODY_LIMITS.maximumBytes);
    let length = 0;
    const read = async () => {
      while (true) {
        if (signal?.aborted) stop('aborted');
        const {done, value} = await reader.read();
        if (done) break;
        if (!(value instanceof Uint8Array)) stop('read_failed');
        if (length + value.byteLength > bytes.length) stop('oversized');
        bytes.set(value, length); length += value.byteLength;
      }
    };
    await Promise.race([read(), cancellation]);
    try {
      const metadata=classify(JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes.subarray(0, length))));
      const retryAfter=response.headers?.get?.('retry-after');
      return {...metadata,...safeGoogleErrorMetadata({retryAfterSeconds:typeof retryAfter==='string'&&/^\d{1,5}$/.test(retryAfter)?Number(retryAfter):undefined})};
    } catch { return {errorBodyState: 'malformed'}; }
  } catch (state) {
    return {errorBodyState: ['aborted', 'deadline', 'oversized'].includes(state) ? state : 'read_failed'};
  } finally {
    clearTimeout(timer);
    if (abort) signal?.removeEventListener('abort', abort);
    // Do not await a provider-controlled cancellation promise.
    try { reader?.cancel().catch(() => {}); } catch {}
    try { reader?.releaseLock(); } catch {}
  }
}
