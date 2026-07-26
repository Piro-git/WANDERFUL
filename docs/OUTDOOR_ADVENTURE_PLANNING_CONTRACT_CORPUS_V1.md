# Outdoor Adventure Planning Contract Corpus V1

## Purpose

`outdoor_adventure_planning_v1_contract_corpus.json` is TrailMind's shared,
deterministic proof that the backend and iOS assign the same meaning to
`OutdoorAdventurePlanningResponseV1`.

The corpus exists because the response crosses two strict trust boundaries:

```text
backend OutdoorAdventurePlanningResponseV1 validator
  → nested ResearchGuidedRoutedAlternativesV1 validator
  → iOS OutdoorAdventurePlanningResponseValidatorV1
  → iOS ResearchGuidedRoutingContractAdapterV1
  → verified GraphHopper TrailRoute conversion
  → RouteAlternativeQuality and HikingRouteQualityEngine
```

It contains no production traffic, raw prompt, authorization material,
credential, live provider response, or personal location history. It adds no
shipping behavior and does not enable the outdoor-adventure endpoint.

## Authoritative contracts

The corpus is evidence for the production contracts; it is not an alternative
validator. The authoritative backend sources are:

- `backend/src/outdoorAdventure/orchestrationContract.js`
- `backend/src/outdoorAdventure/orchestrationPolicy.js`
- `backend/src/outdoorResearch/validation.js`
- `backend/src/routeResearch/routedAlternativesContract.js`

The authoritative iOS sources are:

- `OutdoorAdventurePlanningResponseValidatorV1`
- `ResearchGuidedRoutingContractAdapterV1`
- the existing GraphHopper path conversion and route-quality engines

If a case disagrees with a production validator, the fixture must be corrected
or versioned. A production validator must never be weakened merely to make a
fixture pass.

## Corpus schema

The single JSON document is bounded to less than 2 MiB:

```json
{
  "corpusSchemaVersion": 1,
  "contractVersions": {
    "outdoorAdventurePlanningResponse": 1,
    "researchGuidedRoutedAlternatives": 1
  },
  "policyVersions": {
    "orchestration": "outdoor-adventure-orchestration-v1",
    "candidatePlan": "research-guided-route-candidates-v1",
    "routedAdapter": "research-guided-routing-adapter-v1",
    "hikingQuality": "hiking-route-quality-v1"
  },
  "cases": []
}
```

Case IDs are unique, lowercase, stable, and lexically ordered. Each case has:

- `accepted`: the cross-runtime acceptance expectation;
- `expected`: outer and nested states, exact gap/question counts, backend
  route-result bounds, iOS surviving-alternative bounds, and the backend safe
  error code;
- either one complete `response` or one deterministic `mutation`.

Complete explicit responses are used whenever reasonably sized. V1 permits
only three mutation operations:

- `repeat_attempt_to_count`, for the seven-attempt structural limit case;
- `repeat_route_result_to_count`, for the four-result-per-attempt limit case;
- `append_outer_padding_bytes`, for the response-size limit case.

Both runtime tests independently implement only these bounded operations and
reject unknown corpus operations.

## Accepted coverage

The ten accepted envelopes cover:

1. unresolved geography with exact nonempty clarification questions;
2. unsupported geography with a bounded planning gap and no routed result;
3. unsupported biking without a fabricated hiking result;
4. no surviving real route;
5. a partial Harz route with explicit research limitations;
6. a partial Innsbruck route retaining waypoint and evidence provenance;
7. a routed Harz response with no planning gaps;
8. one provider failure alongside one surviving verified route;
9. three backend paths reduced to two iOS alternatives by quality selection;
10. advisory mapped-network provenance retained as mapped.

Accepted routed paths contain deterministic sanitized GraphHopper facts. The
iOS corpus test still requires them to pass the production GraphHopper
converter and existing route-quality engines before they count as surviving
alternatives.

## Rejected coverage

Rejected cases cover:

- unknown outer or nested fields;
- wrong outer schema or policy versions and unknown state;
- routed/partial/null/zero-result state contradictions;
- empty, different, or duplicate clarification questions;
- duplicate planning gaps;
- unsupported state containing successful routing;
- different outer and nested normalized intents;
- invalid and duplicate proposal identities;
- invalid lineage;
- unknown evidence limitation codes;
- tampered waypoint coordinates;
- invalid GraphHopper geometry;
- activity/provenance mismatch;
- mapped provenance relabelled as official without matching lineage;
- claimed routed state with only failed attempts;
- excessive attempt and route-result collections;
- NaN-like and infinity-like strings;
- invalid coordinate ranges;
- a generated response above the 9 MiB outer limit.

Backend contract failures use the fixed orchestration classifications
`internal_failure` or, only for the outer size case, `response_too_large`.
iOS rejects the same tampering with its fixed safe contract error and never
reflects the response body, coordinates, evidence IDs, lineage IDs, or
provider details.

## Runtime execution

The Node test loads the fixture directly from `TrailMindTests/Fixtures`. It:

- validates the corpus harness schema and unique deterministic IDs;
- runs every accepted response through
  `validateOutdoorAdventurePlanningResponseV1`;
- proves stable canonical output with
  `serializeOutdoorAdventurePlanningResponseV1`;
- asserts every rejected response's fixed safe error classification;
- checks routed outer states have no planning gaps;
- checks mapped-network evidence is not promoted into product claims;
- scans the corpus for forbidden prompt, credential, authorization, token,
  secret, and provider-detail fields.

It imports validators and serializers only. It performs no database, HTTP,
research repository, or GraphHopper operation.

The XCTest loads the exact same bytes. It:

- sends every response through the production
  `OutdoorAdventurePlanningResponseValidatorV1`;
- relies on that validator to pass nested envelopes through
  `ResearchGuidedRoutingContractAdapterV1`;
- verifies GraphHopper/backend route provenance and research lineage;
- asserts quality reduction and surviving-alternative bounds;
- keeps research provenance and remaining limitations separate from routed
  geometry facts;
- asserts every rejection uses the generic safe client contract error.

The XCTest invokes no client transport, URL session, authorization seam, or
endpoint.

## Trust boundaries

Research provenance explains why TrailMind attempted a waypoint. GraphHopper
facts describe what the routing provider returned after sanitization. The
quality engines decide whether a converted route is eligible to present.
Those are separate claims and remain separate in every accepted case.

An OpenStreetMap route relation with `sourceBasis: "mapped"` is advisory
mapped evidence. It does not prove:

- official or current route status;
- that GraphHopper followed that relation;
- public access, legality, opening, or closure status;
- route safety or suitability;
- scenic quality.

The corpus deliberately preserves `mapped_presence_only` and
`route_connection_unverified` limitations for this reason.

## Versioning and fixture immutability

An accepted V1 envelope is a compatibility commitment. Do not silently edit,
replace, or reinterpret it.

For a new backend or iOS schema:

1. add a new versioned corpus file;
2. add versioned runtime tests that execute the new production validators;
3. document compatibility and migration behavior;
4. keep the V1 corpus and tests runnable for as long as V1 is supported.

If a factual fixture error must be corrected, add a documented replacement
case or a new corpus version. Never change an old accepted envelope without an
explicit compatibility record.

## What this corpus does not prove

This is offline contract proof. It does not prove:

- live GraphHopper availability or route quality;
- live PostgreSQL/PostGIS availability;
- current trail, access, closure, water, hut, or transport status;
- official route membership;
- scenic quality;
- legality or safety.
