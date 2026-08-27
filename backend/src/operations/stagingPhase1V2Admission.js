import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  fsyncSync,
  fstatSync,
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
import { execFileSync } from "node:child_process";
import { isIP } from "node:net";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  STAGING_PHASE1_V2_POLICY_ID,
  STAGING_PHASE1_V2_TARGET
} from "./stagingPhase1V2Operator.js";
import {
  SUPABASE_POSTGIS_ISOLATION_MIGRATIONS_V2
} from "./stagingMigrationPolicy.js";

export const STAGING_PHASE1_V2_DIRECT_HOST =
  "db.mbvzwsrtqcrwhvykugcd.supabase.co";
export const STAGING_PHASE1_V2_SESSION_HOST =
  "aws-0-eu-central-1.pooler.supabase.com";
export const STAGING_PHASE1_V2_APPLICATION_NAME =
  "trailmind_phase1_v2_operator";
export const STAGING_PHASE1_V2_AUTHORIZATION_LIFETIME_MILLISECONDS =
  5 * 60 * 1_000;
export const STAGING_PHASE1_V2_REVIEWED_BASELINE =
  "52849b4c75cd6e5ddf00473adf8a3265160d750d";

const PRODUCTION_PROJECT_REF = "bejvhhjbgtvctpsnlwid";
const MAXIMUM_AUTHORIZATION_BYTES = 64 * 1024;
const MAXIMUM_CA_BYTES = 256 * 1024;
const MAXIMUM_PASSWORD_BYTES = 1_024;
const MAXIMUM_TRACKED_AUTHORIZATION_IDS = 4_096;
const CONSUMPTION_RETENTION_MILLISECONDS = 30 * 24 * 60 * 60 * 1_000;
const MAXIMUM_CONSUMPTION_RECORD_BYTES = 8 * 1024;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COMMIT_PATTERN = /^[a-f0-9]{40}$/;
const DIGEST_PATTERN = /^[a-f0-9]{64}$/;
const FORBIDDEN_ENVIRONMENT_KEYS = Object.freeze([
  "DATABASE_URL",
  "NODE_TLS_REJECT_UNAUTHORIZED",
  "POSTGRES_URL",
  "PGCHANNELBINDING",
  "PGDATABASE",
  "PGHOST",
  "PGHOSTADDR",
  "PGOPTIONS",
  "PGPASSFILE",
  "PGPASSWORD",
  "PGPORT",
  "PGREQUIRESSL",
  "PGSERVICE",
  "PGSERVICEFILE",
  "PGSSLCERT",
  "PGSSLKEY",
  "PGSSLMODE",
  "PGSSLROOTCERT",
  "PGTARGETSESSIONATTRS",
  "PGUSER"
]);
const REQUEST_KEYS = Object.freeze([
  "authorizationEnvelopePath",
  "authorizationStoreDirectory",
  "caPath",
  "candidateCommit",
  "candidateTree",
  "connection",
  "dataApiExposedSchemas",
  "enabled",
  "passwordFd",
  "policyId",
  "projectRef",
  "providerAclRestorePlanDigest",
  "runId"
]);
const CONNECTION_KEYS = Object.freeze([
  "address", "database", "host", "port", "user"
]);
const ENVELOPE_KEYS = Object.freeze([
  "authorizationId",
  "authorizationStoreDirectorySha256",
  "caSha256",
  "candidateCommit",
  "candidateTree",
  "connection",
  "dataApiExposedSchemas",
  "expiresAt",
  "issuedAt",
  "operatorDigests",
  "policyId",
  "projectRef",
  "providerAclRestorePlanDigest",
  "runId",
  "schemaVersion",
  "singleUse"
]);
const OPERATOR_DIGEST_KEYS = Object.freeze([
  "files",
  "managedMigrationsDigest"
]);
const EXECUTABLE_OPERATOR_FILES = Object.freeze([
  "backend/scripts/disposable/run-staging-phase1-v2-single-session-adapter.js",
  "backend/scripts/staging/phase1-v2-operator.js",
  "backend/scripts/staging/runtime/verify-build-context.js",
  "backend/src/operations/migrationRunner.js",
  "backend/src/operations/stagingMigrationCapability.js",
  "backend/src/operations/stagingMigrationPolicy.js",
  "backend/src/operations/stagingPhase1V2Admission.js",
  "backend/src/operations/stagingPhase1V2Operator.js",
  "backend/src/operations/stagingPhase1V2SingleSessionAdapter.js"
]);
const OPERATOR_SQL_FILES = Object.freeze({
  preMigration:
    "docs/operations/staging-v1/database/PHASE_1_PRE_MIGRATION_V2.sql",
  postMigration:
    "docs/operations/staging-v1/database/PHASE_1_POST_MIGRATION_V2.sql",
  preLedgerRollback:
    "docs/operations/staging-v1/database/PHASE_1_PRE_MIGRATION_V2_ROLLBACK.sql"
});
const KNOWN_MIGRATION_FILES = Object.freeze([
  ...SUPABASE_POSTGIS_ISOLATION_MIGRATIONS_V2.slice(0, 7),
  "008_outdoor_research_runtime_read_contract.sql",
  ...SUPABASE_POSTGIS_ISOLATION_MIGRATIONS_V2.slice(7)
]);
const repositoryRoot = dirname(dirname(dirname(dirname(
  fileURLToPath(import.meta.url)
))));

