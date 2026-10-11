# Live-routing handoff

## Isolated delivery

- Path: /Users/REDACTED/Library/Application Support/Wanderful-Recovery/release-wave-20260915/live-routing
- Branch: codex/live-routing-20260915
- Base: 3aae5e19ec83b43196295e2dc3e98085e64046f0
- Status: implementation and local targeted verification complete; no HTTPS host was discoverable or deployable from this checkout.

## What changed

Dynamic research no longer depends on the old 24-hour test expiry. It now fails
closed unless a named approval, a 1-10 daily request cap, daily durable App
Attest windows, and matching integral cost caps are configured. One request
consumes 12 route-cost units. Durable App Attest session/replay/installation/
global limits and provider timeouts remain mandatory.

The endpoint emits a filtered dynamic_research_admitted event with bucketed
cost/cap information only. Prompts, names, coordinates, route geometry,
provider responses, and credentials stay out of operational events.

The dynamic path is schema-3 POST /api/llm-plan-route. It has world-wide mapped
place lookup, requires selected OSM stop identities, propagates available
Wikidata IDs for the already-reviewed Commons resolver, and uses GraphHopper
for geometry and measured route facts. It does not make access, safety, weather,
water, legality, or attraction-availability guarantees.

## Integration configuration

On a permanent HTTPS host, keep all secrets in host storage and set:

- NODE_ENV=production; TRAILMIND_RELEASE_STAGE=staging;
  TRAILMIND_RUNTIME_PROFILE=dynamic-research-v1
- DYNAMIC_RESEARCH_ENABLED=true; DYNAMIC_WEB_RESEARCH_ENABLED=true;
  LLM_FIRST_PLANNING_ENABLED=true; INTENT_PROVIDER_ENABLED=true;
  ROUTE_PROVIDER_ENABLED=true
- DYNAMIC_RESEARCH_DAILY_REQUEST_LIMIT=N (1 through 10);
  ROUTE_GLOBAL_MAX_COST and APP_ATTEST_INSTALLATION_MAX_COST must each be
  whole multiples of 12 and no greater than 12*N
- ROUTE_GLOBAL_WINDOW_SECONDS=86400 and
  APP_ATTEST_INSTALLATION_WINDOW_SECONDS=86400
- preserve every existing exact-false insecure flag, durable App Attest
  database role, request replay protection, and one-request concurrency.

Health evidence must be GET /healthz live plus GET /readyz ready before
generating the native host configuration using
backend/scripts/configure-research-app.js. Do not set a host in Swift without a
deployment receipt.

## Evidence and remaining external blocker

- node --test backend/test/dynamicResearchAllowance.test.js: 3/3 passed.
- npm --prefix backend run build: 368 JavaScript files checked, no failures.
- Direct budget/event check passed; event filtering excluded sentinel prompt and
  coordinate fields.
- The broader dynamic native and durable integration suites cannot load in this
  independent clone because pg/asn1js are absent. No dependency install was
  started due the 2.4 GB free-space limit and coordination rule.
- No gcloud, Render, or Vercel CLI/account linkage was present; two Vercel
  identity checks did not complete past package acquisition. Therefore Google
  billing linkage, a permanent host, and a live provider matrix cannot be
  claimed. This is an external hosting/account-access blocker, not a 429
  diagnosis.
