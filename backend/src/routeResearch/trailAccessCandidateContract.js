import { createHash } from "node:crypto";
import {
  RESEARCH_TRAIL_ACCESS_CANDIDATE_POLICY_V1
} from "./trailAccessCandidatePolicy.js";

const POLICY = RESEARCH_TRAIL_ACCESS_CANDIDATE_POLICY_V1;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CANDIDATE_ID_PATTERN = /^rtacv1_[0-9a-f]{32}$/;
const REGION_ID_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const VERSION_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;

export function deriveResearchTrailAccessCandidateIdV1(input) {
  const identity = {
    originalHighlightEntityId: input.originalHighlightEntityId,
    highlightCategory: input.highlightCategory,
    evidenceCoordinate: fixedCoordinate(input.evidenceCoordinate),
    routingCoordinate: fixedCoordinate(input.routingCoordinate),
    sourceTrailSegmentEntityId: input.sourceTrailSegmentEntityId,
    sourceTrailCategoryEvidenceClaimIds:
      [...input.sourceTrailCategoryEvidenceClaimIds],
    sourceSnapshot: input.sourceSnapshot,
    derivationPolicyVersion: input.derivationPolicyVersion,
    derivationAlgorithm: input.derivationAlgorithm,
    poiToAccessPointDistanceMeters:
      Number(input.poiToAccessPointDistanceMeters).toFixed(3),
    sourceTrailHighwayClass: input.sourceTrailHighwayClass,
    sourceTrailRecord: input.sourceTrailRecord,
    freshness: input.freshness
  };
  return `rtacv1_${createHash("sha256")
    .update(canonical(identity))
    .digest("hex")
    .slice(0, 32)}`;
}

export function validateResearchTrailAccessCandidateV1(input) {
  enforceBytes(input, POLICY.limits.maximumCandidateBytes);
  const value = strictObject(input, [
    "schemaVersion",
    "candidateId",
    "originalHighlightEntityId",
    "highlightCategory",
    "evidenceCoordinate",
    "routingCoordinate",
    "sourceTrailSegmentEntityId",
    "sourceTrailCategoryEvidenceClaimIds",
    "sourceSnapshot",
    "derivationPolicyVersion",
    "derivationAlgorithm",
    "poiToAccessPointDistanceMeters",
    "sourceTrailHighwayClass",
    "sourceTrailRecord",
    "lifecycleState",
    "accessCandidateState",
    "knownLimitations",
    "requiredVerification",
    "displayName",
    "freshness"
  ]);
  if (value.schemaVersion !== POLICY.schemaVersion) invalid();
  const candidate = {
    schemaVersion: POLICY.schemaVersion,
    candidateId: boundedString(value.candidateId, 39, 39),
    originalHighlightEntityId: uuid(value.originalHighlightEntityId),
    highlightCategory: enumValue(
      value.highlightCategory,
      POLICY.highlightCategories
    ),
    evidenceCoordinate: coordinate(value.evidenceCoordinate),
    routingCoordinate: coordinate(value.routingCoordinate),
    sourceTrailSegmentEntityId: uuid(value.sourceTrailSegmentEntityId),
    sourceTrailCategoryEvidenceClaimIds: uniqueUuidArray(
      value.sourceTrailCategoryEvidenceClaimIds,
      1,
      POLICY.limits.maximumTrailEvidenceClaimIds
    ),
    sourceSnapshot: validateSourceSnapshot(value.sourceSnapshot),
    derivationPolicyVersion: version(value.derivationPolicyVersion),
    derivationAlgorithm: enumValue(
      value.derivationAlgorithm,
      [POLICY.derivationAlgorithm]
    ),
    poiToAccessPointDistanceMeters: finiteNumber(
      value.poiToAccessPointDistanceMeters,
      0,
      POLICY.maximumPoiToTrailDistanceMeters
    ),
    sourceTrailHighwayClass: enumValue(
      value.sourceTrailHighwayClass,
      POLICY.eligibleHighwayClasses
    ),
    sourceTrailRecord: validateSourceTrailRecord(value.sourceTrailRecord),
    lifecycleState: enumValue(
      value.lifecycleState,
      POLICY.lifecycleStates
    ),
    accessCandidateState: enumValue(
      value.accessCandidateState,
      POLICY.accessCandidateStates
    ),
    knownLimitations: uniqueEnumArray(
      value.knownLimitations,
      POLICY.knownLimitations,
      POLICY.limits.maximumKnownLimitations
    ),
    requiredVerification: uniqueEnumArray(
      value.requiredVerification,
      POLICY.requiredVerification,
      POLICY.limits.maximumRequiredVerification
    ),
    displayName: nullableDisplayName(value.displayName),
    freshness: validateFreshness(value.freshness)
  };
  if (
    canonical(candidate.sourceTrailCategoryEvidenceClaimIds) !==
      canonical([...candidate.sourceTrailCategoryEvidenceClaimIds].sort())
  ) {
    invalid();
  }
  if (
    candidate.derivationPolicyVersion !== POLICY.policyVersion ||
    !candidate.knownLimitations.includes("mapped_trail_only") ||
    !candidate.knownLimitations.includes(
      "provider_connectivity_unverified"
    ) ||
    !candidate.knownLimitations.includes("provider_access_unverified") ||
    !candidate.knownLimitations.includes("public_access_unverified") ||
    !candidate.requiredVerification.includes("provider_routing_required") ||
    !candidate.requiredVerification.includes("provider_snap_required") ||
    !candidate.requiredVerification.includes(
      "route_geometry_approach_required"
    ) ||
    !candidate.requiredVerification.includes("public_access_required") ||
    candidate.sourceTrailRecord.importId !==
      candidate.sourceSnapshot.importId ||
    candidate.sourceTrailRecord.operationalRegionId !==
      candidate.sourceSnapshot.operationalRegionId ||
    candidate.sourceTrailRecord.highwayClass !==
      candidate.sourceTrailHighwayClass
  ) {
    invalid();
  }
  const expectedDistance = haversineDistance(
    candidate.evidenceCoordinate,
    candidate.routingCoordinate
  );
  if (
    Math.abs(
      expectedDistance - candidate.poiToAccessPointDistanceMeters
    ) > POLICY.limits.coordinateDistanceToleranceMeters
  ) {
    invalid();
  }
  if (
    !CANDIDATE_ID_PATTERN.test(candidate.candidateId) ||
    candidate.candidateId !== deriveResearchTrailAccessCandidateIdV1(candidate)
  ) {
    invalid();
  }
  enforceBytes(candidate, POLICY.limits.maximumCandidateBytes);
  return deepFreeze(candidate);
}

