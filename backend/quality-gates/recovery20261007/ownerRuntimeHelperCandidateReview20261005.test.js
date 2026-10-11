import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const root = process.env.QA_OWNER_CANDIDATE_ROOT;
test('QA new runtime helper rejects invalid stdin without exposing credential-shaped input', { skip: !root }, async t => {
  const helper = path.join(root, 'docs/operations/vercel-live-20261004/verify-owner-runtime-input.mjs');
  const before = await readFile(helper);
  t.diagnostic(`verify-owner-runtime-input.mjs SHA256 ${createHash('sha256').update(before).digest('hex')}`);
  const marker = 'QA_SYNTHETIC_PASSWORD_MARKER_ONLY';
  const caPath = path.join(path.dirname(root), 'evidence', 'supabase-public-ca-20261005.pem');
  const input = { caPath, databaseURL: `postgresql://wanderful_owner_runtime.mbvzwsrtqcrwhvykugcd:${marker}@aws-0-eu-central-1.pooler.supabase.com:5432/otherdb?sslmode=verify-full&sslrootcert=/tmp/wanderful-app-attest-ca.pem` };
  // All inputs fail BEFORE pool creation. No positive credential, DB connection,
  // mutation, provider request or inherited production environment is used.
  for (const [label, value] of [
    ['malformed', marker],
    ['oversized', marker.repeat(300)],
    ['unknown fields', JSON.stringify({ ...input, extra: marker })],
    ['wrong database path', JSON.stringify(input)],
    ['wrong runtime role', JSON.stringify({ ...input, databaseURL: input.databaseURL.replace('wanderful_owner_runtime', 'postgres') })]
  ]) {
    await t.test(label, () => {
      const result = spawnSync(process.execPath, [helper], { input: value, env: { PATH: process.env.PATH },
        encoding: 'utf8', timeout: 10_000, maxBuffer: 2048 });
      assert.equal(result.error, undefined); assert.equal(result.status, 1);
      assert.equal(result.stderr, '');
      assert.deepEqual(JSON.parse(result.stdout), { status: 'runtime_unavailable', providerCalls: 0 });
      assert.equal((result.stdout + result.stderr).includes(marker), false);
      assert.equal((result.stdout + result.stderr).includes('postgresql:'), false);
    });
  }
  assert.deepEqual(await readFile(helper), before, 'Helper changed during QA review');
});
