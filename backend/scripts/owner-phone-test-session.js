// Development operator tool only. Never imported by a deployed server entrypoint.
import { createHash, timingSafeEqual } from 'node:crypto';
import { AppAttestError } from '../src/appAttest/appAttestErrors.js';

export function createOwnerPhoneTestSession({ token, expiresAt, env, now = Date.now, maxRequests = 30, maxCost = 60 }) {
  const startedAt = now();
  if (!Number.isInteger(maxRequests) || maxRequests < 1 || maxRequests > 30 ||
      !Number.isInteger(maxCost) || maxCost < 1 || maxCost > 60) throw new AppAttestError('authorization_unavailable');
  if (env?.NODE_ENV !== 'development' || env?.TRAILMIND_RELEASE_STAGE !== 'local' ||
      env?.OWNER_PHONE_TEST_ENABLED !== 'true' || !/^[A-Za-z0-9_-]{43}$/.test(token ?? '') ||
      Buffer.from(token, 'base64url').toString('base64url') !== token ||
      !Number.isSafeInteger(expiresAt) || expiresAt <= startedAt || expiresAt > startedAt + 7_200_000) {
    throw new AppAttestError('authorization_unavailable');
  }
  const digest = createHash('sha256').update(token).digest();
  const seen = new Set();
  let remaining = maxCost;
  let active = false;
  let revoked = false;
  let lastClock = startedAt;
  function verify(headers) {
    const time = now();
    if (!Number.isFinite(time) || time < lastClock) revoked = true;
    lastClock = time;
    if (revoked || time >= expiresAt) throw new AppAttestError('route_session_expired');
    const value = headers?.authorization;
    if (typeof value !== 'string' || !/^TrailMindRouteSession [A-Za-z0-9_-]{43}$/.test(value) ||
        !timingSafeEqual(createHash('sha256').update(value.slice(22)).digest(), digest)) {
      throw new AppAttestError('route_session_invalid');
    }
  }
  return {
    verify,
    revoke() { revoked = true; },
    async authorize({ headers, cost, signal }) {
      verify(headers);
      const id = headers?.['x-trailmind-request-id'];
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id ?? '') ||
          !Number.isInteger(cost) || cost < 1 || cost > 12 || signal?.aborted) {
        throw new AppAttestError('route_session_invalid');
      }
      if (seen.has(id.toLowerCase())) throw new AppAttestError('request_replayed');
      if (active) throw new AppAttestError('app_attest_rate_limited');
      if (seen.size >= maxRequests || remaining < cost) throw new AppAttestError('route_session_exhausted');
      seen.add(id.toLowerCase());
      remaining -= cost;
      active = true;
      let released = false;
      return { authorized: true, limitsConsumed: true, rateLimitKey: 'owner-phone-test',
        remainingCost: remaining, async release() { if (!released) { released = true; active = false; } } };
    }
  };
}
