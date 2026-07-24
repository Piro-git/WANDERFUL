# TrailMind Outdoor Research Evidence Graph V2

## Status, purpose, and non-goals

This package freezes an additive database and contract foundation for a future TrailMind outdoor research agent. It does not perform research, call providers, generate routes, or make new product claims. Migration `004_osm_outdoor_research_projection.sql` now adds the first offline, operator-controlled adapter into this graph; its narrower contract is documented in `OSM_OUTDOOR_RESEARCH_PROJECTION_V1.md`.

It adds:

- a source-independent canonical identity layer above the existing regional OSM imports;
- append-only, temporal, provenance-bearing assertions that retain disagreement;
- provenance-bearing relationships, versioned derived-feature records, and append-only observations;
- five strict, versioned JavaScript contracts and runtime validators;
- a deliberately narrow evidence resolver with `known`, `conflicted`, `stale`, `unavailable`, and `unknown` results.

It does not add an LLM, OpenAI, search, crawling, scraping, source adapters, live provider calls, route waypoints, GraphHopper shaping, ranking changes, user submissions, accounts, production infrastructure, iOS UI, or feature enablement. `OUTDOOR_EVIDENCE_ENABLED` remains `false` in tracked configuration.

## Boundary with the regional OSM foundation

Migration `002_outdoor_evidence.sql` remains the immutable, source-specific import layer. Its `outdoor_evidence_*` tables continue to answer the bounded corridor question for an already-generated route. Migration `003_outdoor_research_graph.sql` does not alter those tables or their importer, query, endpoint, or Swift provider.

The layers have different responsibilities:

| Layer | Identity | Data meaning | Mutation model |
| --- | --- | --- | --- |
| `outdoor_evidence_*` | OSM object identity within an immutable regional import | What OSM mapped near routed geometry | Whole regional imports are immutable and atomically promoted |
| `outdoor_research_*` | TrailMind-owned canonical identities linked to one or more external identities | Claim-level evidence, conflicts, temporal state, relationships, computations, and observations | Assertions, relationships, derived features, and observations are append-only |

The first approved adapter may now read a promoted `outdoor_evidence_*` import and write narrowly scoped normalized mapped assertions and route-membership relationships into `outdoor_research_*`. It is offline, operator-invoked, exact-policy-gated, and limited to reviewed OSM facts. The canonical entity remains an identity container; a stored canonical geometry helps identity resolution but is not, by itself, an authoritative source claim.

## Canonical graph tables

### `outdoor_research_sources`

The registry gives every reviewed source a stable UUID and key. It bounds source name, owner/operator, category, authority class, license identifier, attribution requirements, canonical origin, normalization/derivation permissions, geographic coverage, expected refresh interval, lifecycle, last successful retrieval, and adapter schema version. Registry membership and a broad category do not by themselves authorize normalized assertions.

The source categories are:

- `official_authority`
- `official_operator`
- `openstreetmap_open_mapping`
- `wikimedia_open_knowledge`
- `licensed_partner`
- `trailmind_community`
- `derived_computation`
- `model_inference`

Category is provenance, not a universal truth score. An official operator may be authoritative about its own opening status but not about an unrelated trail. A mapped source may establish that a feature is mapped but not that it is open, legal, safe, flowing, or beautiful. Credentials and authentication material do not belong in this registry.

### `outdoor_research_source_authority_scopes`

Every normalized assertion requires an active, reviewed authority scope for the exact source, predicate, and canonical entity category. A scope records its review reference and review time. Missing, retired, or merely category-implied authority fails closed. The assertion trigger also requires the source itself to be active and `normalized_facts_allowed = true`.

Derived-feature authorization is separate: a derived feature requires an identified active source with `derived_features_allowed = true`. An assertion scope does not grant derived-feature permission, and derived-feature permission does not grant assertion authority.

### `outdoor_research_entities` and aliases

Canonical entities use TrailMind-owned UUIDs and a bounded category:

- viewpoint, waterfall, peak, lake;
- alpine hut, wilderness hut, official campsite, designated bivouac, emergency shelter;
- trailhead, landmark, hiking route, trail segment, region, organization.

