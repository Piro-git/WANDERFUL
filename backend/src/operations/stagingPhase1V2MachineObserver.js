import { createHash, randomUUID } from "node:crypto";
import { lookup as dnsLookup } from "node:dns/promises";
import {
  closeSync,
  fstatSync,
  readFileSync,
  readSync
} from "node:fs";
import { request as httpsRequest } from "node:https";
import { isIP, Socket } from "node:net";
import { checkServerIdentity } from "node:tls";
import { fileURLToPath } from "node:url";
import pg from "pg";
import {
  STAGING_PHASE1_V2_TARGET
} from "./stagingPhase1V2Operator.js";
import {
  STAGING_PHASE1_V2_DIRECT_HOST,
  STAGING_PHASE1_V2_SESSION_HOST
} from "./stagingPhase1V2Admission.js";

export const STAGING_PHASE1_V2_OBSERVER_CONTRACT_VERSION = "2.0.0";
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
  sourceDigest: sha256(canonicalJson({
    fixture: "trailmind.synthetic.staging-observer-fixture",
    version: "1.0.0"
  })),
  trustMode: "synthetic-preflight"
});

const PRODUCTION_SOURCE_DIGEST = sha256(readFileSync(
  fileURLToPath(import.meta.url)
));
export const STAGING_PHASE1_V2_PRODUCTION_OBSERVER_PACKAGE = deepFreeze({
  packageDigest: sha256(canonicalJson({
    id: "trailmind.supabase.production-machine-observer",
    sourceDigest: PRODUCTION_SOURCE_DIGEST,
    version: "1.0.0"
  })),
  packageId: "trailmind.supabase.production-machine-observer",
  packageVersion: "1.0.0",
  sourceDigest: PRODUCTION_SOURCE_DIGEST,
  trustMode: "oauth-readonly-and-independent-database-auditor"
});

const MAXIMUM_ARTIFACT_BYTES = 32 * 1024;
const MAXIMUM_OBSERVATION_AGE_MILLISECONDS = 5 * 60 * 1_000;
const APPLICATION_NAME = "trailmind_phase1_v2_operator";
const AUDITOR_APPLICATION_PREFIX = "trailmind_p1v2_auditor_";
const CONTROL_HOST = "api.supabase.com";
const CONTROL_PORT = 443;
const CONTROL_TIMEOUT_MILLISECONDS = 5_000;
const CONTROL_PHASE_TIMEOUT_MILLISECONDS = 20_000;
const MAXIMUM_CONTROL_CALLS = 12;
const MAXIMUM_CONTROL_TOKEN_BYTES = 8 * 1_024;
const AUDITOR_CONNECT_TIMEOUT_MILLISECONDS = 10_000;
const AUDITOR_STATEMENT_TIMEOUT_MILLISECONDS = 5_000;
const AUDITOR_LOCK_TIMEOUT_MILLISECONDS = 1_000;
const AUDITOR_IDLE_TIMEOUT_MILLISECONDS = 130_000;
const MAXIMUM_PASSWORD_BYTES = 1_024;
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
const TRAILMIND_ROLES = Object.freeze([
  "app_security_runtime_role",
  "migration_role",
  "outdoor_research_cancellation_control_role",
  "outdoor_research_runtime_role",
  "platform_provisioner",
  "projection_role",
  "pruner_role",
  "readonly_auditor_role",
  "regional_import_role",
  "trailmind_app_owner",
  "trailmind_control_owner",
  "trailmind_import_schema_owner"
]);
const TRAILMIND_SCHEMAS = Object.freeze([
  "trailmind_app", "trailmind_control", "trailmind_gis",
  "trailmind_phase1_guard"
]);
const CONTROL_REQUESTS = deepFreeze({
  project: {
    path: `/v1/projects/${STAGING_PHASE1_V2_TARGET.projectRef}`,
    maximumBytes: 16 * 1024
  },
  organization: {
    path: `/v1/organizations/${STAGING_PHASE1_V2_TARGET.organizationId}`,
    maximumBytes: 8 * 1024
  },
  inventory: {
    path: `/v1/organizations/${STAGING_PHASE1_V2_TARGET.organizationId}` +
      "/projects?limit=100&offset=0&sort=name_asc",
    maximumBytes: 32 * 1024
  },
  security: {
    path: `/v1/projects/${STAGING_PHASE1_V2_TARGET.projectRef}` +
      "/advisors/security?lint_type=sql",
    maximumBytes: 32 * 1024
  },
  performance: {
    path: `/v1/projects/${STAGING_PHASE1_V2_TARGET.projectRef}` +
      "/advisors/performance",
    maximumBytes: 32 * 1024
  }
});
const CONTROL_PHASE_REQUESTS = deepFreeze({
  "pre-control": [
    "project", "organization", "inventory", "security", "performance"
  ],
  "post-ddl-advisors": ["security", "performance"],
  "final-control": [
    "project", "organization", "inventory", "security", "performance"
  ]
});
export const STAGING_PHASE1_V2_CONTROL_REQUEST_MANIFEST = deepFreeze({
  maximumCalls: MAXIMUM_CONTROL_CALLS,
  phaseTimeoutMilliseconds: CONTROL_PHASE_TIMEOUT_MILLISECONDS,
  requiredOAuthScopes: [
    "database:read", "organizations:read", "projects:read"
  ],
  requestTimeoutMilliseconds: CONTROL_TIMEOUT_MILLISECONDS,
  transport: {
    host: CONTROL_HOST,
    method: "GET",
    port: CONTROL_PORT,
    protocol: "https:",
    redirects: false,
    retries: 0,
    tlsMinimumVersion: "TLSv1.2",
    verifyHostname: true
  },
  requests: Object.fromEntries(Object.entries(CONTROL_REQUESTS)
    .map(([name, value]) => [name, { ...value, method: "GET" }])),
  phases: CONTROL_PHASE_REQUESTS
});

