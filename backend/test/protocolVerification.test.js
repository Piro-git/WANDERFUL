import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {runReviewedProtocolVerification} from '../scripts/runReviewedProtocolVerification.js';
import {researchResponseSummary} from '../src/dynamicResearch/researchProtocol.js';
import {createGeminiWebResearch} from '../src/dynamicResearch/webResearch.js';
import {PROTOCOL_INPUT_SHA256} from '../src/ownerAccess/protocolVerificationRequest.js';
import {prepareProtocolVerification} from '../../docs/operations/research-protocol-verification-20261013/prepareProtocolVerification.mjs';
test('inactive import/ordinary build and wrong active context cannot read secrets, connect or fetch',async()=>{
 let touched=false;class Pool{constructor(){touched=true;throw Error('must not connect');}}
 assert.deepEqual(await runReviewedProtocolVerification({env:{},Pool,fetchImpl:()=>{touched=true;}}),{ran:false});
 for(const env of [{WANDERFUL_PROTOCOL_VERIFICATION:'approved_research_once',VERCEL_ENV:'preview'},{WANDERFUL_PROTOCOL_VERIFICATION:'approved_research_once',VERCEL_ENV:'production',OWNER_ACCESS_ENABLED:'true'}])await assert.rejects(runReviewedProtocolVerification({env,Pool,fetchImpl:()=>{touched=true;}}));assert.equal(touched,false);
});
test('response observer sees only frozen closed status/counts and cannot affect adapter outcome',async()=>{
 const marker='SYNTHETIC_SECRET_NAME_ARGS_BODY_URL_SIGNATURE',shape=researchResponseSummary({status:'requires_action',steps:[{type:'function_call',name:marker,id:marker,arguments:{private:marker}},{type:'thought',signature:marker},{type:'model_output',content:[{type:'text',text:marker,annotations:[{type:'url_citation',url:marker}]}]}],usage:{total_tokens:100,private:marker}},[{type:'google_search'},{type:'url_context'}]);assert.equal(shape.pendingOther,1);assert.equal(shape.totalTokens,100);assert.ok(Object.isFrozen(shape));assert.ok(!JSON.stringify(shape).includes(marker));
 for(const v of [Infinity,1000001,1.5,marker])assert.equal(researchResponseSummary({usage:{total_tokens:v}},[]).totalTokens,null);
 const records=[];let calls=0;const fn=createGeminiWebResearch({apiKey:'offline-only',model:'gemini-3.8-flash',observeResponse:s=>{records.push(s);throw Error(marker);},fetchImpl:async()=>{calls++;return Response.json({status:'requires_action',steps:[]});}});await assert.rejects(fn({prompt:'Public request',locationName:'Public location'}),{code:'web_research_unverified',privateResearchProviderStatus:'requires_action'});assert.equal(calls,1);assert.equal(records[0].status,'requires_action');
});
test('proposal generator fixes exact body/source/key/expiry and never renews spent native admission',()=>{
 const now=Date.parse('2026-10-13T00:00:00Z'),p={approvalSHA256:'a'.repeat(64),backendTree:'b'.repeat(40),inputSHA256:PROTOCOL_INPUT_SHA256,keyId:'A'.repeat(43),origin:'https://backend-zeta-amber-69.vercel.app',expiresAtUTC:'2026-10-13T00:05:00.000Z'};const v=prepareProtocolVerification(p,{now});assert.equal(v.executed,false);assert.equal(v.maximumGoogle,2);assert.equal(v.nativeCalls,0);assert.ok(v.sql.includes('g<>10'));assert.ok(v.sql.includes('intent_used=1 AND requests_used=1 AND google_used=3'));assert.equal(v.buildOverrides.WANDERFUL_PROTOCOL_INPUT_SHA256,PROTOCOL_INPUT_SHA256);
 for(const patch of [{expiresAtUTC:'2026-10-12T23:59:59.000Z'},{expiresAtUTC:'2026-10-13T00:11:00.000Z'},{inputSHA256:'c'.repeat(64)},{keyId:"'invalid"},{backendTree:'wrong'}])assert.throws(()=>prepareProtocolVerification({...p,...patch},{now}));
});
test('only an explicitly selected one-off config has provider execution; normal package/config stay unchanged',()=>{
 const pkg=JSON.parse(readFileSync(new URL('../package.json',import.meta.url))),normal=JSON.parse(readFileSync(new URL('../vercel.json',import.meta.url))),one=JSON.parse(readFileSync(new URL('../../docs/operations/research-protocol-verification-20261013/vercel.protocol-verification.proposal.json',import.meta.url)));assert.equal(pkg.scripts.build,'node scripts/check-javascript.js');assert.equal(normal.buildCommand,undefined);assert.ok(one.buildCommand.startsWith('node scripts/runReviewedProtocolVerification.js && npm run build'));assert.equal(normal.functions['api/index.js'].maxDuration,one.functions['api/index.js'].maxDuration);
});