Optional geometry is two-dimensional EPSG:4326, non-empty, valid, and wholly inside finite WGS84 bounds. A GiST index supports later spatial identity work. Lifecycle is explicit (`candidate`, `active`, `disputed`, `merged`, or `retired`).

Aliases are bounded, language-aware, source-attributable, and separately lifecycle-managed. They do not turn a name into an unqualified authoritative property.

### `outdoor_research_source_entities`

Source identities are linked to canonical entities with an external type/ID, matching state, matching method, matching time, and review state. One source/type/ID may resolve to only one canonical entity. Multiple `candidate` or `conflicted` links may coexist so ambiguous matching remains unresolved and auditable. No fuzzy merge or automatic entity resolution is implemented.

### `outdoor_research_assertions`

Assertions are immutable claim records. Each stores:

- canonical entity and source;
- a bounded predicate;
- exactly one typed value column;
- evidence class;
- observed, retrieved, valid-from, and valid-until times;
- explicit freshness;
- source-specific provenance identifier;
- assertion/supersession state and optional resolution group.

Supported predicates cover entity category, name, operator, access, opening, seasonal opening, overnight permission, bookability, drinking water, trail difficulty/visibility, mapped viewpoint/waterfall presence, hiking-route membership, and closure status.

Values are not arbitrary JSON. Predicate-to-type checks enforce booleans, bounded enums, text, or entity references as appropriate. `NULL` or a missing row means no evidence; it is never rewritten to `false`, zero, open, permitted, safe, easy, or legal.

Direct updates and deletes are rejected by an append-only trigger. A correction is another assertion with explicit supersession provenance. A supersession or retraction target must exist, share the same canonical entity, predicate, and source, and be temporally earlier by retrieval and creation time (and observation time when both are present). A retraction cannot itself be targeted. Foreign keys use restrictive deletion, so deleting a source or entity cannot cascade away audit evidence.

### `outdoor_research_relationships`

Bounded relationships include containment, POI-to-route connection, hut operator, route membership, viewpoint-to-feature, proximity, and assertion supersession. A relationship targets either two entities or two assertions, never an untyped mixture. Every relationship has a source/evidence class or an explicit derived classification and computation version.

Relationships are append-only. Their source-class trigger rejects attempts to relabel OSM as official, community as official, model output as official, or derived output as official.

### `outdoor_research_derived_features`

This table reserves versioned, append-only records for terrain viewshed, horizon openness, prominence, detour cost, POI-to-route distance, official hiking-network coverage, trail-quality ratios, evidence confidence, seasonal relevance, and aggregated community value.

Every record has exactly one entity or relationship target, one typed value, `evidence_class = 'derived'`, an active source explicitly approved for derived features, a computation version, an input-data version/provenance reference, calculation time, and explicit validity/freshness. Derived values live beside source assertions and never overwrite or become official assertions. No DEM, viewshed, scoring, or aggregation computation is implemented here. Evidence-confidence features are internal evidence metadata and are not a user-facing percentage.

### `outdoor_research_observations`

Observations are separate append-only records for temporary trail condition, closure, waterfall flow, hut status, route-finding difficulty, crowding, and highlight confirmation. Values use small type-specific vocabularies. Records contain no track geometry, personal location history, account ID, reputation, or passive telemetry.

An observation remains an observation even when corroborated. It does not automatically become an assertion or resolve a fact. Submission, identity, moderation policy, corroboration, and conversion into evidence are separate future work.

## Evidence classes and source enforcement

| Evidence class | Meaning | May independently resolve high-stakes predicates? |
| --- | --- | --- |
| `official` | Current claim from an appropriate authority/operator source | Only when temporally current and unconflicted |
| `mapped` | Feature/tag/relationship is mapped in an approved open source | No |
| `community_observed` | A bounded observation-derived claim | No |
| `derived` | Reproducible computation over identified inputs | No |
| `model_inferred` | Model-generated inference | No |
| `unknown` | Source classification cannot establish a stronger class | No |

The database rejects mismatches for the source categories with a single valid evidence class: authority/operator, OSM/Wikimedia, TrailMind community, derived computation, and model inference. A licensed partner remains claim-specific and requires adapter review rather than a global promotion rule. For assertions, matching the category is only the first gate: the source must also be active, approved for normalized facts, and covered by a reviewed predicate/entity-category authority scope.

