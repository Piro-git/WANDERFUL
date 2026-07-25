import { HIGH_STAKES_PREDICATES } from "./contracts.js";
import {
  outdoorResearchExecutorError,
  strictExecutorDateV1
} from "./executorPolicy.js";
import { validateEvidenceClaimV1 } from "./validation.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HIGH_STAKES = new Set(HIGH_STAKES_PREDICATES);
const FRESHNESS_STATES = new Set(["current", "stale", "expired", "unknown"]);
const VALUE_COLUMNS = Object.freeze({
  text: "value_text",
  boolean: "value_boolean",
  number: "value_number",
  integer: "value_integer",
  timestamp: "value_timestamp",
  entity_reference: "value_entity_id"
});

export function transformAssertionRowToEvidenceClaimV1(row, operation) {
  assertRecord(row);
  enforceAssertionOperationScope(row, operation);
  const freshness = enumField(row.freshness_state, FRESHNESS_STATES);
  const value = assertionValue(row);
  const predicate = boundedString(row.predicate, 1, 80);
  const claim = {
    schemaVersion: 1,
    claimId: uuid(row.assertion_id),
    entityId: uuid(row.entity_id),
    predicate,
    value,
    evidenceClass: exactMappedEvidenceClass(row.evidence_class),
    sourceReference: sourceReference(row),
    provenance: {
      identifier: boundedString(row.provenance_identifier, 1, 500),
      adapterVersion: boundedString(row.adapter_schema_version, 1, 80),
      recordVersion: nullableRecordVersion(row.source_version)
    },
    observedAt: nullableTimestamp(row.observed_at),
    retrievedAt: timestamp(row.retrieved_at),
    validFrom: nullableTimestamp(row.valid_from),
    validUntil: nullableTimestamp(row.valid_until),
    freshness,
    resolutionState: resolutionState(predicate, value, freshness),
    relevantLimitationCodes: limitationsForPredicate(predicate)
  };
  try {
    return validateEvidenceClaimV1(claim);
  } catch (error) {
    throw outdoorResearchExecutorError("malformed_evidence", { cause: error });
  }
}

export function transformMembershipRowToEvidenceClaimV1(row, operation) {
  assertRecord(row);
  enforceMembershipOperationScope(row, operation);
  const freshness = enumField(row.freshness_state, FRESHNESS_STATES);
  const recordVersion = nullableRecordVersion(
    objectField(row.record_provenance)?.relation_osm_version
  );
  const claim = {
    schemaVersion: 1,
    claimId: uuid(row.relationship_id),
    // Candidate validation requires every referenced relationship claim to
    // belong to the route candidate. The segment remains the typed value.
    entityId: uuid(row.route_entity_id),
    predicate: "mapped_hiking_route_membership",
    value: {
      type: "entity_reference",
      value: uuid(row.segment_entity_id)
    },
    evidenceClass: exactMappedEvidenceClass(row.evidence_class),
    sourceReference: sourceReference(row),
    provenance: {
      identifier: boundedString(row.provenance_identifier, 1, 500),
      adapterVersion: boundedString(row.adapter_schema_version, 1, 80),
      recordVersion
    },
    observedAt: nullableTimestamp(row.observed_at),
    retrievedAt: timestamp(row.retrieved_at),
    validFrom: nullableTimestamp(row.valid_from),
    validUntil: nullableTimestamp(row.valid_until),
    freshness,
    resolutionState: freshness === "current" ? "known" :
      freshness === "stale" || freshness === "expired" ? "stale" : "unavailable",
    relevantLimitationCodes: [
      "mapped_presence_only",
      "official_status_unverified"
    ]
  };
  try {
    return validateEvidenceClaimV1(claim);
  } catch (error) {
    throw outdoorResearchExecutorError("malformed_evidence", { cause: error });
  }
}

export function sourceMetadataFromEvidenceRow(row) {
  assertRecord(row);
  return Object.freeze({
    sourceId: uuid(row.source_id),
    sourceKey: boundedString(row.source_key, 1, 80),
    sourceCategory: boundedString(row.source_category, 1, 80),
    evidenceClass: exactMappedEvidenceClass(row.evidence_class),
    licenseIdentifier: boundedString(row.license_identifier, 1, 120),
    attributionRequired: Boolean(row.attribution_requirements),
    retrievedAt: nullableTimestamp(row.retrieved_at)
  });
}

function enforceAssertionOperationScope(row, operation) {
  assertOperation(operation);
  if (!operation.acceptableSourceCategories.includes(row.source_category) ||
      !operation.entityCategories.includes(row.entity_category) ||
      !operation.predicates.includes(row.predicate)) {
    throw outdoorResearchExecutorError("operation_scope_violation");
  }
  if (row.source_category !== "openstreetmap_open_mapping" ||
      row.evidence_class !== "mapped") {
    throw outdoorResearchExecutorError("operation_scope_violation");
  }
}

