import test from 'node:test';
import assert from 'node:assert/strict';
import {scramVerifier,loggingGate,activateNewOwner,ACTIVATION_DO} from './activate-owner-credential-input.mjs';
const settings=()=>Object.entries({log_statement:'ddl',log_min_duration_statement:'-1',log_min_duration_sample:'-1',log_transaction_sample_rate:'0',log_parameter_max_length_on_error:'0','pgaudit.log':'none','pg_stat_statements.track':'top'}).map(([name,setting])=>({name,setting}));
test('actual Supabase logging shape permits bound top-level handoff, rejects any credential-query logging',()=>{
 assert.equal(loggingGate(settings()),true);
 for(const [name,setting] of [['log_statement','all'],['log_min_duration_statement','0'],['log_min_duration_sample','0'],['log_transaction_sample_rate','1'],['log_parameter_max_length_on_error','-1'],['pgaudit.log','role'],['pg_stat_statements.track','all']])assert.equal(loggingGate(settings().map(r=>r.name===name?{name,setting}:r)),false);
});
test('SCRAM builder accepts printable password-manager values and refuses control/non-ASCII without returning values',()=>{
 assert.match(scramVerifier('PUBLIC_SYNTHETIC_TEST_PASSWORD_ONLY',Buffer.alloc(16)),/^SCRAM-SHA-256\$4096:[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
 for(const password of ['short','a'.repeat(520),'passwordwithline\nlongenough','nonASCIIépasswordlongenough'])assert.throws(()=>scramVerifier(password),/invalid_owner_password/);
});
test('reservation-like activation refuses unsafe logs before any verifier parameter or role DDL',async()=>{
 const calls=[];const client={async query(sql){calls.push(sql);return {rows:settings().map(r=>r.name==='log_statement'?{...r,setting:'all'}:r)};}};
 assert.equal(await activateNewOwner(client,'PUBLIC_SYNTHETIC_TEST_PASSWORD_ONLY'),'protected_channel_unavailable');assert.equal(calls.length,1);
});
test('safe activation binds verifier once, fixed role only, commits only explicit success and rolls back failures',async()=>{
 for(const outcome of ['role_activated','activation_failed']){
  const calls=[];const client={async query(sql,parameters){calls.push({sql,parameters});if(sql.includes('FROM pg_settings'))return {rows:settings()};if(sql.includes(' AS status'))return {rows:[{status:outcome}]};return {rows:[]};}};
  assert.equal(await activateNewOwner(client,'PUBLIC_SYNTHETIC_TEST_PASSWORD_ONLY'),outcome==='role_activated'?'role_activated':'activation_refused');
  assert.equal(calls.at(-1).sql,outcome==='role_activated'?'COMMIT':'ROLLBACK');
  const bound=calls.filter(c=>c.parameters);assert.equal(bound.length,1);assert.ok(bound[0].sql.includes('$1'));assert.ok(!calls.some(c=>c.sql.includes(bound[0].parameters[0])));
  assert.ok(ACTIVATION_DO.includes('rolpassword IS NULL'));assert.ok(ACTIVATION_DO.includes('EXCEPTION WHEN OTHERS'));assert.ok(!ACTIVATION_DO.includes('CREATE FUNCTION'));
 }
});
