export const DEFAULT_OPENROUTER_MODEL = "openai/gpt-4o-mini";
export const DEFAULT_GOOGLE_MODEL = "gemini-3.5-flash";

export const OPENROUTER_CHAT_COMPLETIONS_URL =
  "https://openrouter.ai/api/v1/chat/completions";
export const GOOGLE_INTERACTIONS_URL =
  "https://generativelanguage.googleapis.com/v1beta/interactions";

export const intentJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "activityType",
    "routeType",
    "startLocationQuery",
    "endLocationQuery",
    "regionQuery",
    "targetDistanceKm",
    "targetDurationMinutes",
    "difficulty",
    "desiredFeatures",
    "avoidFeatures",
    "transportMode",
    "rawPrompt",
    "parserSource",
    "confidence"
  ],
  properties: {
    activityType: {
      anyOf: [
        { type: "string", enum: ["hiking", "trailRunning", "biking"] },
        { type: "null" }
      ]
    },
    routeType: {
      anyOf: [
        { type: "string", enum: ["loop", "pointToPoint"] },
        { type: "null" }
      ]
    },
    startLocationQuery: {
      anyOf: [{ type: "string", maxLength: 160 }, { type: "null" }]
    },
    endLocationQuery: {
      anyOf: [{ type: "string", maxLength: 160 }, { type: "null" }]
    },
    regionQuery: {
      anyOf: [{ type: "string", maxLength: 160 }, { type: "null" }]
    },
    targetDistanceKm: {
      anyOf: [{ type: "number", minimum: 0.1, maximum: 300 }, { type: "null" }]
    },
    targetDurationMinutes: {
      anyOf: [{ type: "number", minimum: 5, maximum: 10080 }, { type: "null" }]
    },
    difficulty: {
      anyOf: [
        { type: "string", enum: ["easy", "moderate", "hard"] },
        { type: "null" }
      ]
    },
    desiredFeatures: {
      type: "array",
      maxItems: 12,
      items: {
        type: "string",
        enum: ["viewpoint", "forest", "water", "quiet", "sunset", "lowRepeat", "loop"]
      }
    },
    avoidFeatures: {
      type: "array",
      maxItems: 12,
      items: {
        type: "string",
        enum: ["majorRoads", "steepClimbs", "crowds", "repeatedPath"]
      }
    },
    transportMode: {
      anyOf: [
        { type: "string", enum: ["walking", "cycling"] },
        { type: "null" }
      ]
    },
    rawPrompt: { type: "string", maxLength: 1000 },
    parserSource: { type: "string", enum: ["remoteAI"] },
    confidence: { type: "number", minimum: 0, maximum: 1 }
  }
};

export const responseFormat = {
  type: "json_schema",
  json_schema: {
    name: "trailmind_adventure_intent",
    strict: true,
    schema: intentJsonSchema
  }
};

export const googleResponseFormat = {
  type: "text",
  mime_type: "application/json",
  schema: intentJsonSchema
};
