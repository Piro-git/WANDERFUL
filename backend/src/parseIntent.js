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
- TrailMind-specific language:
  - German "Runde", "Rundwanderung", "Rundtour", "Rundweg" means routeType "loop".
  - "bei/um/ab <place>", "around/near/from <place>", and "im/in der/in den <region>" identify the loop start or region.
  - If a pasted prompt contains multiple route requests on separate lines, extract the first actionable route request.
  - Duration-only loop requests are valid: set targetDurationMinutes and leave targetDistanceKm null.
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

const DEFAULT_PROVIDER_TIMEOUT_MS = 15_000;
const MIN_PROVIDER_TIMEOUT_MS = 1_000;
const MAX_PROVIDER_TIMEOUT_MS = 30_000;
const DEFAULT_PROVIDER_MAX_RESPONSE_BYTES = 65_536;
const MIN_PROVIDER_MAX_RESPONSE_BYTES = 1_024;
const MAX_PROVIDER_MAX_RESPONSE_BYTES = 262_144;
const DEFAULT_INTENT_LEASE_TTL_MS = 60_000;
const MIN_INTENT_LEASE_TTL_MS = 10_000;
const MAX_INTENT_LEASE_TTL_MS = 600_000;
const LEASE_TIMEOUT_MARGIN_MS = 1_000;

const INTENT_ERROR_DEFINITIONS = Object.freeze({
  invalid_request: [400, "The intent request is invalid."],
  invalid_provider_response: [502, "The intent provider returned an invalid response."],
  intent_unavailable: [503, "Intent parsing is temporarily unavailable. Please try again."],
  rate_limited: [503, "Intent parsing is temporarily busy. Please try again later."],
  configuration_unavailable: [503, "Intent parsing is not configured on this server."],
  intent_timed_out: [504, "Intent parsing timed out. Please try again."],
  request_cancelled: [499, "The intent request was cancelled."]
});

export class IntentParseError extends Error {
  constructor(code, options = {}) {
    const definition = INTENT_ERROR_DEFINITIONS[code] ?? INTENT_ERROR_DEFINITIONS.intent_unavailable;
    super(definition[1], { cause: options.cause });
    this.name = "IntentParseError";
    this.code = INTENT_ERROR_DEFINITIONS[code] ? code : "intent_unavailable";
    this.statusCode = options.statusCode ?? definition[0];
  }
}

export function intentError(code, options) {
  return new IntentParseError(code, options);
}

export function intentErrorResult(error) {
  const safeError =
    error instanceof IntentParseError ? error : intentError("intent_unavailable", { cause: error });
  return {
    statusCode: safeError.statusCode,
    payload: {
      error: {
        code: safeError.code,
        message: safeError.message
      }
    }
  };
}

export async function parseIntentEndpoint(input, options = {}) {
  const request = validateRequest(input);
  const env = options.env ?? process.env;
  const provider = selectedProvider(env);

  const googleApiKey = credential(env.GOOGLE_API_KEY);
  const openRouterApiKey = credential(env.OPENROUTER_API_KEY);

  if (provider === "google" && googleApiKey) {
    return parseWithGoogle(request, env, options);
  }

  if (provider === "openrouter" && openRouterApiKey) {
    return parseWithOpenRouter(request, env, options);
  }

  if (googleApiKey) {
    return parseWithGoogle(request, env, options);
  }

  if (openRouterApiKey) {
    return parseWithOpenRouter(request, env, options);
  }

  if (deterministicMockAllowed(env)) {
    return sanitizeIntent(mockIntent(request), request.prompt, {
      parserSource: "localRuleBased"
    });
  }

  throw intentError("configuration_unavailable");
}

async function parseWithOpenRouter(request, env, options = {}) {
  const apiKey = credential(env.OPENROUTER_API_KEY);
  const model = env.OPENROUTER_MODEL || DEFAULT_OPENROUTER_MODEL;
  return executeProviderRequest({
    request,
    env,
    options,
    url: OPENROUTER_CHAT_COMPLETIONS_URL,
    init: {
      method: "POST",
      redirect: "manual",
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
    },
    responseText(payload) {
      return payload?.choices?.[0]?.message?.content;
    }
  });
}

