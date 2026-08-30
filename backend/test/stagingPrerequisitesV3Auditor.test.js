import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ASSERTION_IDS,
  compileAuditorProvisioningSql,
  compileAuditorRevocationSql,
  compileExpectedManifest,
  runIndependentAuditorSessionProof
} from "../src/operations/stagingPrerequisitesV3/index.js";

describe("staging prerequisites v3 auditor lifecycle", () => {
  it("generates deterministic password-free, read-only, least-privilege SQL", () => {
    const now = () => new Date("2026-08-30T12:00:00.000Z");
    const first = compileAuditorProvisioningSql({
      now,
      validUntil: "2026-08-30T13:00:00.000Z"
    });
    const second = compileAuditorProvisioningSql({
      now,
      validUntil: "2026-08-30T13:00:00.000Z"
    });
    assert.equal(first, second);
    assert.match(first, /LOGIN PASSWORD NULL/);
    assert.match(first, /default_transaction_read_only = 'on'/);
    assert.match(first, /NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE/);
    assert.match(first, /WITH ADMIN FALSE, INHERIT FALSE, SET TRUE/);
    assert.match(first, /trailmind_auditor_migration_ledger_v1/);
    assert.match(first, /LIMIT 10/);
    assert.match(first, /GRANT EXECUTE ON FUNCTION/);
    assert.doesNotMatch(first, /GRANT SELECT/);
    assert.doesNotMatch(first, /(?:secret|actual-password|REASSIGN OWNED)/i);
    assert.throws(() => compileAuditorProvisioningSql({
      now,
      validUntil: "2026-08-30T15:00:00.000Z"
    }), hasCode("auditor_expiry_window"));
  });

  it("commits quarantine before guarded drop and never conceals ownership", () => {
    const sql = compileAuditorRevocationSql();
    const quarantine = sql.indexOf("NOLOGIN PASSWORD NULL");
    const firstCommit = sql.indexOf("COMMIT;", quarantine);
    const dropGuard = sql.indexOf("trailmind_auditor_drop_guard");
    const drop = sql.indexOf("DROP ROLE", dropGuard);
    assert(quarantine >= 0 && firstCommit > quarantine && dropGuard > firstCommit &&
      drop > dropGuard);
    assert.doesNotMatch(sql, /REASSIGN OWNED|DROP OWNED/);
    assert.match(sql, /DROP FUNCTION IF EXISTS/);
  });

  it("uses a primary session plus two distinct fresh cleanup sessions", async () => {
    const expectedManifest = compileExpectedManifest({ repositoryRoot: ".." }).manifest;
    const clients = [];
    let nextPid = 100;
    const suffixes = ["1".repeat(32), "2".repeat(32), "3".repeat(32)];
    const times = [0n, 250_000_000n];
    const proof = await runIndependentAuditorSessionProof({
      createConnection: ({ applicationName }) => {
        const client = mockClient({ applicationName, backendPid: nextPid++ });
        clients.push(client);
        return client;
      },
      expectedManifest,
      monotonicNowNanoseconds: () => times.shift(),
      randomHex: () => suffixes.shift(),
      wait: async () => {}
    });
    assert.equal(proof.status, "pass");
    assert.equal(proof.sessionCount, 3);
    assert.equal(proof.cleanupObservations.length, 2);
    assert.equal(clients.length, 3);
    assert(clients.every(({ ended }) => ended));
    assert.equal(new Set(clients.map(({ backendPid }) => backendPid)).size, 3);
  });

  it("blocks same-session reuse and any cleanup observation row", async () => {
    const expectedManifest = compileExpectedManifest({ repositoryRoot: ".." }).manifest;
    const reused = mockClient({
      applicationName: `trailmind_p1v2_auditor_${"1".repeat(32)}`,
      backendPid: 200
    });
    let count = 0;
    await assert.rejects(runIndependentAuditorSessionProof({
      createConnection: ({ applicationName }) => {
        reused.applicationName = applicationName;
        reused.backendPid = 200 + count++;
        return reused;
      },
      expectedManifest,
      monotonicNowNanoseconds: () => 0n,
      randomHex: sequentialSuffix(),
      wait: async () => {}
    }), hasCode("independent_connection"));

    let pid = 300;
    await assert.rejects(runIndependentAuditorSessionProof({
      createConnection: ({ applicationName }) => mockClient({
        applicationName,
        backendPid: pid++,
        leak: pid === 302
      }),
      expectedManifest,
      monotonicNowNanoseconds: (() => {
        const values = [0n, 250_000_000n];
        return () => values.shift();
      })(),
      randomHex: sequentialSuffix(),
      wait: async () => {}
    }), (error) => error?.status === "blocked");
  });
});

function mockClient({ applicationName, backendPid, leak = false }) {
  return {
    applicationName,
    backendPid,
    connected: false,
    ended: false,
    async connect() {
      this.connected = true;
    },
    async end() {
      this.ended = true;
    },
    async query(request) {
      if (typeof request === "object" &&
          request.name === "trailmind-staging-prerequisites-v3-cleanup-v1") {
        return { rows: leak ? [{ pid: 999 }] : [] };
      }
      if (typeof request === "object" &&
          request.name === "trailmind-staging-prerequisites-v3-catalog-v1") {
        return { rows: ASSERTION_IDS.map((id) => ({ id, pass: true })) };
      }
      if (typeof request === "string" && request.includes("pg_current_snapshot")) {
        return { rows: [{
          application_name: this.applicationName,
          backend_pid: this.backendPid,
          current_user: "trailmind_phase1_v2_stats_auditor",
          session_user: "trailmind_phase1_v2_stats_auditor",
          snapshot_id: `${this.backendPid}:${this.backendPid}:`
        }] };
      }
      return { rows: [] };
    }
  };
}

function sequentialSuffix() {
  const suffixes = ["4".repeat(32), "5".repeat(32), "6".repeat(32)];
  return () => suffixes.shift();
}

function hasCode(code) {
  return (error) => error?.code === code;
}