const AUDITOR_SQL = deepFreeze({
  begin: "BEGIN READ ONLY",
  rollback: "ROLLBACK",
  timeouts: `
    /* trailmind:phase1-v2:auditor-timeouts */
    SELECT pg_catalog.set_config('statement_timeout', $1, true),
           pg_catalog.set_config('lock_timeout', $2, true),
           pg_catalog.set_config(
             'idle_in_transaction_session_timeout', $3, true
           )`,
  identity: `
    /* trailmind:phase1-v2:auditor-identity */
    SELECT pg_catalog.current_database() AS database_name,
           session_user,
           current_user,
           pg_catalog.pg_backend_pid()::integer AS backend_pid,
           current_setting('application_name') AS application_name,
           current_setting('transaction_read_only') AS transaction_read_only,
           current_setting('server_version_num')::integer
             AS server_version_num,
           current_setting('shared_preload_libraries')
             AS shared_preload_libraries,
           current_setting('supautils.privileged_role', true)
             AS supautils_privileged_role,
           current_setting('supautils.superuser', true)
             AS supautils_superuser,
           current_setting(
             'supautils.privileged_extensions_superuser', true
           ) AS supautils_legacy_superuser,
           current_setting('supautils.privileged_extensions', true)
             AS supautils_privileged_extensions,
           current_setting('is_superuser') AS is_superuser,
           role_record.rolcanlogin,
           role_record.rolsuper,
           role_record.rolcreatedb,
           role_record.rolcreaterole,
           role_record.rolreplication,
           role_record.rolbypassrls,
           pg_catalog.pg_has_role(
             current_user, 'pg_read_all_settings', 'USAGE'
           ) AS can_read_all_settings,
           pg_catalog.pg_has_role(
             current_user, 'pg_read_all_stats', 'USAGE'
           ) AS can_read_all_stats,
           (SELECT managed_admin.rolsuper
              FROM pg_catalog.pg_roles managed_admin
             WHERE managed_admin.rolname = 'supabase_admin')
             AS supabase_admin_superuser,
           NOT pg_catalog.pg_has_role(
             'postgres', 'supabase_admin', 'SET'
           ) AS postgres_cannot_set_supabase_admin,
           NOT EXISTS (
             SELECT 1
               FROM pg_catalog.pg_locks held
              WHERE held.pid = pg_catalog.pg_backend_pid()
                AND held.locktype = 'advisory'
                AND held.granted
           ) AS no_advisory_locks
      FROM pg_catalog.pg_roles role_record
     WHERE role_record.rolname = current_user`,
  foundation: `
    /* trailmind:phase1-v2:auditor-foundation */
    SELECT (SELECT pg_catalog.count(*)::integer
              FROM pg_catalog.pg_roles role_record
             WHERE role_record.rolname = ANY($1::text[]))
             AS trailmind_role_count,
           (SELECT pg_catalog.count(*)::integer
              FROM pg_catalog.pg_namespace namespace
             WHERE namespace.nspname = ANY($2::text[]))
             AS trailmind_schema_count,
           (SELECT pg_catalog.count(*)::integer
              FROM (
                SELECT relation.oid
                  FROM pg_catalog.pg_class relation
                  JOIN pg_catalog.pg_namespace namespace
                    ON namespace.oid = relation.relnamespace
                 WHERE namespace.nspname = ANY($2::text[])
                UNION ALL
                SELECT procedure.oid
                  FROM pg_catalog.pg_proc procedure
                  JOIN pg_catalog.pg_namespace namespace
                    ON namespace.oid = procedure.pronamespace
                 WHERE namespace.nspname = ANY($2::text[])
              ) object_record) AS trailmind_object_count,
           EXISTS (
             SELECT 1 FROM pg_catalog.pg_extension WHERE extname = 'postgis'
           ) AS postgis_installed`,
  sharedAcl: `
    /* trailmind:phase1-v2:auditor-shared-acl */
    WITH shared_object AS (
      SELECT 'database'::text AS object_kind,
             database_record.datname AS object_name,
             database_record.datdba AS owner_oid,
             database_record.datacl AS object_acl,
             'd'::"char" AS acl_kind
        FROM pg_catalog.pg_database database_record
       WHERE database_record.datname = pg_catalog.current_database()
      UNION ALL
      SELECT 'schema'::text,
             namespace.nspname,
             namespace.nspowner,
             namespace.nspacl,
             'n'::"char"
        FROM pg_catalog.pg_namespace namespace
       WHERE namespace.nspname IN ('public', 'extensions')
    )
    SELECT shared_object.object_kind,
           shared_object.object_name,
           pg_catalog.pg_get_userbyid(shared_object.owner_oid) AS owner_name,
           shared_object.object_acl::text AS raw_acl,
           COALESCE((
             SELECT pg_catalog.jsonb_agg(
               pg_catalog.jsonb_build_object(
                 'grantee', CASE WHEN privilege.grantee = 0 THEN 'PUBLIC'
                   ELSE pg_catalog.pg_get_userbyid(privilege.grantee) END,
                 'grantor', pg_catalog.pg_get_userbyid(privilege.grantor),
                 'privilege', privilege.privilege_type,
                 'grantable', privilege.is_grantable
               ) ORDER BY privilege.grantee, privilege.grantor,
                          privilege.privilege_type, privilege.is_grantable
             )
               FROM pg_catalog.aclexplode(COALESCE(
                 shared_object.object_acl,
                 pg_catalog.acldefault(
                   shared_object.acl_kind, shared_object.owner_oid
                 )
               )) privilege
           ), '[]'::jsonb) AS semantic_acl
      FROM shared_object
     ORDER BY shared_object.object_kind, shared_object.object_name`,
  providerAcl: `
    /* trailmind:phase1-v2:auditor-provider-acl-plan */
    WITH preserved_principal AS (
      SELECT role_record.rolname
        FROM pg_catalog.pg_roles role_record
       WHERE role_record.rolname <> ALL($1::text[])
    ), expected_privilege(object_kind, object_name, privilege_name) AS (
      VALUES
        ('database', pg_catalog.current_database(), 'CONNECT'),
        ('database', pg_catalog.current_database(), 'CREATE'),
        ('database', pg_catalog.current_database(), 'TEMPORARY'),
        ('schema', 'public', 'USAGE'),
        ('schema', 'public', 'CREATE'),
        ('schema', 'extensions', 'USAGE'),
        ('schema', 'extensions', 'CREATE')
    )
    SELECT principal.rolname AS principal_name,
           privilege.object_kind,
           privilege.object_name,
           privilege.privilege_name,
           CASE privilege.object_kind
             WHEN 'database' THEN pg_catalog.has_database_privilege(
               principal.rolname, privilege.object_name,
               privilege.privilege_name
             )
             ELSE pg_catalog.has_schema_privilege(
               principal.rolname, privilege.object_name,
               privilege.privilege_name
             )
           END AS effective
      FROM preserved_principal principal
     CROSS JOIN expected_privilege privilege
     ORDER BY principal.rolname, privilege.object_kind,
              privilege.object_name, privilege.privilege_name`,
  cleanup: `
    /* trailmind:phase1-v2:auditor-post-disconnect */
    SELECT pg_catalog.count(*) FILTER (
             WHERE activity.state = 'active'
           )::integer AS active_session_count,
           pg_catalog.count(*) FILTER (
             WHERE activity.state <> 'active' OR activity.state IS NULL
           )::integer AS idle_session_count,
           pg_catalog.count(*)::integer AS exact_session_count,
           pg_catalog.bool_and(
             activity.pid <> pg_catalog.pg_backend_pid()
           ) AS auditor_excluded
      FROM pg_catalog.pg_stat_activity activity
     WHERE activity.datname = pg_catalog.current_database()
       AND activity.pid <> pg_catalog.pg_backend_pid()
       AND activity.application_name = $1
       AND activity.pid = $2`
});
export const STAGING_PHASE1_V2_AUDITOR_SQL_MANIFEST = deepFreeze(
  Object.fromEntries(Object.entries(AUDITOR_SQL).map(([name, sql]) => [
    name, sha256(sql)
  ]))
);
const syntheticFactories = new WeakSet();
const syntheticSessions = new WeakSet();
// Production trust is object identity for the singleton constructed below.
// There is deliberately no public registration or promotion API.
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

const { Client: NodePostgresClient } = pg;
class AuditorChannelBindingClient extends NodePostgresClient {
  _handleAuthSASL(message) {
    super._handleAuthSASL(message);
    this.trailmindChannelBindingEstablished =
      this.saslSession?.mechanism === "SCRAM-SHA-256-PLUS";
  }
}

export const STAGING_PHASE1_V2_REVIEWED_PRODUCTION_OBSERVER_FACTORY =
  Object.freeze({
    packageBinding: STAGING_PHASE1_V2_PRODUCTION_OBSERVER_PACKAGE,
    createSession(binding, { controlCredentialFd } = {}) {
      validateBinding(binding);
      assertProtectedUnlinkedDescriptor(
        controlCredentialFd, MAXIMUM_CONTROL_TOKEN_BYTES, "control_credential"
      );
      const session = createProductionSession({
        binding: deepFreeze(structuredClone(binding)),
        controlCredentialFd
      });
      productionSessions.add(session);
      return session;
    }
  });
productionFactories.add(STAGING_PHASE1_V2_REVIEWED_PRODUCTION_OBSERVER_FACTORY);

export function requireReviewedStagingPhase1V2ProductionObserverFactory(
  candidate
) {
  if (candidate === undefined || candidate === null) blocked("observer_required");
  if (productionFactories.has(candidate)) return candidate;
  blocked("observer_untrusted");
}