export function validateResearchTrailAccessResolutionV1(input) {
  enforceBytes(input, POLICY.limits.maximumResolutionBytes);
  const value = strictObject(input, [
    "schemaVersion",
    "policyVersion",
    "operationalRegionId",
    "projectionRunId",
    "sourceSnapshot",
    "requestedHighlights",
    "candidates",
    "shortfalls"
  ]);
  if (
    value.schemaVersion !== POLICY.schemaVersion ||
    value.policyVersion !== POLICY.policyVersion
  ) {
    invalid();
  }
  const operationalRegionId = regionId(value.operationalRegionId);
  const projectionRunId = uuid(value.projectionRunId);
  const sourceSnapshot = validateResolutionSourceSnapshot(
    value.sourceSnapshot
  );
  if (
    sourceSnapshot.operationalRegionId !== operationalRegionId ||
    sourceSnapshot.projectionRunId !== projectionRunId
  ) {
    invalid();
  }
  const requestedHighlights = boundedArray(
    value.requestedHighlights,
    0,
    POLICY.limits.maximumRequestedHighlights
  ).map(validateRequestedHighlight);
  assertUnique(requestedHighlights.map((item) => item.entityId));
  const candidates = boundedArray(
    value.candidates,
    0,
    POLICY.limits.maximumCandidates
  ).map(validateResearchTrailAccessCandidateV1);
  assertUnique(candidates.map((item) => item.candidateId));
  const shortfalls = boundedArray(
    value.shortfalls,
    0,
    POLICY.limits.maximumRequestedHighlights
  ).map(validateShortfall);
  assertUnique(shortfalls.map((item) => item.entityId));

  const requestedById = new Map(
    requestedHighlights.map((item) => [item.entityId, item])
  );
  const counts = new Map();
  for (const candidate of candidates) {
    const requested = requestedById.get(candidate.originalHighlightEntityId);
    if (
      !requested ||
      requested.highlightCategory !== candidate.highlightCategory ||
      !sameValue(requested.evidenceCoordinate, candidate.evidenceCoordinate) ||
      !sameValue(candidate.sourceSnapshot, sourceSnapshotIdentity(sourceSnapshot)) ||
      !sameValue(candidate.freshness, sourceSnapshot.freshness)
    ) {
      invalid();
    }
    counts.set(
      candidate.originalHighlightEntityId,
      (counts.get(candidate.originalHighlightEntityId) ?? 0) + 1
    );
  }
  if ([...counts.values()].some((count) =>
    count > POLICY.limits.maximumCandidatesPerHighlight
  )) {
    invalid();
  }
  const shortfallById = new Map(shortfalls.map((item) => [item.entityId, item]));
  for (const requested of requestedHighlights) {
    const candidateCount = counts.get(requested.entityId) ?? 0;
    const shortfall = shortfallById.get(requested.entityId);
    if ((candidateCount > 0) === Boolean(shortfall)) invalid();
    if (shortfall && (
      shortfall.highlightCategory !== requested.highlightCategory ||
      !sameValue(shortfall.evidenceCoordinate, requested.evidenceCoordinate)
    )) {
      invalid();
    }
  }
  if (shortfalls.some((item) => !requestedById.has(item.entityId))) invalid();

  const resolution = {
    schemaVersion: POLICY.schemaVersion,
    policyVersion: POLICY.policyVersion,
    operationalRegionId,
    projectionRunId,
    sourceSnapshot,
    requestedHighlights,
    candidates,
    shortfalls
  };
  enforceBytes(resolution, POLICY.limits.maximumResolutionBytes);
  return deepFreeze(resolution);
}

