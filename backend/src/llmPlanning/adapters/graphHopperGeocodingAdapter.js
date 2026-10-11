import { LLM_FIRST_PLANNING_POLICY_V1 } from "../llmFirstPlanningPolicy.js";
import { llmPlanningAdapterError } from "./adapterErrors.js";
import { fetchBoundedJson } from "./providerHttp.js";

const POLICY = LLM_FIRST_PLANNING_POLICY_V1;
const BROAD_PLACE_VALUES = new Set([
  "continent", "country", "state", "province", "region", "county"
]);
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;
const MAXIMUM_BROAD_EXTENT_DIAGONAL_METERS = 120_000;

export function createGraphHopperGeocodingAdapter(options) {
  const configuration = validateConfiguration(options?.configuration);
  const fetchImpl = options?.fetchImpl ?? globalThis.fetch;
  const setTimeoutImpl = options?.setTimeoutImpl ?? setTimeout;
  const clearTimeoutImpl = options?.clearTimeoutImpl ?? clearTimeout;
  if (typeof fetchImpl !== "function") throw llmPlanningAdapterError("configuration_missing");

  return async function geocode(name, context = {}) {
    const upstream = buildGraphHopperGeocodingRequest(name, context, configuration);
    const payload = await fetchBoundedJson({
      fetchImpl,
      url: upstream.url,
      init: upstream.init,
      signal: context.signal,
      deadlineMs: configuration.deadlineMs,
      maximumResponseBytes: configuration.maximumResponseBytes,
      maximumErrorResponseBytes: configuration.maximumErrorResponseBytes,
      maximumAttempts: configuration.maximumAttempts,
      setTimeoutImpl,
      clearTimeoutImpl
    });
    return parseGraphHopperGeocodingResponse(payload, name);
  };
}

export function buildGraphHopperGeocodingRequest(name, context, configuration) {
  const query = safeText(name, 1, 120);
  const hint = context.userLocationHint === null || context.userLocationHint === undefined
    ? null
    : safeText(context.userLocationHint, 1, 120);
  const locale = context.locale ?? "en";
  if (!new Set(["de", "en"]).has(locale)) invalid();
  const url = new URL(`${configuration.baseUrl.toString().replace(/\/+$/, "")}/geocode`);
  url.searchParams.set("key", configuration.apiKey);
  url.searchParams.set("q", hint ? `${query}, ${hint}` : query);
  url.searchParams.set("locale", locale);
  url.searchParams.set("limit", String(POLICY.limits.maximumGeocoderResults));
  url.searchParams.set("reverse", "false");
  return {
    url,
    init: {
      method: "GET",
      headers: { Accept: "application/json" }
    }
  };
}

export function parseGraphHopperGeocodingResponse(input, query) {
  safeText(query, 1, 120);
  if (!input || typeof input !== "object" || Array.isArray(input) ||
      !Array.isArray(input.hits) || input.hits.length > POLICY.limits.maximumGeocoderResults) {
    invalid();
  }
  if (input.hits.length === 0) return [];

  const candidates = input.hits.map((hit, providerRank) =>
    candidateFromHit(hit, query, providerRank)
  );
  const coordinates = candidates.map((candidate) => [
    candidate.coordinate.latitude.toFixed(6),
    candidate.coordinate.longitude.toFixed(6)
  ].join("|"));
  if (new Set(coordinates).size !== coordinates.length) invalid();

  const eligible = candidates
    .filter((candidate) => candidate.confidence >= POLICY.limits.minimumGeocoderConfidence)
    .sort((left, right) =>
      right.confidence - left.confidence || left.providerRank - right.providerRank ||
      left.displayName.localeCompare(right.displayName, "en")
    );
  if (eligible.length === 0) {
    throw llmPlanningAdapterError("geocoder_low_confidence");
  }
  const best = eligible[0];
  const ambiguous = eligible.slice(1).some((alternative) =>
    best.confidence - alternative.confidence < POLICY.limits.ambiguityConfidenceGap &&
    haversine(best.coordinate, alternative.coordinate) >
      POLICY.limits.ambiguitySeparationMeters
  );
  if (ambiguous) {
    throw llmPlanningAdapterError("geocoder_ambiguous");
  }
  return eligible;
}

function candidateFromHit(hit, query, providerRank) {
  if (!hit || typeof hit !== "object" || Array.isArray(hit) ||
      !hit.point || typeof hit.point !== "object" || Array.isArray(hit.point)) invalid();
  const latitude = coordinate(hit.point.lat, -90, 90);
  const longitude = coordinate(hit.point.lng, -180, 180);
  const name = safeText(hit.name, 1, 120);
  const displayName = displayNameFor(hit, name);
  const broad = isBroadRegion(hit);
  const confidence = broad ? 0 : matchStrength(query, name, displayName, providerRank);
  return {
    displayName,
    coordinate: { latitude, longitude },
    confidence,
    provider: "graphhopper",
    providerRank
  };
}

