# TrailMind Engine Staging Activation V1

Status: **CODE AND CONFIGURATION READY; NO LIVE ACTIVATION PERFORMED**

This is the activation handoff for the backend route-research engine. It does
not authorize a deployment, database mutation, regional import, provider call,
or iOS connection. All tracked capability flags remain `false`.

## Readiness classification

### IMPLEMENTED

- `POST /api/outdoor-research/plan-route` accepts only the strict structured
  request contract. `schemaVersion: 2` selects the routable-highlight path;
  raw prompts and client-supplied dossiers are rejected.
- The V2 orchestrator validates the structured intent, builds the bounded
  research plan, resolves a consistent PostGIS evidence snapshot, validates
  the dossier, builds the V2 candidate envelope with V3 loop-product shaping,
  calls the bounded GraphHopper adapter, and emits V2 routed alternatives.
- The V3 implementation is intentionally nested under the public V2 candidate
  policy. `researchGuidedRouteCandidatePlannerV2.js` invokes
  `shapeResearchGuidedLoopSourceProposalV3`; the wire contract remains
  `research-guided-route-candidates-v2`.
- The existing iOS consumer, left untouched by this sprint, sends schema V2
  only when its routable-highlight gate is enabled, strictly validates the V2
  envelope, converts it, and runs `RouteAlternativeQuality.select` before
  presenting alternatives.
- The production repository binds staging reads to the private
  `trailmind_app` schema and its five migration-009 `SECURITY DEFINER`
  functions. It does not read base research tables.
- Query cancellation uses the one-connection
  `outdoor_research_cancellation_control_role` and only
  `trailmind_control.cancel_active_outdoor_research_backend_integer(integer)`;
  it no longer requires direct `pg_cancel_backend` authority.
- Startup probes App Attest, outdoor-research runtime, and cancellation roles
  before binding the HTTP listener. Later database failure removes readiness
  and gates application work. Provider circuit state independently controls
  readiness.
- Request/body/response limits, total/research/provider deadlines, global and
  session cost limits, provider concurrency, GraphHopper response limits,
  circuit breaking, client-disconnect cancellation, PostgreSQL statement
  cancellation, drain deadlines, and privacy-safe allowlisted logging are
  enforced in the production composition.
- `render.yaml` targets `main`, keeps automatic deploys off, declares only one
  Render Free service, exposes `/healthz`, maps the activation inputs, pins
  `ROUTE_GLOBAL_MAX_CONCURRENCY=16` under the fixed 64 MiB provider-response
  admission ceiling, and leaves all capability flags `false`.
- Activation secrets may be populated while capability flags remain `false`.
  Their project, TLS, role, and separation constraints are still validated.
  This makes the three flags a real rollback switch.

### CONFIGURATION ONLY

- Render has no verified deployed backend URL in source. A generated HTTPS URL
  becomes usable only after an independently reviewed deployment receipt.
- The GraphHopper key, Supabase URLs, CA file, project identity hash, App
  Attest identity, accepted validation categories, and accepted build versions
  are operator inputs. No value was read, generated, or committed here.
- The Harz import, active projection generation, capacity headroom, and staging
  query plans are owned by the separate Supabase V2 initialization/import
  lane.
- The iOS staging gate must stay disconnected until the deployed backend and
  golden smoke set are green.

### MISSING OR BLOCKING EXTERNAL EVIDENCE

- The authoritative disposable Supabase-semantic V2 harness still needs the
  official PostgreSQL 17 `supautils` library supplied via the existing
  protected operator environment. On this machine the harness exited before
  database creation because that binary was absent. Do not count that run
  green and do not substitute migration 008.
- Staging still needs the approved V2 database sequence: pre-migration setup,
  migrations `001` through `007`, migration `009`, migration `010`, and the
  post-migration proof. Migration `008` is prohibited for this target.
- A current bounded Harz import/projection, a real GraphHopper credential, a
  deployed HTTPS receipt, production App Attest values, and the post-deploy
  golden request set do not yet exist in this task.

These are external activation prerequisites, not permission to weaken startup
admission or use an owner/service-role connection.

## Verified production path

```text
authorized schema-V2 POST /api/outdoor-research/plan-route
  -> strict structured AdventureResearchIntent validation
  -> bounded outdoor research plan
  -> consistent PostGIS snapshot through five trailmind_app functions
  -> evidence-backed dossier plus explicit planning gaps
  -> research-guided-route-candidates-v2 envelope
       -> V3/V3.1 loop selection, distance, corridor and topology shaping
  -> research-guided-routing-adapter-v2
  -> bounded GraphHopper POST /route
  -> provider-verified routed alternatives and limitations
  -> strict V2 response validation
  -> existing iOS V2 decoder/converter
  -> RouteAlternativeQuality.select
```

