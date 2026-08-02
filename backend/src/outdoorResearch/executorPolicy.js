export const OUTDOOR_RESEARCH_EXECUTOR_POLICY_V1 = deepFreeze({
  schemaVersion: 1,
  minimumSearchRadiusMeters: 5_000,
  maximumSearchRadiusMeters: 50_000,
  defaultSearchDistanceKm: {
    hiking: 20,
    trail_running: 16,
    biking: 40
  },
  maximumHighlightsPerOperation: 32,
  maximumHighlightTrailSeparationMeters: 75,
  maximumRoutesPerOperation: 24,
  maximumMembershipsPerRoute: 1,
  maximumRepositoryRowsPerOperation: 160,
  defaultStatementTimeoutMs: 2_500,
  minimumStatementTimeoutMs: 100,
  maximumStatementTimeoutMs: 15_000,
  defaultTotalTimeoutMs: 7_500,
  minimumTotalTimeoutMs: 250,
  maximumTotalTimeoutMs: 30_000
});

const SAFE_ERROR_MESSAGES = Object.freeze({
  invalid_intent: "Outdoor research intent is invalid.",
  invalid_dependencies: "Outdoor research dependencies are invalid.",
  invalid_region_bindings: "Outdoor research region bindings are invalid.",
  database_unavailable: "Outdoor research evidence is temporarily unavailable.",
  repository_failed: "Outdoor research evidence is temporarily unavailable.",
  repository_timed_out: "Outdoor research evidence query timed out.",
  request_cancelled: "Outdoor research was cancelled.",
  execution_timed_out: "Outdoor research timed out.",
  malformed_evidence: "Outdoor research evidence was rejected.",
  operation_scope_violation: "Outdoor research evidence exceeded its approved scope.",
  dossier_validation_failed: "Outdoor research could not assemble a valid dossier.",
  result_too_large: "Outdoor research evidence exceeded its safety limit.",
  inconsistent_snapshot: "Outdoor research evidence changed during execution."
});

export class OutdoorResearchExecutorError extends Error {
  constructor(code, options = {}) {
    const safeCode = Object.hasOwn(SAFE_ERROR_MESSAGES, code)
      ? code
      : "repository_failed";
    super(SAFE_ERROR_MESSAGES[safeCode], { cause: options.cause });
    this.name = "OutdoorResearchExecutorError";
    this.code = safeCode;
  }
}

export function outdoorResearchExecutorError(code, options) {
  return new OutdoorResearchExecutorError(code, options);
}

export function strictExecutorDateV1(value, errorCode = "malformed_evidence") {
  if (value instanceof Date) {
    const date = new Date(value.getTime());
    if (!Number.isFinite(date.getTime())) {
      throw outdoorResearchExecutorError(errorCode);
    }
    return date;
  }
  if (typeof value !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) {
    throw outdoorResearchExecutorError(errorCode);
  }
  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?Z$/
  );
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const millisecond = Number((match[7] ?? "").padEnd(3, "0"));
  const date = new Date(0);
  date.setUTCHours(hour, minute, second, millisecond);
  date.setUTCFullYear(year, month - 1, day);
  if (!Number.isFinite(date.getTime()) ||
      date.getUTCFullYear() !== year ||
      date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day ||
      date.getUTCHours() !== hour ||
      date.getUTCMinutes() !== minute ||
      date.getUTCSeconds() !== second ||
      date.getUTCMilliseconds() !== millisecond) {
    throw outdoorResearchExecutorError(errorCode);
  }
  return date;
}

export function deriveResearchSearchRadiusMetersV1(intent) {
  if (!intent || typeof intent !== "object") {
    throw new OutdoorResearchExecutorError("invalid_intent");
  }
  const policy = OUTDOOR_RESEARCH_EXECUTOR_POLICY_V1;
  const distanceKm = intent.distanceRangeKm?.max ??
    policy.defaultSearchDistanceKm[intent.activity];
  if (!Number.isFinite(distanceKm) || distanceKm <= 0) {
    throw new OutdoorResearchExecutorError("invalid_intent");
  }
  const requestedRadiusMeters = Math.ceil(distanceKm * 500);
  return Math.min(
    policy.maximumSearchRadiusMeters,
    Math.max(policy.minimumSearchRadiusMeters, requestedRadiusMeters)
  );
}

export function boundedExecutorTimeout(
  value,
  fallback,
  minimum,
  maximum
) {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new OutdoorResearchExecutorError("invalid_dependencies");
  }
  return value;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}
