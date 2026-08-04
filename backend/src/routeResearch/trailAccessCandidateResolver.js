import {
  deriveResearchTrailAccessCandidateIdV1,
  validateResearchTrailAccessResolutionV1
} from "./trailAccessCandidateContract.js";
import {
  RESEARCH_TRAIL_ACCESS_CANDIDATE_POLICY_V1
} from "./trailAccessCandidatePolicy.js";

const POLICY = RESEARCH_TRAIL_ACCESS_CANDIDATE_POLICY_V1;

export function buildResearchTrailAccessResolutionV1(input) {
  const request = validateInput(input);
  const requestedById = new Map(
    request.highlights.map((item) => [item.entityId, item])
  );
  const candidates = [];
  const inconsistentIds = new Set();
  const counts = new Map();

  for (const row of request.rows) {
    const entityId = string(row.highlight_entity_id).toLowerCase();
    const requested = requestedById.get(entityId);
    if (!requested) invalid();
    const evidenceCoordinate = {
      latitude: number(row.evidence_latitude),
      longitude: number(row.evidence_longitude)
    };
    if (
      string(row.highlight_category) !== requested.highlightCategory ||
      coordinateKey(evidenceCoordinate) !==
        coordinateKey(requested.evidenceCoordinate)
    ) {
      inconsistentIds.add(entityId);
      continue;
    }
    const currentCount = counts.get(entityId) ?? 0;
    if (currentCount >= POLICY.limits.maximumCandidatesPerHighlight) {
      invalid();
    }
    counts.set(entityId, currentCount + 1);
    const candidateBase = {
      schemaVersion: POLICY.schemaVersion,
      originalHighlightEntityId: entityId,
      highlightCategory: requested.highlightCategory,
      evidenceCoordinate,
      routingCoordinate: {
        latitude: number(row.routing_latitude),
        longitude: number(row.routing_longitude)
      },
      sourceTrailSegmentEntityId:
        string(row.trail_entity_id).toLowerCase(),
      sourceTrailCategoryEvidenceClaimIds: uuidArray(
        row.trail_category_evidence_claim_ids
      ),
      sourceSnapshot: {
        operationalRegionId: string(row.operational_region_id),
        projectionRunId: string(row.projection_run_id).toLowerCase(),
        importId: string(row.import_id).toLowerCase(),
        sourceId: string(row.source_id).toLowerCase(),
        sourcePolicyId: string(row.source_policy_id).toLowerCase(),
        sourcePolicyVersion: string(row.source_policy_version),
        adapterSchemaVersion: string(row.adapter_schema_version)
      },
      derivationPolicyVersion: POLICY.policyVersion,
      derivationAlgorithm: POLICY.derivationAlgorithm,
      poiToAccessPointDistanceMeters: number(
        row.poi_to_access_distance_meters
      ),
      sourceTrailHighwayClass: string(row.highway_class),
      sourceTrailRecord: {
        importId: string(row.import_id).toLowerCase(),
        operationalRegionId: string(row.operational_region_id),
        osmType: string(row.trail_osm_type),
        osmId: string(row.trail_osm_id),
        highwayClass: string(row.highway_class)
      },
      lifecycleState: "current",
      accessCandidateState: "candidate",
      knownLimitations: [
        "mapped_trail_only",
        "provider_connectivity_unverified",
        "provider_access_unverified",
        "public_access_unverified"
      ],
      requiredVerification: [
        "provider_routing_required",
        "provider_snap_required",
        "route_geometry_approach_required",
        "public_access_required"
      ],
      displayName: nullableString(row.display_name),
      freshness: {
        state: "current",
        sourceDataDate: dateOnly(row.source_data_at),
        retrievedDate: dateOnly(row.retrieved_at)
      }
    };
    candidates.push({
      candidateId: deriveResearchTrailAccessCandidateIdV1(candidateBase),
      ...candidateBase
    });
  }

  candidates.sort((left, right) =>
    left.originalHighlightEntityId.localeCompare(
      right.originalHighlightEntityId
    ) ||
    left.poiToAccessPointDistanceMeters -
      right.poiToAccessPointDistanceMeters ||
    left.sourceTrailSegmentEntityId.localeCompare(
      right.sourceTrailSegmentEntityId
    ) ||
    left.candidateId.localeCompare(right.candidateId)
  );
  const candidateEntityIds = new Set(
    candidates.map((item) => item.originalHighlightEntityId)
  );
  const shortfalls = request.highlights
    .filter((item) => !candidateEntityIds.has(item.entityId))
    .map((item) => ({
      entityId: item.entityId,
      highlightCategory: item.highlightCategory,
      evidenceCoordinate: item.evidenceCoordinate,
      code: inconsistentIds.has(item.entityId)
        ? "inconsistent_highlight_projection"
        : "no_eligible_mapped_trail_within_radius",
      knownLimitations: [
        "mapped_trail_only",
        "provider_connectivity_unverified",
        "provider_access_unverified"
      ]
    }));

  return validateResearchTrailAccessResolutionV1({
    schemaVersion: POLICY.schemaVersion,
    policyVersion: POLICY.policyVersion,
    operationalRegionId: request.operationalRegionId,
    projectionRunId: request.projectionRunId,
    sourceSnapshot: request.sourceSnapshot,
    requestedHighlights: request.highlights,
    candidates,
    shortfalls
  });
}

