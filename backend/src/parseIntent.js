import {
  DEFAULT_GOOGLE_MODEL,
  DEFAULT_OPENROUTER_MODEL,
  GOOGLE_INTERACTIONS_URL,
  OPENROUTER_CHAT_COMPLETIONS_URL,
  googleResponseFormat,
  responseFormat
} from "./intentSchema.js";

const SYSTEM_PROMPT = `
You extract outdoor route planning intent for TrailMind.

Rules:
- Extract outdoor route planning intent only.
- Do not generate route geometry.
- Do not invent distances, elevation, safety, scenic quality, water availability, trail status, camping legality, or verified POIs.
- Put unverified wishes into desiredFeatures or avoidFeatures only.
- If required information is missing, return null fields and low confidence instead of guessing.
- Return only JSON matching the provided schema.
`.trim();

const ALLOWED_ACTIVITY_TYPES = new Set(["hiking", "trailRunning", "biking"]);
const ALLOWED_ROUTE_TYPES = new Set(["loop", "pointToPoint"]);
const ALLOWED_DIFFICULTIES = new Set(["easy", "moderate", "hard"]);
const ALLOWED_DESIRED_FEATURES = new Set([
  "viewpoint",
  "forest",
  "water",
  "quiet",
  "sunset",
  "lowRepeat",
  "loop"
]);
const ALLOWED_AVOID_FEATURES = new Set([
  "majorRoads",
  "steepClimbs",
  "crowds",
  "repeatedPath"
]);
const ALLOWED_TRANSPORT_MODES = new Set(["walking", "cycling"]);
const FORBIDDEN_OUTPUT_KEYS = new Set([
  "geometry",
  "routeGeometry",
  "path",
  "polyline",
  "coordinates",
  "distanceMeters",
  "elevationGainMeters",
  "elevationLossMeters",
  "safetyVerified",
  "verifiedPois",
  "waterAvailable",
  "trailStatus"
]);

export class IntentParseError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.name = "IntentParseError";
    this.statusCode = statusCode;
  }
}

export async function parseIntentEndpoint(input, options = {}) {
  const request = validateRequest(input);
  const env = options.env ?? process.env;
  const provider = selectedProvider(env);

  if (provider === "google" && env.GOOGLE_API_KEY) {
    return parseWithGoogle(request, env, options);
  }

  if (provider === "openrouter" && env.OPENROUTER_API_KEY) {
    return parseWithOpenRouter(request, env, options);
  }

  if (env.GOOGLE_API_KEY) {
    return parseWithGoogle(request, env, options);
  }

  if (env.OPENROUTER_API_KEY) {
    return parseWithOpenRouter(request, env, options);
  }

  if (!env.GOOGLE_API_KEY && !env.OPENROUTER_API_KEY) {
    return sanitizeIntent(mockIntent(request), request.prompt);
  }
}

async function parseWithOpenRouter(request, env, options = {}) {
  const apiKey = env.OPENROUTER_API_KEY;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new IntentParseError("Fetch is not available in this runtime.");
  }

  const model = env.OPENROUTER_MODEL || DEFAULT_OPENROUTER_MODEL;
  const response = await fetchImpl(OPENROUTER_CHAT_COMPLETIONS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://trailmind.local",
      "X-Title": "TrailMind"
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt(request) }
      ],
      temperature: 0.1,
      max_tokens: 500,
      provider: {
        require_parameters: true
      },
      response_format: responseFormat
    })
  });

  if (!response.ok) {
    const message = await safeResponseText(response);
    throw new IntentParseError(
      `OpenRouter intent parsing failed (${response.status}): ${message}`,
      502
    );
  }

  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || content.trim().length === 0) {
    throw new IntentParseError("OpenRouter returned an empty intent response.", 502);
  }

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new IntentParseError("OpenRouter returned malformed intent JSON.", 502);
  }

  return sanitizeIntent(parsed, request.prompt);
}

