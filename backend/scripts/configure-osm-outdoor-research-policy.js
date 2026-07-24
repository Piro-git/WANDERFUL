import pg from "pg";
import { configureOsmProjectionPolicy } from
  "../src/outdoorResearch/postgresOsmProjectionPolicyRepository.js";
import { OsmProjectionError } from "../src/outdoorResearch/osmProjectionPolicy.js";

const { Pool } = pg;

try {
  const args = parseArguments(process.argv.slice(2));
  const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!connectionString) throw new OsmProjectionError("database_url_required");
  validatePostgresURL(connectionString);
  const pool = new Pool({
    connectionString,
    max: 1,
    connectionTimeoutMillis: 10_000,
    allowExitOnIdle: true
  });
  try {
    const summary = await configureOsmProjectionPolicy({
      pool,
      mode: args.mode,
      policyVersion: args.policyVersion,
      operatorConfirmation: args.operatorConfirmation,
      reviewReference: args.reviewReference,
      reviewedAt: args.reviewedAt
    });
    process.stdout.write(`${JSON.stringify(summary)}\n`);
  } finally {
    await pool.end();
  }
} catch (error) {
  const code = error instanceof OsmProjectionError
    ? error.code
    : "policy_configuration_failed";
  process.stderr.write(`${JSON.stringify({
    schemaVersion: 1,
    status: "failed",
    error: { code }
  })}\n`);
  process.exitCode = 1;
}

function parseArguments(values) {
  if (values.length % 2 !== 0) throw new OsmProjectionError("invalid_arguments");
  const parsed = {};
  const allowed = new Set([
    "mode", "policy-version", "operator-confirmation",
    "review-reference", "reviewed-at"
  ]);
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index];
    const value = values[index + 1];
    if (!key?.startsWith("--") || value === undefined) {
      throw new OsmProjectionError("invalid_arguments");
    }
    const name = key.slice(2);
    if (!allowed.has(name) || Object.hasOwn(parsed, name)) {
      throw new OsmProjectionError("invalid_arguments");
    }
    parsed[name] = value;
  }
  if (!parsed.mode || !parsed["policy-version"] ||
      !parsed["operator-confirmation"] || !parsed["review-reference"] ||
      !parsed["reviewed-at"]) {
    throw new OsmProjectionError("required_arguments_missing");
  }
  return Object.freeze({
    mode: parsed.mode,
    policyVersion: parsed["policy-version"],
    operatorConfirmation: parsed["operator-confirmation"],
    reviewReference: parsed["review-reference"],
    reviewedAt: parsed["reviewed-at"]
  });
}

function validatePostgresURL(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new OsmProjectionError("invalid_database_url");
  }
  if (!new Set(["postgres:", "postgresql:"]).has(url.protocol) ||
      !url.hostname || !url.pathname.slice(1)) {
    throw new OsmProjectionError("invalid_database_url");
  }
}
