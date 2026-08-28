import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { createServer } from "node:http";
import { afterEach, describe, it } from "node:test";
import { checkBoundedLiveness } from "../container/healthcheck.js";
import { startStagingContainerProcess } from "../container/start.js";
import { probeRequiredPools } from "../src/operations/serviceLifecycle.js";

const runningServers = new Set();

afterEach(async () => {
  await Promise.all([...runningServers].map((server) => new Promise((resolve) => {
    if (!server.listening) return resolve();
    server.close(resolve);
  })));
  runningServers.clear();
  FakePool.instances.length = 0;
});

describe("staging runtime lifecycle", () => {
  it("fails closed when the App Attest schema/grant admission probe is false", async () => {
    let queries = 0;
    await assert.rejects(probeRequiredPools([{
      pool: {
        async query(text, values) {
          queries += 1;
          assert.match(text, /app_attest_challenges/);
          assert.match(text, /rolbypassrls/);
          assert.match(text, /has_schema_privilege/);
          assert.match(text, /current_setting\('search_path'\)/);
          assert.match(text, /has_table_privilege/);
          assert.deepEqual(values, ["expected-schema"]);
          return { rows: [{ admitted: false }] };
        }
      },
      query: "SELECT app_attest_challenges, rolbypassrls, has_schema_privilege, current_setting('search_path'), has_table_privilege",
      values: ["expected-schema"],
      requiresAdmission: true
    }], 1_000), /database_runtime_admission_failed/);
    assert.equal(queries, 1);
  });

  it("starts only after durable admission, serves bounded health and drains all pools", async () => {
    const port = await unusedPort();
    const events = [];
    const processObject = fakeProcess();
    const service = await startStagingContainerProcess({
      env: stagingEnvironment({ PORT: String(port) }),
      PoolClass: FakePool,
      process: processObject,
      logger: loggerInto(events),
      execArgv: [],
      setIntervalImpl() { return { unref() {} }; },
      clearIntervalImpl() {}
    });
    runningServers.add(service.server);

    assert.equal(await checkBoundedLiveness({ port }), true);
    const ready = await fetch(`http://127.0.0.1:${port}/readyz`);
    assert.equal(ready.status, 200);
    assert.deepEqual(await ready.json(), { status: "ready" });
    assert.equal(FakePool.instances.length, 1);
    assert.equal(
      FakePool.instances[0].options.options,
      '-c search_path=pg_catalog,"trailmind_app",pg_temp'
    );
    assert.equal(
      FakePool.instances[0].queries[0].text.includes("app_attest_provider_leases"),
      false
    );
    assert.equal(FakePool.instances[0].queries[0].values[0], "trailmind_app");
    assert.equal(FakePool.instances[0].queries[0].values[2], "trailmind_runtime");
    assert.equal(
      FakePool.instances[0].queries[0].values[6].includes("app_attest_provider_leases"),
      true
    );
    assert.equal(events.some((event) =>
      event.event === "runtime_capability_state" && event.state === "disabled"
    ), true);

    const outcome = await service.shutdown("test");
    runningServers.delete(service.server);
    assert.equal(outcome.outcome, "graceful");
    assert.equal(FakePool.instances.every((pool) => pool.closed), true);
    assert.equal(processObject.handlers.size, 0);
  });

  it("turns an idle pool error into privacy-safe not-ready state without a crash", async () => {
    const port = await unusedPort();
    const events = [];
    const service = await startStagingContainerProcess({
      env: stagingEnvironment({ PORT: String(port) }),
      PoolClass: FakePool,
      process: fakeProcess(),
      logger: loggerInto(events),
      execArgv: [],
      setIntervalImpl() { return { unref() {} }; },
      clearIntervalImpl() {}
    });
    runningServers.add(service.server);
    FakePool.instances[0].emit("error", new Error("private-database-error-sentinel"));
    FakePool.instances[0].emit("error", new Error("repeated-private-error-sentinel"));

    assert.equal(service.operationalState.isReady(), false);
    const ready = await fetch(`http://127.0.0.1:${port}/readyz`);
    assert.equal(ready.status, 503);
    assert.deepEqual(await ready.json(), { status: "not_ready" });
    const late = await fetch(`http://127.0.0.1:${port}/api/route`, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: "private-request-sentinel"
    });
    assert.equal(late.status, 503);
    assert.equal((await late.json()).error.code, "service_unavailable");
    assert.equal(JSON.stringify(events).includes("private-database-error-sentinel"), false);
    assert.equal(events.some(({ event }) => event === "database_pool_error"), true);
    assert.equal(events.filter(({ event }) => event === "database_pool_error").length, 1);
    assert.equal(events.some((event) =>
      event.event === "database_pool_state_changed" && event.state === "unavailable"
    ), true);

    await service.shutdown("test");
    runningServers.delete(service.server);
  });

  it("keeps the healthcheck bounded to liveness and rejects oversized responses", async () => {
    let requestPath;
    const normal = createServer((request, response) => {
      requestPath = request.url;
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end('{"status":"live"}');
    });
    runningServers.add(normal);
    await new Promise((resolve) => normal.listen(0, "127.0.0.1", resolve));
    assert.equal(await checkBoundedLiveness({ port: normal.address().port }), true);
    assert.equal(requestPath, "/healthz");

    const oversized = createServer((_request, response) => {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end("x".repeat(129));
    });
    runningServers.add(oversized);
    await new Promise((resolve) => oversized.listen(0, "127.0.0.1", resolve));
    assert.equal(await checkBoundedLiveness({ port: oversized.address().port }), false);
  });
});

