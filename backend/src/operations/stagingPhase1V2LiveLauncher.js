import {
  createHash,
  randomUUID,
  X509Certificate
} from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmdirSync,
  unlinkSync,
  writeSync
} from "node:fs";
import { isIP } from "node:net";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import {
  admitStagingPhase1V2Session,
  readStagingPhase1V2CandidateBindings,
  STAGING_PHASE1_V2_AUTHORIZATION_LIFETIME_MILLISECONDS,
  STAGING_PHASE1_V2_DIRECT_HOST,
  STAGING_PHASE1_V2_LIVE_BOUNDARY_PACKAGE_VERSION,
  STAGING_PHASE1_V2_SESSION_HOST
} from "./stagingPhase1V2Admission.js";
import {
  canonicalAclDigest,
  STAGING_PHASE1_V2_POLICY_ID,
  STAGING_PHASE1_V2_TARGET
} from "./stagingPhase1V2Operator.js";
import {
  runAuthorizedStagingPhase1V2SingleSession
} from "./stagingPhase1V2SingleSessionAdapter.js";
import {
  attachStagingPhase1V2ProductionDatabaseAuditor,
  assertSyntheticStagingPhase1V2ObserverSession,
  createSyntheticStagingPhase1V2ObserverFactory,
  createSyntheticStagingPhase1V2ObserverSession,
  disposeStagingPhase1V2ProductionObserverSession,
  machineCleanupEvidence,
  machineControlSnapshot,
  machinePostAdvisorEvidence,
  observeStagingPhase1V2MachinePhase,
  prepareStagingPhase1V2ProductionPreControl,
  requireReviewedStagingPhase1V2ProductionObserverFactory,
  STAGING_PHASE1_V2_REVIEWED_PRODUCTION_OBSERVER_FACTORY,
  StagingPhase1V2MachineObserverError
} from "./stagingPhase1V2MachineObserver.js";

const MAXIMUM_PASSWORD_BYTES = 1_024;
const MAXIMUM_CONTROL_CREDENTIAL_BYTES = 8 * 1_024;
const MAXIMUM_CA_BYTES = 256 * 1_024;
const CA_MAXIMUM_AGE_MILLISECONDS = 5 * 60 * 1_000;
const DEFAULT_PROMPT_TIMEOUT_MILLISECONDS = 60_000;
const BRACKETED_PASTE_ENABLE = "\u001b[?2004h";
const BRACKETED_PASTE_DISABLE = "\u001b[?2004l";
const LIVE_CONFIRMATION =
  "AUTHORIZE_TRAILMIND_STAGING_MBVZWSRTQCRWHVYKUGCD_ACTIVE_FREE_NANO_USD0_EUCENTRAL1_PG17";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FEATURE_FLAGS = Object.freeze([
  "OUTDOOR_EVIDENCE_ENABLED",
  "RESEARCH_GUIDED_PLANNING_ENABLED",
  "ROUTABLE_HIGHLIGHT_ACCESS_ENABLED",
  "OUTDOOR_EVIDENCE_PROVIDER_ENABLED",
  "OUTDOOR_RESEARCH_PLANNING_ENABLED",
  "OUTDOOR_ROUTABLE_HIGHLIGHT_ACCESS_ENABLED",
  "ROUTE_PROVIDER_ENABLED",
  "INTENT_PROVIDER_ENABLED",
  "OUTDOOR_RESEARCH_PLANNING_ALLOW_INSECURE_LOCAL",
  "ROUTE_ALLOW_INSECURE_LOCAL_ROUTING",
  "INTENT_ALLOW_INSECURE_LOCAL_PARSING",
  "APP_ATTEST_ALLOW_IN_MEMORY",
  "INTENT_ALLOW_DETERMINISTIC_MOCK"
]);
const FORBIDDEN_ENVIRONMENT_KEYS = Object.freeze([
  "DATABASE_URL", "DATABASE_PASSWORD", "NODE_TLS_REJECT_UNAUTHORIZED",
  "POSTGRES_URL", "SUPABASE_ACCESS_TOKEN", "SUPABASE_DB_PASSWORD"
]);
const TARGET_BINDING = deepFreeze({
  databaseName: "postgres",
  monthlyCostUsd: STAGING_PHASE1_V2_TARGET.monthlyCost.amount,
  organizationId: STAGING_PHASE1_V2_TARGET.organizationId,
  organizationName: STAGING_PHASE1_V2_TARGET.organizationName,
  organizationPlan: STAGING_PHASE1_V2_TARGET.organizationPlan,
  postgresMajor: STAGING_PHASE1_V2_TARGET.postgresMajor,
  projectName: STAGING_PHASE1_V2_TARGET.projectName,
  projectRef: STAGING_PHASE1_V2_TARGET.projectRef,
  region: STAGING_PHASE1_V2_TARGET.region,
  regionLabel: STAGING_PHASE1_V2_TARGET.regionLabel
});

export class StagingPhase1V2LiveLauncherError extends Error {
  constructor(code) {
    super(`trailmind_phase1_v2_live_launcher_blocked:${code}`);
    this.name = "StagingPhase1V2LiveLauncherError";
    this.code = code;
  }
}

export function liveLauncherHelp() {
  return [
    "TrailMind Phase 1 V2 staging launcher",
    "",
    "Usage:",
    "  node scripts/staging/phase1-v2-operator.js --preflight-only",
    "  node scripts/staging/phase1-v2-operator.js --ca-file <absolute-path> --endpoint <direct|session> --address <exact-ip>",
    "",
    "The live command accepts only the fixed TrailMind staging target.",
    "Live execution uses the internal authenticated production observer only.",
    "A scoped read-only Supabase OAuth token and independent database auditor",
    "are required before mutation.",
    "Preflight uses synthetic, non-authorizing observations and performs no network or database work.",
    "Connection URLs, host/user overrides, secret arguments, piped input, and transaction pooling are rejected."
  ].join("\n");
}

export function parseLiveLauncherArguments(argv) {
  if (!Array.isArray(argv) || argv.some((value) => typeof value !== "string")) {
    blocked("arguments");
  }
  if (argv.length === 0) {
    blocked("remote_adapter_required_and_execution_not_authorized");
  }
  if (argv.some((value) =>
    /postgres(?:ql)?:\/\//i.test(value) ||
    /(?:password|credential|secret|token|clipboard|stdin|connection[-_]?string|database[-_]?url|sslmode|options)/i
      .test(value)
  )) blocked("secret_input_source");
  if (argv.length === 1 && ["--help", "-h"].includes(argv[0])) {
    return Object.freeze({ mode: "help" });
  }
  if (argv.length === 1 && argv[0] === "--preflight-only") {
    return Object.freeze({ mode: "preflight" });
  }
  const allowed = new Set(["--ca-file", "--endpoint", "--address"]);
  const parsed = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!allowed.has(key) || value === undefined || value.startsWith("--") ||
        Object.hasOwn(parsed, key)) blocked("arguments");
    parsed[key] = value;
  }
  if (Object.keys(parsed).length !== allowed.size) blocked("arguments");
  if (!["direct", "session"].includes(parsed["--endpoint"])) {
    blocked("endpoint_class");
  }
  if (!isAbsolute(parsed["--ca-file"])) blocked("ca_path");
  validateAddress(parsed["--address"], parsed["--endpoint"]);
  return Object.freeze({
    address: parsed["--address"],
    caPath: resolve(parsed["--ca-file"]),
    endpointClass: parsed["--endpoint"],
    mode: "live"
  });
}