async function parseWithGoogle(request, env, options = {}) {
  const apiKey = env.GOOGLE_API_KEY;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new IntentParseError("Fetch is not available in this runtime.");
  }

  const model = env.GOOGLE_MODEL || DEFAULT_GOOGLE_MODEL;
  const response = await fetchImpl(GOOGLE_INTERACTIONS_URL, {
    method: "POST",
    headers: {
      "x-goog-api-key": apiKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      input: `${SYSTEM_PROMPT}\n\nInput:\n${userPrompt(request)}`,
      response_format: googleResponseFormat
    })
  });

  if (!response.ok) {
    const message = await safeResponseText(response);
    throw new IntentParseError(
      `Google Gemini intent parsing failed (${response.status}): ${message}`,
      502
    );
  }

  const payload = await response.json();
  const content = googleResponseText(payload);
  if (typeof content !== "string" || content.trim().length === 0) {
    throw new IntentParseError("Google Gemini returned an empty intent response.", 502);
  }

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new IntentParseError("Google Gemini returned malformed intent JSON.", 502);
  }

  return sanitizeIntent(parsed, request.prompt);
}

function googleResponseText(payload) {
  const direct =
    payload?.output_text ??
    payload?.outputText ??
    payload?.text ??
    payload?.candidates?.[0]?.content?.parts?.map((part) => part.text).join("");
  if (typeof direct === "string" && direct.trim().length > 0) {
    return direct;
  }

  const modelOutput = payload?.steps
    ?.filter((step) => step?.type === "model_output")
    ?.flatMap((step) => step?.content ?? [])
    ?.map((part) => part?.text)
    ?.find((text) => typeof text === "string" && text.trim().length > 0);

  return modelOutput;
}

export function validateRequest(input) {
  if (!input || typeof input !== "object") {
    throw new IntentParseError("Request body must be a JSON object.", 400);
  }
  const prompt = cleanString(input.prompt);
  if (!prompt) {
    throw new IntentParseError("prompt is required.", 400);
  }
  if (prompt.length > 1000) {
    throw new IntentParseError("prompt is too long.", 400);
  }

  const locale = input.locale === "de" || input.locale === "en" ? input.locale : undefined;
  const userLocationHint =
    input.userLocationHint === null || input.userLocationHint === undefined
      ? null
      : cleanString(input.userLocationHint);

  return { prompt, locale, userLocationHint };
}

function selectedProvider(env) {
  const value = cleanString(env.AI_PROVIDER).toLowerCase();
  if (value === "google" || value === "gemini") return "google";
  if (value === "openrouter") return "openrouter";
  return null;
}

export function sanitizeIntent(rawIntent, rawPrompt) {
  if (!rawIntent || typeof rawIntent !== "object" || Array.isArray(rawIntent)) {
    throw new IntentParseError("Intent response must be an object.", 502);
  }

  for (const key of Object.keys(rawIntent)) {
    if (FORBIDDEN_OUTPUT_KEYS.has(key)) {
      throw new IntentParseError(`Intent response included forbidden field: ${key}`, 502);
    }
  }

  const activityType = enumOrNull(rawIntent.activityType, ALLOWED_ACTIVITY_TYPES);
  const routeType = enumOrNull(rawIntent.routeType, ALLOWED_ROUTE_TYPES);
  const targetDistanceKm = saneNumberOrNull(rawIntent.targetDistanceKm, 0.1, 300);
  const targetDurationMinutes = saneNumberOrNull(rawIntent.targetDurationMinutes, 5, 10080);

  let confidence = saneNumberOrNull(rawIntent.confidence, 0, 1);
  if (confidence === null) {
    confidence = 0.3;
  }
  if (routeType === "loop" && !cleanString(rawIntent.startLocationQuery) && !cleanString(rawIntent.regionQuery)) {
    confidence = Math.min(confidence, 0.35);
  }
  if (routeType === "pointToPoint" && (!cleanString(rawIntent.startLocationQuery) || !cleanString(rawIntent.endLocationQuery))) {
    confidence = Math.min(confidence, 0.35);
  }

  return {
    activityType,
    routeType,
    startLocationQuery: cleanStringOrNull(rawIntent.startLocationQuery),
    endLocationQuery: cleanStringOrNull(rawIntent.endLocationQuery),
    regionQuery: cleanStringOrNull(rawIntent.regionQuery),
    targetDistanceKm,
    targetDurationMinutes,
    difficulty: enumOrNull(rawIntent.difficulty, ALLOWED_DIFFICULTIES),
    desiredFeatures: uniqueAllowed(rawIntent.desiredFeatures, ALLOWED_DESIRED_FEATURES),
    avoidFeatures: uniqueAllowed(rawIntent.avoidFeatures, ALLOWED_AVOID_FEATURES),
    transportMode: enumOrNull(rawIntent.transportMode, ALLOWED_TRANSPORT_MODES),
    rawPrompt,
    parserSource: "remoteAI",
    confidence
  };
}

