import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { describe, it } from "node:test";
import { createIntentSessionEndpoint } from "../src/appAttest/intentSessionEndpoint.js";
import { IntentParseError, parseIntentEndpoint } from "../src/parseIntent.js";
import { createIntentRequestHandler, handleIntentHttpRequest } from "../src/server.js";

const REQUEST = Object.freeze({
  prompt: "Plan a 12 km loop around Ilsenburg",
  locale: "en"
});

const PROVIDERS = Object.freeze([
  {
    name: "OpenRouter",
    env: {
      AI_PROVIDER: "openrouter",
      OPENROUTER_API_KEY: "openrouter-test-credential"
    },
    responsePayload(intent = validIntent()) {
      return { choices: [{ message: { content: JSON.stringify(intent) } }] };
    }
  },
  {
    name: "Google Gemini",
    env: {
      AI_PROVIDER: "google",
      GOOGLE_API_KEY: "google-test-credential"
    },
    responsePayload(intent = validIntent()) {
      return { output_text: JSON.stringify(intent) };
    }
  }
]);

describe("intent provider reliability", () => {
  for (const provider of PROVIDERS) {
    describe(provider.name, () => {
      it("keeps normal structured responses working", async () => {
        const timer = manualTimer();
        const caller = new AbortController();
        let upstreamSignal;
        const intent = await parseFor(provider, {
          signal: caller.signal,
          fetchImpl: async (_url, init) => {
            upstreamSignal = init.signal;
            return jsonResponse(provider.responsePayload());
          },
          ...timer.options
        });

        assert.equal(intent.parserSource, "remoteAI");
        assert.equal(intent.routeType, "loop");
        assert.ok(upstreamSignal instanceof AbortSignal);
        assert.equal(timer.delay, 15_000);
        assert.equal(timer.clearCount, 1);
        caller.abort();
        assert.equal(upstreamSignal.aborted, false);
      });

      it("does not call the provider for an already-cancelled request", async () => {
        const caller = new AbortController();
        caller.abort();
        let fetchCalled = false;
        await rejectsWithIntentCode(
          parseFor(provider, {
            signal: caller.signal,
            fetchImpl: async () => {
              fetchCalled = true;
              return jsonResponse(provider.responsePayload());
            }
          }),
          "request_cancelled",
          499
        );
        assert.equal(fetchCalled, false);
      });

      it("aborts the upstream fetch when its bounded timeout expires", async () => {
        const timer = manualTimer();
        let upstreamSignal;
        const pending = parseFor(provider, {
          fetchImpl: async (_url, init) => {
            upstreamSignal = init.signal;
            return await rejectsWhenAborted(init.signal);
          },
          ...timer.options
        });

        timer.fire();
        await rejectsWithIntentCode(pending, "intent_timed_out", 504);
        assert.equal(upstreamSignal.aborted, true);
        assert.equal(timer.clearCount, 1);
      });

      it("aborts and cancels a stalled provider response body on timeout", async () => {
        const timer = manualTimer();
        const stalled = stalledStreamResponse();
        const pending = parseFor(provider, {
          fetchImpl: async () => stalled.response,
          ...timer.options
        });

        await stalled.readStarted;
        timer.fire();
        await rejectsWithIntentCode(pending, "intent_timed_out", 504);
        assert.equal(stalled.cancelCount(), 1);
        assert.equal(timer.clearCount, 1);
      });

      it("propagates caller cancellation into the upstream fetch", async () => {
        const timer = manualTimer();
        const caller = new AbortController();
        let upstreamSignal;
        const pending = parseFor(provider, {
          signal: caller.signal,
          fetchImpl: async (_url, init) => {
            upstreamSignal = init.signal;
            return await rejectsWhenAborted(init.signal);
          },
          ...timer.options
        });

        caller.abort();
        await rejectsWithIntentCode(pending, "request_cancelled", 499);
        assert.equal(upstreamSignal.aborted, true);
        assert.equal(timer.clearCount, 1);
      });

      it("cancels a stalled provider response body on caller cancellation", async () => {
        const timer = manualTimer();
        const caller = new AbortController();
        const stalled = stalledStreamResponse();
        const pending = parseFor(provider, {
          signal: caller.signal,
          fetchImpl: async () => stalled.response,
          ...timer.options
        });

        await stalled.readStarted;
        caller.abort();
        await rejectsWithIntentCode(pending, "request_cancelled", 499);
        assert.equal(stalled.cancelCount(), 1);
        assert.equal(timer.clearCount, 1);
      });

      it("settles once when timeout and caller cancellation race", async () => {
        for (const first of ["timeout", "caller"]) {
          const timer = manualTimer();
          const caller = new AbortController();
          let abortEvents = 0;
          let settlements = 0;
          const pending = parseFor(provider, {
            signal: caller.signal,
            fetchImpl: async (_url, init) => {
              init.signal.addEventListener("abort", () => { abortEvents += 1; }, { once: true });
              return await rejectsWhenAborted(init.signal);
            },
            ...timer.options
          });
          pending.then(
            () => { settlements += 1; },
            () => { settlements += 1; }
          );

          if (first === "timeout") {
            timer.fire();
            caller.abort();
          } else {
            caller.abort();
            timer.fire();
          }

          await rejectsWithIntentCode(
            pending,
            first === "timeout" ? "intent_timed_out" : "request_cancelled",
            first === "timeout" ? 504 : 499
          );
          await Promise.resolve();
          assert.equal(abortEvents, 1);
          assert.equal(settlements, 1);
          assert.equal(timer.clearCount, 1);
        }
      });

      it("rejects a late provider response after caller cancellation", async () => {
        const timer = manualTimer();
        const caller = new AbortController();
        const upstream = deferred();
        let upstreamSignal;
        const pending = parseFor(provider, {
          signal: caller.signal,
          fetchImpl: async (_url, init) => {
            upstreamSignal = init.signal;
            return await upstream.promise;
          },
          ...timer.options
        });

        caller.abort();
        upstream.resolve(jsonResponse(provider.responsePayload()));
        await rejectsWithIntentCode(pending, "request_cancelled", 499);
        assert.equal(upstreamSignal.aborted, true);
      });

      it("rejects an oversized advertised provider response", async () => {
        const streamed = oversizedStreamResponse({ "Content-Length": "2000" });
        const pending = parseFor(provider, {
          env: { INTENT_PROVIDER_MAX_RESPONSE_BYTES: "1024" },
          fetchImpl: async () => streamed.response
        });

        await rejectsWithIntentCode(pending, "invalid_provider_response", 502);
        assert.equal(streamed.cancelCount(), 1);
      });

      it("does not let a missing Content-Length bypass the response ceiling", async () => {
        const streamed = oversizedStreamResponse();
        const pending = parseFor(provider, {
          env: { INTENT_PROVIDER_MAX_RESPONSE_BYTES: "1024" },
          fetchImpl: async () => streamed.response
        });

        await rejectsWithIntentCode(pending, "invalid_provider_response", 502);
        assert.equal(streamed.cancelCount(), 1);
      });

      it("does not let a misleading Content-Length bypass the response ceiling", async () => {
        const streamed = oversizedStreamResponse({ "Content-Length": "10" });
        const pending = parseFor(provider, {
          env: { INTENT_PROVIDER_MAX_RESPONSE_BYTES: "1024" },
          fetchImpl: async () => streamed.response
        });

        await rejectsWithIntentCode(pending, "invalid_provider_response", 502);
        assert.equal(streamed.cancelCount(), 1);
      });

      it("classifies malformed provider JSON without exposing parser details", async () => {
        const pending = parseFor(provider, {
          fetchImpl: async () => new Response("{malformed-provider-json")
        });

        const error = await rejectsWithIntentCode(pending, "invalid_provider_response", 502);
        assert.equal(error.message.includes("malformed-provider-json"), false);
      });

      it("does not expose provider HTTP response text", async () => {
        const rawProviderBody = "private provider diagnostic with prompt and credential";
        const pending = parseFor(provider, {
          fetchImpl: async () => new Response(rawProviderBody, { status: 500 })
        });

        const error = await rejectsWithIntentCode(pending, "intent_unavailable", 503);
        assert.equal(error.message.includes(rawProviderBody), false);
        assert.equal(error.message.includes("provider diagnostic"), false);
      });

      it("maps provider HTTP statuses to deterministic safe classifications", async () => {
        for (const [status, code, resultStatus] of [
          [400, "invalid_provider_response", 502],
          [401, "configuration_unavailable", 503],
          [403, "configuration_unavailable", 503],
          [429, "rate_limited", 503],
          [503, "intent_unavailable", 503]
        ]) {
          await rejectsWithIntentCode(
            parseFor(provider, {
              fetchImpl: async () => new Response("private upstream detail", { status })
            }),
            code,
            resultStatus
          );
        }
      });
    });
  }

  it("classifies malformed Google response shapes as invalid provider responses", async () => {
    const google = PROVIDERS[1];
    for (const payload of [
      { candidates: [{ content: { parts: { text: "not-an-array" } } }] },
      { steps: { type: "model_output", content: [] } }
    ]) {
      const timer = manualTimer();
      await rejectsWithIntentCode(
        parseFor(google, {
          fetchImpl: async () => jsonResponse(payload),
          ...timer.options
        }),
        "invalid_provider_response",
        502
      );
      assert.equal(timer.clearCount, 1);
    }
  });
});

