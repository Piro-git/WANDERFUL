import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import {
  assertStagingContainerEnvironment,
  evaluateStagingContainerEnvironment,
  StagingAdmissionError,
  stagingAdmissionContract
} from "../container/stagingAdmission.js";
import { runStagingPruner } from "../scripts/staging/runtime/run-pruner.js";

describe("staging container admission", () => {
  it("admits only the isolated all-disabled least-privilege staging shape", () => {
    const env = stagingEnvironment();
    const report = assertStagingContainerEnvironment(env, { execArgv: [] });
    assert.equal(report.decision, "ready");
    assert.equal(report.checks.every(({ status }) => status === "pass"), true);
    assert.equal(report.capabilities.every(({ state }) => state === "disabled"), true);
    assert.equal(JSON.stringify(report).includes(env.APP_ATTEST_DATABASE_URL), false);
  });

  it("rejects enabled or malformed flags, privileged roles and operator credentials", () => {
    const cases = [
      { ROUTE_PROVIDER_ENABLED: "true" },
      { INTENT_PROVIDER_ENABLED: "False" },
      { OUTDOOR_RESEARCH_PLANNING_ENABLED: "0" },
      { APP_ATTEST_ALLOW_IN_MEMORY: "true" },
      { TRAILMIND_RELEASE_STAGE: "closed_beta" },
      { APP_ATTEST_CONTROL_DATABASE_URL: databaseUrl("trailmind_pruner") },
      { DATABASE_URL: databaseUrl("legacy_runtime") },
      { GRAPHHOPPER_API_KEY: "unused-secret-sentinel" },
      { NODE_TLS_REJECT_UNAUTHORIZED: "0" },
      { NODE_OPTIONS: "--inspect=0.0.0.0:9229" },
      { PGOPTIONS: "-c search_path=shadow,public" },
      { TRAILMIND_STAGING_PROJECT_REF_SHA256: "0".repeat(64) },
      { APP_ATTEST_RUNTIME_ROLE: "another_runtime" },
      { APP_ATTEST_DATABASE_URL: databaseUrl("service_role") },
      { APP_ATTEST_DATABASE_URL: databaseUrl("postgres") },
      { APP_ATTEST_DATABASE_URL: databaseUrl("trailmind_runtime", "require") },
      { APP_ATTEST_DATABASE_URL: databaseUrl("trailmind_runtime", "disable") },
      { APP_ATTEST_DATABASE_URL: databaseUrl("trailmind_runtime").replace(":5432/", ":6543/") },
      { APP_ATTEST_DATABASE_URL: databaseUrl("trailmind_runtime").replace("pooler.supabase.com", "database.invalid") },
      { APP_ATTEST_DATABASE_URL: `${databaseUrl("trailmind_runtime")}&options=unsafe` },
      { APP_ATTEST_DATABASE_URL: `${databaseUrl("trailmind_runtime")}&host=database.invalid` },
      { APP_ATTEST_DATABASE_URL: `${databaseUrl("trailmind_runtime")}&sslmode=disable` },
      { APP_ATTEST_DATABASE_URL: "postgresql://missing-project-ref.invalid/postgres?sslmode=verify-full" }
    ];
    for (const overrides of cases) {
      const env = stagingEnvironment(overrides);
      const report = evaluateStagingContainerEnvironment(env, { execArgv: [] });
      assert.equal(report.decision, "blocked", JSON.stringify(Object.keys(overrides)));
      assert.throws(
        () => assertStagingContainerEnvironment(env, { execArgv: [] }),
        StagingAdmissionError
      );
      const serialized = JSON.stringify(report);
      assert.equal(serialized.includes("unused-secret-sentinel"), false);
      assert.equal(serialized.includes(env.APP_ATTEST_DATABASE_URL), false);
    }
    assert.equal(evaluateStagingContainerEnvironment(
      stagingEnvironment(),
      { execArgv: ["--inspect=0.0.0.0:9229"] }
    ).decision, "blocked");
  });

  it("keeps the web process and pruner connection sources structurally separate", async () => {
    const contract = stagingAdmissionContract();
    assert.equal(contract.forbiddenWebProcessValues.includes("APP_ATTEST_CONTROL_DATABASE_URL"), true);
    let received;
    const events = [];
    const counts = await runStagingPruner({
      env: {
        NODE_ENV: "production",
        TRAILMIND_RELEASE_STAGE: "staging",
        TRAILMIND_STAGING_PROJECT_REF_SHA256: projectRefSha256(),
        APP_ATTEST_RUNTIME_ROLE: "trailmind_runtime",
        APP_ATTEST_CONTROL_ROLE: "trailmind_pruner",
        APP_ATTEST_CONTROL_DATABASE_URL: databaseUrl("trailmind_pruner")
      },
      execArgv: [],
      logger: { info(event) { events.push(event); }, error(event) { events.push(event); } },
      async runPrune(options) {
        received = options;
        return { challenges: 1, routeSessions: 2, rateWindows: 3, providerLeases: 4 };
      }
    });
    assert.deepEqual(counts, {
      challenges: 1,
      routeSessions: 2,
      rateWindows: 3,
      providerLeases: 4
    });
    const receivedUrl = new URL(received.env.APP_ATTEST_DATABASE_URL);
    assert.equal(receivedUrl.username, "trailmind_pruner.abcdefghijklmnopqrst");
    assert.equal(receivedUrl.searchParams.get("options"), "-c search_path=pg_catalog,public");
    assert.equal("APP_ATTEST_CONTROL_DATABASE_URL" in received.env, false);
    assert.deepEqual(events, [{ event: "prune_job_completed", outcome: "succeeded" }]);
    assert.equal(JSON.stringify(events).includes(databaseUrl("trailmind_pruner")), false);

    await assert.rejects(runStagingPruner({
      env: {
        NODE_ENV: "production",
        TRAILMIND_RELEASE_STAGE: "staging",
        TRAILMIND_STAGING_PROJECT_REF_SHA256: projectRefSha256(),
        APP_ATTEST_RUNTIME_ROLE: "trailmind_runtime",
        APP_ATTEST_CONTROL_ROLE: "trailmind_pruner",
        APP_ATTEST_DATABASE_URL: databaseUrl("trailmind_pruner"),
        APP_ATTEST_CONTROL_DATABASE_URL: databaseUrl("trailmind_pruner")
      },
      execArgv: [],
      logger: { info() {}, error() {} },
      async runPrune() {}
    }), /pruner_runtime_source_forbidden/);

    await assert.rejects(runStagingPruner({
      env: {
        NODE_ENV: "production",
        TRAILMIND_RELEASE_STAGE: "staging",
        TRAILMIND_STAGING_PROJECT_REF_SHA256: projectRefSha256(),
        APP_ATTEST_RUNTIME_ROLE: "trailmind_pruner",
        APP_ATTEST_CONTROL_ROLE: "trailmind_pruner",
        APP_ATTEST_CONTROL_DATABASE_URL: databaseUrl("trailmind_pruner")
      },
      execArgv: [],
      logger: { info() {}, error() {} },
      async runPrune() {}
    }), /pruner_role_alias/);
  });
});

export function stagingEnvironment(overrides = {}) {
  return {
    NODE_ENV: "production",
    TRAILMIND_RELEASE_STAGE: "staging",
    HOST: "127.0.0.1",
    TRAILMIND_STAGING_PROJECT_REF_SHA256: projectRefSha256(),
    APP_ATTEST_RUNTIME_ROLE: "trailmind_runtime",
    APP_ATTEST_DATABASE_URL: databaseUrl("trailmind_runtime"),
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

function databaseUrl(role, sslmode = "verify-full") {
  return `postgresql://${role}.abcdefghijklmnopqrst:secret-sentinel@` +
    `aws-0-eu-central-1.pooler.supabase.com:5432/postgres?sslmode=${sslmode}` +
    "&sslrootcert=/etc/secrets/supabase-staging-ca.crt";
}

function projectRefSha256() {
  return createHash("sha256").update("abcdefghijklmnopqrst").digest("hex");
}