export class StagingPhase1V2AdmissionError extends Error {
  constructor(code) {
    super(`trailmind_phase1_v2_admission_blocked:${code}`);
    this.name = "StagingPhase1V2AdmissionError";
    this.code = code;
  }
}

export function admitStagingPhase1V2Session(request, dependencies = {}) {
  const env = dependencies.env ?? process.env;
  validateRequestBeforeIO(request, env);

  const root = resolve(dependencies.repositoryRoot ?? repositoryRoot);
  const io = dependencies.io ?? defaultIO();
  const now = exactDate((dependencies.now ?? (() => new Date()))());
  let envelope;
  let authorizationClaim;
  let authorizationEnvelopeDigest;
  let authorizationBindingDigest;
  try {
    authorizationClaim = readAuthorizationEnvelope({
      path: request.authorizationEnvelopePath,
      root,
      io
    });
    envelope = authorizationClaim.envelope;
    authorizationEnvelopeDigest = authorizationClaim.sha256;
    validateAuthorizationEnvelope(envelope, request, now);
    authorizationBindingDigest = claimAuthorizationId({
      envelope,
      envelopeSha256: authorizationEnvelopeDigest,
      directory: request.authorizationStoreDirectory,
      root,
      io,
      now
    });
    consumeAuthorizationEnvelope({ claim: authorizationClaim, io });
  } catch (error) {
    if (authorizationClaim) {
      try { consumeAuthorizationEnvelope({ claim: authorizationClaim, io }); }
      catch { /* preserve the original fail-closed classification */ }
    }
    try { io.close(request.passwordFd); } catch { /* secret FD stays unread */ }
    throw error;
  }

  let candidateBindings;
  let ca;
  try {
    candidateBindings = readStagingPhase1V2CandidateBindings({
      repositoryRoot: root,
      io,
      gitInspection: dependencies.gitInspection
    });
    if (
      candidateBindings.candidateCommit !== request.candidateCommit ||
      candidateBindings.candidateTree !== request.candidateTree ||
      !exactOperatorDigests(
        envelope.operatorDigests,
        candidateBindings.operatorDigests
      )
    ) blocked("candidate_binding");

    ca = readProtectedFile({
      path: request.caPath,
      root,
      io,
      maximumBytes: MAXIMUM_CA_BYTES,
      code: "ca"
    });
    if (sha256(ca) !== envelope.caSha256) {
      ca.fill(0);
      blocked("ca_digest");
    }
  } catch (error) {
    try { io.close(request.passwordFd); } catch { /* secret FD stays unread */ }
    throw error;
  }

  let password;
  try {
    password = readProtectedPasswordFd({
      fd: request.passwordFd,
      io
    });
  } catch (error) {
    ca.fill(0);
    throw error;
  }
  let secretsConsumed = false;
  let disposed = false;
  const admission = {
    authorizationId: envelope.authorizationId,
    authorizationBindingDigest,
    candidateCommit: request.candidateCommit,
    candidateTree: request.candidateTree,
    connection: Object.freeze({ ...request.connection }),
    dataApiExposedSchemas: Object.freeze([...request.dataApiExposedSchemas]),
    admittedMigrations: candidateBindings.admittedMigrations,
    operatorDigests: candidateBindings.operatorDigests,
    operatorSql: candidateBindings.operatorSql,
    policyId: request.policyId,
    projectRef: request.projectRef,
    providerAclRestorePlanDigest: envelope.providerAclRestorePlanDigest,
    runId: request.runId,
    takeSecrets() {
      if (disposed || secretsConsumed) blocked("secrets_reused");
      secretsConsumed = true;
      const passwordText = password.toString("utf8");
      password.fill(0);
      return { ca, password: passwordText };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      password.fill(0);
      ca.fill(0);
    }
  };
  return Object.freeze(admission);
}

