# TrailMind Intent Backend

Minimal local backend for parsing outdoor route-planning prompts into AdventureIntent-compatible JSON.

The backend only extracts intent. It does not calculate route geometry, distance, elevation, safety, scenic quality, water availability, trail status, camping legality, weather, POIs, navigation, accounts, or persistence.

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

If neither `GOOGLE_API_KEY` nor `OPENROUTER_API_KEY` is set, the endpoint returns a deterministic mock response for local development and tests.

Secrets should live in `backend/.env`, which is ignored by git.

## Run Locally

```sh
cd backend
npm test
npm run build
npm start
```

The server listens on `http://localhost:3000` by default. Override with:

```sh
PORT=3001 npm start
```

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