async function parseWithGoogle(request, env, options = {}) {
  const apiKey = credential(env.GOOGLE_API_KEY);
  const model = env.GOOGLE_MODEL || DEFAULT_GOOGLE_MODEL;
  return executeProviderRequest({
    request,
    env,
    options,
    url: GOOGLE_INTERACTIONS_URL,
    init: {
      method: "POST",
      redirect: "manual",
      headers: {
        "x-goog-api-key": apiKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        input: `${SYSTEM_PROMPT}\n\nInput:\n${userPrompt(request)}`,
        response_format: googleResponseFormat
      })
    },
    responseText: googleResponseText
  });
}

async function executeProviderRequest({ request, env, options, url, init, responseText }) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const setTimeoutImpl = options.setTimeoutImpl ?? setTimeout;
  const clearTimeoutImpl = options.clearTimeoutImpl ?? clearTimeout;
  if (typeof fetchImpl !== "function") throw intentError("configuration_unavailable");
  if (typeof setTimeoutImpl !== "function" || typeof clearTimeoutImpl !== "function") {
    throw intentError("configuration_unavailable");
  }

  const configuration = providerExecutionConfiguration(env);
  const callerSignal = options.signal;
  const controller = new AbortController();
  let abortCode;
  let timeout;
  const abortUpstream = (code) => {
    if (abortCode) return;
    abortCode = code;
    controller.abort();
  };
  const abortFromCaller = () => abortUpstream("request_cancelled");
  const throwIfAborted = () => {
    if (abortCode) throw intentError(abortCode);
    if (callerSignal?.aborted) throw intentError("request_cancelled");
  };

  if (callerSignal?.aborted) throw intentError("request_cancelled");
  callerSignal?.addEventListener("abort", abortFromCaller, { once: true });
  if (callerSignal?.aborted) abortFromCaller();

  try {
    throwIfAborted();
    timeout = setTimeoutImpl(
      () => abortUpstream("intent_timed_out"),
      configuration.timeoutMs
    );
    throwIfAborted();

    const response = await fetchImpl(url, { ...init, signal: controller.signal });
    throwIfAborted();
    if (!isProviderResponse(response)) throw intentError("invalid_provider_response");
    if (!response.ok) {
      cancelProviderBody(response);
      throw providerHttpError(response.status);
    }

    const payload = await readBoundedProviderJson(
      response,
      configuration.maxResponseBytes,
      controller.signal
    );
    throwIfAborted();
    let content;
    try {
      content = responseText(payload);
    } catch (error) {
      throw intentError("invalid_provider_response", { cause: error });
    }
    if (typeof content !== "string" || content.trim().length === 0) {
      throw intentError("invalid_provider_response");
    }

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (error) {
      throw intentError("invalid_provider_response", { cause: error });
    }

    throwIfAborted();
    const result = sanitizeIntent(repairIntent(parsed, request.prompt), request.prompt, {
      parserSource: "remoteAI"
    });
    throwIfAborted();
    return result;
  } catch (error) {
    if (abortCode) throw intentError(abortCode, { cause: error });
    if (callerSignal?.aborted) throw intentError("request_cancelled", { cause: error });
    if (error instanceof IntentParseError) throw error;
    throw intentError("intent_unavailable", { cause: error });
  } finally {
    if (timeout !== undefined) clearTimeoutImpl(timeout);
    callerSignal?.removeEventListener("abort", abortFromCaller);
  }
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

function providerExecutionConfiguration(env) {
  const timeoutMs = boundedInteger(
    env.INTENT_PROVIDER_TIMEOUT_MS,
    DEFAULT_PROVIDER_TIMEOUT_MS,
    MIN_PROVIDER_TIMEOUT_MS,
    MAX_PROVIDER_TIMEOUT_MS
  );
  const maxResponseBytes = boundedInteger(
    env.INTENT_PROVIDER_MAX_RESPONSE_BYTES,
    DEFAULT_PROVIDER_MAX_RESPONSE_BYTES,
    MIN_PROVIDER_MAX_RESPONSE_BYTES,
    MAX_PROVIDER_MAX_RESPONSE_BYTES
  );
  const leaseTtlMs = boundedInteger(
    env.INTENT_GLOBAL_LEASE_TTL_SECONDS,
    DEFAULT_INTENT_LEASE_TTL_MS / 1_000,
    MIN_INTENT_LEASE_TTL_MS / 1_000,
    MAX_INTENT_LEASE_TTL_MS / 1_000
  ) * 1_000;
  if (timeoutMs > leaseTtlMs - LEASE_TIMEOUT_MARGIN_MS) {
    throw intentError("configuration_unavailable");
  }
  return { timeoutMs, maxResponseBytes };
}

