import { createHash } from "node:crypto";
import { TextDecoder } from "node:util";
import {
  validateStagingInitializationEvidence
} from "./stagingPrerequisitesV3/admissionEvidence.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST_PATTERN = /^[a-f0-9]{64}$/;
const COMMIT_PATTERN = /^[a-f0-9]{40}$/;

export const STAGING_PHASE1_V2_PRODUCTION_OBSERVER_POLICY = deepFreeze({
  schemaVersion: 2,
  contractId: "trailmind-production-observer-acceptance-v2",
  packageId: "trailmind.production.staging-phase1-v2-observer",
  trustMode: "production-authenticated-v2",
  target: {
    database: "postgres",
    mutatingRole: "postgres",
    organizationId: "wbnftkftyamxzvxsftda",
    projectRef: "mbvzwsrtqcrwhvykugcd",
    region: "eu-central-1"
  },
  protectedProjectRefs: [
    "bejvhhjbgtvctpsnlwid",
    "cmkvbxppgofteoutfslp"
  ],
  management: {
    host: "api.supabase.com",
    port: 443,
    method: "GET",
    maximumCalls: 14,
    redirects: 0,
    retries: 0,
    proxyAllowed: false,
    compressionAllowed: false,
    maximumHeaderBytes: 16 * 1024,
    maximumBodyBytes: 256 * 1024,
    maximumJsonDepth: 16,
    maximumArrayItems: 10_000,
    maximumStringBytes: 16 * 1024,
    oauthScopes: [
      "organizations:read",
      "projects:read",
      "database:read"
    ]
  },
  auditor: {
    role: "trailmind_phase1_v2_stats_auditor",
    database: "postgres",
    connectionLimit: 1,
    membership: {
      role: "pg_read_all_stats",
      inherit: false,
      set: true,
      admin: false
    },
    defaults: {
      defaultTransactionReadOnly: "on",
      searchPath: "pg_catalog",
      statementTimeout: "5s",
      lockTimeout: "1s",
      idleInTransactionSessionTimeout: "5s"
    },
    allowedStatementIds: [
      "auditor_identity_v1",
      "auditor_membership_v1",
      "auditor_tls_v1",
      "target_session_discovery_v1",
      "target_session_v1",
      "cleanup_sessions_v2",
      "database_acl_v1"
    ]
  },
  cleanup: {
    independentAuditorSessions: true,
    requiredConsecutiveSamples: 2,
    minimumSeparationMilliseconds: 250,
    maximumSeparationMilliseconds: 2_000
  },
  artifacts: {
    schemaVersion: 2,
    count: 4,
    maximumBytesEach: 64 * 1024,
    signatureAlgorithm: "Ed25519",
    signatureDomain: "trailmind-production-observer-v2",
    writeMode: 0o600,
    exclusiveCreate: true,
    fileFsync: true,
    directoryFsync: true
  },
  capabilities: {
    controlPlaneCredential: {
      accepted: false,
      oauthAccepted: false,
      requiredType: "supabase_fine_grained_access_token",
      requiredPermissions: [
        "infra_add_ons_read",
        "organization_admin_read",
        "organization_projects_read",
        "project_admin_read"
      ],
      reason: "provider-enforced staging-only project isolation is unproved on the fixed Free organization"
    },
    advisorFreshness: {
      accepted: false,
      reason: "deprecated advisor GET responses have no reviewed provider recomputation marker"
    },
    billingEvidence: {
      accepted: false,
      reason: "billing addons has no reviewed OAuth scope contract for this observer"
    },
    signingKey: {
      accepted: false,
      reason: "no reviewed production Ed25519 public-key digest is provisioned"
    },
    staticCatalogGate: {
      accepted: false,
      reason: "independent catalog assertion program and expected manifest digests are not pinned"
    },
    cleanupV2: {
      accepted: false,
      reason: "the validator and auditor SQL require distinct sessions, but the unregistered live factory has no accepted three-descriptor cleanup lifecycle"
    },
    productionFactoryRegistration: false
  },
  admissionLevels: {
    staging_initialization: {
      description: "one empty internal disabled staging initialization",
      exactBillingRequired: false,
      providerScopeIsolationRequired: false,
      causalAdvisorFreshnessRequired: false,
      productFlagsMustRemainDisabled: true
    },
    production_admission: {
      description: "closed-beta or production admission",
      exactBillingRequired: true,
      providerScopeIsolationRequired: true,
      causalAdvisorFreshnessRequired: true,
      productFlagsMustRemainDisabledUntilAdmitted: true
    }
  },
  pins: {
    artifactKeyId: null,
    artifactPublicKeySpkiSha256: null,
    auditorSslrootcertSha256: null,
    independentCatalogAssertionProgramSha256: null,
    independentExpectedManifestSha256: null
  }
});

