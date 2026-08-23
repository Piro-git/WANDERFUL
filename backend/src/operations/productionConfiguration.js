import { endpointConfiguration } from "../appAttest/appAttestEndpoint.js";
import { appAttestVerifierConfiguration } from "../appAttest/appAttestVerifier.js";
import {
  intentAuthorizationConfiguration,
  routeAuthorizationConfiguration
} from "../appAttest/routeSessionAuthorizer.js";
import {
  outdoorAdventureOrchestrationConfigurationV1
} from "../outdoorAdventure/orchestrationPolicy.js";
import { providerConfiguration } from "../routing/graphHopperProvider.js";

const CONTRACT_VERSION = "backend-production-configuration-v1";
const RELEASE_STAGES = new Set(["staging", "closed_beta", "public"]);
const CONTROLLED_FLAGS = Object.freeze([
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
const INSECURE_FLAGS = Object.freeze([
  "ROUTE_ALLOW_INSECURE_LOCAL_ROUTING",
  "INTENT_ALLOW_INSECURE_LOCAL_PARSING",
  "INTENT_ALLOW_DETERMINISTIC_MOCK",
  "OUTDOOR_RESEARCH_PLANNING_ALLOW_INSECURE_LOCAL",
  "APP_ATTEST_ALLOW_IN_MEMORY"
]);

export class ProductionConfigurationError extends Error {
  constructor(report) {
    super("Production configuration preflight failed.");
    this.name = "ProductionConfigurationError";
    this.code = "production_configuration_blocked";
    this.report = report;
  }
}

export function evaluateProductionConfiguration(env = process.env) {
  const checks = [];
  const check = (id, operation) => {
    try {
      operation();
      checks.push({ id, status: "pass" });
    } catch {
      checks.push({ id, status: "fail" });
    }
  };

  check("node_environment", () => requiredExact(env.NODE_ENV, "production"));
  check("release_stage", () => requiredEnum(env.TRAILMIND_RELEASE_STAGE, RELEASE_STAGES));
  check("controlled_flags", () => {
    for (const name of CONTROLLED_FLAGS) exactBooleanFlag(env[name]);
  });
  check("insecure_capabilities_disabled", () => {
    for (const name of INSECURE_FLAGS) requiredExact(env[name], "false");
  });
  check("http_bounds", () => httpServerConfiguration(env));
  check("app_attest_configuration", () => {
    requiredPostgresUrl(env.APP_ATTEST_DATABASE_URL);
    appAttestVerifierConfiguration(env);
    if (
      env.TRAILMIND_RELEASE_STAGE !== "staging" &&
      env.APP_ATTEST_ENVIRONMENT !== "production"
    ) {
      invalid();
    }
    appAttestDatabaseConfiguration(env);
  });
  check("authorization_bounds", () => {
    endpointConfiguration(env);
    routeAuthorizationConfiguration(env);
    intentAuthorizationConfiguration(env);
  });
  check("request_response_bounds", () => requestResponseBounds(env));
  check("provider_configuration", () => {
    if (flagEnabled(env.ROUTE_PROVIDER_ENABLED)) providerConfiguration(env);
    if (flagEnabled(env.INTENT_PROVIDER_ENABLED)) validateIntentProvider(env);
  });
  check("research_composition", () => {
    validateResearchComposition(env);
    validateRuntimeDatabaseRoleSeparation(env);
  });
  check("feature_dependency_order", () => validateFeatureDependencies(env));
  check("closed_beta_surface", () => validateReleaseSurface(env));

  const capabilities = Object.freeze([
    capability("route_provider", env.ROUTE_PROVIDER_ENABLED),
    capability("intent_provider", env.INTENT_PROVIDER_ENABLED),
    capability("outdoor_evidence", env.OUTDOOR_EVIDENCE_PROVIDER_ENABLED),
    capability("outdoor_research", env.OUTDOOR_RESEARCH_PLANNING_ENABLED),
    capability("routable_highlight_access", env.OUTDOOR_ROUTABLE_HIGHLIGHT_ACCESS_ENABLED)
  ]);
  const decision = checks.every((item) => item.status === "pass")
    ? "ready"
    : "blocked";
  return deepFreeze({
    schemaVersion: 1,
    contractVersion: CONTRACT_VERSION,
    decision,
    checks,
    capabilities
  });
}

export function assertProductionConfiguration(env = process.env) {
  const report = evaluateProductionConfiguration(env);
  if (report.decision !== "ready") throw new ProductionConfigurationError(report);
  return report;
}

export function httpServerConfiguration(env = process.env) {
  const port = integer(env.PORT, 3_000, 1, 65_535);
  const headersTimeoutMs = integer(env.HTTP_HEADERS_TIMEOUT_MS, 10_000, 1_000, 60_000);
  const requestTimeoutMs = integer(env.HTTP_REQUEST_TIMEOUT_MS, 45_000, 5_000, 120_000);
  const keepAliveTimeoutMs = integer(env.HTTP_KEEP_ALIVE_TIMEOUT_MS, 5_000, 1_000, 30_000);
  const shutdownDeadlineMs = integer(env.HTTP_SHUTDOWN_DEADLINE_MS, 10_000, 1_000, 60_000);
  const readinessProbeIntervalMs = integer(
    env.READINESS_PROBE_INTERVAL_MS,
    10_000,
    1_000,
    60_000
  );
  const maximumHeaders = integer(env.HTTP_MAX_HEADERS_COUNT, 64, 16, 256);
  if (headersTimeoutMs > requestTimeoutMs || keepAliveTimeoutMs >= headersTimeoutMs) invalid();
  const host = boundedHost(env.HOST);
  return Object.freeze({
    host,
    port,
    headersTimeoutMs,
    requestTimeoutMs,
    keepAliveTimeoutMs,
    shutdownDeadlineMs,
    readinessProbeIntervalMs,
    maximumHeaders
  });
}

export function appAttestDatabaseConfiguration(env = process.env) {
  const statementTimeoutMs = integer(
    env.APP_ATTEST_DATABASE_STATEMENT_TIMEOUT_MS,
    5_000,
    500,
    30_000
  );
  const idleTransactionTimeoutMs = integer(
    env.APP_ATTEST_DATABASE_IDLE_TRANSACTION_TIMEOUT_MS,
    10_000,
    1_000,
    60_000
  );
  const connectionTimeoutMs = integer(env.DATABASE_CONNECT_TIMEOUT_MS, 5_000, 500, 30_000);
  const idleTimeoutMs = integer(env.DATABASE_IDLE_TIMEOUT_MS, 30_000, 1_000, 300_000);
  const maximumConnections = integer(env.APP_ATTEST_DATABASE_POOL_MAX, 4, 1, 20);
  if (idleTransactionTimeoutMs < statementTimeoutMs) invalid();
  return Object.freeze({
    statementTimeoutMs,
    idleTransactionTimeoutMs,
    connectionTimeoutMs,
    idleTimeoutMs,
    maximumConnections
  });
}

export function researchDatabaseConfiguration(env = process.env) {
  const statementTimeoutMs = integer(
    env.OUTDOOR_RESEARCH_PLANNING_STATEMENT_TIMEOUT_MS,
    2_500,
    100,
    15_000
  );
  const connectionTimeoutMs = integer(env.DATABASE_CONNECT_TIMEOUT_MS, 5_000, 500, 30_000);
  const idleTimeoutMs = integer(env.DATABASE_IDLE_TIMEOUT_MS, 30_000, 1_000, 300_000);
  const maximumConnections = integer(env.OUTDOOR_RESEARCH_DATABASE_POOL_MAX, 4, 1, 20);
  return Object.freeze({
    statementTimeoutMs,
    connectionTimeoutMs,
    idleTimeoutMs,
    maximumConnections
  });
}

export function evidenceDatabaseConfiguration(env = process.env) {
  const statementTimeoutMs = integer(
    env.OUTDOOR_EVIDENCE_QUERY_TIMEOUT_MS,
    2_500,
    100,
    15_000
  );
  const connectionTimeoutMs = integer(env.DATABASE_CONNECT_TIMEOUT_MS, 5_000, 500, 30_000);
  const idleTimeoutMs = integer(env.DATABASE_IDLE_TIMEOUT_MS, 30_000, 1_000, 300_000);
  const maximumConnections = integer(env.OUTDOOR_EVIDENCE_DATABASE_POOL_MAX, 4, 1, 20);
  return Object.freeze({
    statementTimeoutMs,
    connectionTimeoutMs,
    idleTimeoutMs,
    maximumConnections
  });
}

export function flagEnabled(value) {
  return value === "true";
}

function validateResearchComposition(env) {
  if (!flagEnabled(env.OUTDOOR_RESEARCH_PLANNING_ENABLED)) return;
  const productUrl = requiredPostgresUrl(env.OUTDOOR_RESEARCH_DATABASE_URL);
  const cancellationUrl = requiredPostgresUrl(
    env.OUTDOOR_RESEARCH_CANCELLATION_DATABASE_URL
  );
  const appSecurityUrl = requiredPostgresUrl(env.APP_ATTEST_DATABASE_URL);
  if (productUrl === cancellationUrl || productUrl === appSecurityUrl) invalid();
  researchDatabaseConfiguration(env);
  outdoorAdventureOrchestrationConfigurationV1(env);
}

function validateFeatureDependencies(env) {
  const route = flagEnabled(env.ROUTE_PROVIDER_ENABLED);
  const research = flagEnabled(env.OUTDOOR_RESEARCH_PLANNING_ENABLED);
  const access = flagEnabled(env.OUTDOOR_ROUTABLE_HIGHLIGHT_ACCESS_ENABLED);
  if (research && !route) invalid();
  if (access && !research) invalid();
  if (flagEnabled(env.OUTDOOR_EVIDENCE_PROVIDER_ENABLED)) {
    requiredPostgresUrl(env.OUTDOOR_EVIDENCE_DATABASE_URL);
  }
}

function validateRuntimeDatabaseRoleSeparation(env) {
  const urls = [requiredPostgresUrl(env.APP_ATTEST_DATABASE_URL)];
  if (flagEnabled(env.OUTDOOR_RESEARCH_PLANNING_ENABLED)) {
    urls.push(
      requiredPostgresUrl(env.OUTDOOR_RESEARCH_DATABASE_URL),
      requiredPostgresUrl(env.OUTDOOR_RESEARCH_CANCELLATION_DATABASE_URL)
    );
  }
  if (flagEnabled(env.OUTDOOR_EVIDENCE_PROVIDER_ENABLED)) {
    urls.push(requiredPostgresUrl(env.OUTDOOR_EVIDENCE_DATABASE_URL));
  }
  if (new Set(urls).size !== urls.length) invalid();
}

function validateReleaseSurface(env) {
  if (env.TRAILMIND_RELEASE_STAGE !== "closed_beta") return;
  if (
    flagEnabled(env.INTENT_PROVIDER_ENABLED) ||
    flagEnabled(env.OUTDOOR_EVIDENCE_PROVIDER_ENABLED)
  ) {
    invalid();
  }
}

function validateIntentProvider(env) {
  const timeoutMs = integer(env.INTENT_PROVIDER_TIMEOUT_MS, 15_000, 1_000, 60_000);
  integer(env.INTENT_PROVIDER_MAX_RESPONSE_BYTES, 65_536, 1_024, 262_144);
  const leaseTtlMs = integer(env.INTENT_GLOBAL_LEASE_TTL_SECONDS, 60, 10, 600) * 1_000;
  if (timeoutMs > leaseTtlMs - 1_000) invalid();
  intentAuthorizationConfiguration(env);
  const provider = env.AI_PROVIDER;
  if (provider === "google") {
    requiredOpaque(env.GOOGLE_API_KEY, 8_192);
    return;
  }
  if (provider === "openrouter") {
    requiredOpaque(env.OPENROUTER_API_KEY, 8_192);
    return;
  }
  invalid();
}

function requestResponseBounds(env) {
  integer(env.ROUTE_MAX_BODY_BYTES, 32_768, 1_024, 262_144);
  integer(env.ROUTE_MAX_DISTANCE_METERS, 200_000, 1_000, 200_000);
  integer(env.OUTDOOR_EVIDENCE_MAX_BODY_BYTES, 131_072, 4_096, 262_144);
  integer(env.OUTDOOR_EVIDENCE_MAX_RESPONSE_BYTES, 524_288, 8_192, 2_097_152);
  integer(env.OUTDOOR_EVIDENCE_MAX_POIS, 40, 1, 100);
  integer(env.OUTDOOR_EVIDENCE_QUERY_TIMEOUT_MS, 2_500, 100, 15_000);
}

function capability(id, value) {
  return Object.freeze({ id, state: flagEnabled(value) ? "enabled" : "disabled" });
}

function exactBooleanFlag(value) {
  if (value !== "true" && value !== "false") invalid();
  return value === "true";
}

function requiredExact(value, expected) {
  if (value !== expected) invalid();
  return value;
}

function requiredEnum(value, allowed) {
  if (typeof value !== "string" || !allowed.has(value)) invalid();
  return value;
}

function requiredPostgresUrl(value) {
  const text = requiredOpaque(value, 8_192);
  let parsed;
  try {
    parsed = new URL(text);
  } catch {
    invalid();
  }
  if (
    !["postgres:", "postgresql:"].includes(parsed.protocol) ||
    !parsed.hostname ||
    /\s/.test(text)
  ) {
    invalid();
  }
  return text;
}

function requiredOpaque(value, maximumLength) {
  if (typeof value !== "string" || value.length < 1 || value.length > maximumLength) invalid();
  return value;
}

function boundedHost(value) {
  if (value === undefined || value === "") return "127.0.0.1";
  if (
    typeof value !== "string" ||
    value.length > 255 ||
    /[\s\/@?#]/.test(value)
  ) {
    invalid();
  }
  return value;
}

function integer(value, fallback, minimum, maximum) {
  if (value === undefined || value === "") return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) invalid();
  return number;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function invalid() {
  throw new TypeError("invalid_production_configuration");
}