function boundedInteger(rawValue, fallback, minimum, maximum) {
  if (rawValue === undefined || rawValue === "") return fallback;
  const value = Number(rawValue);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw intentError("configuration_unavailable");
  }
  return value;
}

function providerHttpError(status) {
  if (status === 401 || status === 403) return intentError("configuration_unavailable");
  if (status === 429) return intentError("rate_limited");
  if (status >= 500) return intentError("intent_unavailable");
  return intentError("invalid_provider_response");
}

function isProviderResponse(response) {
  return Boolean(
    response && typeof response === "object" &&
    typeof response.status === "number" && typeof response.ok === "boolean"
  );
}

async function readBoundedProviderJson(response, maxBytes, signal) {
  const declaredLength = providerContentLength(response);
  if (declaredLength !== null && declaredLength > maxBytes) {
    cancelProviderBody(response);
    throw intentError("invalid_provider_response");
  }

  const text = await readBoundedProviderText(response, maxBytes, signal);
  try {
    return JSON.parse(text);
  } catch (error) {
    throw intentError("invalid_provider_response", { cause: error });
  }
}

async function readBoundedProviderText(response, maxBytes, signal) {
  if (response.body && typeof response.body.getReader === "function") {
    const reader = response.body.getReader();
    const chunks = [];
    let byteCount = 0;
    const cancelForAbort = () => cancelReader(reader);
    signal?.addEventListener("abort", cancelForAbort, { once: true });
    try {
      while (true) {
        if (signal?.aborted) throw signal.reason ?? new Error("Provider response read aborted.");
        const { done, value } = await reader.read();
        if (done) break;
        if (!(value instanceof Uint8Array)) {
          cancelReader(reader);
          throw intentError("invalid_provider_response");
        }
        byteCount += value.byteLength;
        if (byteCount > maxBytes) {
          cancelReader(reader);
          throw intentError("invalid_provider_response");
        }
        chunks.push(value);
      }
      if (signal?.aborted) throw signal.reason ?? new Error("Provider response read aborted.");
      const bytes = new Uint8Array(byteCount);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch (error) {
      if (error instanceof IntentParseError) throw error;
      if (signal?.aborted) throw error;
      throw intentError("invalid_provider_response", { cause: error });
    } finally {
      signal?.removeEventListener("abort", cancelForAbort);
      try {
        reader.releaseLock();
      } catch {
        // The body is already cancelled or consumed.
      }
    }
  }

  throw intentError("invalid_provider_response");
}

function providerContentLength(response) {
  const rawValue = response.headers?.get?.("content-length");
  if (typeof rawValue !== "string" || !/^\d+$/.test(rawValue)) return null;
  const value = Number(rawValue);
  return Number.isSafeInteger(value) ? value : Number.POSITIVE_INFINITY;
}

function cancelReader(reader) {
  try {
    Promise.resolve(reader.cancel()).catch(() => {});
  } catch {
    // A provider body is intentionally discarded without surfacing its details.
  }
}

function cancelProviderBody(response) {
  try {
    Promise.resolve(response.body?.cancel?.()).catch(() => {});
  } catch {
    // A provider error body is intentionally discarded without reading it.
  }
}

function deterministicMockAllowed(env) {
  return (env.NODE_ENV === "development" || env.NODE_ENV === "test") &&
    env.INTENT_ALLOW_DETERMINISTIC_MOCK === "true";
}

function credential(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function validateRequest(input) {
  if (!input || typeof input !== "object") {
    throw intentError("invalid_request");
  }
  const prompt = cleanString(input.prompt);
  if (!prompt) {
    throw intentError("invalid_request");
  }
  if (prompt.length > 1000) {
    throw intentError("invalid_request");
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

export function sanitizeIntent(rawIntent, rawPrompt, options = {}) {
  if (!rawIntent || typeof rawIntent !== "object" || Array.isArray(rawIntent)) {
    throw intentError("invalid_provider_response");
  }

  for (const key of Object.keys(rawIntent)) {
    if (FORBIDDEN_OUTPUT_KEYS.has(key)) {
      throw intentError("invalid_provider_response");
    }
  }

  const repairedIntent = repairIntent(rawIntent, rawPrompt);
  const activityType = enumOrNull(repairedIntent.activityType, ALLOWED_ACTIVITY_TYPES);
  const routeType = enumOrNull(repairedIntent.routeType, ALLOWED_ROUTE_TYPES);
  const targetDistanceKm = saneNumberOrNull(repairedIntent.targetDistanceKm, 0.1, 300);
  const targetDurationMinutes = saneNumberOrNull(repairedIntent.targetDurationMinutes, 5, 10080);

  let confidence = saneNumberOrNull(repairedIntent.confidence, 0, 1);
  if (confidence === null) {
    confidence = 0.3;
  }
  if (routeType === "loop" && !cleanString(repairedIntent.startLocationQuery) && !cleanString(repairedIntent.regionQuery)) {
    confidence = Math.min(confidence, 0.35);
  }
  if (routeType === "pointToPoint" && (!cleanString(repairedIntent.startLocationQuery) || !cleanString(repairedIntent.endLocationQuery))) {
    confidence = Math.min(confidence, 0.35);
  }

  return {
    activityType,
    routeType,
    startLocationQuery: cleanStringOrNull(repairedIntent.startLocationQuery),
    endLocationQuery: cleanStringOrNull(repairedIntent.endLocationQuery),
    regionQuery: cleanStringOrNull(repairedIntent.regionQuery),
    targetDistanceKm,
    targetDurationMinutes,
    difficulty: enumOrNull(repairedIntent.difficulty, ALLOWED_DIFFICULTIES),
    desiredFeatures: uniqueAllowed(repairedIntent.desiredFeatures, ALLOWED_DESIRED_FEATURES),
    avoidFeatures: uniqueAllowed(repairedIntent.avoidFeatures, ALLOWED_AVOID_FEATURES),
    transportMode: enumOrNull(repairedIntent.transportMode, ALLOWED_TRANSPORT_MODES),
    rawPrompt,
    parserSource: options.parserSource === "localRuleBased" ? "localRuleBased" : "remoteAI",
    confidence
  };
}

export function repairIntent(rawIntent, rawPrompt) {
  const repaired = { ...rawIntent };
  const prompt = cleanString(rawPrompt);
  const normalized = prompt.toLowerCase();
  const routeType = enumOrNull(repaired.routeType, ALLOWED_ROUTE_TYPES);
  const loopCue = indicatesLoopPrompt(normalized);
  const promptActivityType = activityFromPrompt(normalized);
  const loopLocation = extractLoopLocation(prompt);
  const hasRegion = Boolean(cleanString(repaired.regionQuery) || loopLocation);
  const shouldInferRegionalLoop =
    !routeType &&
    !cleanString(repaired.endLocationQuery) &&
    hasRegion &&
    Boolean(promptActivityType) &&
    !indicatesPointToPointPrompt(normalized);

  if (!routeType && (loopCue || shouldInferRegionalLoop)) {
    repaired.routeType = "loop";
  }
  if (routeType === "pointToPoint" && !cleanString(repaired.endLocationQuery) && loopCue) {
    repaired.routeType = "loop";
  }

  const hasPointToPointLocations =
    repaired.routeType === "pointToPoint" &&
    cleanString(repaired.startLocationQuery) &&
    cleanString(repaired.endLocationQuery);
  const activityType =
    enumOrNull(repaired.activityType, ALLOWED_ACTIVITY_TYPES) ??
    promptActivityType ??
    (hasPointToPointLocations ? "hiking" : null);

  if (!repaired.activityType && activityType) {
    repaired.activityType = activityType;
  }
  if (!repaired.transportMode && repaired.activityType) {
    repaired.transportMode = repaired.activityType === "biking" ? "cycling" : "walking";
  }

  if (repaired.routeType === "loop") {
    repaired.endLocationQuery = null;
    if (!cleanString(repaired.startLocationQuery) && cleanString(repaired.regionQuery)) {
      repaired.startLocationQuery = repaired.regionQuery;
    }
    if (!cleanString(repaired.startLocationQuery) && loopLocation) {
      repaired.startLocationQuery = loopLocation;
    }
  }

  if (!saneNumberOrNull(repaired.targetDistanceKm, 0.1, 300)) {
    repaired.targetDistanceKm = firstNumberBefore(normalized, ["km", "kilometer"]);
  }
  if (!saneNumberOrNull(repaired.targetDurationMinutes, 5, 10080)) {
    repaired.targetDurationMinutes = durationMinutes(normalized);
  }
  if (!repaired.difficulty && /\b(entspannt|entspannte|entspannten|relaxed|leicht|easy)\b/.test(normalized)) {
    repaired.difficulty = "easy";
  }

  repaired.desiredFeatures = [
    ...(Array.isArray(repaired.desiredFeatures) ? repaired.desiredFeatures : []),
    ...desiredFeaturesFromPrompt(normalized)
  ];
  repaired.avoidFeatures = [
    ...(Array.isArray(repaired.avoidFeatures) ? repaired.avoidFeatures : []),
    ...avoidFeaturesFromPrompt(normalized)
  ];

  return repaired;
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
  const activityType = activityFromPrompt(normalized) ?? "hiking";
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

  const desiredFeatures = desiredFeaturesFromPrompt(normalized);
  const avoidFeatures = avoidFeaturesFromPrompt(normalized);

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
    parserSource: "localRuleBased",
    confidence: routeType && (startLocationQuery || regionQuery) ? 0.78 : 0.25
  };
}

function activityFromPrompt(normalized) {
  if (/\b(bike|biking|cycling|radroute|radtour|fahrrad)\b/.test(normalized)) {
    return "biking";
  }
  if (/\b(trailrun|trail run|running|joggen|lauf)\b/.test(normalized)) {
    return "trailRunning";
  }
  if (/\b(wanderung|wandern|hike|hiking|walk|route|tour|runde|rundwanderung|rundtour)\b/.test(normalized)) {
    return "hiking";
  }
  return null;
}

function indicatesLoopPrompt(normalized) {
  if (/\b(rundwanderung|rundtour|runde|rundweg|loop|round trip)\b/.test(normalized)) {
    return true;
  }
  return /\b(?:bei|um|ab|around|near)\s+\S+/.test(normalized) &&
    /\b(wanderung|wandern|hike|hiking|trailrun|trail run|bike|biking|radtour|radroute|route|tour)\b/.test(normalized);
}

function indicatesPointToPointPrompt(normalized) {
  return /\b(?:from|von)\s+.+\b(?:to|nach|zum|zur)\b/.test(normalized) ||
    /\b(?:nach|to|zum|zur)\s+[\p{L}\p{N}]/u.test(normalized);
}

function extractLoopLocation(prompt) {
  const explicit = prompt.match(/\b(?:um|bei|ab|around|near|from)\s+([^,.;!?\n]+)/i);
  if (explicit) {
    return cleanLocationStringOrNull(explicit[1]);
  }

  const region = prompt.match(/\b(?:im|in der|in den)\s+([^,.;!?\n]+)/i);
  return cleanLocationStringOrNull(region?.[1]);
}

function desiredFeaturesFromPrompt(normalized) {
  const desiredFeatures = [];
  if (/\b(aussicht|blick|view|views|panorama)\b/.test(normalized)) desiredFeatures.push("viewpoint");
  if (/\b(wald|forest)\b/.test(normalized)) desiredFeatures.push("forest");
  if (/\b(wasser|water|wasserfall|waterfall)\b/.test(normalized)) desiredFeatures.push("water");
  if (/\b(ruhig|quiet)\b/.test(normalized)) desiredFeatures.push("quiet");
  if (/\b(sonnenuntergang|sunset)\b/.test(normalized)) desiredFeatures.push("sunset");
  return desiredFeatures;
}

function avoidFeaturesFromPrompt(normalized) {
  const avoidFeatures = [];
  if (/\b(steil|steep)\b/.test(normalized)) avoidFeatures.push("steepClimbs");
  if (/\b(wenig gleicher strecke|gleiche strecke|zurück|zurueck|backtracking|repeated)\b/.test(normalized)) {
    avoidFeatures.push("repeatedPath");
  }
  return avoidFeatures;
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