export const STAGING_PHASE1_V2_ADMISSION_LEVELS = Object.freeze([
  "staging_initialization",
  "production_admission"
]);

export class StagingPhase1V2ProductionObserverContractError extends Error {
  constructor(code, decision) {
    super(`trailmind_phase1_v2_production_observer_blocked:${code}`);
    this.name = "StagingPhase1V2ProductionObserverContractError";
    this.code = code;
    if (decision !== undefined) this.decision = decision;
  }
}

export function evaluateStagingPhase1V2AdmissionLevel(
  level,
  explicitEvidence,
  evidenceDependencies = {}
) {
  if (!STAGING_PHASE1_V2_ADMISSION_LEVELS.includes(level)) {
    blocked("admission_level");
  }
  const pins = STAGING_PHASE1_V2_PRODUCTION_OBSERVER_POLICY.pins;
  const blockers = [];
  let validatedEvidence;
  if (explicitEvidence === undefined || explicitEvidence === null) {
    const requirePin = (name, value) => {
      if (typeof value !== "string" || value.length === 0) {
        blockers.push({ category: "unmet_pin", code: name });
      }
    };
    requirePin("artifact_key_id_unpinned", pins.artifactKeyId);
    if (!DIGEST_PATTERN.test(pins.artifactPublicKeySpkiSha256 ?? "")) {
      blockers.push({
        category: "unmet_pin", code: "artifact_public_key_unpinned"
      });
    }
    if (!DIGEST_PATTERN.test(pins.auditorSslrootcertSha256 ?? "")) {
      blockers.push({ category: "unmet_pin", code: "auditor_ca_unpinned" });
    }
    if (!DIGEST_PATTERN.test(
      pins.independentCatalogAssertionProgramSha256 ?? ""
    )) {
      blockers.push({
        category: "unmet_pin", code: "static_catalog_program_unpinned"
      });
    }
    if (!DIGEST_PATTERN.test(
      pins.independentExpectedManifestSha256 ?? ""
    )) {
      blockers.push({
        category: "unmet_pin", code: "static_expected_manifest_unpinned"
      });
    }
    blockers.push({
      category: "evidence_unavailable", code: "auditor_proof_unavailable"
    });
    blockers.push({
      category: "evidence_unavailable", code: "signing_proof_unavailable"
    });
    blockers.push({
      category: "evidence_unavailable",
      code: "cleanup_independent_sessions_unavailable"
    });
  } else {
    try {
      validatedEvidence = validateStagingInitializationEvidence(
        explicitEvidence,
        {
          ...evidenceDependencies,
          consume: level === "staging_initialization"
        }
      );
    } catch (error) {
      blockers.push({
        category: "evidence_invalid",
        code: typeof error?.code === "string"
          ? error.code
          : "evidence_validation_failed"
      });
    }
  }

  if (level === "production_admission") {
    blockers.push(
      { category: "platform_limitation", code: "exact_billing_unavailable" },
      {
        category: "platform_limitation",
        code: "control_plane_project_isolation_unproved"
      },
      {
        category: "platform_limitation",
        code: "advisor_causal_freshness_unproved"
      },
      {
        category: "capability_unavailable",
        code: "production_factory_unregistered"
      }
    );
  }

  const uniqueBlockers = blockers.filter((blocker, index) =>
    blockers.findIndex((candidate) => candidate.code === blocker.code) === index
  );
  return deepFreeze({
    schemaVersion: 2,
    admissionLevel: level,
    status: uniqueBlockers.length === 0 ? "admitted" : "blocked",
    blockers: uniqueBlockers,
    claimBoundaries: {
      advisorCausalFreshness: "unproved",
      exactInvoiceAmount: "unavailable",
      exactUsageAmount: "unavailable",
      freePlan: validatedEvidence ? "verified" : "unobserved",
      selectedPaidAddons: validatedEvidence ? "verified_none" : "unobserved"
    },
    factoryRegistrationAllowed: false,
    initializationAllowed:
      level === "staging_initialization" && uniqueBlockers.length === 0,
    productFlagsRequiredState: "disabled"
  });
}