export function readStagingPhase1V2CandidateBindings({
  repositoryRoot: requestedRoot = repositoryRoot,
  io: requestedIO,
  gitInspection
} = {}) {
  const root = resolve(requestedRoot);
  const io = requestedIO ?? defaultIO();
  try {
    if (io.realpath(root) !== root) blocked("candidate_root");
  } catch (error) {
    if (error instanceof StagingPhase1V2AdmissionError) throw error;
    blocked("candidate_root");
  }
  const inspect = gitInspection ?? (() => inspectCandidateGit(root));
  const before = inspect();
  assertCandidateGit(before, root);

  const migrationDirectory = join(root, "backend/migrations");
  let managedFiles;
  try {
    managedFiles = io.readdir(migrationDirectory)
      .filter((name) => /^[0-9]{3}_[a-z0-9_]+\.sql$/.test(name))
      .sort();
  } catch {
    blocked("managed_migration_inventory");
  }
  if (!sameJson(managedFiles, [...KNOWN_MIGRATION_FILES].sort())) {
    blocked("managed_migration_inventory");
  }

  const allRelativeFiles = [
    ...EXECUTABLE_OPERATOR_FILES,
    ...Object.values(OPERATOR_SQL_FILES),
    ...SUPABASE_POSTGIS_ISOLATION_MIGRATIONS_V2.map(
      (name) => `backend/migrations/${name}`
    )
  ].sort();
  if (new Set(allRelativeFiles).size !== allRelativeFiles.length) {
    blocked("candidate_file_inventory");
  }
  const content = new Map();
  const files = allRelativeFiles.map((relativePath) => {
    const sql = readRepositoryFile(join(root, relativePath), root, io);
    content.set(relativePath, sql);
    return Object.freeze({ path: relativePath, sha256: sha256(sql) });
  });

  const after = inspect();
  assertCandidateGit(after, root);
  if (!sameJson(before, after)) blocked("candidate_changed_during_admission");

  const operatorSql = Object.freeze(Object.fromEntries(
    Object.entries(OPERATOR_SQL_FILES).map(([name, relativePath]) => [
      name,
      content.get(relativePath)
    ])
  ));
  const admittedMigrations = Object.freeze(
    SUPABASE_POSTGIS_ISOLATION_MIGRATIONS_V2.map((version) => {
      const sql = content.get(`backend/migrations/${version}`);
      return Object.freeze({ version, sql, sha256: sha256(sql) });
    })
  );
  const managedMigrationsDigest = sha256(canonicalJson(
    admittedMigrations.map(({ version, sha256: digest }) => ({
      version,
      sha256: digest
    }))
  ));
  return Object.freeze({
    candidateCommit: before.head,
    candidateTree: before.tree,
    admittedMigrations,
    operatorDigests: Object.freeze({
      files: Object.freeze(files),
      managedMigrationsDigest
    }),
    operatorSql
  });
}

