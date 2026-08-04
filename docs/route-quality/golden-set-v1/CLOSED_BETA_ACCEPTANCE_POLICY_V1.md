# TrailMind Golden Set V1 — Closed-Beta Acceptance Policy

Status: **PREPARED, UNPROVED, NO-GO**

This policy defines the minimum future evidence for enabling research-guided hiking and trail-running loops in one bounded region. It does not approve the current build, V4, a cohort, or public release. Every requirement begins unproved until new V4-or-later receipts and the existing closed-beta checklist establish it.

## Decision unit

Harz and Innsbruck Alps are admitted independently. A pass in one region cannot compensate for a failure or missing evidence in the other. The only supported activities are `hiking` and `trail_running`; the only supported route type is `loop`.

The decision state is one of:

- `not_run`
- `insufficient_data`
- `failed`
- `passed`

Only `passed` may support the corresponding regional closed-beta stage, and only when every mandatory item in `docs/operations/closed-beta-readiness-v1/go-no-go-checklist-v1.json` is also verified with accountable owners.

## Two-axis result requirement

Every executed case records both:

- `technicalPipelineOutcome`: whether routing and the unchanged geometry, lineage, access, provenance, containment, and structural-sanity gates passed;
- `productQualityOutcome`: whether a presented route actually meets the user's intent within the stricter distance, duration, repetition, must-have, difficulty, and truthfulness boundaries.

Technical pass never implies product-quality pass. A regional acceptance calculation must retain both values per case and the final case evaluation must compare both against Golden Set schema version 2. Negative cases may pass evaluation by producing their expected `fail`, `not_run`, `partial`, or `not_applicable` outcome honestly.

## Minimum benchmark execution

Per region, require:

1. all 13 regional Golden Set V1 cases executed against one identified candidate build, backend deployment, contract set, region definition, source snapshot, and quality-policy version;
2. all 13 observed orchestration states, technical pipeline outcomes, and product-quality outcomes compared with their expected values;
3. every applicable hard gate evaluated or explicitly `not_measurable`;
4. no skipped routed/partial success case;
5. all four mapped V4 canonical cases executed under the separate V4 protocol when provider authorization exists;
6. provider-free evaluation of every remaining case that can be decided from contracts, synthetic geometry, fixed receipts, or expert review.

A region with fewer than 13 executed cases is `insufficient_data`, not passed.

## Manual expert-review coverage

Per region, require:

- one complete expert review for 100% of the 13 cases;
- a second independent review for every `no_viable_route`, `unsupported`, group-sensitive, current-evidence-gap, and hard-gate failure case;
- a second independent review for at least 7 of 13 cases overall;
- consensus on the final decision for every case; disagreement is resolved by a third review, never by averaging ratings;
- bounded notes only, with no personal or sensitive data.

Every route presented as a candidate for `routed` must receive a manual review. Automated scores cannot replace this coverage.

## Zero-tolerance integrity gates

The region fails immediately on any of:

- a false verified-highlight claim;
- a required highlight reported as visited when its state is `passes_near`, `not_reached`, or `unverified`;
- missing, dangling, cross-region, quarantined, or inconsistent provenance;
- a false safety, public-access, legal-access, opening, current-status, drinking-water, scenic-quality, or legal-overnight claim;
- a known closure or prohibition ignored by the recommendation;
- a secret, provider URL, database URL, raw prompt, private coordinate, geometry, App Attest material, or unbounded error in a durable receipt;
- provider accounting that does not reconcile;
- feature-off work, provider call 16 in V4, concurrency above the authorized limit, or inability to restore all flags to false;
- a route outside regional, activity, or route-type containment.

Zero-tolerance failures cannot be waived by aggregate quality results.

## Required-highlight success

For cases expected to produce `routed`:

- 100% of must-have highlights must be strictly `reached`;
- 100% of required highlight counts must be satisfied;
- 100% must have valid access-candidate, provider-snap, route-to-access, original-evidence-approach, and provenance records.

Across all supported, unambiguous cases that return at least one eligible route:

- at least 90% of requested must-have highlight instances must be strictly reached;
- every non-reached required instance must force `partial` or `no_viable_route` and be explained;
- zero required instances may be silently dropped.

An expected negative case passes by failing honestly, not by fabricating a route.

## Target-distance and duration fit

Among supported, unambiguous, route-producing cases with a target:

- at least 80% must be inside the normalized requested distance range or within 15% of an exact target;
- at least 80% of duration-target cases must be inside the requested range or within 20% of an exact target;
- 100% must remain inside the existing hard structural envelopes;
- 100% outside the excellent/good band must use measured delta language and never a close-match label;
- no optional highlight may remain when removing it would restore target fit without dropping a must-have and without creating another hard failure.

Individually, no route outside a normalized requested distance range or more than 15% from an exact distance target may record `productQualityOutcome: pass`. No route outside a requested duration range or more than 20% from an exact duration target may record `productQualityOutcome: pass`. A verified must-have may justify an explained `partial`; otherwise revise, reject, or return no viable quality match. The structural distance ratio `0.55...1.75` and duration ratio `0.40...2.50` remain technical corruption/sanity envelopes only.

The canonical Brocken case's previously observed 23.799 km result for an approximately 15 km request is a possible technical pipeline pass but a product-quality partial or failure. Its 58.66% nominal-target deviation cannot be accepted as a full quality result merely because it remains inside the structural envelope.

## Backtracking and coherence

For every eligible selected route:

- self-backtracking and self-overlap must each be no more than 55%;
- 100% of routes recorded with `productQualityOutcome: pass` must have accidental self-backtracking and accidental self-overlap no more than 35%;
- at least 90% of all selected routes, including partials, must have accidental self-backtracking and self-overlap no more than 35%;
- every result above 20% must receive an explicit expert repetition classification;
- a result over 35% through 55% may remain `partial` only when the repeated portion is a localized terminal spur serving a required highlight and the reviewer records `worthwhile_intentional_spur`;
- zero routes with severe accidental repetition may be retained to improve case completion.

The 55% ceiling remains the unchanged technical structural limit. Accidental or diffuse repetition over 35% is rejected for product quality even when it remains technically eligible.

## Provider reliability and accounting

Provider evidence is reported, not converted into a provider-superiority claim.

Before a regional invite stage, require:

- the bounded V4 provider ledger reconciled exactly;
- at least 30 additional authorized operator-stage provider attempts in that region across at least 3 operating days;
- at least 90% successful strict provider responses across those attempts, excluding proof-only controlled post-success injection from the failure numerator but reporting it separately;
- zero unbounded retries and zero attempts after the circuit opens;
- separate counts for success, typed failure, timeout, cancellation, rate limitation, controlled post-success failure, and unused authorization;
- all raw provider material excluded from durable output.

Fewer than 30 operator-stage attempts is `insufficient_data` even if every observed call succeeded.

## Route diversity

When at least two eligible routes exist for a case:

- at least two selected alternatives must have less than 86% symmetric geometry similarity in the 35 m corridor;
- each alternative must expose a factual difference such as measured target fit, ascent, verified path/road evidence, or route shape;
- reversed traversal of the same geometry is not diversity;
- no scenic, quiet, easy, or safe label may substitute for measured differentiation.

A case with only one eligible distinct route may return one route truthfully. It must not create duplicates to satisfy a count.

## Partial-result policy

Expected partial cases are correct when they expose the exact evidence or fit limitation. The acceptance rate therefore separates expected from unexpected partials.

Per region:

- zero expected `routed` cases may become `partial` because of a contract, provenance, or implementation defect;
- no more than 20% of supported, unambiguous, route-producing cases may be unexpected partial results;
- the overall observed state must match at least 12 of 13 case expectations;
- any mismatch involving a false positive state fails the region; the single permitted mismatch, if any, must be a more conservative state with a documented evidence reason and independent review.

