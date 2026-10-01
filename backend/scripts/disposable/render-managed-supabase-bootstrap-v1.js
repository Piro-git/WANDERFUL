import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertManagedSupabaseBootstrapTarget,
  renderManagedSupabaseBootstrapSql
} from "../../src/operations/stagingManagedSupabaseBootstrap.js";
import { STAGING_PHASE1_V2_TARGET } from "../../src/operations/stagingPhase1V2Operator.js";
import {
  SUPABASE_POSTGIS_ISOLATION_MIGRATIONS_V2
} from "../../src/operations/stagingMigrationPolicy.js";

const backendRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const repositoryRoot = dirname(backendRoot);
const options = parseArguments(process.argv.slice(2));
const target = Object.freeze({
  projectRef: STAGING_PHASE1_V2_TARGET.projectRef,
  projectName: STAGING_PHASE1_V2_TARGET.projectName,
  organizationId: STAGING_PHASE1_V2_TARGET.organizationId,
  region: STAGING_PHASE1_V2_TARGET.region,
  status: STAGING_PHASE1_V2_TARGET.status,
  databaseName: "postgres",
  postgresMajor: STAGING_PHASE1_V2_TARGET.postgresMajor
});
assertManagedSupabaseBootstrapTarget(target);

const preMigrationSql = await readFile(join(
  repositoryRoot,
  "docs/operations/staging-v1/database/PHASE_1_PRE_MIGRATION_V2.sql"
), "utf8");
const postMigrationSql = await readFile(join(
  repositoryRoot,
  "docs/operations/staging-v1/database/PHASE_1_POST_MIGRATION_V2.sql"
), "utf8");
const admittedMigrations = await Promise.all(
  SUPABASE_POSTGIS_ISOLATION_MIGRATIONS_V2.map(async (version) => {
    const sql = await readFile(join(backendRoot, "migrations", version), "utf8");
    return Object.freeze({ version, sql, sha256: sha256(sql) });
  })
);
const runId = options.runId ?? randomUUID();
const operatorDigestsDigest = sha256(JSON.stringify({
  preMigration: sha256(preMigrationSql),
  postMigration: sha256(postMigrationSql),
  migrations: admittedMigrations.map(({ version, sha256 }) =>
    ({ version, sha256 }))
}));
const authorizationBindingDigest = sha256(JSON.stringify({
  authorization: "explicit-user-authorized-managed-bootstrap-v1",
  candidateCommit: options.candidateCommit,
  candidateTree: options.candidateTree,
  projectRef: target.projectRef,
  runId
}));

process.stdout.write(renderManagedSupabaseBootstrapSql({
  target,
  preMigrationSql,
  postMigrationSql,
  admittedMigrations,
  binding: {
    runId,
    authorizationBindingDigest,
    candidateCommit: options.candidateCommit,
    candidateTree: options.candidateTree,
    operatorDigestsDigest,
    providerAclRestorePlanDigest: options.providerAclRestorePlanDigest
  }
}));

function parseArguments(values) {
  const options = {};
  for (let index = 0; index < values.length; index += 2) {
    const name = values[index];
    const value = values[index + 1];
    if (name === "--candidate-commit") options.candidateCommit = value;
    else if (name === "--candidate-tree") options.candidateTree = value;
    else if (name === "--provider-acl-digest") {
      options.providerAclRestorePlanDigest = value;
    } else if (name === "--run-id") options.runId = value;
    else throw new Error("trailmind_managed_bootstrap_arguments_rejected");
  }
  return options;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
