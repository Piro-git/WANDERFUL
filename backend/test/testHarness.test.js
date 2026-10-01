import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,relative} from 'node:path';
import {discoverTestFiles,runBackendTests} from '../scripts/run-tests.js';

test('official harness includes nested tests and excludes operational CLIs',()=>{
  const root=mkdtempSync(join(tmpdir(),'wanderful-harness-'));
  try {
    mkdirSync(join(root,'test','nested'),{recursive:true});
    mkdirSync(join(root,'scripts'));
    writeFileSync(join(root,'test','first.test.js'),"require('node:test')('first',()=>{});");
    writeFileSync(join(root,'test','nested','second.test.js'),"require('node:test')('nested',()=>{});");
    writeFileSync(join(root,'scripts','start-owner-phone-test.js'),"throw new Error('must-never-run-owner-cli');");
    assert.deepEqual(discoverTestFiles(root).map(p=>relative(root,p)),['test/first.test.js','test/nested/second.test.js']);
    const pass=runBackendTests(root,{stdio:'pipe'});
    assert.equal(pass.status,0,pass.stderr);
    assert.match(pass.stdout,/# pass 2/);
    assert.doesNotMatch(pass.stdout+pass.stderr,/must-never-run-owner-cli/);
    writeFileSync(join(root,'test','nested','second.test.js'),"require('node:test')('nested',()=>{throw new Error('expected regression');});");
    const fail=runBackendTests(root,{stdio:'pipe'});
    assert.notEqual(fail.status,0);
    assert.match(fail.stdout,/# fail 1/);
  } finally {rmSync(root,{recursive:true,force:true});}
});

test('empty test directory fails closed rather than falling back to broad discovery',()=>{
  const root=mkdtempSync(join(tmpdir(),'wanderful-empty-harness-'));
  try {mkdirSync(join(root,'test'));assert.throws(()=>discoverTestFiles(root),/backend_test_files_missing/);}
  finally {rmSync(root,{recursive:true,force:true});}
});
