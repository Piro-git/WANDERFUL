# Durable dynamic-research release lane

The schema-3 endpoint, POST /api/llm-plan-route, is the worldwide
research-led path. It uses the configured LLM to select real mapped places,
requires OSM identities for selected stops, and asks GraphHopper for every
route geometry, distance, duration, and elevation figure. A GraphHopper result
does not establish trail access, current conditions, safety, water, legality,
or the availability of a named attraction.

## Durable admission

The former short-lived pilot expiry is not a release control. A deployment now
requires all of the following, and fails closed before provider work when any
item is absent or inconsistent:

- a named operator approval (DYNAMIC_RESEARCH_BUDGET_APPROVAL_ID);
- DYNAMIC_RESEARCH_DAILY_REQUEST_LIMIT from 1 through 10;
- daily (86400) global and installation windows;
- global and installation cost ceilings that are whole multiples of 12 and do
  not exceed the declared request limit times 12;
- the existing durable App Attest repository, replay protection, one-request
  concurrency setting, and bounded provider/route deadlines.

One admitted research request consumes 12 durable route-cost units. The service
emits dynamic_research_admitted with only bucketed cost and cap values; it does
not log prompts, names, coordinates, geometry, tokens, credentials, or
provider response bodies.

The request-level upper bounds remain enforced in code: at most five
GraphHopper route attempts, twenty model/tool calls, three named intermediate
stops, and a 150-second total research deadline. These are request-count
bounds, not a monetary quote. Provider billing limits must remain configured in
the provider account.

## Host and native handoff

Use a permanent HTTPS host with a durable Postgres/App-Attest role and deploy
only after /healthz returns live and /readyz returns ready. The Vercel entry
function is explicitly capped at 180 seconds, which contains the service's
150-second research deadline without relying on a platform default. It runs the
same production-configuration admission gate before accepting protected
requests; /healthz remains a liveness probe while /readyz remains 503 until
that gate is ready. Keep the GraphHopper and LLM credentials exclusively in
host secret storage. The native
configuration must be generated through
backend/scripts/configure-research-app.js after the deployment receipt is
recorded; do not embed a host, key, or tunnel URL in Swift.

Do not deploy against a broad inherited database credential. Provision a
least-privilege App-Attest database role and add its connection string, plus
the LLM and GraphHopper credentials, as encrypted host secrets before a first
release. The existing account or project alone is not deployment readiness.