No aggregate allowance may convert an individual route into `productQualityOutcome: pass` when it is materially off target, outside its duration boundary, above 35% accidental repetition, missing a required strict reach, or carrying a forbidden claim. Aggregate thresholds measure regional consistency only; they do not waive per-route quality guards.

Missing current evidence never counts as a successful routed result. It must produce `partial`, `no_viable_route`, or `unsupported` according to the case contract.

## Evidence freshness and missing evidence

- OSM-derived Harz and Innsbruck evidence must be no older than 14 days and from a current accepted source snapshot.
- Exact region containment, zero cross-region entity contamination, zero quarantined rows, and complete lineage are mandatory.
- A current competent-authority restriction overrides mapped or tourism evidence.
- Missing, conflicting, expired, or unlicensed current evidence resolves to unknown.
- Required current opening, closure, water, public access, transport, or legal-status evidence that is unavailable blocks the positive claim and the fully routed state.
- Tourism pages may guide test design but cannot be promoted into runtime current-status proof.

## Feature flags and containment

Admission requires exact opt-in behavior:

- application provider flags enable only for string values that trim and case-normalize to `true`, `yes`, or `1`; every other value is disabled, while deployed and V4 operational admission remains stricter and permits only exact `true` or `false`;
- the ordinary iOS research-planning gate remains false until the backend regional gate is healthy and approved;
- backend research, V2 access, and route-provider gates are enabled only in dependency order and only for the admitted region/stage;
- every insecure/local/in-memory flag remains false outside the explicitly allowed Debug loopback mode;
- terminal cleanup proves every proof-only and provider flag false;
- regional binding rejects requests outside `harz-v1` or `innsbruck-alps-v1`;
- biking, point-to-point, out-and-back, multi-day, camping, and navigation remain outside the closed-beta research-guided surface.

The local strict-opt-in correction for `ROUTE_PROVIDER_ENABLED` and `INTENT_PROVIDER_ENABLED` is present at baseline `ed5803f21755ecbe4ed890fef1674562f95a66fe` with deterministic negative tests. Independent review, deployment admission, and a deployed flag-state receipt remain mandatory before any GO decision.

## Monitoring period

After operator-only admission:

- run at least 3 consecutive operating days with named daily review before any external invitation;
- run at least 7 consecutive days per regional invite stage before expansion;
- require at least two consecutive weekly reviews before combined expansion;
- low usage or missing measurements is `insufficient_data` and extends the monitoring window.

Daily review must include contract errors, provider results, routed/partial/no-route states, technical pipeline outcomes, product-quality outcomes, highlight approach states, distance fit, backtracking, freshness, regional isolation, privacy sanitizer, cancellations, and support incidents.

## Rollback triggers

Immediately pause invitations and disable backend/provider gates on:

- any zero-tolerance integrity failure;
- false highlight presentation or strict-contract mismatch;
- stale/wrong-region/quarantined evidence;
- provider circuit open without containment or accounting mismatch;
- hard-gate regression in a canonical case;
- unexpected partial rate above 20%;
- provider success below 90% after the minimum sample is reached;
- cancellation leak, rate-limit incident outside policy, or provider budget overrun;
- sensitive logging or receipt-integrity failure;
- unresolved high-severity support or safety-trust incident;
- inability to stop provider work or return flags to false.

Rollback is also required after any unproved change to route-quality thresholds, contracts, region definitions, migrations, source policy, provider configuration, App Attest, presentation semantics, or feature flags.

## Required regional decision receipt

A future `passed` receipt must identify, without sensitive detail:

- region, activities, route type, build/deployment/contract/policy versions;
- exact 13-case execution, state-match, technical-outcome-match, and product-outcome-match counts;
- manual review coverage and consensus count;
- hard-failure, must-have, distance, duration, backtracking, diversity, partial, and evidence-freshness results;
- provider accounting and monitoring window;
- zero-tolerance counters, all equal to zero;
- rollback drill and final flag-disabled result;
- accountable product, security, operations, privacy, and regional-data approvers.

V4 alone cannot produce this receipt. This task created no live evidence and makes no beta-readiness claim.