function userPrompt(request) {
  return JSON.stringify({
    prompt: request.prompt,
    locale: request.locale ?? null,
    userLocationHint: request.userLocationHint ?? null,
    outputContract:
      "Extract intent only. Desired/avoid features are requested preferences, not verified facts."
  });
}

function mockIntent(request) {
  const normalized = request.prompt.toLowerCase();
  const targetDistanceKm = firstNumberBefore(normalized, ["km", "kilometer"]);
  const targetDurationMinutes = durationMinutes(normalized);
  const isBike = /\b(bike|biking|radroute|radtour|fahrrad)\b/.test(normalized);
  const isRun = /\b(trailrun|trail run|running|joggen|lauf)\b/.test(normalized);
  const activityType = isBike ? "biking" : isRun ? "trailRunning" : "hiking";
  const routeType =
    /\b(rundwanderung|rundtour|runde|loop|round trip)\b/.test(normalized)
      ? "loop"
      : /\b(nach|zum|zur|to|→|->)\b/.test(normalized)
        ? "pointToPoint"
        : null;

  const { startLocationQuery, endLocationQuery, regionQuery } = mockLocations(
    request.prompt,
    normalized,
    routeType
  );

  const desiredFeatures = [];
  if (/\b(aussicht|view|views|panorama)\b/.test(normalized)) desiredFeatures.push("viewpoint");
  if (/\b(wald|forest)\b/.test(normalized)) desiredFeatures.push("forest");
  if (/\b(wasser|water|wasserfall|waterfall)\b/.test(normalized)) desiredFeatures.push("water");
  if (/\b(ruhig|quiet)\b/.test(normalized)) desiredFeatures.push("quiet");
  if (/\b(sonnenuntergang|sunset)\b/.test(normalized)) desiredFeatures.push("sunset");

  const avoidFeatures = [];
  if (/\b(steil|steep)\b/.test(normalized)) avoidFeatures.push("steepClimbs");
  if (/\b(wenig gleicher strecke|gleiche strecke|zurück|backtracking|repeated)\b/.test(normalized)) {
    avoidFeatures.push("repeatedPath");
  }

  return {
    activityType,
    routeType,
    startLocationQuery,
    endLocationQuery,
    regionQuery,
    targetDistanceKm,
    targetDurationMinutes,
    difficulty: /\b(entspannt|entspannte|entspannten|relaxed|leicht|easy)\b/.test(normalized)
      ? "easy"
      : null,
    desiredFeatures,
    avoidFeatures,
    transportMode: activityType === "biking" ? "cycling" : "walking",
    rawPrompt: request.prompt,
    parserSource: "remoteAI",
    confidence: routeType && (startLocationQuery || regionQuery) ? 0.78 : 0.25
  };
}