## Temporal state, conflicts, and resolution

An assertion can carry an observed time, retrieval time, valid interval, and freshness state. Timestamp checks reject inverted validity and a claim already expired when labeled current. Runtime resolution independently evaluates validity at the requested `now`; a previously current assertion whose `validUntil` has passed becomes stale for selection without mutating history.

Conflicting claims coexist. The resolver does not calculate a source score or probability:

1. Select one canonical entity and predicate.
2. Exclude future, stale, expired, or unavailable claims from current selection and honor each claim's explicit resolution state.
3. For access, opening, seasonal opening, overnight legality, bookability, drinking water, and closure, require official evidence.
4. Return `conflicted` when current authoritative values disagree.
5. Return `known` only when eligible current claims are explicitly `known` and their values agree.
6. Return `stale`, `unavailable`, or `unknown` without manufacturing a value.

The resolver returns typed values, evidence classes, claim IDs, and limitation codes. It emits no confidence percentage.

## High-stakes trust invariants

- A mapped hut establishes only mapped hut identity/category; it does not establish current opening.
- A mapped shelter does not establish legal overnight use.
- A mapped viewpoint does not establish a beautiful view.
- A mapped waterfall does not establish current flow or drinking water.
- Missing access evidence remains unknown and never becomes permission.
- Community reports cannot independently resolve legal access, safety, official closure, or overnight legality.
- Model inference cannot independently resolve high-stakes claims.
- Safety is not an assertion predicate in V2, so no source can create a generic “safe” claim.
- Derived features remain `derived` and cannot overwrite source assertions.
- Stale or expired evidence is excluded from current resolution.
- Conflicting current authoritative assertions return `conflicted`.
- Unknown is distinct from `false`, zero, unavailable, and stale.
- No user-facing confidence percentage exists in these contracts.

## Versioned research contracts

The authoritative checked-in artifacts are:

- `backend/src/outdoorResearch/contracts.js`: versions, vocabularies, bounds, and field manifest;
- `backend/src/outdoorResearch/validation.js`: strict runtime validators and deterministic serialization;
- `backend/src/outdoorResearch/evidenceResolution.js`: validated public resolution entry point;
- `backend/src/outdoorResearch/evidenceResolutionCore.js`: shared narrow temporal/high-stakes resolution semantics used by the resolver and dossier validator.

All five contracts use `schemaVersion: 1`, reject unknown fields at every validated boundary, bound arrays/strings/serialized bytes, and normalize timestamps and UUIDs. They accept no executable instructions.

Date and UTC timestamp parsing is calendar-strict: impossible dates such as `2026-02-30` are rejected rather than normalized. Dossier references are semantic, not merely syntactic. Highlight and entity-candidate claims must belong to their referenced entity and support its category; relevance codes must have compatible predicate/category/class evidence; entity-candidate source basis must match the referenced evidence classes; time-sensitive checks must match the declared cohort and actually resolve to their declared complete/conflicted state; and conflict groups must match one cohort and actually resolve `conflicted`.

| Contract | Purpose | Key exclusions |
| --- | --- | --- |
| `AdventureResearchIntentV1` | Typed activity, anchor/clarification, route type, ranges, technical ceiling, counted must-have experiences, preferences, avoidances, facilities, group, date/season, overnight, transport | Original prompt and route geometry |
| `ResearchPlanV1` | At most 24 typed operations stating the information need, reason, entity/predicate scope, and approved source categories | SQL, shell, provider URLs, recursive plans, geometry |
| `EvidenceClaimV1` | Typed claim, source/provenance, temporal state, resolution state, limitations | Persuasive prose, unbounded excerpts |
| `HighlightCandidateV1` | Canonical highlight, coordinate, structured reasons, claim references, limitations, suitability/uncertainty | Route geometry and unsupported “beautiful/scenic” claims |
| `AdventureResearchDossierV1` | Bounded research input with normalized intent, coverage, claims, highlights, route/overnight candidates, checks, conflicts, gaps, questions, source summary, expiry | Route polyline, invented route metrics, HTML, scraped pages, hidden reasoning, credentials |

Serialized ceilings are 48 KiB for intent, 64 KiB for plan, 16 KiB per claim/candidate, and 512 KiB for a dossier. Dossiers allow at most 160 claims, 32 highlights, 24 route candidates, 24 overnight candidates, and 48 source summaries.

