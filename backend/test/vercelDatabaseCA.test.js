import assert from "node:assert/strict";
import { X509Certificate } from "node:crypto";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { evaluateProductionConfiguration } from "../src/operations/productionConfiguration.js";
import { APPLE_APP_ATTESTATION_ROOT_PEM } from "../src/appAttest/appleAppAttestationRoot.js";
import { prepareVercelDatabaseCA, VERCEL_DATABASE_CA_PATH } from "../src/operations/vercelDatabaseCA.js";
import { dynamicResearchExecutionLimits } from "../src/operations/dynamicResearchBudget.js";
import { DYNAMIC_LIMITS } from "../src/dynamicResearch/planner.js";

// Public certificate fixture only; it is not a Supabase trust anchor.
const certificate = new X509Certificate(APPLE_APP_ATTESTATION_ROOT_PEM);
const env = {
  APP_ATTEST_DATABASE_CA_PEM: APPLE_APP_ATTESTATION_ROOT_PEM,
  APP_ATTEST_DATABASE_CA_SHA256: certificate.fingerprint256.replaceAll(":", "").toLowerCase(),
  APP_ATTEST_DATABASE_URL: `postgresql://fixture:fixture@example.invalid/postgres?sslmode=verify-full&sslrootcert=${VERCEL_DATABASE_CA_PATH}`
};
const now = (Date.parse(certificate.validFrom) + Date.parse(certificate.validTo)) / 2;

test("validated public CA is atomically materialized at the documented runtime path", () => {
  const calls = [];
  const fs = {
    writeFileSync(...args) { calls.push(["write", ...args]); },
    renameSync(...args) { calls.push(["rename", ...args]); },
    rmSync(...args) { calls.push(["remove", ...args]); }
  };
  prepareVercelDatabaseCA(env, { fs, now });
  assert.equal(calls[0][2], certificate.toString());
  assert.deepEqual(calls[0][3], { flag: "wx", mode: 0o600 });
  assert.equal(calls[1][1], calls[0][1]);
  assert.equal(calls[1][2], VERCEL_DATABASE_CA_PATH);
  assert.equal(calls[2][1], calls[0][1]);
});

test("bad certificate, fingerprint, expiry and path fail before filesystem writes", () => {
  const fs = { writeFileSync() { assert.fail("Unexpected write"); } };
  for (const overrides of [
    { APP_ATTEST_DATABASE_CA_SHA256: undefined },
    { APP_ATTEST_DATABASE_CA_PEM: undefined },
    { APP_ATTEST_DATABASE_CA_SHA256: "0".repeat(64) },
    { APP_ATTEST_DATABASE_CA_PEM: "-----BEGIN PRIVATE KEY-----\nfixture" },
    { APP_ATTEST_DATABASE_CA_PEM: env.APP_ATTEST_DATABASE_CA_PEM.repeat(2) },
    { APP_ATTEST_DATABASE_URL: env.APP_ATTEST_DATABASE_URL.replace(VERCEL_DATABASE_CA_PATH, "/tmp/another.pem") },
    { APP_ATTEST_DATABASE_URL: env.APP_ATTEST_DATABASE_URL + "&sslrootcert=/tmp/another.pem" }
  ]) assert.throws(() => prepareVercelDatabaseCA({ ...env, ...overrides }, { fs, now }), /database_ca_configuration_invalid/);
  assert.throws(() => prepareVercelDatabaseCA(env, { fs, now: Date.parse(certificate.validTo) + 1 }));
  prepareVercelDatabaseCA({}, { fs, now });
});

test("CA write failures are propagated and temporary material is cleaned up", () => {
  let removed;
  assert.throws(() => prepareVercelDatabaseCA(env, { now, fs: {
    writeFileSync() { throw new Error("disk unavailable"); },
    rmSync(path) { removed = path; }
  } }), /disk unavailable/);
  assert.ok(removed.startsWith(VERCEL_DATABASE_CA_PATH + "."));
});

test("pilot generation caps can only tighten existing planner limits", () => {
  assert.deepEqual(dynamicResearchExecutionLimits({}), DYNAMIC_LIMITS);
  const pilot = dynamicResearchExecutionLimits({
    DYNAMIC_RESEARCH_MAX_GENERATIONS: "7", DYNAMIC_RESEARCH_MAX_CURRENT_INFORMATION_GENERATIONS: "2"
  });
  assert.equal(pilot.generations, 7);
  assert.equal(pilot.currentInformationGenerations, 2);
  assert.equal(pilot.routes, 5);
  for (const value of ["0", "17", "1.5", "NaN", ""]) {
    assert.throws(() => dynamicResearchExecutionLimits({ DYNAMIC_RESEARCH_MAX_GENERATIONS: value }));
  }
  assert.throws(() => dynamicResearchExecutionLimits({ DYNAMIC_RESEARCH_MAX_CURRENT_INFORMATION_GENERATIONS: "4" }));
});

test("the documented pilot values satisfy configuration syntax with synthetic operator inputs", () => {
  const config = JSON.parse(readFileSync(new URL("../config/vercel-pilot-v1.json", import.meta.url), "utf8"));
  const supplied = { ...config.values, ...env,
    GOOGLE_API_KEY: "fixture-only", GRAPHHOPPER_API_KEY: "fixture-only",
    APP_ATTEST_APP_ID_PREFIX: "ABCDE12345", APP_ATTEST_BUNDLE_ID: "com.trailmind.app.staging",
    APP_ATTEST_ENVIRONMENT: "production", APP_ATTEST_ALLOWED_VALIDATION_CATEGORIES: "3",
    APP_ATTEST_ALLOWED_BUNDLE_VERSIONS: "1"
  };
  assert.equal(evaluateProductionConfiguration(supplied).decision, "ready");
  assert.equal(evaluateProductionConfiguration({ ...supplied, DYNAMIC_RESEARCH_MAX_GENERATIONS: "17" }).decision, "blocked");
  assert.equal(config.values.ROUTE_WEATHER_ENABLED, "false");
  assert.equal(config.values.APPLE_ACCOUNT_ENABLED, "false");
});
