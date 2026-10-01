// Offline XCTest bridge: loopback HTTP only, synthetic credentials, mocked upstream.
// Run alongside BackendRouteClientTests.testOfflineHTTPContract when explicitly enabled.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createOwnerPhoneTestSession } from './owner-phone-test-session.js';
import { createOwnerPhoneTestServer } from './owner-phone-test-server.js';
import { createOwnerProviderBudget } from './owner-phone-provider-budget.js';
import { createOwnerDiagnostics } from './owner-phone-diagnostics.js';

// Any accidental un-injected provider path must fail instead of using the network.
globalThis.fetch=async()=>{throw Error('Offline fixture forbids real provider traffic');};
let createServer=createOwnerPhoneTestServer;
if(process.argv.includes('--installed-revision')){
  const source=execFileSync('git',['show','826bfc7:backend/scripts/owner-phone-test-server.js'],{encoding:'utf8'})
    .replace(/from '([^']+)'/g,(_match,specifier)=>`from '${new URL(specifier,import.meta.url).href}'`);
  createServer=(await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'))).createOwnerPhoneTestServer;
}

const directory=fs.mkdtempSync('/private/tmp/wanderful-offline-contract-');
fs.chmodSync(directory,0o700);
const diagnostics=createOwnerDiagnostics(directory);
const env={NODE_ENV:'development',TRAILMIND_RELEASE_STAGE:'local',OWNER_PHONE_TEST_ENABLED:'true',
  INTENT_PROVIDER_ENABLED:'true',ROUTE_PROVIDER_ENABLED:'true',LLM_FIRST_PLANNING_ENABLED:'true',
  GRAPHHOPPER_API_KEY:'synthetic-offline-only',APP_ATTEST_ALLOW_IN_MEMORY:'false'};
const session=createOwnerPhoneTestSession({token:'A'.repeat(43),expiresAt:Date.now()+600000,env,maxRequests:4,maxCost:12});
let calls=0;
const budget=createOwnerProviderBudget({directory,acceptanceMode:true,limits:{google:1,graphhopper:2},diagnostic:diagnostics.record,
  fetchImpl:async(url,init)=>{
    assert.equal(new URL(url).origin,'https://graphhopper.com');
    const body=JSON.parse(init.body);
    assert.equal(body.profile,'foot');
    assert.equal(body.locale,'en');
    assert.deepEqual(body.points,[[13.3777,52.5163],[13.3501,52.5145]]);
    assert.equal(body.points_encoded,false);
    assert.equal(body.elevation,true);
    assert.equal(body.instructions,true);
    assert.equal(body['ch.disable'],true);
    assert.ok(body.custom_model.priority.length>0);
    if(calls===1){assert.equal(body.algorithm,'alternative_route');assert.equal(body['alternative_route.max_paths'],3);}
    else assert.equal(body.algorithm,undefined);
    calls++;
    return new Response(JSON.stringify({paths:[{distance:2100,time:1800000,ascend:10,descend:12,
      points:{type:'LineString',coordinates:[[13.3777,52.5163,35],[13.3639,52.5154,40],[13.3501,52.5145,33]]},
      instructions:[{text:'Continue',distance:2100,time:1800000,interval:[0,2],sign:0}],
      details:{surface:[[0,2,'paved']],road_class:[[0,2,'footway']],hike_rating:[]}}]}),{status:200});
  }});
const server=createServer({session,env,diagnostics,fetchImpl:budget.fetch,logger:diagnostics.logger});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(48175,'127.0.0.1',resolve);});
console.log('Offline contract fixture listening on 127.0.0.1:48175; upstream replaced by assertions.');
let stopping=false;
const stop=()=>{
  if(stopping)return;stopping=true;clearTimeout(timer);session.revoke();server.closeAllConnections();
  server.close(()=>{
    budget.close();diagnostics.close();
    console.log(fs.readFileSync(directory+'/owner-diagnostics.jsonl','utf8'));
    console.log(`Offline mocked GraphHopper calls: ${calls}`);
    if(calls!==2)process.exitCode=1;
    fs.rmSync(directory,{recursive:true,force:true});
  });
};
const timer=setTimeout(stop,600000);
process.once('SIGINT',stop);process.once('SIGTERM',stop);
