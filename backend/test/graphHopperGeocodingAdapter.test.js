import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createGraphHopperGeocodingAdapter,
  parseGraphHopperGeocodingResponse
} from "../src/llmPlanning/adapters/graphHopperGeocodingAdapter.js";
import {
  graphHopperResponseFixture
} from "./fixtures/llmPlanningAdapterFixturesV1.js";

describe("GraphHopper geocoding adapter", () => {
  it("uses the existing GraphHopper account without a provider override", async () => {
    let calls = 0;
    const adapter = createGraphHopperGeocodingAdapter({
      configuration: configuration(),
      fetchImpl: async (url, init) => {
        calls += 1;
        assert.equal(url.origin, "https://graphhopper.com");
        assert.equal(url.pathname, "/api/1/geocode");
        assert.equal(url.searchParams.get("q"), "Ilsenburg, Harz, Germany");
        assert.equal(url.searchParams.get("locale"), "en");
        assert.equal(url.searchParams.get("limit"), "5");
        assert.equal(url.searchParams.get("reverse"), "false");
        assert.equal(url.searchParams.get("provider"), null);
        assert.equal(url.searchParams.get("key"), "test-only-graphhopper-key");
        assert.equal(init.redirect, "manual");
        return jsonResponse(graphHopperResponseFixture());
      }
    });
    const candidates = await adapter("Ilsenburg", {
      locale: "en",
      userLocationHint: "Harz, Germany"
    });
    assert.equal(calls, 1);
    assert.deepEqual(candidates, [{
      displayName: "Ilsenburg, Saxony-Anhalt, Germany",
      coordinate: { latitude: 51.866, longitude: 10.664 },
      confidence: 0.96,
      provider: "graphhopper",
      providerRank: 0
    }]);
  });

  it("rejects ambiguity, broad/weak matches, duplicate hits, and malformed coordinates", () => {
    const ambiguous = {
      hits: [
        hit("Springfield", 39.8, -89.6),
        hit("Springfield", 44.0, -123.0)
      ]
    };
    assert.throws(
      () => parseGraphHopperGeocodingResponse(ambiguous, "Springfield"),
      errorCode("geocoder_ambiguous")
    );
    const hiddenThirdAlternative = {
      hits: [
        hit("Springfield", 39.8, -89.6),
        hit("Springfield", 39.801, -89.601),
        hit("Springfield", 44.0, -123.0)
      ]
    };
    assert.throws(
      () => parseGraphHopperGeocodingResponse(hiddenThirdAlternative, "Springfield"),
      errorCode("geocoder_ambiguous")
    );

    const broad = {
      hits: [{
        ...hit("Germany", 51.0, 10.0),
        osm_key: "place",
        osm_value: "country"
      }]
    };
    assert.throws(
      () => parseGraphHopperGeocodingResponse(broad, "Germany"),
      errorCode("geocoder_low_confidence")
    );
    assert.throws(
      () => parseGraphHopperGeocodingResponse({ hits: [hit("Elsewhere", 51, 10)] }, "Ilsenburg"),
      errorCode("geocoder_low_confidence")
    );

    const duplicate = hit("Ilsenburg", 51.866, 10.664);
    assert.throws(
      () => parseGraphHopperGeocodingResponse({ hits: [duplicate, structuredClone(duplicate)] }, "Ilsenburg"),
      errorCode("invalid_response")
    );
    assert.throws(
      () => parseGraphHopperGeocodingResponse({
        hits: [duplicate, hit("Ilsenburg", 52.1, 10.7)]
      }, "Ilsenburg"),
      errorCode("geocoder_ambiguous")
    );
    assert.throws(
      () => parseGraphHopperGeocodingResponse({
        hits: [duplicate, hit("Ilsenburg Alt", 51.866, 10.664)]
      }, "Ilsenburg"),
      errorCode("invalid_response")
    );
    assert.throws(
      () => parseGraphHopperGeocodingResponse({ hits: [hit("Ilsenburg", 95, 10)] }, "Ilsenburg"),
      TypeError
    );
    assert.throws(
      () => parseGraphHopperGeocodingResponse({ hits: [hit("Ilsenburg\ud800", 51, 10)] }, "Ilsenburg"),
      errorCode("invalid_response")
    );
  });

  it("returns only bounded typed candidates and keeps empty results explicit", () => {
    assert.deepEqual(parseGraphHopperGeocodingResponse({ hits: [] }, "Missing Place"), []);
    const response = {
      hits: [
        hit("Ilsenburg-Ost", 51.867, 10.675),
        hit("Ilsenburg", 51.866, 10.664)
      ]
    };
    const candidates = parseGraphHopperGeocodingResponse(response, "Ilsenburg");
    assert.ok(candidates.length <= 5);
    assert.equal(candidates[0].displayName.startsWith("Ilsenburg,"), true);
    assert.deepEqual(Object.keys(candidates[0]).sort(), [
      "confidence", "coordinate", "displayName", "provider", "providerRank"
    ]);
    assert.equal(candidates.every((candidate) => candidate.provider === "graphhopper"), true);
  });

  it("never retries and rejects rate limits, HTTP failures, redirects, content types, and size", async () => {
    let calls = 0;
    const rateLimited = adapterWith(async () => {
      calls += 1;
      return new Response("limited", { status: 429 });
    });
    await assert.rejects(rateLimited("Ilsenburg"), errorCode("rate_limited"));
    assert.equal(calls, 1);

    for (const fixture of [
      { response: () => new Response("provider-private-detail", { status: 400 }), code: "provider_rejected" },
      { response: () => new Response("provider-private-detail", { status: 403 }), code: "configuration_missing" },
      { response: () => new Response(null, { status: 302, headers: { Location: "https://example.invalid" } }), code: "redirect_rejected" },
      { response: () => new Response("{}", { status: 200, headers: { "Content-Type": "text/html" } }), code: "invalid_content_type" },
      {
        response: () => new Response("{}", {
          status: 200,
          headers: { "Content-Type": "application/json", "Content-Length": "999999" }
        }),
        code: "response_too_large"
      },
      { response: () => jsonResponse("{truncated", false), code: "invalid_response" }
    ]) {
      let attempts = 0;
      const adapter = adapterWith(async () => { attempts += 1; return fixture.response(); });
      await assert.rejects(adapter("Ilsenburg"), (error) => {
        assert.equal(error.code, fixture.code);
        assert.equal(error.message.includes("provider-private-detail"), false);
        return true;
      });
      assert.equal(attempts, 1);
    }

    let unavailableCalls = 0;
    const unavailable = adapterWith(async () => {
      unavailableCalls += 1;
      return new Response("private", { status: 503 });
    });
    await assert.rejects(unavailable("Ilsenburg"), errorCode("provider_unavailable"));
    assert.equal(unavailableCalls, 1);
  });

  it("honors cancellation and deadline without leaking query data", async () => {
    const controller = new AbortController();
    const cancelled = adapterWith(() => new Promise(() => {}));
    const pending = cancelled("Ilsenburg", { signal: controller.signal });
    controller.abort();
    await assert.rejects(pending, (error) =>
      error.code === "cancelled" && !error.message.includes("Ilsenburg")
    );

    const timedOut = adapterWith(() => new Promise(() => {}), { deadlineMs: 50 });
    await assert.rejects(timedOut("Ilsenburg"), (error) =>
      error.code === "timed_out" && !error.message.includes("Ilsenburg")
    );
  });

  it("fails malformed configuration before fetch", async () => {
    let fetchCalls = 0;
    assert.throws(() => createGraphHopperGeocodingAdapter({
      configuration: { ...configuration(), apiKey: "" },
      fetchImpl: async () => { fetchCalls += 1; }
    }), errorCode("configuration_missing"));
    assert.throws(() => createGraphHopperGeocodingAdapter({
      configuration: { ...configuration(), maximumAttempts: 2 },
      fetchImpl: async () => { fetchCalls += 1; }
    }), errorCode("configuration_missing"));
    assert.equal(fetchCalls, 0);
  });
});

function adapterWith(fetchImpl, overrides = {}) {
  return createGraphHopperGeocodingAdapter({
    configuration: configuration(overrides),
    fetchImpl
  });
}

function configuration(overrides = {}) {
  return {
    baseUrl: new URL("https://graphhopper.com/api/1"),
    apiKey: "test-only-graphhopper-key",
    deadlineMs: 1_000,
    maximumResponseBytes: 65_536,
    maximumErrorResponseBytes: 4_096,
    maximumAttempts: 1,
    ...overrides
  };
}

function hit(name, lat, lng) {
  return {
    point: { lat, lng },
    name,
    city: name,
    country: "Germany",
    osm_key: "place",
    osm_value: "town"
  };
}

function jsonResponse(value, encode = true) {
  return new Response(encode ? JSON.stringify(value) : value, {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}

function errorCode(code) {
  return (error) => error?.code === code && !error.message.includes("provider-private-detail");
}
