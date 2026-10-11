import test from "node:test";
import assert from "node:assert/strict";
import { libpqEnvironment } from "../src/outdoorEvidence/libpqEnvironment.js";
test("TCP endpoint remains unchanged", () => {
  const env = libpqEnvironment(new URL("postgresql://reader:abc@db.example:5433/pilot?sslmode=require"));
  assert.equal(env.PGHOST, "db.example"); assert.equal(env.PGPORT, "5433"); assert.equal(env.PGSSLMODE, "require");
});
test("socket override survives to osm2pgsql without inherited credentials", () => {
  const env = libpqEnvironment(new URL("postgresql://reader@localhost:55439/pilot?host=%2Fprivate%2Ftmp%2Fpilot%2Fsocket&sslmode=disable"));
  assert.equal(env.PGHOST, "/private/tmp/pilot/socket"); assert.equal(env.PGPASSWORD, "");
});
test("ambiguous or network host override is rejected", () => {
  for (const host of ["remote.example", "/tmp/a,/tmp/b", ""]) {
    assert.throws(() => libpqEnvironment(new URL(`postgresql://reader@localhost/pilot?host=${encodeURIComponent(host)}`)));
  }
});