function validateRequestBeforeIO(request, env) {
  if (!isExactObject(request, REQUEST_KEYS)) blocked("request_fields");
  if (request.enabled !== true) blocked("disabled");
  if (
    request.projectRef === PRODUCTION_PROJECT_REF ||
    request.projectRef !== STAGING_PHASE1_V2_TARGET.projectRef
  ) blocked("project_ref");
  if (request.policyId !== STAGING_PHASE1_V2_POLICY_ID) blocked("policy");
  if (!UUID_PATTERN.test(request.runId)) blocked("run_id");
  if (!COMMIT_PATTERN.test(request.candidateCommit)) blocked("candidate_commit");
  if (!COMMIT_PATTERN.test(request.candidateTree)) blocked("candidate_tree");
  if (!DIGEST_PATTERN.test(request.providerAclRestorePlanDigest)) {
    blocked("provider_acl_digest");
  }
  if (!isExactObject(request.connection, CONNECTION_KEYS)) {
    blocked("connection_fields");
  }
  validateConnection(request.connection);
  if (
    !Array.isArray(request.dataApiExposedSchemas) ||
    request.dataApiExposedSchemas.length !== 2 ||
    request.dataApiExposedSchemas[0] !== "public" ||
    request.dataApiExposedSchemas[1] !== "graphql_public"
  ) blocked("data_api_schemas");
  if (
    typeof request.authorizationEnvelopePath !== "string" ||
    !isAbsolute(request.authorizationEnvelopePath) ||
    typeof request.authorizationStoreDirectory !== "string" ||
    !isAbsolute(request.authorizationStoreDirectory) ||
    typeof request.caPath !== "string" ||
    !isAbsolute(request.caPath) ||
    !Number.isSafeInteger(request.passwordFd) ||
    request.passwordFd < 3
  ) blocked("protected_input");
  if (!env || typeof env !== "object") blocked("environment");
  if (
    Object.keys(env).some((key) => key.startsWith("PG")) ||
    FORBIDDEN_ENVIRONMENT_KEYS.some((key) => env[key] !== undefined)
  ) {
    blocked("environment_alias");
  }
}

function validateConnection(connection) {
  const direct = connection.host === STAGING_PHASE1_V2_DIRECT_HOST &&
    connection.user === "postgres" && isIP(connection.address) === 6;
  const session = connection.host === STAGING_PHASE1_V2_SESSION_HOST &&
    connection.user === `postgres.${STAGING_PHASE1_V2_TARGET.projectRef}` &&
    isIP(connection.address) === 4;
  if (
    (!direct && !session) ||
    connection.port !== 5432 ||
    connection.database !== "postgres" ||
    /[,/\\?\s]/.test(connection.host) ||
    connection.host.includes(":") ||
    connection.user.includes("=") ||
    connection.user.includes(" ") ||
    connection.database.includes("=") ||
    connection.database.includes(" ")
  ) blocked("connection_target");
}

function readAuthorizationEnvelope({ path, root, io }) {
  assertOutsideRepository(path, root, io, "authorization");
  let initial;
  let descriptor;
  let bytes;
  try {
    initial = io.lstat(path);
    assertProtectedRegularFile(initial, "authorization_file", {
      singleLink: true
    });
    if (initial.size === 0 || initial.size > MAXIMUM_AUTHORIZATION_BYTES) {
      blocked("authorization_size");
    }
    descriptor = io.open(path, constants.O_RDONLY | noFollowFlag());
    const opened = io.fstat(descriptor);
    assertProtectedRegularFile(opened, "authorization_file", {
      singleLink: true
    });
    if (opened.dev !== initial.dev || opened.ino !== initial.ino) {
      blocked("authorization_race");
    }
    bytes = io.readFile(descriptor);
    if (bytes.length === 0 || bytes.length > MAXIMUM_AUTHORIZATION_BYTES) {
      blocked("authorization_size");
    }
    const after = io.fstat(descriptor);
    if (
      after.dev !== opened.dev || after.ino !== opened.ino ||
      after.size !== opened.size || after.mtimeMs !== opened.mtimeMs ||
      after.ctimeMs !== opened.ctimeMs || bytes.length !== opened.size
    ) blocked("authorization_race");
    const text = bytes.toString("utf8");
    if (Buffer.byteLength(text, "utf8") !== bytes.length) {
      blocked("authorization_json");
    }
    return Object.freeze({
      dev: initial.dev,
      envelope: JSON.parse(text),
      ino: initial.ino,
      path,
      sha256: sha256(bytes)
    });
  } catch (error) {
    if (error instanceof StagingPhase1V2AdmissionError) throw error;
    blocked("authorization_json");
  } finally {
    bytes?.fill?.(0);
    if (descriptor !== undefined) {
      try { io.close(descriptor); } catch { blocked("authorization_file"); }
    }
  }
}

