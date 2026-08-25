import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { runMigrationPolicy } from "../src/operations/migrationRunner.js";
import {
  issueStagingPhase1V2MigrationCapability
} from "../src/operations/stagingMigrationCapability.js";
import {
  SUPABASE_POSTGIS_ISOLATION_MIGRATIONS_V2
} from "../src/operations/stagingMigrationPolicy.js";

const policy = Object.freeze({
  policyId: "supabase-postgis-isolation-v2",
  migrations: SUPABASE_POSTGIS_ISOLATION_MIGRATIONS_V2
});
const fixedNow = new Date("2026-08-25T08:00:00.000Z");

describe("sealed Supabase V2 migration capability", () => {
  it("rejects a missing context before file or database access", async () => {
    const calls = [];
    await assert.rejects(runMigrationPolicy({
      client: { query: async () => calls.push("database") },
      migrationDirectory: "/must-not-be-read",
      migrationPolicy: policy,
      fileAccess: async () => calls.push("file"),
      fileRead: async () => calls.push("read"),
      now: () => fixedNow
    }), /operator_context_invalid/);
    assert.deepEqual(calls, []);
  });

  it("is single-use, short-lived, identity-bound, and non-serializing", async () => {
    const context = issueStagingPhase1V2MigrationCapability({
      projectRef: "mbvzwsrtqcrwhvykugcd",
      policyId: policy.policyId,
      purpose: "apply",
      now: () => fixedNow
    });
    assert.equal(JSON.stringify(context), "{}");
    const calls = [];
    await assert.rejects(runMigrationPolicy({
      client: { query: async () => { calls.push("database"); throw new Error("stop"); } },
      migrationDirectory: "/disposable",
      migrationPolicy: policy,
      operatorContext: context,
      migrationPurpose: "apply",
      fileAccess: async () => calls.push("file"),
      fileRead: async () => "SELECT 1",
      now: () => fixedNow
    }), /stop/);
    assert.equal(calls.filter((call) => call === "file").length, 8);
    const beforeReuse = calls.length;
    await assert.rejects(runMigrationPolicy({
      client: { query: async () => calls.push("database") },
      migrationDirectory: "/disposable",
      migrationPolicy: policy,
      operatorContext: context,
      migrationPurpose: "apply",
      fileAccess: async () => calls.push("file"),
      fileRead: async () => "SELECT 1",
      now: () => fixedNow
    }), /operator_context_invalid/);
    assert.equal(calls.length, beforeReuse);

    const expired = issueStagingPhase1V2MigrationCapability({
      projectRef: "mbvzwsrtqcrwhvykugcd",
      policyId: policy.policyId,
      purpose: "verify-noop",
      now: () => fixedNow
    });
    await assert.rejects(runMigrationPolicy({
      client: { query: async () => calls.push("database") },
      migrationDirectory: "/disposable",
      migrationPolicy: policy,
      operatorContext: expired,
      migrationPurpose: "verify-noop",
      fileAccess: async () => calls.push("file"),
      fileRead: async () => "SELECT 1",
      now: () => new Date(fixedNow.getTime() + 30_001)
    }), /operator_context_invalid/);
  });

  it("rejects a purpose mismatch before filesystem or database access", async () => {
    const context = issueStagingPhase1V2MigrationCapability({
      projectRef: "mbvzwsrtqcrwhvykugcd",
      policyId: policy.policyId,
      purpose: "verify-noop",
      now: () => fixedNow
    });
    const calls = [];
    await assert.rejects(runMigrationPolicy({
      client: { query: async () => calls.push("database") },
      migrationDirectory: "/must-not-be-read",
      migrationPolicy: policy,
      operatorContext: context,
      migrationPurpose: "apply",
      fileAccess: async () => calls.push("file"),
      fileRead: async () => calls.push("read"),
      now: () => fixedNow
    }), /context_purpose_invalid/);
    assert.deepEqual(calls, []);
  });

  it("rejects issuance for every non-target identity or purpose", () => {
    for (const override of [
      { projectRef: "bejvhhjbgtvctpsnlwid" },
      { policyId: "historical-portable-v1" },
      { purpose: "resume" }
    ]) {
      assert.throws(() => issueStagingPhase1V2MigrationCapability({
        projectRef: "mbvzwsrtqcrwhvykugcd",
        policyId: policy.policyId,
        purpose: "apply",
        now: () => fixedNow,
        ...override
      }), /context_issue_invalid/);
    }
  });

  it("keeps the shipped Supabase Phase 1 command disabled without a live adapter", async () => {
    const packageJson = JSON.parse(await readFile(
      new URL("../package.json", import.meta.url),
      "utf8"
    ));
    assert.equal(
      packageJson.scripts["db:migrate:supabase-postgis-isolation-v2"],
      "node scripts/staging/phase1-v2-operator.js"
    );
    const result = spawnSync(process.execPath, [
      "scripts/staging/phase1-v2-operator.js"
    ], {
      cwd: new URL("..", import.meta.url),
      env: { PATH: process.env.PATH, LANG: "C", LC_ALL: "C" },
      encoding: "utf8"
    });
    assert.notEqual(result.status, 0);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /remote_adapter_required_and_execution_not_authorized/);
    assert.doesNotMatch(result.stderr, /postgres(?:ql)?:\/\//i);
  });
});
