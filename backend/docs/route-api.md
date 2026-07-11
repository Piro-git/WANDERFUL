# TrailMind Backend Route API

## Endpoint

- Method: `POST`
- Path: `/api/route`
- Request header: `Content-Type: application/json`
- Production authorization: `Authorization: TrailMindRouteSession <opaque-token>` and `X-TrailMind-Request-ID: <UUID>`
- Maximum JSON body: `ROUTE_MAX_BODY_BYTES` (32 KiB by default)

This endpoint accepts one route-engine request. Prompt parsing, geocoding, loop-seed orchestration, route ranking, saved routes, and navigation remain outside this endpoint.

## Request contract

The public contract uses named `latitude` and `longitude` values. The server converts each point to GraphHopper's `[longitude, latitude]` order only when it constructs the upstream request.

Supported values:

- Profiles: `foot`, `bike`. Hiking and trail running use `foot`; biking uses `bike`.
- Route types: `pointToPoint`, `loop`.
- Algorithms: omit `algorithm` for normal point-to-point routing; use `alternative_route` for bounded alternatives; use `round_trip` for loops.
- Locale: `de` only.
- Path details: `surface`, `road_class`, `hike_rating` only.
- Points: exactly one point for a GraphHopper `round_trip` loop; 2–25 points for `pointToPoint`.
- Existing fallback compatibility: a standard loop may omit `algorithm` only when it contains 3–25 points and its final point closes back to its first point. Flexible settings and typed preferences are forbidden on this fallback shape.
- Elevation and instructions: always enabled. If their request fields are present, they must be `true`.
- Geometry: always requested from GraphHopper with `points_encoded: false`.

Unknown properties are rejected. The client cannot provide a provider URL, key, query authentication, `ch.disable`, or arbitrary `custom_model` JSON.

### Point-to-point example

```json
{
  "profile": "foot",
  "routeType": "pointToPoint",
  "points": [
    { "latitude": 51.866, "longitude": 10.678 },
    { "latitude": 51.765, "longitude": 10.653 }
  ],
  "algorithm": "alternative_route",
  "alternativeRoute": {
    "maxPaths": 3,
    "maxWeightFactor": 1.4,
    "maxShareFactor": 0.65
  },
  "locale": "de",
  "includeElevation": true,
  "includeInstructions": true,
  "includePathDetails": ["surface", "road_class", "hike_rating"]
}
```

For a normal route, omit both `algorithm` and `alternativeRoute`.

### Loop example

```json
{
  "profile": "foot",
  "routeType": "loop",
  "points": [
    { "latitude": 51.866, "longitude": 10.678 }
  ],
  "algorithm": "round_trip",
  "roundTrip": {
    "distanceMeters": 15000,
    "seed": 11
  },
  "locale": "de",
  "includeElevation": true,
  "includeInstructions": true,
  "includePathDetails": ["surface", "road_class", "hike_rating"]
}
```

Round-trip distance defaults to a permitted range of 1,000–200,000 metres; deployments may configure a lower upper bound. Seeds must be integers from 0 through 2,147,483,647.

The existing iOS coordinator's via-point fallback can later use `routeType: "loop"`, omit `algorithm`, `roundTrip`, `alternativeRoute`, and `preferences`, and send a closed list of 3–25 named points. This compatibility request uses normal GraphHopper routing and never enables flexible mode.

### Typed route preferences

Point-to-point requests may optionally include a narrow preference object:

```json
{
  "preferences": {
    "activityType": "trailRunning",
    "avoid": ["majorRoads", "steepClimbs"],
    "difficulty": "easy"
  }
}
```

`activityType` is `hiking`, `trailRunning`, or `biking` and must agree with the routing profile. `avoid` accepts only `majorRoads` and `steepClimbs`; the only route-engine difficulty currently accepted is `easy`. The server compiles these values into fixed, allowlisted GraphHopper statements. When typed preferences accompany `alternative_route`, the server also applies the existing `distance_influence` value of 70. The client never controls custom-model conditions or multipliers.

## Success response

The response retains the GraphHopper path structures used by the existing iOS decoder, plus a safe provider identifier:

```json
{
  "provider": "graphhopper",
  "paths": [
    {
      "distance": 15234.5,
      "time": 13800000,
      "ascend": 520.0,
      "descend": 515.0,
      "points": {
        "type": "LineString",
        "coordinates": [[10.678, 51.866, 250.0]]
      },
      "instructions": [],
      "details": {
        "surface": [],
        "road_class": [],
        "hike_rating": []
      }
    }
  ],
  "snapped_waypoints": {
    "type": "LineString",
    "coordinates": []
  }
}
```

