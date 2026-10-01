# Dynamic research-led hiking planner

The confirmed product scope supersedes the pilot-only task. No new live spending is authorized. Existing ledgers and isolated branch are preserved. The goal is active and must not be completed by offline validation alone.

## Audit of the current executable path

| Phase | What actually executes | Missing capability |
| --- | --- | --- |
| Intent | `/api/parse-intent` calls Gemini Interactions without tools | No research during parsing; prior HTTP 500 remains unresolved |
| Anchor | Swift validation and Apple geocoding | Region ambiguity remains a normal clarification |
| Research | Native schema-2 `/api/llm-plan-route` invokes the Postgres research executor with reviewed region bindings | No dynamic discovery outside imported coverage; no web search or source-reading tools |
| Selection | Gemini chooses proposal/stop IDs from a supplied DB candidate pool | Cannot discover new places or call geographic tools |
| Routing | Central GraphHopper provider computes geometry; existing geometry/statistics/snap/quality checks apply | Model never receives measured routing feedback |
| Revision | One deterministic optional-stop removal after a quality rejection | No model-led revision based on actual distance/connectivity |
| Display | MapKit geometry and existing source provenance | No verified place-photo lookup or licensed photo presentation |

Schema-1 LLM planning also exists, using model-suggested names followed by GraphHopper geocoding. It is not the shipping research path, includes deterministic fallback, and is not sufficient evidence-led research.

## Smallest architecture

Keep existing intent parsing, Apple anchor geocoding, centralized GraphHopper adapter, route evaluator, private diagnostics and local checklist. Add one dynamic planning state machine behind an explicit versioned native contract. The user-authored prompt must travel with normalized intent so research does not lose requests outside the old feature chips.

The bounded Gemini loop exposes typed tools:

1. `search_places`: on-demand, bounded OSM discovery around the independently resolved anchor. Geometry comes from source data, never model arguments. The model chooses desired categories; radius is constrained by the application request. Results include stable OSM IDs, source version/time, names, recorded categories and linked Wikidata IDs. User/search/source text is untrusted data.
2. `read_place`: read a selected source identity from the current result set, with Wikidata enrichment only through verified OSM links and coordinate agreement. Return record evidence and limitations, not a guarantee of scenic value, access or safety.
3. `route_itinerary`: accept ordered IDs from the verified current place registry. Build coordinates internally and call the existing GraphHopper function. Return actual measured distance/duration/elevation and rejection feedback. Permit a small number of distinct revised itineraries, never automatic seed-search fallback or repeated identical routes.
4. Photo enrichment after final route acceptance: use a place's linked Wikidata P18 image or exact Commons reference, verify source identity and license/author metadata through the Commons API, and omit missing/ambiguous/unlicensed media. No generated or generic stock substitute. Attribute the image near its display.

A small state machine enforces request-wide call/deadline bounds before every operation, caller cancellation, no duplicate tool-call replay, no unknown IDs, no model coordinates, and no successful response until a real route passes quality and hard-constraint checks. Data-poor regions return an honest unavailable result. Hard exclusions unsupported by evidence require clarification/unsupported responses, not softened promises.

The geographic source adapter is replaceable and cacheable. Imported Harz/other source records can be a cache implementation with identical provenance, but no list of approved regions gates the dynamic path. Public Overpass is a bounded private-test candidate, not an unlimited production dependency. Do not use public Nominatim to enumerate POIs. Continue using Apple geocoding for the anchor.

The explicit `web_and_map` mode now adds a grounded Google Search and URL-context phase before mapped itinerary selection. It preserves required grounded text/citation/suggestion display and fails rather than silently reverting to POI-only planning. See WEB_RESEARCH_INTEGRATION_2026-09-07.md for the implemented flow, separate grounding allowance, billing limitation and verification evidence.

## Provider choices and terms

- Gemini Interactions supports custom function calls; implementation will use the current documented call/result format and stateless history. Verify signatures/history requirements and all effective generation settings in offline fixtures before live use.
- OSM discovery supplies independently sourced IDs/coordinates under ODbL, with OSM attribution and snapshot timestamps. Respect chosen Overpass instance bounds, cancellation and caching; no bulk import or universal-coverage promise.
- Wikidata structured records are CC0; Commons images have individual licenses and credits that must be checked, not assumed.
- Retain MapKit. Google Places policies restrict map display of its content and include EEA-specific conditions; Google-derived place/photo data will not be mixed into MapKit by assumption.

Primary sources reviewed:
https://ai.google.dev/gemini-api/docs/function-calling
https://developers.google.com/maps/documentation/places/web-service/policies
https://wiki.openstreetmap.org/wiki/Overpass_API
https://operations.osmfoundation.org/policies/nominatim/
https://www.wikidata.org/wiki/Wikidata:Data_access
https://www.mediawiki.org/wiki/Extension:CommonsMetadata
https://commons.wikimedia.org/wiki/Commons:Machine-readable_data

## Implementation and verification order

1. Typed dynamic place/source/photo boundaries and bounded read adapters; offline regressions across unrelated countries, source injection, mismatch, stale records, unknown license and empty coverage.
2. Gemini function-call loop with strict ID registry and real routing feedback, preserving current route evaluator and hard limits; tests for arbitrary English/German requests, revision, budget/cancellation and no fake success.
3. Versioned native request/result integration plus sourced stop/photo UI, preserving standard point-to-point/loop and checklist persistence.
4. Diff review and executed offline tests/builds. Then propose one adequate explicit allowance covering provider diagnosis, unrelated-region routes, revisions and single phone acceptance. No live calls or session creation before approval. Final goal completion requires live measured routing and in-place iPhone acceptance.
