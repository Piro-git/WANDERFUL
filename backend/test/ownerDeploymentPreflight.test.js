import test from "node:test";
import assert from "node:assert/strict";
import { inspectOwnerDeployment } from "../owner-container/preflight.js";

const fixture = () => ({
  NODE_ENV: "production", OWNER_ACCESS_ENABLED: "true",
  OWNER_ACCESS_ORIGIN: "https://owner.example.com",
  OWNER_ACCESS_DATABASE_URL: "postgresql://wanderful_owner_runtime:fixture-only@db.example.com:5432/postgres",
  OWNER_ACCESS_DATABASE_CA_FILE: "/etc/secrets/owner-database-ca.crt",
  OWNER_ACCESS_ROUTE_DAILY_LIMIT: "2", OWNER_ACCESS_INTENT_DAILY_LIMIT: "1",
  OWNER_ACCESS_GLOBAL_ROUTE_DAILY_LIMIT: "2", OWNER_ACCESS_GLOBAL_INTENT_DAILY_LIMIT: "1",
  AI_PROVIDER: "google", GOOGLE_MODEL: "gemini-test",
  OWNER_ACCESS_MAX_CONCURRENCY: "1", GOOGLE_API_KEY: "fixture-google", GRAPHHOPPER_API_KEY: "fixture-route"
});
const readable = { access: async () => {} };
test("deployment preflight succeeds without claiming a live connection or provider call", async () => {
  const result = await inspectOwnerDeployment(fixture(), readable);
  assert.equal(result.readyForRuntimeAdmission, true);
  assert.equal(result.liveDatabaseVerified, false);
  assert.equal(result.providersCalled, false);
});
test("missing configuration fails closed without exposing values", async () => {
  const result = await inspectOwnerDeployment({});
  assert.equal(result.readyForRuntimeAdmission, false);
  assert.ok(result.issues.includes("owner_access_not_enabled"));
  assert.ok(result.issues.includes("database_connection_required"));
});
test("temporary origin and unreadable CA cannot pass preflight", async () => {
  const env = fixture(); env.OWNER_ACCESS_ORIGIN = "https://temporary.trycloudflare.com";
  const result = await inspectOwnerDeployment(env, { access: async () => { throw new Error("private detail"); } });
  assert.ok(result.issues.includes("stable_https_origin_required"));
  assert.ok(result.issues.includes("database_ca_file_unreadable"));
  assert.equal(JSON.stringify(result).includes("private detail"), false);
});
test("invalid URL credentials and unlimited budgets do not leak secrets", async () => {
  const env = fixture(); env.OWNER_ACCESS_DATABASE_URL = "SECRET-CONNECTION-VALUE";
  env.OWNER_ACCESS_GLOBAL_ROUTE_DAILY_LIMIT = "Infinity";
  const result = await inspectOwnerDeployment(env, readable);
  assert.equal(result.readyForRuntimeAdmission, false);
  assert.equal(JSON.stringify(result).includes("SECRET-CONNECTION-VALUE"), false);
  assert.equal(JSON.stringify(result).includes("fixture-google"), false);
});

test("model and daily allowance must match runtime bounds", async () => {
  const env = fixture();
  delete env.GOOGLE_MODEL;
  env.OWNER_ACCESS_ROUTE_DAILY_LIMIT = "101";
  const result = await inspectOwnerDeployment(env, readable);
  assert.ok(result.issues.includes("google_model_required"));
  assert.ok(result.issues.includes("owner_access_route_daily_limit_required"));
  env.GOOGLE_MODEL = "gemini-test";
  env.OWNER_ACCESS_ROUTE_DAILY_LIMIT = "100";
  assert.equal((await inspectOwnerDeployment(env, readable)).readyForRuntimeAdmission, true);
});
test("connection query options and database owner credentials are rejected", async () => {
  for (const url of ["postgresql://postgres:fixture@db.example.com/postgres",
    "postgresql://wanderful_owner_runtime:fixture@db.example.com/postgres?sslmode=disable"]) {
    const env = fixture(); env.OWNER_ACCESS_DATABASE_URL = url;
    assert.ok((await inspectOwnerDeployment(env, readable)).issues.includes("database_connection_required"));
  }
});

test("session pooler admission uses the shared runtime validator", async () => {
  const env = fixture();
  env.OWNER_ACCESS_SUPABASE_PROJECT_REF = "abcdefghijklmnopqrst";
  env.OWNER_ACCESS_DATABASE_URL = "postgresql://wanderful_owner_runtime.abcdefghijklmnopqrst:fixture@aws-0-eu-central-1.pooler.supabase.com:5432/postgres";
  assert.equal((await inspectOwnerDeployment(env, readable)).readyForRuntimeAdmission, true);
  env.OWNER_ACCESS_SUPABASE_PROJECT_REF = "bcdefghijklmnopqrstu";
  assert.ok((await inspectOwnerDeployment(env, readable)).issues.includes("database_connection_required"));
  env.OWNER_ACCESS_SUPABASE_PROJECT_REF = "abcdefghijklmnopqrst";
  env.OWNER_ACCESS_DATABASE_URL = env.OWNER_ACCESS_DATABASE_URL.replace(":5432/", ":6543/");
  assert.ok((await inspectOwnerDeployment(env, readable)).issues.includes("database_connection_required"));
});