export async function runStagingPhase1V2LiveLauncher(options, dependencies = {}) {
  if (options?.mode === "preflight") {
    return runStagingPhase1V2PreflightOnly(dependencies);
  }
  if (options?.mode !== "live") blocked("mode");
  assertNoProductionDependencyOverrides(dependencies);
  const env = process.env;
  const tty = createProcessTty();
  assertSafeEnvironment(env);
  if (tty.isTTY !== true) blocked("tty_required");
  let observerFactory;
  try {
    observerFactory = requireReviewedStagingPhase1V2ProductionObserverFactory(
      STAGING_PHASE1_V2_REVIEWED_PRODUCTION_OBSERVER_FACTORY
    );
  } catch (error) {
    throw sanitizeLauncherFailure(error);
  }

  const now = () => new Date();
  const repositoryRoot = resolve(
    dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))
  );
  const attemptId = randomUUID();
  const runId = randomUUID();
  const authorizationId = randomUUID();
  assertDistinctIdentities({ attemptId, runId, authorizationId });
  const task = createAttemptDirectory({
    attemptId,
    baseDirectory: tmpdir(),
    repositoryRoot
  });
  const cancellation = createCancellation({
    providedSignal: undefined,
    signalSource: process
  });
  const signal = cancellation.signal;
  let secret;
  let controlCredential;
  let credential;
  let observerSession;
  let envelopePath;
  let adapterInvoked = false;
  try {
    const candidateBindings = readStagingPhase1V2CandidateBindings({
      repositoryRoot
    });
    const observerBinding = Object.freeze({
      attemptId,
      candidateCommit: candidateBindings.candidateCommit,
      candidateTree: candidateBindings.candidateTree,
      organizationId: STAGING_PHASE1_V2_TARGET.organizationId,
      projectRef: STAGING_PHASE1_V2_TARGET.projectRef,
      region: STAGING_PHASE1_V2_TARGET.region,
      runId
    });
    secret = await tty.readSecret(
      "Supabase read-only OAuth access token: ",
      { maximumBytes: MAXIMUM_CONTROL_CREDENTIAL_BYTES, signal,
        timeoutMilliseconds: boundedPromptTimeout(
          undefined
        ) }
    );
    validateSecretBuffer(secret, MAXIMUM_CONTROL_CREDENTIAL_BYTES);
    controlCredential = createUnlinkedCredential({
      directory: task.path,
      password: secret,
      maximumBytes: MAXIMUM_CONTROL_CREDENTIAL_BYTES,
      io: undefined
    });
    secret.fill(0);
    secret = undefined;
    unlinkCredentialBeforeDatabase(controlCredential);
    observerSession = observerFactory.createSession(observerBinding, {
      controlCredentialFd: controlCredential.fd
    });
    const preRequest = Object.freeze({
      applicationName: null,
      authorizationBindingDigest: null,
      backendPid: null,
      phase: "pre-control",
      stagedReceiptDigest: null
    });
    await prepareStagingPhase1V2ProductionPreControl(
      observerSession, preRequest
    );
    const ca = inspectCertificateAuthority({
      path: options.caPath,
      repositoryRoot,
      now: exactDate(now()),
      io: undefined
    });
    const connection = liveConnection(options.endpointClass, options.address);
    const tls = tlsBinding(connection.host);
    await collectActionAuthorization({
      tty, now, signal,
      promptTimeoutMilliseconds: undefined
    });
    secret = await tty.readSecret(
      "Database password: ",
      { maximumBytes: MAXIMUM_PASSWORD_BYTES, signal,
        timeoutMilliseconds: boundedPromptTimeout(
          undefined
        ) }
    );
    validateSecretBuffer(secret, MAXIMUM_PASSWORD_BYTES);
    credential = createUnlinkedCredentialPair({
      directory: task.path,
      password: secret,
      io: undefined
    });
    secret.fill(0);
    secret = undefined;
    unlinkCredentialPairBeforeDatabase(credential);
    await attachStagingPhase1V2ProductionDatabaseAuditor(
      observerSession,
      {
        auditorCredentialFd: credential.auditorFd,
        caPath: ca.path,
        connection
      }
    );
    const preObservation = await observeStagingPhase1V2MachinePhase(
      observerSession, preRequest
    );
    const boundaries = createStagingPhase1V2LiveBoundaryPackage({
      attemptDirectory: task.path,
      env,
      now,
      observerSession,
      preObservation,
      runId,
      attemptId,
      candidateCommit: candidateBindings.candidateCommit,
      candidateTree: candidateBindings.candidateTree
    });
    const controlObservationDigest = preObservation.artifactDigest;
    const credentialContainment = credentialContainmentBinding();
    const issuedAt = exactDate(now());
    const expiresAt = new Date(issuedAt.getTime() +
      STAGING_PHASE1_V2_AUTHORIZATION_LIFETIME_MILLISECONDS);
    const envelope = deepFreeze({
      schemaVersion: 1,
      attemptId,
      authorizationId,
      singleUse: true,
      issuedAt: issuedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      projectRef: STAGING_PHASE1_V2_TARGET.projectRef,
      policyId: STAGING_PHASE1_V2_POLICY_ID,
      runId,
      candidateCommit: candidateBindings.candidateCommit,
      candidateTree: candidateBindings.candidateTree,
      connection,
      controlObservationDigest,
      endpointClass: options.endpointClass,
      gitAttestation: candidateBindings.gitAttestation,
      target: TARGET_BINDING,
      tls,
      credentialContainment,
      liveBoundaryPackageVersion:
        STAGING_PHASE1_V2_LIVE_BOUNDARY_PACKAGE_VERSION,
      dataApiExposedSchemas: ["public", "graphql_public"],
      authorizationStoreDirectorySha256: sha256(
        realpathSync(task.authorizationStoreDirectory)
      ),
      caSha256: ca.sha256,
      providerAclRestorePlanDigest:
        preObservation.evidence.providerAclRestorePlanDigest,
      operatorDigests: candidateBindings.operatorDigests
    });
    envelopePath = createAuthorizationEnvelope({
      directory: task.path,
      envelope,
      io: undefined
    });
    revalidateCertificateAuthority(ca);
    const admissionRequest = Object.freeze({
      enabled: true,
      attemptId,
      projectRef: STAGING_PHASE1_V2_TARGET.projectRef,
      policyId: STAGING_PHASE1_V2_POLICY_ID,
      runId,
      candidateCommit: candidateBindings.candidateCommit,
      candidateTree: candidateBindings.candidateTree,
      providerAclRestorePlanDigest:
        preObservation.evidence.providerAclRestorePlanDigest,
      connection,
      controlObservationDigest,
      endpointClass: options.endpointClass,
      gitAttestation: candidateBindings.gitAttestation,
      target: TARGET_BINDING,
      tls,
      credentialContainment,
      liveBoundaryPackageVersion:
        STAGING_PHASE1_V2_LIVE_BOUNDARY_PACKAGE_VERSION,
      dataApiExposedSchemas: ["public", "graphql_public"],
      authorizationEnvelopePath: envelopePath,
      authorizationStoreDirectory: task.authorizationStoreDirectory,
      passwordFd: credential.fd,
      caPath: ca.path
    });
    adapterInvoked = true;
    const result = await runAuthorizedStagingPhase1V2SingleSession({
      admissionRequest, ...boundaries
    }, {
      signal
    });
    return Object.freeze({
      attemptId,
      runId,
      receiptDigest: result.receiptDigest,
      status: result.receipt.status,
      artifactDirectory: task.path
    });
  } catch (error) {
    throw sanitizeLauncherFailure(error);
  } finally {
    cancellation.dispose();
    secret?.fill?.(0);
    closeCredential(credential);
    closeCredential(controlCredential);
    await disposeStagingPhase1V2ProductionObserverSession(observerSession);
    invalidateEnvelope(envelopePath);
    if (!adapterInvoked) {
      persistAttemptInvalidation({
        attemptDirectory: task.path,
        attemptId,
        now: exactDate(now()),
        io: undefined
      });
    }
  }
}