export function serializeResearchTrailAccessResolutionV1(input) {
  return canonical(validateResearchTrailAccessResolutionV1(input));
}

function validateRequestedHighlight(input) {
  const value = strictObject(input, [
    "entityId",
    "highlightCategory",
    "evidenceCoordinate"
  ]);
  return {
    entityId: uuid(value.entityId),
    highlightCategory: enumValue(
      value.highlightCategory,
      POLICY.highlightCategories
    ),
    evidenceCoordinate: coordinate(value.evidenceCoordinate)
  };
}

function validateShortfall(input) {
  const value = strictObject(input, [
    "entityId",
    "highlightCategory",
    "evidenceCoordinate",
    "code",
    "knownLimitations"
  ]);
  return {
    entityId: uuid(value.entityId),
    highlightCategory: enumValue(
      value.highlightCategory,
      POLICY.highlightCategories
    ),
    evidenceCoordinate: coordinate(value.evidenceCoordinate),
    code: enumValue(value.code, POLICY.shortfallCodes),
    knownLimitations: uniqueEnumArray(
      value.knownLimitations,
      POLICY.knownLimitations,
      POLICY.limits.maximumKnownLimitations
    )
  };
}

function validateSourceSnapshot(input) {
  const value = strictObject(input, [
    "operationalRegionId",
    "projectionRunId",
    "importId",
    "sourceId",
    "sourcePolicyId",
    "sourcePolicyVersion",
    "adapterSchemaVersion"
  ]);
  return {
    operationalRegionId: regionId(value.operationalRegionId),
    projectionRunId: uuid(value.projectionRunId),
    importId: uuid(value.importId),
    sourceId: uuid(value.sourceId),
    sourcePolicyId: uuid(value.sourcePolicyId),
    sourcePolicyVersion: version(value.sourcePolicyVersion),
    adapterSchemaVersion: version(value.adapterSchemaVersion)
  };
}

function validateSourceTrailRecord(input) {
  const value = strictObject(input, [
    "importId",
    "operationalRegionId",
    "osmType",
    "osmId",
    "highwayClass"
  ]);
  const osmId = boundedString(value.osmId, 1, 20);
  if (!/^[1-9][0-9]*$/.test(osmId)) invalid();
  return {
    importId: uuid(value.importId),
    operationalRegionId: regionId(value.operationalRegionId),
    osmType: enumValue(value.osmType, ["way"]),
    osmId,
    highwayClass: enumValue(
      value.highwayClass,
      POLICY.eligibleHighwayClasses
    )
  };
}

function validateResolutionSourceSnapshot(input) {
  const value = strictObject(input, [
    "operationalRegionId",
    "projectionRunId",
    "importId",
    "sourceId",
    "sourcePolicyId",
    "sourcePolicyVersion",
    "adapterSchemaVersion",
    "freshness"
  ]);
  return {
    ...validateSourceSnapshot({
      operationalRegionId: value.operationalRegionId,
      projectionRunId: value.projectionRunId,
      importId: value.importId,
      sourceId: value.sourceId,
      sourcePolicyId: value.sourcePolicyId,
      sourcePolicyVersion: value.sourcePolicyVersion,
      adapterSchemaVersion: value.adapterSchemaVersion
    }),
    freshness: validateFreshness(value.freshness)
  };
}

function sourceSnapshotIdentity(input) {
  const { freshness: _ignored, ...identity } = input;
  return identity;
}

