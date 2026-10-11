# Offline preparation for a discriminating Google diagnostic

This continuation made **no provider calls**, created no owner session, reset no allowance, changed no historical ledger, installed nothing on the phone, and delegated no work. It builds on the isolated single-owner fix and the two observed intent HTTP 500 failures.

## Findings: evidence versus hypotheses

**Proven:** both previous calls failed in native `/api/parse-intent` before geocoding, schema-2 itinerary selection, or GraphHopper. Their error bodies were discarded, so canonical Google error categories are unavailable retrospectively. Neither status establishes a request-shape bug, account failure, model availability to this credential, or general Google outage.

An offline test now inspects the **effective request after the durable budget wrapper**, using a fake key and fake upstream. It verifies:

- POST `https://generativelanguage.googleapis.com/v1beta/interactions`, redirects manual, caller-derived abort signal, JSON content type and `x-goog-api-key` authentication.
- Exactly four body keys: `input`, `model`, `response_format`, `store`.
- Owner model is pinned to `gemini-3.8-flash` by startup and enforced by accounting. The general default `gemini-3.5-flash` is not effective in this owner path; the private environment file cannot silently choose another model.
- `store` is forced to false. No tools, background execution, stream, previous interaction, alternate endpoint, paid service tier, thinking setting, or generation configuration is added.
- `response_format` retains `{type: "text", mime_type: "application/json", schema: intentJsonSchema}` exactly.
- The schema is 1,545 JSON bytes, with 14 required properties, nine nullable `anyOf` branches, four `maxLength` occurrences, numeric bounds, bounded arrays, enums, and `additionalProperties: false`.

[Google's Interactions migration guide](https://ai.google.dev/gemini-api/docs/interactions-breaking-changes-may-2026) documents this response-format envelope and the `steps/model_output/content` response shape that the reader supports. There is no proven envelope mismatch.

[Google's structured-output guide](https://ai.google.dev/gemini-api/docs/structured-output) explicitly demonstrates `anyOf` in its Interactions examples. Its supported-subset summary omits string-length constraints. That omission does not prove rejection. The current schema's four `maxLength` constraints are a narrow variable for a controlled comparison; removing `anyOf` is not justified as a proven fix. No shipping schema was changed.

[The model page](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash) lists the exact stable model and structured-output support. The generic API reference's model list lags the newer model page/examples. Documentation support is not proof this particular account/request succeeds. No invalid `minimal` thinking setting is sent.

**Additional proven configuration limitation, not the observed cause:** the Google request does not set an output-token cap or thinking level. The selected-adapter `maximumOutputTokens` configuration is used for OpenRouter, not this Google request. No generation defaults or timeouts were changed as a speculative fix. The selector still has a four-second deadline and is untested live; it did not cause the observed failures in the earlier intent phase.

## Implemented error classification

New private module: `backend/scripts/owner-google-error-classification.js`.

For Google HTTP errors only, the budget wrapper first persists the HTTP outcome and existing access/rate-limit stop decisions. It then consumes the error stream transiently with **8,192-byte retained-buffer and 250 ms limits**, also respecting caller cancellation. It does not clone/tee the stream, await provider-controlled cancellation indefinitely, or read successful/GraphHopper responses.

Only these allowlisted kinds of metadata can reach the private diagnostics file:

- Documented Interactions `error.code` categories, under `googleErrorCode`.
- Canonical RPC status, under `googleErrorStatus`, if an RPC-style envelope is returned.
- A small set of exact `google.rpc.ErrorInfo` reasons, requiring the documented type and `googleapis.com` domain, under `googleErrorReason`.
- Local body-inspection outcomes such as malformed, oversized, stalled, aborted or unrecognized.

The file logger revalidates all new fields. No raw error message/body, arbitrary reason, detail metadata, upstream identifier/header, prompt, coordinate or credential is retained. Existing local endpoint/phase/request-sequence/elapsed-time/HTTP-status fields provide correlation. A provider-reported category is evidence, not a root-cause verdict; conflicting or generic categories must not be embellished.

References: [Interactions error contract](https://ai.google.dev/gemini-api/docs/api-errors), [Google common ErrorInfo reasons](https://docs.cloud.google.com/php/docs/reference/common-protos/latest/Api.ErrorReason). The Interactions contract uses snake-case `error.code`; relying only on an RPC `error.status` would miss the primary API shape.

Successful bodies, accounting limits, reservation-before-IO, durable stop rules and retry behavior are unchanged. No automatic retry exists. The ledger remains accounting-only; per-attempt classification goes into the existing bounded private diagnostic file. An overlap regression prevents a later request's outcome from being attached to an earlier request's delayed error-body read.

## Minimal proposed live diagnostic — NOT authorized or run

**Cap: two new Gemini calls, zero GraphHopper calls, no phone installation or tunnel, one fresh bounded private session only after explicit approval.** Preserve every older session. The sole operator drives `/api/parse-intent`; route/itinerary endpoints are not exercised. There are no retries beyond the two explicitly described different requests.

1. Send the exact original request through the native intent endpoint with the new classifier. Keep model, prompt, authentication mechanism, store=false and the existing 15-second provider deadline unchanged. Retain only safe classification and whether native validation accepted a remote result. If parsing succeeds, stop: this verifies parsing only. If a specific access, billing, quota, model or clear request category is returned, stop and address that evidence offline instead of spending the second call.
2. Only for a still-ambiguous failure, send the same request with **only the four schema string-length constraints removed**. A reviewed candidate schema is committed at `backend/test/fixtures/googleIntentSchemaDiagnosticWithoutStringLengths.json`; its offline regression proves no other schema changes. Keep all application-side intent validation and repair unchanged. No returned result is routed or marketed as successful AI planning.

Interpretation:

- Original fails and the single-variable schema control succeeds: evidence implicates length-constraint handling or its interaction with this schema, but temporal/transient differences remain possible. Do not claim a general unsupported-keyword rule from one contrast.
- An explicit invalid-request category favors request validation; access/model/quota categories favor those specific prerequisites. Do not infer a field name from the redacted message.
- Both receive generic 5xx: request/schema-versus-provider cause is still unresolved. Stop at the cap; no blind third request, paid upgrade or automatic reset. A later independently approved simple-format control may be needed.
- Any accepted parse still leaves live Gemini itinerary selection, native normalization/geocoding, GraphHopper route-quality checks, phone installation, and checklist acceptance outstanding.

The control schema is a test artifact and is **not imported by the runtime**. Implementing the explicitly selected control in a live operator harness is a separate approved execution step; it must pass through the existing scoped credential loader and durable budget. The reviewable delta is only the four removed `maxLength` fields, not a new provider, model, prompt, generation configuration, or route fallback.

## Offline validation

**107 focused backend tests executed; 107 passed.** Coverage includes exact request inspection after budget wrapping, native HTTP 500 mapping, canonical-code redaction, malformed/invalid UTF-8/HTML/oversized/chunked/stalled error bodies, caller cancellation, unchanged successful and GraphHopper bodies, durable stop/cap behavior, no automatic retries, per-request correlation during overlapping responses, and the exact four-field diagnostic schema delta. Existing sourced-itinerary and real-route contract fixture tests also passed; these are not evidence of successful live planning.

Test output: `/private/tmp/wanderful-error-classification-complete.log`. `git diff --check` passed. The previous live diagnostic remains closed with its accounting unchanged. No Swift/app changes were made in this offline continuation, so the prior phone build is unaffected and has not been installed.
