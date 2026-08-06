import {
  V4_CASE_BINDINGS,
  sha256V4,
  stableSerializeV4
} from "./contract.js";

export const V4_PROOF_RUN_CONTEXT_SCHEMA_VERSION = 2;
export const V4_PROOF_RUN_CONTEXT_VERSION =
  "outdoor-adventure-targeted-live-route-quality-proof-v4-run-context-v2";
export const V4_PROOF_FRESHNESS_LIMIT_MILLISECONDS = 14 * 86_400_000;
export const V4_PROOF_MAXIMUM_FUTURE_SKEW_MILLISECONDS = 5 * 60_000;
export const V4_PROOF_REGION_IDS = Object.freeze([
  "harz-v1",
  "innsbruck-alps-v1"
]);

const HEX_64 = /^[a-f0-9]{64}$/;
const SEALED_CONTEXTS = new WeakSet();
const CANONICAL_UTC =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{3})Z$/;

export class V4ProofRunContextError extends Error {
  constructor(code) {
    super(code);
    this.name = "V4ProofRunContextError";
    this.code = code;
  }
}

export function canonicalProofTimestampV4(value) {
  if (typeof value !== "string") invalid("invalid_proof_timestamp");
  const match = value.match(CANONICAL_UTC);
  if (!match) invalid("invalid_proof_timestamp");
  const [, yearText, monthText, dayText, hourText, minuteText,
    secondText, millisecondText] = match;
  const parts = [yearText, monthText, dayText, hourText, minuteText,
    secondText, millisecondText].map(Number);
  const [year, month, day, hour, minute, second, millisecond] = parts;
  const date = new Date(0);
  date.setUTCHours(hour, minute, second, millisecond);
  date.setUTCFullYear(year, month - 1, day);
  if (!Number.isFinite(date.getTime()) || date.getUTCFullYear() !== year ||
      date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day ||
      date.getUTCHours() !== hour || date.getUTCMinutes() !== minute ||
      date.getUTCSeconds() !== second ||
      date.getUTCMilliseconds() !== millisecond ||
      date.toISOString() !== value) {
    invalid("invalid_proof_timestamp");
  }
  return value;
}

export function capturedProofTimestampV4(value) {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    invalid("invalid_proof_timestamp");
  }
  return value.toISOString();
}

export function createV4ProofRunContext(input, options = {}) {
  if (!plainObject(input) || !plainObject(options) ||
      options.observedAt === undefined) {
    invalid("invalid_proof_run_context");
  }
  const record = normalizedRecord(input);
  validateTemporalContract(record, options.observedAt);
  const digest = sha256V4(record);
  const context = { ...record, digest };
  Object.defineProperty(context, "clock", {
    enumerable: false,
    value: () => new Date(record.proofAsOf)
  });
  deepFreeze(context);
  SEALED_CONTEXTS.add(context);
  return context;
}

export function captureV4ProofRunContext(input, options = {}) {
  if (!plainObject(options) ||
      (options.clock !== undefined && typeof options.clock !== "function")) {
    invalid("invalid_proof_run_context");
  }
  const clock = options.clock ?? (() => new Date());
  const captured = clock();
  const proofAsOf = capturedProofTimestampV4(captured);
  return createV4ProofRunContext({ ...input, proofAsOf }, {
    observedAt: options.observedAt ?? proofAsOf
  });
}

export function validateV4ProofRunContext(context, options = {}) {
  if (!plainObject(context) || typeof context.clock !== "function" ||
      !HEX_64.test(context.digest ?? "") || !SEALED_CONTEXTS.has(context)) {
    invalid("invalid_proof_run_context");
  }
  const record = normalizedRecord(context);
  validateTemporalContract(record, options.observedAt);
  if (sha256V4(record) !== context.digest ||
      capturedProofTimestampV4(context.clock()) !== record.proofAsOf) {
    invalid("proof_run_context_digest_mismatch");
  }
  return true;
}

export function serializeV4ProofRunContext(context) {
  validateV4ProofRunContext(context);
  return stableSerializeV4({
    ...normalizedRecord(context),
    digest: context.digest
  });
}

export function createV4DatabaseClockDiagnostic(context, caseRecords = []) {
  validateV4ProofRunContext(context);
  validateDiagnosticCases(context, caseRecords);
  const diagnostic = {
    schemaVersion: 1,
    proofAsOf: context.proofAsOf,
    proofRunContextDigest: context.digest,
    evidenceSnapshotsDigest: sha256V4(context.evidenceSnapshots),
    cases: caseRecords.map((record) => ({ ...record }))
  };
  return deepFreeze({ ...diagnostic, digest: sha256V4(diagnostic) });
}

