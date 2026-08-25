import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { runMigrationPolicy } from "../src/operations/migrationRunner.js";
import { requiredMigrationPolicy } from "../src/operations/stagingMigrationPolicy.js";

const { Pool } = pg;
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const migrationPolicy = requiredMigrationPolicy();
if (migrationPolicy.policyId === "supabase-postgis-isolation-v2") {
  throw new Error("trailmind_supabase_v2_operator_required");
}
const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (connectionString) {
  const parsed = new URL(connectionString);
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error("DATABASE_URL or POSTGRES_URL must use PostgreSQL.");
  }
} else if (![
  process.env.PGHOST,
  process.env.PGPORT,
  process.env.PGDATABASE,
  process.env.PGUSER
].every((value) => typeof value === "string" && value.length > 0)) {
  throw new Error("PostgreSQL connection environment is required.");
}

const pool = new Pool({
  ...(connectionString ? { connectionString } : {}),
  max: 1,
  connectionTimeoutMillis: 10_000,
  allowExitOnIdle: true
});
const client = await pool.connect();

try {
  const migrationDirectory = join(root, "migrations");
  const newlyApplied = await runMigrationPolicy({
    client,
    migrationDirectory,
    migrationPolicy
  });
  for (const version of newlyApplied) process.stdout.write(`Applied ${version}\n`);
} finally {
  client.release();
  await pool.end();
}