One fresh disposable PostgreSQL 17/PostGIS run executed this HTTP composition
with seeded Harz evidence and a deterministic GraphHopper-shaped fake. The
suite passed 30/30, including the composed V2/V3 case, execute-only database
access, denied base-table/DDL privileges, spatial indexes, deterministic
selection, statement timeout, cancellation, and rollback. The fake performed
no external network call and accepted only the same GraphHopper request shape
used in production (`foot`, instructions, unencoded geometry, bounded calls).

The surrounding negative suite already covers feature-off, database
unavailable, provider unavailable/failure, malformed evidence/response,
cancellation, no viable route, rate limiting, body/response bounds, circuit
opening, late work during drain, and startup admission failure.

## Exact V2 database boundary

The initial staging runtime must use these exact identities and surfaces:

| Responsibility | Required identity/surface | Explicitly denied |
| --- | --- | --- |
| App Attest runtime | `app_security_runtime_role` in `trailmind_app` | Research data, DDL, owner/operator work |
| Outdoor research | `outdoor_research_runtime_role`; execute exactly the five `trailmind_app.trailmind_runtime_outdoor_research_*_v1` functions | Base tables/views, writes, sequences, DDL, role changes, public/extensions/GIS schema use |
| Research cancellation | `outdoor_research_cancellation_control_role`; execute only `trailmind_control.cancel_active_outdoor_research_backend_integer(integer)` | Product reads, arbitrary backend cancellation, DDL, other schemas |
| Migration | `migration_role`, used only by the separate operator lane | Web-process injection and request traffic |
| App Attest pruning | `pruner_role`, used only by the separate control job | Web-process injection and research data |

Startup requires exact role attributes, no inherited memberships, fixed search
paths, TLS `verify-full`, the approved project-ref SHA-256, no base relation or
sequence privileges, exact function ownership/security/search paths, no
`PUBLIC` execute, and no unexpected executable function in `trailmind_app`.

## Environment and secret checklist

Public fixed configuration:

- `NODE_ENV=production`
- `TRAILMIND_RELEASE_STAGE=staging`
- `TRAILMIND_APPLICATION_SCHEMA=trailmind_app`
- `APP_ATTEST_RUNTIME_ROLE=app_security_runtime_role`
- `APP_ATTEST_CONTROL_ROLE=pruner_role`
- `APP_ATTEST_OPERATOR_ROLE=migration_role`
- `APP_ATTEST_ENVIRONMENT=production`
- `GRAPHHOPPER_BASE_URL=https://graphhopper.com/api/1`
- `ROUTE_GLOBAL_MAX_CONCURRENCY=16`

Operator-supplied values, injected only through Render/Supabase secret or
configuration boundaries:

- `TRAILMIND_STAGING_PROJECT_REF_SHA256`: lowercase SHA-256 of the approved
  20-character staging project ref; never the production-project digest.
- `APP_ATTEST_DATABASE_URL`: role `app_security_runtime_role` on that project.
- `OUTDOOR_RESEARCH_DATABASE_URL`: role
  `outdoor_research_runtime_role` on the same project.
- `OUTDOOR_RESEARCH_CANCELLATION_DATABASE_URL`: role
  `outdoor_research_cancellation_control_role` on the same project and a
  distinct connection string.
- `GRAPHHOPPER_API_KEY`: backend-only real staging credential.
- `APP_ATTEST_APP_ID_PREFIX`, `APP_ATTEST_BUNDLE_ID`,
  `APP_ATTEST_ALLOWED_VALIDATION_CATEGORIES`, and
  `APP_ATTEST_ALLOWED_BUNDLE_VERSIONS`: approved staging build identity.
- Supabase CA secret file mounted under `/etc/secrets/` with a `.crt` name.
  Every database URL must contain only `sslmode=verify-full` and
  `sslrootcert=/etc/secrets/<approved-name>.crt`, use port 5432, and end at
  `/postgres`.

`OUTDOOR_EVIDENCE_DATABASE_URL` is mapped for a future dedicated evidence
runtime but is not part of the initial research activation. Leave it empty and
keep `OUTDOOR_EVIDENCE_PROVIDER_ENABLED=false` until that role and endpoint
have their own reviewed admission proof.

Always keep these exact `false`:

- `INTENT_PROVIDER_ENABLED`
- `OUTDOOR_EVIDENCE_PROVIDER_ENABLED` for this activation
- `ROUTE_ALLOW_INSECURE_LOCAL_ROUTING`
- `INTENT_ALLOW_INSECURE_LOCAL_PARSING`
- `INTENT_ALLOW_DETERMINISTIC_MOCK`
- `OUTDOOR_RESEARCH_PLANNING_ALLOW_INSECURE_LOCAL`
- `APP_ATTEST_ALLOW_IN_MEMORY`

The activation switch is the following coherent flag set:

```text
ROUTE_PROVIDER_ENABLED=true
OUTDOOR_RESEARCH_PLANNING_ENABLED=true
OUTDOOR_ROUTABLE_HIGHLIGHT_ACCESS_ENABLED=true
```

Research cannot be enabled without routing; routable-highlight access cannot
be enabled without research. Apply the three values atomically in one manual
staging configuration update. Tracked source remains `false` for all three.

## Safe activation order

1. In the separately owned Supabase lane, prove the exact staging project and
   Free-plan headroom. Supply official PostgreSQL 17 `supautils`, run the fresh
   authoritative disposable V2 harness, then apply only pre-migration,
   `001`–`007`, `009`, `010`, and post-migration on staging. Stop if migration
   `008` appears anywhere in the target ledger.
2. Complete the bounded Harz import/projection and verify current active
   generation, provenance, quarantine, indexes, plans, cancellation, logical
   backup, and restore evidence. Keep all provider/research/access flags false.
3. Merge the reviewed backend commit to `main`. Create or update the one
   Frankfurt Render Free service from `render.yaml`; automatic deployment must
   remain off.
4. Populate the approved CA, App Attest configuration, staging project hash,
   three database URLs, and GraphHopper key while the three activation flags
   remain false. Admission validates staged credentials even while disabled.
5. Manually deploy the disabled configuration. Require exact application
   responses `200 {"status":"live"}` from `/healthz` and
   `200 {"status":"ready"}` from `/readyz`. A platform loading page is not a
   pass. Confirm disabled capability events and zero provider work.
6. Atomically set the three activation flags to `true` and manually redeploy.
   Startup must prove all three database roles before listen. Require liveness
   and readiness again.
7. Use a physical staging build to obtain a production-environment App Attest
   route session. Do not use an insecure bypass or manually mint a token.
8. Run the bounded Harz schema-V2 smoke below, then the approved golden set.
   Record only commit/deploy IDs and coarse outcomes. Never retain tokens,
   prompts, coordinates, geometry, database/provider values, assertion bodies,
   or raw provider errors.
9. Only after the golden set, provider budget/circuit observations, privacy-log
   review, cold-start check, and rollback drill are green may the separate iOS
   release lane connect its staging base URL.

## Smoke protocol

Liveness and readiness are safe unauthenticated checks:

```sh
curl --fail --silent --show-error \
  "$TRAILMIND_STAGING_BASE_URL/healthz"
curl --fail --silent --show-error \
  "$TRAILMIND_STAGING_BASE_URL/readyz"
```

The planning smoke requires a fresh App Attest route-session token and fresh
UUID from the approved physical staging build. Do not put either in source,
logs, a receipt, or shell history. The structured request contains no raw
prompt and makes no scenic, access, water, legal, or safety guarantee:

```sh
curl --fail --silent --show-error \
  --request POST \
  --header 'Content-Type: application/json' \
  --header 'Accept: application/json' \
  --header "Authorization: TrailMindRouteSession $TRAILMIND_ROUTE_SESSION_TOKEN" \
  --header "X-TrailMind-Request-ID: $TRAILMIND_REQUEST_ID" \
  --data '{
    "schemaVersion": 2,
    "intent": {
      "schemaVersion": 1,
      "activity": "hiking",
      "geographicAnchor": {
        "state": "resolved",
        "name": "Harz",
        "coordinate": {"latitude": 51.8, "longitude": 10.6},
        "regionEntityId": "30000000-0000-4000-8000-000000000002"
      },
      "routeType": "loop",
      "distanceRangeKm": {"min": 10, "max": 14},
      "durationRangeMinutes": null,
      "maximumElevationGainMeters": null,
      "maximumTechnicalDifficulty": null,
      "mustHaveExperiences": [
        {"experience": "viewpoint", "minimumCount": 1}
      ],
      "preferredExperiences": [],
      "avoidedExperiences": [],
      "requiredFacilities": [],
      "groupContext": {
        "partySize": 2,
        "includesChildren": false,
        "youngestAge": null,
        "mobility": "standard",
        "experienceLevel": "intermediate"
      },
      "dateOrSeason": null,
      "overnightRequirements": {
        "required": false,
        "nights": 0,
        "allowedAccommodationTypes": []
      },
      "transportRequirements": {
        "arrivalMode": "walking",
        "returnToStart": true,
        "publicTransportRequired": false
      },
      "unresolvedClarificationQuestions": []
    }
  }' \
  "$TRAILMIND_STAGING_BASE_URL/api/outdoor-research/plan-route"
```

