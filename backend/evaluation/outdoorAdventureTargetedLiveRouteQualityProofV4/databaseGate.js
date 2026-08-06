import {
  V4_CASE_BINDINGS,
  V4_MANIFEST_DIGEST,
  sha256V4
} from "./contract.js";
import {
  V4_PROOF_FRESHNESS_LIMIT_MILLISECONDS,
  V4_PROOF_RUN_CONTEXT_SCHEMA_VERSION,
  V4_PROOF_RUN_CONTEXT_VERSION,
  captureV4ProofRunContext,
  capturedProofTimestampV4,
  createV4DatabaseClockDiagnostic,
  validateV4ProofRunContext
} from "./proofRunContext.js";
import {
  buildResearchGuidedRouteCandidatePlanV2,
  validateResearchGuidedRouteCandidatePlanV2,
  validateResearchGuidedRouteCandidatePlanV2ForResearch
} from "../../src/routeResearch/researchGuidedRouteCandidatePlannerV2.js";

export const V4_DATABASE_CLOCK_EVIDENCE_QUERY = `
SELECT region.region_id,
       import.source_data_at,
       import.retrieved_at,
       import.imported_at,
       run.completed_at AS active_snapshot_at,
       statement_timestamp() AS observed_at,
       LEAST(
         region.freshness_threshold_days,
         policy.maximum_input_age_days
       )::integer AS freshness_limit_days
  FROM outdoor_evidence_regions region
  JOIN outdoor_evidence_imports import
    ON import.import_id = region.active_import_id
   AND import.region_id = region.region_id
   AND import.status = 'active'
  JOIN outdoor_research_active_projection_runs run
    ON run.region_id = region.region_id
   AND run.input_import_id = import.import_id
   AND run.status = 'active'
  JOIN outdoor_research_source_policies policy
    ON policy.source_policy_id = run.source_policy_id
   AND policy.lifecycle_state = 'active'
 WHERE region.region_id = ANY($1::text[])
 ORDER BY region.region_id`;

export class V4DatabaseGateError extends Error {
  constructor(code) {
    super(code);
    this.name = "V4DatabaseGateError";
    this.code = code;
  }
}

export async function captureV4ProofRunContextAfterImports(input) {
  if (!plainObject(input) || !input.pool ||
      typeof input.pool.query !== "function" ||
      (input.clock !== undefined && typeof input.clock !== "function")) {
    invalid("invalid_database_gate_dependencies");
  }
  const evidence = await readV4DatabaseClockEvidenceRecord(input.pool);
  return captureV4ProofRunContext({
    schemaVersion: V4_PROOF_RUN_CONTEXT_SCHEMA_VERSION,
    contractVersion: V4_PROOF_RUN_CONTEXT_VERSION,
    authorizationReference: input.authorizationReference,
    ledgerNamespace: input.ledgerNamespace,
    caseManifestDigest: input.caseManifestDigest ?? V4_MANIFEST_DIGEST,
    evidenceSnapshots: evidence.snapshots
  }, {
    clock: input.clock,
    observedAt: evidence.observedAt
  });
}

export async function reconcileV4DatabaseClockEvidence(pool, runContext) {
  validateV4ProofRunContext(runContext);
  const current = await readV4DatabaseClockEvidence(pool);
  if (sha256V4(current) !== sha256V4(runContext.evidenceSnapshots)) {
    invalid("database_snapshot_changed_after_clock_seal");
  }
  return true;
}

