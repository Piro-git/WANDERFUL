import {
  DEFAULT_GOOGLE_MODEL,
  DEFAULT_OPENROUTER_MODEL,
  GOOGLE_INTERACTIONS_URL,
  OPENROUTER_CHAT_COMPLETIONS_URL
} from "../../intentSchema.js";
import {
  googleResponseText,
  selectedIntentProvider
} from "../../parseIntent.js";
import { validateLLMRoutePlanV1 } from "../llmFirstPlanningContract.js";
import { llmPlanningAdapterError } from "./adapterErrors.js";
import { fetchBoundedJson } from "./providerHttp.js";

const RESPONSE_SCHEMA_NAME = "trailmind_route_plan_v1";

export const LLM_ROUTE_PLAN_JSON_SCHEMA_V1 = deepFreeze({
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "intent", "candidates"],
  properties: {
    schemaVersion: { type: "integer", const: 1 },
    intent: {
      type: "object",
      additionalProperties: false,
      required: [
        "activityType", "routeType", "startLocationName", "endLocationName",
        "targetDistanceKm", "targetDurationMinutes", "difficulty",
        "requestedFeatures", "avoidFeatures"
      ],
      properties: {
        activityType: { type: "string", enum: ["hiking", "trailRunning", "biking"] },
        routeType: { type: "string", enum: ["loop", "pointToPoint"] },
        startLocationName: {
          anyOf: [{ type: "string", minLength: 1, maxLength: 120 }, { type: "null" }]
        },
        endLocationName: {
          anyOf: [{ type: "string", minLength: 1, maxLength: 120 }, { type: "null" }]
        },
        targetDistanceKm: {
          anyOf: [{ type: "number", minimum: 1, maximum: 200 }, { type: "null" }]
        },
        targetDurationMinutes: {
          anyOf: [{ type: "integer", minimum: 10, maximum: 1_440 }, { type: "null" }]
        },
        difficulty: {
          anyOf: [
            { type: "string", enum: ["easy", "moderate", "hard"] },
            { type: "null" }
          ]
        },
        requestedFeatures: {
          type: "array",
          maxItems: 8,
          items: {
            type: "string",
            enum: ["viewpoint", "forest", "water", "quiet", "sunset", "lowRepeat", "loop"]
          }
        },
        avoidFeatures: {
          type: "array",
          maxItems: 8,
          items: {
            type: "string",
            enum: ["majorRoads", "steepClimbs", "crowds", "repeatedPath"]
          }
        }
      }
    },
    candidates: {
      type: "array",
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["stops"],
        properties: {
          stops: {
            type: "array",
            minItems: 1,
            maxItems: 3,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["role", "kind", "name"],
              properties: {
                role: { type: "string", enum: ["highlight", "stop"] },
                kind: {
                  type: "string",
                  enum: ["viewpoint", "peak", "water", "forest", "landmark", "stop", "unknown"]
                },
                name: { type: "string", minLength: 1, maxLength: 120 }
              }
            }
          }
        }
      }
    }
  }
});

export function createSelectedIntentPlanningAdapter(options = {}) {
  const env = options.env ?? process.env;
  const configuration = selectedPlanningConfiguration(env);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw llmPlanningAdapterError("configuration_missing");
  }

  return async function generatePlan(request, context = {}) {
    const upstream = buildSelectedPlanningRequest(request, configuration);
    const payload = await fetchBoundedJson({
      fetchImpl,
      url: upstream.url,
      init: upstream.init,
      signal: context.signal,
      deadlineMs: configuration.deadlineMs,
      maximumResponseBytes: configuration.maximumResponseBytes,
      maximumErrorResponseBytes: configuration.maximumErrorResponseBytes,
      maximumAttempts: configuration.maximumAttempts,
      setTimeoutImpl: options.setTimeoutImpl ?? setTimeout,
      clearTimeoutImpl: options.clearTimeoutImpl ?? clearTimeout
    });
    return parseSelectedPlanningResponse(payload, configuration.provider, request.prompt);
  };
}