function consumeAuthorizationEnvelope({ claim, io }) {
  const parent = dirname(claim.path);
  const claimedPath = `${claim.path}.consuming-${process.pid}-${randomUUID()}`;
  let renamed = false;
  let removed = false;
  try {
    const before = io.lstat(claim.path);
    assertProtectedRegularFile(before, "authorization_file", {
      singleLink: true
    });
    if (before.dev !== claim.dev || before.ino !== claim.ino) {
      blocked("authorization_race");
    }
    io.rename(claim.path, claimedPath);
    renamed = true;
    fsyncProtectedDirectory(parent, io, "authorization_claim");
    const after = io.lstat(claimedPath);
    assertProtectedRegularFile(after, "authorization_file", {
      singleLink: true
    });
    if (after.dev !== claim.dev || after.ino !== claim.ino) {
      blocked("authorization_race");
    }
    io.unlink(claimedPath);
    removed = true;
    fsyncProtectedDirectory(parent, io, "authorization_claim");
  } catch (error) {
    if (error instanceof StagingPhase1V2AdmissionError) throw error;
    blocked("authorization_claim");
  } finally {
    if (renamed && !removed) {
      try {
        io.unlink(claimedPath);
        fsyncProtectedDirectory(parent, io, "authorization_claim");
      } catch {
        // The durable consumed record remains authoritative after a crash.
      }
    }
  }
}

function validateAuthorizationEnvelope(envelope, request, now) {
  if (!isExactObject(envelope, ENVELOPE_KEYS)) blocked("authorization_fields");
  if (
    envelope.schemaVersion !== 1 ||
    envelope.singleUse !== true ||
    !UUID_PATTERN.test(envelope.authorizationId) ||
    envelope.projectRef !== request.projectRef ||
    envelope.policyId !== request.policyId ||
    envelope.runId !== request.runId ||
    envelope.candidateCommit !== request.candidateCommit ||
    envelope.candidateTree !== request.candidateTree ||
    envelope.providerAclRestorePlanDigest !==
      request.providerAclRestorePlanDigest ||
    !sameJson(envelope.connection, request.connection) ||
    !sameJson(envelope.dataApiExposedSchemas, request.dataApiExposedSchemas) ||
    !DIGEST_PATTERN.test(envelope.caSha256) ||
    !DIGEST_PATTERN.test(envelope.authorizationStoreDirectorySha256) ||
    !DIGEST_PATTERN.test(envelope.providerAclRestorePlanDigest) ||
    !isExactObject(envelope.operatorDigests, OPERATOR_DIGEST_KEYS)
  ) blocked("authorization_binding");
  const issuedAt = exactDate(new Date(envelope.issuedAt));
  const expiresAt = exactDate(new Date(envelope.expiresAt));
  const lifetime = expiresAt.getTime() - issuedAt.getTime();
  if (
    issuedAt.getTime() > now.getTime() ||
    expiresAt.getTime() <= now.getTime() ||
    lifetime <= 0 ||
    lifetime > STAGING_PHASE1_V2_AUTHORIZATION_LIFETIME_MILLISECONDS
  ) blocked("authorization_expired");
}