export async function runStagingPhase1V2PreflightOnly(dependencies = {}) {
  const network = dependencies.networkCounter ?? { calls: 0 };
  const database = dependencies.databaseCounter ?? { calls: 0 };
  assertSafeEnvironment(dependencies.env ?? process.env);
  const now = dependencies.now ?? (() => new Date());
  const tty = dependencies.tty ?? syntheticPreflightTty();
  if (tty.isTTY !== true || typeof tty.readSecret !== "function") {
    blocked("tty_required");
  }
  const repositoryRoot = resolve(dependencies.repositoryRoot ??
    dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url))))));
  const ids = [
    (dependencies.randomUUID ?? randomUUID)(),
    (dependencies.randomUUID ?? randomUUID)(),
    (dependencies.randomUUID ?? randomUUID)()
  ];
  const [attemptId, runId, authorizationId] = ids;
  assertDistinctIdentities({ attemptId, runId, authorizationId });
  const task = createAttemptDirectory({
    attemptId,
    baseDirectory: dependencies.temporaryBase ?? tmpdir(),
    repositoryRoot
  });
  let credential;
  let admission;
  let password;
  const observerPhases = [];
  try {
    const caPath = join(task.path, "synthetic-ca.pem");
    (dependencies.createSyntheticCa ?? createSyntheticCa)(caPath, task.path);
    const ca = inspectCertificateAuthority({
      path: caPath, repositoryRoot, now: exactDate(now()), io: dependencies.io
    });
    const bindings = readStagingPhase1V2CandidateBindings({
      repositoryRoot,
      gitInspection: dependencies.gitInspection
    });
    const observerBinding = Object.freeze({
      attemptId,
      candidateCommit: bindings.candidateCommit,
      candidateTree: bindings.candidateTree,
      organizationId: STAGING_PHASE1_V2_TARGET.organizationId,
      projectRef: STAGING_PHASE1_V2_TARGET.projectRef,
      region: STAGING_PHASE1_V2_TARGET.region,
      runId
    });
    const observerFactory = dependencies.syntheticObserverFactory ??
      createSyntheticStagingPhase1V2ObserverFactory({
        now,
        randomId: dependencies.observerRandomUUID ?? randomUUID,
        onObservation: (phase) => observerPhases.push(phase)
      });
    const observerSession = createSyntheticStagingPhase1V2ObserverSession(
      observerFactory, observerBinding
    );
    assertSyntheticStagingPhase1V2ObserverSession(observerSession);
    const preObservation = await observeStagingPhase1V2MachinePhase(
      observerSession,
      {
        applicationName: null,
        authorizationBindingDigest: null,
        backendPid: null,
        phase: "pre-control",
        stagedReceiptDigest: null
      }
    );
    const boundaries = createStagingPhase1V2LiveBoundaryPackage({
      attemptDirectory: task.path,
      attemptId,
      candidateCommit: bindings.candidateCommit,
      candidateTree: bindings.candidateTree,
      env: {},
      now,
      observerSession,
      preObservation,
      runId
    });
    await boundaries.controlPlane.inspectPre({
      projectRef: STAGING_PHASE1_V2_TARGET.projectRef,
      readOnly: true
    });
    await boundaries.containmentControl.assertAllDisabled({
      projectRef: STAGING_PHASE1_V2_TARGET.projectRef,
      readOnly: true
    });
    password = await tty.readSecret("Synthetic preflight password: ", {
      maximumBytes: MAXIMUM_PASSWORD_BYTES,
      signal: dependencies.signal,
      timeoutMilliseconds: boundedPromptTimeout(
        dependencies.promptTimeoutMilliseconds
      )
    });
    validateSecretBuffer(password);
    credential = createUnlinkedCredentialPair({
      directory: task.path, password, io: dependencies.io
    });
    password.fill(0);
    const connection = liveConnection(
      "direct", "2606:4700:4700::1111"
    );
    const issuedAt = exactDate(now());
    const credentialContainment = credentialContainmentBinding();
    const envelope = {
      schemaVersion: 1,
      attemptId,
      authorizationId,
      singleUse: true,
      issuedAt: issuedAt.toISOString(),
      expiresAt: new Date(issuedAt.getTime() + 60_000).toISOString(),
      projectRef: STAGING_PHASE1_V2_TARGET.projectRef,
      policyId: STAGING_PHASE1_V2_POLICY_ID,
      runId,
      candidateCommit: bindings.candidateCommit,
      candidateTree: bindings.candidateTree,
      connection,
      controlObservationDigest: preObservation.artifactDigest,
      endpointClass: "direct",
      gitAttestation: bindings.gitAttestation,
      target: TARGET_BINDING,
      tls: tlsBinding(connection.host),
      credentialContainment,
      liveBoundaryPackageVersion:
        STAGING_PHASE1_V2_LIVE_BOUNDARY_PACKAGE_VERSION,
      dataApiExposedSchemas: ["public", "graphql_public"],
      authorizationStoreDirectorySha256: sha256(
        realpathSync(task.authorizationStoreDirectory)
      ),
      caSha256: ca.sha256,
      providerAclRestorePlanDigest:
        preObservation.evidence.providerAclRestorePlanDigest,
      operatorDigests: bindings.operatorDigests
    };
    const envelopePath = createAuthorizationEnvelope({
      directory: task.path, envelope, io: dependencies.io
    });
    unlinkCredentialPairBeforeDatabase(credential, dependencies.io);
    admission = admitStagingPhase1V2Session({
      enabled: true,
      attemptId,
      projectRef: STAGING_PHASE1_V2_TARGET.projectRef,
      policyId: STAGING_PHASE1_V2_POLICY_ID,
      runId,
      candidateCommit: bindings.candidateCommit,
      candidateTree: bindings.candidateTree,
      providerAclRestorePlanDigest:
        preObservation.evidence.providerAclRestorePlanDigest,
      connection,
      controlObservationDigest: preObservation.artifactDigest,
      endpointClass: "direct",
      gitAttestation: bindings.gitAttestation,
      target: TARGET_BINDING,
      tls: tlsBinding(connection.host),
      credentialContainment,
      liveBoundaryPackageVersion:
        STAGING_PHASE1_V2_LIVE_BOUNDARY_PACKAGE_VERSION,
      dataApiExposedSchemas: ["public", "graphql_public"],
      authorizationEnvelopePath: envelopePath,
      authorizationStoreDirectory: task.authorizationStoreDirectory,
      passwordFd: credential.fd,
      caPath
    }, {
      env: {},
      repositoryRoot,
      now,
      gitInspection: dependencies.gitInspection,
      io: dependencies.io
    });
    admission.takeSecrets().ca.fill(0);
    admission.dispose();
    admission = undefined;
    assertDescriptorClosed(credential.fd, dependencies.io);
    const lock = Object.freeze({ backendPid: 41_241 });
    await boundaries.controlPlane.inspectPostAdvisors({
      lock,
      projectRef: STAGING_PHASE1_V2_TARGET.projectRef,
      readOnly: true
    });
    await boundaries.controlPlane.inspectFinal({
      lock,
      projectRef: STAGING_PHASE1_V2_TARGET.projectRef,
      readOnly: true
    });
    await boundaries.cleanupVerifier.proveSessionClosed({
      applicationName: "trailmind_phase1_v2_operator",
      authorizationBindingDigest: "7".repeat(64),
      backendPid: lock.backendPid,
      candidateCommit: bindings.candidateCommit,
      candidateTree: bindings.candidateTree,
      operatorDigestsDigest: "8".repeat(64),
      projectRef: STAGING_PHASE1_V2_TARGET.projectRef,
      runId,
      stagedReceiptDigest: "9".repeat(64)
    });
    if (network.calls !== 0 || database.calls !== 0) {
      blocked("preflight_remote_activity");
    }
    return Object.freeze({
      status: "preflight-passed",
      localBoundaryChecks: 13,
      observerMode: "synthetic-preflight-non-authorizing",
      observerPhases: Object.freeze([...observerPhases]),
      networkCalls: 0,
      databaseCalls: 0
    });
  } finally {
    password?.fill?.(0);
    admission?.dispose?.();
    closeCredential(credential, dependencies.io);
    safelyDeletePreflightDirectory(task.path, dependencies.io);
  }
}

