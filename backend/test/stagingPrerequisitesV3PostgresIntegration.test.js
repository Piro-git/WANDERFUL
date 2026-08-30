import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import pg from "pg";
import {
  AUDITOR_ROLE,
  compileAuditorProvisioningSql,
  compileAuditorRevocationSql,
  runDisposableLocalAuditorSessionProof
} from "../src/operations/stagingPrerequisitesV3/index.js";

const enabled =
  process.env.TRAILMIND_STAGING_PREREQUISITES_V3_POSTGRES_INTEGRATION === "true";
const base = enabled
  ? mkdtempSync("/tmp/trailmind-prereq-v3-postgres-")
  : null;
const data = base ? join(base, "data") : null;
const socket = base ? join(base, "socket") : null;
const port = 56_000 + process.pid % 1_000;
let admin;
let started = false;

describe("staging prerequisites v3 on disposable PostgreSQL 17/PostGIS", {
  skip: enabled ? false : "set the isolated local PostgreSQL integration gate"
}, () => {
  before(async () => {
    chmodSync(base, 0o700);
    mkdirSync(socket, { mode: 0o700 });
    execFileSync("initdb", [
      "-D", data, "-A", "trust", "--no-locale", "--encoding=UTF8"
    ], { stdio: "ignore", timeout: 30_000 });
    execFileSync("pg_ctl", [
      "-D", data, "-o", `-k ${socket} -p ${port} -h ''`, "-w", "start"
    ], { stdio: "ignore", timeout: 30_000 });
    started = true;
    admin = new pg.Client({ database: "postgres", host: socket, port });
    await admin.connect();
    await admin.query("CREATE EXTENSION postgis");
    await admin.query("REVOKE TEMPORARY ON DATABASE postgres FROM PUBLIC");
    await admin.query("CREATE ROLE trailmind_app_owner NOLOGIN");
    await admin.query("CREATE SCHEMA trailmind_app AUTHORIZATION trailmind_app_owner");
    await admin.query(`
      CREATE TABLE trailmind_app.trailmind_schema_migrations (
        version text PRIMARY KEY,
        applied_at timestamptz NOT NULL
      )
    `);
    await admin.query(`
      ALTER TABLE trailmind_app.trailmind_schema_migrations
      OWNER TO trailmind_app_owner
    `);
    await admin.query(`
      INSERT INTO trailmind_app.trailmind_schema_migrations(version, applied_at)
      SELECT '00' || value::text, clock_timestamp() + value * interval '1 ms'
        FROM pg_catalog.generate_series(1, 8) value
    `);
  });

  after(async () => {
    await admin?.end();
    if (started) {
      execFileSync("pg_ctl", ["-D", data, "-m", "fast", "-w", "stop"], {
        stdio: "ignore",
        timeout: 30_000
      });
    }
    if (base?.startsWith("/tmp/trailmind-prereq-v3-postgres-")) {
      rmSync(base, { force: true, recursive: true });
    }
  });

  it("provisions once, fails duplicate-safe, proves independent cleanup, and revokes", async () => {
    const clock = new Date();
    const validUntil = new Date(clock.getTime() + 60 * 60 * 1_000).toISOString();
    const provisioning = compileAuditorProvisioningSql({
      now: () => clock,
      validUntil
    });
    await admin.query(provisioning);
    await assert.rejects(admin.query(provisioning));
    await admin.query("ROLLBACK");

    const directRead = new pg.Client({
      application_name: `trailmind_p1v2_auditor_${"e".repeat(32)}`,
      database: "postgres",
      host: socket,
      port,
      user: AUDITOR_ROLE
    });
    await directRead.connect();
    await assert.rejects(directRead.query(
      "SELECT * FROM trailmind_app.trailmind_schema_migrations"
    ));
    const boundedLedger = await directRead.query(
      "SELECT * FROM trailmind_app.trailmind_auditor_migration_ledger_v1()"
    );
    assert.equal(boundedLedger.rowCount, 8);
    await directRead.end();

    let suffix = 0;
    const proof = await runDisposableLocalAuditorSessionProof({
      createConnection: ({ applicationName }) => new pg.Client({
        application_name: applicationName,
        database: "postgres",
        host: socket,
        port,
        user: AUDITOR_ROLE
      }),
      randomHex: () => String(++suffix).padStart(32, "0")
    });
    assert.equal(proof.sessionCount, 3);
    assert.equal(proof.authorizationEligible, false);
    assert(proof.cleanupObservations.every(({ zeroLeak }) => zeroLeak));

    const auditor = new pg.Client({
      application_name: `trailmind_p1v2_auditor_${"f".repeat(32)}`,
      database: "postgres",
      host: socket,
      port,
      user: AUDITOR_ROLE
    });
    await auditor.connect();
    await assert.rejects(auditor.query("CREATE TABLE forbidden(id integer)"));
    await auditor.end();

    await admin.query(compileAuditorRevocationSql());
    const role = await admin.query(
      "SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = $1",
      [AUDITOR_ROLE]
    );
    assert.equal(role.rowCount, 0);
  });
});
