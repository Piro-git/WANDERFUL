import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseIntentEndpoint, repairIntent, sanitizeIntent } from "../src/parseIntent.js";
import {
  GOOGLE_INTERACTIONS_URL,
  OPENROUTER_CHAT_COMPLETIONS_URL
} from "../src/intentSchema.js";

describe("parseIntentEndpoint", () => {
  it("parses a German loop prompt with mock fallback", async () => {
    const intent = await parseIntentEndpoint(
      {
        prompt:
          "Ich will eine entspannte 15 km Rundwanderung um Schierke mit wenig gleicher Strecke zurück",
        locale: "de"
      },
      { env: {} }
    );

    assert.equal(intent.activityType, "hiking");
    assert.equal(intent.routeType, "loop");
    assert.equal(intent.startLocationQuery, "Schierke");
    assert.equal(intent.endLocationQuery, null);
    assert.equal(intent.targetDistanceKm, 15);
    assert.equal(intent.difficulty, "easy");
    assert.deepEqual(intent.avoidFeatures, ["repeatedPath"]);
    assert.equal(intent.parserSource, "remoteAI");
    assert.ok(intent.confidence > 0.5);
  });

  it("repairs under-specified remoteAI loop output for pasted German round prompts", () => {
    const prompt = [
      "Ich will eine entspannte Runde bei Ilsenburg, ca. 3 Stunden",
      "Mach mir eine kurze Wanderung bei Lüneburg, eher easy"
    ].join("\n");

    const repaired = sanitizeIntent(
      repairIntent(
        {
          activityType: null,
          routeType: "loop",
          startLocationQuery: null,
          endLocationQuery: null,
          regionQuery: null,
          targetDistanceKm: null,
          targetDurationMinutes: null,
          difficulty: null,
          desiredFeatures: [],
          avoidFeatures: [],
          transportMode: null,
          rawPrompt: prompt,
          parserSource: "remoteAI",
          confidence: 0.42
        },
        prompt
      ),
      prompt
    );

    assert.equal(repaired.activityType, "hiking");
    assert.equal(repaired.routeType, "loop");
    assert.equal(repaired.startLocationQuery, "Ilsenburg");
    assert.equal(repaired.endLocationQuery, null);
    assert.equal(repaired.targetDurationMinutes, 180);
    assert.equal(repaired.difficulty, "easy");
    assert.equal(repaired.transportMode, "walking");
  });

  it("parses an English point-to-point prompt with mock fallback", async () => {
    const intent = await parseIntentEndpoint(
      {
        prompt: "Plan a hike from Ilsenburg to Schierke with forest paths",
        locale: "en"
      },
      { env: {} }
    );

    assert.equal(intent.activityType, "hiking");
    assert.equal(intent.routeType, "pointToPoint");
    assert.equal(intent.startLocationQuery, "Ilsenburg");
    assert.equal(intent.endLocationQuery, "Schierke");
    assert.deepEqual(intent.desiredFeatures, ["forest"]);
  });

  it("returns low confidence null locations for vague missing-location prompts", async () => {
    const intent = await parseIntentEndpoint(
      {
        prompt: "I want something beautiful and relaxed",
        locale: "en"
      },
      { env: {} }
    );

    assert.equal(intent.routeType, null);
    assert.equal(intent.startLocationQuery, null);
    assert.equal(intent.endLocationQuery, null);
    assert.ok(intent.confidence <= 0.35);
  });

  it("repairs a named regional day hike without a destination to a loop", () => {
    const prompt =
      "Ich will mit Freunden wandern gehen in der Sächsischen Schweiz. Wir wollen so entspannt einen Tag wandern gehen ohne Vorkenntnisse";

    const intent = sanitizeIntent(
      {
        activityType: "hiking",
        routeType: null,
        startLocationQuery: null,
        endLocationQuery: null,
        regionQuery: "Sächsische Schweiz",
        targetDistanceKm: null,
        targetDurationMinutes: null,
        difficulty: "easy",
        desiredFeatures: [],
        avoidFeatures: [],
        transportMode: "walking",
        rawPrompt: prompt,
        parserSource: "remoteAI",
        confidence: 0.9
      },
      prompt
    );

    assert.equal(intent.routeType, "loop");
    assert.equal(intent.startLocationQuery, "Sächsische Schweiz");
    assert.equal(intent.endLocationQuery, null);
    assert.equal(intent.regionQuery, "Sächsische Schweiz");
    assert.equal(intent.difficulty, "easy");
  });

  it("keeps desired features as preferences only", () => {
    const intent = sanitizeIntent(
      {
        activityType: "hiking",
        routeType: "loop",
        startLocationQuery: "Schierke",
        endLocationQuery: null,
        regionQuery: null,
        targetDistanceKm: 15,
        targetDurationMinutes: null,
        difficulty: null,
        desiredFeatures: ["viewpoint", "forest", "water"],
        avoidFeatures: [],
        transportMode: "walking",
        rawPrompt: "15 km loop around Schierke with views, forest and water",
        parserSource: "remoteAI",
        confidence: 0.9
      },
      "15 km loop around Schierke with views, forest and water"
    );

    assert.deepEqual(intent.desiredFeatures, ["viewpoint", "forest", "water"]);
    assert.equal("scenicQuality" in intent, false);
    assert.equal("waterAvailable" in intent, false);
  });

  it("rejects geometry fields from model output", () => {
    assert.throws(
      () =>
        sanitizeIntent(
          {
            activityType: "hiking",
            routeType: "loop",
            startLocationQuery: "Schierke",
            endLocationQuery: null,
            regionQuery: null,
            targetDistanceKm: 15,
            targetDurationMinutes: null,
            difficulty: null,
            desiredFeatures: [],
            avoidFeatures: [],
            transportMode: "walking",
            rawPrompt: "15 km loop around Schierke",
            parserSource: "remoteAI",
            confidence: 0.9,
            geometry: [[51.0, 10.0]]
          },
          "15 km loop around Schierke"
        ),
      /forbidden field: geometry/
    );
  });

  it("calls OpenRouter with JSON schema response format when key is configured", async () => {
    const fetchCalls = [];
    const fetchImpl = async (url, init) => {
      fetchCalls.push({ url, init });
      return {
        ok: true,
        async json() {
          return {
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    activityType: "hiking",
                    routeType: "pointToPoint",
                    startLocationQuery: "Ilsenburg",
                    endLocationQuery: "Schierke",
                    regionQuery: null,
                    targetDistanceKm: null,
                    targetDurationMinutes: null,
                    difficulty: null,
                    desiredFeatures: [],
                    avoidFeatures: [],
                    transportMode: "walking",
                    rawPrompt: "Ilsenburg to Schierke",
                    parserSource: "remoteAI",
                    confidence: 0.8
                  })
                }
              }
            ]
          };
        }
      };
    };

    const intent = await parseIntentEndpoint(
      { prompt: "Ilsenburg to Schierke", locale: "en" },
      {
        env: {
          OPENROUTER_API_KEY: "test-key",
          OPENROUTER_MODEL: "test/model"
        },
        fetchImpl
      }
    );

    assert.equal(intent.startLocationQuery, "Ilsenburg");
    assert.equal(fetchCalls.length, 1);
    assert.equal(fetchCalls[0].url, OPENROUTER_CHAT_COMPLETIONS_URL);

    const body = JSON.parse(fetchCalls[0].init.body);
    assert.equal(body.model, "test/model");
    assert.equal(body.response_format.type, "json_schema");
    assert.equal(body.response_format.json_schema.strict, true);
    assert.equal(body.provider.require_parameters, true);
    assert.equal(fetchCalls[0].init.headers.Authorization, "Bearer test-key");
  });

  it("repairs under-specified OpenRouter JSON before returning it to the app", async () => {
    const prompt = [
      "Ich will eine entspannte Runde bei Ilsenburg, ca. 3 Stunden",
      "Mach mir eine kurze Wanderung bei Lüneburg, eher easy"
    ].join("\n");
    const fetchImpl = async () => ({
      ok: true,
      async json() {
        return {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  activityType: null,
                  routeType: "loop",
                  startLocationQuery: null,
                  endLocationQuery: null,
                  regionQuery: null,
                  targetDistanceKm: null,
                  targetDurationMinutes: null,
                  difficulty: null,
                  desiredFeatures: [],
                  avoidFeatures: [],
                  transportMode: null,
                  rawPrompt: prompt,
                  parserSource: "remoteAI",
                  confidence: 0.42
                })
              }
            }
          ]
        };
      }
    });

    const intent = await parseIntentEndpoint(
      { prompt, locale: "de" },
      {
        env: {
          OPENROUTER_API_KEY: "test-key",
          OPENROUTER_MODEL: "test/model"
        },
        fetchImpl
      }
    );

    assert.equal(intent.parserSource, "remoteAI");
    assert.equal(intent.activityType, "hiking");
    assert.equal(intent.routeType, "loop");
    assert.equal(intent.startLocationQuery, "Ilsenburg");
    assert.equal(intent.endLocationQuery, null);
    assert.equal(intent.targetDurationMinutes, 180);
    assert.equal(intent.difficulty, "easy");
  });

  it("repairs point-to-point remoteAI output with locations but missing activity", async () => {
    const prompt = "Lüneburg bis Bardowick";
    const fetchImpl = async () => ({
      ok: true,
      async json() {
        return {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  activityType: null,
                  routeType: "pointToPoint",
                  startLocationQuery: "Lüneburg",
                  endLocationQuery: "Bardowick",
                  regionQuery: null,
                  targetDistanceKm: null,
                  targetDurationMinutes: null,
                  difficulty: null,
                  desiredFeatures: [],
                  avoidFeatures: [],
                  transportMode: null,
                  rawPrompt: prompt,
                  parserSource: "remoteAI",
                  confidence: 0.9
                })
              }
            }
          ]
        };
      }
    });

    const intent = await parseIntentEndpoint(
      { prompt, locale: "de" },
      {
        env: {
          OPENROUTER_API_KEY: "test-key",
          OPENROUTER_MODEL: "test/model"
        },
        fetchImpl
      }
    );

    assert.equal(intent.parserSource, "remoteAI");
    assert.equal(intent.activityType, "hiking");
    assert.equal(intent.routeType, "pointToPoint");
    assert.equal(intent.startLocationQuery, "Lüneburg");
    assert.equal(intent.endLocationQuery, "Bardowick");
    assert.equal(intent.transportMode, "walking");
  });

  it("uses Google Gemini as the primary provider when configured", async () => {
    const fetchCalls = [];
    const fetchImpl = async (url, init) => {
      fetchCalls.push({ url, init });
      return {
        ok: true,
        async json() {
          return {
            output_text: JSON.stringify({
              activityType: "hiking",
              routeType: "loop",
              startLocationQuery: "Schierke",
              endLocationQuery: null,
              regionQuery: null,
              targetDistanceKm: 15,
              targetDurationMinutes: null,
              difficulty: "easy",
              desiredFeatures: [],
              avoidFeatures: ["repeatedPath"],
              transportMode: "walking",
              rawPrompt:
                "Ich will eine entspannte 15 km Rundwanderung um Schierke mit wenig gleicher Strecke zurück",
              parserSource: "remoteAI",
              confidence: 0.87
            })
          };
        }
      };
    };

    const intent = await parseIntentEndpoint(
      {
        prompt:
          "Ich will eine entspannte 15 km Rundwanderung um Schierke mit wenig gleicher Strecke zurück",
        locale: "de"
      },
      {
        env: {
          AI_PROVIDER: "google",
          GOOGLE_API_KEY: "google-test-key",
          GOOGLE_MODEL: "gemini-3.5-flash",
          OPENROUTER_API_KEY: "openrouter-test-key"
        },
        fetchImpl
      }
    );

    assert.equal(intent.routeType, "loop");
    assert.equal(intent.startLocationQuery, "Schierke");
    assert.equal(fetchCalls.length, 1);
    assert.equal(fetchCalls[0].url, GOOGLE_INTERACTIONS_URL);

    const body = JSON.parse(fetchCalls[0].init.body);
    assert.equal(body.model, "gemini-3.5-flash");
    assert.equal(body.response_format.mime_type, "application/json");
    assert.equal(fetchCalls[0].init.headers["x-goog-api-key"], "google-test-key");
    assert.equal(fetchCalls[0].init.headers.Authorization, undefined);
  });

  it("parses Google Gemini Interactions API model_output steps", async () => {
    const fetchImpl = async () => ({
      ok: true,
      async json() {
        return {
          steps: [
            { type: "thought", signature: "redacted" },
            {
              type: "model_output",
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    activityType: "hiking",
                    routeType: "loop",
                    startLocationQuery: "Schierke",
                    endLocationQuery: null,
                    regionQuery: null,
                    targetDistanceKm: 15,
                    targetDurationMinutes: null,
                    difficulty: "easy",
                    desiredFeatures: ["lowRepeat"],
                    avoidFeatures: ["repeatedPath"],
                    transportMode: "walking",
                    rawPrompt:
                      "Ich will eine entspannte 15 km Rundwanderung um Schierke mit wenig gleicher Strecke zurück",
                    parserSource: "remoteAI",
                    confidence: 0.95
                  })
                }
              ]
            }
          ]
        };
      }
    });

    const intent = await parseIntentEndpoint(
      {
        prompt:
          "Ich will eine entspannte 15 km Rundwanderung um Schierke mit wenig gleicher Strecke zurück",
        locale: "de"
      },
      {
        env: {
          AI_PROVIDER: "google",
          GOOGLE_API_KEY: "google-test-key",
          GOOGLE_MODEL: "gemini-3.5-flash"
        },
        fetchImpl
      }
    );

    assert.equal(intent.routeType, "loop");
    assert.equal(intent.startLocationQuery, "Schierke");
    assert.deepEqual(intent.avoidFeatures, ["repeatedPath"]);
  });

  it("gracefully handles malformed OpenRouter JSON", async () => {
    const fetchImpl = async () => ({
      ok: true,
      async json() {
        return { choices: [{ message: { content: "{not-json" } }] };
      }
    });

    await assert.rejects(
      () =>
        parseIntentEndpoint(
          { prompt: "Ilsenburg to Schierke" },
          { env: { OPENROUTER_API_KEY: "test-key" }, fetchImpl }
        ),
      /malformed intent JSON/
    );
  });

  it("gracefully handles malformed Google Gemini JSON", async () => {
    const fetchImpl = async () => ({
      ok: true,
      async json() {
        return { output_text: "{not-json" };
      }
    });

    await assert.rejects(
      () =>
        parseIntentEndpoint(
          { prompt: "Ilsenburg to Schierke" },
          {
            env: {
              AI_PROVIDER: "google",
              GOOGLE_API_KEY: "test-key",
              GOOGLE_MODEL: "gemini-3.5-flash"
            },
            fetchImpl
          }
        ),
      /malformed intent JSON/
    );
  });
});