function createStagingPhase1V2LiveBoundaryPackage({
  attemptDirectory,
  attemptId,
  candidateCommit,
  candidateTree,
  env,
  now,
  observerSession,
  preObservation,
  runId
}) {
  assertSafeEnvironment(env);
  if (!UUID_PATTERN.test(attemptId) || !UUID_PATTERN.test(runId) ||
      !/^[a-f0-9]{40}$/.test(candidateCommit) ||
      !/^[a-f0-9]{40}$/.test(candidateTree) ||
      preObservation?.binding?.attemptId !== attemptId ||
      preObservation?.binding?.runId !== runId ||
      preObservation?.binding?.candidateCommit !== candidateCommit ||
      preObservation?.binding?.candidateTree !== candidateTree) {
    blocked("observer_binding");
  }
  const preSnapshot = machineControlSnapshot(preObservation);
  let preConsumed = false;
  const receiptStore = createDurableReceiptStore({
    directory: join(attemptDirectory, "receipts"), now
  });
  return Object.freeze({
    controlPlane: Object.freeze({
      async inspectPre(request) {
        assertBoundaryRequest(request, runId, false);
        if (preConsumed) blocked("observer_replay");
        preConsumed = true;
        return preSnapshot;
      },
      async inspectPostAdvisors(request) {
        assertBoundaryRequest(request, runId, true);
        const artifact = await observeStagingPhase1V2MachinePhase(
          observerSession,
          {
            applicationName: "trailmind_phase1_v2_operator",
            authorizationBindingDigest: null,
            backendPid: request.lock.backendPid,
            phase: "post-ddl-advisors",
            stagedReceiptDigest: null
          }
        );
        return machinePostAdvisorEvidence(artifact);
      },
      async inspectFinal(request) {
        assertBoundaryRequest(request, runId, true);
        const artifact = await observeStagingPhase1V2MachinePhase(
          observerSession,
          {
            applicationName: "trailmind_phase1_v2_operator",
            authorizationBindingDigest: null,
            backendPid: request.lock.backendPid,
            phase: "final-control",
            stagedReceiptDigest: null
          }
        );
        return machineControlSnapshot(artifact);
      }
    }),
    containmentControl: Object.freeze({
      async assertAllDisabled(request) {
        assertBoundaryRequest(request, runId, false);
        assertSafeEnvironment(env);
        return Object.freeze({
          deployFlagsAllFalse: true,
          importFlagsAllFalse: true,
          providerFlagsAllFalse: true
        });
      }
    }),
    cleanupVerifier: Object.freeze({
      async proveSessionClosed(request) {
        const artifact = await observeStagingPhase1V2MachinePhase(
          observerSession,
          {
            applicationName: request.applicationName,
            authorizationBindingDigest: request.authorizationBindingDigest,
            backendPid: request.backendPid,
            phase: "post-disconnect-cleanup",
            stagedReceiptDigest: request.stagedReceiptDigest
          }
        );
        return machineCleanupEvidence(artifact, request);
      }
    }),
    receiptStore
  });
}

