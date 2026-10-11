# Web research integration — latest owner checkpoint

This note supersedes the earlier statement that dynamic OSM lookup alone closes the research requirement. It does not. The user-confirmed goal includes actual LLM web/source research; the implementation now includes that separate phase, still awaiting live verification.

## Current flow

The owner native schema-3 request now explicitly asks for `researchMode: web_and_map` and carries the original prompt and starting location name. The backend refuses that mode unless explicitly configured for web research. No silent downgrade to mapped-only planning is allowed.

1. Gemini Interactions receives the original request with documented `google_search` (web only) and `url_context` tools. No guessed structured-output combination is used.
2. The response must show matched search call/result records, a successful URL-context retrieval, cited model text linked to a retrieved URL, and the provider's search suggestions. Plain model claims, failed/paywalled reads, malformed citations, missing suggestions and unrelated retrieval metadata cannot pass.
3. The complete grounded text and citations guide the subsequent Gemini itinerary loop for the same request. OSM independently supplies mapped IDs and coordinates; web prose never supplies geometry or verified route statistics. The existing source-identity and licensed Commons photo boundary is preserved.
4. Selected mapped IDs reach central GraphHopper. Measured quality/constraint feedback and typed missing connections permit bounded distinct model revisions. Service failures are not disguised as missing places.
5. Native route detail displays the unchanged grounded answer with linked citation ranges and its associated complete search suggestions in a separate section. The suggestions use a nonpersistent WKWebView, disabled page JavaScript, restricted subresources and user-initiated external links. Actual visual rendering still needs simulator/phone verification.
6. The grounded envelope is transient and absent from saved-route storage. OSM stops and separately licensed Commons photo metadata still persist. Checklist storage and route IDs are unchanged.

This is not a general crawler. Search-derived links are not collected into a database or used as backend crawl targets. The built-in Google URL-context tool performs the page reading within the original request. Google image search and Google Maps grounding are not enabled.

## Budget boundary

All past allowances remain exhausted and no new live session was created. Current legacy/dynamic allowances do not implicitly authorize built-in grounding. A separately specified `grounding` allowance enables a new ledger version; old ledgers cannot be upgraded or reset. Each grounding-enabled request reserves both the Google-generation counter and grounding-request counter before upstream IO, including failures and timeouts. No automatic retries.

The documented Interactions schema does **not** expose a per-request cap on the internal number of Google search queries. `observedSearchQueries` is retrospective evidence, not an enforceable pre-call limit. Do not call a generation cap a search-query cap. A future approval must explicitly cover grounding-enabled requests and their provider-internal searches. The existing proposal of 30 Google generations / 10 GraphHopper calls / bounded OSM, Wikidata and Commons reads has not been approved and did not include this grounding distinction.

One adequate proposed session remains 30 minutes, up to 30 total Gemini generations **including up to 3 grounding-enabled research requests**, 10 GraphHopper calls, 8 OSM queries, 30 Wikidata reads and 10 Commons metadata reads. This covers initial-provider diagnosis, two real route checks and one phone acceptance with bounded revisions. Each plan's eight-generation bound includes its web phase; remote initial parsing is counted separately by the same durable session ledger. Do not start until explicitly approved and device readiness is established.

## Evidence

- Current state began at isolated branch commit `5bca57c`; unrelated dependency symlink remains untracked.
- 134 focused backend tests executed and passed: `/private/tmp/wanderful-web-final-backend.log`.
- Four full offline owner HTTP flows passed: mapped/web modes, each with/without a missing-connection revision. These exercise actual provider adapters and durable accounting using synthetic upstream fixtures: `/private/tmp/wanderful-grounded-native-offline.log`.
- Swift app and test bundles compiled after adding the web display and response validation. Final test build log: `/private/tmp/wanderful-web-swift-tests-build.log`. Swift tests and visual UI have not been executed because simulator boot is not authorized yet.
- Updated device build succeeded at `/private/tmp/Wanderful-AI-Phone-Products-20260906/TrailMind.app`; strict deep codesign verification passed. Expected owner bundle identity was verified and OwnerPhoneTest.json is absent. Device build log: `/private/tmp/wanderful-web-device-build.log`. No installation occurred. The app now asks for web_and_map, so it requires an explicitly grounding-enabled runtime; the old mapped-only runtime must not be used to call this successful web research.
- No new Google, GraphHopper, OSM, Wikidata or Commons API calls were used to validate this implementation. Documentation was read through the research tool only.

## Official documentation reviewed

- Interactions built-in tool shapes and response metadata: https://ai.google.dev/api/interactions-api
- Google Search grounding, citations and suggestions: https://ai.google.dev/gemini-api/docs/google-search
- URL-context success/error/paywall/unsafe outcomes and combination support: https://ai.google.dev/gemini-api/docs/url-context
- Grounded-result display, temporary same-user refinement and storage restrictions: https://ai.google.dev/gemini-api/terms

The implementation retains source claims as source claims. Citations and successful page retrieval do not establish current conditions, public access, safety, water availability, camping legality or route geometry. The earlier Google HTTP 500 in initial remote parsing is still unresolved; new offline tests do not diagnose its cause or prove live success.

Live acceptance must inspect sourced stop identities, source timestamps, measured constraints, the complete grounded display and suggestions, and a licensed place-linked photo when source metadata provides one. If no trustworthy photo is available it must remain absent; that does not prove the photo path has been live-verified. Checklist reopening and retained checkboxes remain manual phone acceptance requirements.

After both changed-code builds succeeded, only the previously approved ModuleCache.noindex, Build/Intermediates.noindex and Index.noindex directories under TrailMindDerivedData-EntitlementV2 were removed. Available space recovered to 2.6 GiB. SourcePackages, Build/Products, separate simulator/device products, signed apps, test bundles, logs and all ledgers remain intact. Use test-without-building for the already compiled Swift tests after boot authorization; do not rebuild unchanged app code.
