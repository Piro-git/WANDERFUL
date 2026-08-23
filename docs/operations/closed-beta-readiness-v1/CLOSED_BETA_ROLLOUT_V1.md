# Closed-Beta Rollout V1

Status: **NO-GO — NO COHORT CREATED**

Current backend source boundary:
`0eaf7af8ab45ec1f4e7cd39239d8977e0d1bef95`. The stage sizes and observation
windows below are conservative proposals only; no cohort, duration, territory,
budget, SLA, or expansion target is owner-approved.

## Truthful initial surface

The first closed beta is limited to:

- the Harz (`harz-v1`) and Innsbruck Alpine Pilot
  (`innsbruck-alps-v1`) operational regions;
- hiking and trail-running loops;
- research-guided route suggestions with real provider geometry;
- strict V2 highlight-access lineage only after independent review and V4;
- explicit routed, partial, unsupported, unavailable, stale, unverified,
  passes-near, and not-reached states;
- planning assistance with weather, local rules, trail conditions, access, and
  water checks left to the participant.

Do not include or market global coverage, biking, point-to-point research,
multi-day planning, navigation, offline maps, weather, closures, verified water,
public/legal access, legal overnight stays, verified scenic quality, or route
safety. Contracts may represent broader inputs, but the beta is intentionally
narrower than what code can parse.

The current iOS location/permission surface is outside this backend audit and
must be verified independently. The backend does not itself prove participant
location. Geographic containment therefore relies on backend region binding,
supported-case admission, invite instructions, and monitoring. A request
outside the two pilot regions must remain unsupported/partial or use only a
separately documented legacy flow; it must not be silently treated as pilot
coverage.

## Global admission rule

No stage starts unless every mandatory item in `go-no-go-checklist-v1.json` is
`verified`, all critical alerts are clear, rollback has been rehearsed, and the
named product/security/operations approvers sign a new stage receipt. Missing
or insufficient data is NO-GO, not a waiver.

Each stage begins with backend gates and provider false. The operator verifies
`npm run ops:preflight`, liveness/readiness, infrastructure, backup/restore,
drain/restart, dependency outages, and rollback before enabling backend gates
in dependency order. A client build
with research/access true is distributed only after the corresponding backend
gate is healthy. Closing a stage returns gates false while results are reviewed.

## Stage 0 — Internal physical-device proof

Participants: one authorized internal operator and one supported iPhone.

Required evidence:

- full physical App Attest protocol and a separate production-environment
  TestFlight proof when that channel is in scope;
- one-call provider reconciliation, no sensitive receipt fields, final flags
  false;
- current regional staging and rollback evidence;
- no route-quality or beta claim derived from App Attest success.

Exit: all 15 security cases pass and the cleanup receipt is valid. Otherwise
remain NO-GO.

## Stage 1 — Operator-only route test

Participants: at most 3 named internal operators, at most 5 registered devices.

Scope: canonical Harz/Innsbruck hiking/trail-running loops only; no public
invites. Run for at least 3 operating days with daily review.

Required evidence:

- V4 database/provider/quality lanes passed separately;
- no critical/high open alerts, forbidden logs, contract mismatches, false
  verified claims, provider ceiling/rate incidents, or rollback failures;
- every returned route reviewed as a planning aid against unchanged quality
  policy; unsafe/legal/scenic claims absent;
- backend disablement observed within the approved propagation target.

Exit: daily owner sign-off and successful emergency-disable drill.

## Stage 2 — Harz invite-only cohort

Participants: up to 10 external invitees and up to 15 devices, Germany-first,
for at least 7 days.

Scope: Harz loops only. Innsbruck remains operator-only. Participants receive
clear supported-surface, privacy, support, planning-aid, and emergency-disable
copy before installation.

Daily review:

- App Attest/session success and rejection classes;
- Harz freshness/coverage/projection/index state;
- provider success/rate/timeout and circuit state;
- routed/partial/no-route and quality rejection counts;
- highlight reached/near/not-reached/unverified presentation counts;
- cancellations, invalid contracts, privacy sanitizer, and support incidents.

Exit: at least 7 days, sufficient volume for the defined thresholds, no
critical incident, no unresolved high incident, and a successful Harz import
rollback drill. Low usage is `insufficient_data` and does not justify expansion.

## Stage 3 — Innsbruck invite-only cohort

Participants: up to 10 external invitees and up to 15 devices, separate from or
within the already approved total, for at least 7 days.