export async function prepareStagingPhase1V2ProductionPreControl(
  session,
  request
) {
  if (!productionSessions.has(session)) blocked("observer_untrusted");
  return session.preparePreControl(request);
}

export async function attachStagingPhase1V2ProductionDatabaseAuditor(
  session,
  options
) {
  if (!productionSessions.has(session)) blocked("observer_untrusted");
  return session.attachAuditor(options);
}

export async function disposeStagingPhase1V2ProductionObserverSession(
  session
) {
  if (!productionSessions.has(session)) return;
  await session.dispose();
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
    observerPackageDigest: artifact.observer.packageDigest,
    observerPackageId: artifact.observer.packageId,
    observerPackageVersion: artifact.observer.packageVersion,
    observerSourceDigest: artifact.observer.sourceDigest,
    observerTrustMode: artifact.observer.trustMode,
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

function createProductionSession({ binding, controlCredentialFd }) {
  const packageBinding = STAGING_PHASE1_V2_PRODUCTION_OBSERVER_PACKAGE;
  const sessionBindingDigest = sha256(canonicalJson({
    binding,
    contractDigest: STAGING_PHASE1_V2_OBSERVER_CONTRACT_DIGEST,
    packageBinding
  }));
  const usedIds = new Set();
  const usedNonces = new Set();
  const usedDigests = new Set();
  let nextPhase = 0;
  let previousDigest = null;
  let previousObservedAt = null;
  let preControl;
  let preControlInvariants;
  let auditor;
  let disposed = false;
  let controlCalls = 0;

  const session = Object.freeze({
    packageBinding,
    sessionBindingDigest,
    async preparePreControl(request) {
      if (disposed) blocked("observer_disposed");
      validateRequest(request, "pre-control");
      if (preControl !== undefined) blocked("observer_replay");
      const requestNonce = uniqueRandomId(usedNonces);
      const observation = await observeControlPlane({
        credentialFd: controlCredentialFd,
        phase: "pre-control",
        requestNonce,
        reserveCall() {
          controlCalls += 1;
          if (controlCalls > MAXIMUM_CONTROL_CALLS) blocked("control_call_limit");
        }
      });
      preControl = deepFreeze({ ...observation, requestNonce });
      return Object.freeze({
        completedAt: preControl.completedAt,
        evidenceDigest: preControl.evidenceDigest,
        requestNonce
      });
    },
    async attachAuditor(options) {
      if (disposed) blocked("observer_disposed");
      if (!preControl || auditor) blocked("auditor_order");
      auditor = await createDatabaseAuditor({ binding, ...options });
      return Object.freeze({
        applicationName: auditor.applicationName,
        backendPid: auditor.backendPid,
        evidenceDigest: auditor.preflight.evidenceDigest
      });
    },
    async observe(request) {
      if (disposed) blocked("observer_disposed");
      validateRequest(request, PHASES[nextPhase]);
      if (!preControl || !auditor) blocked("observer_not_ready");
      const requestNonce = request.phase === "pre-control"
        ? preControl.requestNonce
        : uniqueRandomId(usedNonces);
      let evidence;
      if (request.phase === "pre-control") {
        assertFreshInternalTimestamp(preControl.completedAt);
        assertFreshInternalTimestamp(auditor.preflight.observedAt);
        evidence = productionControlEvidence(preControl, auditor.preflight);
      } else if (request.phase === "post-ddl-advisors") {
        const [control, database] = await Promise.all([
          observeControlPlane({
            credentialFd: controlCredentialFd,
            phase: request.phase,
            requestNonce,
            reserveCall() {
              controlCalls += 1;
              if (controlCalls > MAXIMUM_CONTROL_CALLS) {
                blocked("control_call_limit");
              }
            }
          }),
          auditor.inspectAcl()
        ]);
        assertStableDatabaseAcl(auditor.preflight, database);
        evidence = productionAdvisorEvidence(control, database, auditor);
      } else if (request.phase === "final-control") {
        const [control, database] = await Promise.all([
          observeControlPlane({
            credentialFd: controlCredentialFd,
            phase: request.phase,
            requestNonce,
            reserveCall() {
              controlCalls += 1;
              if (controlCalls > MAXIMUM_CONTROL_CALLS) {
                blocked("control_call_limit");
              }
            }
          }),
          auditor.inspectAcl()
        ]);
        assertStableDatabaseAcl(auditor.preflight, database);
        evidence = productionControlEvidence(control, database, auditor);
        closeDescriptor(controlCredentialFd);
      } else {
        evidence = await auditor.proveCleanup(request);
      }
      const observedAt = new Date().toISOString();
      let artifact = sealMachineArtifact({
        binding,
        evidence,
        observedAt,
        observationId: uniqueRandomId(usedIds),
        packageBinding,
        phase: request.phase,
        previousObservationDigest: previousDigest,
        request,
        requestNonce,
        sequence: nextPhase + 1,
        sessionBindingDigest
      });
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
        now: new Date(),
        usedIds,
        usedDigests,
        usedNonces
      });
      if (artifact.phase === "pre-control") {
        preControlInvariants = controlInvariants(artifact.evidence);
      } else if (artifact.phase === "final-control" &&
          !sameJson(
            controlInvariants(artifact.evidence), preControlInvariants
          )) {
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
      if (request.phase === "post-disconnect-cleanup") await session.dispose();
      return artifact;
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      closeDescriptor(controlCredentialFd);
      await auditor?.dispose();
    }
  });
  return session;
}

function sealMachineArtifact({
  binding,
  evidence,
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
    evidence
  };
  return deepFreeze({
    ...unsigned,
    artifactDigest: sha256(canonicalJson(unsigned))
  });
}

function productionControlEvidence(control, database, existingAuditor) {
  return {
    ...control.control,
    expectedDatabaseAclDigest: database.databaseAclDigest,
    providerAclRestorePlanDigest: database.providerAclRestorePlanDigest,
    auditorApplicationName:
      existingAuditor?.applicationName ?? database.applicationName,
    auditorBackendPid: existingAuditor?.backendPid ?? database.backendPid,
    auditorEvidenceDigest: database.evidenceDigest
  };
}

function productionAdvisorEvidence(control, database, auditorSession) {
  return {
    security: control.advisors.security,
    performance: control.advisors.performance,
    databaseAclDigest: database.databaseAclDigest,
    providerAclRestorePlanDigest: database.providerAclRestorePlanDigest,
    auditorApplicationName: auditorSession.applicationName,
    auditorBackendPid: auditorSession.backendPid,
    auditorEvidenceDigest: database.evidenceDigest
  };
}

function assertStableDatabaseAcl(pre, current) {
  if (
    current.databaseAclDigest !== pre.databaseAclDigest ||
    current.providerAclRestorePlanDigest !==
      pre.providerAclRestorePlanDigest
  ) blocked("database_acl_drift");
}

