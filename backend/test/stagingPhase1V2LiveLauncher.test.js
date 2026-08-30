import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
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
  readSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  symlinkSync,
  unlinkSync,
  writeSync
} from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
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

    const cancelled = fakeProcessStreams();
    const cancellation = createNoEchoTtyAdapter(cancelled).readSecret(
      "Secret: ", { maximumBytes: 64, timeoutMilliseconds: 1_000 }
    );
    setImmediate(() => cancelled.input.emit("data", Buffer.from([3])));
    await assert.rejects(cancellation, fixed("cancelled"));
    assert.deepEqual(cancelled.rawModes, [true, false]);
    assert.equal(cancelled.input.listenerCount("data"), 0);
  });

  it("rejects non-TTY, piped, argument, environment and clipboard-style secret sources before adapter work", async () => {
    const base = {
      mode: "live",
      caPath: "/private/tmp/not-opened-ca.pem",
      endpointClass: "direct",
      address: "2606:4700:4700::1111"
    };
    await assert.rejects(runStagingPhase1V2LiveLauncher(base),
      fixed("tty_required"));

    for (const argv of [
      ["--password", SECRET],
      ["--clipboard"],
      ["--password-stdin"],
      ["--ca-file", "/private/tmp/x", "--endpoint", "direct",
        "--address", "postgresql://postgres:pw@example.invalid/postgres"]
    ]) assert.throws(() => parseLiveLauncherArguments(argv),
      /secret_input_source|arguments/);

    const previous = process.env.PGPASSWORD;
    process.env.PGPASSWORD = SECRET;
    try {
      await assert.rejects(runStagingPhase1V2LiveLauncher(base),
        fixed("environment_secret_source"));
    } finally {
      if (previous === undefined) delete process.env.PGPASSWORD;
      else process.env.PGPASSWORD = previous;
    }
  });

  it("rejects every production dependency override before prompt, Git, CA, database or adapter work", async () => {
    const calls = {
      adapter: 0, injectedFactory: 0, line: 0, secret: 0
    };
    const tty = {
      isTTY: true,
      async readLine() {
        calls.line += 1;
        throw new Error("must stop before action authorization");
      },
      async readSecret() {
        calls.secret += 1;
        return Buffer.from(SECRET);
      }
    };
    const options = {
      mode: "live",
      caPath: "/private/tmp/must-not-be-opened.pem",
      endpointClass: "direct",
      address: "2606:4700:4700::1111"
    };
    for (const overrides of [
      { tty },
      { env: {} },
      { gitInspection: gitInspection() },
      { observerPackage: { createSession() {
        calls.injectedFactory += 1;
      } } },
      { runAuthorized: async () => { calls.adapter += 1; } },
      Object.create(null)
    ]) await assert.rejects(runStagingPhase1V2LiveLauncher(
      options, overrides
    ), fixed("production_dependency_override"));
    assert.deepEqual(calls, {
      adapter: 0, injectedFactory: 0, line: 0, secret: 0
    });
  });

  it("does not permit a proxy to hide production dependency overrides", async () => {
    let reads = 0;
    const hidden = new Proxy({}, {
      ownKeys() { return []; },
      getPrototypeOf() { return null; },
      get() { reads += 1; return () => {}; }
    });
    await assert.rejects(runStagingPhase1V2LiveLauncher({
      mode: "live",
      caPath: "/private/tmp/must-not-be-opened.pem",
      endpointClass: "direct",
      address: "2606:4700:4700::1111"
    }, hidden), fixed("production_dependency_override"));
    assert.equal(reads, 0);
  });

  it("keeps live mutation behind the unregistered reviewed observer gate", () => {
    const launcher = readFileSync(join(
      REPOSITORY_ROOT,
      "backend/src/operations/stagingPhase1V2LiveLauncher.js"
    ), "utf8");
    assert.match(launcher,
      /requireReviewedStagingPhase1V2ProductionObserverFactory\(\)/);
    assert.doesNotMatch(launcher,
      /STAGING_PHASE1_V2_REVIEWED_PRODUCTION_OBSERVER_FACTORY/);
    assert.match(launcher,
      /await runAuthorizedStagingPhase1V2SingleSession\(/);
    assert.doesNotMatch(launcher,
      /dependencies\.(?:runAuthorized|adapterDependencies|observerPackage|observerFactory|controlTransport)/);
  });

  it("has no production factory, module-path or transport injection seam", () => {
    const launcher = readFileSync(join(
      REPOSITORY_ROOT,
      "backend/src/operations/stagingPhase1V2LiveLauncher.js"
    ), "utf8");
    const observer = readFileSync(join(
      REPOSITORY_ROOT,
      "backend/src/operations/stagingPhase1V2MachineObserver.js"
    ), "utf8");
    assert.doesNotMatch(launcher,
      /dependencies\.(?:observerPackage|observerFactory|controlTransport)/);
    assert.doesNotMatch(observer,
      /(?:register|promote)Production|import\s*\(/);
    assert.deepEqual(observer.match(/process\.env\[[^\]]+\]/g), [
      "process.env[name]"
    ]);
    assert.equal((observer.match(/productionFactories\.add\(/g) ?? []).length,
      0);
  });

  it("keeps the production script on the pinned launcher with no generic boundary bypass", () => {
    const source = readFileSync(join(
      REPOSITORY_ROOT, "backend/scripts/staging/phase1-v2-operator.js"
    ), "utf8");
    assert.match(source, /runStagingPhase1V2LiveLauncher\(options\)/);
    assert.doesNotMatch(source,
      /runAuthorizedStagingPhase1V2SingleSession|export\s+async\s+function\s+main/);
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
    const credentialFds = [];
    const baseIO = realIO();
    const trackedIO = {
      ...baseIO,
      open(path, flags, mode) {
        const fd = baseIO.open(path, flags, mode);
        if (path.includes("credential-")) {
          credentialFds.push({ fd, path, state: fstatSync(fd) });
        }
        return fd;
      }
    };
    const result = await runStagingPhase1V2PreflightOnly({
      env: {},
      repositoryRoot: REPOSITORY_ROOT,
      temporaryBase: root,
      randomUUID: sequence(UUIDS),
      now: () => new Date(),
      gitInspection: gitInspection(),
      networkCounter,
      databaseCounter,
      io: trackedIO,
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
      localBoundaryChecks: 13,
      observerMode: "synthetic-preflight-non-authorizing",
      observerPhases: [
        "pre-control", "post-ddl-advisors", "final-control",
        "post-disconnect-cleanup"
      ],
      networkCalls: 0,
      databaseCalls: 0
    });
    assert.equal(secretReads, 1);
    assert.equal(syntheticPassword.every((byte) => byte === 0), true);
    assert.equal(credentialFds.length, 2);
    assert.notEqual(credentialFds[0].fd, credentialFds[1].fd);
    assert.notEqual(credentialFds[0].path, credentialFds[1].path);
    assert.ok(credentialFds[0].state.dev !== credentialFds[1].state.dev ||
      credentialFds[0].state.ino !== credentialFds[1].state.ino);
    for (const { fd } of credentialFds) {
      assert.throws(() => fstatSync(fd), { code: "EBADF" });
    }
    assert.equal(readdirSync(root).length, 0);
  });

  it("wipes and closes the first password descriptor when the independent auditor open fails", async () => {
    const root = await mkdtemp("/private/tmp/trailmind-pair-fault-test.");
    temporaryRoots.push(root);
    const password = Buffer.from("synthetic-pair-failure-password");
    const baseIO = realIO();
    let firstFd;
    let pairOpens = 0;
    const io = {
      ...baseIO,
      open(path, flags, mode) {
        if (path.includes("credential-")) {
          pairOpens += 1;
          if (pairOpens === 2) throw new Error("controlled second open fault");
        }
        const fd = baseIO.open(path, flags, mode);
        if (path.includes("credential-")) firstFd = fd;
        return fd;
      }
    };
    await assert.rejects(runStagingPhase1V2PreflightOnly({
      env: {},
      gitInspection: gitInspection(),
      io,
      now: () => new Date(),
      randomUUID: sequence(UUIDS),
      repositoryRoot: REPOSITORY_ROOT,
      temporaryBase: root,
      tty: {
        isTTY: true,
        async readSecret() { return password; }
      }
    }), fixed("password_file"));
    assert.equal(password.every((byte) => byte === 0), true);
    assert.equal(pairOpens, 2);
    assert.throws(() => fstatSync(firstFd), { code: "EBADF" });
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
    assert.match(help, /internal authenticated production observer/);
    assert.doesNotMatch(help, /enter.*advisor|type.*digest|session_closed/i);
  });
});

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

function realIO() {
  return {
    close: closeSync,
    fsync: fsyncSync,
    fstat: fstatSync,
    lstat: lstatSync,
    open: openSync,
    read: readSync,
    readFile: readFileSync,
    readdir: readdirSync,
    realpath: realpathSync,
    rename: renameSync,
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