function displayNameFor(hit, name) {
  const fields = [name, hit.city, hit.state, hit.country]
    .filter((value) => value !== undefined && value !== null)
    .map((value) => safeText(value, 1, 120));
  const unique = [...new Map(fields.map((value) => [normalize(value), value])).values()];
  return safeText(unique.join(", "), 1, 180);
}

function isBroadRegion(hit) {
  const osmValue = typeof hit.osm_value === "string" ? normalize(hit.osm_value) : "";
  if (BROAD_PLACE_VALUES.has(osmValue)) return true;
  if (hit.extent === undefined) return false;
  if (!Array.isArray(hit.extent) || hit.extent.length !== 4 ||
      !hit.extent.every(Number.isFinite)) invalid();
  const longitudes = [hit.extent[0], hit.extent[2]];
  const latitudes = [hit.extent[1], hit.extent[3]];
  if (longitudes.some((value) => value < -180 || value > 180) ||
      latitudes.some((value) => value < -90 || value > 90)) invalid();
  return haversine(
    { latitude: latitudes[0], longitude: longitudes[0] },
    { latitude: latitudes[1], longitude: longitudes[1] }
  ) > MAXIMUM_BROAD_EXTENT_DIAGONAL_METERS;
}

function matchStrength(query, name, displayName, providerRank) {
  const normalizedQuery = normalizeWords(query);
  const normalizedName = normalizeWords(name);
  const normalizedDisplay = normalizeWords(displayName);
  let base;
  if (normalizedQuery === normalizedName) base = 0.96;
  else if (normalizedDisplay === normalizedQuery || normalizedDisplay.startsWith(`${normalizedQuery} `)) {
    base = 0.92;
  } else {
    const queryTokens = new Set(normalizedQuery.split(" ").filter(Boolean));
    const candidateTokens = new Set(normalizedDisplay.split(" ").filter(Boolean));
    const matched = [...queryTokens].filter((token) => candidateTokens.has(token)).length;
    const coverage = queryTokens.size === 0 ? 0 : matched / queryTokens.size;
    base = coverage === 1 ? 0.88 : coverage >= 0.75 ? 0.76 : 0.55;
  }
  return round(Math.max(0, base - Math.min(providerRank, 4) * 0.01), 3);
}

function normalizeWords(value) {
  return normalize(value)
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function safeText(value, minimum, maximum) {
  if (typeof value !== "string" || value.length < minimum || value.length > maximum ||
      value !== value.trim() || CONTROL_CHARACTER_PATTERN.test(value) || !wellFormed(value)) invalid();
  return value;
}

function coordinate(value, minimum, maximum) {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new TypeError("invalid geocoder coordinate");
  }
  return value;
}

function validateConfiguration(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      !(value.baseUrl instanceof URL) || value.baseUrl.protocol !== "https:" ||
      value.baseUrl.username || value.baseUrl.password || value.baseUrl.search ||
      value.baseUrl.hash || value.baseUrl.pathname === "/" || !opaque(value.apiKey, 8_192) ||
      !boundedInteger(value.deadlineMs, 50, 15_000) ||
      !boundedInteger(value.maximumResponseBytes, 8_192, 262_144) ||
      !boundedInteger(value.maximumErrorResponseBytes, 256, 32_768) ||
      value.maximumErrorResponseBytes >= value.maximumResponseBytes ||
      value.maximumAttempts !== 1) {
    throw llmPlanningAdapterError("configuration_missing");
  }
  return value;
}

function opaque(value, maximum) {
  return typeof value === "string" && value.length >= 1 && value.length <= maximum &&
    value === value.trim() && !CONTROL_CHARACTER_PATTERN.test(value);
}

function boundedInteger(value, minimum, maximum) {
  return Number.isInteger(value) && value >= minimum && value <= maximum;
}

function wellFormed(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function normalize(value) {
  return value.normalize("NFKC").trim().toLocaleLowerCase("en-US");
}

function haversine(start, finish) {
  const radians = Math.PI / 180;
  const latitudeDelta = (finish.latitude - start.latitude) * radians;
  const longitudeDelta = (finish.longitude - start.longitude) * radians;
  const a = Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(start.latitude * radians) * Math.cos(finish.latitude * radians) *
    Math.sin(longitudeDelta / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
}

function round(value, places) {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}

function invalid() {
  throw llmPlanningAdapterError("invalid_response");
}