export function createV4ProofClockBinding(context, diagnostic) {
  validateV4ProofRunContext(context);
  validateDiagnostic(context, diagnostic);
  const binding = {
    schemaVersion: 1,
    proofAsOf: context.proofAsOf,
    proofRunContextDigest: context.digest,
    databaseDiagnosticDigest: diagnostic.digest,
    evidenceSnapshotsDigest: sha256V4(context.evidenceSnapshots)
  };
  return deepFreeze({ ...binding, digest: sha256V4(binding) });
}

export function validateV4ProofClockBinding(context, diagnostic, binding) {
  validateV4ProofRunContext(context);
  validateDiagnostic(context, diagnostic);
  if (!plainObject(binding) || binding.schemaVersion !== 1 ||
      binding.proofAsOf !== context.proofAsOf ||
      binding.proofRunContextDigest !== context.digest ||
      binding.databaseDiagnosticDigest !== diagnostic.digest ||
      binding.evidenceSnapshotsDigest !== sha256V4(context.evidenceSnapshots) ||
      !HEX_64.test(binding.digest ?? "")) {
    invalid("proof_clock_binding_mismatch");
  }
  const { digest, ...record } = binding;
  if (sha256V4(record) !== digest) invalid("proof_clock_binding_mismatch");
  return true;
}

export function bindV4FutureReceiptClock(fields, context, diagnostic, binding) {
  if (!plainObject(fields) || Object.hasOwn(fields, "semanticReceiptSha256")) {
    invalid("invalid_future_receipt");
  }
  validateV4ProofClockBinding(context, diagnostic, binding);
  const record = {
    ...fields,
    proofAsOf: context.proofAsOf,
    proofRunContextDigest: context.digest,
    proofClockBinding: binding
  };
  return deepFreeze({
    ...record,
    semanticReceiptSha256: sha256V4(record)
  });
}

export function validateV4FutureReceiptClock(
  receipt,
  context,
  diagnostic
) {
  if (!plainObject(receipt) ||
      !HEX_64.test(receipt.semanticReceiptSha256 ?? "")) {
    invalid("invalid_future_receipt");
  }
  validateV4ProofClockBinding(
    context,
    diagnostic,
    receipt.proofClockBinding
  );
  if (receipt.proofAsOf !== context.proofAsOf ||
      receipt.proofRunContextDigest !== context.digest) {
    invalid("receipt_clock_mismatch");
  }
  const { semanticReceiptSha256, ...record } = receipt;
  if (sha256V4(record) !== semanticReceiptSha256) {
    invalid("semantic_receipt_digest_mismatch");
  }
  return true;
}

export async function admitV4ProviderAfterClockReconciliation(
  input,
  admission
) {
  if (!plainObject(input) || typeof admission !== "function") {
    invalid("invalid_provider_admission");
  }
  validateV4ProofClockBinding(
    input.runContext,
    input.databaseDiagnostic,
    input.proofClockBinding
  );
  return admission();
}

function normalizedRecord(input) {
  const allowed = new Set([
    "schemaVersion", "contractVersion", "authorizationReference",
    "ledgerNamespace", "caseManifestDigest", "proofAsOf",
    "evidenceSnapshots", "digest", "clock"
  ]);
  if (Object.keys(input).some((key) => !allowed.has(key)) ||
      input.schemaVersion !== V4_PROOF_RUN_CONTEXT_SCHEMA_VERSION ||
      input.contractVersion !== V4_PROOF_RUN_CONTEXT_VERSION ||
      !boundedIdentifier(input.authorizationReference) ||
      !boundedIdentifier(input.ledgerNamespace) ||
      !HEX_64.test(input.caseManifestDigest ?? "") ||
      !Array.isArray(input.evidenceSnapshots)) {
    invalid("invalid_proof_run_context");
  }
  const evidenceSnapshots = input.evidenceSnapshots.map(normalizedSnapshot)
    .sort((left, right) => left.regionId.localeCompare(right.regionId));
  if (evidenceSnapshots.length !== V4_PROOF_REGION_IDS.length ||
      evidenceSnapshots.some((snapshot, index) =>
        snapshot.regionId !== [...V4_PROOF_REGION_IDS].sort()[index]
      )) invalid("invalid_proof_snapshot_set");
  return {
    schemaVersion: input.schemaVersion,
    contractVersion: input.contractVersion,
    authorizationReference: input.authorizationReference,
    ledgerNamespace: input.ledgerNamespace,
    caseManifestDigest: input.caseManifestDigest,
    proofAsOf: canonicalProofTimestampV4(input.proofAsOf),
    evidenceSnapshots
  };
}