export function assertStagingPhase1V2StagingInitializationAdmission(
  explicitEvidence,
  evidenceDependencies
) {
  return assertAdmissionDecision(
    "staging_initialization", explicitEvidence, evidenceDependencies
  );
}

export function assertStagingPhase1V2ProductionAdmission(
  explicitEvidence,
  evidenceDependencies
) {
  return assertAdmissionDecision(
    "production_admission", explicitEvidence, evidenceDependencies
  );
}

export function assertStagingPhase1V2ProductionObserverCapabilities() {
  return assertStagingPhase1V2ProductionAdmission();
}

export function assertStagingPhase1V2BillingEvidence() {
  // Free plan and nano compute are deliberately not billing evidence.
  blocked("billing_evidence_unproved");
}

export function validateStagingPhase1V2ControlCredentialDescriptor(value) {
  if (!isExactObject(value, ["descriptor", "lifecycle"]) ||
      !isExactObject(value.lifecycle, [
        "closedAfterRead", "initialOffset", "readCount",
        "retainedCredentialCopies", "singleOpenDescription",
        "unlinkedBeforeRead"
      ]) || value.lifecycle.closedAfterRead !== true ||
      value.lifecycle.initialOffset !== 0 || value.lifecycle.readCount !== 1 ||
      value.lifecycle.retainedCredentialCopies !== 0 ||
      value.lifecycle.singleOpenDescription !== true ||
      value.lifecycle.unlinkedBeforeRead !== true ||
      !isExactObject(value.descriptor, [
        "audience", "credentialType", "expiresAt", "issuedAt", "permissions",
        "projectIsolation", "scopes", "source"
      ]) || value.descriptor.audience !== "api.supabase.com" ||
      value.descriptor.source !== "protected_unlinked_descriptor" ||
      !["provider_enforced_target_only", "unproved"].includes(
        value.descriptor.projectIsolation
      )) {
    blocked("control_credential_descriptor");
  }
  const issuedAt = exactTimestamp(value.descriptor.issuedAt);
  const expiresAt = exactTimestamp(value.descriptor.expiresAt);
  const lifetime = expiresAt.getTime() - issuedAt.getTime();
  if (lifetime <= 0 || lifetime > 60 * 60 * 1_000) {
    blocked("control_credential_descriptor");
  }
  const oauthScopes = [
    "database:read", "organizations:read", "projects:read"
  ];
  const fineGrainedPermissions = [
    "advisors_read", "infra_add_ons_read", "organization_admin_read",
    "organization_projects_read", "project_admin_read"
  ];
  let billingAddonReadAuthoritative = false;
  if (value.descriptor.credentialType === "oauth_access_token") {
    if (!sameJson(value.descriptor.scopes, oauthScopes) ||
        !sameJson(value.descriptor.permissions, [])) {
      blocked("control_credential_scope");
    }
  } else if (value.descriptor.credentialType ===
      "supabase_fine_grained_access_token") {
    if (!sameJson(value.descriptor.scopes, []) ||
        !sameJson(value.descriptor.permissions, fineGrainedPermissions)) {
      blocked("control_credential_scope");
    }
    billingAddonReadAuthoritative = true;
  } else {
    blocked("control_credential_type");
  }
  return deepFreeze({
    accepted: true,
    billingAddonReadAuthoritative,
    credentialType: value.descriptor.credentialType,
    projectIsolationVerified:
      value.descriptor.projectIsolation === "provider_enforced_target_only"
  });
}

