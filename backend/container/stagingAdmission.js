import { createHash } from "node:crypto";
import {
  applicationSchemaConfiguration,
  OUTDOOR_RESEARCH_CANCELLATION_CONTROL_ROLE,
  OUTDOOR_RESEARCH_RUNTIME_ROLE,
  stagingDatabaseIdentityConfiguration
} from "../src/operations/stagingDatabaseAdmission.js";

const CONTRACT_VERSION = "staging-container-admission-v5-engine-activation";
const OFF_LIMITS_PRODUCTION_PROJECT_REF_SHA256 =
  "730c9715a50e01394edff472b079a0742e6c34159c51329032d0bb8e8d7aa6b7";
const CAPABILITY_FLAGS = Object.freeze([
  "ROUTE_PROVIDER_ENABLED",
  "INTENT_PROVIDER_ENABLED",
  "OUTDOOR_EVIDENCE_PROVIDER_ENABLED",
  "OUTDOOR_RESEARCH_PLANNING_ENABLED",
  "OUTDOOR_ROUTABLE_HIGHLIGHT_ACCESS_ENABLED"
]);
const EXACT_FALSE_FLAGS = Object.freeze([
  "INTENT_PROVIDER_ENABLED",
  "ROUTE_ALLOW_INSECURE_LOCAL_ROUTING",
  "INTENT_ALLOW_INSECURE_LOCAL_PARSING",
  "INTENT_ALLOW_DETERMINISTIC_MOCK",
  "OUTDOOR_RESEARCH_PLANNING_ALLOW_INSECURE_LOCAL",
  "APP_ATTEST_ALLOW_IN_MEMORY"
]);
const FORBIDDEN_WEB_PROCESS_VALUES = Object.freeze([
  "APP_ATTEST_CONTROL_DATABASE_URL",
  "APP_ATTEST_OPERATOR_DATABASE_URL",
  "APP_ATTEST_PRUNER_DATABASE_URL",
  "DATABASE_URL",
  "POSTGRES_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_SECRET_KEY",
  "GOOGLE_API_KEY",
  "OPENROUTER_API_KEY",
  "NODE_OPTIONS",
  "NODE_TLS_REJECT_UNAUTHORIZED",
  "NODE_EXTRA_CA_CERTS",
  "NODE_DEBUG",
  "PGOPTIONS",
  "PGSERVICE",
  "PGSERVICEFILE"
]);
const FORBIDDEN_DATABASE_ROLES = new Set([
  "postgres",
  "service_role",
  "supabase_admin"
]);

export class StagingAdmissionError extends Error {
  constructor(report) {
    super("Staging container admission failed.");
    this.name = "StagingAdmissionError";
    this.code = "staging_admission_blocked";
    this.report = report;
  }
}

export function evaluateStagingContainerEnvironment(env = process.env, options = {}) {
  const checks = [];
  const check = (id, operation) => {
    try {
      operation();
      checks.push(Object.freeze({ id, status: "pass" }));
    } catch {
      checks.push(Object.freeze({ id, status: "fail" }));
    }
  };

  check("production_staging_identity", () => {
    requiredExact(env.NODE_ENV, "production");
    requiredExact(env.TRAILMIND_RELEASE_STAGE, "staging");
  });
  check("bounded_capability_flags", () => {
    for (const name of CAPABILITY_FLAGS) exactBooleanFlag(env[name]);
    for (const name of EXACT_FALSE_FLAGS) requiredExact(env[name], "false");
    if (
      enabled(env.OUTDOOR_RESEARCH_PLANNING_ENABLED) &&
      !enabled(env.ROUTE_PROVIDER_ENABLED)
    ) invalid();
    if (
      enabled(env.OUTDOOR_ROUTABLE_HIGHLIGHT_ACCESS_ENABLED) &&
      !enabled(env.OUTDOOR_RESEARCH_PLANNING_ENABLED)
    ) invalid();
  });
  check("web_process_secret_minimization", () => {
    for (const name of FORBIDDEN_WEB_PROCESS_VALUES) requiredAbsent(env[name]);
  });
  check("node_process_hardening", () => {
    const execArgv = options.execArgv ?? process.execArgv;
    if (!Array.isArray(execArgv) || execArgv.length !== 0) invalid();
  });
  check("least_privilege_staging_database", () => {
    applicationSchemaConfiguration(env);
    const identities = stagingDatabaseIdentityConfiguration(env);
    const expectedProjectHash = requiredSha256(
      env.TRAILMIND_STAGING_PROJECT_REF_SHA256
    );
    if (expectedProjectHash === OFF_LIMITS_PRODUCTION_PROJECT_REF_SHA256) invalid();
    const appSecurity = requiredRuntimeDatabaseUrl(
      env.APP_ATTEST_DATABASE_URL,
      identities.runtimeRole,
      expectedProjectHash
    );
    const databaseUrls = [appSecurity.toString()];
    const researchSecretsPresent = present(env.OUTDOOR_RESEARCH_DATABASE_URL) ||
      present(env.OUTDOOR_RESEARCH_CANCELLATION_DATABASE_URL);
    if (
      enabled(env.OUTDOOR_RESEARCH_PLANNING_ENABLED) ||
      researchSecretsPresent
    ) {
      databaseUrls.push(requiredRuntimeDatabaseUrl(
        env.OUTDOOR_RESEARCH_DATABASE_URL,
        OUTDOOR_RESEARCH_RUNTIME_ROLE,
        expectedProjectHash
      ).toString());
      databaseUrls.push(requiredRuntimeDatabaseUrl(
        env.OUTDOOR_RESEARCH_CANCELLATION_DATABASE_URL,
        OUTDOOR_RESEARCH_CANCELLATION_CONTROL_ROLE,
        expectedProjectHash
      ).toString());
    }
    if (
      enabled(env.OUTDOOR_EVIDENCE_PROVIDER_ENABLED) ||
      present(env.OUTDOOR_EVIDENCE_DATABASE_URL)
    ) {
      const evidence = requiredRuntimeDatabaseUrl(
        env.OUTDOOR_EVIDENCE_DATABASE_URL,
        undefined,
        expectedProjectHash
      );
      databaseUrls.push(evidence.toString());
    }
    if (new Set(databaseUrls).size !== databaseUrls.length) invalid();
  });
  check("provider_secret_scope", () => {
    if (enabled(env.ROUTE_PROVIDER_ENABLED) || present(env.GRAPHHOPPER_API_KEY)) {
      requiredOpaque(env.GRAPHHOPPER_API_KEY);
    }
  });

  return deepFreeze({
    schemaVersion: 1,
    contractVersion: CONTRACT_VERSION,
    decision: checks.every(({ status }) => status === "pass") ? "ready" : "blocked",
    checks,
    capabilities: CAPABILITY_FLAGS.map((name) => ({
      id: name.toLowerCase(),
      state: enabled(env[name]) ? "enabled" : "disabled"
    }))
  });
}

