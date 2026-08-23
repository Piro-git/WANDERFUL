import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runAppAttestPrune } from "../src/appAttest/pruneExpired.js";

describe("App Attest pruning command", () => {
  it("prints only fixed aggregate counts for an injected repository", async () => {
    let output = "";
    let closed = false;
    const counts = await runAppAttestPrune({
      repository: {
        pool: { async end() { closed = true; } },
        async pruneExpired() {
          return {
            challenges: 2,
            routeSessions: 3,
            rateWindows: 5,
            providerLeases: 7
          };
        }
      },
      write(value) {
        output += value;
      }
    });
    assert.deepEqual(counts, {
      challenges: 2,
      routeSessions: 3,
      rateWindows: 5,
      providerLeases: 7
    });
    assert.equal(
      output,
      "App Attest prune complete: challenges=2 routeSessions=3 rateWindows=5 providerLeases=7\n"
    );
    assert.equal(closed, false);
  });

  it("closes a command-owned PostgreSQL pool", async () => {
    let closed = false;
    const rowCounts = [1, 2, 3, 4];
    const client = {
      async query(text) {
        if (text === "BEGIN" || text === "COMMIT") return { rowCount: 0, rows: [] };
        return { rowCount: rowCounts.shift(), rows: [] };
      },
      release() {}
    };
    const pool = {
      async connect() {
        return client;
      },
      async query() {
        return { rowCount: 0, rows: [] };
      },
      async end() {
        closed = true;
      }
    };
    await runAppAttestPrune({
      env: { APP_ATTEST_DATABASE_URL: "postgresql://example.invalid/trailmind" },
      pool,
      write() {}
    });
    assert.equal(closed, true);
  });

  it("fails closed without durable database configuration", async () => {
    let output = "";
    await assert.rejects(
      runAppAttestPrune({ env: {}, write(value) { output += value; } }),
      (error) => error.code === "authorization_unavailable"
    );
    assert.equal(output, "");
  });

  it("requires the dedicated App Attest role URL in production", async () => {
    await assert.rejects(
      runAppAttestPrune({
        env: {
          NODE_ENV: "production",
          DATABASE_URL: "postgresql://generic.invalid/trailmind"
        },
        write() {}
      }),
      (error) => error.code === "authorization_unavailable"
    );
  });

  it("does not report success when command-owned pool shutdown fails", async () => {
    let output = "";
    const client = {
      async query(text) {
        return { rowCount: text.startsWith("DELETE") ? 1 : 0, rows: [] };
      },
      release() {}
    };
    const failure = new Error("synthetic pool shutdown failure");
    await assert.rejects(
      runAppAttestPrune({
        env: { APP_ATTEST_DATABASE_URL: "postgresql://example.invalid/trailmind" },
        pool: {
          async connect() {
            return client;
          },
          async query() {
            return { rowCount: 0, rows: [] };
          },
          async end() {
            throw failure;
          }
        },
        write(value) {
          output += value;
        }
      }),
      (error) => error === failure
    );
    assert.equal(output, "");
  });

  it("rejects incomplete count results instead of reporting false success", async () => {
    await assert.rejects(
      runAppAttestPrune({
        repository: {
          async pruneExpired() {
            return { challenges: 1 };
          }
        },
        write() {}
      }),
      (error) => error.code === "authorization_unavailable"
    );
  });
});
