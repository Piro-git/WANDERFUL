import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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
  !["migration_role", "trailmind_v2_admin"].includes(process.env.PGUSER) ||
  !(
    process.env.PGDATABASE === "postgres" ||
    /^trailmind_v2_[0-9]+_[a-z0-9_]+$/.test(
      process.env.PGDATABASE ?? ""
    )
  ) ||
  process.env.PGPASSWORD
) throw new Error("trailmind_disposable_v2_migration_context_invalid");

const backendRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const client = new pg.Client({
  host: process.env.PGHOST,
  port: Number(process.env.PGPORT),
  database: process.env.PGDATABASE,
  user: process.env.PGUSER
});
await client.connect();
try {
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
    migrationDirectory: join(backendRoot, "migrations"),
    migrationPolicy: policy,
    operatorContext,
    migrationPurpose
  });
  for (const version of applied) process.stdout.write(`Applied ${version}\n`);
} finally {
  await client.end();
}