async function observeControlPlane({
  credentialFd,
  phase,
  requestNonce,
  reserveCall
}) {
  const names = CONTROL_PHASE_REQUESTS[phase];
  if (!Array.isArray(names)) blocked("control_phase");
  const deadlineAt = Date.now() + CONTROL_PHASE_TIMEOUT_MILLISECONDS;
  const responses = {};
  const audit = [];
  for (const name of names) {
    const remainingMilliseconds = deadlineAt - Date.now();
    if (remainingMilliseconds <= 0) {
      blocked("control_phase_timeout");
    }
    reserveCall();
    const descriptor = CONTROL_REQUESTS[name];
    const response = await requestControlJson({
      credentialFd,
      descriptor,
      requestNonce,
      timeoutMilliseconds: Math.min(
        CONTROL_TIMEOUT_MILLISECONDS, remainingMilliseconds
      )
    });
    if (Date.now() > deadlineAt) blocked("control_phase_timeout");
    responses[name] = response.value;
    audit.push({
      method: "GET",
      path: descriptor.path,
      requestNonce,
      responseDigest: response.responseDigest,
      serverDate: response.serverDate,
      statusCode: 200
    });
  }
  const completedAt = new Date().toISOString();
  if (phase === "post-ddl-advisors") {
    const advisors = {
      security: parseAdvisorResponse(responses.security, "security"),
      performance: parseAdvisorResponse(
        responses.performance, "performance"
      )
    };
    advisors.security.evidenceDigest = audit.find(
      ({ path }) => path.includes("/advisors/security")
    ).responseDigest;
    advisors.performance.evidenceDigest = audit.find(
      ({ path }) => path.includes("/advisors/performance")
    ).responseDigest;
    return deepFreeze({
      advisors,
      completedAt,
      evidenceDigest: sha256(canonicalJson(audit))
    });
  }
  const project = parseProjectResponse(responses.project);
  const organization = parseOrganizationResponse(responses.organization);
  const inventory = parseInventoryResponse(responses.inventory);
  const security = parseAdvisorResponse(responses.security, "security");
  const performance = parseAdvisorResponse(
    responses.performance, "performance"
  );
  const responseDigest = (name) => audit.find(
    ({ path }) => path === CONTROL_REQUESTS[name].path
  ).responseDigest;
  return deepFreeze({
    completedAt,
    evidenceDigest: sha256(canonicalJson(audit)),
    control: {
      projectName: project.name,
      organizationName: organization.name,
      status: project.status,
      organizationPlan: organization.plan,
      computeSize: inventory.computeSize,
      currency: "USD",
      monthlyCostAmount: 0,
      nonzeroAddonCount: 0,
      postgresMajor: project.postgresMajor,
      databaseName: "postgres",
      securityAdvisorStatus: "completed",
      securityBlockingFindingCount: security.blockingFindingCount,
      securityEvidenceDigest: responseDigest("security"),
      performanceAdvisorStatus: "completed",
      performanceBlockingFindingCount: performance.blockingFindingCount,
      performanceEvidenceDigest: responseDigest("performance"),
      inventoryEvidenceDigest: responseDigest("inventory"),
      controlRequestEvidenceDigest: sha256(canonicalJson(audit)),
      protectedProjects: inventory.protectedProjects,
      featureFlags: observeLauncherFeatureFlags()
    }
  });
}

async function requestControlJson({
  credentialFd,
  descriptor,
  requestNonce,
  timeoutMilliseconds
}) {
  if (!Object.values(CONTROL_REQUESTS).includes(descriptor) ||
      !UUID_PATTERN.test(requestNonce) ||
      !Number.isSafeInteger(timeoutMilliseconds) ||
      timeoutMilliseconds <= 0 ||
      timeoutMilliseconds > CONTROL_TIMEOUT_MILLISECONDS) {
    blocked("control_request");
  }
  const requestDeadlineAt = Date.now() + timeoutMilliseconds;
  const token = readProtectedDescriptor({
    fd: credentialFd,
    maximumBytes: MAXIMUM_CONTROL_TOKEN_BYTES,
    label: "control_credential"
  });
  let tokenText = token.toString("utf8");
  if (isRejectedControlCredential(tokenText)) {
    token.fill(0);
    tokenText = "";
    blocked("control_credential_type");
  }
  const addresses = await resolveControlAddresses(timeoutMilliseconds);
  const transportTimeoutMilliseconds = requestDeadlineAt - Date.now();
  if (transportTimeoutMilliseconds <= 0) blocked("control_transport");
  const selected = addresses[0];
  let authorization = `Bearer ${tokenText}`;
  try {
    return await new Promise((resolve, reject) => {
      let settled = false;
      let timer;
      const chunks = [];
      const wipeChunks = () => {
        for (const chunk of chunks.splice(0)) chunk.fill(0);
      };
      const finish = (operation) => (value) => {
        if (settled) return;
        settled = true;
        if (timer !== undefined) clearTimeout(timer);
        wipeChunks();
        operation(value);
      };
      const pass = finish(resolve);
      const fail = finish(() => rejectObserver("control_transport"));
      const request = httpsRequest({
        agent: false,
        headers: {
          accept: "application/json",
          authorization,
          "cache-control": "no-store",
          "user-agent": "trailmind-production-observer/1.0",
          "x-trailmind-observer-nonce": requestNonce
        },
        host: CONTROL_HOST,
        lookup(_hostname, _options, callback) {
          callback(null, selected.address, selected.family);
        },
        method: "GET",
        minVersion: "TLSv1.2",
        path: descriptor.path,
        port: CONTROL_PORT,
        protocol: "https:",
        rejectUnauthorized: true,
        servername: CONTROL_HOST,
        setHost: true
      }, (response) => {
        try {
          assertControlTls(response.socket, selected);
          if (!validControlResponseMetadata({
            contentEncoding: response.headers["content-encoding"],
            contentLength: response.headers["content-length"],
            contentType: response.headers["content-type"],
            location: response.headers.location,
            maximumBytes: descriptor.maximumBytes,
            serverDate: response.headers.date,
            statusCode: response.statusCode
          })) {
            response.destroy();
            return fail();
          }
          const serverDate = exactServerDate(response.headers.date);
          let total = 0;
          response.on("data", (chunk) => {
            if (settled) {
              chunk.fill(0);
              return;
            }
            total += chunk.length;
            if (total > descriptor.maximumBytes) {
              chunk.fill(0);
              response.destroy();
              fail();
              return;
            }
            chunks.push(chunk);
          });
          response.on("end", () => {
            if (settled) return;
            const bytes = Buffer.concat(chunks, total);
            try {
              const value = JSON.parse(bytes.toString("utf8"));
              pass({
                responseDigest: sha256(canonicalJson(value)),
                serverDate,
                value
              });
            } catch {
              fail();
            } finally {
              bytes.fill(0);
            }
          });
          response.on("error", fail);
        } catch {
          response.destroy();
          fail();
        }
      });
      request.on("error", fail);
      request.end();
      timer = setTimeout(() => {
        request.destroy();
        fail();
      }, transportTimeoutMilliseconds);
      timer.unref?.();
    });
  } finally {
    authorization = "";
    tokenText = "";
    token.fill(0);
  }
}

export function validateStagingPhase1V2ControlCredentialTypeFixture(value) {
  if (typeof value !== "string" || isRejectedControlCredential(value)) {
    blocked("control_credential_type");
  }
  return Object.freeze({ accepted: true });
}

function isRejectedControlCredential(value) {
  if (value.startsWith("sbp_") || value.startsWith("sb_secret_") ||
      value.startsWith("sb_publishable_") || value.length < 32 ||
      /[\u0000-\u0020\u007f]/.test(value)) return true;
  const match = value.match(
    /^[A-Za-z0-9_-]+\.([A-Za-z0-9_-]+)\.[A-Za-z0-9_-]+$/
  );
  if (!match) return false;
  let payload;
  try {
    payload = Buffer.from(match[1], "base64url");
    if (payload.length === 0 || payload.length > 4_096) return true;
    const claims = JSON.parse(payload.toString("utf8"));
    return claims === null || typeof claims !== "object" ||
      Array.isArray(claims) || Object.getPrototypeOf(claims) !== Object.prototype ||
      ["anon", "service_role"].includes(claims.role);
  } catch {
    return true;
  } finally {
    payload?.fill?.(0);
  }
}

function observeLauncherFeatureFlags() {
  const snapshot = {};
  for (const name of FLAG_NAMES) {
    if (process.env[name] !== undefined) blocked("feature_flags_enabled");
    snapshot[name] = false;
  }
  return snapshot;
}