function validateFreshness(input) {
  const value = strictObject(input, [
    "state",
    "sourceDataDate",
    "retrievedDate"
  ]);
  const result = {
    state: enumValue(value.state, POLICY.freshnessStates),
    sourceDataDate: isoDate(value.sourceDataDate),
    retrievedDate: isoDate(value.retrievedDate)
  };
  if (result.sourceDataDate > result.retrievedDate) invalid();
  return result;
}

function nullableDisplayName(input) {
  if (input === null) return null;
  const value = boundedString(
    input,
    1,
    POLICY.limits.maximumStringLength
  );
  if (value.trim() !== value || value.includes("<") || value.includes(">")) {
    invalid();
  }
  return value;
}

function coordinate(input) {
  const value = strictObject(input, ["latitude", "longitude"]);
  return {
    latitude: finiteNumber(value.latitude, -90, 90),
    longitude: finiteNumber(value.longitude, -180, 180)
  };
}

function fixedCoordinate(input) {
  return {
    latitude: Number(input.latitude).toFixed(7),
    longitude: Number(input.longitude).toFixed(7)
  };
}

function haversineDistance(start, finish) {
  const earthRadiusMeters = 6_371_000;
  const radians = Math.PI / 180;
  const latitudeDelta = (finish.latitude - start.latitude) * radians;
  const longitudeDelta = (finish.longitude - start.longitude) * radians;
  const startLatitude = start.latitude * radians;
  const finishLatitude = finish.latitude * radians;
  const value =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(startLatitude) * Math.cos(finishLatitude) *
      Math.sin(longitudeDelta / 2) ** 2;
  return earthRadiusMeters * 2 *
    Math.atan2(Math.sqrt(value), Math.sqrt(Math.max(0, 1 - value)));
}

function strictObject(input, fields) {
  if (!input || typeof input !== "object" || Array.isArray(input)) invalid();
  const keys = Object.keys(input);
  if (
    keys.length !== fields.length ||
    keys.some((key) => !fields.includes(key)) ||
    fields.some((field) => !Object.hasOwn(input, field))
  ) {
    invalid();
  }
  return input;
}

function boundedArray(input, minimum, maximum) {
  if (
    !Array.isArray(input) ||
    input.length < minimum ||
    input.length > maximum
  ) {
    invalid();
  }
  return input;
}

function uniqueUuidArray(input, minimum, maximum) {
  const values = boundedArray(input, minimum, maximum).map(uuid);
  assertUnique(values);
  return values;
}

function uniqueEnumArray(input, allowed, maximum) {
  const values = boundedArray(input, 0, maximum).map((item) =>
    enumValue(item, allowed)
  );
  assertUnique(values);
  return values;
}

function uuid(input) {
  const value = boundedString(input, 36, 36).toLowerCase();
  if (!UUID_PATTERN.test(value)) invalid();
  return value;
}

function regionId(input) {
  const value = boundedString(
    input,
    1,
    POLICY.limits.maximumOperationalRegionIdLength
  );
  if (!REGION_ID_PATTERN.test(value)) invalid();
  return value;
}

function version(input) {
  const value = boundedString(input, 1, 80);
  if (!VERSION_PATTERN.test(value)) invalid();
  return value;
}

function isoDate(input) {
  const value = boundedString(input, 10, 10);
  if (!ISO_DATE_PATTERN.test(value)) invalid();
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    invalid();
  }
  return value;
}

function boundedString(input, minimum, maximum) {
  if (
    typeof input !== "string" ||
    input.length < minimum ||
    input.length > maximum ||
    CONTROL_CHARACTER_PATTERN.test(input)
  ) {
    invalid();
  }
  return input;
}

function enumValue(input, allowed) {
  if (!allowed.includes(input)) invalid();
  return input;
}

function finiteNumber(input, minimum, maximum) {
  if (
    typeof input !== "number" ||
    !Number.isFinite(input) ||
    input < minimum ||
    input > maximum
  ) {
    invalid();
  }
  return input;
}

function assertUnique(values) {
  if (new Set(values).size !== values.length) invalid();
}

function enforceBytes(value, maximum) {
  let serialized;
  try {
    serialized = JSON.stringify(value);
  } catch {
    invalid();
  }
  if (
    typeof serialized !== "string" ||
    Buffer.byteLength(serialized, "utf8") > maximum
  ) {
    invalid();
  }
}

function canonical(value) {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, sortKeys(value[key])])
  );
}

function sameValue(left, right) {
  return canonical(left) === canonical(right);
}

function invalid() {
  throw new TypeError("invalid trail access candidate");
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}
