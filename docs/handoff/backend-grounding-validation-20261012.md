# Grounded research validation handoff

- Task branch: `codex/backend-phone-20261012`
- Status: ready for independent source review; no post-patch live acceptance.
- Last writer: local backend owner; checkpointed for review.
- Goal: accept documented optional model content without promoting ungrounded text to route evidence.

## Completed and decisions

Two source-derived fixtures reproduced an independent compatibility defect: a valid read-backed answer was discarded if the interaction also contained an empty model-output step or an unannotated text fragment. The parser now omits those fragments from verified output while preserving grounded text and its original block-local citation ranges. It still requires correlated real tool calls/results, public citation URLs, valid UTF-8 scalar boundaries and successful matching source-page reads. Explicit partial/failed interaction status and model-output errors remain closed.

Fixed validation subreasons distinguish missing queries, search suggestions, citation ranges and other evidence gates. The private logger admits only a closed enum; it never copies response text, URLs, IDs, prompts, tokens or arbitrary error fields.

The existing native evidence validator still requires a positive observed query count, nonempty provider search suggestions and citation ranges. These fields are API-optional, but the backend does not manufacture them or silently return an envelope the current app would reject. Missing values are classified and refused. Coordinated native contract evolution, if desired, is separate work.

Primary contracts: [Interactions API](https://ai.google.dev/api/interactions-api), [OpenAPI schema](https://ai.google.dev/static/api/interactions.openapi.json).

## Checks

The two new positive cases failed before the implementation change. Twelve relevant backend suites passed 117 tests with zero failures or skips in an environment without real credentials, using fixture responses only. JavaScript syntax checks passed for 398 files. Unicode, actual-read provenance, call correlation, owner authentication/budget, media, routing and endpoint cases are included. No iOS source was changed or rebuilt.

## Remaining and next action

Independent source review and coordinated native integration remain necessary at this historical checkpoint. Synthetic fixtures do not establish end-to-end route, photograph, Saved or packing acceptance on a physical phone. Any later live acceptance needs separately authorized work.

## Continuation

Use this task branch, inspect its commit and preserve unrelated changes. Private diagnostic and fixture receipts are outside this public repository. No credentials, signing material, real device/session payloads or personal paths belong in this handoff.