function claimAuthorizationId({
  envelope,
  envelopeSha256,
  directory,
  root,
  io,
  now
}) {
  assertOutsideRepository(directory, root, io, "authorization_store");
  let metadata;
  let realDirectory;
  try {
    metadata = io.lstat(directory);
    realDirectory = io.realpath(directory);
  } catch {
    blocked("authorization_store");
  }
  if (
    !metadata?.isDirectory?.() || metadata?.isSymbolicLink?.() ||
    (metadata.mode & 0o777) !== 0o700 ||
    metadata.uid !== process.geteuid() ||
    sha256(realDirectory) !== envelope.authorizationStoreDirectorySha256
  ) blocked("authorization_store");
  cleanupAuthorizationRecords({ directory: realDirectory, io, now });
  let entries;
  try { entries = io.readdir(realDirectory); } catch { blocked("authorization_store"); }
  if (entries.length >= MAXIMUM_TRACKED_AUTHORIZATION_IDS) {
    blocked("authorization_capacity");
  }

  const binding = Object.freeze({
    authorizationId: envelope.authorizationId,
    authorizationEnvelopeSha256: envelopeSha256,
    candidateCommit: envelope.candidateCommit,
    candidateTree: envelope.candidateTree,
    policyId: envelope.policyId,
    projectRef: envelope.projectRef,
    runId: envelope.runId,
    targetDigest: sha256(canonicalJson({
      connection: envelope.connection,
      dataApiExposedSchemas: envelope.dataApiExposedSchemas,
      providerAclRestorePlanDigest: envelope.providerAclRestorePlanDigest
    }))
  });
  const bindingDigest = sha256(canonicalJson(binding));
  const record = Buffer.from(canonicalJson({
    schemaVersion: 1,
    ...binding,
    bindingDigest,
    consumedAt: now.toISOString(),
    expiresAt: envelope.expiresAt,
    retainUntil: new Date(
      now.getTime() + CONSUMPTION_RETENTION_MILLISECONDS
    ).toISOString()
  }), "utf8");
  const recordPath = join(realDirectory, `${envelope.authorizationId}.consumed`);
  let descriptor;
  try {
    descriptor = io.open(
      recordPath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollowFlag(),
      0o600
    );
    let written = 0;
    while (written < record.length) {
      const count = io.write(
        descriptor,
        record,
        written,
        record.length - written,
        null
      );
      if (!Number.isInteger(count) || count <= 0) blocked("authorization_record");
      written += count;
    }
    io.fsync(descriptor);
    const created = io.fstat(descriptor);
    assertProtectedRegularFile(created, "authorization_record", {
      singleLink: true
    });
    if (created.size !== record.length) blocked("authorization_record");
    fsyncProtectedDirectory(realDirectory, io, "authorization_record");
  } catch (error) {
    if (error instanceof StagingPhase1V2AdmissionError) throw error;
    if (error?.code === "EEXIST") blocked("authorization_reused");
    blocked("authorization_record");
  } finally {
    record.fill(0);
    if (descriptor !== undefined) {
      try { io.close(descriptor); } catch { blocked("authorization_record"); }
    }
  }
  return bindingDigest;
}

function cleanupAuthorizationRecords({ directory, io, now }) {
  let entries;
  try { entries = io.readdir(directory); } catch { blocked("authorization_store"); }
  for (const name of entries.sort()) {
    if (!/^[0-9a-f-]{36}\.consumed$/i.test(name)) continue;
    const path = join(directory, name);
    let bytes;
    let remove = false;
    try {
      const metadata = io.lstat(path);
      assertProtectedRegularFile(metadata, "authorization_record", {
        singleLink: true
      });
      if (metadata.size === 0 || metadata.size > MAXIMUM_CONSUMPTION_RECORD_BYTES) {
        continue;
      }
      bytes = io.readFile(path);
      const record = JSON.parse(bytes.toString("utf8"));
      const expiresAt = new Date(record.expiresAt);
      const retainUntil = new Date(record.retainUntil);
      if (
        !Number.isNaN(expiresAt.getTime()) &&
        !Number.isNaN(retainUntil.getTime()) &&
        expiresAt <= now && retainUntil <= now
      ) remove = true;
    } catch {
      // Malformed records remain durable and count toward the bounded capacity.
    } finally {
      bytes?.fill?.(0);
    }
    if (remove) {
      try {
        io.unlink(path);
        fsyncProtectedDirectory(directory, io, "authorization_record");
      } catch {
        blocked("authorization_record");
      }
    }
  }
}

