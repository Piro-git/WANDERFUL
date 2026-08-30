import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

const BLUEPRINT_URL = new URL("../../render.yaml", import.meta.url);
const HOST_CONTRACT_URL = new URL(
  "../container/staging-host-contract-v1.json",
  import.meta.url
);

const EXACT_FALSE_FLAGS = Object.freeze([
  "ROUTE_PROVIDER_ENABLED",
  "INTENT_PROVIDER_ENABLED",
  "OUTDOOR_EVIDENCE_PROVIDER_ENABLED",
  "OUTDOOR_RESEARCH_PLANNING_ENABLED",
  "OUTDOOR_ROUTABLE_HIGHLIGHT_ACCESS_ENABLED",
  "ROUTE_ALLOW_INSECURE_LOCAL_ROUTING",
  "INTENT_ALLOW_INSECURE_LOCAL_PARSING",
  "INTENT_ALLOW_DETERMINISTIC_MOCK",
  "OUTDOOR_RESEARCH_PLANNING_ALLOW_INSECURE_LOCAL",
  "APP_ATTEST_ALLOW_IN_MEMORY"
]);

const REQUIRED_OPERATOR_VALUES = Object.freeze([
  "TRAILMIND_STAGING_PROJECT_REF_SHA256",
  "APP_ATTEST_DATABASE_URL",
  "OUTDOOR_RESEARCH_DATABASE_URL",
  "OUTDOOR_RESEARCH_CANCELLATION_DATABASE_URL",
  "OUTDOOR_EVIDENCE_DATABASE_URL",
  "GRAPHHOPPER_API_KEY",
  "APP_ATTEST_APP_ID_PREFIX",
  "APP_ATTEST_BUNDLE_ID",
  "APP_ATTEST_ALLOWED_VALIDATION_CATEGORIES",
  "APP_ATTEST_ALLOWED_BUNDLE_VERSIONS"
]);
const REQUIRED_PUBLIC_VALUES = Object.freeze({
  TRAILMIND_APPLICATION_SCHEMA: "trailmind_app",
  APP_ATTEST_RUNTIME_ROLE: "app_security_runtime_role",
  APP_ATTEST_CONTROL_ROLE: "pruner_role",
  APP_ATTEST_OPERATOR_ROLE: "migration_role",
  GRAPHHOPPER_BASE_URL: "https://graphhopper.com/api/1",
  ROUTE_GLOBAL_MAX_CONCURRENCY: '"16"'
});