describe("intent configuration and source policy", () => {
  it("fails closed in production when no provider is configured", async () => {
    await rejectsWithIntentCode(
      parseIntentEndpoint(REQUEST, { env: { NODE_ENV: "production" } }),
      "configuration_unavailable",
      503
    );
  });

  it("does not enable deterministic intent merely because credentials are missing", async () => {
    await rejectsWithIntentCode(
      parseIntentEndpoint(REQUEST, { env: { NODE_ENV: "test" } }),
      "configuration_unavailable",
      503
    );
  });

  it("allows deterministic intent only with an explicit non-production opt-in", async () => {
    const intent = await parseIntentEndpoint(REQUEST, {
      env: {
        NODE_ENV: "development",
        INTENT_ALLOW_DETERMINISTIC_MOCK: "true"
      }
    });

    assert.equal(intent.routeType, "loop");
    assert.equal(intent.parserSource, "localRuleBased");
  });

  it("keeps the truthful local source after deterministic repair and sanitization", async () => {
    const intent = await parseIntentEndpoint(
      { prompt: "3 hour round trip near Ilsenburg", locale: "en" },
      {
        env: {
          NODE_ENV: "test",
          INTENT_ALLOW_DETERMINISTIC_MOCK: "true"
        }
      }
    );

    assert.equal(intent.routeType, "loop");
    assert.equal(intent.targetDurationMinutes, 180);
    assert.equal(intent.parserSource, "localRuleBased");
  });

  it("cannot enable deterministic intent in production even with the flag", async () => {
    await rejectsWithIntentCode(
      parseIntentEndpoint(REQUEST, {
        env: {
          NODE_ENV: "production",
          INTENT_ALLOW_DETERMINISTIC_MOCK: "true"
        }
      }),
      "configuration_unavailable",
      503
    );
  });

  it("requires the exact flag and an explicit non-production environment", async () => {
    for (const env of [
      { INTENT_ALLOW_DETERMINISTIC_MOCK: "true" },
      { NODE_ENV: "development", INTENT_ALLOW_DETERMINISTIC_MOCK: "TRUE" },
      { NODE_ENV: "development", INTENT_ALLOW_INSECURE_LOCAL_PARSING: "true" }
    ]) {
      await rejectsWithIntentCode(
        parseIntentEndpoint(REQUEST, { env }),
        "configuration_unavailable",
        503
      );
    }
  });

  it("fails safely for invalid timeout and response-limit configuration", async () => {
    for (const invalidEnvironment of [
      { INTENT_PROVIDER_TIMEOUT_MS: "0" },
      { INTENT_PROVIDER_TIMEOUT_MS: "unlimited" },
      { INTENT_PROVIDER_MAX_RESPONSE_BYTES: "999999999" },
      {
        INTENT_PROVIDER_TIMEOUT_MS: "10000",
        INTENT_GLOBAL_LEASE_TTL_SECONDS: "10"
      }
    ]) {
      await rejectsWithIntentCode(
        parseFor(PROVIDERS[0], {
          env: invalidEnvironment,
          fetchImpl: async () => jsonResponse(PROVIDERS[0].responsePayload())
        }),
        "configuration_unavailable",
        503
      );
    }
  });
});

