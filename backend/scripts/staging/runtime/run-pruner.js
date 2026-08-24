import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runAppAttestPrune } from "../../../src/appAttest/pruneExpired.js";
import { createOperationalLogger } from "../../../src/operations/operationalEvents.js";

const OFF_LIMITS_PRODUCTION_PROJECT_REF_SHA256 =
  "730c9715a50e01394edff472b079a0742e6c34159c51329032d0bb8e8d7aa6b7";

export async function runStagingPruner(options = {}) {
  const env = options.env ?? process.env;
  const logger = options.logger ?? createOperationalLogger(options.loggerOptions);
  assertCleanProcessEnvironment(env, options.execArgv ?? process.execArgv);
  const runtimeRole = validatedRoleName(env.APP_ATTEST_RUNTIME_ROLE);
  const controlRole = validatedRoleName(env.APP_ATTEST_CONTROL_ROLE);
  if (runtimeRole === controlRole) throw new TypeError("pruner_role_alias");
  const projectHash = validatedProjectHash(env.TRAILMIND_STAGING_PROJECT_REF_SHA256);
  const controlUrl = validatedControlUrl(
    env.APP_ATTEST_CONTROL_DATABASE_URL,
    controlRole,
    projectHash
  );
  if (env.APP_ATTEST_DATABASE_URL !== undefined && env.APP_ATTEST_DATABASE_URL !== "") {
    throw new TypeError("pruner_runtime_source_forbidden");
  }
  const pruneEnv = {
    ...env,
    APP_ATTEST_DATABASE_URL: pinnedSearchPathUrl(controlUrl)
  };
  delete pruneEnv.APP_ATTEST_CONTROL_DATABASE_URL;
  try {
    const counts = await (options.runPrune ?? runAppAttestPrune)({
      env: pruneEnv,
      write() {}
    });
    logger.info({ event: "prune_job_completed", outcome: "succeeded" });
    return counts;
  } catch (error) {
    logger.error({ event: "prune_job_completed", outcome: "failed" });
    throw error;
  }
}

function validatedControlUrl(value, expectedRole, expectedProjectHash) {
  if (typeof value !== "string" || value.length < 1 || value.length > 8_192 || /\s/.test(value)) {
    throw new TypeError("pruner_configuration_invalid");
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new TypeError("pruner_configuration_invalid");
  }
  const role = decodeURIComponent(parsed.username).split(".", 1)[0].toLowerCase();
  const projectRef = databaseProjectRef(parsed);
  if (
    !["postgres:", "postgresql:"].includes(parsed.protocol) ||
    !parsed.hostname || !role || role !== expectedRole || !parsed.password ||
    ["postgres", "service_role", "supabase_admin"].includes(role) ||
    !projectRef || expectedProjectHash === OFF_LIMITS_PRODUCTION_PROJECT_REF_SHA256 ||
    sha256(projectRef) !== expectedProjectHash ||
    (parsed.port !== "" && parsed.port !== "5432") ||
    parsed.pathname !== "/postgres" ||
    !hasExactDatabaseSearchParameters(parsed) ||
    !/^\/etc\/secrets\/[a-z0-9_.-]{1,96}\.crt$/.test(
      parsed.searchParams.get("sslrootcert") ?? ""
    )
  ) {
    throw new TypeError("pruner_configuration_invalid");
  }
  return value;
}

function hasExactDatabaseSearchParameters(parsed) {
  const entries = [...parsed.searchParams.entries()];
  return (
    entries.length === 2 &&
    parsed.searchParams.getAll("sslmode").length === 1 &&
    parsed.searchParams.get("sslmode") === "verify-full" &&
    parsed.searchParams.getAll("sslrootcert").length === 1
  );
}

function validatedRoleName(value) {
  if (typeof value !== "string" || !/^[a-z_][a-z0-9_]{0,62}$/.test(value)) {
    throw new TypeError("pruner_configuration_invalid");
  }
  return value;
}

function validatedProjectHash(value) {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) {
    throw new TypeError("pruner_configuration_invalid");
  }
  return value;
}

function assertCleanProcessEnvironment(env, execArgv) {
  if (env.NODE_ENV !== "production" || env.TRAILMIND_RELEASE_STAGE !== "staging") {
    throw new TypeError("pruner_configuration_invalid");
  }
  for (const name of [
    "NODE_OPTIONS", "NODE_TLS_REJECT_UNAUTHORIZED", "NODE_EXTRA_CA_CERTS",
    "NODE_DEBUG", "PGOPTIONS", "PGSERVICE", "PGSERVICEFILE"
  ]) {
    if (env[name] !== undefined && env[name] !== "") {
      throw new TypeError("pruner_configuration_invalid");
    }
  }
  if (!Array.isArray(execArgv) || execArgv.length !== 0) {
    throw new TypeError("pruner_configuration_invalid");
  }
}

function pinnedSearchPathUrl(value) {
  const parsed = new URL(value);
  parsed.searchParams.set("options", "-c search_path=pg_catalog,public");
  return parsed.toString();
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

const isMain =
  typeof process.argv[1] === "string" &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  runStagingPruner().catch(() => { process.exitCode = 1; });
}
