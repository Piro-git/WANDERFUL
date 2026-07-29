# TrailMind Outdoor Adventure Quality Evaluation V1

## Purpose

Outdoor Adventure Quality Evaluation V1 is a lightweight, offline release
gate for TrailMind's research-guided planning contracts. It checks whether
synthetic outdoor-planning cases preserve intent, fail closed when evidence
is insufficient, retain provenance, and require real routing before route
results are eligible.

The evaluation does not change production planning behavior. It invokes the
existing production planner, evidence resolver and validators, dossier
validator, research-guided candidate planner and serializer, routing adapter
and routed-alternatives validator, and outdoor-adventure response contract.

## What a passing result proves

A passing result proves, for the checked-in code and synthetic corpus, that:

- Every configured case executed exactly once.
- Every case produced its expected contract state.
- No case was skipped.
- Must-haves and preferences remained separate.
- Explicit candidate shortfalls and unsupported needs remained visible.
- Mapped, community, derived, and model evidence did not independently
  resolve high-stakes facts.
- Stale, future, unavailable, or conflicted evidence did not become a current
  fact.
- Candidate plans required real routing and did not contain invented route
  geometry.
- Mapped route membership did not become official-current status.
- Routed results retained GraphHopper geometry provenance and the research
  proposal lineage.
- Waypoint visits used the existing 100-meter tolerance, and excessive
  snapping remained unverified.
- Bounds, contract validation, deterministic ordering, and output redaction
  rules held for the tested cases.
- The machine summary was written successfully and contained the exact
  configured/executed result identifiers.

## What it does not prove

A pass is not proof of:

- Real geographic route quality.
- A route being scenic, open, safe, accessible, or legal.
- Current closures, access, water, hut opening, booking, or overnight
  permission.
- Real provider availability or routing quality.
- Real PostGIS coverage or import correctness.
- Real App Attest behavior.
- Better route quality than Komoot or another product.
- Field safety or good user outcomes.

The corpus is synthetic contract/evaluation data. Synthetic entities and
coordinates are stable test fixtures, not real-world assertions.

## Corpus

The manifest is:

`backend/test/fixtures/outdoorAdventureQualityV1.json`

It contains 101 cases:

| Category | Cases |
| --- | ---: |
| `core_intent` | 12 |
| `must_have_preference` | 10 |
| `users_trip_context` | 11 |
| `high_stakes_trust` | 12 |
| `location_coverage` | 11 |
| `candidate_quality` | 13 |
| `routed_result_trust` | 12 |
| `malformed_adversarial` | 20 |
| **Total** | **101** |

The cases cover Harz and Innsbruck Alps needs, plus cross-region and
unsupported-location contract cases. The fixed evaluation clock is
`2026-07-22T10:00:00Z`.

### Manifest schema

The top-level shape is:

```json
{
  "schemaVersion": 1,
  "corpus": {
    "name": "TrailMind Outdoor Adventure Quality V1",
    "classification": "synthetic_contract_evaluation_data",
    "fixedClock": "2026-07-22T10:00:00Z",
    "disclaimers": ["..."]
  },
  "cases": []
}
```

Every case has exactly:

- `id`: stable, unique, non-secret case identifier.
- `category`: one coarse evaluation category.
- `region`: `harz`, `innsbruck_alps`, `cross_region`, or `none`.
- `operation`: `planner`, `evidence`, `candidate`, `routing`, or `contract`.
- `input`: bounded structured synthetic input.
- `expected`: expected state and operation-specific assertions.
- `tags`: bounded coverage labels.

Unknown fields, malformed shapes, oversized cases, and duplicate IDs are
rejected before evaluation.

## States and metrics

The final status is exactly one of:

- `passed`: every configured case executed and passed, no case was skipped,
  and all violation metrics are zero.
- `failed`: at least one executed case failed, a case was skipped, or a
  violation was recorded.
- `not_run`: zero cases were configured or zero cases executed.

The summary contains exact integer metrics:

- `configuredCases`: validated cases in the manifest.
- `executedCases`: cases that were not skipped.
- `passedCases`: executed cases whose assertions passed.
- `failedCases`: executed cases whose assertions failed.
- `skippedCases`: cases explicitly marked skipped.
- `readyCases`: executed cases that produced a ready/known/routed outcome.
- `partialCases`: executed cases that conservatively remained partial,
  unknown, conflicted, stale, unavailable, or had no viable route.
- `clarificationCases`: executed cases requiring clarification.
- `unsupportedCases`: executed cases rejected or unsupported by contract.
- `falseClaimViolations`: unsupported factual claims that were accepted.
- `highStakesAuthorityViolations`: high-stakes facts resolved without
  sufficient current authority.
- `provenanceViolations`: lost or substituted research/routing lineage.
- `mustHaveViolations`: lost, downgraded, or incorrectly satisfied must-haves.
- `routeVerificationViolations`: results treated as routed without eligible
  provider geometry.