describe("safe intent endpoint envelopes and lease release", () => {
  it("uses deterministic safe HTTP results for classified and unknown failures", async () => {
    const cases = [
      ["invalid_request", 400],
      ["intent_unavailable", 503],
      ["intent_timed_out", 504],
      ["request_cancelled", 499],
      ["configuration_unavailable", 503],
      ["invalid_provider_response", 502],
      ["rate_limited", 503]
    ];

    for (const [code, statusCode] of cases) {
      const endpoint = createEndpointWithLease({
        parseIntent: async () => { throw new IntentParseError(code); }
      });
      const result = await endpoint.handler(REQUEST, { headers: {} });
      assert.equal(result.statusCode, statusCode);
      assert.equal(result.payload.error.code, code);
      assert.equal(typeof result.payload.error.message, "string");
      assert.equal(endpoint.releaseCount(), 1);
    }

    const secretMessage = "unknown failure includes a private prompt and credential";
    const endpoint = createEndpointWithLease({
      parseIntent: async () => { throw new Error(secretMessage); }
    });
    const result = await endpoint.handler(REQUEST, { headers: {} });
    assert.equal(result.statusCode, 503);
    assert.equal(result.payload.error.code, "intent_unavailable");
    assert.equal(JSON.stringify(result).includes(secretMessage), false);
    assert.equal(endpoint.releaseCount(), 1);
  });

  it("releases the authorization lease after success", async () => {
    const endpoint = createEndpointWithLease({ parseIntent: async () => ({ ok: true }) });
    const result = await endpoint.handler(REQUEST, { headers: {} });
    assert.deepEqual(result, { statusCode: 200, payload: { ok: true } });
    assert.equal(endpoint.releaseCount(), 1);
  });

  it("releases the lease after real parser success and failure branches", async () => {
    const provider = PROVIDERS[0];
    const cases = [
      {
        name: "success",
        fetchImpl: async () => jsonResponse(provider.responsePayload()),
        statusCode: 200
      },
      {
        name: "malformed provider JSON",
        fetchImpl: async () => new Response("{malformed"),
        statusCode: 502
      },
      {
        name: "oversized provider response",
        env: { INTENT_PROVIDER_MAX_RESPONSE_BYTES: "1024" },
        fetchImpl: async () => oversizedStreamResponse().response,
        statusCode: 502
      },
      {
        name: "provider failure",
        fetchImpl: async () => new Response("private upstream body", { status: 500 }),
        statusCode: 503
      }
    ];

    for (const scenario of cases) {
      let releases = 0;
      const endpoint = createIntentSessionEndpoint({
        env: {
          NODE_ENV: "test",
          INTENT_PROVIDER_ENABLED: "true",
          ...provider.env,
          ...scenario.env
        },
        intentAuthorizer: {
          async authorize() {
            return { async release() { releases += 1; } };
          }
        },
        fetchImpl: scenario.fetchImpl
      });
      const result = await endpoint(REQUEST, { headers: {} });
      assert.equal(result.statusCode, scenario.statusCode, scenario.name);
      assert.equal(releases, 1, scenario.name);
    }

    let configurationReleases = 0;
    const unconfiguredEndpoint = createIntentSessionEndpoint({
      env: { NODE_ENV: "test", INTENT_PROVIDER_ENABLED: "true" },
      intentAuthorizer: {
        async authorize() {
          return { async release() { configurationReleases += 1; } };
        }
      }
    });
    const unconfigured = await unconfiguredEndpoint(REQUEST, { headers: {} });
    assert.equal(unconfigured.statusCode, 503);
    assert.equal(unconfigured.payload.error.code, "configuration_unavailable");
    assert.equal(configurationReleases, 1);
  });

  it("releases the lease when either provider times out", async () => {
    for (const provider of PROVIDERS) {
      const timer = manualTimer();
      const started = deferred();
      let releases = 0;
      const endpoint = createIntentSessionEndpoint({
        env: { NODE_ENV: "test", INTENT_PROVIDER_ENABLED: "true", ...provider.env },
        intentAuthorizer: {
          async authorize() {
            return { async release() { releases += 1; } };
          }
        },
        fetchImpl: async (_url, init) => {
          started.resolve();
          return await rejectsWhenAborted(init.signal);
        },
        ...timer.options
      });
      const pending = endpoint(REQUEST, { headers: {} });
      await started.promise;
      timer.fire();
      const result = await pending;
      assert.equal(result.statusCode, 504, provider.name);
      assert.equal(result.payload.error.code, "intent_timed_out", provider.name);
      assert.equal(releases, 1, provider.name);
    }
  });

  it("propagates cancellation through either provider and releases the lease", async () => {
    for (const provider of PROVIDERS) {
      const caller = new AbortController();
      const started = deferred();
      let releases = 0;
      let upstreamSignal;
      const endpoint = createIntentSessionEndpoint({
        env: { NODE_ENV: "test", INTENT_PROVIDER_ENABLED: "true", ...provider.env },
        intentAuthorizer: {
          async authorize() {
            return { async release() { releases += 1; } };
          }
        },
        fetchImpl: async (_url, init) => {
          upstreamSignal = init.signal;
          started.resolve();
          return await rejectsWhenAborted(init.signal);
        }
      });
      const pending = endpoint(REQUEST, { headers: {}, signal: caller.signal });
      await started.promise;
      caller.abort();
      const result = await pending;
      assert.equal(result.statusCode, 499, provider.name);
      assert.equal(result.payload.error.code, "request_cancelled", provider.name);
      assert.equal(upstreamSignal.aborted, true, provider.name);
      assert.equal(releases, 1, provider.name);
    }
  });

  it("releases the authorization lease after in-flight caller cancellation", async () => {
    const caller = new AbortController();
    const endpoint = createEndpointWithLease({
      parseIntent: async (_body, options) => await new Promise((_resolve, reject) => {
        const rejectCancellation = () => reject(new IntentParseError("request_cancelled"));
        if (options.signal.aborted) {
          rejectCancellation();
          return;
        }
        options.signal.addEventListener("abort", rejectCancellation, { once: true });
      })
    });
    const pending = endpoint.handler(REQUEST, { headers: {}, signal: caller.signal });
    caller.abort();
    const result = await pending;
    assert.equal(result.statusCode, 499);
    assert.equal(result.payload.error.code, "request_cancelled");
    assert.equal(endpoint.releaseCount(), 1);
  });

  it("does not authorize or parse an already-cancelled request", async () => {
    const caller = new AbortController();
    caller.abort();
    let authorizeCalled = false;
    let parseCalled = false;
    const endpoint = createIntentSessionEndpoint({
      env: { NODE_ENV: "test", INTENT_PROVIDER_ENABLED: "true" },
      intentAuthorizer: {
        async authorize() {
          authorizeCalled = true;
          return { async release() {} };
        }
      },
      parseIntent: async () => {
        parseCalled = true;
        return { ok: true };
      }
    });
    const result = await endpoint(REQUEST, {
      headers: {},
      signal: caller.signal
    });
    assert.equal(result.statusCode, 499);
    assert.equal(result.payload.error.code, "request_cancelled");
    assert.equal(authorizeCalled, false);
    assert.equal(parseCalled, false);
  });

  it("releases access acquired after cancellation during authorization", async () => {
    const caller = new AbortController();
    const authorizeStarted = deferred();
    const authorizeResult = deferred();
    let releases = 0;
    let parseCalled = false;
    const endpoint = createIntentSessionEndpoint({
      env: { NODE_ENV: "test", INTENT_PROVIDER_ENABLED: "true" },
      intentAuthorizer: {
        async authorize() {
          authorizeStarted.resolve();
          return await authorizeResult.promise;
        }
      },
      parseIntent: async () => {
        parseCalled = true;
        return { ok: true };
      }
    });
    const pending = endpoint(REQUEST, { headers: {}, signal: caller.signal });
    await authorizeStarted.promise;
    caller.abort();
    authorizeResult.resolve({ async release() { releases += 1; } });
    const result = await pending;
    assert.equal(result.statusCode, 499);
    assert.equal(result.payload.error.code, "request_cancelled");
    assert.equal(parseCalled, false);
    assert.equal(releases, 1);
  });

  it("cannot return late success when cancellation occurs during lease release", async () => {
    const caller = new AbortController();
    const releaseStarted = deferred();
    const releaseResult = deferred();
    const endpoint = createIntentSessionEndpoint({
      env: { NODE_ENV: "test", INTENT_PROVIDER_ENABLED: "true" },
      intentAuthorizer: {
        async authorize() {
          return {
            async release() {
              releaseStarted.resolve();
              await releaseResult.promise;
            }
          };
        }
      },
      parseIntent: async () => ({ ok: true })
    });
    const pending = endpoint(REQUEST, { headers: {}, signal: caller.signal });
    await releaseStarted.promise;
    caller.abort();
    releaseResult.resolve();
    const result = await pending;
    assert.equal(result.statusCode, 499);
    assert.equal(result.payload.error.code, "request_cancelled");
  });

  it("attempts lease release without exposing a release failure", async () => {
    const rawReleaseError = "database lease release secret";
    const endpoint = createIntentSessionEndpoint({
      env: { NODE_ENV: "test", INTENT_PROVIDER_ENABLED: "true" },
      intentAuthorizer: {
        async authorize() {
          return {
            async release() { throw new Error(rawReleaseError); }
          };
        }
      },
      parseIntent: async () => ({ ok: true })
    });

    const result = await endpoint(REQUEST, { headers: {} });
    assert.deepEqual(result, { statusCode: 200, payload: { ok: true } });
    assert.equal(JSON.stringify(result).includes(rawReleaseError), false);
  });

  it("never exposes prompts, credentials, authorization, or provider bodies", async () => {
    const sensitive = [
      REQUEST.prompt,
      "openrouter-test-credential",
      "TrailMindRouteSession private-session-token",
      "raw upstream body with precise location",
      "private lease release diagnostic"
    ];
    const logs = [];
    const endpoint = createIntentSessionEndpoint({
      env: {
        NODE_ENV: "test",
        INTENT_PROVIDER_ENABLED: "true",
        AI_PROVIDER: "openrouter",
        OPENROUTER_API_KEY: sensitive[1]
      },
      logger: { warn(value) { logs.push(value); } },
      intentAuthorizer: {
        async authorize() {
          return {
            async release() { throw new Error(sensitive[4]); }
          };
        }
      },
      fetchImpl: async () => new Response(sensitive[3], { status: 500 })
    });
    const result = await endpoint(REQUEST, {
      headers: { authorization: sensitive[2] }
    });
    const visible = JSON.stringify({ result, logs });

    assert.equal(result.statusCode, 503);
    assert.equal(result.payload.error.code, "intent_unavailable");
    assert.deepEqual(logs, [{ event: "intent_lease_release_failed" }]);
    for (const value of sensitive) assert.equal(visible.includes(value), false);
  });

  it("sanitizes an unknown server-layer exception", async () => {
    const rawMessage = "server internals with provider URL and authorization";
    const result = await handleIntentHttpRequest(
      { method: "POST", url: "/api/parse-intent", body: REQUEST },
      { intentEndpoint: async () => { throw new Error(rawMessage); } }
    );

    assert.equal(result.statusCode, 503);
    assert.equal(result.payload.error.code, "intent_unavailable");
    assert.equal(JSON.stringify(result).includes(rawMessage), false);
  });

  it("uses the safe intent envelope for malformed and oversized HTTP bodies", async () => {
    for (const [body, contentType, statusCode] of [
      ["{malformed-json", "application/json", 400],
      [JSON.stringify(REQUEST), "text/plain", 400],
      [JSON.stringify({ padding: "x".repeat(17_000) }), "application/json", 413]
    ]) {
      const exchange = httpExchange(body, contentType);
      const handler = isolatedRequestHandler({
        intentEndpoint: async () => ({ statusCode: 200, payload: { ok: true } })
      });
      await handler(exchange.request, exchange.response);
      assert.equal(exchange.response.statusCode, statusCode);
      assert.equal(exchange.response.payload.error.code, "invalid_request");
      assert.equal(JSON.stringify(exchange.response.payload).includes(body), false);
    }
  });

  it("propagates an HTTP abort through parsing, releases the lease, and cleans listeners", async () => {
    const parseStarted = deferred();
    let releases = 0;
    const intentEndpoint = createIntentSessionEndpoint({
      env: { NODE_ENV: "test", INTENT_PROVIDER_ENABLED: "true" },
      intentAuthorizer: {
        async authorize() {
          return { async release() { releases += 1; } };
        }
      },
      parseIntent: async (_body, options) => {
        parseStarted.resolve();
        return await new Promise((_resolve, reject) => {
          const rejectCancellation = () => reject(new IntentParseError("request_cancelled"));
          if (options.signal.aborted) {
            rejectCancellation();
            return;
          }
          options.signal.addEventListener("abort", rejectCancellation, { once: true });
        });
      }
    });
    const handler = isolatedRequestHandler({ intentEndpoint });
    const exchange = httpExchange(JSON.stringify(REQUEST));
    const pending = handler(exchange.request, exchange.response);
    await parseStarted.promise;
    exchange.request.emit("aborted");
    await pending;

    assert.equal(exchange.response.statusCode, 499);
    assert.equal(exchange.response.payload.error.code, "request_cancelled");
    assert.equal(releases, 1);
    assert.equal(exchange.request.listenerCount("aborted"), 0);
    assert.equal(exchange.response.listenerCount("close"), 0);
  });
});

