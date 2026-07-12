import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Pool } = pg;
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required.");
const parsed = new URL(connectionString);
if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
  throw new Error("DATABASE_URL must use PostgreSQL.");
}

const pool = new Pool({
  connectionString,
  max: 1,
  connectionTimeoutMillis: 10_000,
  allowExitOnIdle: true
});
const client = await pool.connect();

try {
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended('trailmind-schema-migrations', 0))");
  await client.query(
    `CREATE TABLE IF NOT EXISTS trailmind_schema_migrations (
       version text PRIMARY KEY,
       applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
     )`
  );
  const migrationDirectory = join(root, "migrations");
  const migrations = (await readdir(migrationDirectory))
    .filter((name) => /^\d+_[a-z0-9_]+\.sql$/.test(name))
    .sort();
  for (const version of migrations) {
    const existing = await client.query(
      "SELECT 1 FROM trailmind_schema_migrations WHERE version = $1",
      [version]
    );
    if (existing.rowCount > 0) continue;
    await client.query(await readFile(join(migrationDirectory, version), "utf8"));
    await client.query(
      "INSERT INTO trailmind_schema_migrations (version) VALUES ($1)",
      [version]
    );
    process.stdout.write(`Applied ${version}\n`);
  }
  await client.query("COMMIT");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