function validateInput(input) {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).some((key) => ![
      "operationalRegionId",
      "projectionRunId",
      "sourceSnapshot",
      "highlights",
      "rows"
    ].includes(key)) ||
    !Array.isArray(input.highlights) ||
    input.highlights.length > POLICY.limits.maximumRequestedHighlights ||
    !Array.isArray(input.rows) ||
    input.rows.length > POLICY.limits.maximumCandidates
  ) {
    invalid();
  }
  const highlights = input.highlights.map((item) => {
    if (
      !item ||
      typeof item !== "object" ||
      Array.isArray(item) ||
      Object.keys(item).length !== 3 ||
      !Object.hasOwn(item, "entityId") ||
      !Object.hasOwn(item, "highlightCategory") ||
      !Object.hasOwn(item, "evidenceCoordinate")
    ) {
      invalid();
    }
    return {
      entityId: string(item.entityId).toLowerCase(),
      highlightCategory: string(item.highlightCategory),
      evidenceCoordinate: {
        latitude: number(item.evidenceCoordinate?.latitude),
        longitude: number(item.evidenceCoordinate?.longitude)
      }
    };
  }).sort((left, right) => left.entityId.localeCompare(right.entityId));
  if (new Set(highlights.map((item) => item.entityId)).size !== highlights.length) {
    invalid();
  }
  return {
    operationalRegionId: string(input.operationalRegionId),
    projectionRunId: string(input.projectionRunId).toLowerCase(),
    sourceSnapshot: input.sourceSnapshot,
    highlights,
    rows: input.rows
  };
}

function uuidArray(input) {
  if (
    !Array.isArray(input) ||
    input.length < 1 ||
    input.length > POLICY.limits.maximumTrailEvidenceClaimIds
  ) {
    invalid();
  }
  const values = input.map((item) => string(item).toLowerCase()).sort();
  if (new Set(values).size !== values.length) invalid();
  return values;
}

function coordinateKey(value) {
  return `${value.latitude.toFixed(7)}:${value.longitude.toFixed(7)}`;
}

function dateOnly(input) {
  const date = input instanceof Date ? input : new Date(input);
  if (!Number.isFinite(date.getTime())) invalid();
  return date.toISOString().slice(0, 10);
}

function nullableString(input) {
  if (input === null || input === undefined) return null;
  return string(input);
}

function string(input) {
  if (typeof input !== "string" || input.length < 1) invalid();
  return input;
}

function number(input) {
  const value = typeof input === "string" ? Number(input) : input;
  if (!Number.isFinite(value)) invalid();
  return value;
}

function invalid() {
  throw new TypeError("invalid trail access resolution input");
}
