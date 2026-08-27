import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { runMigrationPolicy } from "../../src/operations/migrationRunner.js";
import {
  issueStagingPhase1V2MigrationCapability
} from "../../src/operations/stagingMigrationCapability.js";
import {
  SUPABASE_POSTGIS_ISOLATION_MIGRATIONS_V2
} from "../../src/operations/stagingMigrationPolicy.js";

if (
  process.env.TRAILMIND_SUPABASE_POSTGIS_ISOLATION_V2_DISPOSABLE !== "true" ||
  !process.env.PGHOST?.startsWith(
    "/private/tmp/trailmind-postgis-isolation-v2."
  ) ||
  !["postgres", "trailmind_v2_admin"].includes(process.env.PGUSER) ||
  !(
    process.env.PGDATABASE === "postgres" ||
    /^trailmind_v2_[0-9]+_[a-z0-9_]+$/.test(
      process.env.PGDATABASE ?? ""
    )
  ) ||
  process.env.PGPASSWORD
) throw new Error("trailmind_disposable_v2_migration_context_invalid");

const backendRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const admittedMigrations = Object.freeze(await Promise.all(
  SUPABASE_POSTGIS_ISOLATION_MIGRATIONS_V2.map(async (version) => {
    const sql = await readFile(join(backendRoot, "migrations", version), "utf8");
    return Object.freeze({
      version,
      sql,
      sha256: createHash("sha256").update(sql).digest("hex")
    });
  })
));
const client = new pg.Client({
  host: process.env.PGHOST,
  port: Number(process.env.PGPORT),
  database: process.env.PGDATABASE,
  user: process.env.PGUSER
});
await client.connect();
let foundationLockHeld = false;
try {
  await client.query(
    "SELECT pg_catalog.pg_advisory_lock(" +
      "pg_catalog.hashtextextended('trailmind-phase-1-foundation', 0))"
  );
  foundationLockHeld = true;
  const policy = Object.freeze({
    policyId: "supabase-postgis-isolation-v2",
    migrations: SUPABASE_POSTGIS_ISOLATION_MIGRATIONS_V2
  });
  const migrationPurpose = process.env.TRAILMIND_DISPOSABLE_MIGRATION_PURPOSE ===
    "verify-noop" ? "verify-noop" : "apply";
  const operatorContext = issueStagingPhase1V2MigrationCapability({
    projectRef: "mbvzwsrtqcrwhvykugcd",
    policyId: policy.policyId,
    purpose: migrationPurpose
  });
  const applied = await runMigrationPolicy({
    client,
    admittedMigrations,
    migrationDirectory: join(backendRoot, "migrations"),
    migrationPolicy: policy,
    operatorContext,
    migrationPurpose
  });
  for (const version of applied) process.stdout.write(`Applied ${version}\n`);
} finally {
  let cleanupError;
  if (foundationLockHeld) {
    try {
      const unlocked = await client.query(
        "SELECT pg_catalog.pg_advisory_unlock(" +
          "pg_catalog.hashtextextended('trailmind-phase-1-foundation', 0)) " +
          "AS unlocked"
      );
      if (unlocked.rows[0]?.unlocked !== true) {
        cleanupError = new Error(
          "trailmind_disposable_foundation_lock_cleanup_failed"
        );
      }
    } catch (error) {
      cleanupError = error;
    }
  }
  await client.end();
  if (cleanupError) throw cleanupError;
}
