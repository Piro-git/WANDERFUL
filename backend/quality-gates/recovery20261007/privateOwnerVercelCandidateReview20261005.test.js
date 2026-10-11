import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { EventEmitter } from 'node:events';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

// Read-only candidate review. All SQL/provider IO is injected and refuses work;
// no listening socket, credentials, Supabase connection or provider request.
const root = process.env.QA_OWNER_CANDIDATE_ROOT;
test('QA actual Vercel owner candidate: private admission cannot weaken public admission', { skip: !root }, async t => {
  const files = ['backend/api/index.js', 'backend/src/ownerAccess/vercelOwnerRuntime.js',
    'backend/src/ownerAccess/ownerService.js', 'backend/src/ownerAccess/003_private_owner_bootstrap_20261005.sql',
    'backend/src/ownerAccess/postgresOwnerRepository.js'];
  const originals = await Promise.all(files.map(file => readFile(path.join(root, file))));
  files.forEach((file, i) => t.diagnostic(`${file} SHA256 ${createHash('sha256').update(originals[i]).digest('hex')}`));
  const { createVercelPrivateOwnerHandler, ownerVercelDatabaseConfiguration, OWNER_CA_FINGERPRINT } =
    await import(pathToFileURL(path.join(root, files[1])));
  const { createVercelEntrypoint } = await import(pathToFileURL(path.join(root, files[0])));
  const { ownerKeyId } = await import(pathToFileURL(path.join(root, 'backend/src/ownerAccess/ownerAccessEndpoint.js')));
  const spki = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).publicKey.export({ format: 'der', type: 'spki' });
  const pem = await readFile(path.join(path.dirname(root), 'evidence', 'supabase-public-ca-20261005.pem'), 'utf8');
  const env = () => ({ NODE_ENV: 'production', OWNER_ACCESS_ENABLED: 'true',
    OWNER_ACCESS_DYNAMIC_RESEARCH_ENABLED: 'true', OWNER_ACCESS_ORIGIN: 'https://owner.example.com',
    OWNER_ACCESS_KEY_ID: ownerKeyId(spki), OWNER_ACCESS_TEST_EXPIRES_AT: new Date(Date.now() + 60_000).toISOString(),
    AI_PROVIDER: 'google', GOOGLE_MODEL: 'gemini-3.8-flash', GOOGLE_API_KEY: 'synthetic-only',
    GRAPHHOPPER_API_KEY: 'synthetic-only', DYNAMIC_RESEARCH_USER_AGENT: 'Offline QA',
    OWNER_ACCESS_DATABASE_URL: 'postgresql://wanderful_owner_runtime.mbvzwsrtqcrwhvykugcd:synthetic-only@aws-0-eu-central-1.pooler.supabase.com:5432/postgres?sslmode=verify-full&sslrootcert=/tmp/wanderful-app-attest-ca.pem',
    APP_ATTEST_DATABASE_CA_PEM: pem, APP_ATTEST_DATABASE_CA_SHA256: OWNER_CA_FINGERPRINT });
  let pool, fetches = 0, transactions = 0;
  class Pool {
    constructor(configuration) { assert.equal(configuration.ssl.rejectUnauthorized, true); pool = this; this.role = 'wanderful_owner_runtime'; this.active = true; this.member = false; this.guard = true; }
    on() {} async end() {}
    async connect() { transactions++; assert.fail('No auth transaction allowed'); }
    async query(sql) {
      if (sql.includes('current_user AS role')) return { rows: [{ role: this.role, rolsuper: false, rolbypassrls: false, rolcreatedb: false, rolcreaterole: false, rolinherit: false, rolreplication: false }] };
      if (sql.includes('pg_auth_members')) return { rows: this.member ? [{}] : [], rowCount: this.member ? 1 : 0 };
      if (sql.includes('FROM pg_trigger')) return { rows: this.guard ? [{}] : [], rowCount: this.guard ? 1 : 0 };
      if (sql.includes('SELECT k.*')) return { rows: this.active ? [{ public_key_spki: spki, installation_id: 'owner:offline_qa_identity' }] : [] };
      if (sql.includes('SELECT c.relname')) return { rows: ['owners', 'keys', 'challenges', 'sessions', 'requests', 'windows', 'leases'].map(relname => ({ relname, relrowsecurity: true, owned: false, sel: true, ins: !['owners', 'keys'].includes(relname), upd: !['owners', 'keys', 'requests'].includes(relname), del: false, trunc: false, trig: false, refs: false })) };
      return { rows: [], rowCount: 0 };
    }
  }
  const fetchImpl = async () => { fetches++; assert.fail('No provider/source request'); };
  async function invoke(handler, url, { method = 'GET', host = 'owner.example.com', headers = {}, body = {} } = {}) {
    const req = Readable.from(method === 'POST' ? [Buffer.from(JSON.stringify(body))] : []);
    Object.assign(req, { url, method, headers: { host, 'content-type': 'application/json', ...headers }, socket: { remoteAddress: '127.0.0.1' } });
    const res = new EventEmitter();
    res.writeHead = status => { res.status = status; res.headersSent = true; };
    res.end = value => { res.payload = JSON.parse(value); res.writableEnded = true; res.emit('close'); };
    await handler(req, res); return res;
  }
  await t.test('rejects credential-free or misdirected database URLs and TLS override input', () => {
    const base = env();
    for (const patch of [
      { OWNER_ACCESS_DATABASE_URL: base.OWNER_ACCESS_DATABASE_URL.replace(':synthetic-only@', '@') },
      { OWNER_ACCESS_DATABASE_URL: base.OWNER_ACCESS_DATABASE_URL.replace('mbvzwsrtqcrwhvykugcd', 'anotherproject') },
      { OWNER_ACCESS_DATABASE_URL: base.OWNER_ACCESS_DATABASE_URL + '&sslrootcert=/other.pem' },
      { OWNER_ACCESS_DATABASE_URL: base.OWNER_ACCESS_DATABASE_URL + '&options=-c%20role=postgres' },
      { OWNER_ACCESS_DATABASE_URL: base.OWNER_ACCESS_DATABASE_URL.replace('/postgres?', '/otherdb?') },
      { APP_ATTEST_DATABASE_CA_PEM: 'not a certificate' }, { NODE_TLS_REJECT_UNAUTHORIZED: '0' }
    ]) assert.throws(() => ownerVercelDatabaseConfiguration({ ...base, ...patch }));
  });
  await t.test('private mount rejects public paths, spoofed hosts and missing sessions without provider work', async () => {
    const handler = createVercelPrivateOwnerHandler({ env: env(), PoolClass: Pool, fetchImpl });
    assert.equal((await invoke(handler, '/api/private-owner/readyz')).status, 200);
    assert.equal((await invoke(handler, '/api/parse-intent', { method: 'POST' })).status, 404);
    assert.equal((await invoke(handler, '/api/private-owner/parse-intent', { method: 'POST', host: 'evil.example.com', headers: { 'x-forwarded-host': 'owner.example.com' } })).status, 404);
    const denied = await invoke(handler, '/api/private-owner/parse-intent', { method: 'POST', body: { prompt: 'Public synthetic request', locale: 'en' } });
    assert.equal(denied.status, 401);
    assert.equal(fetches, 0); assert.equal(transactions, 0);
  });
  await t.test('role escalation, membership, missing wave guard and revoked key invalidate a ready runtime', async () => {
    const handler = createVercelPrivateOwnerHandler({ env: env(), PoolClass: Pool, fetchImpl });
    assert.equal((await invoke(handler, '/api/private-owner/readyz')).status, 200);
    pool.role = 'postgres'; assert.equal((await invoke(handler, '/api/private-owner/readyz')).status, 503);
    pool.role = 'wanderful_owner_runtime'; pool.member = true; assert.equal((await invoke(handler, '/api/private-owner/readyz')).status, 503);
    pool.member = false; pool.guard = false; assert.equal((await invoke(handler, '/api/private-owner/readyz')).status, 503);
    pool.guard = true; pool.active = false; assert.equal((await invoke(handler, '/api/private-owner/readyz')).status, 503);
  });
  await t.test('expiry is checked again after successful initialization', async () => {
    const e = env(), clock = Date.now, expires = new Date(e.OWNER_ACCESS_TEST_EXPIRES_AT).getTime();
    const handler = createVercelPrivateOwnerHandler({ env: e, PoolClass: Pool, fetchImpl });
    assert.equal((await invoke(handler, '/api/private-owner/readyz')).status, 200);
    try { Date.now = () => expires; assert.equal((await invoke(handler, '/api/private-owner/readyz')).status, 503); }
    finally { Date.now = clock; }
  });
  await t.test('owner headers on public paths cannot select the private handler', async () => {
    const handler = createVercelEntrypoint({ env: env(), PoolClass: Pool, fetchImpl });
    const pub = await invoke(handler, '/api/llm-plan-route', { method: 'POST', headers: { 'x-owner': 'true', 'x-trailmind-request-id': 'synthetic' } });
    assert.equal(pub.status, 503); assert.equal(pub.payload.error.code, 'service_unavailable');
    const privateReady = await invoke(handler, '/api/private-owner/readyz');
    assert.equal(privateReady.status, 200); assert.equal(fetches, 0); assert.equal(transactions, 0);
  });
  for (let i = 0; i < files.length; i++) assert.deepEqual(await readFile(path.join(root, files[i])), originals[i], 'Candidate changed during QA run');
});
