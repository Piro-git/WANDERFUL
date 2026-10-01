# Persistent phone acceptance recovery — 8 September 2026

## Current status

Recovery and offline verification are in progress. Live AI planning and phone acceptance are NOT complete. No live provider calls, owner runtime, token, tunnel, installation or data import have been started during recovery. Disappearance of old ledgers does not renew any allowance: historical allowances remain exhausted; the proposed expanded allowance remains unapproved.

## Persistent source

Checkout: `/Users/REDACTED/Library/Application Support/Wanderful-Recovery/phone-acceptance`.
Branch: `codex/phone-acceptance-recovery-20260908`.
The Git directory is self-contained; cloning used `--no-hardlinks`, with no temporary object-store dependency.

The latest temporary repositories and commit 484794c7f1592ae0786fcfecf849f0804c843c41 were lost. The source was recovered, not that original commit object:

- Prerequisite 3f38e17eed44e767681d482b7f29638769fb7551 survived in `/Users/REDACTED/Wanderful-Checkpoint-20260905`.
- Persistent research-engine and local-pilot bundles supplied original engine/source commits; the persistent hike-preparation patch supplied checklist source.
- Phone/backend/owner source transformations were recovered from the corresponding local Codex task histories. Only source writes were replayed through a constrained reader/writer. No historical shell, provider, credential, provisioning, tunnel, cleanup or import commands were replayed.
- Recovery evidence and per-file hashes are in sibling `evidence/`. Some historical commands completed out of invocation order; the runtime-test brace and duplicate-request expectation were restored in their actual source-write order. The diagnostics cleanup correction included a recorded one-line command.
- The generated schema-control and synthetic route fixtures were rebuilt from their recorded generators. These are test data, never live route evidence.
- Historical handoff notes are retained as historical evidence; their old build/install/runtime statements do not describe this recovery.

## Exact recovery of all six uncommitted production files

These full Git blob hashes match the prefixes recorded in the pre-restart diff:

| File | Blob |
| --- | --- |
| TrailMind/Services/DynamicResearchPlanningClient.swift | 4d8a544064dc176af2a590584f99ab6892c983f4 |
| backend/src/dynamicResearch/composition.js | 16eabf9ec61ac48cc9999e98c52c4a909ee70198 |
| backend/src/dynamicResearch/gemini.js | 634b96232a36ff29eeaf09b086baa0f66996d1f1 |
| backend/src/dynamicResearch/places.js | e845ba4c96b8fcc6002a9fffeb8805be2629f4f4 |
| backend/src/dynamicResearch/planner.js | 643278f28f4e5ac883d0635fa35292b1b3cbf9fd |
| backend/src/dynamicResearch/webResearch.js | 259d5f3e0ba380345aa56267a29e0f8b6a3fcd8a |

## Current executed evidence

- Dependencies restored from the local npm cache with lifecycle scripts disabled.
- 143 focused backend tests passed: dynamic research, owner accounting/diagnostics/runtime, and LLM-first planning tests. Log: `../evidence/recovered-complete-offline.log`.
- Five native HTTP composition flows passed against synthetic upstreams, including web research -> three exact named OSM identities outside category discovery -> rejected GraphHopper connection -> distinct model revision -> measured route and UTF-16 citation envelope.
- Added Unicode tests cover accents, emoji, mixed scripts, combining marks and rejection of partial multibyte boundaries. Named resolution tests cover exact identity, ambiguity, saturation, wrong region, absent/similar names, query escaping, duplicate lookup, bounded lookup, inspection requirement and rejected model coordinates.
- A negative provider test now asserts the captured request outside the transport callback so assertion failures cannot be mistaken for expected HTTP failures; its 12-test planner suite passed after this correction.
- Swift app and native test bundles compiled successfully (`../evidence/recovered-swift-build.log`). A standalone executable compiled the actual DynamicWebResearch.swift model and decoded/validated all four backend-generated Unicode envelopes with exact cited-span checks. Full XCTest and visual simulator acceptance remain pending explicit boot approval.
- Signed device build succeeded (`../evidence/recovered-device-build.log`); strict deep signature verification passed. Bundle/team match the existing app; the two research flags are true and OwnerPhoneTest.json is absent. Provisioning expires 2026-09-09T15:48:43Z. Signed artifact: `../DerivedData/Build/Products/Debug-iphoneos/TrailMind.app`.
- Paired iPhone 17 Pro is available according to devicectl. No phone changes made.

## Outstanding

Execute/inspect native tests once simulator boot is approved, and obtain ONE explicit adequate live allowance before any provider access. Compilation and signed artifact verification are complete; neither proves live planning or phone display. Proposed ceiling remains one 30-minute session: 30 total Gemini generations including up to 3 grounding-enabled requests, 10 GraphHopper, 8 OSM, 30 Wikidata, 10 Commons metadata reads; all attempts count. Provider-internal search query counts cannot be capped per grounding request. Diagnose the original HTTP 500 using bounded categories and a controlled request comparison only as evidence warrants. Verify two real regions before installation/phone acceptance. Preserve user data and checklist state.

The old database, signed products, logs and private session files under /private/tmp have not survived. Dynamic web/map planning is independent of the old regional database, so no reimport is authorized or needed. Never reuse an old or .invalid phone credential. Use the existing strict scoped loader only after a fresh live allowance is explicitly approved.