export function validateStagingPhase1V2RestrictedBillingObservation(value) {
  if (!isExactObject(value, [
    "computeSize", "credentialDescriptor", "endpoint", "observedAt",
    "organizationPlan", "responseDigest", "selectedAddons", "source"
  ]) || value.endpoint !==
      `/v1/projects/${STAGING_PHASE1_V2_PRODUCTION_OBSERVER_POLICY.target.projectRef}/billing/addons` ||
      value.source !== "supabase_management_api" ||
      value.organizationPlan !== "free" || value.computeSize !== "nano" ||
      !DIGEST_PATTERN.test(value.responseDigest) ||
      !Array.isArray(value.selectedAddons) || value.selectedAddons.length > 100) {
    blocked("billing_observation");
  }
  exactTimestamp(value.observedAt);
  const credential = validateStagingPhase1V2ControlCredentialDescriptor(
    value.credentialDescriptor
  );
  if (credential.billingAddonReadAuthoritative !== true) {
    blocked("billing_evidence_unproved");
  }
  let selectedPaidAddonCount = 0;
  for (const addon of value.selectedAddons) {
    if (!isExactObject(addon, ["type", "variant"]) ||
        !boundedText(addon.type, 128, false) ||
        !isExactObject(addon.variant, ["id", "name", "price"]) ||
        !boundedText(addon.variant.id, 128, false) ||
        !boundedText(addon.variant.name, 512, false) ||
        !isExactObject(addon.variant.price, [
          "amount", "description", "interval", "type"
        ]) || !Number.isFinite(addon.variant.price.amount) ||
        addon.variant.price.amount < 0 ||
        !["hourly", "monthly"].includes(addon.variant.price.interval) ||
        !["fixed", "usage"].includes(addon.variant.price.type) ||
        !boundedText(addon.variant.price.description, 2_048, true)) {
      blocked("billing_observation");
    }
    if (addon.variant.price.amount > 0) selectedPaidAddonCount += 1;
  }
  return deepFreeze({
    computeSize: "verified_nano",
    exactInvoiceAmount: "unavailable",
    exactUsageAmount: "unavailable",
    freePlan: "verified",
    selectedPaidAddons:
      selectedPaidAddonCount === 0 ? "verified_none" : "verified_present",
    selectedPaidAddonCount
  });
}

export function assertStagingPhase1V2AdvisorFreshness(value) {
  if (value !== undefined) {
    validateFreshnessCandidate(value);
  }
  // The currently documented GET response has no accepted provider marker.
  // Date headers, local clocks, ETags, cache keys and repeated bodies cannot
  // change this source-pinned outcome.
  blocked("advisor_freshness_unproved");
}

export function deriveStagingPhase1V2DatabaseRunBinding(value) {
  if (!isExactObject(value, [
    "authorizationBindingDigest", "candidateCommit", "projectRef", "runId"
  ]) || !UUID_PATTERN.test(value.runId) ||
      !DIGEST_PATTERN.test(value.authorizationBindingDigest) ||
      !COMMIT_PATTERN.test(value.candidateCommit) ||
      value.projectRef !==
        STAGING_PHASE1_V2_PRODUCTION_OBSERVER_POLICY.target.projectRef) {
    blocked("observer_cross_binding");
  }
  const databaseRunBindingDigest = sha256(canonicalJson({
    authorizationBindingDigest: value.authorizationBindingDigest,
    candidateCommit: value.candidateCommit,
    projectRef: value.projectRef,
    runId: value.runId
  }));
  return Object.freeze({
    applicationName: `trailmind_p1v2_${databaseRunBindingDigest.slice(0, 24)}`,
    databaseRunBindingDigest
  });
}

export function parseStagingPhase1V2BoundedJson(bytes, options = {}) {
  const limits = {
    maximumBytes: exactLimit(
      options.maximumBytes,
      STAGING_PHASE1_V2_PRODUCTION_OBSERVER_POLICY.management.maximumBodyBytes
    ),
    maximumDepth: exactLimit(
      options.maximumDepth,
      STAGING_PHASE1_V2_PRODUCTION_OBSERVER_POLICY.management.maximumJsonDepth
    ),
    maximumArrayItems: exactLimit(
      options.maximumArrayItems,
      STAGING_PHASE1_V2_PRODUCTION_OBSERVER_POLICY.management.maximumArrayItems
    ),
    maximumObjectKeys: exactLimit(options.maximumObjectKeys, 10_000),
    maximumStringBytes: exactLimit(
      options.maximumStringBytes,
      STAGING_PHASE1_V2_PRODUCTION_OBSERVER_POLICY.management.maximumStringBytes
    ),
    maximumNodes: exactLimit(options.maximumNodes, 20_000)
  };
  const input = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes ?? "");
  if (input.length === 0 || input.length > limits.maximumBytes) {
    blocked("control_response_bounds");
  }
  let source;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(input);
  } catch {
    blocked("control_response_bounds");
  }
  const parser = new StrictJsonParser(source, limits);
  return parser.parse();
}