## Adapter write path

Every approved adapter must:

1. Register or locate its active source with reviewed licensing and storage permissions.
2. Register an active reviewed authority scope for every predicate/entity-category pair the adapter may assert; broad source category is insufficient.
3. Persist the immutable source retrieval/import receipt outside credentials.
4. Locate an exact reviewed source-entity link or write unresolved candidates; do not fuzzy-merge.
5. Append one typed assertion per source record/predicate with its provenance and temporal bounds.
6. Append relationships only when the source or a versioned computation supports them.
7. Write computations only to the derived-feature table with the exact algorithm/input versions and separate derived-feature permission.
8. Never update an older assertion, relationship, feature, or observation in place.

Adapters must not copy raw webpages, unbounded text, authentication data, secret URLs, or source content that the license does not permit TrailMind to retain.

## Future research-agent read path

A future research agent should receive a validated `AdventureResearchIntentV1`, emit a validated `ResearchPlanV1`, query only approved bounded repositories, validate every `EvidenceClaimV1` and `HighlightCandidateV1`, run deterministic evidence resolution, and assemble a validated `AdventureResearchDossierV1`.

The dossier is input to a later route generator. It is not a route result and cannot contain actual route geometry, distance, elevation, or duration. A routing engine must still calculate those facts later.

## Privacy and licensing boundaries

- Source licenses and attribution requirements are first-class registry fields.
- Storage/derivation permissions default false and require review.
- No credential, authentication payload, secret URL, raw scraped page, or arbitrary HTML belongs in the graph or dossier.
- Observations contain no user identity or precise personal track.
- A future user-submission system requires separate consent, retention, deletion, abuse, moderation, and legal review.
- OSM-derived facts remain mapped evidence under the applicable ODbL/attribution obligations.
- This schema is not authorization to ingest any official, operator, Wikimedia, partner, or community source.

## Migration, repeatability, and rollback

`003_outdoor_research_graph.sql` and `004_osm_outdoor_research_projection.sql` are additive and safe for the existing lexically ordered migration runner. Every table/index uses idempotent creation, trigger creation checks catalog state, functions are replaced deterministically, and a second migration-runner invocation sees each recorded version and performs no work.

There is intentionally no automatic destructive down migration. Rollback means disabling future readers/writers in application code while retaining evidence for audit. If pre-production removal is explicitly approved, an operator must first prove there are no consumers, export required audit data, and drop objects in reviewed dependency order. Production deletion/retention policy is a separate operational and legal decision.

The migrations create no source rows, no entities, no claims, and no production enablement. Migration `004` source/policy activation is a separate explicit reviewed operator action.

## Complete Innsbruck example

The request is: “An easy four-hour loop near Innsbruck with two viewpoints, a waterfall and a hut for lunch. Avoid exposed trails.” The example freezes research input only. It contains no route geometry and makes no claim that the eventual route meets the requested distance, duration, elevation, safety, or exposure constraints.

### Structured intent

```json
{
  "schemaVersion": 1,
  "activity": "hiking",
  "geographicAnchor": {
    "state": "resolved",
    "name": "Innsbruck",
    "coordinate": { "latitude": 47.2692, "longitude": 11.4041 },
    "regionEntityId": "30000000-0000-4000-8000-000000000001"
  },
  "routeType": "loop",
  "distanceRangeKm": null,
  "durationRangeMinutes": { "min": 210, "max": 270 },
  "maximumElevationGainMeters": null,
  "maximumTechnicalDifficulty": "hiking",
  "mustHaveExperiences": [
    { "experience": "viewpoint", "minimumCount": 2 },
    { "experience": "waterfall", "minimumCount": 1 }
  ],
  "preferredExperiences": ["alpine_hut"],
  "avoidedExperiences": ["exposed_trails"],
  "requiredFacilities": ["lunch_hut"],
  "groupContext": {
    "partySize": 2,
    "includesChildren": false,
    "youngestAge": null,
    "mobility": "standard",
    "experienceLevel": "beginner"
  },
  "dateOrSeason": { "kind": "season", "season": "summer", "year": 2026 },
  "overnightRequirements": {
    "required": false,
    "nights": 0,
    "allowedAccommodationTypes": []
  },
  "transportRequirements": {
    "arrivalMode": "public_transport",
    "returnToStart": true,
    "publicTransportRequired": false
  },
  "unresolvedClarificationQuestions": []
}
```