function fsyncProtectedDirectory(path, io, code) {
  let descriptor;
  try {
    descriptor = io.open(
      path,
      constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | noFollowFlag()
    );
    const metadata = io.fstat(descriptor);
    if (
      !metadata?.isDirectory?.() || metadata?.isSymbolicLink?.() ||
      (metadata.mode & 0o777) !== 0o700 ||
      metadata.uid !== process.geteuid()
    ) blocked(code);
    io.fsync(descriptor);
  } catch (error) {
    if (error instanceof StagingPhase1V2AdmissionError) throw error;
    blocked(code);
  } finally {
    if (descriptor !== undefined) {
      try { io.close(descriptor); } catch { blocked(code); }
    }
  }
}

function readProtectedFile({ path, root, io, maximumBytes, code }) {
  assertOutsideRepository(path, root, io, code);
  let descriptor;
  try {
    const metadata = io.lstat(path);
    assertProtectedRegularFile(metadata, code);
    descriptor = io.open(path, constants.O_RDONLY | noFollowFlag());
    const opened = io.fstat(descriptor);
    assertProtectedRegularFile(opened, code);
    if (opened.dev !== metadata.dev || opened.ino !== metadata.ino) {
      blocked(`${code}_race`);
    }
    if (opened.size === 0 || opened.size > maximumBytes) {
      blocked(`${code}_size`);
    }
    const value = io.readFile(descriptor);
    const after = io.fstat(descriptor);
    if (
      value.length !== opened.size || value.length > maximumBytes ||
      after.dev !== opened.dev || after.ino !== opened.ino ||
      after.size !== opened.size || after.mtimeMs !== opened.mtimeMs ||
      after.ctimeMs !== opened.ctimeMs
    ) {
      value.fill(0);
      blocked(`${code}_size`);
    }
    return value;
  } catch (error) {
    if (error instanceof StagingPhase1V2AdmissionError) throw error;
    blocked(code);
  } finally {
    if (descriptor !== undefined) {
      try { io.close(descriptor); } catch { /* bounded fail-closed read */ }
    }
  }
}

function readProtectedPasswordFd({ fd, io }) {
  const output = Buffer.alloc(MAXIMUM_PASSWORD_BYTES + 1);
  try {
    const metadata = io.fstat(fd);
    assertProtectedRegularFile(metadata, "password_fd");
    if (metadata.nlink !== 0) blocked("password_fd_linked");
    let total = 0;
    while (total <= MAXIMUM_PASSWORD_BYTES) {
      const count = io.read(fd, output, total, output.length - total, null);
      if (count === 0) break;
      total += count;
    }
    if (total === 0 || total > MAXIMUM_PASSWORD_BYTES) {
      blocked("password_size");
    }
    const password = Buffer.from(output.subarray(0, total));
    const normalized = password.toString("utf8");
    if (
      Buffer.byteLength(normalized, "utf8") !== password.length ||
      /[\u0000-\u001f\u007f]/.test(normalized)
    ) {
      password.fill(0);
      blocked("password_format");
    }
    return password;
  } catch (error) {
    if (error instanceof StagingPhase1V2AdmissionError) throw error;
    blocked("password_fd");
  } finally {
    output.fill(0);
    try { io.close(fd); } catch { /* inherited descriptor is consumed */ }
  }
}

function readRepositoryFile(path, root, io) {
  const resolved = resolve(path);
  if (!isInside(resolved, root)) blocked("candidate_path");
  let descriptor;
  try {
    const before = io.lstat(resolved);
    assertProtectedRepositoryFile(before);
    descriptor = io.open(resolved, constants.O_RDONLY | noFollowFlag());
    const opened = io.fstat(descriptor);
    assertProtectedRepositoryFile(opened);
    if (before.dev !== opened.dev || before.ino !== opened.ino) {
      blocked("candidate_file_race");
    }
    const value = io.readFile(descriptor);
    const after = io.fstat(descriptor);
    if (
      value.length === 0 || value.length !== opened.size ||
      after.dev !== opened.dev || after.ino !== opened.ino ||
      after.size !== opened.size || after.mtimeMs !== opened.mtimeMs ||
      after.ctimeMs !== opened.ctimeMs
    ) blocked("candidate_file_race");
    const text = value.toString("utf8");
    if (Buffer.byteLength(text, "utf8") !== value.length) {
      blocked("candidate_file_encoding");
    }
    return text;
  } catch (error) {
    if (error instanceof StagingPhase1V2AdmissionError) throw error;
    blocked("candidate_file");
  } finally {
    if (descriptor !== undefined) {
      try { io.close(descriptor); } catch { blocked("candidate_file"); }
    }
  }
}