export function canonicalizeStagingPhase1V2Json(value) {
  return canonicalize(value, new Set());
}

export function classifyStagingPhase1V2AdvisorResponse(value, kind) {
  if (!["security", "performance"].includes(kind) ||
      !isExactObject(value, ["lints"]) || !Array.isArray(value.lints) ||
      value.lints.length > 1_000) {
    blocked("advisor_schema");
  }
  const requiredCategory = kind.toUpperCase();
  const cacheKeys = new Set();
  let blockingFindingCount = 0;
  let noticeCount = 0;
  const levelCounts = { ERROR: 0, INFO: 0, WARN: 0 };
  for (const lint of value.lints) {
    const required = [
      "cache_key", "categories", "description", "detail", "facing",
      "level", "name", "remediation", "title"
    ];
    const keys = Object.keys(lint ?? {}).sort();
    if (!(sameJson(keys, [...required].sort()) ||
        sameJson(keys, [...required, "metadata"].sort()))) {
      blocked("advisor_schema");
    }
    if (!Object.hasOwn(levelCounts, lint.level)) {
      blocked("advisor_unknown_lint");
    }
    if (cacheKeys.has(lint.cache_key)) {
      blocked("advisor_duplicate_lint_identity");
    }
    if (lint.facing !== "EXTERNAL" ||
        !Array.isArray(lint.categories) || lint.categories.length === 0 ||
        lint.categories.some((category) =>
          !["SECURITY", "PERFORMANCE"].includes(category)) ||
        !lint.categories.includes(requiredCategory) ||
        !boundedText(lint.cache_key, 512, false) ||
        !boundedText(lint.name, 512, false) ||
        ["title", "description", "detail", "remediation"].some((field) =>
          !boundedText(lint[field], 16 * 1024, true))) {
      blocked("advisor_schema");
    }
    cacheKeys.add(lint.cache_key);
    levelCounts[lint.level] += 1;
    if (lint.level === "INFO") noticeCount += 1;
    else blockingFindingCount += 1;
  }
  return deepFreeze({
    status: blockingFindingCount === 0 ? "notice-only" : "blocking",
    blockingFindingCount,
    noticeCount,
    levelCounts,
    lintSetDigest: sha256(canonicalJson(value.lints))
  });
}

export function validateStagingPhase1V2AuditorContract(value) {
  const policy = STAGING_PHASE1_V2_PRODUCTION_OBSERVER_POLICY.auditor;
  if (!isExactObject(value, [
    "databaseName", "defaults", "forbiddenAccess", "memberships",
    "role", "roleAttributes", "sessionUserName", "tls"
  ]) || value.databaseName !== policy.database ||
      value.sessionUserName !== policy.role || value.role !== policy.role ||
      !isExactObject(value.roleAttributes, [
        "bypassrls", "canLogin", "connectionLimit", "createdb", "createrole",
        "credentialUnexpired", "inherit", "replication", "superuser"
      ]) || value.roleAttributes.canLogin !== true ||
      value.roleAttributes.credentialUnexpired !== true ||
      value.roleAttributes.connectionLimit !== policy.connectionLimit ||
      Object.entries(value.roleAttributes).some(([name, setting]) =>
        !["canLogin", "connectionLimit", "credentialUnexpired"]
          .includes(name) && setting !== false) ||
      !sameJson(value.memberships, [policy.membership]) ||
      !sameJson(value.defaults, policy.defaults) ||
      !isExactObject(value.tls, ["active", "version"]) ||
      value.tls.active !== true ||
      !["TLSv1.2", "TLSv1.3"].includes(value.tls.version) ||
      !isExactObject(value.forbiddenAccess, [
        "databaseCreate", "databaseTemporary", "genericSql", "ownedObjects",
        "pgMonitor", "pgReadAllData", "pgReadAllSettings", "pgWriteAllData",
        "productData", "productRoutineExecute", "schemaCreate"
      ]) || Object.values(value.forbiddenAccess).some(Boolean)) {
    blocked("auditor_privilege");
  }
  return Object.freeze({ accepted: true, role: policy.role });
}