function databaseProjectRef(parsed) {
  const usernameParts = decodeURIComponent(parsed.username).toLowerCase().split(".");
  const hostMatch = parsed.hostname.toLowerCase().match(/^db\.([a-z]{20})\.supabase\.co$/);
  const poolerHost = /^[a-z0-9-]{1,63}\.pooler\.supabase\.com$/.test(
    parsed.hostname.toLowerCase()
  );
  const usernameRef = usernameParts.length > 1 ? usernameParts.at(-1) : undefined;
  if (hostMatch && usernameRef && usernameRef !== hostMatch[1]) return undefined;
  if (!hostMatch && !poolerHost) return undefined;
  const candidate = usernameRef ?? hostMatch?.[1];
  return typeof candidate === "string" && /^[a-z]{20}$/.test(candidate)
    ? candidate
    : undefined;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function assertStagingContainerEnvironment(env = process.env, options = {}) {
  const report = evaluateStagingContainerEnvironment(env, options);
  if (report.decision !== "ready") throw new StagingAdmissionError(report);
  return report;
}

export function stagingAdmissionContract() {
  return deepFreeze({
    contractVersion: CONTRACT_VERSION,
    capabilityFlags: [...CAPABILITY_FLAGS],
    exactFalseFlags: [...EXACT_FALSE_FLAGS],
    forbiddenWebProcessValues: [...FORBIDDEN_WEB_PROCESS_VALUES]
  });
}

function requiredRuntimeDatabaseUrl(value, expectedRole, expectedProjectHash) {
  const parsed = requiredPostgresUrl(value);
  const role = decodeURIComponent(parsed.username).split(".", 1)[0].toLowerCase();
  if (
    !role || (expectedRole !== undefined && role !== expectedRole) ||
    !parsed.password || FORBIDDEN_DATABASE_ROLES.has(role)
  ) invalid();
  const projectRef = databaseProjectRef(parsed);
  if (!projectRef || sha256(projectRef) !== expectedProjectHash) invalid();
  if (parsed.port !== "" && parsed.port !== "5432") invalid();
  if (parsed.pathname !== "/postgres") invalid();
  const rootCertificate = requiredDatabaseSearchParameters(parsed);
  if (!/^\/etc\/secrets\/[a-z0-9_.-]{1,96}\.crt$/.test(rootCertificate ?? "")) invalid();
  return parsed;
}

function requiredPostgresUrl(value) {
  if (typeof value !== "string" || value.length < 1 || value.length > 8_192 || /\s/.test(value)) {
    invalid();
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    invalid();
  }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol) || !parsed.hostname) invalid();
  return parsed;
}

function requiredDatabaseSearchParameters(parsed) {
  const entries = [...parsed.searchParams.entries()];
  if (
    entries.length !== 2 ||
    parsed.searchParams.getAll("sslmode").length !== 1 ||
    parsed.searchParams.get("sslmode") !== "verify-full" ||
    parsed.searchParams.getAll("sslrootcert").length !== 1
  ) invalid();
  return parsed.searchParams.get("sslrootcert");
}

function requiredExact(value, expected) {
  if (value !== expected) invalid();
}

function exactBooleanFlag(value) {
  if (value !== "true" && value !== "false") invalid();
}

function enabled(value) {
  return value === "true";
}

function requiredOpaque(value) {
  if (typeof value !== "string" || value.length < 1 || value.length > 8_192) {
    invalid();
  }
}

function requiredSha256(value) {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) invalid();
  return value;
}

function requiredAbsent(value) {
  if (value !== undefined && value !== "") invalid();
}

function present(value) {
  return value !== undefined && value !== "";
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function invalid() {
  throw new TypeError("invalid_staging_container_environment");
}