function assertOutsideRepository(path, root, io, code) {
  if (!isAbsolute(path) || isInside(resolve(path), root)) blocked(`${code}_path`);
  try {
    const parent = io.realpath(dirname(path));
    const resolvedPath = join(parent, path.slice(dirname(path).length + 1));
    if (isInside(resolvedPath, root)) blocked(`${code}_path`);
  } catch (error) {
    if (error instanceof StagingPhase1V2AdmissionError) throw error;
    blocked(`${code}_path`);
  }
}

function assertProtectedRegularFile(metadata, code, { singleLink = false } = {}) {
  if (
    !metadata?.isFile?.() ||
    metadata?.isSymbolicLink?.() ||
    (metadata.mode & 0o777) !== 0o600 ||
    metadata.uid !== process.geteuid() ||
    (singleLink && metadata.nlink !== 1)
  ) blocked(code);
}

function assertProtectedRepositoryFile(metadata) {
  if (
    !metadata?.isFile?.() || metadata?.isSymbolicLink?.() ||
    metadata.nlink !== 1 || metadata.size <= 0
  ) blocked("candidate_file");
}

function exactOperatorDigests(actual, expected) {
  return isExactObject(actual, OPERATOR_DIGEST_KEYS) &&
    DIGEST_PATTERN.test(actual.managedMigrationsDigest) &&
    Array.isArray(actual.files) && actual.files.length > 0 &&
    actual.files.every((file) =>
      isExactObject(file, ["path", "sha256"]) &&
      typeof file.path === "string" && !isAbsolute(file.path) &&
      !file.path.split("/").includes("..") &&
      DIGEST_PATTERN.test(file.sha256)) &&
    sameJson(actual, expected);
}

function inspectCandidateGit(root) {
  const run = (args, options = {}) => execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    ...options
  });
  try {
    const head = run(["rev-parse", "HEAD"]).trim();
    const tree = run(["rev-parse", "HEAD^{tree}"]).trim();
    const topLevel = run(["rev-parse", "--show-toplevel"]).trim();
    const status = run([
      "status", "--porcelain=v1", "-z", "--untracked-files=all"
    ]);
    run([
      "merge-base", "--is-ancestor", STAGING_PHASE1_V2_REVIEWED_BASELINE,
      head
    ]);
    return Object.freeze({
      baselineReachable: true,
      clean: status.length === 0,
      head,
      root: resolve(topLevel),
      tree
    });
  } catch {
    blocked("candidate_git");
  }
}

function assertCandidateGit(value, root) {
  if (
    !isExactObject(value, [
      "baselineReachable", "clean", "head", "root", "tree"
    ]) ||
    value.baselineReachable !== true || value.clean !== true ||
    !COMMIT_PATTERN.test(value.head) || !COMMIT_PATTERN.test(value.tree) ||
    resolve(value.root) !== root
  ) blocked("candidate_git");
}

function isInside(path, root) {
  const child = relative(root, path);
  return child === "" || (!child.startsWith(`..${sep}`) && child !== "..");
}

function isExactObject(value, expectedKeys) {
  return value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    sameJson(Object.keys(value).sort(), [...expectedKeys].sort());
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function exactDate(value) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    blocked("time");
  }
  return value;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function noFollowFlag() {
  return constants.O_NOFOLLOW ?? 0;
}

function defaultIO() {
  return Object.freeze({
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
  });
}

function blocked(code) {
  throw new StagingPhase1V2AdmissionError(code);
}
