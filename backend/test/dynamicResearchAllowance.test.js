import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {assertDynamicResearchBudget} from '../src/operations/dynamicResearchBudget.js';
import {createRouteSessionAuthorizer, createIntentSessionAuthorizer} from '../src/appAttest/routeSessionAuthorizer.js';

const start = Date.parse('2026-09-09T12:00:00.000Z');
const settings = () => ({
  NODE_ENV:'production', DYNAMIC_RESEARCH_ENABLED:'true',
  DYNAMIC_RESEARCH_BUDGET_APPROVAL_ID:'release-wave-20260915',
  DYNAMIC_RESEARCH_DAILY_REQUEST_LIMIT:'1',
  ROUTE_GLOBAL_MAX_COST:'12', APP_ATTEST_INSTALLATION_MAX_COST:'12',
  ROUTE_GLOBAL_WINDOW_SECONDS:'86400', APP_ATTEST_INSTALLATION_WINDOW_SECONDS:'86400',
  ROUTE_PROVIDER_ENABLED:'true', INTENT_PROVIDER_ENABLED:'true'
});
const request = () => ({headers:{authorization:`TrailMindRouteSession ${Buffer.alloc(32,1).toString('base64url')}`,'x-trailmind-request-id':randomUUID()},cost:12});

test('durable release budget requires an explicit daily cap backed by cost windows', () => {
  assert.doesNotThrow(()=>assertDynamicResearchBudget(settings()));
  for (const changes of [
    {DYNAMIC_RESEARCH_DAILY_REQUEST_LIMIT:undefined},
    {DYNAMIC_RESEARCH_DAILY_REQUEST_LIMIT:'11'},
    {ROUTE_GLOBAL_MAX_COST:'13'},
    {APP_ATTEST_INSTALLATION_MAX_COST:'24'},
    {ROUTE_GLOBAL_WINDOW_SECONDS:'3600'}
  ]) assert.throws(()=>assertDynamicResearchBudget({...settings(),...changes}));
  assert.doesNotThrow(()=>assertDynamicResearchBudget({DYNAMIC_RESEARCH_ENABLED:'false'}));
});

for (const [scope, factory, leaseMs] of [['route',createRouteSessionAuthorizer,180000],['intent',createIntentSessionAuthorizer,60000]]) {
  test(`${scope}: a running process rejects expiry before repository/provider admission`,async()=>{
    let now = start;
    let consumed = 0;
    let released = 0;
    const repository = {isDurable:true,async consumeRouteAccess(){consumed++;return {installationId:'fixture',leaseId:'fixture',remainingCost:0};},async releaseRouteLease(){released++;}};
    const authorizer=factory({env:settings(),repository,now:()=>now});
    const access=await authorizer.authorize(request());
    assert.equal(consumed,1);
    now = start+3600000-leaseMs;
    const renewed=await authorizer.authorize(request());
    await renewed.release();
    now = start+86400000;
    const restarted=factory({env:settings(),repository,now:()=>now});
    const afterDay=await restarted.authorize(request());
    await afterDay.release();
    assert.equal(consumed,3);
    await access.release();
    assert.equal(released,3);
  });
}