Require HTTP 200; schema version 2; state `routed` or truthfully `partial`;
candidate policy `research-guided-route-candidates-v2`; routing policy
`research-guided-routing-adapter-v2`; at least one provider-verified eligible
route for the golden success cases; `geometryProvider=graphhopper`; bounded
attempt/result counts; and only evidence-backed facts plus explicit gaps and
limitations. A `partial` response is not automatically golden: compare it to
the case's exact expected limitations.

## Observability and privacy review

Expected allowlisted events:

- `service_started`
- `runtime_capability_state`
- `database_pool_state_changed`
- `readiness_changed`
- `provider_circuit_state_changed`
- `outdoor_adventure_planning_completed`
- `service_draining` and `service_stopped` during the rollback/drain drill

The logs may contain only coarse allowlisted states, count/duration buckets,
activity, route type, bounded region ID, status, and safe error codes. Stop if
they contain a credential, route-session token, request ID, prompt, coordinate,
geometry, evidence assertion, provider/database URL, raw database error, or raw
provider body.

## Rollback switch

At the first stop condition, atomically set these values back to `false` and
manually redeploy:

```text
OUTDOOR_ROUTABLE_HIGHLIGHT_ACCESS_ENABLED=false
OUTDOOR_RESEARCH_PLANNING_ENABLED=false
ROUTE_PROVIDER_ENABLED=false
```

Validated activation secrets may remain staged for incident analysis and a
reviewed retry; they do not enable work by themselves. Require graceful drain,
then exact live/ready responses on the disabled deployment. A bounded planning
request must return `feature_unavailable` with zero research/provider work.
If the disabled deployment cannot become ready, select the immediately prior
reviewed Render deploy. Code rollback never rolls back database state.

## Stop conditions

Stop activation and apply the rollback switch if any of these occurs:

- source commit, project-ref hash, region, plan, role, schema, CA, TLS mode,
  migration ledger, or deployment identity differs from the reviewed target;
- migration 008 is present, the official V2 disposable proof is not green, or
  the Harz active import/projection and backup/restore proof are not current;
- startup fails admission, `/healthz` is not exact application liveness, or
  `/readyz` is not exact ready after the bounded cold-start interval;
- App Attest production authorization is unavailable, replay/session handling
  differs, or an insecure/in-memory/mock path is enabled;
- the GraphHopper circuit opens repeatedly, provider budget/bounds are crossed,
  requests time out, cancellation does not abort database/provider work, or
  shutdown exceeds its drain deadline;
- a response fails strict V2 validation, invents geometry or outdoor facts,
  hides a required gap/limitation, returns no viable route for a required
  golden success case, or exceeds the approved partial/failure threshold;
- privacy review finds sensitive values or raw internal/provider/database
  errors in logs or receipts;
- the service leaves the Render Free topology, requests billing, or enables a
  second instance/resource.

## Known non-blocking limitations after activation

- Remote AI intent parsing remains disabled. This endpoint receives an already
  structured intent; it does not accept a free-form prompt.
- The separate corridor evidence endpoint remains disabled initially. Mapped
  research evidence still flows through the five migration-009 functions.
- Initial operational coverage is bounded to the reviewed regional bindings
  and current imported generations, beginning with Harz.
- Requested views, facilities, trail access, conditions, water, legality,
  safety, scenic quality, weather, and closures are not guarantees. Only
  validated current evidence may be stated as fact; everything else remains a
  request preference, gap, limitation, or required user check.
- Render Free may cold-start and is not production-eligible. Cold-start timing
  must be measured and treated separately from application liveness.
- Staging activation does not authorize closed beta or public release.

## Verification commands for the reviewed commit

Run from `backend/` without live credentials or enabled tracked flags:

```sh
npm ci
npm test
npm run build
npm run eval:outdoor-adventure-quality
npm run test:supabase-postgis-isolation-v2
```

The last command is required for authoritative V2 staging evidence and must be
red until the official PostgreSQL 17 `supautils` library is supplied. The
ordinary full suite, build, offline 101-case evaluation, and disposable
PostGIS composition test must all be green independently.
