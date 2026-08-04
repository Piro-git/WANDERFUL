# TrailMind Golden Set V1 — Expert Hiking Review Form

Use one form per case and route alternative. This form records product-quality judgment, not reviewer identity, medical information, location history, or proof of real-world safety.

## Review header

| Field | Entry |
| --- | --- |
| Case ID | |
| Region ID | `harz-v1` / `innsbruck-alps-v1` |
| Route result ID or bounded receipt reference | |
| Review date (UTC, date only) | |
| Review mode | `offline_geometry_and_evidence` / `bounded_provider_receipt` / `field_familiarity_without_live_visit` |
| Observed planning state | `clarification_required` / `unsupported` / `no_viable_route` / `partial` / `routed` |
| Expected technical pipeline outcome | `pass` / `fail` / `not_run` |
| Observed technical pipeline outcome | `pass` / `fail` / `not_run` |
| Expected product-quality outcome | `pass` / `partial` / `fail` / `not_applicable` |
| Observed product-quality outcome | `pass` / `partial` / `fail` / `not_applicable` |
| Reviewer qualification category | `experienced_hiker` / `regional_trail_expert` / `outdoor_route_researcher` |

Do not enter a name, email address, exact home/location information, health data, device identifier, raw prompt, private coordinate, provider URL, or route geometry.

## Evidence admission

Mark one answer per row: `yes`, `no`, or `not_measurable`.

| Question | Answer | Note code or bounded note |
| --- | --- | --- |
| Is the activity and route type correct? | | |
| Is geometry present, finite, verified, and a valid loop when required? | | |
| Are provider distance, duration, and elevation facts available? | | |
| Is regional containment proved? | | |
| Is source and route provenance complete and internally consistent? | | |
| Is each required highlight supported by original evidence, a derived access point, provider snap, and route approach? | | |
| Are current or high-stakes claims backed by current competent evidence? | | |
| Are all hard-gate calculations available? | | |

If any applicable hard-gate input is missing, do not infer a pass. Use `not_measurable` and require a partial or non-ready result.

## Technical pipeline decision

| Gate | Result (`pass` / `fail` / `not_applicable` / `not_measurable`) | Bounded reason code |
| --- | --- | --- |
| Valid real geometry and positive routed facts | | |
| Closed and non-degenerate loop | | |
| Correct activity and route type | | |
| Required highlight strictly reached | | |
| Provider/access verification within policy | | |
| Complete provenance and regional containment | | |
| Known closures/prohibitions respected | | |
| Hard difficulty and group constraints respected | | |
| Distance and duration inside hard envelopes | | |
| Self-backtracking and overlap at or below 55% | | |
| Explicit major-road avoidance gate | | |
| Must-have not silently dropped | | |
| No forbidden claim | | |

Observed `technicalPipelineOutcome`: `pass` / `fail` / `not_run`

First failed or unmeasurable gate: ______________________________

Technical pipeline success does not determine product quality. Continue to the product-quality decision even when every technical gate passes.

## Product-quality boundary decision

Use provider measurements where a route exists. A `pass` is invalid if any applicable pass guard below fails.

| Product-quality guard | Measured value | Result (`pass` / `fail` / `not_applicable` / `not_measurable`) |
| --- | --- | --- |
| Distance is inside the normalized requested range, or within 15% of an exact target | | |
| Duration is inside the requested range, or within 20% of an exact target | | |
| Accidental self-backtracking is at most 35% | | |
| Accidental self-overlap is at most 35% | | |
| Every required highlight is strictly reached with complete lineage | | |
| Difficulty and explicit group constraints fit | | |
| No forbidden or overstated claim occurs | | |

For repetition over 35% through 55%, record `partial` only when the repeated portion is a localized terminal spur serving a required highlight and the expert conclusion is `worthwhile_intentional_spur`. Otherwise reject it. More than 55% remains a technical hard failure.

For distance or duration outside the product-quality boundary but inside the structural envelope, record `partial` only when a verified must-have genuinely requires the measured deviation and that trade-off is explained. Otherwise revise, reject, or record no viable quality match. Never use `close match` or equivalent wording.

Observed `productQualityOutcome`: `pass` / `partial` / `fail` / `not_applicable`

Primary product-quality reason code: ______________________________

## Required expert questions

Use the categorical scale shown for each question. Notes are optional and limited to 280 characters. Record measured facts and specific trade-offs; do not write a route narrative.

1. Would this route suit the stated user?

   Answer: `yes` / `yes_with_caveats` / `no` / `not_measurable`

   Note (max 280 characters):

2. Does the route form a coherent outdoor experience?

   Answer: `coherent` / `minor_revision` / `incoherent` / `not_measurable`

   Note (max 280 characters):

3. Does the order of highlights make geographic sense?

   Answer: `yes` / `partly` / `no` / `not_applicable` / `not_measurable`

   Note (max 280 characters):

4. Are required highlights genuinely experienced?

   Answer: `all_reached` / `some_pass_near` / `some_not_reached` / `unverified` / `not_applicable`

   Note (max 280 characters):

