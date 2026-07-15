# TrailMind Backend

Minimal backend for TrailMind intent parsing and secure route-engine access.

The backend exposes:

- `POST /api/parse-intent` for AdventureIntent-compatible prompt parsing.
- `POST /api/app-attest/challenge`, `/register`, and `/route-session` for installation verification.
- `POST /api/route` for a strictly validated GraphHopper routing request.
- `GET /health` for a fast, provider-independent liveness response.

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

For a production-capable repository, provision a dedicated PostgreSQL database, set `DATABASE_URL` in the deployment environment, and apply migrations before starting or deploying. When Supabase is connected through Vercel Marketplace, the backend also accepts the integration-managed `POSTGRES_URL` automatically; an explicit non-empty `DATABASE_URL` takes precedence.

```sh
DATABASE_URL="postgresql://..." npm run db:migrate
```

Migration output contains filenames only; connection strings and database records are never printed. Use `TRAILMIND_TEST_DATABASE_URL` only with a disposable dedicated database to run the real PostgreSQL integration suite.

The server listens on `http://localhost:3000` by default. Override with:

```sh
PORT=3001 npm start
```

`api/index.js` and `vercel.json` adapt the same request handler for Vercel deployments. A deployment without a migrated PostgreSQL `DATABASE_URL` or `POSTGRES_URL` and the required App Attest/provider configuration exposes only the provider-independent health check; protected intent and routing operations remain fail-closed.

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