### Research plan

```json
{
  "schemaVersion": 1,
  "intentSchemaVersion": 1,
  "operations": [
    {
      "operationId": "discover_required_highlights",
      "operationType": "discover_highlights",
      "informationNeed": "highlight_candidates",
      "reasonCode": "must_have_experience",
      "acceptableSourceCategories": ["openstreetmap_open_mapping", "official_authority"],
      "entityCategories": ["viewpoint", "waterfall", "alpine_hut"],
      "predicates": ["entity_category", "viewpoint_presence", "waterfall_presence"]
    },
    {
      "operationId": "retrieve_hiking_network",
      "operationType": "retrieve_mapped_hiking_routes",
      "informationNeed": "mapped_hiking_routes",
      "reasonCode": "coverage_gap",
      "acceptableSourceCategories": ["openstreetmap_open_mapping", "official_authority"],
      "entityCategories": ["hiking_route", "trail_segment"],
      "predicates": ["mapped_hiking_route_membership", "trail_difficulty", "trail_visibility"]
    },
    {
      "operationId": "check_exposure_constraints",
      "operationType": "analyze_terrain",
      "informationNeed": "terrain_characteristics",
      "reasonCode": "avoidance_constraint",
      "acceptableSourceCategories": ["derived_computation", "official_authority"],
      "entityCategories": ["trail_segment", "viewpoint"],
      "predicates": ["trail_difficulty", "trail_visibility"]
    },
    {
      "operationId": "verify_hut_lunch_status",
      "operationType": "check_current_status",
      "informationNeed": "opening_and_operating_status",
      "reasonCode": "required_facility",
      "acceptableSourceCategories": ["official_operator", "official_authority"],
      "entityCategories": ["alpine_hut"],
      "predicates": ["current_opening", "seasonal_opening", "bookability"]
    },
    {
      "operationId": "inspect_access",
      "operationType": "inspect_access_evidence",
      "informationNeed": "access_and_legal_status",
      "reasonCode": "high_stakes_verification",
      "acceptableSourceCategories": ["official_authority", "official_operator"],
      "entityCategories": ["viewpoint", "waterfall", "alpine_hut", "trail_segment"],
      "predicates": ["public_access", "access_restriction", "closure_status"]
    }
  ]
}
```

### Evidence claims, conflicts, and gaps

The final dossier below contains six complete claims:

- C1 and C2: two OSM-mapped viewpoint entities;
- C3: one OSM-mapped waterfall entity, without a current-flow claim;
- C4: one OSM-mapped alpine hut, without implying that it is open;
- C5 and C6: conflicting current official/operator claims about the hut’s opening state.

The mapped claims carry `mapped_presence_only`. The conflicting official claims remain side by side; the dossier records the conflict and does not select the hut as a confirmed lunch facility. Access, exposure, route connection, and current waterfall conditions remain explicit evidence gaps.

### Highlight candidates

The dossier includes two mapped viewpoint candidates, one mapped waterfall candidate, and one hut candidate with conflicted opening evidence. “Mapped viewpoint” is permitted; “beautiful viewpoint” is not. No candidate contains route geometry.

### Final research dossier

