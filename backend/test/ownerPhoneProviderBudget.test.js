import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createOwnerProviderBudget } from '../scripts/owner-phone-provider-budget.js';
const google='https://generativelanguage.googleapis.com/v1beta/interactions';
const gh='https://graphhopper.com/api/1/route';
const init={method:'POST',body:JSON.stringify({model:'gemini-3.8-flash'})};
function fixture(t, fetchImpl) {
  const directory=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'owner-budget-'));
  fs.chmodSync(directory,0o700);
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  return {directory,fetchImpl};
}
test('attempt caps persist across restart and exclusive owner prevents duplicates',async t=>{
  let calls=0;
  const options=fixture(t,async(_,request)=>{calls++;assert.equal(request.redirect,'manual');return {status:200};});
  let budget=createOwnerProviderBudget(options);
  assert.throws(()=>createOwnerProviderBudget(options));
  for(let i=0;i<3;i++) await budget.fetch(google,init);
  budget.close();budget=createOwnerProviderBudget(options);
  for(let i=0;i<2;i++) await budget.fetch(google,init);
  await assert.rejects(budget.fetch(google,init));
  for(let i=0;i<10;i++) await budget.fetch(gh,init);
  await assert.rejects(budget.fetch(gh,init));
  assert.equal(calls,15);assert.deepEqual(budget.remaining(),{google:0,graphhopper:0,stopped:false});budget.close();
});
test('network failures consume attempts; incorrect model/endpoint/cancel do not',async t=>{
  const options=fixture(t,async()=>{throw Error('sensitive upstream detail');});
  const budget=createOwnerProviderBudget(options);
  for(const [url,request] of [['https://example.com',init],[google,{...init,body:'{"model":"other"}'}],[google,{...init,signal:AbortSignal.abort()}]]) await assert.rejects(budget.fetch(url,request));
  assert.equal(budget.remaining().google,5);
  await assert.rejects(budget.fetch(google,init),{message:'private_provider_unavailable'});
  assert.equal(budget.remaining().google,4);budget.close();
});
test('reservations precede IO, stateless model is pinned, access denial stops both providers',async t=>{
  let options;
  options=fixture(t,async(_,request)=>{
    assert.equal(JSON.parse(fs.readFileSync(path.join(options.directory,'provider-budget.json'))).google,1);
    assert.equal(JSON.parse(request.body).store,false);
    return {status:403};
  });
  let budget=createOwnerProviderBudget(options);await budget.fetch(google,init);budget.close();
  budget=createOwnerProviderBudget(options);await assert.rejects(budget.fetch(gh,init));assert.equal(budget.remaining().stopped,true);budget.close();
});
test('second rate limit blocks further calls durably',async t=>{
  const options=fixture(t,async()=>({status:429}));const budget=createOwnerProviderBudget(options);
  await budget.fetch(gh,init);await budget.fetch(gh,init);await assert.rejects(budget.fetch(google,init));budget.close();
});
test('fresh smaller2/2 caps persist; mixed internal requests and retries cannot expand them',async t=>{
  let calls=0;
  const options={...fixture(t,async()=>{calls++;return {status:200};}),limits:{google:2,graphhopper:2}};
  let budget=createOwnerProviderBudget(options);
  await budget.fetch(google,init); // initial parse
  await budget.fetch(google,init); // itinerary selection
  await Promise.all([budget.fetch(gh,init),budget.fetch(gh,init)]);
  await assert.rejects(budget.fetch(gh,init));
  await assert.rejects(budget.fetch(google,init));
  await assert.rejects(budget.fetch('https://graphhopper.com/api/1/geocode',{method:'GET'}));
  assert.equal(calls,4);budget.close();
  assert.throws(()=>createOwnerProviderBudget({...options,limits:{google:5,graphhopper:10}}));
  budget=createOwnerProviderBudget(options);
  assert.deepEqual(budget.remaining(),{google:0,graphhopper:0,stopped:false});budget.close();
});

test('explicit dynamic allowance accounts for sources durably and cannot upgrade a historical ledger',async t=>{
  let calls=0;
  const base=fixture(t,async()=>{calls++;return {status:200};});
  const historical=createOwnerProviderBudget({...base,limits:{google:2,graphhopper:2}});historical.close();
  const limits={google:9,graphhopper:3,osm:2,wikidata:4,commons:2};
  assert.throws(()=>createOwnerProviderBudget({...base,dynamicResearch:true,limits}));
  assert.equal(JSON.parse(fs.readFileSync(path.join(base.directory,'provider-budget.json'))).version,1);
  const fresh=fixture(t,async()=>{calls++;return {status:200};});
  let budget=createOwnerProviderBudget({...fresh,dynamicResearch:true,limits});
  const osm='https://overpass-api.de/api/interpreter';
  await budget.fetch(osm,{method:'POST',body:'data=offline-fixture'});
  await budget.fetch('https://www.wikidata.org/wiki/Special:EntityData/Q123.json',{});
  budget.close();
  budget=createOwnerProviderBudget({...fresh,dynamicResearch:true,limits});
  assert.equal(budget.remaining().osm,1);assert.equal(budget.remaining().wikidata,3);
  await budget.fetch(osm,{method:'POST',body:'data=offline-fixture'});
  await assert.rejects(budget.fetch(osm,{method:'POST'}));
  await assert.rejects(budget.fetch('https://commons.wikimedia.org/w/api.php?action=edit',{}));
  assert.equal(calls,3);budget.close();
});

test('current allowances do not implicitly authorize billed built-in grounding tools',async t=>{
 let calls=0;const options=fixture(t,async()=>{calls++;return {status:200};});
 const budget=createOwnerProviderBudget({...options,dynamicResearch:true,limits:{google:9,graphhopper:3,osm:2,wikidata:4,commons:2}});
 for(const type of ['google_search','url_context','google_maps']) {
  await assert.rejects(budget.fetch(google,{method:'POST',body:JSON.stringify({model:'gemini-3.8-flash',tools:[{type}]})}),{message:'private_grounding_not_authorized'});
 }
 assert.equal(calls,0);assert.equal(budget.remaining().google,9);budget.close();
});

test('grounding-enabled requests require an explicit separate cap and reserve both counters before IO',async t=>{
 let options,calls=0;
 options=fixture(t,async()=>{
  calls++;const state=JSON.parse(fs.readFileSync(path.join(options.directory,'provider-budget.json')));
  assert.equal(state.google,calls);assert.equal(state.grounding,calls);return {status:200};
 });
 const limits={google:9,graphhopper:3,osm:2,wikidata:4,commons:2,grounding:1};
 let budget=createOwnerProviderBudget({...options,dynamicResearch:true,limits});
 const grounded={method:'POST',body:JSON.stringify({model:'gemini-3.8-flash',tools:[{type:'google_search',search_types:['web_search']},{type:'url_context'}]})};
 await budget.fetch(google,grounded);budget.close();
 budget=createOwnerProviderBudget({...options,dynamicResearch:true,limits});
 await assert.rejects(budget.fetch(google,grounded),{message:'private_budget_exhausted'});
 assert.equal(budget.remaining().google,8);assert.equal(budget.remaining().grounding,0);budget.close();
 assert.throws(()=>createOwnerProviderBudget({...options,dynamicResearch:true,limits:{...limits,grounding:2}}));
 assert.equal(calls,1);
});