export function validateStagingPhase1V2ControlResponseFixture(name, value) {
  switch (name) {
    case "project": return deepFreeze(parseProjectResponse(value));
    case "organization": return deepFreeze(parseOrganizationResponse(value));
    case "inventory": return deepFreeze(parseInventoryResponse(value));
    case "security":
      return deepFreeze(parseAdvisorResponse(value, "security"));
    case "performance":
      return deepFreeze(parseAdvisorResponse(value, "performance"));
    default: blocked("control_request");
  }
}

export function validateStagingPhase1V2ControlResponseMetadataFixture(value) {
  if (!isExactObject(value, [
    "contentEncoding", "contentLength", "contentType", "location",
    "maximumBytes", "serverDate", "statusCode"
  ]) || !validControlResponseMetadata(value)) blocked("control_transport");
  return Object.freeze({
    serverDate: exactServerDate(value.serverDate),
    statusCode: value.statusCode
  });
}

function validControlResponseMetadata({
  contentEncoding, contentLength, contentType, location, maximumBytes,
  serverDate, statusCode
}) {
  if (statusCode !== 200 || location !== undefined ||
      contentEncoding !== undefined ||
      !Number.isSafeInteger(maximumBytes) || maximumBytes <= 0 ||
      !exactJsonContentType(contentType) ||
      (contentLength !== undefined &&
        (!/^(?:0|[1-9][0-9]{0,5})$/.test(contentLength) ||
          Number(contentLength) > maximumBytes))) return false;
  try {
    exactServerDate(serverDate);
    return true;
  } catch {
    return false;
  }
}

async function resolveControlAddresses(timeoutMilliseconds) {
  let addresses;
  let timer;
  try {
    addresses = await Promise.race([
      dnsLookup(CONTROL_HOST, { all: true, verbatim: true }),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("bounded DNS timeout")),
          timeoutMilliseconds
        );
        timer.unref?.();
      })
    ]);
  } catch {
    blocked("control_dns");
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
  if (!Array.isArray(addresses) || addresses.length === 0 ||
      addresses.length > 16 || addresses.some(({ address, family }) =>
        ![4, 6].includes(family) || isIP(address) !== family ||
        !isPublicAddress(address, family))) blocked("control_dns");
  return addresses;
}

function assertControlTls(socket, selected) {
  let certificate;
  let hostnameError;
  try { certificate = socket?.getPeerCertificate?.(); } catch { /* reject */ }
  try {
    hostnameError = certificate
      ? checkServerIdentity(CONTROL_HOST, certificate)
      : new Error("missing certificate");
  } catch {
    hostnameError = new Error("hostname verification failed");
  }
  if (
    socket?.encrypted !== true || socket?.authorized !== true ||
    socket?.authorizationError != null || !certificate ||
    Object.keys(certificate).length === 0 || hostnameError !== undefined ||
    !["TLSv1.2", "TLSv1.3"].includes(socket?.getProtocol?.()) ||
    socket?.remoteAddress?.toLowerCase?.() !==
      selected.address.toLowerCase()
  ) blocked("control_tls");
}

function parseProjectResponse(value) {
  if (!isExactObject(value, [
    "created_at", "database", "id", "name", "organization_id",
    "organization_slug", "ref", "region", "status"
  ]) || !isExactObject(value.database, [
    "host", "postgres_engine", "release_channel", "version"
  ]) || !boundedIdentifier(value.id) ||
      !boundedIdentifier(value.organization_id) ||
      value.ref !== STAGING_PHASE1_V2_TARGET.projectRef ||
      value.organization_slug !== STAGING_PHASE1_V2_TARGET.organizationId ||
      value.name !== STAGING_PHASE1_V2_TARGET.projectName ||
      value.region !== STAGING_PHASE1_V2_TARGET.region ||
      value.status !== STAGING_PHASE1_V2_TARGET.status ||
      typeof value.database.host !== "string" ||
      value.database.host !== STAGING_PHASE1_V2_DIRECT_HOST ||
      typeof value.database.version !== "string" ||
      !/^17(?:\.|$)/.test(value.database.version) ||
      typeof value.database.postgres_engine !== "string" ||
      value.database.postgres_engine.length === 0 ||
      typeof value.database.release_channel !== "string" ||
      value.database.release_channel.length === 0) blocked("control_project");
  exactTimestamp(value.created_at);
  return { name: value.name, status: value.status, postgresMajor: 17 };
}

function parseOrganizationResponse(value) {
  if (!isExactObject(value, [
    "allowed_release_channels", "id", "name", "opt_in_tags", "plan"
  ]) || !boundedIdentifier(value.id) ||
      value.name !== STAGING_PHASE1_V2_TARGET.organizationName ||
      value.plan !== STAGING_PHASE1_V2_TARGET.organizationPlan ||
      !Array.isArray(value.allowed_release_channels) ||
      !Array.isArray(value.opt_in_tags)) blocked("control_organization");
  return { name: value.name, plan: value.plan };
}

function parseInventoryResponse(value) {
  if (!isExactObject(value, ["pagination", "projects"]) ||
      !isExactObject(value.pagination, ["count", "limit", "offset"]) ||
      !Array.isArray(value.projects) || value.projects.length > 100 ||
      value.pagination.offset !== 0 || value.pagination.limit !== 100 ||
      value.pagination.count !== value.projects.length) {
    blocked("control_inventory");
  }
  const refs = new Set();
  let target;
  const protectedRefs = new Set(PROTECTED_PROJECTS.map(({ ref }) => ref));
  for (const project of value.projects) {
    if (!isExactObject(project, [
      "cloud_provider", "databases", "inserted_at", "is_branch", "name",
      "ref", "region", "status"
    ]) || typeof project.ref !== "string" || refs.has(project.ref) ||
        !Array.isArray(project.databases) || project.databases.length > 8) {
      blocked("control_inventory");
    }
    for (const database of project.databases) {
      if (!isObjectWithAllowedKeys(database, [
        "cloud_provider", "identifier", "infra_compute_size", "region",
        "status", "type"
      ], [
        "disk_last_modified_at", "disk_throughput_mbps", "disk_type",
        "disk_volume_size_gb"
      ]) || [
        "cloud_provider", "identifier", "infra_compute_size", "region",
        "status", "type"
      ].some((field) => typeof database[field] !== "string" ||
        database[field].length === 0)) blocked("control_inventory");
    }
    refs.add(project.ref);
    exactTimestamp(project.inserted_at);
    if (project.ref === STAGING_PHASE1_V2_TARGET.projectRef) target = project;
  }
  if ([...protectedRefs].some((projectRef) => !refs.has(projectRef))) {
    blocked("control_inventory_protected");
  }
  if (!target || target.name !== STAGING_PHASE1_V2_TARGET.projectName ||
      target.region !== STAGING_PHASE1_V2_TARGET.region ||
      target.status !== STAGING_PHASE1_V2_TARGET.status ||
      target.is_branch !== false) blocked("control_inventory_target");
  const primary = target.databases.filter((database) =>
    database?.type === "PRIMARY"
  );
  if (primary.length !== 1 || primary[0].infra_compute_size !==
      STAGING_PHASE1_V2_TARGET.computeSize ||
      primary[0].region !== STAGING_PHASE1_V2_TARGET.region ||
      primary[0].status !== STAGING_PHASE1_V2_TARGET.status) {
    blocked("control_inventory_compute");
  }
  return {
    computeSize: primary[0].infra_compute_size,
    protectedProjects: PROTECTED_PROJECTS
  };
}