function parseFor(provider, options = {}) {
  return parseIntentEndpoint(REQUEST, {
    ...options,
    env: {
      NODE_ENV: "test",
      ...provider.env,
      ...options.env
    }
  });
}

function validIntent() {
  return {
    activityType: "hiking",
    routeType: "loop",
    startLocationQuery: "Ilsenburg",
    endLocationQuery: null,
    regionQuery: null,
    targetDistanceKm: 12,
    targetDurationMinutes: null,
    difficulty: null,
    desiredFeatures: [],
    avoidFeatures: [],
    transportMode: "walking",
    rawPrompt: REQUEST.prompt,
    parserSource: "remoteAI",
    confidence: 0.9
  };
}

function jsonResponse(payload, init = {}) {
  return new Response(JSON.stringify(payload), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init.headers
    }
  });
}

function oversizedStreamResponse(headers = {}) {
  let cancellations = 0;
  const bytes = new TextEncoder().encode(JSON.stringify({ padding: "x".repeat(2_000) }));
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
    },
    cancel() {
      cancellations += 1;
    }
  });
  return {
    response: new Response(body, { headers }),
    cancelCount() { return cancellations; }
  };
}

function stalledStreamResponse() {
  let cancellations = 0;
  const started = deferred();
  const blockedPull = deferred();
  const body = new ReadableStream({
    pull() {
      started.resolve();
      return blockedPull.promise;
    },
    cancel() {
      cancellations += 1;
      blockedPull.resolve();
    }
  });
  return {
    response: new Response(body),
    readStarted: started.promise,
    cancelCount() { return cancellations; }
  };
}