function enforceMembershipOperationScope(row, operation) {
  assertOperation(operation);
  if (operation.operationType !== "retrieve_mapped_hiking_routes" ||
      operation.informationNeed !== "mapped_hiking_routes" ||
      !operation.predicates.includes("mapped_hiking_route_membership") ||
      !operation.entityCategories.includes("hiking_route") ||
      !operation.entityCategories.includes("trail_segment") ||
      !operation.acceptableSourceCategories.includes(row.source_category) ||
      row.source_category !== "openstreetmap_open_mapping" ||
      row.evidence_class !== "mapped") {
    throw outdoorResearchExecutorError("operation_scope_violation");
  }
}

function assertionValue(row) {
  const type = boundedString(row.value_type, 1, 40);
  if (type === "unknown") return { type };
  const column = VALUE_COLUMNS[type];
  if (!column) throw outdoorResearchExecutorError("malformed_evidence");
  const raw = row[column];
  if (type === "entity_reference") return { type, value: uuid(raw) };
  if (type === "timestamp") return { type, value: timestamp(raw) };
  if (type === "integer") {
    const value = typeof raw === "string" ? Number(raw) : raw;
    if (!Number.isSafeInteger(value)) {
      throw outdoorResearchExecutorError("malformed_evidence");
    }
    return { type, value };
  }
  if (type === "number") {
    const value = typeof raw === "string" ? Number(raw) : raw;
    if (!Number.isFinite(value)) {
      throw outdoorResearchExecutorError("malformed_evidence");
    }
    return { type, value };
  }
  if (type === "boolean" && typeof raw !== "boolean") {
    throw outdoorResearchExecutorError("malformed_evidence");
  }
  if (type === "text") return { type, value: boundedString(raw, 1, 240) };
  return { type, value: raw };
}

function resolutionState(predicate, value, freshness) {
  if (freshness === "stale" || freshness === "expired") return "stale";
  if (freshness !== "current") return "unavailable";
  if (value.type === "unknown") return "unknown";
  // Mapped restrictions describe an OSM tag, not verified legal access.
  if (HIGH_STAKES.has(predicate)) return "unavailable";
  return "known";
}

function limitationsForPredicate(predicate) {
  if (predicate === "access_restriction") {
    return ["access_unverified", "mapped_presence_only"];
  }
  if (predicate === "mapped_hiking_route_membership") {
    return ["mapped_presence_only", "official_status_unverified"];
  }
  return ["mapped_presence_only"];
}

function sourceReference(row) {
  return {
    sourceId: uuid(row.source_id),
    sourceKey: boundedString(row.source_key, 1, 80),
    sourceCategory: boundedString(row.source_category, 1, 80)
  };
}

function assertOperation(operation) {
  if (!operation || typeof operation !== "object" || Array.isArray(operation) ||
      !Array.isArray(operation.acceptableSourceCategories) ||
      !Array.isArray(operation.entityCategories) ||
      !Array.isArray(operation.predicates)) {
    throw outdoorResearchExecutorError("operation_scope_violation");
  }
}

function assertRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw outdoorResearchExecutorError("malformed_evidence");
  }
}

function objectField(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : null;
}

function exactMappedEvidenceClass(value) {
  if (value !== "mapped") {
    throw outdoorResearchExecutorError("operation_scope_violation");
  }
  return value;
}

function enumField(value, allowed) {
  if (!allowed.has(value)) throw outdoorResearchExecutorError("malformed_evidence");
  return value;
}

function uuid(value) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw outdoorResearchExecutorError("malformed_evidence");
  }
  return value.toLowerCase();
}

function boundedString(value, minimum, maximum) {
  if (typeof value !== "string" || value !== value.trim() ||
      value.length < minimum || value.length > maximum ||
      /[\u0000-\u001f\u007f<>]/.test(value)) {
    throw outdoorResearchExecutorError("malformed_evidence");
  }
  return value;
}

function nullableRecordVersion(value) {
  if (value === null || value === undefined) return null;
  const number = typeof value === "string" ? Number(value) : value;
  if (!Number.isInteger(number) || number < 1 || number > 2_147_483_647) {
    throw outdoorResearchExecutorError("malformed_evidence");
  }
  return number;
}

function nullableTimestamp(value) {
  return value === null || value === undefined ? null : timestamp(value);
}

function timestamp(value) {
  return strictExecutorDateV1(value, "malformed_evidence").toISOString();
}