function parseAdvisorResponse(value, kind) {
  if (!isExactObject(value, ["lints"]) || !Array.isArray(value.lints) ||
      value.lints.length > 1_000) blocked("advisor_response");
  let blockingFindingCount = 0;
  let noticeCount = 0;
  for (const lint of value.lints) {
    const required = [
      "cache_key", "categories", "description", "detail", "facing",
      "level", "name", "remediation", "title"
    ];
    const keys = Object.keys(lint ?? {}).sort();
    if (!(sameJson(keys, required.sort()) ||
        sameJson(keys, [...required, "metadata"].sort())) ||
        !["ERROR", "WARN", "INFO"].includes(lint.level) ||
        lint.facing !== "EXTERNAL" || !Array.isArray(lint.categories) ||
        lint.categories.length === 0 || lint.categories.some((category) =>
          !["SECURITY", "PERFORMANCE"].includes(category)) ||
        typeof lint.cache_key !== "string" ||
        typeof lint.name !== "string" || lint.name.length === 0 ||
        ["title", "description", "detail", "remediation"].some((field) =>
          typeof lint[field] !== "string")) blocked("advisor_response");
    if (kind === "security" && !lint.categories.includes("SECURITY")) {
      blocked("advisor_category");
    }
    if (kind === "performance" &&
        !lint.categories.includes("PERFORMANCE")) {
      blocked("advisor_category");
    }
    if (lint.level === "ERROR") blockingFindingCount += 1;
    else noticeCount += 1;
  }
  return {
    status: "completed", blockingFindingCount, noticeCount,
    evidenceDigest: "0".repeat(64)
  };
}

function exactJsonContentType(value) {
  return typeof value === "string" &&
    /^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(value);
}

function boundedIdentifier(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 128 &&
    /^[A-Za-z0-9_-]+$/.test(value);
}

function exactServerDate(value) {
  if (typeof value !== "string") blocked("control_timestamp");
  const parsed = new Date(value);
  const age = Date.now() - parsed.getTime();
  if (Number.isNaN(parsed.getTime()) || age < -60_000 ||
      age > MAXIMUM_OBSERVATION_AGE_MILLISECONDS) {
    blocked("control_timestamp");
  }
  return parsed.toISOString();
}

function assertFreshInternalTimestamp(value) {
  const observed = exactTimestamp(value);
  const age = Date.now() - observed.getTime();
  if (age < 0 || age > MAXIMUM_OBSERVATION_AGE_MILLISECONDS) {
    blocked("artifact_freshness");
  }
}

function rejectObserver(code) {
  throw new StagingPhase1V2MachineObserverError(code);
}

async function createDatabaseAuditor({
  auditorCredentialFd,
  caPath,
  connection,
  binding
}) {
  validateAuditorConnection(connection);
  assertProtectedUnlinkedDescriptor(
    auditorCredentialFd, MAXIMUM_PASSWORD_BYTES, "auditor_credential"
  );
  const password = readProtectedDescriptor({
    fd: auditorCredentialFd,
    maximumBytes: MAXIMUM_PASSWORD_BYTES,
    label: "auditor_credential"
  });
  let passwordText = password.toString("utf8");
  if (!validPasswordText(passwordText, password.length)) {
    password.fill(0);
    closeDescriptor(auditorCredentialFd);
    blocked("auditor_credential_format");
  }
  let ca;
  try {
    ca = readFileSync(caPath);
  } catch {
    password.fill(0);
    passwordText = "";
    closeDescriptor(auditorCredentialFd);
    blocked("auditor_ca");
  }
  const applicationName = AUDITOR_APPLICATION_PREFIX + sha256(canonicalJson({
    attemptId: binding.attemptId,
    runId: binding.runId
  })).slice(0, 24);
  let client;
  try {
    client = new AuditorChannelBindingClient({
      application_name: applicationName,
      connectionTimeoutMillis: AUDITOR_CONNECT_TIMEOUT_MILLISECONDS,
      database: connection.database,
      enableChannelBinding: true,
      host: connection.host,
      keepAlive: true,
      keepAliveInitialDelayMillis: 5_000,
      password: passwordText,
      port: connection.port,
      ssl: {
        ca,
        minVersion: "TLSv1.2",
        rejectUnauthorized: true,
        servername: connection.host
      },
      stream: new AuditorPinnedAddressSocket(connection.address),
      user: connection.user
    });
    await client.connect();
    assertAuditorTls(client, connection);
  } catch {
    try { await client?.end?.(); } catch { /* fail closed */ }
    password.fill(0);
    passwordText = "";
    ca.fill(0);
    closeDescriptor(auditorCredentialFd);
    blocked("auditor_connect");
  } finally {
    password.fill(0);
    passwordText = "";
    ca.fill(0);
    closeDescriptor(auditorCredentialFd);
  }
  if (client.connectionParameters) {
    client.connectionParameters.password = undefined;
    client.connectionParameters.ssl = false;
  }
  if ("password" in client) client.password = undefined;
  let backendPid;
  let disposed = false;

  async function queryAllowed(name, values = []) {
    if (disposed || !Object.hasOwn(AUDITOR_SQL, name)) {
      blocked("auditor_sql_allowlist");
    }
    const expected = expectedAuditorParameters(name);
    if (name === "cleanup") {
      if (!Array.isArray(values) || values.length !== 2 ||
          values[0] !== APPLICATION_NAME ||
          !Number.isSafeInteger(values[1]) || values[1] <= 0) {
        blocked("auditor_sql_parameters");
      }
    } else if (!sameJson(values, expected)) {
      blocked("auditor_sql_parameters");
    }
    let result;
    try {
      assertAuditorTls(client, connection);
      result = await client.query(AUDITOR_SQL[name], values);
      assertAuditorTls(client, connection);
    } catch (error) {
      if (error instanceof StagingPhase1V2MachineObserverError) throw error;
      blocked("auditor_query");
    }
    if (!Number.isInteger(client.processID) || client.processID <= 0 ||
        (backendPid !== undefined && client.processID !== backendPid)) {
      blocked("auditor_pid");
    }
    return result;
  }

  await queryAllowed("begin");
  await queryAllowed("timeouts", [
    `${AUDITOR_STATEMENT_TIMEOUT_MILLISECONDS}ms`,
    `${AUDITOR_LOCK_TIMEOUT_MILLISECONDS}ms`,
    `${AUDITOR_IDLE_TIMEOUT_MILLISECONDS}ms`
  ]);
  const identity = await attestAuditorIdentity({
    applicationName,
    backendPid,
    client,
    queryAllowed
  });
  backendPid = identity.backendPid;
  const foundation = await queryAllowed("foundation", [
    TRAILMIND_ROLES, TRAILMIND_SCHEMAS
  ]);
  if (foundation.rowCount !== 1 ||
      foundation.rows[0]?.trailmind_role_count !== 0 ||
      foundation.rows[0]?.trailmind_schema_count !== 0 ||
      foundation.rows[0]?.trailmind_object_count !== 0 ||
      foundation.rows[0]?.postgis_installed !== false) {
    await disposeAuditor();
    blocked("auditor_foundation_not_empty");
  }

  async function inspectAcl() {
    await attestAuditorIdentity({
      applicationName, backendPid, client, queryAllowed
    });
    const sharedAcl = normalizeRows((await queryAllowed("sharedAcl")).rows);
    const providerAcl = normalizeRows((await queryAllowed(
      "providerAcl", [TRAILMIND_ROLES]
    )).rows);
    const evidence = {
      applicationName,
      backendPid,
      databaseAclDigest: sha256(canonicalJson(sharedAcl)),
      providerAclRestorePlanDigest: sha256(canonicalJson(providerAcl)),
      observedAt: new Date().toISOString()
    };
    return deepFreeze({
      ...evidence,
      evidenceDigest: sha256(canonicalJson(evidence))
    });
  }

  async function proveCleanup(request) {
    await attestAuditorIdentity({
      applicationName, backendPid, client, queryAllowed
    });
    const result = await queryAllowed("cleanup", [
      request.applicationName, request.backendPid
    ]);
    const row = result.rows[0] ?? {};
    validateCleanupResult(result.rowCount, row);
    await attestAuditorIdentity({
      applicationName, backendPid, client, queryAllowed
    });
    return {
      applicationName: request.applicationName,
      backendPid: request.backendPid,
      activeSessionCount: row.active_session_count,
      idleSessionCount: row.idle_session_count,
      authorizationBindingDigest: request.authorizationBindingDigest,
      stagedReceiptDigest: request.stagedReceiptDigest,
      auditorApplicationName: applicationName,
      auditorBackendPid: backendPid,
      auditorExcluded: true
    };
  }

  async function disposeAuditor() {
    if (disposed) return;
    try { await client.query(AUDITOR_SQL.rollback); } catch { /* close wins */ }
    disposed = true;
    try { await client.end(); } catch { client.connection?.stream?.destroy?.(); }
    if (client.connectionParameters) {
      client.connectionParameters.password = undefined;
      client.connectionParameters.ssl = false;
    }
    if ("password" in client) client.password = undefined;
  }

  const preflight = await inspectAcl();
  return Object.freeze({
    applicationName,
    backendPid,
    preflight,
    inspectAcl,
    proveCleanup,
    dispose: disposeAuditor
  });
}

