# Shared Gemini research contract

Branch: `codex/research-contract-20261012`. Continues the optional-content fix; historical handoffs are context.

## Evidence / metadata matrix

| Field | Primary contract | Shared correction |
| --- | --- | --- |
| Interaction.steps, tool id / call_id | Steps and correlated calls/results describe actual tool execution | Preserve; reject missing/mismatched/duplicate IDs, failed/partial responses |
| Search arguments.queries | Optional array | Unknown count when omitted; correlated successful search count separately required |
| Result.search_suggestions | Optional HTML | Preserve all supplied HTML unchanged; absence produces an empty display list, never substitute HTML |
| Text.annotations / model content | Optional | Existing fix omits unannotated fragments; do not reconstruct citations |
| UrlCitation start/end | Optional UTF-8 byte offsets | Validate every supplied offset at scalar boundaries; complete spans convert to UTF-16; incomplete/absent spans become typed source references without sentence claims |
| Citation public URL + matching URL-context success | Required application evidence | Preserve closed requirement; source-only references must have their own successful read |
| Route evidence | App attribution, not factual/safety verification | Only complete spans may support source passage/identity claims; source-only references remain unconfirmed |
| Native / Saved | Coordinated transient DTO; research is excluded from persisted routes | Decode old range DTOs; retain route IDs, packing and custom entries |

## Primary sources reviewed 2026-10-12

[Interactions API](https://ai.google.dev/api/interactions-api), [OpenAPI](https://ai.google.dev/static/api/interactions.openapi.json): GoogleSearchCallStepArguments.queries, GoogleSearchResultItem.search_suggestions, TextContent.annotations, UrlCitation offsets/title are optional. Tool arguments, IDs and result correlation are retained. Offsets are bytes.

[Search guide](https://ai.google.dev/gemini-api/docs/google-search), [terms](https://ai.google.dev/gemini-api/terms), [client guidelines](https://support.google.com/adsense/answer/10926790): display associated suggestions/links with the submitting user's result, preserve supplied result/HTML and direct destinations, no tracking or durable research storage. Absence in the schema does not authorize invented suggestions; accepting absent HTML is the application interpretation of optional metadata, not a provider compliance certification. Existing programmatic source-document lookup remains outside this compatibility change and needs separate terms review before release.

## Completed

The parser and final backend/native validators now share nullable `observedSearchQueries`, independent `observedSearchCalls`, optional provider suggestions (normalized only to an empty list when absent) and typed citation `scope: passage | source`. Supplied full ranges retain strict UTF-8 scalar checks and convert to UTF-16. Partial valid ranges discard the incomplete span rather than manufacture its partner. Source references require their own exact successful source read; they cannot become a source-identity or source-passage claim or trigger sentence-based document matching. Model text/HTML remains unchanged; unannotated fragments remain excluded by the preceding fix.

Malformed steps/results, duplicate/cross-tool IDs, incorrect correlations, unsafe URLs, unsuccessful reads, invalid offsets/Unicode and partial followup status stay closed. The followup preserves original steps/IDs and its completion status. Diagnostic output remains the existing closed enum with no raw contents. Legacy complete-range DTOs and positive-count adapters remain accepted; unknown counts require independent call evidence. Saved-route formats, IDs, geometry, packing and media production code are unchanged. DE/EN sources distinguish a cited/read source from an attributed passage, with existing Commons author/license links retained.

## Checks

- Three synthetic documented variants (omitted queries, suggestions, range) fail on baseline `071c513` and pass after the correction.
- 180 distinct targeted backend fixture tests (179-suite run plus the added nested current-source regression) pass, zero failures/skips. Includes shared contract, Unicode/optional content/title, evidence/source documents/reconciliation, synthetic HTTP composition, endpoint/planner/current-source checks, quality, owner accounting, private diagnostics, media and route acceptance. Nested current-source attribution retains source-only scope without attributing model sentences.
- Backend build: syntax checks for 399 JavaScript files pass. Diff whitespace and localization JSON checks pass.
- Seven production `DynamicWebResearchTests` pass in isolated macOS Swift compilation with interface-only stubs for the surrounding app failure/stop/date types. This verifies the production DTO, decoding, validation and span extraction, **not** the full iOS transport, Saved store, SwiftUI rendering or signing.
- Swift syntax parsing passes for all eight modified Swift files. New full transport/Saved/UI tests are prepared but not run here.

## Exact integrator handoff (still required)

Build the iOS app from this branch without modifying other owners' checkouts. Run `DynamicWebResearchTests`, `DynamicResearchPlanningClientTests` (including `testOptionalResearchMetadataSurvivesFullNativeRouteDecoderWithoutChangingGeometry` and optional nested current-source attribution, legacy/source-passage cases), `SavedRouteStoreTests` (including `testSourceOnlyResearchSavePreservesRouteAndSeparatePackingState` and existing legacy migration cases), and `HikePreparationTests`.

Run `DynamicEvidenceUITests`, particularly the updated original-research case, `testSourceOnlyResearchHasNoInventedPassagesOrSuggestionsInEitherLanguage`, missing/expired research, packing restart/language and long Commons photo credits. The existing simulator-only launch supports `--trailmind-ui-evidence-source-only`: no span excerpt or inline link for a source-only citation; no invented suggestions; DE/EN wording and source links remain readable. Verify supplied Google HTML remains intact and fully accessible, including at large text size. This source handoff is complete; native acceptance remains open.

## Validation limits

No live acceptance is established by synthetic fixtures or isolated compilation. Later provider, routing, Commons and physical-phone checks require coordinated, separately authorized work. This source checkpoint does not merge main or authorize a deployment. Private execution records remain outside Git.
