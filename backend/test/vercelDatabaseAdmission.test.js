import assert from "node:assert/strict";
import { test } from "node:test";
import { createVercelHandler } from "../api/index.js";
import { stagingDatabaseAdmissionProbe } from "../src/operations/stagingDatabaseAdmission.js";

function fixtureEnv(overrides = {}) {
  return {
    NODE_ENV: "production", TRAILMIND_RELEASE_STAGE: "closed_beta",
    APP_ATTEST_DATABASE_URL: "postgresql://app_user:fixture@example.invalid/postgres?sslmode=verify-full&sslrootcert=/fixture/ca.crt",
    TRAILMIND_APPLICATION_SCHEMA: "trailmind_app",
    APP_ATTEST_RUNTIME_ROLE: "app_user", APP_ATTEST_CONTROL_ROLE: "app_pruner",
    APP_ATTEST_OPERATOR_ROLE: "app_operator", APP_ATTEST_APP_ID_PREFIX: "ABCDE12345",
    APP_ATTEST_BUNDLE_ID: "com.trailmind.app", APP_ATTEST_ENVIRONMENT: "production",
    APP_ATTEST_ALLOWED_VALIDATION_CATEGORIES: "3", APP_ATTEST_ALLOWED_BUNDLE_VERSIONS: "1",
    ROUTE_PROVIDER_ENABLED: "false", INTENT_PROVIDER_ENABLED: "false",
    OUTDOOR_EVIDENCE_PROVIDER_ENABLED: "false", OUTDOOR_RESEARCH_PLANNING_ENABLED: "false",
    OUTDOOR_ROUTABLE_HIGHLIGHT_ACCESS_ENABLED: "false", ROUTE_ALLOW_INSECURE_LOCAL_ROUTING: "false",
    INTENT_ALLOW_INSECURE_LOCAL_PARSING: "false", INTENT_ALLOW_DETERMINISTIC_MOCK: "false",
    OUTDOOR_RESEARCH_PLANNING_ALLOW_INSECURE_LOCAL: "false", APP_ATTEST_ALLOW_IN_MEMORY: "false",
    ...overrides
  };
}

function fixture(options = {}) {
  const state = { pools: [], queries: [], handled: 0, admitted: true, ended: 0 };
  class FakePool {
    constructor(configuration) { this.configuration = configuration; state.pools.push(this); }
    on(event, callback) { if (event === "error") this.onError = callback; }
    connect() { throw new Error("No real database or provider in this test"); }
    async query(query, values) {
      state.queries.push({ query, values });
      if (state.query) return state.query();
      return { rows: [{ admitted: state.admitted }] };
    }
    async end() { state.ended++; }
  }
  const env = fixtureEnv(options.env);
  const handler = createVercelHandler({
    ...options, env, PoolClass: FakePool,
    createApplicationHandler(runtime) {
      state.runtime = runtime;
      if (state.factoryError) throw new Error("secret-sentinel");
      return (request, response) => {
        state.handled++;
        response.writeHead(204, {}); response.end("");
      };
    }
  });
  return { state, env, handler };
}

async function request(handler, url = "/readyz", method = "GET") {
  const result = {};
  await handler({ method, url }, {
    writeHead(status, headers) { result.status = status; result.headers = headers; },
    end(body) { result.body = body; }
  });
  return result;
}

test("Vercel uses the exact frozen admission query and the same bounded runtime pool", async () => {
  const { handler, state, env } = fixture();
  assert.equal((await request(handler, "/healthz?probe=1")).status, 200);
  assert.equal(state.pools.length, 0);
  assert.equal((await request(handler, "/readyz?probe=1")).status, 200);
  const probe = stagingDatabaseAdmissionProbe(env, "runtime");
  assert.deepEqual(state.queries, [{ query: probe.query, values: probe.values }]);
  const pool = state.pools[0];
  assert.equal(pool.configuration.connectionString, env.APP_ATTEST_DATABASE_URL);
  assert.equal(pool.configuration.options, probe.startupOptions);
  assert.equal(pool.configuration.max, 4);
  assert.equal(pool.configuration.query_timeout, 5000);
  assert.equal(pool.configuration.connectionTimeoutMillis, 5000);
  assert.equal(state.runtime.appAttestRepository.pool, pool);
  assert.equal(state.runtime.accountPostgresPool, pool);
  assert.equal((await request(handler, "/api/route")).status, 204);
  assert.equal(state.queries.length, 2);
  assert.equal(state.pools.length, 1);
});