export function validateStagingPhase1V2TargetSession(value, expected) {
  if (!isSessionBinding(expected) || !isExactObject(value, [
    "applicationName", "backendPid", "backendStart", "backendType",
    "databaseName", "databaseUser", "exactBackendInstanceCount",
    "idleExactInstanceCount", "matchingApplicationCount",
    "samePidOtherInstanceCount", "tls"
  ]) || value.applicationName !== expected.applicationName ||
      value.backendPid !== expected.backendPid ||
      value.backendStart !== expected.backendStart ||
      value.backendType !== "client backend" || value.databaseName !== "postgres" ||
      value.databaseUser !== "postgres" || value.tls !== true ||
      value.exactBackendInstanceCount !== 1 ||
      ![0, 1].includes(value.idleExactInstanceCount) ||
      value.matchingApplicationCount !== 1 ||
      value.samePidOtherInstanceCount !== 0) {
    blocked("auditor_visibility");
  }
  return Object.freeze({ accepted: true });
}

export function validateStagingPhase1V2CleanupSamples(value, expected) {
  const policy = STAGING_PHASE1_V2_PRODUCTION_OBSERVER_POLICY.cleanup;
  if (!isSessionBinding(expected) || !Array.isArray(value) ||
      value.length !== policy.requiredConsecutiveSamples) {
    blocked("cleanup_unproved");
  }
  let previous;
  const snapshotIds = new Set();
  const auditorSessionIds = new Set();
  for (const sample of value) {
    if (!isExactObject(sample, [
      "applicationName", "auditorApplicationName", "auditorBackendPid",
      "auditorBackendStart", "auditorSelfExcluded", "backendPid",
      "backendStart", "clearSnapshot",
      "exactBackendInstanceCount", "idleExactInstanceCount",
      "matchingApplicationCount", "observedAt", "samePidOtherInstanceCount",
      "observedSessions", "statsSnapshotId"
    ]) || sample.applicationName !== expected.applicationName ||
        sample.backendPid !== expected.backendPid ||
        sample.backendStart !== expected.backendStart ||
        sample.clearSnapshot !== true ||
        sample.exactBackendInstanceCount !== 0 ||
        sample.idleExactInstanceCount !== 0 ||
        sample.matchingApplicationCount !== 0 ||
        sample.samePidOtherInstanceCount !== 0 ||
        !/^trailmind_p1v2_auditor_[a-f0-9]{32}$/.test(
          sample.auditorApplicationName
        ) || !Number.isSafeInteger(sample.auditorBackendPid) ||
        sample.auditorBackendPid <= 0 ||
        exactTimestampOrNull(sample.auditorBackendStart) === null ||
        sample.auditorSelfExcluded !== true ||
        !Array.isArray(sample.observedSessions) ||
        sample.observedSessions.length !== 0 ||
        !UUID_PATTERN.test(sample.statsSnapshotId) ||
        snapshotIds.has(sample.statsSnapshotId)) {
      blocked("cleanup_visibility");
    }
    const auditorSessionId = canonicalJson({
      applicationName: sample.auditorApplicationName,
      backendPid: sample.auditorBackendPid,
      backendStart: sample.auditorBackendStart
    });
    if (auditorSessionIds.has(auditorSessionId)) {
      blocked("cleanup_independent_sessions");
    }
    const observedAt = exactTimestamp(sample.observedAt);
    if (previous) {
      const separation = observedAt.getTime() - previous.getTime();
      if (separation < policy.minimumSeparationMilliseconds ||
          separation > policy.maximumSeparationMilliseconds) {
        blocked("cleanup_race");
      }
    }
    previous = observedAt;
    snapshotIds.add(sample.statsSnapshotId);
    auditorSessionIds.add(auditorSessionId);
  }
  return Object.freeze({
    accepted: true,
    sampleDigests: value.map((sample) => sha256(canonicalJson(sample)))
  });
}