function normalizedSnapshot(value) {
  if (!plainObject(value) || !exactKeys(value, [
    "regionId", "sourceDataAt", "retrievedAt", "importedAt",
    "activeSnapshotAt", "freshnessLimitMilliseconds"
  ]) || !V4_PROOF_REGION_IDS.includes(value.regionId) ||
      value.freshnessLimitMilliseconds !==
        V4_PROOF_FRESHNESS_LIMIT_MILLISECONDS) {
    invalid("invalid_proof_snapshot");
  }
  return {
    regionId: value.regionId,
    sourceDataAt: canonicalProofTimestampV4(value.sourceDataAt),
    retrievedAt: canonicalProofTimestampV4(value.retrievedAt),
    importedAt: canonicalProofTimestampV4(value.importedAt),
    activeSnapshotAt: canonicalProofTimestampV4(value.activeSnapshotAt),
    freshnessLimitMilliseconds: value.freshnessLimitMilliseconds
  };
}

function validateTemporalContract(record, observedAtInput) {
  const proof = milliseconds(record.proofAsOf);
  if (observedAtInput !== undefined) {
    const observedAt = typeof observedAtInput === "string"
      ? canonicalProofTimestampV4(observedAtInput)
      : capturedProofTimestampV4(observedAtInput);
    if (proof - milliseconds(observedAt) >
        V4_PROOF_MAXIMUM_FUTURE_SKEW_MILLISECONDS) {
      invalid("proof_clock_future_skew");
    }
  }
  for (const snapshot of record.evidenceSnapshots) {
    const source = milliseconds(snapshot.sourceDataAt);
    const retrieved = milliseconds(snapshot.retrievedAt);
    const imported = milliseconds(snapshot.importedAt);
    const active = milliseconds(snapshot.activeSnapshotAt);
    if (source > retrieved) invalid("source_after_retrieval");
    if (retrieved > imported) invalid("retrieval_after_import");
    if (imported > active) invalid("import_after_active_snapshot");
    if (proof < source) invalid("proof_before_source_data");
    if (proof < retrieved) invalid("proof_before_retrieval");
    if (proof < imported) invalid("proof_before_import");
    if (proof < active) invalid("proof_before_active_snapshot");
    if (proof - source >= snapshot.freshnessLimitMilliseconds) {
      invalid("stale_proof_evidence");
    }
  }
}

function validateDiagnostic(context, diagnostic) {
  if (!plainObject(diagnostic) || diagnostic.schemaVersion !== 1 ||
      diagnostic.proofAsOf !== context.proofAsOf ||
      diagnostic.proofRunContextDigest !== context.digest ||
      diagnostic.evidenceSnapshotsDigest !==
        sha256V4(context.evidenceSnapshots) ||
      !HEX_64.test(diagnostic.digest ?? "")) {
    invalid("database_diagnostic_clock_mismatch");
  }
  validateDiagnosticCases(context, diagnostic.cases);
  const { digest, ...record } = diagnostic;
  if (sha256V4(record) !== digest) {
    invalid("database_diagnostic_clock_mismatch");
  }
}

function validateDiagnosticCases(context, cases) {
  const expectedIds = V4_CASE_BINDINGS.map((binding) => binding.caseId);
  if (!Array.isArray(cases) || cases.length !== expectedIds.length ||
      cases.some((record, index) =>
        !plainObject(record) || !exactKeys(record, [
          "caseId", "proofAsOf", "researchState", "planningState",
          "proposalCount"
        ]) || record.caseId !== expectedIds[index] ||
        record.proofAsOf !== context.proofAsOf ||
        record.researchState !== "ready" ||
        !["ready", "partial"].includes(record.planningState) ||
        !Number.isInteger(record.proposalCount) ||
        record.proposalCount < 1 || record.proposalCount > 3
      )) invalid("database_diagnostic_clock_mismatch");
}

function milliseconds(value) {
  return new Date(value).getTime();
}

function boundedIdentifier(value) {
  return typeof value === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value);
}

function exactKeys(value, expected) {
  const actual = Object.keys(value).sort();
  const sorted = [...expected].sort();
  return actual.length === sorted.length &&
    actual.every((key, index) => key === sorted[index]);
}

function plainObject(value) {
  return Boolean(value) && typeof value === "object" &&
    !Array.isArray(value);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function invalid(code) {
  throw new V4ProofRunContextError(code);
}
