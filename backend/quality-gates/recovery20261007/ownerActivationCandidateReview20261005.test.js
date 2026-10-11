import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = process.env.QA_OWNER_CANDIDATE_ROOT;
test('QA bounded credential activation candidate, injected clients only', {skip: !root}, async t => {
  const file = path.join(root, 'docs/operations/vercel-live-20261004/activate-owner-credential-input.mjs');
  const before = await readFile(file);
  t.diagnostic(`activation candidate SHA256 ${createHash('sha256').update(before).digest('hex')}`);
  const {activateNewOwner, loggingGate} = await import(pathToFileURL(file));
  const marker = 'QA_PUBLIC_SYNTHETIC_PASSWORD_ONLY';
  const safe = {log_statement:'ddl', log_min_duration_statement:'-1', log_min_duration_sample:'-1',
    log_transaction_sample_rate:'0', log_parameter_max_length_on_error:'0',
    'pgaudit.log':'none', 'pg_stat_statements.track':'top'};
  const rows = settings => Object.entries(settings).map(([name,setting]) => ({name,setting}));
  await t.test('unsafe logs, nested collector and missing mandatory metadata stop before BEGIN', async () => {
    for (const change of [{log_statement:'all'}, {'pg_stat_statements.track':'all'},
      {'pgaudit.log':'role'}, {log_min_duration_statement:'0'}, {log_min_duration_sample:'0'},
      {log_transaction_sample_rate:'1'}, {log_parameter_max_length_on_error:'-1'}]) {
      const calls=[];
      const client={query: async sql => {calls.push(sql); return {rows:rows({...safe,...change})};}};
      assert.equal(await activateNewOwner(client,marker), 'protected_channel_unavailable');
      assert.equal(calls.length,1);
    }
    for (const name of Object.keys(safe).filter(n => !n.includes('.'))) {
      const reduced={...safe}; delete reduced[name]; assert.equal(loggingGate(rows(reduced)),false);
    }
  });
  await t.test('refused/absent status and synthetic query errors cannot commit or put secrets in SQL text', async () => {
    for (const outcome of ['activation_failed', undefined, 'throw']) {
      const calls=[];
      const client={query: async (sql,parameters) => {
        calls.push({sql,parameters});
        if(sql.includes('FROM pg_settings')) return {rows:rows(safe)};
        if(sql.startsWith('DO ') && outcome==='throw') throw Error(marker);
        return {rows: sql.includes(' AS status') ? [{status:outcome}] : []};
      }};
      assert.equal(await activateNewOwner(client,marker), outcome==='throw' ? 'activation_unavailable' : 'activation_refused');
      assert.equal(calls.at(-1).sql,'ROLLBACK');
      assert.equal(calls.some(c=>c.sql==='COMMIT'),false);
      assert.equal(calls.filter(c=>c.parameters).length,1);
      for(const c of calls) assert.equal(c.sql.includes(marker),false);
    }
  });
  await t.test('invalid stdin is sanitized before any pool connection', () => {
    for (const input of [marker, JSON.stringify({caPath:'bad',newOwnerPassword:marker,operatorPassword:marker}),
      JSON.stringify({caPath:path.join(path.dirname(root), 'evidence', 'supabase-public-ca-20261005.pem'),
        newOwnerPassword:'short',operatorPassword:marker})]) {
      const result=spawnSync(process.execPath,[file],{input,env:{PATH:process.env.PATH},encoding:'utf8',timeout:10000,maxBuffer:2048});
      assert.equal(result.error,undefined); assert.equal(result.status,1); assert.equal(result.stderr,'');
      assert.deepEqual(JSON.parse(result.stdout),{status:'activation_unavailable',providerCalls:0});
      assert.equal(result.stdout.includes(marker),false);
    }
  });
  assert.deepEqual(await readFile(file),before,'Candidate changed during QA review');
});