function assertAdmissionDecision(level, explicitEvidence, evidenceDependencies) {
  const decision = evaluateStagingPhase1V2AdmissionLevel(
    level, explicitEvidence, evidenceDependencies
  );
  if (decision.status !== "admitted") {
    throw new StagingPhase1V2ProductionObserverContractError(
      `${level}_blocked`,
      decision
    );
  }
  return decision;
}

export function assertStagingPhase1V2StaticStatementId(statementId) {
  if (!STAGING_PHASE1_V2_PRODUCTION_OBSERVER_POLICY.auditor
    .allowedStatementIds.includes(statementId)) {
    blocked("auditor_sql");
  }
  return statementId;
}

class StrictJsonParser {
  constructor(source, limits) {
    this.source = source;
    this.limits = limits;
    this.index = 0;
    this.nodes = 0;
  }

  parse() {
    this.skipWhitespace();
    const value = this.value(0);
    this.skipWhitespace();
    if (this.index !== this.source.length) blocked("control_response_bounds");
    return value;
  }

  value(depth) {
    if (depth > this.limits.maximumDepth ||
        ++this.nodes > this.limits.maximumNodes) {
      blocked("control_response_bounds");
    }
    const character = this.source[this.index];
    if (character === "{") return this.object(depth + 1);
    if (character === "[") return this.array(depth + 1);
    if (character === "\"") return this.string();
    if (character === "t" && this.consumeLiteral("true")) return true;
    if (character === "f" && this.consumeLiteral("false")) return false;
    if (character === "n" && this.consumeLiteral("null")) return null;
    return this.number();
  }

  object(depth) {
    this.index += 1;
    this.skipWhitespace();
    const output = Object.create(null);
    const keys = new Set();
    if (this.source[this.index] === "}") {
      this.index += 1;
      return output;
    }
    while (true) {
      if (this.source[this.index] !== "\"") {
        blocked("control_response_bounds");
      }
      const key = this.string();
      if (keys.has(key) || keys.size >= this.limits.maximumObjectKeys) {
        blocked("control_duplicate_json_key");
      }
      keys.add(key);
      this.skipWhitespace();
      if (this.source[this.index++] !== ":") {
        blocked("control_response_bounds");
      }
      this.skipWhitespace();
      output[key] = this.value(depth);
      this.skipWhitespace();
      const separator = this.source[this.index++];
      if (separator === "}") return output;
      if (separator !== ",") blocked("control_response_bounds");
      this.skipWhitespace();
    }
  }

  array(depth) {
    this.index += 1;
    this.skipWhitespace();
    const output = [];
    if (this.source[this.index] === "]") {
      this.index += 1;
      return output;
    }
    while (true) {
      if (output.length >= this.limits.maximumArrayItems) {
        blocked("control_response_bounds");
      }
      output.push(this.value(depth));
      this.skipWhitespace();
      const separator = this.source[this.index++];
      if (separator === "]") return output;
      if (separator !== ",") blocked("control_response_bounds");
      this.skipWhitespace();
    }
  }

  string() {
    this.index += 1;
    let output = "";
    while (this.index < this.source.length) {
      const character = this.source[this.index++];
      if (character === "\"") {
        if (Buffer.byteLength(output, "utf8") >
            this.limits.maximumStringBytes) {
          blocked("control_response_bounds");
        }
        return output;
      }
      if (character === "\\") {
        output += this.escape();
      } else {
        if (character.charCodeAt(0) < 0x20) {
          blocked("control_response_bounds");
        }
        output += character;
      }
      if (Buffer.byteLength(output, "utf8") >
          this.limits.maximumStringBytes) {
        blocked("control_response_bounds");
      }
    }
    blocked("control_response_bounds");
  }

  escape() {
    const character = this.source[this.index++];
    const simple = {
      "\"": "\"", "\\": "\\", "/": "/", b: "\b", f: "\f",
      n: "\n", r: "\r", t: "\t"
    };
    if (Object.hasOwn(simple, character)) return simple[character];
    if (character !== "u") blocked("control_response_bounds");
    const first = this.unicodeCodeUnit();
    if (first >= 0xd800 && first <= 0xdbff) {
      if (this.source.slice(this.index, this.index + 2) !== "\\u") {
        blocked("control_response_bounds");
      }
      this.index += 2;
      const second = this.unicodeCodeUnit();
      if (second < 0xdc00 || second > 0xdfff) {
        blocked("control_response_bounds");
      }
      return String.fromCodePoint(
        0x10000 + ((first - 0xd800) << 10) + second - 0xdc00
      );
    }
    if (first >= 0xdc00 && first <= 0xdfff) {
      blocked("control_response_bounds");
    }
    return String.fromCharCode(first);
  }