```json
{
  "schemaVersion": 1,
  "normalizedIntent": {
    "schemaVersion": 1,
    "activity": "hiking",
    "geographicAnchor": {
      "state": "resolved",
      "name": "Innsbruck",
      "coordinate": { "latitude": 47.2692, "longitude": 11.4041 },
      "regionEntityId": "30000000-0000-4000-8000-000000000001"
    },
    "routeType": "loop",
    "distanceRangeKm": null,
    "durationRangeMinutes": { "min": 210, "max": 270 },
    "maximumElevationGainMeters": null,
    "maximumTechnicalDifficulty": "hiking",
    "mustHaveExperiences": [
      { "experience": "viewpoint", "minimumCount": 2 },
      { "experience": "waterfall", "minimumCount": 1 }
    ],
    "preferredExperiences": ["alpine_hut"],
    "avoidedExperiences": ["exposed_trails"],
    "requiredFacilities": ["lunch_hut"],
    "groupContext": {
      "partySize": 2,
      "includesChildren": false,
      "youngestAge": null,
      "mobility": "standard",
      "experienceLevel": "beginner"
    },
    "dateOrSeason": { "kind": "season", "season": "summer", "year": 2026 },
    "overnightRequirements": {
      "required": false,
      "nights": 0,
      "allowedAccommodationTypes": []
    },
    "transportRequirements": {
      "arrivalMode": "public_transport",
      "returnToStart": true,
      "publicTransportRequired": false
    },
    "unresolvedClarificationQuestions": []
  },
  "regionCoverage": {
    "state": "partial",
    "regionEntityIds": ["30000000-0000-4000-8000-000000000001"],
    "limitationCodes": ["partial_regional_coverage"]
  },
  "evidenceClaims": [
    {
      "schemaVersion": 1,
      "claimId": "10000000-0000-4000-8000-000000000001",
      "entityId": "20000000-0000-4000-8000-000000000001",
      "predicate": "entity_category",
      "value": { "type": "text", "value": "viewpoint" },
      "evidenceClass": "mapped",
      "sourceReference": {
        "sourceId": "a0000000-0000-4000-8000-000000000001",
        "sourceKey": "openstreetmap.innsbruck-v1",
        "sourceCategory": "openstreetmap_open_mapping"
      },
      "provenance": { "identifier": "node/101", "adapterVersion": "osm-v1", "recordVersion": 3 },
      "observedAt": "2026-07-20T08:00:00Z",
      "retrievedAt": "2026-07-20T09:00:00Z",
      "validFrom": null,
      "validUntil": null,
      "freshness": "current",
      "resolutionState": "known",
      "relevantLimitationCodes": ["mapped_presence_only"]
    },
    {
      "schemaVersion": 1,
      "claimId": "10000000-0000-4000-8000-000000000002",
      "entityId": "20000000-0000-4000-8000-000000000002",
      "predicate": "entity_category",
      "value": { "type": "text", "value": "viewpoint" },
      "evidenceClass": "mapped",
      "sourceReference": {
        "sourceId": "a0000000-0000-4000-8000-000000000001",
        "sourceKey": "openstreetmap.innsbruck-v1",
        "sourceCategory": "openstreetmap_open_mapping"
      },
      "provenance": { "identifier": "node/102", "adapterVersion": "osm-v1", "recordVersion": 2 },
      "observedAt": "2026-07-20T08:00:00Z",
      "retrievedAt": "2026-07-20T09:00:00Z",
      "validFrom": null,
      "validUntil": null,
      "freshness": "current",
      "resolutionState": "known",
      "relevantLimitationCodes": ["mapped_presence_only"]
    },
    {
      "schemaVersion": 1,
      "claimId": "10000000-0000-4000-8000-000000000003",
      "entityId": "20000000-0000-4000-8000-000000000003",
      "predicate": "entity_category",
      "value": { "type": "text", "value": "waterfall" },
      "evidenceClass": "mapped",
      "sourceReference": {
        "sourceId": "a0000000-0000-4000-8000-000000000001",
        "sourceKey": "openstreetmap.innsbruck-v1",
        "sourceCategory": "openstreetmap_open_mapping"
      },
      "provenance": { "identifier": "node/103", "adapterVersion": "osm-v1", "recordVersion": 5 },
      "observedAt": "2026-07-20T08:00:00Z",
      "retrievedAt": "2026-07-20T09:00:00Z",
      "validFrom": null,
      "validUntil": null,
      "freshness": "current",
      "resolutionState": "known",
      "relevantLimitationCodes": ["mapped_presence_only", "water_availability_unverified"]
    },
    {
      "schemaVersion": 1,
      "claimId": "10000000-0000-4000-8000-000000000004",
      "entityId": "20000000-0000-4000-8000-000000000004",
      "predicate": "entity_category",
      "value": { "type": "text", "value": "alpine_hut" },
      "evidenceClass": "mapped",
      "sourceReference": {
        "sourceId": "a0000000-0000-4000-8000-000000000001",
        "sourceKey": "openstreetmap.innsbruck-v1",
        "sourceCategory": "openstreetmap_open_mapping"
      },
      "provenance": { "identifier": "node/104", "adapterVersion": "osm-v1", "recordVersion": 8 },
      "observedAt": "2026-07-20T08:00:00Z",
      "retrievedAt": "2026-07-20T09:00:00Z",
      "validFrom": null,
      "validUntil": null,
      "freshness": "current",
      "resolutionState": "known",
      "relevantLimitationCodes": ["mapped_presence_only", "opening_unverified"]
    },
    {
      "schemaVersion": 1,
      "claimId": "10000000-0000-4000-8000-000000000005",
      "entityId": "20000000-0000-4000-8000-000000000004",
      "predicate": "current_opening",
      "value": { "type": "boolean", "value": true },
      "evidenceClass": "official",
      "sourceReference": {
        "sourceId": "b0000000-0000-4000-8000-000000000001",
        "sourceKey": "tirol.authority",
        "sourceCategory": "official_authority"
      },
      "provenance": { "identifier": "hut-status/104", "adapterVersion": "authority-v1", "recordVersion": 1 },
      "observedAt": "2026-07-20T07:00:00Z",
      "retrievedAt": "2026-07-20T09:00:00Z",
      "validFrom": "2026-07-20T07:00:00Z",
      "validUntil": "2026-07-20T17:00:00Z",
      "freshness": "current",
      "resolutionState": "known",
      "relevantLimitationCodes": []
    },
    {
      "schemaVersion": 1,
      "claimId": "10000000-0000-4000-8000-000000000006",
      "entityId": "20000000-0000-4000-8000-000000000004",
      "predicate": "current_opening",
      "value": { "type": "boolean", "value": false },
      "evidenceClass": "official",
      "sourceReference": {
        "sourceId": "c0000000-0000-4000-8000-000000000001",
        "sourceKey": "innsbruck.hut-operator",
        "sourceCategory": "official_operator"
      },
      "provenance": { "identifier": "operator-status/104", "adapterVersion": "operator-v1", "recordVersion": 4 },
      "observedAt": "2026-07-20T08:30:00Z",
      "retrievedAt": "2026-07-20T09:05:00Z",
      "validFrom": "2026-07-20T08:30:00Z",
      "validUntil": "2026-07-20T17:00:00Z",
      "freshness": "current",
      "resolutionState": "known",
      "relevantLimitationCodes": []
    }
  ],
  "candidateHighlights": [
    {
      "schemaVersion": 1,
      "entityId": "20000000-0000-4000-8000-000000000001",
      "highlightCategory": "viewpoint",
      "coordinate": { "latitude": 47.285, "longitude": 11.42 },
      "relevanceReasons": [{
        "code": "mapped_viewpoint",
        "evidenceClaimIds": ["10000000-0000-4000-8000-000000000001"]
      }],
      "evidenceClaimIds": ["10000000-0000-4000-8000-000000000001"],
      "knownLimitations": ["mapped_presence_only", "access_unverified"],
      "suitabilityState": "conditional",
      "uncertaintyState": "insufficient_evidence"
    },
    {
      "schemaVersion": 1,
      "entityId": "20000000-0000-4000-8000-000000000002",
      "highlightCategory": "viewpoint",
      "coordinate": { "latitude": 47.278, "longitude": 11.44 },
      "relevanceReasons": [{
        "code": "mapped_viewpoint",
        "evidenceClaimIds": ["10000000-0000-4000-8000-000000000002"]
      }],
      "evidenceClaimIds": ["10000000-0000-4000-8000-000000000002"],
      "knownLimitations": ["mapped_presence_only", "access_unverified"],
      "suitabilityState": "conditional",
      "uncertaintyState": "insufficient_evidence"
    },
    {
      "schemaVersion": 1,
      "entityId": "20000000-0000-4000-8000-000000000003",
      "highlightCategory": "waterfall",
      "coordinate": { "latitude": 47.255, "longitude": 11.39 },
      "relevanceReasons": [{
        "code": "mapped_waterfall",
        "evidenceClaimIds": ["10000000-0000-4000-8000-000000000003"]
      }],
      "evidenceClaimIds": ["10000000-0000-4000-8000-000000000003"],
      "knownLimitations": ["mapped_presence_only", "water_availability_unverified"],
      "suitabilityState": "conditional",
      "uncertaintyState": "insufficient_evidence"
    },
    {
      "schemaVersion": 1,
      "entityId": "20000000-0000-4000-8000-000000000004",
      "highlightCategory": "alpine_hut",
      "coordinate": { "latitude": 47.29, "longitude": 11.45 },
      "relevanceReasons": [{
        "code": "facility_match",
        "evidenceClaimIds": [
          "10000000-0000-4000-8000-000000000004",
          "10000000-0000-4000-8000-000000000005",
          "10000000-0000-4000-8000-000000000006"
        ]
      }],
      "evidenceClaimIds": [
        "10000000-0000-4000-8000-000000000004",
        "10000000-0000-4000-8000-000000000005",
        "10000000-0000-4000-8000-000000000006"
      ],
      "knownLimitations": ["conflicting_authoritative_evidence", "access_unverified"],
      "suitabilityState": "unknown",
      "uncertaintyState": "conflicted"
    }
  ],
  "mappedOrOfficialRouteCandidates": [],
  "overnightCandidates": [],
  "timeSensitiveChecks": [
    {
      "entityId": "20000000-0000-4000-8000-000000000004",
      "predicate": "current_opening",
      "state": "conflicted",
      "evidenceClaimIds": [
        "10000000-0000-4000-8000-000000000005",
        "10000000-0000-4000-8000-000000000006"
      ]
    }
  ],
  "conflictingEvidence": [
    {
      "entityId": "20000000-0000-4000-8000-000000000004",
      "predicate": "current_opening",
      "evidenceClaimIds": [
        "10000000-0000-4000-8000-000000000005",
        "10000000-0000-4000-8000-000000000006"
      ]
    }
  ],
  "evidenceGaps": [
    {
      "code": "missing_access_evidence",
      "entityId": "20000000-0000-4000-8000-000000000001",
      "predicate": "public_access"
    },
    {
      "code": "missing_access_evidence",
      "entityId": "20000000-0000-4000-8000-000000000002",
      "predicate": "public_access"
    },
    {
      "code": "missing_current_conditions",
      "entityId": "20000000-0000-4000-8000-000000000003",
      "predicate": null
    },
    {
      "code": "missing_route_connection",
      "entityId": null,
      "predicate": "mapped_hiking_route_membership"
    }
  ],
  "unresolvedQuestions": [],
  "sourceProvenanceSummary": [
    {
      "sourceId": "a0000000-0000-4000-8000-000000000001",
      "sourceKey": "openstreetmap.innsbruck-v1",
      "sourceCategory": "openstreetmap_open_mapping",
      "evidenceClasses": ["mapped"],
      "licenseIdentifier": "ODbL-1.0",
      "attributionRequired": true,
      "retrievedAt": "2026-07-20T09:00:00Z"
    },
    {
      "sourceId": "b0000000-0000-4000-8000-000000000001",
      "sourceKey": "tirol.authority",
      "sourceCategory": "official_authority",
      "evidenceClasses": ["official"],
      "licenseIdentifier": "review-required",
      "attributionRequired": true,
      "retrievedAt": "2026-07-20T09:00:00Z"
    },
    {
      "sourceId": "c0000000-0000-4000-8000-000000000001",
      "sourceKey": "innsbruck.hut-operator",
      "sourceCategory": "official_operator",
      "evidenceClasses": ["official"],
      "licenseIdentifier": "review-required",
      "attributionRequired": true,
      "retrievedAt": "2026-07-20T09:05:00Z"
    }
  ],
  "generatedAt": "2026-07-20T10:00:00Z",
  "expiresAt": "2026-07-20T16:00:00Z",
  "freshnessState": "current"
}
```

The dossier deliberately stops at research. A later route candidate generator must still prove route geometry and actual distance, duration, elevation, exposure, and connectivity with the routing/evidence engines.

## Next tasks, not implemented here

1. Harz/Innsbruck authoritative source and licensing inventory.
2. Research-agent evaluation corpus.
3. Source adapters and canonical entity resolution.
4. Terrain/viewshed highlight features.
5. Research Agent v1 orchestration.
6. POI-aware GraphHopper candidate generation.
