import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { describe, it } from "node:test";
import { stagingAdmissionContract } from "../container/stagingAdmission.js";

const execFileAsync = promisify(execFile);

describe("staging OCI artifact", () => {
  it("pins Node 22, uses a non-root runtime and excludes package managers", async () => {
    const dockerfile = await readFile(new URL("../Dockerfile", import.meta.url), "utf8");
    assert.match(
      dockerfile,
      /node:22\.23\.2-bookworm-slim@sha256:[0-9a-f]{64}/
    );
    const pinnedBase =
      "node:22.23.2-bookworm-slim@sha256:d649c27dae7ba0137b3cef5dd75baa422c08dc3d9e3fc0c23dfb172dc3cc6436";
    assert.equal(dockerfile.split("\n").filter((line) =>
      line.startsWith(`FROM ${pinnedBase} AS `)
    ).length, 2);
    assert.doesNotMatch(dockerfile, /^ARG NODE_IMAGE=/m);
    assert.match(dockerfile, /^USER 65532:65532$/m);
    assert.match(dockerfile, /npm ci --omit=dev --ignore-scripts/);
    assert.match(dockerfile, /rm -rf node_modules\/\.bin node_modules\/pg-types\/test/);
    assert.match(dockerfile, /rm -rf \/usr\/local\/lib\/node_modules\/npm/);
    assert.match(dockerfile, /^STOPSIGNAL SIGTERM$/m);
    assert.match(dockerfile, /CMD \["node", "container\/healthcheck\.js"\]/);
    assert.match(dockerfile, /^ENTRYPOINT \["node"\]$/m);
    assert.match(dockerfile, /^CMD \["container\/start\.js"\]$/m);
    assert.doesNotMatch(dockerfile, /COPY (?:test|scripts|evaluation|migrations|docs|api)/);
    assert.doesNotMatch(dockerfile, /(?:API_KEY|DATABASE_URL|PASSWORD|TOKEN)=\S+/);
  });

  it("uses an explicit build-context allowlist", async () => {
    const ignore = await readFile(new URL("../.dockerignore", import.meta.url), "utf8");
    assert.equal(ignore.split("\n")[0], "*");
    for (const required of [
      "!package.json",
      "!package-lock.json",
      "!src/**",
      "!config/outdoor-regions/*.json",
      "!config/outdoor-regions/*.geojson",
      "!container/healthcheck.js",
      "!container/stagingAdmission.js",
      "!container/start.js"
    ]) assert.match(ignore, new RegExp(`^${escapePattern(required)}$`, "m"));
    for (const forbidden of ["test", "scripts", "evaluation", "migrations", ".env", "node_modules"] ) {
      assert.doesNotMatch(ignore, new RegExp(`^!.*${escapePattern(forbidden)}`, "m"));
    }
  });

  it("passes the deterministic application-context secret and content scan", async () => {
    const { stdout } = await execFileAsync(
      process.execPath,
      [new URL("../scripts/staging/runtime/verify-build-context.js", import.meta.url).pathname],
      { maxBuffer: 4 * 1_024 * 1_024 }
    );
    const report = JSON.parse(stdout);
    assert.equal(report.decision, "pass");
    assert.equal(report.failureCategories.length, 0);
    assert.match(report.contentSha256, /^[0-9a-f]{64}$/);
    assert.equal(report.fileCount > 0, true);
  });

  it("requires Node 22 or later in package metadata", async () => {
    const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
    const packageLock = JSON.parse(await readFile(new URL("../package-lock.json", import.meta.url), "utf8"));
    assert.equal(packageJson.engines.node, ">=22");
    assert.equal(packageLock.packages[""].engines.node, ">=22");
  });

  it("keeps the machine-readable environment contract in sync with admission", async () => {
    const machineContract = JSON.parse(await readFile(
      new URL("../container/staging-runtime-contract-v1.json", import.meta.url),
      "utf8"
    ));
    const sourceContract = stagingAdmissionContract();
    assert.equal(machineContract.contractVersion, sourceContract.contractVersion);
    assert.deepEqual(machineContract.runtime.exactFalse, sourceContract.exactFalseFlags);
    assert.deepEqual(machineContract.runtime.forbidden, sourceContract.forbiddenWebProcessValues);
    assert.equal(machineContract.runtime.node.minimumMajor, 22);
    assert.equal(machineContract.runtime.node.runtimeUser, "65532:65532");
    const runtimeRequired = new Set(machineContract.runtime.required.map(({ name }) => name));
    assert.equal(runtimeRequired.has("TRAILMIND_STAGING_PROJECT_REF_SHA256"), true);
    assert.equal(runtimeRequired.has("APP_ATTEST_RUNTIME_ROLE"), true);
    const controlRequired = new Set(machineContract.controlJob.required.map(({ name }) => name));
    assert.equal(controlRequired.has("APP_ATTEST_CONTROL_ROLE"), true);
    assert.equal(machineContract.controlJob.runtimeSourceMustBeAbsent, true);
    assert.equal(machineContract.remoteMutationAuthorized, false);
  });
});

function escapePattern(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