describe("free staging hosting contract", () => {
  it("defines one manual Frankfurt Render Free container service", async () => {
    const blueprint = await readFile(BLUEPRINT_URL, "utf8");
    assert.match(blueprint, /^previews:\n\s+generation: off$/m);
    assert.equal(count(blueprint, /^\s*- type: web$/gm), 1);
    assert.equal(count(blueprint, /^\s*plan: /gm), 1);
    assert.match(blueprint, /^\s*name: wanderful-staging-v1$/m);
    assert.match(blueprint, /^\s*runtime: docker$/m);
    assert.match(blueprint, /^\s*plan: free$/m);
    assert.match(blueprint, /^\s*region: frankfurt$/m);
    assert.match(
      blueprint,
      /^\s*branch: main$/m
    );
    assert.match(blueprint, /^\s*autoDeployTrigger: off$/m);
    assert.match(blueprint, /^\s*healthCheckPath: \/healthz$/m);
    assert.match(blueprint, /^\s*maxShutdownDelaySeconds: 30$/m);
    assert.match(blueprint, /^\s*numInstances: 1$/m);
    assert.match(blueprint, /^\s*dockerfilePath: \.\/backend\/Dockerfile$/m);
    assert.match(blueprint, /^\s*dockerContext: \.\/backend$/m);
    assert.doesNotMatch(
      blueprint,
      /^\s*(?:databases|envVarGroups|repo|domains|preDeployCommand|initialDeployHook|disk):/m
    );
  });

  it("requires operator-supplied identity without embedding values", async () => {
    const blueprint = await readFile(BLUEPRINT_URL, "utf8");
    const blocks = environmentBlocks(blueprint);
    assert.deepEqual(
      [...blocks.keys()].sort(),
      [
        "NODE_ENV",
        "TRAILMIND_RELEASE_STAGE",
        "APP_ATTEST_ENVIRONMENT",
        ...REQUIRED_OPERATOR_VALUES,
        ...Object.keys(REQUIRED_PUBLIC_VALUES),
        ...EXACT_FALSE_FLAGS
      ].sort()
    );
    for (const name of REQUIRED_OPERATOR_VALUES) {
      assert.deepEqual(blocks.get(name), ["sync: false"]);
    }
    for (const [name, value] of Object.entries(REQUIRED_PUBLIC_VALUES)) {
      assert.deepEqual(blocks.get(name), [`value: ${value}`]);
    }
    assert.deepEqual(blocks.get("NODE_ENV"), ["value: production"]);
    assert.deepEqual(blocks.get("TRAILMIND_RELEASE_STAGE"), ["value: staging"]);
    assert.deepEqual(blocks.get("APP_ATTEST_ENVIRONMENT"), ["value: production"]);
    for (const name of [
      "DATABASE_URL",
      "POSTGRES_URL",
      "SUPABASE_SERVICE_ROLE_KEY",
      "SUPABASE_SECRET_KEY",
      "GOOGLE_API_KEY",
      "OPENROUTER_API_KEY",
      "APP_ATTEST_CONTROL_DATABASE_URL",
      "APP_ATTEST_OPERATOR_DATABASE_URL"
    ]) assert.equal(blocks.has(name), false);
  });

  it("keeps every provider and insecure capability exact false", async () => {
    const blueprint = await readFile(BLUEPRINT_URL, "utf8");
    const blocks = environmentBlocks(blueprint);
    for (const name of EXACT_FALSE_FLAGS) {
      assert.deepEqual(blocks.get(name), ['value: "false"']);
    }
  });

  it("does not publish an unverified base URL or permit iOS connection", async () => {
    const contract = JSON.parse(await readFile(HOST_CONTRACT_URL, "utf8"));
    assert.equal(contract.schemaVersion, 1);
    assert.equal(contract.canonicalService.platform, "render");
    assert.equal(contract.canonicalService.serviceName, "wanderful-staging-v1");
    assert.equal(contract.canonicalService.region, "frankfurt");
    assert.equal(contract.canonicalService.plan, "free");
    assert.equal(contract.baseUrl.state, "unassigned");
    assert.equal(contract.baseUrl.value, null);
    assert.equal(contract.baseUrl.requiredScheme, "https");
    assert.equal(contract.lifecycle.healthCheckPath, "/healthz");
    assert.equal(contract.lifecycle.readinessPath, "/readyz");
    assert.equal(
      contract.releasePolicy.iosConnection,
      "blocked_until_validated_remote_deployment_receipt"
    );
    assert.equal(contract.releasePolicy.closedBeta, "not_eligible");
    assert.equal(
      contract.releasePolicy.providerFlags,
      "tracked_defaults_false_staging_operator_only"
    );
    assert.equal(contract.releasePolicy.remoteMutationAuthorized, false);
    assert.equal(contract.freeTierLimitations.productionEligible, false);
    assert.equal(contract.freeTierLimitations.idleSpinDownMinutes, 15);
  });
});

function environmentBlocks(blueprint) {
  const lines = blueprint.split("\n");
  const result = new Map();
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^\s*- key: ([A-Z0-9_]+)$/);
    if (!match) continue;
    const settings = [];
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      if (/^\s*- key: /.test(lines[cursor])) break;
      const setting = lines[cursor].trim();
      if (setting) settings.push(setting);
    }
    assert.equal(result.has(match[1]), false, `duplicate environment key: ${match[1]}`);
    result.set(match[1], settings);
  }
  return result;
}

function count(value, expression) {
  return [...value.matchAll(expression)].length;
}
