import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  link,
  lstat,
  mkdtemp,
  rename,
  symlink,
  writeFile
} from "node:fs/promises";
import {
  closeSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  readdirSync,
  readSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeSync
} from "node:fs";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import {
  admitStagingPhase1V2Session,
  readStagingPhase1V2CandidateBindings,
  STAGING_PHASE1_V2_DIRECT_HOST,
  STAGING_PHASE1_V2_SESSION_HOST
} from "../src/operations/stagingPhase1V2Admission.js";

const NOW = new Date("2026-08-27T08:00:00.000Z");
const CANDIDATE = "52849b4c75cd6e5ddf00473adf8a3265160d750d";
const CANDIDATE_TREE = "b".repeat(40);
const PROJECT = "mbvzwsrtqcrwhvykugcd";
const POLICY = "supabase-postgis-isolation-v2";
const temporaryRoots = [];

afterEach(async () => {
  for (const root of temporaryRoots.splice(0)) {
    await import("node:fs/promises").then(({ rm }) =>
      rm(root, { recursive: true, force: true }));
  }
});

describe("staging Phase 1 V2 admission", () => {
  it("admits only the exact direct IPv6 or reviewed session-pooler shape", async () => {
    for (const connection of [
      {
        address: "2606:4700:4700::1111",
        host: STAGING_PHASE1_V2_DIRECT_HOST,
        port: 5432,
        user: "postgres",
        database: "postgres"
      },
      {
        address: "1.1.1.1",
        host: STAGING_PHASE1_V2_SESSION_HOST,
        port: 5432,
        user: `postgres.${PROJECT}`,
        database: "postgres"
      }
    ]) {
      const fixture = await authorizationFixture({ connection });
      const admission = admit(fixture);
      assert.equal(admission.projectRef, PROJECT);
      assert.equal(admission.policyId, POLICY);
      assert.deepEqual(admission.connection, connection);
      assert.equal((await missing(fixture.authorizationEnvelopePath)), true);
      const secrets = admission.takeSecrets();
      assert(secrets.ca.length > 0);
      assert.equal(typeof secrets.password, "string");
      assert.throws(() => admission.takeSecrets(), /secrets_reused/);
      secrets.ca.fill(0);
    }
  });

  it("rejects production and disabled runs before any DNS, socket, secret or file IO", () => {
    for (const override of [
      { projectRef: "bejvhhjbgtvctpsnlwid" },
      { enabled: false }
    ]) {
      let calls = 0;
      const io = new Proxy({}, {
        get() {
          return () => { calls += 1; throw new Error("unexpected IO"); };
        }
      });
      assert.throws(() => admitStagingPhase1V2Session({
        ...baseRequest(),
        ...override
      }, {
        env: {},
        io,
        now: () => NOW,
        gitInspection: testGitInspection()
      }), /project_ref|disabled/);
      assert.equal(calls, 0);
    }
  });

  it("rejects URLs, aliases, options, IPs, sockets, multi-hosts and transaction pooling", () => {
    const invalid = [
      { connection: { ...directConnection(), host: "127.0.0.1" } },
      { connection: { ...directConnection(), host: "::1" } },
      { connection: { ...directConnection(), host: "/private/tmp/postgres" } },
      { connection: { ...directConnection(), host: `${STAGING_PHASE1_V2_DIRECT_HOST},evil.invalid` } },
      { connection: { ...directConnection(), port: 6543 } },
      { connection: { ...directConnection(), user: "postgres options=-c role=postgres" } },
      { connection: { ...directConnection(), database: "postgres?options=-csearch_path=public" } },
      { connection: { ...directConnection(), options: "-c role=postgres" } },
      { connectionUrl: "postgresql://example.invalid/postgres" },
      { query: "sslmode=disable" }
    ];
    for (const override of invalid) {
      assert.throws(() => admitStagingPhase1V2Session({
        ...baseRequest(),
        ...override
      }, {
        env: {},
        now: () => NOW,
        gitInspection: testGitInspection()
      }), /request_fields|connection_fields|connection_target/);
    }
    for (const key of [
      "DATABASE_URL", "POSTGRES_URL", "PGHOST", "PGOPTIONS", "PGPASSWORD",
      "PGSERVICE", "PGSSLMODE", "PGTARGETSESSIONATTRS", "PGATTACKER_ALIAS",
      "NODE_TLS_REJECT_UNAUTHORIZED"
    ]) {
      assert.throws(() => admitStagingPhase1V2Session(baseRequest(), {
        env: { [key]: "attacker-controlled" },
        now: () => NOW,
        resolveCandidate: () => CANDIDATE
      }), /environment_alias/);
    }
  });

  it("consumes an expiring envelope exactly once and binds every candidate input", async () => {
    const expired = await authorizationFixture({
      envelope: { expiresAt: NOW.toISOString() }
    });
    assert.throws(() => admit(expired), /authorization_expired/);
    assert.equal(await missing(expired.authorizationEnvelopePath), true);

    for (const mutate of [
      (value) => { value.projectRef = "bejvhhjbgtvctpsnlwid"; },
      (value) => { value.policyId = "historical-portable-v1"; },
      (value) => { value.runId = randomUUID(); },
      (value) => { value.candidateCommit = "a".repeat(40); },
      (value) => { value.candidateTree = "a".repeat(40); },
      (value) => { value.connection.port = 6543; },
      (value) => { value.dataApiExposedSchemas.push("trailmind_app"); },
      (value) => { value.caSha256 = "a".repeat(64); },
      (value) => { value.providerAclRestorePlanDigest = "a".repeat(64); },
      (value) => { value.operatorDigests.files[0].sha256 = "a".repeat(64); },
      (value) => { value.operatorDigests.managedMigrationsDigest =
        "a".repeat(64); }
    ]) {
      const fixture = await authorizationFixture({ mutateEnvelope: mutate });
      assert.throws(() => admit(fixture),
        /authorization_binding|ca_digest|candidate_binding/);
    }

    const reusedId = randomUUID();
    const replayRoot = await mkdtemp(
      "/private/tmp/trailmind-phase1-v2-replay."
    );
    temporaryRoots.push(replayRoot);
    const authorizationStoreDirectory = join(replayRoot, "consumed");
    await import("node:fs/promises").then(({ mkdir }) =>
      mkdir(authorizationStoreDirectory, { mode: 0o700 }));
    const first = await authorizationFixture({
      authorizationStoreDirectory,
      envelope: { authorizationId: reusedId }
    });
    admit(first).takeSecrets().ca.fill(0);
    const second = await authorizationFixture({
      authorizationStoreDirectory,
      envelope: { authorizationId: reusedId }
    });
    assert.throws(() => admit(second), /authorization_reused/);
  });

  it("rejects linked, permissive, wrong-owner-shaped and symlink authorization inputs", async () => {
    const permissive = await authorizationFixture();
    await chmod(permissive.authorizationEnvelopePath, 0o644);
    assert.throws(() => admit(permissive), /authorization_file/);

    const symlinkFixture = await authorizationFixture();
    const original = `${symlinkFixture.authorizationEnvelopePath}.target`;
    await rename(symlinkFixture.authorizationEnvelopePath, original);
    await symlink(original, symlinkFixture.authorizationEnvelopePath);
    assert.throws(() => admit(symlinkFixture), /authorization_file/);

    const hardlinkFixture = await authorizationFixture();
    const hardlinkOriginal = `${hardlinkFixture.authorizationEnvelopePath}.target`;
    await rename(hardlinkFixture.authorizationEnvelopePath, hardlinkOriginal);
    await link(hardlinkOriginal, hardlinkFixture.authorizationEnvelopePath);
    assert.throws(() => admit(hardlinkFixture), /authorization_file/);

    const wrongOwner = await authorizationFixture();
    assert.throws(() => admitStagingPhase1V2Session(wrongOwner.request, {
      env: {},
      now: () => NOW,
      gitInspection: testGitInspection(),
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
    }), /authorization_file/);

    const linkedPassword = await authorizationFixture({ linkedPassword: true });
    assert.throws(() => admit(linkedPassword), /password_fd_linked/);
  });

  it("rejects CA replacement and never reads password before the CA binding passes", async () => {
    const fixture = await authorizationFixture({ linkedPassword: true });
    await writeFile(fixture.caPath, "replacement-ca", { mode: 0o600 });
    assert.throws(() => admit(fixture), /ca_digest/);
    const passwordMetadata = await lstat(fixture.passwordPath);
    assert.equal(passwordMetadata.size > 0, true);
  });

  it("fails closed across record, rename and unlink durability faults", async () => {
    for (const failAt of [1, 2, 3, 4]) {
      const authorizationId = randomUUID();
      const fixture = await authorizationFixture({
        envelope: { authorizationId }
      });
      let fsyncCalls = 0;
      assert.throws(() => admitStagingPhase1V2Session(fixture.request, {
        env: {}, now: () => NOW, gitInspection: testGitInspection(),
        io: {
          ...realIO(),
          fsync(descriptor) {
            fsyncCalls += 1;
            if (fsyncCalls === failAt) {
              const error = new Error("test-only fsync fault");
              error.code = "EIO";
              throw error;
            }
            return fsyncSync(descriptor);
          }
        }
      }), /authorization_record|authorization_claim/);
      const replay = await authorizationFixture({
        authorizationStoreDirectory:
          fixture.request.authorizationStoreDirectory,
        envelope: { authorizationId }
      });
      assert.throws(() => admit(replay), /authorization_reused/);
    }

    for (const operation of ["rename", "unlink"]) {
      const authorizationId = randomUUID();
      const fixture = await authorizationFixture({
        envelope: { authorizationId }
      });
      let faulted = false;
      assert.throws(() => admitStagingPhase1V2Session(fixture.request, {
        env: {}, now: () => NOW, gitInspection: testGitInspection(),
        io: {
          ...realIO(),
          [operation](...args) {
            if (!faulted) {
              faulted = true;
              const error = new Error(`test-only ${operation} fault`);
              error.code = "EIO";
              throw error;
            }
            return operation === "rename"
              ? renameSync(...args)
              : unlinkSync(...args);
          }
        }
      }), /authorization_claim/);
      const replay = await authorizationFixture({
        authorizationStoreDirectory:
          fixture.request.authorizationStoreDirectory,
        envelope: { authorizationId }
      });
      assert.throws(() => admit(replay), /authorization_reused/);
    }
  });
});

