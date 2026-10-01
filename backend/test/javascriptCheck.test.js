import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {checkJavaScript} from '../scripts/check-javascript.js';

test('syntax gate checks later files and nested modules without executing them',()=>{
  const root=mkdtempSync(join(tmpdir(),'wanderful-syntax-'));
  try {
    mkdirSync(join(root,'src','nested'),{recursive:true});
    writeFileSync(join(root,'src','a.js'),'throw new Error("must not execute");');
    writeFileSync(join(root,'src','z.js'),'const broken = ;');
    writeFileSync(join(root,'src','nested','b.js'),'function broken( {');
    writeFileSync(join(root,'src','ignored.txt'),'not javascript');
    const result=checkJavaScript(root,['src']);
    assert.equal(result.checked,3);
    assert.deepEqual(result.failures,['src/nested/b.js','src/z.js']);
  } finally {rmSync(root,{recursive:true,force:true});}
});
