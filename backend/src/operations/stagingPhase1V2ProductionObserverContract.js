import { createHash } from "node:crypto";
import { TextDecoder } from "node:util";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST_PATTERN = /^[a-f0-9]{64}$/;
const COMMIT_PATTERN = /^[a-f0-9]{40}$/;

export const STAGING_PHASE1_V2_PRODUCTION_OBSERVER_POLICY = deepFreeze({
  schemaVersion: 1,
  contractId: "trailmind-production-observer-acceptance-v1",
  packageId: "trailmind.production.staging-phase1-v2-observer",
  trustMode: "production-authenticated-v1",
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
    maximumCalls: 12,
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
      "database_acl_v1"
    ]
  },
  cleanup: {
    requiredConsecutiveSamples: 2,
    minimumSeparationMilliseconds: 250,
    maximumSeparationMilliseconds: 2_000
  },
  artifacts: {
    schemaVersion: 2,
    count: 4,
    maximumBytesEach: 64 * 1024,
    signatureAlgorithm: "Ed25519",
    signatureDomain: "trailmind-production-observer-v1",
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
      reason: "two fresh post-disconnect auditor-session observations are not implemented"
    },
    productionFactoryRegistration: false
  }
});

export class StagingPhase1V2ProductionObserverContractError extends Error {
  constructor(code) {
    super(`trailmind_phase1_v2_production_observer_blocked:${code}`);
    this.name = "StagingPhase1V2ProductionObserverContractError";
    this.code = code;
  }
}

export function assertStagingPhase1V2ProductionObserverCapabilities() {
  const capabilities =
    STAGING_PHASE1_V2_PRODUCTION_OBSERVER_POLICY.capabilities;
  if (capabilities.controlPlaneCredential.accepted !== true) {
    blocked("control_plane_project_isolation_unproved");
  }
  if (capabilities.billingEvidence.accepted !== true) {
    blocked("billing_evidence_unproved");
  }
  if (capabilities.advisorFreshness.accepted !== true) {
    blocked("advisor_freshness_unproved");
  }
  if (capabilities.signingKey.accepted !== true) {
    blocked("observer_signature_key");
  }
  if (capabilities.staticCatalogGate.accepted !== true) {
    blocked("static_catalog_gate_unproved");
  }
  if (capabilities.cleanupV2.accepted !== true) {
    blocked("cleanup_unproved");
  }
  if (capabilities.productionFactoryRegistration !== true) {
    blocked("observer_required");
  }
  return Object.freeze({ admitted: true });
}

export function assertStagingPhase1V2BillingEvidence() {
  // Free plan and nano compute are deliberately not billing evidence.
  blocked("billing_evidence_unproved");
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
    if (lint.facing !== "EXTERNAL" ||
        !Array.isArray(lint.categories) || lint.categories.length === 0 ||
        lint.categories.some((category) =>
          !["SECURITY", "PERFORMANCE"].includes(category)) ||
        !lint.categories.includes(requiredCategory) ||
        !boundedText(lint.cache_key, 512, false) ||
        cacheKeys.has(lint.cache_key) || !boundedText(lint.name, 512, false) ||
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
  for (const sample of value) {
    if (!isExactObject(sample, [
      "applicationName", "backendPid", "backendStart", "clearSnapshot",
      "exactBackendInstanceCount", "idleExactInstanceCount",
      "matchingApplicationCount", "observedAt", "samePidOtherInstanceCount",
      "statsSnapshotId"
    ]) || sample.applicationName !== expected.applicationName ||
        sample.backendPid !== expected.backendPid ||
        sample.backendStart !== expected.backendStart ||
        sample.clearSnapshot !== true ||
        sample.exactBackendInstanceCount !== 0 ||
        sample.idleExactInstanceCount !== 0 ||
        sample.matchingApplicationCount !== 0 ||
        sample.samePidOtherInstanceCount !== 0 ||
        !UUID_PATTERN.test(sample.statsSnapshotId) ||
        snapshotIds.has(sample.statsSnapshotId)) {
      blocked("cleanup_visibility");
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
  }
  return Object.freeze({
    accepted: true,
    sampleDigests: value.map((sample) => sha256(canonicalJson(sample)))
  });
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
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
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
