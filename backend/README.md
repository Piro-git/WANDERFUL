# TrailMind Backend

Outdoor-evidence architecture, import operations, trust semantics, and the versioned corridor contract are documented in [docs/outdoor-evidence.md](docs/outdoor-evidence.md). The least-privilege PostGIS application contract is documented in [docs/outdoor-research-runtime-read-boundary.md](docs/outdoor-research-runtime-read-boundary.md).

Minimal backend for TrailMind intent parsing and secure route-engine access.

The backend exposes:

- `POST /api/parse-intent` for AdventureIntent-compatible prompt parsing.
- `POST /api/app-attest/challenge`, `/register`, and `/route-session` for installation verification.
- `POST /api/route` for a strictly validated GraphHopper routing request.
- `GET /health` for a fast, provider-independent liveness response.
- `GET /health/live` for the zero-dependency production liveness contract.
- `GET /health/ready` for a coarse cached readiness state. It never returns dependency names or errors.

The route endpoint proxies real GraphHopper results; it does not invent geometry, distance, duration, elevation, safety, scenic quality, water availability, trail status, camping legality, weather, POIs, navigation, accounts, or persistence. See [Route API contract](docs/route-api.md).

## Environment

Gemini is the primary provider. Set your Google API key only in the backend environment:

```sh
export GOOGLE_API_KEY="your-google-api-key"
export GOOGLE_MODEL="gemini-3.5-flash"
export AI_PROVIDER="google"
```

`gemini-3.5-flash` is the default Google model used by this backend when `GOOGLE_MODEL` is not set.

OpenRouter remains supported as an optional fallback/alternate provider:

```sh
export OPENROUTER_API_KEY="your-openrouter-key"
export OPENROUTER_MODEL="openai/gpt-4o-mini"
export AI_PROVIDER="openrouter"
```

If neither `GOOGLE_API_KEY` nor `OPENROUTER_API_KEY` is set, intent parsing fails closed with `configuration_unavailable`. A deterministic local/test fixture is available only when both conditions below are explicit:

```sh
NODE_ENV=development
INTENT_ALLOW_DETERMINISTIC_MOCK=true
```

`NODE_ENV=test` is also accepted for automated tests. Production never enables the fixture, even when the flag is present. Fixture responses report `parserSource: "localRuleBased"`; only genuine Google/OpenRouter success reports `remoteAI`.

Provider execution is bounded without retries. `INTENT_PROVIDER_TIMEOUT_MS` defaults to 15000 and accepts 1000–30000 milliseconds. It must remain at least one second below `INTENT_GLOBAL_LEASE_TTL_SECONDS`; invalid combinations fail closed. `INTENT_PROVIDER_MAX_RESPONSE_BYTES` defaults to 65536 and accepts 1024–262144 bytes. The streamed byte count remains authoritative when `Content-Length` is absent or inaccurate.

Secrets should live in `backend/.env`, which is ignored by git.

GraphHopper and App Attest configuration is documented in `config.example.env`. Keep `GRAPHHOPPER_API_KEY` only in the backend environment. To use route or intent endpoints locally without App Attest, explicitly set `ROUTE_ALLOW_INSECURE_LOCAL_ROUTING=true` and `INTENT_ALLOW_INSECURE_LOCAL_PARSING=true` with `NODE_ENV=development`. The in-memory App Attest repository also requires the separate `APP_ATTEST_ALLOW_IN_MEMORY=true` opt-in. Production refuses App Attest, route-session, routing, and remote-intent traffic unless a shared durable repository is injected; see [the datastore decision](docs/app-attest-durable-storage.md).

App Attest uses exact-pinned, Node 20-compatible dependencies: `cbor-x` for strict CBOR decoding, `asn1js` for the Apple nonce extension, maintained `pkijs` for standards-based X.509 path validation against the pinned Apple App Attestation root, and `pg` for parameterized PostgreSQL transactions and bounded connection pooling. Node's crypto APIs perform SHA-256, P-256 public-key handling, secure randomness, opaque-token hashing, and ECDSA verification. Dependency versions and audit results should be reviewed during normal backend upgrades rather than floated automatically.

## Run Locally

The easiest safe local workflow is:

