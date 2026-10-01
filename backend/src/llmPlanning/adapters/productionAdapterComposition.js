import { createGraphHopperGeocodingAdapter } from "./graphHopperGeocodingAdapter.js";
import { createSelectedIntentPlanningAdapter } from "./selectedIntentPlanningAdapter.js";
import { llmPlanningAdapterError } from "./adapterErrors.js";

export function createProductionLLMPlanningAdapters(options = {}) {
  const env = options.env ?? process.env;
  const apiKey = opaque(env.GRAPHHOPPER_API_KEY);
  const baseUrl = graphHopperBaseUrl(env.GRAPHHOPPER_BASE_URL);
  const maximumResponseBytes = integer(
    env.GEOCODER_PROVIDER_MAX_RESPONSE_BYTES,
    65_536,
    8_192,
    262_144
  );
  const maximumErrorResponseBytes = integer(
    env.GEOCODER_PROVIDER_MAX_ERROR_RESPONSE_BYTES,
    8_192,
    256,
    32_768
  );
  if (maximumErrorResponseBytes >= maximumResponseBytes) {
    throw llmPlanningAdapterError("configuration_missing");
  }
  const shared = {
    fetchImpl: options.fetchImpl,
    setTimeoutImpl: options.setTimeoutImpl,
    clearTimeoutImpl: options.clearTimeoutImpl
  };
  return Object.freeze({
    llmPlanGenerator: createSelectedIntentPlanningAdapter({ ...shared, env }),
    locationGeocoder: createGraphHopperGeocodingAdapter({
      ...shared,
      configuration: {
        baseUrl,
        apiKey,
        deadlineMs: integer(env.LLM_FIRST_PLANNING_GEOCODE_TIMEOUT_MS, 3_000, 100, 15_000),
        maximumResponseBytes,
        maximumErrorResponseBytes,
        maximumAttempts: 1
      }
    })
  });
}

function graphHopperBaseUrl(value) {
  try {
    const url = new URL(value || "https://graphhopper.com/api/1");
    if (url.toString() !== "https://graphhopper.com/api/1" &&
        url.toString() !== "https://graphhopper.com/api/1/") {
      throw new TypeError("unexpected GraphHopper base URL");
    }
    return url;
  } catch (error) {
    throw llmPlanningAdapterError("configuration_missing", { cause: error });
  }
}

function opaque(value) {
  if (typeof value !== "string" || value.length < 1 || value.length > 8_192 ||
      value !== value.trim() || /[\u0000-\u001f\u007f]/.test(value)) {
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