Scope: Innsbruck pilot loops only. The Harz cohort does not automatically grant
this stage because source density, terrain, provider graph behavior, and prior
viewpoint/easy-case failures differ.

Admission adds:

- current Innsbruck import/projection and access-query performance;
- passing viewpoint and conservative-easy canonical results with truthful
  reached/near/not-reached/unverified states;
- no claim that mapped trail proximity proves public access or easy terrain;
- successful Innsbruck import rollback drill.

Exit uses the same daily-review and incident criteria as Harz.

## Stage 4 — Combined gradual increase

Participants: first up to 25 total invitees, then up to 50 only after a separate
GO receipt. No automatic percentage rollout.

Conditions for each increase:

- both regional stages completed their minimum windows;
- two consecutive weekly reviews pass all security, privacy, freshness,
  provider, database, quality, support, and rollback criteria;
- participant/device/cost capacity remains within App Attest, database,
  provider, and on-call budgets;
- alert windows contain enough observations; no `insufficient_data` metric is
  used as evidence of health;
- the exact build/deployment/import/contract combination is unchanged or a new
  admission proof covers the change.

The proposed V1 plan ends at 50 invitees. Any broader cohort, additional region,
activity, route type, or navigation surface requires a new rollout version.

## Expansion criteria

All must be true:

- physical App Attest registration/assertion/session/replay/expiry evidence is
  current for the distributed channel and build class;
- both databases/imports/projections are current, isolated, indexed, backed up,
  and within latency gates;
- provider credential, cost, rate, circuit, and rotation owners are healthy;
- V4 and the accepted golden-set lane show no unresolved canonical regression;
- strict iOS V2 presentation never upgrades mapped evidence to access, safety,
  scenery, opening, or route-reach guarantees;
- privacy sanitizer and receipt integrity have zero failures;
- emergency backend disablement, provider stop, deployment rollback, and both
  regional import rollbacks are rehearsed;
- support response, incident on-call, privacy/legal, and product decision owners
  are available for the whole stage.

## Pause and rollback criteria

Pause invitations immediately on any high alert or lack of daily owner review.
Execute emergency disablement on any critical alert, including:

- feature-off downstream work or provider budget overrun;
- App Attest application/environment mismatch;
- stale regional evidence or wrong-region projection;
- provider circuit open without containment;
- cancellation with provider work or lease leak;
- invalid strict contract or false verified-highlight presentation;
- sensitive logging/receipt field or receipt-integrity failure;
- inability to stop backend/provider traffic.

Do not wait for an App Store/TestFlight client update to contain a backend
incident. Backend gates and provider stop are first.

## Change policy during beta

Any code, migration, App Attest verifier, entitlement/signing, dependency,
provider configuration, region definition, import/projection policy, quality
threshold, contract, presentation, observability schema, or rollback change
invalidates the affected admission evidence. Classify the change, rerun the
smallest sufficient mandatory gates, and issue a new GO receipt before further
expansion.

Quality thresholds are never relaxed to make a cohort pass. A route may be
unavailable or partial; it may not be made “verified” by weakening the contract.

## Participant communication

Before invitation, provide:

- exact supported regions, activities, and loop-only scope;
- “AI-assisted route. Review before starting.” and reminders to check weather,
  local rules, trail conditions, access, and water availability;
- explanation that requested/mapped highlights are not scenic, safe, open,
  legal, or publicly accessible guarantees;
- privacy summary, retention, support channel, incident reporting, and deletion
  request path;
- emergency-disable behavior and possibility that research planning becomes
  unavailable without legacy substitution.

Metadata, screenshots, and invitation copy must match actual live behavior and
must not advertise planned features.

## Current decisions needed from the owner

- final cohort/device ceilings and territory;
- participant eligibility, consent/information flow, support SLA, and emergency
  communications;
- daily/weekly review and GO approvers;
- provider and infrastructure budgets;
- final retention/deletion and public privacy/support locations;
- whether the build-time client kill-switch limitation is acceptable for a
  closed beta given the immediate backend kill path;
- conditions for ending, extending, or retiring the beta.

## Public-release promotion boundary

Closed-beta evidence does not automatically authorize public release. Public
promotion requires a new exact-candidate review covering public capacity and
abuse controls, provider/commercial authorization, privacy/legal/support
commitments, public incident/on-call coverage, restore and rollback at expected
load, all distributed build classes, configuration drift, and any expanded
region/activity/product claim. Until that separate decision is recorded, the
public state remains NO-GO even if a closed-beta stage passes.