  unicodeCodeUnit() {
    const value = this.source.slice(this.index, this.index + 4);
    if (!/^[a-fA-F0-9]{4}$/.test(value)) {
      blocked("control_response_bounds");
    }
    this.index += 4;
    return Number.parseInt(value, 16);
  }

  number() {
    const match = this.source.slice(this.index).match(
      /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/
    );
    if (!match) blocked("control_response_bounds");
    this.index += match[0].length;
    const value = Number(match[0]);
    if (!Number.isFinite(value)) blocked("control_response_bounds");
    return value;
  }

  consumeLiteral(value) {
    if (this.source.slice(this.index, this.index + value.length) !== value) {
      return false;
    }
    this.index += value.length;
    return true;
  }

  skipWhitespace() {
    while (/\s/.test(this.source[this.index] ?? "") &&
        [" ", "\t", "\n", "\r"].includes(this.source[this.index])) {
      this.index += 1;
    }
  }
}

function validateFreshnessCandidate(value) {
  if (!isExactObject(value, [
    "etag", "localRequestCompletedAt", "providerMarker", "responseDate"
  ])) {
    blocked("advisor_freshness_unproved");
  }
  for (const field of [
    value.etag, value.localRequestCompletedAt, value.providerMarker,
    value.responseDate
  ]) {
    if (!(field === null || typeof field === "string")) {
      blocked("advisor_freshness_unproved");
    }
  }
}

function isSessionBinding(value) {
  return isExactObject(value, [
    "applicationName", "backendPid", "backendStart"
  ]) && typeof value.applicationName === "string" &&
    /^trailmind_p1v2_[a-f0-9]{24}$/.test(value.applicationName) &&
    Number.isSafeInteger(value.backendPid) && value.backendPid > 0 &&
    exactTimestampOrNull(value.backendStart) !== null;
}

function exactTimestampOrNull(value) {
  try { return exactTimestamp(value); } catch { return null; }
}

function exactTimestamp(value) {
  if (typeof value !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.(?:\d{3}|\d{6})Z$/.test(value)) {
    blocked("observer_stale");
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    blocked("observer_stale");
  }
  return parsed;
}

function exactLimit(value, fallback) {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value <= 0 || value > fallback) {
    blocked("control_response_bounds");
  }
  return value;
}

function boundedText(value, maximumBytes, emptyAllowed) {
  return typeof value === "string" && (emptyAllowed || value.length > 0) &&
    Buffer.byteLength(value, "utf8") <= maximumBytes;
}

function canonicalJson(value) {
  return canonicalizeStagingPhase1V2Json(value);
}

function canonicalize(value, ancestors) {
  if (value === null || typeof value === "boolean" ||
      typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) blocked("canonical_json");
    return JSON.stringify(value);
  }
  if (!value || typeof value !== "object" || ancestors.has(value)) {
    blocked("canonical_json");
  }
  const prototype = Object.getPrototypeOf(value);
  if (!(Array.isArray(value) || prototype === Object.prototype ||
      prototype === null)) blocked("canonical_json");
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      if (Object.keys(value).length !== value.length ||
          value.some((nested) => nested === undefined)) {
        blocked("canonical_json");
      }
      return `[${value.map((nested) =>
        canonicalize(nested, ancestors)).join(",")}]`;
    }
    const keys = Object.keys(value).sort();
    if (keys.some((key) => value[key] === undefined)) {
      blocked("canonical_json");
    }
    return `{${keys.map((key) =>
      `${JSON.stringify(key)}:${canonicalize(value[key], ancestors)}`
    ).join(",")}}`;
  } finally {
    ancestors.delete(value);
  }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function isExactObject(value, keys) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    sameJson(Object.keys(value).sort(), [...keys].sort());
}

function sameJson(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}

function blocked(code) {
  throw new StagingPhase1V2ProductionObserverContractError(code);
}