export async function runV4DatabasePlanningClockGate(input) {
  if (!plainObject(input) || !Array.isArray(input.cases) ||
      !(input.intents instanceof Map) ||
      typeof input.researchAdventure !== "function" ||
      (input.buildCandidatePlan !== undefined &&
        typeof input.buildCandidatePlan !== "function") ||
      (input.validateCandidatePlan !== undefined &&
        typeof input.validateCandidatePlan !== "function") ||
      (input.validateCandidatePlanForResearch !== undefined &&
        typeof input.validateCandidatePlanForResearch !== "function")) {
    invalid("invalid_database_gate_dependencies");
  }
  validateV4ProofRunContext(input.runContext);
  const expectedIds = V4_CASE_BINDINGS.map((binding) => binding.caseId);
  if (input.cases.length !== expectedIds.length ||
      input.cases.some((evaluationCase, index) =>
        evaluationCase?.id !== expectedIds[index] ||
        !input.intents.has(evaluationCase.id)
      )) invalid("invalid_canonical_case_set");

  const records = [];
  const buildCandidatePlan = input.buildCandidatePlan ??
    buildResearchGuidedRouteCandidatePlanV2;
  const validateCandidatePlan = input.validateCandidatePlan ??
    validateResearchGuidedRouteCandidatePlanV2;
  const validateCandidatePlanForResearch =
    input.validateCandidatePlanForResearch ??
      validateResearchGuidedRouteCandidatePlanV2ForResearch;
  for (const evaluationCase of input.cases) {
    const research = await input.researchAdventure(
      input.intents.get(evaluationCase.id),
      {
        repository: input.repository,
        clock: input.runContext.clock,
        totalTimeoutMs: input.totalTimeoutMs ?? 30_000
      }
    );
    if (research?.state !== "ready") {
      invalid(`database_preprovider_plan_${research?.state ?? "invalid"}`);
    }
    const plan = validateCandidatePlan(buildCandidatePlan(
      research.dossier,
      research.trailAccessResolution,
      { maximumProposals: 3 }
    ));
    validateCandidatePlanForResearch(
      plan,
      research.dossier,
      research.trailAccessResolution,
      { maximumProposals: 3 }
    );
    if (!Array.isArray(plan.proposals) || plan.proposals.length < 1 ||
        plan.proposals.length > 3) {
      invalid("database_preprovider_plan_invalid");
    }
    const record = {
      caseId: evaluationCase.id,
      proofAsOf: capturedProofTimestampV4(input.runContext.clock()),
      researchState: research.state,
      planningState: plan.state,
      proposalCount: plan.proposals.length
    };
    records.push(record);
  }
  return createV4DatabaseClockDiagnostic(input.runContext, records);
}

export async function readV4DatabaseClockEvidence(pool) {
  return (await readV4DatabaseClockEvidenceRecord(pool)).snapshots;
}

async function readV4DatabaseClockEvidenceRecord(pool) {
  if (!pool || typeof pool.query !== "function") {
    invalid("invalid_database_gate_dependencies");
  }
  const result = await pool.query(V4_DATABASE_CLOCK_EVIDENCE_QUERY, [
    ["harz-v1", "innsbruck-alps-v1"]
  ]);
  if (!Array.isArray(result?.rows) || result.rows.length !== 2) {
    invalid("invalid_database_clock_evidence");
  }
  const observed = new Set(result.rows.map((row) =>
    databaseTimestamp(row.observed_at)
  ));
  if (observed.size !== 1) invalid("database_clock_observation_mismatch");
  const snapshots = result.rows.map((row) => {
    if (!row || !["harz-v1", "innsbruck-alps-v1"].includes(row.region_id) ||
        Number(row.freshness_limit_days) * 86_400_000 !==
          V4_PROOF_FRESHNESS_LIMIT_MILLISECONDS) {
      invalid("invalid_database_clock_evidence");
    }
    return {
      regionId: row.region_id,
      sourceDataAt: databaseTimestamp(row.source_data_at),
      retrievedAt: databaseTimestamp(row.retrieved_at),
      importedAt: databaseTimestamp(row.imported_at),
      activeSnapshotAt: databaseTimestamp(row.active_snapshot_at),
      freshnessLimitMilliseconds: V4_PROOF_FRESHNESS_LIMIT_MILLISECONDS
    };
  }).sort((left, right) => left.regionId.localeCompare(right.regionId));
  return { snapshots, observedAt: [...observed][0] };
}

function databaseTimestamp(value) {
  const date = value instanceof Date ? value : new Date(value);
  try {
    return capturedProofTimestampV4(date);
  } catch {
    invalid("invalid_database_clock_evidence");
  }
}

function plainObject(value) {
  return Boolean(value) && typeof value === "object" &&
    !Array.isArray(value);
}

function invalid(code) {
  throw new V4DatabaseGateError(code);
}