- `waypointConnectionViolations`: route/POI connection or snapping tolerance
  mistakes.
- `determinismViolations`: repeated-input semantic differences or timeout
  failures.
- `boundsViolations`: configured contract limits that were not enforced.

There is no confidence percentage and no composite quality score.

## Determinism

The loader canonicalizes case order by ID. Cases execute sequentially in that
stable order. The evaluator uses:

- Fixed fixture IDs.
- A fixed clock.
- No randomness.
- No locale-sensitive expected output.
- No network or provider access.
- No database.
- Stable JSON object-key serialization.

The fixture digest, category counts, metrics, and case results are
semantically identical for repeated runs over the same source and fixture.
Elapsed time is intentionally excluded from the deterministic summary.

## Trust rules

The evaluation enforces these boundaries:

- OpenStreetMap can establish mapped presence, not current closure, access,
  water, overnight legality, or official-current status.
- Community or inferred evidence cannot override current official
  prohibition.
- Current high-stakes facts require current official evidence.
- Conflicted, stale, future, unavailable, and retracted evidence does not
  resolve as known.
- Safety is never guaranteed.
- Research highlights remain candidates until routing verifies connection.
- Straight-line distance is only a lower bound.
- Candidate plans cannot invent geometry, distance, duration, or elevation.
- Research provenance cannot replace routing provenance.
- Only eligible GraphHopper-routed results can be returned as routed.

## Privacy and output safety

Machine summaries include only:

- Case IDs.
- Coarse categories.
- Outcome states.
- Pass/skip booleans.
- Fixed bounded error codes.
- Fixed violation kinds.
- Integer metrics.

They do not include raw prompts, coordinates, route geometry, full dossiers,
credentials, authorization values, provider errors, HTTP payloads, database
URLs, or environment values. Thrown errors are converted to a fixed safe
vocabulary.

## Running the gate

From `backend/`:

```sh
npm run eval:outdoor-adventure-quality
```

The complete deterministic summary is written by default to:

```text
/tmp/trailmind-outdoor-adventure-quality-v1.summary.json
```

The runner also accepts explicit bounded paths:

```sh
node scripts/run-outdoor-adventure-quality-eval.js \
  --fixture test/fixtures/outdoorAdventureQualityV1.json \
  --output /tmp/trailmind-eval-summary.json
```

Exit behavior:

- Exit `0` only for `passed`.
- Exit nonzero for any failed case.
- Exit nonzero for any skip.
- Exit nonzero for zero configured or zero executed cases.
- Exit nonzero for missing, malformed, or duplicate fixture data.
- Exit nonzero when result IDs are missing, extra, duplicated, or reordered.
- Exit nonzero on timeout.
- Exit nonzero when the summary cannot be written.

The runner never reports `passed` after incomplete execution.

## Harness self-tests

`backend/test/outdoorAdventureQualityHarness.test.js` verifies:

- Controlled complete success.
- One deliberate evaluation failure.
- One deliberate skip.
- Zero configured cases.
- Zero executed cases.
- Missing fixture.
- Malformed JSON.
- Duplicate case IDs.
- Missing result IDs.
- Extra and duplicate result IDs.
- Timeout.
- Summary-write failure.
- Secret/redaction sentinel.
- Non-deterministic result ordering.

These tests are intentionally independent of the production corpus so the
harness cannot normalize an incomplete run into a green result.

## Adding a case

1. Add a unique, stable case object to
   `backend/test/fixtures/outdoorAdventureQualityV1.json`.
2. Use a fictional fixture entity ID and structured input. Do not add a raw
   user prompt or real user coordinates.
3. Select the narrowest existing operation.
4. State the expected conservative outcome and assertions.
5. Add tags that identify the contract behavior being covered.
6. If a genuinely new assertion is required, add it to the evaluator using a
   fixed error code and violation kind.
7. Update the documented and tested category count.
8. Run the focused evaluator and harness tests, then run the gate twice and
   compare the summaries.

Never weaken an expectation merely to make a discovered production defect
green. Report production defects separately; this evaluation lane does not
silently change production planning behavior.

## Later live regional evaluation

A later live Harz/Innsbruck evaluation should reuse the same stable case IDs,
categories, intent requirements, expected clarification/unsupported
boundaries, and metric vocabulary. It should replace only the synthetic
evidence and routing execution lane with approved live regional inputs and
record a separate live-evaluation classification.

Geographic proof still requires:

- Real Harz and Innsbruck PostGIS data.
- Real GraphHopper routes.
- Current official/source evidence.
- Expert and manual route review.
- Eventually field and user-outcome data.

A passing offline result does not authorize release enablement, provider
traffic, database imports, feature flags, or product claims. It is one
contract-quality prerequisite for those later decisions.