function mockLocations(prompt, normalized, routeType) {
  if (routeType === "loop") {
    const match = prompt.match(/\b(?:um|bei|ab|around|from)\s+([^,.;!?]+?)(?:\s+(?:mit|with|ca\.?|for|für)\b|$)/i);
    const location = cleanLocationStringOrNull(match?.[1]);
    return {
      startLocationQuery: location,
      endLocationQuery: null,
      regionQuery: null
    };
  }

  const arrow = prompt.match(/^\s*(.+?)\s*(?:→|->|=>)\s*(.+?)\s*$/);
  if (arrow) {
    return {
      startLocationQuery: cleanLocationStringOrNull(arrow[1]),
      endLocationQuery: cleanLocationStringOrNull(arrow[2]),
      regionQuery: null
    };
  }

  const explicitEnglish = prompt.match(/\bfrom\s+(.+?)\s+to\s+([^,.;!?]+)$/i);
  if (explicitEnglish) {
    return {
      startLocationQuery: cleanLocationStringOrNull(explicitEnglish[1]),
      endLocationQuery: cleanLocationStringOrNull(explicitEnglish[2]),
      regionQuery: null
    };
  }

  const german = prompt.match(/\b(?:von\s+)?(.+?)\s+(?:nach|zum|zur)\s+([^,.;!?]+)$/i);
  if (german && !normalized.startsWith("ich möchte nach")) {
    return {
      startLocationQuery: stripRouteLead(german[1]),
      endLocationQuery: cleanLocationStringOrNull(german[2]),
      regionQuery: null
    };
  }

  const english = prompt.match(/\b(.+?)\s+to\s+([^,.;!?]+)$/i);
  if (english) {
    return {
      startLocationQuery: stripRouteLead(english[1]),
      endLocationQuery: cleanLocationStringOrNull(english[2]),
      regionQuery: null
    };
  }

  return {
    startLocationQuery: null,
    endLocationQuery: null,
    regionQuery: null
  };
}

function stripRouteLead(value) {
  return cleanLocationStringOrNull(
    String(value).replace(/^(?:plan(?:e)?|mach mir|wanderung|route|tour|hike|bike route|radroute)\s+/i, "")
  );
}

function cleanString(value) {
  if (typeof value !== "string") return "";
  return value
    .trim()
    .replace(/\s+/g, " ");
}

function cleanStringOrNull(value) {
  const cleaned = cleanString(value);
  return cleaned.length > 0 ? cleaned : null;
}

function cleanLocationStringOrNull(value) {
  const cleaned = cleanString(value)
    .replace(/\s+(?:mit|with)\s+(?:aussicht|views?|panorama|wald|forest|wasser|water|wasserfall|waterfall|ruhig|quiet|sonnenuntergang|sunset)\b.*$/i, "")
    .replace(/\s+(?:ca\.?|circa|about|around)\s+\d+(?:[,.]\d+)?\s*(?:km|kilometer|h|std\.?|stunden?|hours?|hrs?)\b.*$/i, "")
    .trim();
  return cleaned.length > 0 ? cleaned : null;
}

function enumOrNull(value, allowed) {
  return typeof value === "string" && allowed.has(value) ? value : null;
}

function saneNumberOrNull(value, min, max) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value < min || value > max) return null;
  return value;
}

function uniqueAllowed(value, allowed) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item) => typeof item === "string" && allowed.has(item)))];
}

function firstNumberBefore(text, units) {
  const unitPattern = units.join("|");
  const match = text.match(new RegExp(`(\\d+(?:[,.]\\d+)?)\\s*(?:${unitPattern})\\b`, "i"));
  return match ? Number(match[1].replace(",", ".")) : null;
}

function durationMinutes(text) {
  const match = text.match(/(\d+(?:[,.]\d+)?)\s*(?:h|std\.?|stunden?|hours?|hrs?)\b/i);
  if (!match) return null;
  return Math.round(Number(match[1].replace(",", ".")) * 60);
}

async function safeResponseText(response) {
  try {
    const text = await response.text();
    return text.slice(0, 400);
  } catch {
    return "No response body";
  }
}
