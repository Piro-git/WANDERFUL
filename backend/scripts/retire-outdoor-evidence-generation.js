import pg from "pg";
import {
  acquireOutdoorCapacityAdmission,
  OutdoorCapacityAdmissionError,
  redactedOutdoorCapacityFailure
} from "../src/outdoorEvidence/outdoorCapacityAdmission.js";

const { Pool } = pg;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONFIRMATION = "RETIRE_SUPERSEDED_OUTDOOR_EVIDENCE_GENERATION_V1";

let pool;
let capacityLease;
try {
  const args = parseArguments(process.argv.slice(2));
  const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!connectionString) throw new Error("database_url_required");
  validatePostgresURL(connectionString);
  pool = new Pool({
    connectionString,
    max: 1,
    connectionTimeoutMillis: 10_000,
    allowExitOnIdle: true
  });
  capacityLease = await acquireOutdoorCapacityAdmission({
    pool,
    profileId: args.profile,
    regionId: args.region,
    operation: "retire",
    importId: args.importId
  });

  const client = capacityLease.client;
  await client.query("BEGIN");
  try {
    await client.query("SET LOCAL statement_timeout = '120s'");
    await client.query("SET LOCAL lock_timeout = '5s'");
    const retired = await client.query(
      `SELECT trailmind_app.retire_superseded_outdoor_generation_v1(
         $1::text, $2::text, $3::text, $4::uuid, $5::uuid, $6::text
       ) AS result`,
      [
        args.profile,
        capacityLease.contract.profileIdentitySha256,
        args.region,
        args.importId,
        args.projectionRunId,
        args.operatorConfirmation
      ]
    );
    if (retired.rowCount !== 1 || !retired.rows[0]?.result) {
      throw new Error("retirement_result_invalid");
    }
    if (args.commit) await client.query("COMMIT");
    else await client.query("ROLLBACK");
    process.stdout.write(`${JSON.stringify({
      schemaVersion: 1,
      status: args.commit ? "committed" : "rolled_back",
      capacityAdmission: capacityLease.summary,
      retirement: retired.rows[0].result
    })}\n`);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  }
} catch (error) {
  if (error instanceof OutdoorCapacityAdmissionError) {
    process.stderr.write(
      `${JSON.stringify(redactedOutdoorCapacityFailure(error))}\n`
    );
  } else {
    process.stderr.write(`${JSON.stringify({
      schemaVersion: 1,
      status: "failed",
      decision: retirementDecision(error)
    })}\n`);
  }
  process.exitCode = 1;
} finally {
  try { await capacityLease?.release(); } catch { process.exitCode = 1; }
  try { await pool?.end(); } catch { process.exitCode = 1; }
}

function parseArguments(values) {
  if (values.length % 2 !== 0) throw new Error("invalid_arguments");
  const allowed = new Set([
    "profile", "region", "import-id", "projection-run-id",
    "operator-confirmation", "commit"
  ]);
  const parsed = {};
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index];
    const value = values[index + 1];
    if (!key?.startsWith("--") || value === undefined) {
      throw new Error("invalid_arguments");
    }
    const name = key.slice(2);
    if (!allowed.has(name) || Object.hasOwn(parsed, name)) {
      throw new Error("invalid_arguments");
    }
    parsed[name] = value;
  }
  if (allowed.size !== Object.keys(parsed).length ||
      parsed.profile !== "supabase-free-bounded-two-core-v1" ||
      !new Set(["harz-v1", "innsbruck-alps-v1"]).has(parsed.region) ||
      !UUID_PATTERN.test(parsed["import-id"] ?? "") ||
      !UUID_PATTERN.test(parsed["projection-run-id"] ?? "") ||
      parsed["operator-confirmation"] !== CONFIRMATION ||
      !new Set(["true", "false"]).has(parsed.commit)) {
    throw new Error("invalid_arguments");
  }
  return Object.freeze({
    profile: parsed.profile,
    region: parsed.region,
    importId: parsed["import-id"],
    projectionRunId: parsed["projection-run-id"],
    operatorConfirmation: parsed["operator-confirmation"],
    commit: parsed.commit === "true"
  });
}

function validatePostgresURL(value) {
  let parsed;
  try { parsed = new URL(value); } catch { throw new Error("invalid_database_url"); }
  if (!new Set(["postgres:", "postgresql:"]).has(parsed.protocol) ||
      !parsed.hostname || !parsed.pathname.slice(1)) {
    throw new Error("invalid_database_url");
  }
}

function retirementDecision(error) {
  if (error?.code === "42501") return "RETIREMENT_DENIED";
  if (error?.code === "55000" || error?.code === "23503") {
    return "GENERATION_STATE_INVALID";
  }
  if (error?.code === "55P03") return "CONCURRENT_OPERATION";
  if (error?.code === "57014") return "RETIREMENT_TIMED_OUT";
  return "RETIREMENT_FAILED";
}