Geometry, distance, duration, ascent, descent, instructions, path details, and snapped waypoints are provider data and are not fabricated. Unexpected provider/debug fields are not reflected to the client.

## Error response

```json
{
  "error": {
    "code": "route_not_found",
    "message": "No suitable route was found for this request."
  }
}
```

Stable codes and statuses:

| Code | Typical status | Meaning |
| --- | ---: | --- |
| `invalid_request` | 400 | Contract or supported provider parameters are invalid. |
| `invalid_coordinates` | 400 | Coordinate values or point count are invalid. |
| `unsupported_profile` | 400 | Profile is not `foot` or `bike`. |
| `unsupported_algorithm` | 400 | Algorithm is outside the allowlist. |
| `unauthorized` | 401 | The production authorizer rejected the request. |
| `request_too_large` | 413 | JSON body exceeds the configured maximum. |
| `flexible_mode_unavailable` | 422 | GraphHopper rejected flexible routing so the iOS coordinator may use its safe fallback. |
| `route_not_found` | 422 | GraphHopper returned no usable route. |
| `routing_rate_limited` | 429 | Local rate limit; provider throttling is normalized to 503. |
| `routing_unavailable` | 503 | Provider/network/server failure or malformed provider response. |
| `routing_rate_limited` | 503 | The provider rate-limited the gateway. |
| `configuration_missing` | 503 | Routing or production authorization is not configured. |
| `route_timed_out` | 504 | The overall GraphHopper request deadline expired. |

Provider error envelopes, URLs, keys, debug headers, billing data, and internal configuration are never returned.

Provider responses that specifically indicate unavailable flexible routing are normalized to `flexible_mode_unavailable`; other supported-parameter rejections remain `invalid_request`. A future iOS backend client should map the dedicated code to its existing plain-routing or via-point fallback. The gateway itself does not retry invalid requests.

## Timeout, cancellation, and retries

The provider timeout defaults to 30 seconds and may be configured up to 60 seconds. HTTP client disconnects abort upstream work. The gateway currently performs no automatic retry, so invalid requests and provider rate limits are never retried and no retry can exceed the request deadline. A later deployment may add at most one retry for a confirmed transient failure within the same overall deadline.

## Security, privacy, and operations

- `GRAPHHOPPER_API_KEY` is read only by the provider adapter and added only to the fixed server-configured GraphHopper URL.
- Redirect following is disabled. Clients cannot select a URL, host, protocol, or port.
- Unauthenticated development routing is enabled only when `NODE_ENV` is explicitly `development` or `test` and `ROUTE_ALLOW_INSECURE_LOCAL_ROUTING=true`; intent parsing has the separate `INTENT_ALLOW_INSECURE_LOCAL_PARSING=true` opt-in.
- Production uses a short-lived opaque session created by one verified App Attest assertion. The plaintext session token is returned once and only its SHA-256 hash is stored.
- `/api/parse-intent` consumes three weighted units by default from the same session budget as routing, while using separate installation, global-cost, and concurrency windows for the AI provider.
- The session authorizer atomically consumes the request ID, weighted session budget, attested-installation window, global provider window, and global concurrency lease before GraphHopper is called.
- The authorizer receives headers, request ID, and cancellation signal—not coordinates or the route body.
- The development in-memory limiter is bounded and weights alternative routes by requested path count. It does not use exact coordinates as keys.
- Production fails closed unless a durable or platform-backed limiter is injected.
- In-memory limits are per-process and are not globally reliable on serverless deployments. Production needs platform-level or durable rate limiting, considering request count and expensive variants.
- Safe logs contain request ID, route type, profile, point count, coarse distance category, algorithm, status, latency, and safe error code only. Exact coordinates, geometry, prompts, authorization headers, keys, provider URLs, and raw bodies are excluded.
- Route requests are not persisted and no analytics are added.

## Environment

```dotenv
GRAPHHOPPER_API_KEY=
GRAPHHOPPER_BASE_URL=https://graphhopper.com/api/1
ROUTE_REQUEST_TIMEOUT_MS=30000
ROUTE_MAX_BODY_BYTES=32768
ROUTE_MAX_DISTANCE_METERS=200000
ROUTE_ALLOW_INSECURE_LOCAL_ROUTING=false
INTENT_ALLOW_INSECURE_LOCAL_PARSING=false
INTENT_REQUEST_COST=3
NODE_ENV=development
```

Use `config.example.env` as the safe placeholder reference. Do not commit a populated secret file.

The iOS routing client now encodes this contract, obtains an in-memory route session, assigns a fresh UUID to each variant, and preserves the existing routing coordinator and response decoder. Direct GraphHopper configuration remains available only to explicitly constructed test/evaluation clients and is no longer embedded in the app Info.plist.