function expectedAuditorParameters(name) {
  switch (name) {
    case "begin":
    case "rollback":
    case "identity":
    case "sharedAcl":
      return [];
    case "timeouts":
      return [
        `${AUDITOR_STATEMENT_TIMEOUT_MILLISECONDS}ms`,
        `${AUDITOR_LOCK_TIMEOUT_MILLISECONDS}ms`,
        `${AUDITOR_IDLE_TIMEOUT_MILLISECONDS}ms`
      ];
    case "foundation": return [TRAILMIND_ROLES, TRAILMIND_SCHEMAS];
    case "providerAcl": return [TRAILMIND_ROLES];
    case "cleanup": return null;
    default: blocked("auditor_sql_allowlist");
  }
}

async function attestAuditorIdentity({
  applicationName,
  backendPid,
  client,
  queryAllowed
}) {
  const result = await queryAllowed("identity");
  const row = result.rows[0] ?? {};
  if (result.rowCount !== 1) blocked("auditor_identity");
  return validateAuditorIdentityRow({
    applicationName, backendPid, clientPid: client.processID, row
  });
}

export function validateStagingPhase1V2AuditorIdentityFixture(value) {
  if (!isExactObject(value, [
    "applicationName", "backendPid", "clientPid", "row"
  ])) blocked("auditor_identity");
  return deepFreeze(validateAuditorIdentityRow(value));
}

function validateAuditorIdentityRow({
  applicationName, backendPid, clientPid, row
}) {
  if (row.database_name !== "postgres" ||
      row.session_user !== "postgres" || row.current_user !== "postgres" ||
      row.application_name !== applicationName ||
      row.transaction_read_only !== "on" ||
      Math.trunc(row.server_version_num / 10_000) !== 17 ||
      !settingListIncludes(row.shared_preload_libraries, "supautils") ||
      row.supautils_privileged_role !== "postgres" ||
      ![
        row.supautils_superuser, row.supautils_legacy_superuser
      ].includes("supabase_admin") ||
      !settingListIncludes(
        row.supautils_privileged_extensions, "postgis"
      ) ||
      row.is_superuser !== "off" || row.rolcanlogin !== true ||
      row.rolsuper !== false || row.rolcreatedb !== true ||
      row.rolcreaterole !== true || row.rolreplication !== false ||
      row.rolbypassrls !== false || row.can_read_all_settings !== true ||
      row.can_read_all_stats !== true ||
      row.supabase_admin_superuser !== true ||
      row.postgres_cannot_set_supabase_admin !== true ||
      row.no_advisory_locks !== true ||
      !Number.isInteger(row.backend_pid) || row.backend_pid <= 0 ||
      clientPid !== row.backend_pid ||
      (backendPid !== undefined && row.backend_pid !== backendPid)) {
    blocked("auditor_identity");
  }
  return { backendPid: row.backend_pid };
}

export function validateStagingPhase1V2CleanupResultFixture(value) {
  if (!isExactObject(value, ["row", "rowCount"])) {
    blocked("cleanup_sessions_present");
  }
  validateCleanupResult(value.rowCount, value.row);
  return Object.freeze({ activeSessionCount: 0, idleSessionCount: 0 });
}

function validateCleanupResult(rowCount, row) {
  if (rowCount !== 1 || row.active_session_count !== 0 ||
      row.idle_session_count !== 0 || row.exact_session_count !== 0 ||
      !(row.auditor_excluded === null || row.auditor_excluded === true)) {
    blocked("cleanup_sessions_present");
  }
}

function validateAuditorConnection(value) {
  if (!isExactObject(value, [
    "address", "database", "host", "port", "user"
  ]) || value.database !== "postgres" || value.port !== 5432 ||
      ![STAGING_PHASE1_V2_DIRECT_HOST,
        STAGING_PHASE1_V2_SESSION_HOST].includes(value.host) ||
      (value.host === STAGING_PHASE1_V2_DIRECT_HOST &&
        (value.user !== "postgres" || isIP(value.address) !== 6)) ||
      (value.host === STAGING_PHASE1_V2_SESSION_HOST &&
        (value.user !== `postgres.${STAGING_PHASE1_V2_TARGET.projectRef}` ||
          isIP(value.address) !== 4)) ||
      !isPublicAddress(value.address, isIP(value.address))) {
    blocked("auditor_connection");
  }
}

function assertAuditorTls(client, connection) {
  const stream = client.connection?.stream;
  let certificate;
  let hostnameError;
  try { certificate = stream?.getPeerCertificate?.(); } catch { /* reject */ }
  try {
    hostnameError = certificate
      ? checkServerIdentity(connection.host, certificate)
      : new Error("missing certificate");
  } catch {
    hostnameError = new Error("hostname verification failed");
  }
  if (stream?.encrypted !== true || stream?.authorized !== true ||
      stream?.authorizationError != null || !certificate ||
      Object.keys(certificate).length === 0 || hostnameError !== undefined ||
      !["TLSv1.2", "TLSv1.3"].includes(stream?.getProtocol?.()) ||
      client.trailmindChannelBindingEstablished !== true ||
      stream?.remoteAddress?.toLowerCase?.() !==
        connection.address.toLowerCase()) blocked("auditor_tls");
}

class AuditorPinnedAddressSocket extends Socket {
  constructor(address) {
    super();
    this.address = address;
  }

