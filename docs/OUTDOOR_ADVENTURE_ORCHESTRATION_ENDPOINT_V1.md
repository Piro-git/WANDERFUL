# TrailMind Outdoor Adventure Orchestration Endpoint V1

## Status

This backend-only endpoint composes TrailMind's existing outdoor-research and
real-routing seams into one protected operation. It is disabled by default,
is not connected to the shipping iOS planner, and does not run
`HikingRouteQualityEngine`.

The feature flag is:

```text
OUTDOOR_RESEARCH_PLANNING_ENABLED
```

It is enabled only when the trimmed, case-insensitive value is exactly
`true`, `yes`, or `1`. Missing, false, and malformed values remain disabled.
No tracked deployment or Release configuration enables it.

## Trusted pipeline

The internal API is:

```js
planAndRouteOutdoorAdventureV1(request, dependencies, options?)
```

It executes:

```text
OutdoorAdventurePlanningRequestV1
  → validate AdventureResearchIntentV1
  → researchOutdoorAdventureV1
  → validate AdventureResearchDossierV1
  → buildResearchGuidedRouteCandidatePlanV1
  → validate ResearchGuidedRouteCandidatePlanV1
  → routeResearchGuidedCandidatesV1
  → validate ResearchGuidedRoutedAlternativesV1
  → validate OutdoorAdventurePlanningResponseV1
```

Every boundary is revalidated even though the preceding stage is trusted.
Research uses the existing `PostgresOutdoorResearchRepository` with the
runtime PostgreSQL pool. Routing uses the existing GraphHopper provider. The
endpoint creates no shadow database pool, research client, routing client, or
authorization system.

The endpoint does not run the iOS `HikingRouteQualityEngine`. A routed server
alternative is real GraphHopper output, but it is not yet quality-approved for
presentation by iOS.

## HTTP API

```text
POST /api/outdoor-research/plan-route
Content-Type: application/json
```

The exact request is:

```json
{
  "schemaVersion": 1,
  "intent": {
    "schemaVersion": 1,
    "...": "AdventureResearchIntentV1"
  }
}
```

Both wrapper and intent reject unknown fields. The endpoint does not accept:

- a raw prompt or chat history;
- a dossier, evidence claim, evidence ID, candidate plan, or proposal ID;
- client-supplied research or route provenance;
- provider names, URLs, options, credentials, source overrides, or policy
  overrides;
- coordinates outside the validated intent contract;
- arbitrary region identifiers outside the existing intent and reviewed
  region-binding contracts.

The endpoint deliberately accepts validated structured intent rather than a
raw prompt. Natural-language interpretation and this expensive
research-to-routing operation remain separate trust boundaries. A later iOS
integration can first obtain structured intent through the existing protected
intent flow, then submit only that validated contract.

Clients never supply dossiers or candidate plans because those values decide
which evidence and coordinates reach routing. Accepting either would let a
client fabricate evidence or waypoint provenance.

## Response contract

The strict response is `OutdoorAdventurePlanningResponseV1`:

```js
{
  schemaVersion: 1,
  policyVersion: "outdoor-adventure-orchestration-v1",
  state:
    "clarification_required" |
    "unsupported" |
    "no_viable_route" |
    "partial" |
    "routed",
  normalizedIntent: AdventureResearchIntentV1,
  planningGaps: PlanningGapV1[],
  clarificationQuestions: ClarificationQuestionV1[],
  routedAlternatives: ResearchGuidedRoutedAlternativesV1 | null
}
```

The runtime validator rejects unknown fields, inconsistent states, duplicate
planning gaps or questions, invalid normalized intent, routed-envelope
tampering, duplicate routed identities, oversized collections, and oversized
serialization. The deterministic serializer recursively orders object keys.

When present, `routedAlternatives` remains the existing validated
`ResearchGuidedRoutedAlternativesV1` envelope. Its research provenance and
GraphHopper facts are not flattened, rewritten, or upgraded.

### State semantics

- `clarification_required`: the validated intent needs clarification.
  Questions are nonempty and exactly match the normalized intent. Research
  repository and GraphHopper calls are zero. `routedAlternatives` is null.
- `unsupported`: exact region/activity coverage or the candidate/route-shape
  boundary is unsupported. Pre-routing unsupported states have a null routed
  envelope. Unsupported point-to-point and out-and-back attempts retain the
  adapter's exact typed failures and issue zero GraphHopper calls.
- `no_viable_route`: research completed, but no truthful coordinate-bearing
  proposal or no valid real routed alternative survived. It is never a success
  state.
- `partial`: at least one validated GraphHopper route exists, but a provider
  attempt, required evidence, or planning capability remains incomplete. All
  limitations remain in their original contracts.
- `routed`: at least one validated GraphHopper route exists and the bounded
  attempted set completed without a partial orchestration condition.

`routed` does not assert safety, access, legality, opening, water,
overnight suitability, official-route status, scenic quality, or iOS quality
approval.

## Authorization and abuse prevention

The endpoint reuses App Attest route-session authorization. Validation occurs
before authorization, and authorization occurs before PostgreSQL or
GraphHopper work.

