import { createHash, randomUUID } from "node:crypto";
import {
  STAGING_PHASE1_V2_TARGET
} from "./stagingPhase1V2Operator.js";

export const STAGING_PHASE1_V2_OBSERVER_CONTRACT_VERSION = "1.0.0";
export const STAGING_PHASE1_V2_OBSERVER_CONTRACT_DIGEST = sha256(canonicalJson({
  name: "trailmind-supabase-staging-observer-contract",
  phases: [
    "pre-control", "post-ddl-advisors", "final-control",
    "post-disconnect-cleanup"
  ],
  version: STAGING_PHASE1_V2_OBSERVER_CONTRACT_VERSION
}));
export const STAGING_PHASE1_V2_SYNTHETIC_OBSERVER_PACKAGE = deepFreeze({
  packageDigest: sha256(canonicalJson({
    id: "trailmind.synthetic.staging-observer-fixture",
    purpose: "preflight-only-non-authorizing",
    version: "1.0.0"
  })),
  packageId: "trailmind.synthetic.staging-observer-fixture",
  packageVersion: "1.0.0",
  trustMode: "synthetic-preflight"
});

const MAXIMUM_ARTIFACT_BYTES = 32 * 1024;
const MAXIMUM_OBSERVATION_AGE_MILLISECONDS = 5 * 60 * 1_000;
const APPLICATION_NAME = "trailmind_phase1_v2_operator";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COMMIT_PATTERN = /^[a-f0-9]{40}$/;
const DIGEST_PATTERN = /^[a-f0-9]{64}$/;
const PHASES = Object.freeze([
  "pre-control",
  "post-ddl-advisors",
  "final-control",
  "post-disconnect-cleanup"
]);
const FLAG_NAMES = Object.freeze([
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
const PROTECTED_PROJECTS = deepFreeze([
  {
    ref: "bejvhhjbgtvctpsnlwid", kind: "production",
    selected: false, mutationCount: 0
  },
  {
    ref: "cmkvbxppgofteoutfslp", kind: "planua",
    selected: false, mutationCount: 0
  }
]);
const syntheticFactories = new WeakSet();
const syntheticSessions = new WeakSet();
// Intentionally empty in this release. Only a future reviewed implementation
// in this module may add instances; there is no public registration API.
const productionFactories = new WeakSet();
const productionSessions = new WeakSet();
const validatedArtifacts = new WeakSet();
const consumedArtifacts = new WeakSet();

export class StagingPhase1V2MachineObserverError extends Error {
  constructor(code) {
    super(`trailmind_phase1_v2_machine_observer_blocked:${code}`);
    this.name = "StagingPhase1V2MachineObserverError";
    this.code = code;
  }
}

// No production factory is registered in this release. A future reviewed
// implementation must be added inside this module so arbitrary application
// callbacks cannot become a trust anchor by copying public metadata.
export function requireReviewedStagingPhase1V2ProductionObserverFactory(
  candidate
) {
  if (candidate === undefined || candidate === null) blocked("observer_required");
  if (productionFactories.has(candidate)) return candidate;
  blocked("observer_untrusted");
}

export function createSyntheticStagingPhase1V2ObserverFactory({
  now = () => new Date(),
  randomId = randomUUID,
  mutateArtifact,
  onObservation = () => {}
} = {}) {
  const factory = Object.freeze({
    packageBinding: STAGING_PHASE1_V2_SYNTHETIC_OBSERVER_PACKAGE,
    createSession(binding) {
      validateBinding(binding);
      const session = createSession({
        binding: deepFreeze(structuredClone(binding)),
        now,
        randomId,
        mutateArtifact,
        onObservation
      });
      syntheticSessions.add(session);
      return session;
    }
  });
  syntheticFactories.add(factory);
  return factory;
}

export function createSyntheticStagingPhase1V2ObserverSession(
  factory,
  binding
) {
  if (!syntheticFactories.has(factory)) blocked("synthetic_factory");
  return factory.createSession(binding);
}

export function assertSyntheticStagingPhase1V2ObserverSession(session) {
  if (!syntheticSessions.has(session)) blocked("synthetic_session");
  return session;
}

export async function observeStagingPhase1V2MachinePhase(session, request) {
  if (!syntheticSessions.has(session) && !productionSessions.has(session)) {
    blocked("observer_untrusted");
  }
  return session.observe(request);
}

export function machineControlSnapshot(artifact) {
  consumeValidatedArtifact(artifact, ["pre-control", "final-control"]);
  const evidence = artifact.evidence;
  return deepFreeze({
    observedAt: artifact.observedAt,
    observerArtifactDigest: artifact.artifactDigest,
    project: {
      ref: artifact.binding.projectRef,
      name: evidence.projectName,
      organizationId: artifact.binding.organizationId,
      region: artifact.binding.region,
      status: evidence.status
    },
    billing: {
      organizationPlan: evidence.organizationPlan,
      computeSize: evidence.computeSize,
      currency: evidence.currency,
      monthlyCostAmount: evidence.monthlyCostAmount,
      nonzeroAddonCount: evidence.nonzeroAddonCount,
      observedAt: artifact.observedAt
    },
    advisors: {
      security: {
        status: evidence.securityAdvisorStatus,
        blockingFindingCount: evidence.securityBlockingFindingCount,
        observedAt: artifact.observedAt
      },
      performance: {
        status: evidence.performanceAdvisorStatus,
        blockingFindingCount: evidence.performanceBlockingFindingCount,
        observedAt: artifact.observedAt
      }
    },
    expectedDatabaseAclDigest: evidence.expectedDatabaseAclDigest,
    protectedProjects: evidence.protectedProjects,
    featureFlags: evidence.featureFlags
  });
}

export function machinePostAdvisorEvidence(artifact) {
  consumeValidatedArtifact(artifact, ["post-ddl-advisors"]);
  return deepFreeze({
    phase: "post-ddl-advisors",
    ordinal: 8,
    status: "acceptable",
    observedAt: artifact.observedAt,
    observerArtifactDigest: artifact.artifactDigest,
    evidenceDigest: artifact.artifactDigest,
    security: artifact.evidence.security,
    performance: artifact.evidence.performance
  });
}

export function machineCleanupEvidence(artifact, request) {
  consumeValidatedArtifact(artifact, ["post-disconnect-cleanup"]);
  const evidence = artifact.evidence;
  if (
    evidence.applicationName !== request.applicationName ||
    evidence.backendPid !== request.backendPid ||
    evidence.authorizationBindingDigest !==
      request.authorizationBindingDigest ||
    evidence.stagedReceiptDigest !== request.stagedReceiptDigest
  ) blocked("cleanup_binding");
  const proof = {
    applicationName: request.applicationName,
    authorizationBindingDigest: request.authorizationBindingDigest,
    backendPid: request.backendPid,
    backendSessionCount: evidence.activeSessionCount,
    candidateCommit: request.candidateCommit,
    candidateTree: request.candidateTree,
    completionState: "session-closed",
    idleSessionCount: evidence.idleSessionCount,
    observedAt: artifact.observedAt,
    observerArtifactDigest: artifact.artifactDigest,
    operatorDigestsDigest: request.operatorDigestsDigest,
    projectRef: request.projectRef,
    runId: request.runId,
    stagedReceiptDigest: request.stagedReceiptDigest
  };
  return Object.freeze({
    ...proof,
    evidenceDigest: sha256(canonicalJson(proof))
  });
}

function createSession({ binding, now, randomId, mutateArtifact, onObservation }) {
  const packageBinding = STAGING_PHASE1_V2_SYNTHETIC_OBSERVER_PACKAGE;
  const sessionBindingDigest = sha256(canonicalJson({
    binding,
    contractDigest: STAGING_PHASE1_V2_OBSERVER_CONTRACT_DIGEST,
    packageBinding
  }));
  let nextPhase = 0;
  let previousDigest = null;
  let previousObservedAt = null;
  let preControlInvariants = null;
  const usedIds = new Set();
  const usedNonces = new Set();
  const usedDigests = new Set();
  const session = Object.freeze({
    packageBinding,
    sessionBindingDigest,
    async observe(request) {
      validateRequest(request, PHASES[nextPhase]);
      const requestNonce = randomId();
      if (!UUID_PATTERN.test(requestNonce) || usedNonces.has(requestNonce)) {
        blocked("request_nonce");
      }
      const observedAt = exactDate(now()).toISOString();
      let artifact = buildSyntheticArtifact({
        binding,
        observedAt,
        observationId: randomId(),
        packageBinding,
        phase: request.phase,
        previousObservationDigest: previousDigest,
        request,
        requestNonce,
        sequence: nextPhase + 1,
        sessionBindingDigest
      });
      if (mutateArtifact) {
        artifact = mutateArtifact(structuredClone(artifact), {
          expectedPhase: PHASES[nextPhase],
          request: structuredClone(request),
          resealArtifact(value) {
            const unsigned = withoutKey(value, "artifactDigest");
            return deepFreeze({
              ...unsigned,
              artifactDigest: sha256(canonicalJson(unsigned))
            });
          }
        }) ?? artifact;
      }
      validateArtifact({
        artifact,
        binding,
        packageBinding,
        previousDigest,
        previousObservedAt,
        request,
        requestNonce,
        sequence: nextPhase + 1,
        sessionBindingDigest,
        now: exactDate(now()),
        usedIds,
        usedDigests,
        usedNonces
      });
      if (artifact.phase === "pre-control") {
        preControlInvariants = controlInvariants(artifact.evidence);
      } else if (artifact.phase === "final-control" &&
          !sameJson(controlInvariants(artifact.evidence),
            preControlInvariants)) {
        blocked("control_contradiction");
      }
      usedIds.add(artifact.observationId);
      usedNonces.add(artifact.requestNonce);
      usedDigests.add(artifact.artifactDigest);
      previousDigest = artifact.artifactDigest;
      previousObservedAt = artifact.observedAt;
      nextPhase += 1;
      artifact = deepFreeze(artifact);
      validatedArtifacts.add(artifact);
      onObservation(artifact.phase);
      return artifact;
    }
  });
  return session;
}

function controlInvariants(evidence) {
  return {
    expectedDatabaseAclDigest: evidence.expectedDatabaseAclDigest,
    providerAclRestorePlanDigest: evidence.providerAclRestorePlanDigest
  };
}

function buildSyntheticArtifact({
  binding,
  observedAt,
  observationId,
  packageBinding,
  phase,
  previousObservationDigest,
  request,
  requestNonce,
  sequence,
  sessionBindingDigest
}) {
  const unsigned = {
    schemaVersion: 1,
    observer: {
      contractDigest: STAGING_PHASE1_V2_OBSERVER_CONTRACT_DIGEST,
      contractVersion: STAGING_PHASE1_V2_OBSERVER_CONTRACT_VERSION,
      ...packageBinding
    },
    binding,
    sessionBindingDigest,
    observationId,
    requestNonce,
    phase,
    sequence,
    previousObservationDigest,
    observedAt,
    session: {
      applicationName: request.applicationName,
      backendPid: request.backendPid
    },
    evidence: syntheticEvidence(phase, request)
  };
  return deepFreeze({
    ...unsigned,
    artifactDigest: sha256(canonicalJson(unsigned))
  });
}

function syntheticEvidence(phase, request) {
  if (["pre-control", "final-control"].includes(phase)) {
    return {
      projectName: STAGING_PHASE1_V2_TARGET.projectName,
      organizationName: STAGING_PHASE1_V2_TARGET.organizationName,
      status: STAGING_PHASE1_V2_TARGET.status,
      organizationPlan: STAGING_PHASE1_V2_TARGET.organizationPlan,
      computeSize: STAGING_PHASE1_V2_TARGET.computeSize,
      currency: STAGING_PHASE1_V2_TARGET.monthlyCost.currency,
      monthlyCostAmount: STAGING_PHASE1_V2_TARGET.monthlyCost.amount,
      nonzeroAddonCount: 0,
      postgresMajor: STAGING_PHASE1_V2_TARGET.postgresMajor,
      databaseName: "postgres",
      securityAdvisorStatus: "completed",
      securityBlockingFindingCount: 0,
      securityEvidenceDigest: "a".repeat(64),
      performanceAdvisorStatus: "completed",
      performanceBlockingFindingCount: 0,
      performanceEvidenceDigest: "b".repeat(64),
      expectedDatabaseAclDigest: "c".repeat(64),
      providerAclRestorePlanDigest: "d".repeat(64),
      protectedProjects: PROTECTED_PROJECTS,
      featureFlags: Object.fromEntries(FLAG_NAMES.map((name) => [name, false]))
    };
  }
  if (phase === "post-ddl-advisors") {
    return {
      security: {
        status: "completed", blockingFindingCount: 0, noticeCount: 0,
        evidenceDigest: "e".repeat(64)
      },
      performance: {
        status: "completed", blockingFindingCount: 0, noticeCount: 0,
        evidenceDigest: "f".repeat(64)
      }
    };
  }
  return {
    applicationName: request.applicationName,
    backendPid: request.backendPid,
    activeSessionCount: 0,
    idleSessionCount: 0,
    authorizationBindingDigest: request.authorizationBindingDigest,
    stagedReceiptDigest: request.stagedReceiptDigest
  };
}

function validateArtifact({
  artifact,
  binding,
  packageBinding,
  previousDigest,
  previousObservedAt,
  request,
  requestNonce,
  sequence,
  sessionBindingDigest,
  now,
  usedIds,
  usedDigests,
  usedNonces
}) {
  if (!isExactObject(artifact, [
    "artifactDigest", "binding", "evidence", "observationId", "observedAt",
    "observer", "phase", "previousObservationDigest", "requestNonce",
    "schemaVersion", "sequence", "session", "sessionBindingDigest"
  ])) blocked("artifact_fields");
  if (byteLength(artifact) > MAXIMUM_ARTIFACT_BYTES) blocked("artifact_size");
  assertNoSensitiveContent(artifact);
  if (
    artifact.schemaVersion !== 1 || artifact.phase !== request.phase ||
    artifact.sequence !== sequence || artifact.requestNonce !== requestNonce ||
    artifact.previousObservationDigest !== previousDigest ||
    artifact.sessionBindingDigest !== sessionBindingDigest ||
    !sameJson(artifact.binding, binding) ||
    !isExactObject(artifact.observer, [
      "contractDigest", "contractVersion", "packageDigest", "packageId",
      "packageVersion", "trustMode"
    ]) ||
    artifact.observer.contractDigest !==
      STAGING_PHASE1_V2_OBSERVER_CONTRACT_DIGEST ||
    artifact.observer.contractVersion !==
      STAGING_PHASE1_V2_OBSERVER_CONTRACT_VERSION ||
    !sameJson(withoutContract(artifact.observer), packageBinding) ||
    !isExactObject(artifact.session, ["applicationName", "backendPid"]) ||
    artifact.session.applicationName !== request.applicationName ||
    artifact.session.backendPid !== request.backendPid ||
    !UUID_PATTERN.test(artifact.observationId) ||
    artifact.observationId === artifact.requestNonce ||
    usedIds.has(artifact.observationId) ||
    usedNonces.has(artifact.observationId) ||
    usedIds.has(artifact.requestNonce) ||
    usedNonces.has(artifact.requestNonce) ||
    usedDigests.has(artifact.artifactDigest)
  ) blocked("artifact_binding");
  const observedAt = exactTimestamp(artifact.observedAt);
  const age = now.getTime() - observedAt.getTime();
  if (age < 0 || age > MAXIMUM_OBSERVATION_AGE_MILLISECONDS ||
      (previousObservedAt && artifact.observedAt < previousObservedAt)) {
    blocked("artifact_freshness");
  }
  const unsigned = withoutKey(artifact, "artifactDigest");
  if (!DIGEST_PATTERN.test(artifact.artifactDigest) ||
      sha256(canonicalJson(unsigned)) !== artifact.artifactDigest) {
    blocked("artifact_digest");
  }
  validateEvidence(artifact, request);
}

function validateEvidence(artifact, request) {
  if (["pre-control", "final-control"].includes(artifact.phase)) {
    const value = artifact.evidence;
    if (!isExactObject(value, [
      "computeSize", "currency", "databaseName", "expectedDatabaseAclDigest",
      "featureFlags", "monthlyCostAmount", "nonzeroAddonCount",
      "organizationName", "organizationPlan", "performanceAdvisorStatus",
      "performanceBlockingFindingCount", "performanceEvidenceDigest",
      "postgresMajor", "projectName", "protectedProjects",
      "securityAdvisorStatus", "securityBlockingFindingCount",
      "securityEvidenceDigest", "status", "providerAclRestorePlanDigest"
    ]) || value.projectName !== STAGING_PHASE1_V2_TARGET.projectName ||
        value.organizationName !== STAGING_PHASE1_V2_TARGET.organizationName ||
        value.status !== STAGING_PHASE1_V2_TARGET.status ||
        value.organizationPlan !== STAGING_PHASE1_V2_TARGET.organizationPlan ||
        value.computeSize !== STAGING_PHASE1_V2_TARGET.computeSize ||
        value.currency !== STAGING_PHASE1_V2_TARGET.monthlyCost.currency ||
        value.monthlyCostAmount !== STAGING_PHASE1_V2_TARGET.monthlyCost.amount ||
        value.nonzeroAddonCount !== 0 ||
        value.postgresMajor !== STAGING_PHASE1_V2_TARGET.postgresMajor ||
        value.databaseName !== "postgres" ||
        value.securityAdvisorStatus !== "completed" ||
        value.securityBlockingFindingCount !== 0 ||
        value.performanceAdvisorStatus !== "completed" ||
        value.performanceBlockingFindingCount !== 0 ||
        !DIGEST_PATTERN.test(value.securityEvidenceDigest) ||
        !DIGEST_PATTERN.test(value.performanceEvidenceDigest) ||
        !DIGEST_PATTERN.test(value.expectedDatabaseAclDigest) ||
        !DIGEST_PATTERN.test(value.providerAclRestorePlanDigest)) {
      blocked("control_evidence");
    }
    validateProtectedProjects(value.protectedProjects);
    validateFeatureFlags(value.featureFlags);
    return;
  }
  if (artifact.phase === "post-ddl-advisors") {
    if (!isExactObject(artifact.evidence, ["performance", "security"])) {
      blocked("advisor_evidence");
    }
    for (const value of Object.values(artifact.evidence)) {
      if (!isExactObject(value, [
        "blockingFindingCount", "evidenceDigest", "noticeCount", "status"
      ]) || value.status !== "completed" || value.blockingFindingCount !== 0 ||
          !Number.isSafeInteger(value.noticeCount) || value.noticeCount < 0 ||
          value.noticeCount > 10_000 ||
          !DIGEST_PATTERN.test(value.evidenceDigest)) {
        blocked("advisor_evidence");
      }
    }
    return;
  }
  const value = artifact.evidence;
  if (!isExactObject(value, [
    "activeSessionCount", "applicationName", "authorizationBindingDigest",
    "backendPid", "idleSessionCount", "stagedReceiptDigest"
  ]) || value.applicationName !== APPLICATION_NAME ||
      value.applicationName !== request.applicationName ||
      value.backendPid !== request.backendPid ||
      value.activeSessionCount !== 0 || value.idleSessionCount !== 0 ||
      value.authorizationBindingDigest !== request.authorizationBindingDigest ||
      value.stagedReceiptDigest !== request.stagedReceiptDigest ||
      !DIGEST_PATTERN.test(value.authorizationBindingDigest) ||
      !DIGEST_PATTERN.test(value.stagedReceiptDigest)) {
    blocked("cleanup_evidence");
  }
}

function validateRequest(request, expectedPhase) {
  if (!isExactObject(request, [
    "applicationName", "authorizationBindingDigest", "backendPid", "phase",
    "stagedReceiptDigest"
  ]) || request.phase !== expectedPhase) blocked("phase_order");
  const beforeConnection = request.phase === "pre-control";
  const cleanup = request.phase === "post-disconnect-cleanup";
  if (beforeConnection) {
    if (request.applicationName !== null || request.backendPid !== null ||
        request.authorizationBindingDigest !== null ||
        request.stagedReceiptDigest !== null) blocked("session_binding");
  } else if (request.applicationName !== APPLICATION_NAME ||
      !Number.isSafeInteger(request.backendPid) || request.backendPid <= 0 ||
      (cleanup && (!DIGEST_PATTERN.test(request.authorizationBindingDigest) ||
        !DIGEST_PATTERN.test(request.stagedReceiptDigest))) ||
      (!cleanup && (request.authorizationBindingDigest !== null ||
        request.stagedReceiptDigest !== null))) blocked("session_binding");
}

function validateBinding(value) {
  if (!isExactObject(value, [
    "attemptId", "candidateCommit", "candidateTree", "organizationId",
    "projectRef", "region", "runId"
  ]) || !UUID_PATTERN.test(value.attemptId) || !UUID_PATTERN.test(value.runId) ||
      value.attemptId === value.runId ||
      !COMMIT_PATTERN.test(value.candidateCommit) ||
      !COMMIT_PATTERN.test(value.candidateTree) ||
      value.projectRef !== STAGING_PHASE1_V2_TARGET.projectRef ||
      value.organizationId !== STAGING_PHASE1_V2_TARGET.organizationId ||
      value.region !== STAGING_PHASE1_V2_TARGET.region) blocked("binding");
}

function validateProtectedProjects(value) {
  if (!Array.isArray(value) || value.length !== PROTECTED_PROJECTS.length ||
      !sameJson(value, PROTECTED_PROJECTS)) blocked("protected_projects");
}

function validateFeatureFlags(value) {
  if (!isExactObject(value, FLAG_NAMES) ||
      Object.values(value).some((enabled) => enabled !== false)) {
    blocked("feature_flags");
  }
}

function assertValidatedArtifact(artifact, phases) {
  if (!validatedArtifacts.has(artifact) || !phases.includes(artifact.phase)) {
    blocked("artifact_untrusted");
  }
}

function consumeValidatedArtifact(artifact, phases) {
  assertValidatedArtifact(artifact, phases);
  if (consumedArtifacts.has(artifact)) blocked("artifact_replay");
  consumedArtifacts.add(artifact);
}

function assertNoSensitiveContent(value) {
  walk(value, (key, nested) => {
    if (/(password|secret|token|jwt|connection|string|url|certificate|sql)/i
      .test(key)) blocked("artifact_sensitive");
    if (typeof nested === "string" &&
        /postgres(?:ql)?:\/\/|-----BEGIN|(?:password|secret|token)=/i
          .test(nested)) blocked("artifact_sensitive");
  });
}

function withoutContract(observer) {
  const { contractDigest, contractVersion, ...packageBinding } = observer;
  return packageBinding;
}

function withoutKey(value, key) {
  return Object.fromEntries(Object.entries(value)
    .filter(([candidate]) => candidate !== key));
}

function exactTimestamp(value) {
  if (typeof value !== "string") blocked("timestamp");
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    blocked("timestamp");
  }
  return parsed;
}

function exactDate(value) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) blocked("time");
  return value;
}

function byteLength(value) {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
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

function isExactObject(value, keys) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    sameJson(Object.keys(value).sort(), [...keys].sort());
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
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

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}

function blocked(code) {
  throw new StagingPhase1V2MachineObserverError(code);
}
