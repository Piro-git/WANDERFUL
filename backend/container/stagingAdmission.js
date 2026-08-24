import { createHash } from "node:crypto";

const CONTRACT_VERSION = "staging-container-admission-v1";
const OFF_LIMITS_PRODUCTION_PROJECT_REF_SHA256 =
  "730c9715a50e01394edff472b079a0742e6c34159c51329032d0bb8e8d7aa6b7";
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
const FORBIDDEN_WEB_PROCESS_VALUES = Object.freeze([
  "APP_ATTEST_CONTROL_DATABASE_URL",
  "APP_ATTEST_PRUNER_DATABASE_URL",
  "DATABASE_URL",
  "POSTGRES_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_SECRET_KEY",
  "GRAPHHOPPER_API_KEY",
  "GOOGLE_API_KEY",
  "OPENROUTER_API_KEY",
  "OUTDOOR_RESEARCH_DATABASE_URL",
  "OUTDOOR_RESEARCH_CANCELLATION_DATABASE_URL",
  "OUTDOOR_EVIDENCE_DATABASE_URL",
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
  check("all_capabilities_disabled", () => {
    for (const name of EXACT_FALSE_FLAGS) requiredExact(env[name], "false");
  });
  check("web_process_secret_minimization", () => {
    for (const name of FORBIDDEN_WEB_PROCESS_VALUES) requiredAbsent(env[name]);
  });
  check("node_process_hardening", () => {
    const execArgv = options.execArgv ?? process.execArgv;
    if (!Array.isArray(execArgv) || execArgv.length !== 0) invalid();
  });
  check("least_privilege_staging_database", () => {
    const parsed = requiredPostgresUrl(env.APP_ATTEST_DATABASE_URL);
    const role = decodeURIComponent(parsed.username).split(".", 1)[0].toLowerCase();
    const expectedRole = requiredRoleName(env.APP_ATTEST_RUNTIME_ROLE);
    if (
      !role || role !== expectedRole || !parsed.password ||
      FORBIDDEN_DATABASE_ROLES.has(role)
    ) invalid();
    const projectRef = databaseProjectRef(parsed);
    const expectedProjectHash = requiredSha256(
      env.TRAILMIND_STAGING_PROJECT_REF_SHA256
    );
    if (
      !projectRef || expectedProjectHash === OFF_LIMITS_PRODUCTION_PROJECT_REF_SHA256 ||
      sha256(projectRef) !== expectedProjectHash
    ) invalid();
    if (parsed.port !== "" && parsed.port !== "5432") invalid();
    if (parsed.pathname !== "/postgres") invalid();
    const rootCertificate = requiredDatabaseSearchParameters(parsed);
    if (!/^\/etc\/secrets\/[a-z0-9_.-]{1,96}\.crt$/.test(rootCertificate ?? "")) invalid();
  });

  return deepFreeze({
    schemaVersion: 1,
    contractVersion: CONTRACT_VERSION,
    decision: checks.every(({ status }) => status === "pass") ? "ready" : "blocked",
    checks,
    capabilities: EXACT_FALSE_FLAGS.slice(0, 5).map((name) => ({
      id: name.toLowerCase(),
      state: "disabled"
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
    exactFalseFlags: [...EXACT_FALSE_FLAGS],
    forbiddenWebProcessValues: [...FORBIDDEN_WEB_PROCESS_VALUES]
  });
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

function requiredRoleName(value) {
  if (typeof value !== "string" || !/^[a-z_][a-z0-9_]{0,62}$/.test(value)) invalid();
  return value;
}

function requiredSha256(value) {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) invalid();
  return value;
}

function requiredAbsent(value) {
  if (value !== undefined && value !== "") invalid();
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