function manualTimer() {
  let callback;
  let delay;
  let clearCount = 0;
  return {
    options: {
      setTimeoutImpl(nextCallback, nextDelay) {
        callback = nextCallback;
        delay = nextDelay;
        return 1;
      },
      clearTimeoutImpl(handle) {
        assert.equal(handle, 1);
        clearCount += 1;
      }
    },
    fire() {
      assert.equal(typeof callback, "function");
      callback();
    },
    get delay() { return delay; },
    get clearCount() { return clearCount; }
  };
}

function rejectsWhenAborted(signal) {
  assert.ok(signal instanceof AbortSignal);
  return new Promise((_resolve, reject) => {
    if (signal.aborted) {
      reject(abortError());
      return;
    }
    signal.addEventListener("abort", () => reject(abortError()), { once: true });
  });
}

function abortError() {
  const error = new Error("aborted by test");
  error.name = "AbortError";
  return error;
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

async function rejectsWithIntentCode(promise, code, statusCode) {
  let captured;
  await assert.rejects(promise, (error) => {
    captured = error;
    assert.equal(error?.code, code);
    assert.equal(error?.statusCode, statusCode);
    return true;
  });
  return captured;
}

function createEndpointWithLease(options) {
  let releases = 0;
  return {
    handler: createIntentSessionEndpoint({
      env: { NODE_ENV: "test", INTENT_PROVIDER_ENABLED: "true" },
      intentAuthorizer: {
        async authorize() {
          return {
            async release() { releases += 1; }
          };
        }
      },
      ...options
    }),
    releaseCount() { return releases; }
  };
}

function isolatedRequestHandler({ intentEndpoint }) {
  return createIntentRequestHandler({
    appAttestRuntime: {},
    appAttestEndpoint: async () => ({ statusCode: 404, payload: { error: "Not found" } }),
    routeEndpoint: async () => ({ statusCode: 404, payload: { error: "Not found" } }),
    intentEndpoint
  });
}

function httpExchange(body, contentType = "application/json") {
  const request = Readable.from([body]);
  request.method = "POST";
  request.url = "/api/parse-intent";
  request.headers = { "content-type": contentType };
  request.socket = { remoteAddress: "127.0.0.1" };

  const response = new EventEmitter();
  response.destroyed = false;
  response.writableEnded = false;
  response.writeHead = (statusCode, headers) => {
    response.statusCode = statusCode;
    response.headers = headers;
  };
  response.end = (value) => {
    response.payload = JSON.parse(value);
    response.writableEnded = true;
  };
  return { request, response };
}