function admit(fixture) {
  return admitStagingPhase1V2Session(fixture.request, {
    env: {},
    now: () => NOW,
    gitInspection: testGitInspection()
  });
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

async function authorizationFixture({
  connection = directConnection(),
  envelope = {},
  linkedPassword = false,
  authorizationStoreDirectory: providedStoreDirectory,
  mutateEnvelope
} = {}) {
  const root = await mkdtemp("/private/tmp/trailmind-phase1-v2-admission.");
  temporaryRoots.push(root);
  const authorizationStoreDirectory = providedStoreDirectory ??
    join(root, "consumed");
  if (!providedStoreDirectory) {
    await import("node:fs/promises").then(({ mkdir }) =>
      mkdir(authorizationStoreDirectory, { mode: 0o700 }));
  }
  const caPath = join(root, "ca.pem");
  const ca = Buffer.from("test-only-ca-material\n");
  await writeFile(caPath, ca, { mode: 0o600 });
  const passwordPath = join(root, "password");
  await writeFile(passwordPath, "test-only-password", { mode: 0o600 });
  const passwordFd = openSync(passwordPath, "r");
  if (!linkedPassword) unlinkSync(passwordPath);
  const runId = randomUUID();
  const bindings = readStagingPhase1V2CandidateBindings({
    gitInspection: testGitInspection()
  });
  const authorization = {
    schemaVersion: 1,
    authorizationId: randomUUID(),
    singleUse: true,
    issuedAt: new Date(NOW.getTime() - 1_000).toISOString(),
    expiresAt: new Date(NOW.getTime() + 60_000).toISOString(),
    projectRef: PROJECT,
    policyId: POLICY,
    runId,
    candidateCommit: CANDIDATE,
    candidateTree: CANDIDATE_TREE,
    connection: { ...connection },
    dataApiExposedSchemas: ["public", "graphql_public"],
    authorizationStoreDirectorySha256: sha256(
      realpathSync(authorizationStoreDirectory)
    ),
    caSha256: sha256(ca),
    providerAclRestorePlanDigest: "d".repeat(64),
    operatorDigests: structuredClone(bindings.operatorDigests),
    ...envelope
  };
  mutateEnvelope?.(authorization);
  const authorizationEnvelopePath = join(root, "authorization.json");
  await writeFile(
    authorizationEnvelopePath,
    JSON.stringify(authorization),
    { mode: 0o600 }
  );
  return {
    authorizationEnvelopePath,
    caPath,
    passwordPath,
    request: {
      enabled: true,
      projectRef: PROJECT,
      policyId: POLICY,
      runId,
      candidateCommit: CANDIDATE,
      candidateTree: CANDIDATE_TREE,
      providerAclRestorePlanDigest: "d".repeat(64),
      connection: { ...connection },
      dataApiExposedSchemas: ["public", "graphql_public"],
      authorizationEnvelopePath,
      authorizationStoreDirectory,
      passwordFd,
      caPath
    }
  };
}

function baseRequest() {
  return {
    enabled: true,
    projectRef: PROJECT,
    policyId: POLICY,
    runId: randomUUID(),
    candidateCommit: CANDIDATE,
    candidateTree: CANDIDATE_TREE,
    providerAclRestorePlanDigest: "d".repeat(64),
    connection: directConnection(),
    dataApiExposedSchemas: ["public", "graphql_public"],
    authorizationEnvelopePath: "/private/tmp/not-read-authorization",
    authorizationStoreDirectory: "/private/tmp/not-read-store",
    passwordFd: 99,
    caPath: "/private/tmp/not-read-ca"
  };
}

function directConnection() {
  return {
    address: "2606:4700:4700::1111",
    host: STAGING_PHASE1_V2_DIRECT_HOST,
    port: 5432,
    user: "postgres",
    database: "postgres"
  };
}

function testGitInspection() {
  return () => ({
    baselineReachable: true,
    clean: true,
    head: CANDIDATE,
    root: realpathSync(new URL("../..", import.meta.url)),
    tree: CANDIDATE_TREE
  });
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function missing(path) {
  try {
    await lstat(path);
    return false;
  } catch (error) {
    if (error.code === "ENOENT") return true;
    throw error;
  }
}
