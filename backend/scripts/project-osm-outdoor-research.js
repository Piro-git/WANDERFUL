import pg from "pg";
import { PostgresOsmEvidenceGraphProjector } from
  "../src/outdoorResearch/postgresOsmEvidenceGraphProjector.js";
import {
  OSM_PROJECTION_OPERATOR_CONFIRMATION,
  OsmProjectionError
} from "../src/outdoorResearch/osmProjectionPolicy.js";

const { Pool } = pg;

try {
  const args = parseArguments(process.argv.slice(2));
  const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!connectionString) throw new OsmProjectionError("database_url_required");
  validatePostgresURL(connectionString);
  const pool = new Pool({
    connectionString,
    max: 2,
    connectionTimeoutMillis: 10_000,
    allowExitOnIdle: true
  });
  try {
    const projector = new PostgresOsmEvidenceGraphProjector({ pool });
    const summary = await projector.project({
      regionId: args.region,
      importId: args.importId,
      policyVersion: args.policyVersion,
      operatorConfirmation: args.operatorConfirmation,
      dryRun: args.dryRun
    });
    process.stdout.write(`${JSON.stringify(summary)}\n`);
  } finally {
    await pool.end();
  }
} catch (error) {
  const code = error instanceof OsmProjectionError ? error.code : "projection_failed";
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
    "region", "import-id", "policy-version", "operator-confirmation", "dry-run"
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
  if (!parsed.region || !parsed["policy-version"] ||
      !parsed["operator-confirmation"] || !parsed["dry-run"]) {
    throw new OsmProjectionError("required_arguments_missing");
  }
  if (parsed["operator-confirmation"] !== OSM_PROJECTION_OPERATOR_CONFIRMATION) {
    throw new OsmProjectionError("operator_confirmation_required");
  }
  if (!new Set(["true", "false"]).has(parsed["dry-run"])) {
    throw new OsmProjectionError("invalid_dry_run");
  }
  return Object.freeze({
    region: parsed.region,
    importId: parsed["import-id"],
    policyVersion: parsed["policy-version"],
    operatorConfirmation: parsed["operator-confirmation"],
    dryRun: parsed["dry-run"] === "true"
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
