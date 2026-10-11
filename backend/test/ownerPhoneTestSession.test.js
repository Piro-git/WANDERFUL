import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createOwnerPhoneTestSession } from '../scripts/owner-phone-test-session.js';

const env = { NODE_ENV: 'development', TRAILMIND_RELEASE_STAGE: 'local', OWNER_PHONE_TEST_ENABLED: 'true' };
function fixture() {
  let time = 1_000_000;
  const token = randomBytes(32).toString('base64url');
  const options = { token, env, expiresAt: time + 1000, now: () => time };
  const session = createOwnerPhoneTestSession(options);
  return { session, options, setTime: v => time = v,
    request: cost => ({ cost, headers: { authorization: `TrailMindRouteSession ${token}`, 'x-trailmind-request-id': randomUUID() } }) };
}
test('owner test requires explicit local development opt in', () => {
  const f = fixture();
  for (const patch of [{ NODE_ENV:'production' }, { TRAILMIND_RELEASE_STAGE:'staging' }, { OWNER_PHONE_TEST_ENABLED:'false' }]) {
    assert.throws(() => createOwnerPhoneTestSession({ ...f.options, env: { ...env, ...patch } }));
  }
});
test('invalid credentials never admit work', async () => {
  const f = fixture();
  for (const value of [undefined, '', 'Bearer abc', `TrailMindRouteSession ${'A'.repeat(43)}`, ['wrong']]) {
    const request = f.request(1); request.headers.authorization = value;
    await assert.rejects(f.session.authorize(request), { code: 'route_session_invalid' });
  }
  const access = await f.session.authorize(f.request(1)); assert.equal(access.remainingCost,59);
});
test('one active request, exact replay denial, release idempotence', async () => {
  const f = fixture(), first = f.request(3);
  const access = await f.session.authorize(first);
  await assert.rejects(f.session.authorize(f.request(3)), { code:'app_attest_rate_limited' });
  await access.release(); await access.release();
  await assert.rejects(f.session.authorize(first), { code:'request_replayed' });
  const next = await f.session.authorize(f.request(3)); assert.equal(next.remainingCost,54);
});
test('weighted budget cannot refresh itself', async () => {
  const f = fixture();
  for (let i=0;i<5;i++) await (await f.session.authorize(f.request(12))).release();
  await assert.rejects(f.session.authorize(f.request(1)), { code:'route_session_exhausted' });
});
test('total request count is bounded independently of cost', async () => {
  const f = fixture();
  for (let i=0;i<30;i++) await (await f.session.authorize(f.request(1))).release();
  await assert.rejects(f.session.authorize(f.request(1)), { code:'route_session_exhausted' });
});
test('expiry, clock rollback and revocation fail closed', async () => {
  const f = fixture(); f.setTime(f.options.expiresAt);
  await assert.rejects(f.session.authorize(f.request(1)), { code:'route_session_expired' });
  const b = fixture(); b.setTime(999999);
  await assert.rejects(b.session.authorize(b.request(1)), { code:'route_session_expired' });
  b.setTime(1000001); await assert.rejects(b.session.authorize(b.request(1)));
  const r=fixture(); r.session.revoke(); await assert.rejects(r.session.authorize(r.request(1)));
});
test('malformed costs, replay IDs, and cancellation consume no budget', async () => {
  const f = fixture();
  for (const cost of [0,-1,13,1.5,NaN]) await assert.rejects(f.session.authorize(f.request(cost)));
  const r=f.request(1); r.headers['x-trailmind-request-id']='invalid'; await assert.rejects(f.session.authorize(r));
  await assert.rejects(f.session.authorize({ ...f.request(1), signal:AbortSignal.abort() }));
  assert.equal((await f.session.authorize(f.request(1))).remainingCost,59);
});
