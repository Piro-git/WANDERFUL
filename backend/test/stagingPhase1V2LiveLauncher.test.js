import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import {
  appendFileSync,
  chmodSync,
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  lstatSync,
  linkSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  symlinkSync,
  unlinkSync,
  writeSync
} from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import {
  admitStagingPhase1V2Session
} from "../src/operations/stagingPhase1V2Admission.js";
import {
  createNoEchoTtyAdapter,
  inspectCertificateAuthority,
  liveLauncherHelp,
  parseLiveLauncherArguments,
  runStagingPhase1V2LiveLauncher,
  runStagingPhase1V2PreflightOnly,
  StagingPhase1V2LiveLauncherError
} from "../src/operations/stagingPhase1V2LiveLauncher.js";

const REPOSITORY_ROOT = realpathSync(new URL("../..", import.meta.url));
const CANDIDATE = "10dd59adf4b12dec8288e261438331db78fff9b2";
const CANDIDATE_TREE = "ae82c3e2e4693ae911587e3fbba2516469c9e4d2";
const UUIDS = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333"
];
const SECRET = "synthetic-launcher-password";
const temporaryRoots = [];
let caCounter = 0;

afterEach(async () => {
  for (const root of temporaryRoots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

describe("staging Phase 1 V2 secure live launcher", () => {
  it("reads a secret with raw-mode no-echo behavior and restores the TTY on success and timeout", async () => {
    const success = fakeProcessStreams();
    const tty = createNoEchoTtyAdapter(success);
    const pending = tty.readSecret("Secret: ", {
      maximumBytes: 64,
      timeoutMilliseconds: 1_000
    });
    setImmediate(() => success.input.emit(
      "data", Buffer.from(`${SECRET}\n`, "utf8")
    ));
    const value = await pending;
    assert.equal(value.toString("utf8"), SECRET);
    value.fill(0);
    assert.deepEqual(success.rawModes, [true, false]);
    assert.equal(success.outputText,
      "Secret: \u001b[?2004h\u001b[?2004l\n");
    assert.equal(success.outputText.includes(SECRET), false);
    assert.equal(success.input.listenerCount("data"), 0);

    const clipboard = fakeProcessStreams();
    const pasted = createNoEchoTtyAdapter(clipboard).readSecret("Secret: ", {
      maximumBytes: 64,
      timeoutMilliseconds: 1_000
    });
    setImmediate(() => clipboard.input.emit(
      "data", Buffer.from(`\u001b[200~${SECRET}\u001b[201~\n`, "utf8")
    ));
    await assert.rejects(pasted, fixed("clipboard_input"));
    assert.deepEqual(clipboard.rawModes, [true, false]);
    assert.equal(clipboard.outputText.includes(SECRET), false);

    const timeout = fakeProcessStreams();
    const keepEventLoopAlive = setTimeout(() => {}, 25);
    try {
      await assert.rejects(createNoEchoTtyAdapter(timeout).readSecret(
        "Secret: ", {
          maximumBytes: 64,
          timeoutMilliseconds: 5
        }
      ), fixed("prompt_timeout"));
    } finally {
      clearTimeout(keepEventLoopAlive);
    }
    assert.deepEqual(timeout.rawModes, [true, false]);
    assert.equal(timeout.input.listenerCount("data"), 0);
  });

  it("rejects non-TTY, piped, argument, environment and clipboard-style secret sources before adapter work", async () => {
    let calls = 0;
    const base = {
      mode: "live",
      caPath: "/private/tmp/not-opened-ca.pem",
      endpointClass: "direct",
      address: "2606:4700:4700::1111"
    };
    await assert.rejects(runStagingPhase1V2LiveLauncher(base, {
      env: {}, tty: { isTTY: false },
      runAuthorized: async () => { calls += 1; }
    }), fixed("tty_required"));
    assert.equal(calls, 0);

    for (const argv of [
      ["--password", SECRET],
      ["--clipboard"],
      ["--password-stdin"],
      ["--ca-file", "/private/tmp/x", "--endpoint", "direct",
        "--address", "postgresql://postgres:pw@example.invalid/postgres"]
    ]) assert.throws(() => parseLiveLauncherArguments(argv),
      /secret_input_source|arguments/);

    await assert.rejects(runStagingPhase1V2LiveLauncher(base, {
      env: { PGPASSWORD: SECRET }, tty: { isTTY: true },
      runAuthorized: async () => { calls += 1; }
    }), fixed("environment_secret_source"));
    assert.equal(calls, 0);
  });

  it("uses a no-echo TTY secret, unlinks it before one adapter invocation, consumes the envelope and leaks no secret", async () => {
    const fixture = await liveFixture();
    let adapterCalls = 0;
    let secretPromptCalls = 0;
    const tty = fakeTty(fixture.now, () => { secretPromptCalls += 1; });
    const argvSnapshot = [...process.argv];
    const envSnapshot = { ...fixture.env };
    let credentialFd;
    const io = {
      ...realIO(),
      open(path, flags, mode) {
        const fd = openSync(path, flags, mode);
        if (path.includes("/credential-")) {
          credentialFd = fd;
          assert.notEqual(flags & constants.O_EXCL, 0);
          assert.notEqual(flags & constants.O_NOFOLLOW, 0);
          assert.equal(mode, 0o600);
        }
        return fd;
      }
    };

    const outcome = await runStagingPhase1V2LiveLauncher(fixture.options, {
      env: fixture.env,
      tty,
      now: () => fixture.now,
      randomUUID: sequence(UUIDS),
      repositoryRoot: REPOSITORY_ROOT,
      temporaryBase: fixture.root,
      io,
      gitInspection: gitInspection(),
      observer: unusedObserver(),
      runAuthorized: async ({ admissionRequest }, dependencies) => {
        adapterCalls += 1;
        assert.equal(dependencies.signal.aborted, false);
        assert(admissionRequest.passwordFd >= 3);
        assert.equal(fstatSync(admissionRequest.passwordFd).nlink, 0);
        const inheritedProbe = spawnSync(process.execPath, [
          "-e",
          `try { require('node:fs').fstatSync(${admissionRequest.passwordFd}); ` +
            "process.exit(1); } catch { process.exit(0); }"
        ], { stdio: "ignore" });
        assert.equal(inheritedProbe.status, 0);
        assert.equal(admissionRequest.endpointClass, "direct");
        assert.equal(admissionRequest.target.projectRef,
          "mbvzwsrtqcrwhvykugcd");
        assert.equal(admissionRequest.target.organizationId,
          "wbnftkftyamxzvxsftda");
        assert.equal(admissionRequest.target.postgresMajor, 17);
        assert.equal(admissionRequest.tls.mode, "verify-full");
        assert.equal(admissionRequest.gitAttestation.clean, true);
        assert.match(admissionRequest.controlObservationDigest,
          /^[a-f0-9]{64}$/);
        let admission;
        try {
          admission = admitStagingPhase1V2Session(admissionRequest, {
            env: {}, now: () => fixture.now,
            repositoryRoot: REPOSITORY_ROOT,
            gitInspection: gitInspection()
          });
        } catch (error) {
          throw new StagingPhase1V2LiveLauncherError(
            `test_${error.code ?? "admission"}`
          );
        }
        const secrets = admission.takeSecrets();
        assert.equal(secrets.password, SECRET);
        secrets.ca.fill(0);
        admission.dispose();
        return {
          receiptDigest: "e".repeat(64),
          receipt: { status: "committed" }
        };
      }
    });

    assert.equal(outcome.status, "committed");
    assert(Number.isSafeInteger(credentialFd) && credentialFd >= 3);
    assert.throws(() => fstatSync(credentialFd), { code: "EBADF" });
    assert.equal(adapterCalls, 1);
    assert.equal(secretPromptCalls, 1);
    assert.equal(tty.echoedSecret, false);
    assert.equal(argvSnapshot.some((value) => value.includes(SECRET)), false);
    assert.equal(Object.values(envSnapshot).some(
      (value) => String(value).includes(SECRET)), false);
    assert.equal(scanRegularFiles(outcome.artifactDirectory).includes(SECRET),
      false);
  });

  it("validates CA ownership, mode, canonical identity, link count, X.509 content and TOCTOU stability", async () => {
    const root = await mkdtemp("/private/tmp/trailmind-launcher-ca-test.");
    temporaryRoots.push(root);
    const caPath = join(root, "ca.pem");
    createTestCa(caPath, root);
    const now = new Date();
    assert.equal(inspectCertificateAuthority({
      path: caPath, repositoryRoot: REPOSITORY_ROOT, now
    }).path, caPath);

    chmodSync(caPath, 0o644);
    assert.throws(() => inspectCertificateAuthority({
      path: caPath, repositoryRoot: REPOSITORY_ROOT, now
    }), /:ca$/);
    chmodSync(caPath, 0o600);

    const linked = join(root, "ca-linked.pem");
    linkSync(caPath, linked);
    assert.throws(() => inspectCertificateAuthority({
      path: caPath, repositoryRoot: REPOSITORY_ROOT, now
    }), /:ca$/);
    unlinkSync(linked);

    const symlink = join(root, "ca-symlink.pem");
    symlinkSync(caPath, symlink);
    assert.throws(() => inspectCertificateAuthority({
      path: symlink, repositoryRoot: REPOSITORY_ROOT, now
    }), /:ca$/);

    const invalid = join(root, "invalid.pem");
    await writeFile(invalid, "not a certificate", { mode: 0o600 });
    assert.throws(() => inspectCertificateAuthority({
      path: invalid, repositoryRoot: REPOSITORY_ROOT, now
    }), /ca_pem/);

    const beforeCertificateValidity = new Date("2000-01-01T00:00:00.000Z");
    const historicalMetadata = (metadata) => new Proxy(metadata, {
      get(target, property, receiver) {
        if (["mtimeMs", "ctimeMs"].includes(property)) {
          return beforeCertificateValidity.getTime();
        }
        return Reflect.get(target, property, receiver);
      }
    });
    assert.throws(() => inspectCertificateAuthority({
      path: caPath,
      repositoryRoot: REPOSITORY_ROOT,
      now: beforeCertificateValidity,
      io: {
        ...realIO(),
        fstat(fd) { return historicalMetadata(fstatSync(fd)); },
        lstat(path) { return historicalMetadata(lstatSync(path)); }
      }
    }), /ca_x509/);

    let reads = 0;
    assert.throws(() => inspectCertificateAuthority({
      path: caPath,
      repositoryRoot: REPOSITORY_ROOT,
      now,
      io: {
        ...realIO(),
        readFile(fd) {
          const bytes = readFileSync(fd);
          reads += 1;
          appendFileSync(caPath, " ");
          return bytes;
        }
      }
    }), /ca_race/);
    assert.equal(reads, 1);

    assert.throws(() => inspectCertificateAuthority({
      path: caPath,
      repositoryRoot: REPOSITORY_ROOT,
      now,
      io: {
        ...realIO(),
        lstat(path) {
          const metadata = lstatSync(path);
          return new Proxy(metadata, {
            get(target, property, receiver) {
              if (property === "uid") return process.geteuid() + 1;
              return Reflect.get(target, property, receiver);
            }
          });
        }
      }
    }), /:ca$/);
  });

  it("uses exclusive attempt creation and cleans password state on cancellation", async () => {
    const fixture = await liveFixture();
    const cancelledTty = fakeTty(fixture.now);
    cancelledTty.readSecret = async () => {
      throw new StagingPhase1V2LiveLauncherError("cancelled");
    };
    const dependencies = {
      env: {}, tty: cancelledTty, now: () => fixture.now,
      randomUUID: sequence(UUIDS), repositoryRoot: REPOSITORY_ROOT,
      temporaryBase: fixture.root, gitInspection: gitInspection(),
      observer: unusedObserver()
    };
    await assert.rejects(
      runStagingPhase1V2LiveLauncher(fixture.options, dependencies),
      fixed("cancelled")
    );
    assert.equal(scanRegularFiles(fixture.root).includes(SECRET), false);
    assert(readdirSync(fixture.root).some((name) =>
      name === `trailmind-phase1-v2-live-${UUIDS[0]}`));

    await assert.rejects(runStagingPhase1V2LiveLauncher(fixture.options, {
      ...dependencies,
      randomUUID: sequence(UUIDS)
    }), fixed("attempt_directory"));
  });

  it("runs the synthetic preflight through Git, CA, file, FD and envelope admission with zero remote calls", async () => {
    const root = await mkdtemp("/private/tmp/trailmind-launcher-preflight-test.");
    temporaryRoots.push(root);
    await assert.rejects(runStagingPhase1V2PreflightOnly({
      env: { PGPASSWORD: SECRET }
    }), fixed("environment_secret_source"));
    const networkCounter = { calls: 0 };
    const databaseCounter = { calls: 0 };
    const syntheticPassword = Buffer.from(
      "synthetic-preflight-password", "utf8"
    );
    let secretReads = 0;
    const result = await runStagingPhase1V2PreflightOnly({
      env: {},
      repositoryRoot: REPOSITORY_ROOT,
      temporaryBase: root,
      randomUUID: sequence(UUIDS),
      now: () => new Date(),
      gitInspection: gitInspection(),
      networkCounter,
      databaseCounter,
      tty: {
        isTTY: true,
        async readSecret(_prompt, options) {
          secretReads += 1;
          assert.equal(options.maximumBytes, 1_024);
          return syntheticPassword;
        }
      }
    });
    assert.deepEqual(result, {
      status: "preflight-passed",
      localBoundaryChecks: 9,
      networkCalls: 0,
      databaseCalls: 0
    });
    assert.equal(secretReads, 1);
    assert.equal(syntheticPassword.every((byte) => byte === 0), true);
    assert.equal(readdirSync(root).length, 0);
  });

  it("admits only direct IPv6 or session IPv4 endpoint classes and keeps help free of credential examples", () => {
    const direct = parseLiveLauncherArguments([
      "--ca-file", "/private/tmp/target-ca.pem",
      "--endpoint", "direct",
      "--address", "2606:4700:4700::1111"
    ]);
    assert.equal(direct.endpointClass, "direct");
    const session = parseLiveLauncherArguments([
      "--ca-file", "/private/tmp/target-ca.pem",
      "--endpoint", "session",
      "--address", "1.1.1.1"
    ]);
    assert.equal(session.endpointClass, "session");
    for (const address of [
      "127.0.0.1", "127.1", "10.0.0.1", "0x7f000001",
      "1.1.1.1/32", "192.0.0.8", "192.88.99.1", "203.0.113.1"
    ]) assert.throws(() => parseLiveLauncherArguments([
      "--ca-file", "/private/tmp/target-ca.pem",
      "--endpoint", "session", "--address", address
    ]), /endpoint_address/);
    assert.throws(() => parseLiveLauncherArguments([
      "--ca-file", "/private/tmp/target-ca.pem",
      "--endpoint", "direct", "--address", "1.1.1.1"
    ]), /endpoint_address/);
    const help = liveLauncherHelp();
    assert.equal(/postgres(?:ql)?:\/\/|PGPASSWORD|DATABASE_URL|password=/i
      .test(help), false);
  });
});

async function liveFixture() {
  const root = await mkdtemp("/private/tmp/trailmind-launcher-live-test.");
  temporaryRoots.push(root);
  const caPath = join(root, "official-target-ca.pem");
  createTestCa(caPath, root);
  return {
    root,
    caPath,
    env: {},
    now: new Date(),
    options: {
      mode: "live",
      caPath,
      endpointClass: "direct",
      address: "2606:4700:4700::1111"
    }
  };
}

function fakeTty(now, onSecret = () => {}) {
  const tty = {
    isTTY: true,
    echoedSecret: false,
    async readLine(prompt) {
      if (prompt.startsWith("Type AUTHORIZE_")) {
        return "AUTHORIZE_TRAILMIND_STAGING_MBVZWSRTQCRWHVYKUGCD_ACTIVE_FREE_NANO_USD0_EUCENTRAL1_PG17";
      }
      if (prompt.startsWith("Type PROTECTED_PROJECTS_")) {
        return "PROTECTED_PROJECTS_UNSELECTED_ZERO_MUTATIONS";
      }
      if (prompt.includes("observation time")) return now.toISOString();
      if (prompt.includes("Expected database ACL")) return "a".repeat(64);
      if (prompt.includes("Provider ACL restore-plan")) return "d".repeat(64);
      if (prompt.includes("blocking finding count")) return "0";
      throw new Error("unexpected test prompt");
    },
    async readSecret(_prompt, options) {
      onSecret();
      assert.equal(options.maximumBytes, 1_024);
      return Buffer.from(SECRET, "utf8");
    }
  };
  return tty;
}

function unusedObserver() {
  return {
    async observePostAdvisors() { throw new Error("not expected"); },
    async observeFinalControl() { throw new Error("not expected"); },
    async observeCleanup() { throw new Error("not expected"); }
  };
}

function createTestCa(caPath, root) {
  caCounter += 1;
  const keyPath = join(root, `key-${caCounter}.pem`);
  execFileSync("openssl", [
    "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-sha256",
    "-days", "1", "-subj", "/CN=TrailMind Launcher Test CA",
    "-addext", "basicConstraints=critical,CA:TRUE",
    "-keyout", keyPath, "-out", caPath
  ], { stdio: ["ignore", "ignore", "ignore"] });
  unlinkSync(keyPath);
  chmodSync(caPath, 0o600);
}

function gitInspection() {
  return () => ({
    baselineReachable: true,
    clean: true,
    head: CANDIDATE,
    root: REPOSITORY_ROOT,
    tree: CANDIDATE_TREE
  });
}

function sequence(values) {
  let index = 0;
  return () => values[index++];
}

function scanRegularFiles(root) {
  const values = [];
  const visit = (path) => {
    for (const name of readdirSync(path)) {
      const child = join(path, name);
      const metadata = lstatSync(child);
      if (metadata.isDirectory()) visit(child);
      else if (metadata.isFile()) values.push(readFileSync(child, "utf8"));
    }
  };
  visit(root);
  return values.join("\n");
}

function realIO() {
  return {
    close: closeSync,
    fsync: fsyncSync,
    fstat: fstatSync,
    lstat: lstatSync,
    open: openSync,
    readFile: readFileSync,
    readdir: readdirSync,
    realpath: realpathSync,
    unlink: unlinkSync,
    write: writeSync
  };
}

function fakeProcessStreams() {
  const input = new EventEmitter();
  const rawModes = [];
  input.isTTY = true;
  input.setRawMode = (value) => { rawModes.push(value); };
  input.resume = () => {};
  input.pause = () => {};
  let outputText = "";
  const output = {
    isTTY: true,
    write(value) { outputText += value; }
  };
  return {
    input,
    output,
    rawModes,
    get outputText() { return outputText; }
  };
}

function fixed(code) {
  return (error) => error instanceof StagingPhase1V2LiveLauncherError &&
    error.code === code && !error.message.includes(SECRET);
}