test("denied, malformed and failing database admissions block readiness and protected traffic", async () => {
  const { handler, state } = fixture();
  for (const admitted of [false, undefined, "true", 1]) {
    state.admitted = admitted;
    assert.equal((await request(handler)).status, 503);
    assert.equal((await request(handler, "/api/route", "POST")).status, 503);
  }
  state.query = async () => { throw new Error("secret-sentinel"); };
  const failed = await request(handler);
  assert.equal(failed.status, 503);
  assert.equal(failed.body.includes("secret-sentinel"), false);
  assert.equal((await request(handler, "/health/live?probe=1")).status, 200);
  assert.equal(state.handled, 0);
  state.query = undefined; state.admitted = true;
  assert.equal((await request(handler)).status, 200);
  state.admitted = false;
  assert.equal((await request(handler)).status, 503, "No stale successful admission");
});

test("concurrent requests share only the active probe and initialization", async () => {
  const { handler, state } = fixture();
  let resolve;
  state.query = () => new Promise((done) => { resolve = done; });
  const first = request(handler);
  const second = request(handler, "/api/route", "POST");
  assert.equal(state.pools.length, 1);
  assert.equal(state.queries.length, 1);
  assert.equal(state.handled, 0);
  resolve({ rows: [{ admitted: true }] });
  assert.deepEqual((await Promise.all([first, second])).map((r) => r.status), [200, 204]);
  state.query = undefined;
  assert.equal((await request(handler)).status, 200);
  assert.equal(state.queries.length, 2);
});

test("a hung probe has a bounded failure and cannot later mark the service ready", async () => {
  let deadline;
  const { handler, state } = fixture({
    setTimeoutImpl(callback) { deadline = callback; return {}; }, clearTimeoutImpl() {}
  });
  let resolve;
  state.query = () => new Promise((done) => { resolve = done; });
  const pending = request(handler, "/api/route", "POST");
  deadline();
  assert.equal((await pending).status, 503);
  resolve({ rows: [{ admitted: true }] });
  await Promise.resolve();
  assert.equal(state.runtime.operationalState.isReady(), false);
  assert.equal(state.handled, 0);
});

test("invalid configuration and unverified TLS never create a database pool", async () => {
  const url = fixtureEnv().APP_ATTEST_DATABASE_URL;
  for (const env of [
    { APP_ATTEST_DATABASE_URL: "" },
    { APP_ATTEST_DATABASE_URL: url.split("?")[0] },
    { APP_ATTEST_DATABASE_URL: url.replace("verify-full", "no-verify") },
    { APP_ATTEST_DATABASE_URL: url.replace("/fixture/ca.crt", "relative.crt") },
    { APP_ATTEST_DATABASE_URL: url + "&sslmode=require" },
    { APP_ATTEST_DATABASE_URL: url + "&options=-c%20search_path=public" },
    { NODE_TLS_REJECT_UNAUTHORIZED: "0" }
  ]) {
    const { handler, state } = fixture({ env });
    assert.equal((await request(handler)).status, 503);
    assert.equal((await request(handler, "/healthz")).status, 200);
    assert.equal(state.pools.length, 0);
  }
});

test("partial initialization closes owned pools and can retry without leaking details", async () => {
  const { handler, state } = fixture();
  state.factoryError = true;
  const failed = await request(handler);
  assert.equal(failed.status, 503);
  assert.equal(failed.body.includes("secret-sentinel"), false);
  assert.equal(state.ended, 1);
  state.factoryError = false;
  assert.equal((await request(handler)).status, 200);
  assert.equal(state.pools.length, 2);
});