export function inspectCertificateAuthority({
  path,
  repositoryRoot,
  now = new Date(),
  io = realIO()
}) {
  try {
    const resolved = resolve(path);
    if (!isAbsolute(path) || resolved !== path ||
        inside(resolved, resolve(repositoryRoot))) {
      blocked("ca_path");
    }
    const initial = io.lstat(resolved);
    assertProtectedRegular(initial, "ca", true);
    if (io.realpath(resolved) !== resolved) blocked("ca_path");
    const age = exactDate(now).getTime() - initial.mtimeMs;
    if (age < -1_000 || age > CA_MAXIMUM_AGE_MILLISECONDS) {
      blocked("ca_freshness");
    }
    const fd = io.open(resolved,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    let bytes;
    try {
      const opened = io.fstat(fd);
      assertProtectedRegular(opened, "ca", true);
      if (!sameIdentity(initial, opened) || opened.size <= 0 ||
          opened.size > MAXIMUM_CA_BYTES) blocked("ca_race");
      bytes = io.readFile(fd);
      const after = io.fstat(fd);
      const pathAfter = io.lstat(resolved);
      if (bytes.length !== opened.size || !sameFileState(opened, after) ||
          !sameFileState(opened, pathAfter)) blocked("ca_race");
      validateCaPem(bytes, exactDate(now));
      return Object.freeze({
        path: resolved,
        dev: opened.dev,
        ino: opened.ino,
        size: opened.size,
        mtimeMs: opened.mtimeMs,
        ctimeMs: opened.ctimeMs,
        sha256: sha256(bytes)
      });
    } finally {
      bytes?.fill?.(0);
      io.close(fd);
    }
  } catch (error) {
    if (error instanceof StagingPhase1V2LiveLauncherError) throw error;
    blocked("ca");
  }
}

function revalidateCertificateAuthority(claim, io = realIO()) {
  try {
    const current = io.lstat(claim.path);
    assertProtectedRegular(current, "ca", true);
    if (!sameFileState(claim, current) || io.realpath(claim.path) !== claim.path) {
      blocked("ca_changed");
    }
  } catch (error) {
    if (error instanceof StagingPhase1V2LiveLauncherError) throw error;
    blocked("ca_changed");
  }
}

function createAttemptDirectory({ attemptId, baseDirectory, repositoryRoot }) {
  try {
    const base = realpathSync(resolve(baseDirectory));
    if (inside(base, repositoryRoot)) blocked("attempt_directory");
    const path = join(base, `trailmind-phase1-v2-live-${attemptId}`);
    mkdirSync(path, { mode: 0o700, recursive: false });
    const metadata = lstatSync(path);
    if (!metadata.isDirectory() || metadata.isSymbolicLink() ||
        (metadata.mode & 0o777) !== 0o700 ||
        metadata.uid !== process.geteuid() || realpathSync(path) !== path) {
      blocked("attempt_directory");
    }
    const authorizationStoreDirectory = join(path, "consumed");
    const receiptDirectory = join(path, "receipts");
    for (const directory of [authorizationStoreDirectory, receiptDirectory]) {
      mkdirSync(directory, { mode: 0o700, recursive: false });
      assertProtectedDirectory(directory);
    }
    return Object.freeze({ path, authorizationStoreDirectory, receiptDirectory });
  } catch (error) {
    if (error instanceof StagingPhase1V2LiveLauncherError) throw error;
    blocked("attempt_directory");
  }
}

function createUnlinkedCredential({
  directory,
  password,
  maximumBytes = MAXIMUM_PASSWORD_BYTES,
  io = realIO()
}) {
  validateSecretBuffer(password, maximumBytes);
  const path = join(directory, `credential-${randomUUID()}`);
  let fd;
  try {
    fd = io.open(path, constants.O_RDWR | constants.O_CREAT |
      constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
    if (!Number.isSafeInteger(fd) || fd < 3) blocked("password_fd");
    let offset = 0;
    while (offset < password.length) {
      const written = io.write(fd, password, offset,
        password.length - offset, offset);
      if (!Number.isInteger(written) || written <= 0) blocked("password_write");
      offset += written;
    }
    io.fsync(fd);
    const opened = io.fstat(fd);
    const linked = io.lstat(path);
    assertProtectedRegular(opened, "password_file", true);
    if (!sameFileState(opened, linked) || opened.size !== password.length) {
      blocked("password_file_race");
    }
    return { fd, path, dev: opened.dev, ino: opened.ino, linked: true };
  } catch (error) {
    if (fd !== undefined) try { io.close(fd); } catch { /* bounded */ }
    try { io.unlink(path); } catch { /* O_EXCL path may not exist */ }
    if (error instanceof StagingPhase1V2LiveLauncherError) throw error;
    blocked("password_file");
  }
}

function createUnlinkedCredentialPair({
  directory,
  password,
  io = realIO()
}) {
  validateSecretBuffer(password, MAXIMUM_PASSWORD_BYTES);
  const path = join(directory, `credential-pair-${randomUUID()}`);
  let fd;
  let auditorFd;
  try {
    fd = io.open(path, constants.O_RDWR | constants.O_CREAT |
      constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
    if (!Number.isSafeInteger(fd) || fd < 3) blocked("password_fd");
    let offset = 0;
    while (offset < password.length) {
      const written = io.write(
        fd, password, offset, password.length - offset, offset
      );
      if (!Number.isInteger(written) || written <= 0) {
        blocked("password_write");
      }
      offset += written;
    }
    io.fsync(fd);
    const primary = io.fstat(fd);
    const linked = io.lstat(path);
    assertProtectedRegular(primary, "password_file", true);
    if (!sameFileState(primary, linked) || primary.size !== password.length) {
      blocked("password_file_race");
    }
    auditorFd = io.open(
      path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)
    );
    if (!Number.isSafeInteger(auditorFd) || auditorFd < 3 ||
        auditorFd === fd) blocked("auditor_password_fd");
    const auditor = io.fstat(auditorFd);
    if (!sameFileState(primary, auditor) || auditor.nlink !== 1) {
      blocked("password_file_race");
    }
    return {
      fd,
      auditorFd,
      path,
      dev: primary.dev,
      ino: primary.ino,
      linked: true,
      independentOpenDescriptions: true
    };
  } catch (error) {
    if (auditorFd !== undefined) try { io.close(auditorFd); } catch { /* bounded */ }
    if (fd !== undefined) try { io.close(fd); } catch { /* bounded */ }
    try { io.unlink(path); } catch { /* O_EXCL path may not exist */ }
    if (error instanceof StagingPhase1V2LiveLauncherError) throw error;
    blocked("password_file");
  }
}

function unlinkCredentialBeforeDatabase(credential, io = realIO()) {
  if (!credential?.linked) blocked("password_unlink");
  try {
    const linked = io.lstat(credential.path);
    const opened = io.fstat(credential.fd);
    if (!sameIdentity(credential, linked) || !sameFileState(linked, opened)) {
      blocked("password_file_race");
    }
    io.unlink(credential.path);
    credential.linked = false;
    const unlinked = io.fstat(credential.fd);
    if (unlinked.nlink !== 0 || !sameIdentity(credential, unlinked)) {
      blocked("password_unlink");
    }
  } catch (error) {
    if (error instanceof StagingPhase1V2LiveLauncherError) throw error;
    blocked("password_unlink");
  }
}

function unlinkCredentialPairBeforeDatabase(credential, io = realIO()) {
  if (!credential?.linked || credential.independentOpenDescriptions !== true) {
    blocked("password_unlink");
  }
  try {
    const linked = io.lstat(credential.path);
    const primary = io.fstat(credential.fd);
    const auditor = io.fstat(credential.auditorFd);
    if (!sameIdentity(credential, linked) ||
        !sameFileState(linked, primary) ||
        !sameFileState(linked, auditor) || credential.fd ===
          credential.auditorFd) blocked("password_file_race");
    io.unlink(credential.path);
    credential.linked = false;
    for (const fd of [credential.fd, credential.auditorFd]) {
      const unlinked = io.fstat(fd);
      if (unlinked.nlink !== 0 || !sameIdentity(credential, unlinked)) {
        blocked("password_unlink");
      }
    }
  } catch (error) {
    if (error instanceof StagingPhase1V2LiveLauncherError) throw error;
    blocked("password_unlink");
  }
}

function closeCredential(credential, io = realIO()) {
  if (!credential) return;
  if (credential.linked) {
    try {
      const linked = io.lstat(credential.path);
      if (sameIdentity(credential, linked) && linked.uid === process.geteuid() &&
          linked.isFile() && !linked.isSymbolicLink()) io.unlink(credential.path);
    } catch { /* path may already be absent */ }
    credential.linked = false;
  }
  try { io.close(credential.fd); } catch { /* admission consumes the FD */ }
  if (credential.auditorFd !== undefined) {
    try { io.close(credential.auditorFd); } catch { /* observer consumes it */ }
  }
}

function createAuthorizationEnvelope({ directory, envelope, io = realIO() }) {
  const path = join(directory, `authorization-${envelope.authorizationId}.json`);
  const bytes = Buffer.from(canonicalJson(envelope), "utf8");
  let fd;
  try {
    fd = io.open(path, constants.O_WRONLY | constants.O_CREAT |
      constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
    let offset = 0;
    while (offset < bytes.length) {
      const written = io.write(fd, bytes, offset, bytes.length - offset, null);
      if (!Number.isInteger(written) || written <= 0) blocked("envelope_write");
      offset += written;
    }
    io.fsync(fd);
    const created = io.fstat(fd);
    assertProtectedRegular(created, "envelope", true);
    if (created.size !== bytes.length) blocked("envelope_write");
    io.close(fd);
    fd = undefined;
    fsyncDirectory(directory, io);
    return path;
  } catch (error) {
    if (fd !== undefined) try { io.close(fd); } catch { /* bounded */ }
    try { io.unlink(path); } catch { /* O_EXCL path may not exist */ }
    if (error instanceof StagingPhase1V2LiveLauncherError) throw error;
    blocked(error?.code === "EEXIST" ? "envelope_duplicate" : "envelope");
  } finally {
    bytes.fill(0);
  }
}

function createDurableReceiptStore({ directory, now }) {
  assertProtectedDirectory(directory);
  return Object.freeze({
    async persist(payload) {
      assertNoSensitiveReceipt(payload.receipt);
      const bytes = Buffer.from(JSON.stringify(payload.receipt), "utf8");
      if (bytes.length !== payload.receiptBytes ||
          canonicalAclDigest(payload.receipt) !== payload.receiptDigest) {
        bytes.fill(0);
        blocked("receipt_binding");
      }
      const persisted = {
        applicationName: payload.applicationName,
        authorizationBindingDigest: payload.authorizationBindingDigest,
        backendPid: payload.backendPid,
        candidateCommit: payload.candidateCommit,
        candidateTree: payload.candidateTree,
        cleanupEvidenceDigest: payload.cleanupEvidenceDigest,
        operatorDigestsDigest: payload.operatorDigestsDigest,
        ordinal: 11,
        persistedAt: exactDate(now()).toISOString(),
        phase: "sanitized-durable-receipt",
        projectRef: payload.projectRef,
        receiptBytes: payload.receiptBytes,
        receiptDigest: payload.receiptDigest,
        runId: payload.runId,
        status: "persisted"
      };
      const acknowledgement = Object.freeze({
        ...persisted,
        evidenceDigest: canonicalAclDigest(persisted)
      });
      const path = join(directory, `${payload.runId}.receipt.json`);
      let fd;
      try {
        fd = openSync(path, constants.O_WRONLY | constants.O_CREAT |
          constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
        let offset = 0;
        while (offset < bytes.length) {
          const written = writeSync(
            fd, bytes, offset, bytes.length - offset, null
          );
          if (!Number.isSafeInteger(written) || written <= 0) {
            blocked("receipt_write");
          }
          offset += written;
        }
        fsyncSync(fd);
        const created = fstatSync(fd);
        assertProtectedRegular(created, "receipt", true);
        if (created.size !== bytes.length) blocked("receipt_write");
        closeSync(fd);
        fd = undefined;
        fsyncDirectory(directory, realIO());
      } catch (error) {
        if (fd !== undefined) try { closeSync(fd); } catch { /* bounded */ }
        if (error instanceof StagingPhase1V2LiveLauncherError) throw error;
        blocked("receipt_write");
      } finally {
        bytes.fill(0);
      }
      return acknowledgement;
    }
  });
}

async function collectActionAuthorization({
  tty,
  signal,
  promptTimeoutMilliseconds
}) {
  const options = {
    signal,
    timeoutMilliseconds: boundedPromptTimeout(promptTimeoutMilliseconds)
  };
  const confirmation = await tty.readLine(
    `Type ${LIVE_CONFIRMATION}: `, options
  );
  if (confirmation !== LIVE_CONFIRMATION) blocked("target_confirmation");
  return true;
}

function createProcessTty() {
  return createNoEchoTtyAdapter({
    input: process.stdin,
    output: process.stdout
  });
}

export function createNoEchoTtyAdapter({ input, output }) {
  return Object.freeze({
    isTTY: input.isTTY === true && output.isTTY === true &&
      typeof input.setRawMode === "function",
    async readLine(prompt, { signal, timeoutMilliseconds }) {
      if (signal?.aborted) blocked("cancelled");
      const controller = new AbortController();
      const relay = () => controller.abort();
      signal?.addEventListener?.("abort", relay, { once: true });
      const timer = setTimeout(() => controller.abort(), timeoutMilliseconds);
      timer.unref?.();
      const reader = createInterface({ input, output, terminal: true });
      try {
        return await reader.question(prompt, { signal: controller.signal });
      } catch {
        blocked(signal?.aborted ? "cancelled" : "prompt_timeout");
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener?.("abort", relay);
        reader.close();
      }
    },
    readSecret(prompt, { maximumBytes, signal, timeoutMilliseconds }) {
      if (signal?.aborted) return Promise.reject(
        new StagingPhase1V2LiveLauncherError("cancelled")
      );
      try {
        output.write(`${prompt}${BRACKETED_PASTE_ENABLE}`);
        input.setRawMode(true);
        input.resume();
      } catch {
        try { input.setRawMode(false); } catch { /* bounded */ }
        try { output.write(`${BRACKETED_PASTE_DISABLE}\n`); } catch { /* bounded */ }
        return Promise.reject(
          new StagingPhase1V2LiveLauncherError("tty_required")
        );
      }
      const chunks = [];
      let total = 0;
      return new Promise((resolvePromise, rejectPromise) => {
        let settled = false;
        const finish = (error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          signal?.removeEventListener?.("abort", onAbort);
          input.off("data", onData);
          let finalError = error;
          try { input.setRawMode(false); } catch {
            finalError ??= new StagingPhase1V2LiveLauncherError("tty_cleanup");
          }
          try { input.pause(); } catch {
            finalError ??= new StagingPhase1V2LiveLauncherError("tty_cleanup");
          }
          try { output.write(`${BRACKETED_PASTE_DISABLE}\n`); } catch {
            finalError ??= new StagingPhase1V2LiveLauncherError("tty_cleanup");
          }
          if (finalError) {
            chunks.forEach((chunk) => chunk.fill(0));
            rejectPromise(finalError);
            return;
          }
          const result = Buffer.concat(chunks, total);
          chunks.forEach((chunk) => chunk.fill(0));
          resolvePromise(result);
        };
        const onAbort = () => finish(
          new StagingPhase1V2LiveLauncherError("cancelled")
        );
        const onData = (value) => {
          const data = Buffer.isBuffer(value) ? value :
            Buffer.from(String(value), "utf8");
          for (const byte of data) {
            if (byte === 27) {
              data.fill(0);
              finish(new StagingPhase1V2LiveLauncherError(
                "clipboard_input"
              ));
              return;
            }
            if (byte === 3 || byte === 4) {
              data.fill(0);
              finish(new StagingPhase1V2LiveLauncherError("cancelled"));
              return;
            }
            if (byte === 10 || byte === 13) {
              data.fill(0);
              finish();
              return;
            }
            if (byte === 8 || byte === 127) {
              const previous = chunks.pop();
              if (previous) {
                total -= previous.length;
                previous.fill(0);
              }
              continue;
            }
            const chunk = Buffer.from([byte]);
            chunks.push(chunk);
            total += 1;
            if (total > maximumBytes) {
              data.fill(0);
              finish(new StagingPhase1V2LiveLauncherError("password_size"));
              return;
            }
          }
          data.fill(0);
        };
        const timer = setTimeout(() => finish(
          new StagingPhase1V2LiveLauncherError("prompt_timeout")
        ), timeoutMilliseconds);
        timer.unref?.();
        signal?.addEventListener?.("abort", onAbort, { once: true });
        input.on("data", onData);
      });
    }
  });
}

function syntheticPreflightTty() {
  return Object.freeze({
    isTTY: true,
    async readSecret() {
      return Buffer.from("synthetic-preflight-password", "utf8");
    }
  });
}

function liveConnection(endpointClass, address) {
  validateAddress(address, endpointClass);
  return Object.freeze(endpointClass === "direct" ? {
    address,
    database: "postgres",
    host: STAGING_PHASE1_V2_DIRECT_HOST,
    port: 5432,
    user: "postgres"
  } : {
    address,
    database: "postgres",
    host: STAGING_PHASE1_V2_SESSION_HOST,
    port: 5432,
    user: `postgres.${STAGING_PHASE1_V2_TARGET.projectRef}`
  });
}

function tlsBinding(host) {
  return Object.freeze({
    certificateAuthority: "target-project-ca",
    minimumVersion: "TLSv1.2",
    mode: "verify-full",
    rejectUnauthorized: true,
    serverNameVerification: host
  });
}

function credentialContainmentBinding() {
  return Object.freeze({
    auditorReadOnlySessionRequired: true,
    descriptorCount: 2,
    descriptorMinimum: 3,
    descriptorSameProcessOnly: true,
    descriptorsDistinct: true,
    fileMode: "0600",
    independentOpenDescriptions: true,
    intake: "interactive-tty-noecho",
    ownerUid: process.geteuid(),
    pathUnlinkedBeforeDatabase: true,
    sameCredentialIdentity: true,
    singleLinkBeforeUnlink: true
  });
}

function validateAddress(address, endpointClass) {
  const family = isIP(address);
  if ((endpointClass === "direct" && family !== 6) ||
      (endpointClass === "session" && family !== 4) ||
      !isPublicAddress(address, family)) blocked("endpoint_address");
}

function isPublicAddress(address, family) {
  if (family === 4) {
    const [first, second, third] = address.split(".").map(Number);
    return !(
      first === 0 || first === 10 || first === 127 ||
      (first === 100 && second >= 64 && second <= 127) ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168) ||
      (first === 192 && second === 0) ||
      (first === 192 && second === 88 && third === 99) ||
      (first === 198 && [18, 19, 51].includes(second)) ||
      (first === 203 && second === 0 && third === 113) || first >= 224
    );
  }
  if (family !== 6) return false;
  const normalized = address.toLowerCase();
  if (["::", "::1"].includes(normalized) || normalized.startsWith("fc") ||
      normalized.startsWith("fd") || normalized.startsWith("fe8") ||
      normalized.startsWith("fe9") || normalized.startsWith("fea") ||
      normalized.startsWith("feb") || normalized.startsWith("2001:db8:") ||
      /^3ff[0-9a-f]:/.test(normalized)) return false;
  const first = Number.parseInt(normalized.split(":", 1)[0], 16);
  return first >= 0x2000 && first <= 0x3fff;
}

function validateCaPem(bytes, now) {
  try {
    const text = bytes.toString("utf8");
    if (Buffer.byteLength(text, "utf8") !== bytes.length) blocked("ca_pem");
    const blocks = text.match(
      /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g
    );
    if (!blocks?.length || text.replace(
      /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g, ""
    ).trim() !== "") blocked("ca_pem");
    for (const block of blocks) {
      const certificate = new X509Certificate(block);
      const validFrom = new Date(certificate.validFrom).getTime();
      const validTo = new Date(certificate.validTo).getTime();
      const observedAt = exactDate(now).getTime();
      if (certificate.ca !== true || Number.isNaN(validFrom) ||
          Number.isNaN(validTo) || validTo <= validFrom ||
          observedAt < validFrom || observedAt > validTo) {
        blocked("ca_x509");
      }
    }
  } catch (error) {
    if (error instanceof StagingPhase1V2LiveLauncherError) throw error;
    blocked("ca_x509");
  }
}

function createSyntheticCa(caPath, directory) {
  const keyPath = join(directory, "synthetic-ca-key.pem");
  try {
    execFileSync("openssl", [
      "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-sha256",
      "-days", "1", "-subj", "/CN=TrailMind Synthetic Preflight CA",
      "-addext", "basicConstraints=critical,CA:TRUE",
      "-keyout", keyPath, "-out", caPath
    ], { stdio: ["ignore", "ignore", "ignore"] });
    chmodSync(caPath, 0o600);
  } catch {
    blocked("synthetic_ca");
  } finally {
    try { unlinkSync(keyPath); } catch { /* task-owned key may not exist */ }
  }
}

function safelyDeletePreflightDirectory(path, io = realIO()) {
  try {
    assertProtectedDirectory(path);
    for (const directoryName of ["receipts", "consumed"]) {
      const directory = join(path, directoryName);
      assertProtectedDirectory(directory);
      for (const name of io.readdir(directory)) {
        const child = join(directory, name);
        const metadata = io.lstat(child);
        assertProtectedRegular(metadata, "preflight_artifact", true);
        io.unlink(child);
      }
      rmdirSync(directory);
    }
    for (const name of readdirSync(path)) {
      const child = join(path, name);
      const metadata = lstatSync(child);
      assertProtectedRegular(metadata, "preflight_artifact", true);
      unlinkSync(child);
    }
    rmdirSync(path);
  } catch (error) {
    if (error instanceof StagingPhase1V2LiveLauncherError) throw error;
    blocked("preflight_cleanup");
  }
}

function persistAttemptInvalidation({
  attemptDirectory, attemptId, now, io = realIO()
}) {
  if (!attemptDirectory || !UUID_PATTERN.test(attemptId)) return;
  const path = join(attemptDirectory, `${attemptId}.invalidated`);
  const bytes = Buffer.from(JSON.stringify({
    schemaVersion: 1,
    attemptId,
    status: "invalidated",
    invalidatedAt: now.toISOString()
  }), "utf8");
  let fd;
  try {
    fd = io.open(path, constants.O_WRONLY | constants.O_CREAT |
      constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
    io.write(fd, bytes, 0, bytes.length, null);
    io.fsync(fd);
    io.close(fd);
    fd = undefined;
    fsyncDirectory(attemptDirectory, io);
  } catch {
    if (fd !== undefined) try { io.close(fd); } catch { /* bounded */ }
  } finally {
    bytes.fill(0);
  }
}

function invalidateEnvelope(path, io = realIO()) {
  if (!path) return;
  try {
    const metadata = io.lstat(path);
    assertProtectedRegular(metadata, "envelope", true);
    io.unlink(path);
    fsyncDirectory(dirname(path), io);
  } catch (error) {
    if (error?.code !== "ENOENT") blocked("envelope_invalidation");
  }
}

function assertSafeEnvironment(env) {
  if (!env || typeof env !== "object") blocked("environment");
  const keys = Object.keys(env);
  if (keys.some((key) => key.startsWith("PG")) ||
      FORBIDDEN_ENVIRONMENT_KEYS.some((key) => env[key] !== undefined) ||
      FEATURE_FLAGS.some((key) => env[key] !== undefined) ||
      keys.some((key) => /(?:PASSWORD|SECRET|TOKEN)$/i.test(key) &&
        /(?:SUPABASE|POSTGRES|DATABASE|TRAILMIND)/i.test(key))) {
    blocked("environment_secret_source");
  }
}

function assertNoProductionDependencyOverrides(value) {
  if (value === null || typeof value !== "object" ||
      Object.getPrototypeOf(value) !== Object.prototype ||
      Reflect.ownKeys(value).length !== 0) {
    blocked("production_dependency_override");
  }
}

function createCancellation({ providedSignal, signalSource }) {
  if (providedSignal) {
    return Object.freeze({ signal: providedSignal, dispose() {} });
  }
  const controller = new AbortController();
  const cancel = () => controller.abort(
    new StagingPhase1V2LiveLauncherError("cancelled")
  );
  signalSource.on?.("SIGINT", cancel);
  signalSource.on?.("SIGTERM", cancel);
  return Object.freeze({
    signal: controller.signal,
    dispose() {
      signalSource.off?.("SIGINT", cancel);
      signalSource.off?.("SIGTERM", cancel);
    }
  });
}

function assertBoundaryRequest(request, runId, lockRequired) {
  if (request?.projectRef !== STAGING_PHASE1_V2_TARGET.projectRef ||
      request?.readOnly !== true ||
      (lockRequired && request.lock === undefined) ||
      (!lockRequired && request.runId !== undefined && request.runId !== runId)) {
    blocked("boundary_request");
  }
}

function assertNoSensitiveReceipt(value) {
  walk(value, (key, nested) => {
    if (/(password|secret|token|jwt|connection|string|url|certificate|path)/i
      .test(key)) blocked("receipt_sensitive");
    if (typeof nested === "string" &&
        /postgres(?:ql)?:\/\/|-----BEGIN CERTIFICATE-----/i.test(nested)) {
      blocked("receipt_sensitive");
    }
  });
}

function assertProtectedDirectory(path) {
  const metadata = lstatSync(path);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() ||
      metadata.uid !== process.geteuid() || (metadata.mode & 0o777) !== 0o700 ||
      realpathSync(path) !== resolve(path)) blocked("protected_directory");
}

function assertProtectedRegular(metadata, code, singleLink) {
  if (!metadata?.isFile?.() || metadata?.isSymbolicLink?.() ||
      metadata.uid !== process.geteuid() || (metadata.mode & 0o777) !== 0o600 ||
      (singleLink && metadata.nlink !== 1)) blocked(code);
}

function fsyncDirectory(path, io) {
  let fd;
  try {
    fd = io.open(path, constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) |
      (constants.O_NOFOLLOW ?? 0));
    io.fsync(fd);
  } finally {
    if (fd !== undefined) io.close(fd);
  }
}

function assertDescriptorClosed(fd, io = realIO()) {
  try {
    io.fstat(fd);
    blocked("password_fd_open");
  } catch (error) {
    if (error instanceof StagingPhase1V2LiveLauncherError) throw error;
    if (error?.code !== "EBADF") blocked("password_fd_state");
  }
}

function validateSecretBuffer(value, maximumBytes = MAXIMUM_PASSWORD_BYTES) {
  if (!Buffer.isBuffer(value) || value.length === 0 ||
      value.length > maximumBytes) blocked("password_size");
  const text = value.toString("utf8");
  if (Buffer.byteLength(text, "utf8") !== value.length ||
      /[\u0000-\u001f\u007f]/.test(text)) blocked("password_format");
}

function assertDistinctIdentities(value) {
  const ids = Object.values(value);
  if (ids.some((id) => !UUID_PATTERN.test(id)) ||
      new Set(ids).size !== ids.length) blocked("attempt_identity");
}

function sameIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

function sameFileState(left, right) {
  return sameIdentity(left, right) && left.size === right.size &&
    left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs;
}

function inside(path, root) {
  const child = relative(root, path);
  return child === "" || (!child.startsWith(`..${sep}`) && child !== "..");
}

function boundedPromptTimeout(value) {
  if (value === undefined) return DEFAULT_PROMPT_TIMEOUT_MILLISECONDS;
  if (!Number.isSafeInteger(value) || value <= 0 ||
      value > DEFAULT_PROMPT_TIMEOUT_MILLISECONDS) blocked("prompt_timeout");
  return value;
}

function exactDate(value) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) blocked("time");
  return value;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function walk(value, visitor) {
  if (Array.isArray(value)) {
    value.forEach((nested, index) => {
      visitor(String(index), nested);
      walk(nested, visitor);
    });
  } else if (value && typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) {
      visitor(key, nested);
      walk(nested, visitor);
    }
  }
}

function realIO() {
  return Object.freeze({
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
  });
}

function sanitizeLauncherFailure(error) {
  if (error instanceof StagingPhase1V2LiveLauncherError) return error;
  if (error instanceof StagingPhase1V2MachineObserverError) {
    const code = typeof error.code === "string" &&
      /^[a-z0-9_]{1,64}$/.test(error.code) ? error.code : "observer_rejected";
    return new StagingPhase1V2LiveLauncherError(code);
  }
  if (["StagingPhase1V2AdmissionError", "StagingPhase1V2AdapterError"]
    .includes(error?.name)) {
    if (error.name === "StagingPhase1V2AdmissionError") {
      return new StagingPhase1V2LiveLauncherError("admission_rejected");
    }
    const code = typeof error.code === "string" &&
      /^[a-z0-9_]{1,64}$/.test(error.code)
      ? error.code
      : "rejected";
    return new StagingPhase1V2LiveLauncherError(`operator_${code}`);
  }
  return new StagingPhase1V2LiveLauncherError("unknown");
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}

function blocked(code) {
  throw new StagingPhase1V2LiveLauncherError(code);
}
