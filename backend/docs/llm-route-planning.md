# Natural-language route planning API

`POST /api/llm-plan-route` is the narrow phone-facing planning slice. It is disabled unless `LLM_FIRST_PLANNING_ENABLED`, `INTENT_PROVIDER_ENABLED`, and `ROUTE_PROVIDER_ENABLED` are all exactly `true`; disabled requests return before authorization, model, geocoder, routing, or database work.

The endpoint accepts a bounded prompt, asks the configured Gemini or OpenRouter provider once for strict structured intent and at most three named stops across the complete model result, resolves every name through GraphHopper geocoding, and asks GraphHopper for all route geometry and measured route facts. No upstream request is retried automatically. App Attest route-session authorization consumes 12 weighted units before provider work.

## Request

```json
{
  "schemaVersion": 1,
  "prompt": "Plan a 12 km trail-running loop from Ilsenburg via named landmarks",
  "locale": "en",
  "userLocationHint": null
}
```

All four fields are required. `locale` may be `de`, `en`, or `null`. The prompt is limited to 1,000 characters and the complete JSON body to 16 KiB.

## Response boundary

A successful planning operation returns `state: "routed"` with up to three GraphHopper-backed routes. Missing, weak, or ambiguous place anchors return `state: "clarification"` before unreliable routing. Other completed requests with no verified survivor return `state: "recovery"`, an empty route list, stable rejection codes, and safe retry guidance. Provider bodies, URLs, credentials, assertions, raw prompts, LLM place text, and unresolved coordinates are never reflected in errors or logs.

The model output schema permits only normalized activity, route type, start/end names, target distance/duration, difficulty, requested/avoid preferences, and zero to three proposals containing no more than three named stops in total. Coordinates, geometry, measured route facts, provider metadata, URLs, and safety/access/scenic/water/legal/current-condition claims are rejected.

Each geocoded result must be bounded, strongly matched, non-broad, unambiguous, unique, and geographically plausible. Routed candidates must have GraphHopper provenance and pass profile, route-shape, statistics, snapping, waypoint reach/order, target-distance, detour, backtracking, available difficulty/access-evidence, and duplicate-geometry gates. At most three proposal calls plus one standard fallback call are possible; fallback runs only when all proposals fail and start/end anchors resolved.

## Dormant configuration

```dotenv
LLM_FIRST_PLANNING_ENABLED=false
ROUTE_PROVIDER_ENABLED=false
INTENT_PROVIDER_ENABLED=false
```

All three must be explicitly enabled by a separately approved staging activation. The existing `AI_PROVIDER` and corresponding single provider key select the model. `GRAPHHOPPER_API_KEY` serves both bounded geocoding and routing. Outdoor-evidence/PostGIS and Supabase capabilities are neither required nor read by this endpoint.

For production and physical-device testing, send the existing `Authorization: TrailMindRouteSession <opaque-token>` and `X-TrailMind-Request-ID: <UUID>` headers. Do not enable insecure-local authorization outside an explicit local/test environment.