class FakePool extends EventEmitter {
  static instances = [];

  constructor(options) {
    super();
    this.options = options;
    this.totalCount = 1;
    this.idleCount = 1;
    this.waitingCount = 0;
    this.queries = [];
    this.closed = false;
    FakePool.instances.push(this);
  }

  async query(text, values) {
    this.queries.push({ text, values });
    return text.includes("AS admitted")
      ? { rows: [{ admitted: true }] }
      : { rows: [{ "?column?": 1 }] };
  }

  async connect() {
    throw new Error("unexpected_database_work");
  }

  async end() {
    this.closed = true;
  }
}

async function unusedPort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function fakeProcess() {
  const handlers = new Map();
  return {
    handlers,
    once(signal, handler) { handlers.set(signal, handler); },
    removeListener(signal) { handlers.delete(signal); },
    exit() { throw new Error("unexpected_process_exit"); }
  };
}

function loggerInto(events) {
  return {
    info(event) { events.push(event); },
    warn(event) { events.push(event); },
    error(event) { events.push(event); }
  };
}

function stagingEnvironment(overrides = {}) {
  return {
    NODE_ENV: "production",
    TRAILMIND_RELEASE_STAGE: "staging",
    HOST: "127.0.0.1",
    TRAILMIND_STAGING_PROJECT_REF_SHA256:
      createHash("sha256").update("abcdefghijklmnopqrst").digest("hex"),
    APP_ATTEST_RUNTIME_ROLE: "trailmind_runtime",
    APP_ATTEST_CONTROL_ROLE: "trailmind_pruner",
    APP_ATTEST_OPERATOR_ROLE: "trailmind_operator",
    TRAILMIND_APPLICATION_SCHEMA: "trailmind_app",
    APP_ATTEST_DATABASE_URL:
      "postgresql://trailmind_runtime.abcdefghijklmnopqrst:secret-sentinel@" +
      "aws-0-eu-central-1.pooler.supabase.com:5432/postgres?sslmode=verify-full" +
      "&sslrootcert=/etc/secrets/supabase-staging-ca.crt",
    APP_ATTEST_APP_ID_PREFIX: "ABCDE12345",
    APP_ATTEST_BUNDLE_ID: "com.trailmind.app",
    APP_ATTEST_ENVIRONMENT: "development",
    APP_ATTEST_ALLOWED_VALIDATION_CATEGORIES: "3",
    APP_ATTEST_ALLOWED_BUNDLE_VERSIONS: "1",
    ROUTE_PROVIDER_ENABLED: "false",
    INTENT_PROVIDER_ENABLED: "false",
    OUTDOOR_EVIDENCE_PROVIDER_ENABLED: "false",
    OUTDOOR_RESEARCH_PLANNING_ENABLED: "false",
    OUTDOOR_ROUTABLE_HIGHLIGHT_ACCESS_ENABLED: "false",
    ROUTE_ALLOW_INSECURE_LOCAL_ROUTING: "false",
    INTENT_ALLOW_INSECURE_LOCAL_PARSING: "false",
    INTENT_ALLOW_DETERMINISTIC_MOCK: "false",
    OUTDOOR_RESEARCH_PLANNING_ALLOW_INSECURE_LOCAL: "false",
    APP_ATTEST_ALLOW_IN_MEMORY: "false",
    ...overrides
  };
}