The authorization cost is a fixed `12`, representing the maximum bounded
operation rather than a cheaper cost inferred after work. The value cannot be
lowered by environment configuration. Existing durable installation/global
usage windows, request-ID replay prevention, and concurrency leases are reused
in production.

Authorization leases are released exactly once in `finally`. A release or
operational logging failure cannot change the response or expose internal
data. Production fails closed when durable authorization is unavailable.

An insecure local path requires all of:

- `NODE_ENV=development` or `NODE_ENV=test`;
- `OUTDOOR_RESEARCH_PLANNING_ALLOW_INSECURE_LOCAL=true`;
- the orchestration feature flag explicitly enabled.

The generic local route flag does not enable this endpoint.

## Bounds and timeouts

Default and immutable hard bounds are:

| Bound | Default | Hard maximum |
| --- | ---: | ---: |
| Request body | 64 KiB | 128 KiB |
| Response | 9 MiB | 9 MiB |
| Candidate proposals | 3 | 6 |
| Total GraphHopper calls | 3 | 6 |
| Provider concurrency | 2 | 2 |
| Authorization cost | 12 | 12 |
| Total orchestration deadline | 25 s | 45 s |
| Research stage deadline | 7.5 s | 30 s |
| PostgreSQL statement timeout | 2.5 s | 15 s |
| GraphHopper attempt timeout | 8 s | 30 s |

Configured proposal count may not exceed the configured total GraphHopper-call
cap. The database statement timeout must be shorter than the research timeout.
Research and GraphHopper attempt timeouts must be shorter than the total
deadline.

The total deadline must be at least one second shorter than the existing App
Attest authorization lease TTL. Invalid supplied bounds fail closed rather
than falling back to a broader value.

## Cancellation

One caller signal is linked through:

- HTTP request and response disconnect handling;
- the overall orchestration deadline;
- `researchOutdoorAdventureV1`;
- the read-only PostgreSQL snapshot and each bounded query;
- checks before and after candidate generation;
- `routeResearchGuidedCandidatesV1`;
- every GraphHopper attempt.

An already-cancelled request performs no authorization, research, or provider
work. Client disconnect and overall timeout abort outstanding work.
Dependencies that ignore cancellation are detached from response selection;
late completion cannot determine or mutate the returned state. Authorization
leases are still released.

## PostgreSQL and coverage

The orchestrator constructs `PostgresOutdoorResearchRepository` with the
existing runtime PostgreSQL pool. It preserves:

- repeatable-read, read-only transactions;
- transaction-local statement timeout;
- rollback and cancellation behavior;
- exact reviewed Harz and Innsbruck bindings;
- active import, PostGIS, projection, source, policy, freshness, and scope
  checks.

It never downloads regional data or modifies evidence imports. Missing
migrations, unavailable PostGIS, stale projections, inactive imports, and
unsupported geography remain fail-closed or truthful non-ready states.

## GraphHopper boundary

Routing is performed only through `routeResearchGuidedCandidatesV1` and the
existing `createGraphHopperProvider` implementation. The client cannot select
or override the provider or URL.

The endpoint does not send a raw dossier to GraphHopper, invent coordinates
from mapped relations, claim that GraphHopper followed an OSM relation, or
retry unsupported point-to-point/out-and-back proposals as loops.

## Errors

The endpoint has a fixed safe vocabulary:

- `invalid_request`
- `feature_unavailable`
- `authorization_failed`
- `authorization_unavailable`
- `rate_limited`
- `unsupported`
- `research_unavailable`
- `routing_unavailable`
- `timed_out`
- `cancelled`
- `response_too_large`
- `internal_failure`

PostgreSQL, GraphHopper, JSON, research, validation, and authorization details
are never reflected.

## Logging and privacy

The only endpoint log event is `outdoor_adventure_planning_completed`.
Allowlisted fields are:

- safe request ID;
- result state;
- activity and route type;
- coarse reviewed region UUID;
- proposal, attempt, and route-result counts;
- duration bucket;
- fixed error code.

The endpoint never logs prompts, location names, exact coordinates, geometry,
dossiers, claims or evidence IDs, POI names, GraphHopper payloads or provider
messages, database rows or SQL, tokens, credentials, stack traces, or complete
responses.

## Remaining limitations

- Only the reviewed Harz and Innsbruck evidence regions are supported.
- Governed OSM evidence remains mapped evidence; official/current providers
  are not added by this endpoint.
- Research-guided routing V1 supports loops. Point-to-point and out-and-back
  fail closed.
- Biking candidate planning remains unsupported.
- GraphHopper routes still require final iOS contract conversion,
  `RouteAlternativeQuality`, and `HikingRouteQualityEngine`.
- The endpoint is disabled by default and has no shipping iOS caller.

## Exact next step

After backend evaluation passes, add only a disabled-by-default iOS client for
this exact endpoint and gate the production planning-flow integration behind a
separate iOS feature flag. Do not enable Release behavior until live
evaluation, privacy review, authorization monitoring, and gradual rollout are
complete.