5. Are optional detours worthwhile?

   Answer: `all_worthwhile` / `some_should_be_removed` / `none_worthwhile` / `not_applicable` / `not_measurable`

   Note (max 280 characters):

6. Is repeated terrain intentional or accidental?

   Answer: `none_or_low` / `intentional_terminal_spur` / `mixed` / `accidental` / `not_measurable`

   Note (max 280 characters):

7. Does the route appear to use suitable hiking infrastructure?

   Answer: `yes` / `partly` / `no` / `not_measurable`

   Note (max 280 characters):

8. Is distance and duration fit honestly described?

   Answer: `yes` / `minor_copy_revision` / `misleading` / `not_measurable`

   Note (max 280 characters):

9. Is difficulty fit plausible and transparent?

   Answer: `yes` / `yes_with_caveats` / `no` / `not_measurable`

   Note (max 280 characters):

10. Are important uncertainties visible?

    Answer: `all_material_uncertainties_visible` / `minor_gap` / `material_gap` / `not_measurable`

    Note (max 280 characters):

11. Are access and current-status claims appropriately limited?

    Answer: `yes` / `minor_copy_revision` / `false_or_overstated` / `not_applicable`

    Note (max 280 characters):

12. Would you recommend, revise, or reject the route?

    Answer: `recommend` / `revise` / `reject`

    Note (max 280 characters):

13. What is the first improvement you would make?

    Category: `none` / `remove_optional_detour` / `replace_access_point` / `change_highlight_order` / `reduce_backtracking` / `improve_distance_fit` / `reduce_elevation_or_difficulty` / `improve_evidence` / `improve_explanation` / `request_clarification` / `return_no_viable_route`

    Note (max 280 characters):

## Independent dimension ratings

Use `hard_failure`, `acceptable`, `good`, `excellent`, or `not_measurable`. A hard failure in any applicable dimension prevents `recommend`.

| Dimension | Rating | Measured value or bounded reason |
| --- | --- | --- |
| Target-distance fit | | |
| Target-duration fit | | |
| Required-highlight satisfaction | | |
| Optional-highlight value | | |
| Access-point and highlight approach | | |
| Route coherence | | |
| Repeated segments and backtracking | | |
| Intentional terminal-spur value | | |
| Path/trail preference | | |
| Verified road exposure | | |
| Elevation appropriateness | | |
| Difficulty fit | | |
| Variant diversity | | |
| Evidence completeness | | |
| Evidence freshness | | |
| Explanation quality | | |
| Uncertainty honesty | | |

## Highlight ledger

Repeat this row for each candidate highlight. Distances are bounded numeric values from the strict contract, not coordinates.

| Reference ID | Role | Access candidate ≤75 m | Provider snap ≤100 m | Route to access ≤100 m | Route to evidence | Approach state | Satisfies role |
| --- | --- | --- | --- | --- | --- | --- | --- |
| | `must_have` / `preferred` / `available_candidate` / `facility_candidate` / `overnight_candidate` | `yes` / `no` / `unverified` | `yes` / `no` / `unverified` | `yes` / `no` / `unverified` | `≤25 m` / `>25–100 m` / `>100 m` / `unverified` | `reached` / `passes_near` / `not_reached` / `unverified` | `yes` / `no` |

Provider snapping alone never satisfies the role. `passes_near` does not satisfy a must-have visit.

## Repetition classification

| Field | Entry |
| --- | --- |
| Self-backtracking ratio | |
| Self-overlap ratio | |
| Repeated portion localized to terminal spur? | `yes` / `no` / `not_measurable` |
| Spur serves an explicitly required highlight? | `yes` / `no` / `not_applicable` |
| A plausible lower-repetition route reaches the same must-have? | `yes` / `no` / `unknown` |
| Expert conclusion | `worthwhile_intentional_spur` / `acceptable_repetition` / `accidental_backtracking` / `hard_failure` / `not_measurable` |

## Final bounded decision

| Field | Entry |
| --- | --- |
| Decision | `recommend` / `revise` / `reject` |
| Expected technical pipeline outcome matches observed | `yes` / `no` |
| Expected product-quality outcome matches observed | `yes` / `no` |
| Observed state matches case expectation | `yes` / `no` |
| Any false verified-highlight claim | `yes` / `no` |
| Any provenance violation | `yes` / `no` |
| Any false safety/access/legal/current-status claim | `yes` / `no` |
| First improvement category | |
| Final note (max 500 characters) | |

`caseEvaluationOutcome` is `pass` only when the observed planning state, `technicalPipelineOutcome`, and `productQualityOutcome` all match the fixture and no applicable validation or integrity rule fails. An expected negative case can therefore pass evaluation by stopping or failing honestly. Technical pass alone can never produce `recommend` or product-quality pass.

The decision applies only to this bounded case and evidence snapshot. It is not a declaration that a real-world route is safe, open, legal, or suitable on another date.