```sh
cd backend
npm test
npm run build
npm run start:local
```

`start:local` reads provider keys from the gitignored `backend/.env`, disables database/App Attest repository selection, enables the two explicit development-only authorization gates, and binds the server to `127.0.0.1` so it is not exposed to the local network. A Debug build running in iOS Simulator uses a non-secret placeholder session only for exact HTTP loopback URLs. Release builds, physical-device builds, HTTPS URLs, and non-loopback hosts always retain the App Attest path.

To use deterministic intent fixtures without an AI provider during local development, add `INTENT_ALLOW_DETERMINISTIC_MOCK=true` to the local environment. The insecure-local-parsing authorization flag does not enable fixture behavior by itself.

If `backend/.env` does not exist yet, copy `config.example.env` to `.env` and add the local `GRAPHHOPPER_API_KEY`. Never commit `.env`.

## Production admission and lifecycle

`npm start` is the standalone production entry point. It fails before listening unless the presence-only production preflight passes. The preflight requires `NODE_ENV=production`, an explicit release stage, exact `true`/`false` values for every controlled flag, production-safe local/in-memory flags, durable App Attest configuration, coherent request/authorization/database bounds, and the dependencies of every enabled capability. It prints only check identifiers, coarse capability states, and a ready/blocked decision; it never prints configuration values.

```sh
npm run ops:preflight
npm start
```

The standalone runtime requires `APP_ATTEST_DATABASE_URL`. When research or evidence is enabled, it additionally requires explicit, non-aliased runtime connection strings for each pool named in `config.example.env`. These URLs must be injected by the deployment platform; never place a value in a command or receipt. Source validation can reject missing or textually aliased URLs, but only staging grant/denial tests can prove database role separation.

Migrations are an operator-only responsibility and are never run by the application process. After the migration role has received its environment through the approved secret-injection mechanism, run:

```sh
npm run db:migrate
```

Migration output contains filenames only; connection strings and database records are never printed. Use `TRAILMIND_TEST_DATABASE_URL` only with a disposable dedicated database to run the real PostgreSQL integration suite.

The production server defaults to loopback on port 3000. Set `HOST` and `PORT` explicitly to match an approved ingress design. Node header, request, keep-alive, shutdown, header-count, readiness-probe, connection, statement, idle-transaction, and pool bounds are configurable only within the ranges enforced by preflight. On `SIGTERM` or `SIGINT`, the process marks readiness false, rejects late work before parsing or authorization, drains existing work, aborts it at the single shutdown deadline, closes sockets and owned pools, and reports only a coarse outcome.

`api/index.js` remains a bare serverless request-handler adapter. It does not execute the standalone preflight, pool composition, cached dependency readiness, or signal-driven drain contract. It is therefore not an admitted closed-beta production entry point until an independently verified platform-specific lifecycle provides equivalent guarantees.

Expired App Attest challenges, sessions, rate windows, and provider leases can be pruned by an operator or scheduler after durable configuration is injected:

```sh
npm run ops:prune-app-attest
```

The command reports fixed aggregate counts only. Registered keys and attestation receipts are not deleted by this command; their retention requires an explicit owner/legal decision and a separately reviewed operation.

## Example Request

```sh
curl -sS http://localhost:3000/api/parse-intent \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Ich will eine entspannte 15 km Rundwanderung um Schierke mit wenig gleicher Strecke zurück",
    "locale": "de",
    "userLocationHint": null
  }'
```

Example shape:

```json
{
  "activityType": "hiking",
  "routeType": "loop",
  "startLocationQuery": "Schierke",
  "endLocationQuery": null,
  "regionQuery": null,
  "targetDistanceKm": 15,
  "targetDurationMinutes": null,
  "difficulty": "easy",
  "desiredFeatures": [],
  "avoidFeatures": ["repeatedPath"],
  "transportMode": "walking",
  "rawPrompt": "Ich will eine entspannte 15 km Rundwanderung um Schierke mit wenig gleicher Strecke zurück",
  "parserSource": "remoteAI",
  "confidence": 0.78
}
```

The iOS app should still validate this intent before geocoding and routing. Real route geometry remains the job of GraphHopper or another routing engine.