  connect(port, ignoredHost) {
    if (!Number.isInteger(port) || port !== 5432 || !isIP(this.address)) {
      blocked("auditor_socket");
    }
    return super.connect({ host: this.address, port });
  }
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
    computeSize: evidence.computeSize,
    expectedDatabaseAclDigest: evidence.expectedDatabaseAclDigest,
    inventoryEvidenceDigest: evidence.inventoryEvidenceDigest,
    organizationName: evidence.organizationName,
    organizationPlan: evidence.organizationPlan,
    postgresMajor: evidence.postgresMajor,
    projectName: evidence.projectName,
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
      inventoryEvidenceDigest: "1".repeat(64),
      controlRequestEvidenceDigest: "2".repeat(64),
      expectedDatabaseAclDigest: "c".repeat(64),
      providerAclRestorePlanDigest: "d".repeat(64),
      auditorApplicationName: "trailmind_p1v2_auditor_synthetic",
      auditorBackendPid: 51_241,
      auditorEvidenceDigest: "3".repeat(64),
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
      },
      databaseAclDigest: "c".repeat(64),
      providerAclRestorePlanDigest: "d".repeat(64),
      auditorApplicationName: "trailmind_p1v2_auditor_synthetic",
      auditorBackendPid: 51_241,
      auditorEvidenceDigest: "4".repeat(64)
    };
  }
  return {
    applicationName: request.applicationName,
    backendPid: request.backendPid,
    activeSessionCount: 0,
    idleSessionCount: 0,
    authorizationBindingDigest: request.authorizationBindingDigest,
    stagedReceiptDigest: request.stagedReceiptDigest,
    auditorApplicationName: "trailmind_p1v2_auditor_synthetic",
    auditorBackendPid: 51_241,
    auditorExcluded: true
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
      "packageVersion", "sourceDigest", "trustMode"
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
      "auditorApplicationName", "auditorBackendPid",
      "auditorEvidenceDigest", "computeSize", "controlRequestEvidenceDigest",
      "currency", "databaseName", "expectedDatabaseAclDigest",
      "featureFlags", "monthlyCostAmount", "nonzeroAddonCount",
      "inventoryEvidenceDigest",
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
        !DIGEST_PATTERN.test(value.inventoryEvidenceDigest) ||
        !DIGEST_PATTERN.test(value.controlRequestEvidenceDigest) ||
        !DIGEST_PATTERN.test(value.expectedDatabaseAclDigest) ||
        !DIGEST_PATTERN.test(value.providerAclRestorePlanDigest) ||
        !DIGEST_PATTERN.test(value.auditorEvidenceDigest) ||
        typeof value.auditorApplicationName !== "string" ||
        !value.auditorApplicationName.startsWith(AUDITOR_APPLICATION_PREFIX) ||
        !Number.isSafeInteger(value.auditorBackendPid) ||
        value.auditorBackendPid <= 0) {
      blocked("control_evidence");
    }
    validateProtectedProjects(value.protectedProjects);
    validateFeatureFlags(value.featureFlags);
    return;
  }
  if (artifact.phase === "post-ddl-advisors") {
    if (!isExactObject(artifact.evidence, [
      "auditorApplicationName", "auditorBackendPid",
      "auditorEvidenceDigest", "databaseAclDigest", "performance",
      "providerAclRestorePlanDigest", "security"
    ]) || !DIGEST_PATTERN.test(artifact.evidence.databaseAclDigest) ||
        !DIGEST_PATTERN.test(
          artifact.evidence.providerAclRestorePlanDigest
        ) || !DIGEST_PATTERN.test(artifact.evidence.auditorEvidenceDigest) ||
        typeof artifact.evidence.auditorApplicationName !== "string" ||
        !artifact.evidence.auditorApplicationName.startsWith(
          AUDITOR_APPLICATION_PREFIX
        ) || !Number.isSafeInteger(artifact.evidence.auditorBackendPid) ||
        artifact.evidence.auditorBackendPid <= 0) {
      blocked("advisor_evidence");
    }
    for (const value of [
      artifact.evidence.security, artifact.evidence.performance
    ]) {
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
    "auditorApplicationName", "auditorBackendPid", "auditorExcluded",
    "backendPid", "idleSessionCount", "stagedReceiptDigest"
  ]) || value.applicationName !== APPLICATION_NAME ||
      value.applicationName !== request.applicationName ||
      value.backendPid !== request.backendPid ||
      value.activeSessionCount !== 0 || value.idleSessionCount !== 0 ||
      value.authorizationBindingDigest !== request.authorizationBindingDigest ||
      value.stagedReceiptDigest !== request.stagedReceiptDigest ||
      !DIGEST_PATTERN.test(value.authorizationBindingDigest) ||
      !DIGEST_PATTERN.test(value.stagedReceiptDigest) ||
      typeof value.auditorApplicationName !== "string" ||
      !value.auditorApplicationName.startsWith(AUDITOR_APPLICATION_PREFIX) ||
      !Number.isSafeInteger(value.auditorBackendPid) ||
      value.auditorBackendPid <= 0 || value.auditorExcluded !== true) {
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

function isObjectWithAllowedKeys(value, requiredKeys, optionalKeys) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const keys = Object.keys(value);
  const allowed = new Set([...requiredKeys, ...optionalKeys]);
  return requiredKeys.every((key) => Object.hasOwn(value, key)) &&
    keys.every((key) => allowed.has(key));
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

function assertProtectedUnlinkedDescriptor(fd, maximumBytes, label) {
  try {
    if (!Number.isSafeInteger(fd) || fd < 3) blocked(`${label}_fd`);
    const metadata = fstatSync(fd);
    if (!metadata.isFile() || metadata.isSymbolicLink?.() ||
        metadata.uid !== process.geteuid() ||
        (metadata.mode & 0o777) !== 0o600 || metadata.nlink !== 0 ||
        metadata.size <= 0 || metadata.size > maximumBytes) {
      blocked(`${label}_fd`);
    }
  } catch (error) {
    if (error instanceof StagingPhase1V2MachineObserverError) throw error;
    blocked(`${label}_fd`);
  }
}

function readProtectedDescriptor({ fd, maximumBytes, label }) {
  assertProtectedUnlinkedDescriptor(fd, maximumBytes, label);
  const metadata = fstatSync(fd);
  const output = Buffer.alloc(metadata.size);
  let offset = 0;
  try {
    while (offset < output.length) {
      const count = readSync(
        fd, output, offset, output.length - offset, offset
      );
      if (!Number.isInteger(count) || count <= 0) blocked(`${label}_read`);
      offset += count;
    }
    const after = fstatSync(fd);
    if (after.dev !== metadata.dev || after.ino !== metadata.ino ||
        after.size !== metadata.size || after.nlink !== 0 ||
        after.mtimeMs !== metadata.mtimeMs ||
        after.ctimeMs !== metadata.ctimeMs) blocked(`${label}_race`);
    return output;
  } catch (error) {
    output.fill(0);
    if (error instanceof StagingPhase1V2MachineObserverError) throw error;
    blocked(`${label}_read`);
  }
}

function closeDescriptor(fd) {
  if (!Number.isSafeInteger(fd) || fd < 3) return;
  try { closeSync(fd); } catch { /* owner may already have closed it */ }
}

function uniqueRandomId(used) {
  const value = randomUUID();
  if (!UUID_PATTERN.test(value) || used.has(value)) blocked("request_nonce");
  return value;
}

function normalizeRows(rows) {
  if (!Array.isArray(rows) || rows.length > 100_000) {
    blocked("auditor_rows");
  }
  return rows.map((row) => Object.fromEntries(
    Object.entries(row).sort(([left], [right]) => left.localeCompare(right))
  ));
}

function settingListIncludes(value, expected) {
  return typeof value === "string" && value.split(",")
    .map((entry) => entry.trim()).includes(expected);
}

function validPasswordText(value, byteLengthValue) {
  return typeof value === "string" && value.length > 0 &&
    Buffer.byteLength(value, "utf8") === byteLengthValue &&
    !/[\u0000-\u001f\u007f]/.test(value);
}

function isPublicAddress(address, family) {
  if (family === 4) {
    const parts = address.split(".").map(Number);
    if (parts.length !== 4 || parts.some((part) =>
      !Number.isInteger(part) || part < 0 || part > 255)) return false;
    const [a, b, c] = parts;
    return !(
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0 && c === 0) ||
      (a === 192 && b === 0 && c === 2) ||
      (a === 192 && b === 168) || (a === 198 && b >= 18 && b <= 19) ||
      (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113)
    );
  }
  if (family === 6) {
    const normalized = address.toLowerCase();
    return !(
      normalized === "::" || normalized === "::1" ||
      normalized.startsWith("fc") || normalized.startsWith("fd") ||
      /^fe[89ab]/.test(normalized) || normalized.startsWith("2001:db8:") ||
      normalized.startsWith("::ffff:")
    );
  }
  return false;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}

function blocked(code) {
  throw new StagingPhase1V2MachineObserverError(code);
}