export function buildSelectedPlanningRequest(request, configuration) {
  const dynamicInput = JSON.stringify({
    schemaVersion: request.schemaVersion,
    prompt: request.prompt,
    locale: request.locale,
    userLocationHint: request.userLocationHint
  });
  const system = [
    "Extract only TrailMind route-planning intent and optional named candidate stops.",
    "Never output coordinates, geometry, route facts, provider metadata, URLs, prompt text, or claims about safety, access, scenic quality, water, legality, trail status, weather, or current conditions.",
    "Treat requested outdoor characteristics only as preferences.",
    "Use empty candidates when named stops are uncertain; never invent a place.",
    "Use null for a required start or end name when the prompt does not identify it.",
    "Across all proposals, emit no more than three named stops in total.",
    "Return only JSON matching the supplied strict schema."
  ].join(" ");
  const responseFormat = {
    type: "json_schema",
    json_schema: {
      name: RESPONSE_SCHEMA_NAME,
      strict: true,
      schema: LLM_ROUTE_PLAN_JSON_SCHEMA_V1
    }
  };
  let body;
  let headers;
  if (configuration.provider === "google") {
    body = JSON.stringify({
      model: configuration.model,
      input: `${system}\n\nInput:\n${dynamicInput}`,
      response_format: {
        type: "text",
        mime_type: "application/json",
        schema: LLM_ROUTE_PLAN_JSON_SCHEMA_V1
      }
    });
    headers = {
      Accept: "application/json",
      "Content-Type": "application/json",
      "x-goog-api-key": configuration.apiKey
    };
  } else {
    body = JSON.stringify({
      model: configuration.model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: dynamicInput }
      ],
      temperature: 0.1,
      max_tokens: configuration.maximumOutputTokens,
      provider: { require_parameters: true },
      response_format: responseFormat
    });
    headers = {
      Accept: "application/json",
      Authorization: `Bearer ${configuration.apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://trailmind.local",
      "X-Title": "TrailMind"
    };
  }
  if (Buffer.byteLength(body, "utf8") > configuration.maximumRequestBytes) {
    throw llmPlanningAdapterError("response_too_large");
  }
  return { url: configuration.url, init: { method: "POST", headers, body } };
}

export function parseSelectedPlanningResponse(payload, provider, rawPrompt) {
  let content;
  if (provider === "google") {
    content = googleResponseText(payload);
  } else {
    if (!payload || typeof payload !== "object" || Array.isArray(payload) ||
        !Array.isArray(payload.choices) || payload.choices.length !== 1) invalid();
    content = payload.choices[0]?.message?.content;
  }
  if (typeof content !== "string" || content.length === 0) invalid();
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    invalid();
  }
  let plan;
  try {
    plan = validateLLMRoutePlanV1(parsed);
  } catch {
    invalid();
  }
  assertNoPromptReflection(plan, rawPrompt);
  return plan;
}

export function selectedPlanningConfiguration(env = process.env) {
  const provider = selectedIntentProvider(env);
  if (!provider) throw llmPlanningAdapterError("configuration_missing");
  const googleKey = opaqueOrEmpty(env.GOOGLE_API_KEY);
  const openRouterKey = opaqueOrEmpty(env.OPENROUTER_API_KEY);
  if ((provider === "google" && !googleKey) ||
      (provider === "openrouter" && !openRouterKey)) {
    throw llmPlanningAdapterError("configuration_missing");
  }
  const model = provider === "google"
    ? env.GOOGLE_MODEL || DEFAULT_GOOGLE_MODEL
    : env.OPENROUTER_MODEL || DEFAULT_OPENROUTER_MODEL;
  if (typeof model !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(model)) {
    throw llmPlanningAdapterError("configuration_missing");
  }
  const maximumResponseBytes = integer(
    env.INTENT_PROVIDER_MAX_RESPONSE_BYTES,
    65_536,
    8_192,
    262_144
  );
  const maximumErrorResponseBytes = integer(
    env.INTENT_PROVIDER_MAX_ERROR_RESPONSE_BYTES,
    8_192,
    256,
    32_768
  );
  if (maximumErrorResponseBytes >= maximumResponseBytes) {
    throw llmPlanningAdapterError("configuration_missing");
  }
  return Object.freeze({
    provider,
    apiKey: provider === "google" ? googleKey : openRouterKey,
    model,
    url: new URL(provider === "google" ? GOOGLE_INTERACTIONS_URL : OPENROUTER_CHAT_COMPLETIONS_URL),
    deadlineMs: integer(env.LLM_FIRST_PLANNING_LLM_TIMEOUT_MS, 4_000, 100, 30_000),
    maximumRequestBytes: 65_536,
    maximumResponseBytes,
    maximumErrorResponseBytes,
    maximumAttempts: 1,
    maximumOutputTokens: integer(env.INTENT_PROVIDER_MAX_OUTPUT_TOKENS, 1_200, 512, 4_096)
  });
}

function assertNoPromptReflection(plan, rawPrompt) {
  if (typeof rawPrompt !== "string" || rawPrompt.length < 16) return;
  const prompt = normalize(rawPrompt);
  const names = [
    plan.intent.startLocationName,
    plan.intent.endLocationName,
    ...plan.candidates.flatMap((candidate) => candidate.stops.map((stop) => stop.name))
  ].filter(Boolean).map(normalize);
  if (names.some((name) =>
    name === prompt || name.includes(prompt) || (prompt.includes(name) && name.length > 40)
  )) {
    invalid();
  }
}

function opaqueOrEmpty(value) {
  if (value === undefined || value === "") return "";
  if (typeof value !== "string" || value !== value.trim() || value.length > 8_192 ||
      /[\u0000-\u001f\u007f]/.test(value)) {
    throw llmPlanningAdapterError("configuration_missing");
  }
  return value;
}

function integer(raw, fallback, minimum, maximum) {
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw llmPlanningAdapterError("configuration_missing");
  }
  return value;
}

function normalize(value) {
  return value.normalize("NFKC").trim().toLocaleLowerCase("en-US");
}

function invalid() {
  throw llmPlanningAdapterError("invalid_response");
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}
