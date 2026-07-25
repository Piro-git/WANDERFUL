import { createHash } from "node:crypto";
import { validateAdventureResearchIntentV1 } from "../outdoorResearch/validation.js";
import {
  canonicalizeResearchGuidedRouteIntentV1,
  deriveResearchGuidedRouteProposalIdV1
} from "./contractSemantics.js";
import { RESEARCH_GUIDED_ROUTE_CANDIDATE_POLICY_V1 } from "./policy.js";
import {
  ResearchGuidedRoutingAdapterError
} from "./routedAlternativesErrors.js";
import {
  RESEARCH_GUIDED_ROUTED_ALTERNATIVES_POLICY_V1
} from "./routedAlternativesPolicy.js";

const POLICY = RESEARCH_GUIDED_ROUTED_ALTERNATIVES_POLICY_V1;
const CANDIDATE_POLICY = RESEARCH_GUIDED_ROUTE_CANDIDATE_POLICY_V1;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROPOSAL_ID_PATTERN = /^rrcpv1_[0-9a-f]{32}$/;
const ATTEMPT_ID_PATTERN = /^rrrav1_[0-9a-f]{32}$/;
const LINEAGE_ID_PATTERN = /^rrlpv1_[0-9a-f]{32}$/;
const RESULT_ID_PATTERN = /^rrrav1_[0-9a-f]{32}_path_[1-3]$/;
const CONTROL_CHARACTER_PATTERN =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const PATH_DETAIL_FIELDS = ["surface", "road_class", "hike_rating"];
const PATH_FIELDS = [
  "distance",
  "time",
  "ascend",
  "descend",
  "points",
  "instructions",
  "details"
];

export function deriveResearchGuidedRouteAttemptIdV1(proposalId) {
  const identity = canonical({
    candidatePlanPolicyVersion: POLICY.sourceCandidatePlanPolicyVersion,
    proposalId,
    routingAdapterPolicyVersion: POLICY.policyVersion
  });
  return `rrrav1_${createHash("sha256")
    .update(identity)
    .digest("hex")
    .slice(0, 32)}`;
}

export function deriveResearchGuidedRouteResultIdV1(attemptId, pathIndex) {
  if (!ATTEMPT_ID_PATTERN.test(attemptId)) invalid();
  integer(pathIndex, 0, POLICY.limits.maximumPathsPerAttempt - 1);
  return `${attemptId}_path_${pathIndex + 1}`;
}

export function deriveResearchGuidedRouteLineageIdV1(provenance) {
  const selected = provenance.selectedWaypoints.map((item) => [
    item.entityId,
    item.coordinate.latitude.toFixed(7),
    item.coordinate.longitude.toFixed(7),
    item.highlightCategory,
    item.role,
    item.evidenceClaimIds.join(","),
    item.selectionReasons.join(","),
    item.requiredVerification.join(","),
    item.knownLimitations.join(",")
  ].join("|")).join(";");
  const mapped = provenance.mappedNetworkCandidates.map((item) => [
    item.entityId,
    item.sourceBasis,
    item.evidenceClaimIds.join(","),
    item.requiredVerification.join(","),
    item.knownLimitations.join(",")
  ].join("|")).join(";");
  const identity = [
    POLICY.policyVersion,
    provenance.sourceCandidatePlanPolicyVersion,
    provenance.proposalId,
    provenance.strategy,
    provenance.activity,
    provenance.routeType,
    selected,
    mapped,
    provenance.evidenceClaimIds.join(","),
    provenance.requiredVerification.join(","),
    provenance.knownLimitations.join(",")
  ].join("\n");
  return `rrlpv1_${createHash("sha256")
    .update(identity)
    .digest("hex")
    .slice(0, 32)}`;
}

export function validateResearchGuidedRoutedAlternativesV1(input) {
  try {
    enforceSerializedSize(input);
    const value = strictObject(input, [
      "schemaVersion",
      "state",
      "normalizedIntent",
      "candidatePlanPolicyVersion",
      "routingAdapterPolicyVersion",
      "attempts",
      "remainingLimitations"
    ]);
    if (value.schemaVersion !== POLICY.schemaVersion) invalid();
    if (
      value.candidatePlanPolicyVersion !==
        POLICY.sourceCandidatePlanPolicyVersion ||
      value.routingAdapterPolicyVersion !== POLICY.policyVersion
    ) {
      invalid();
    }

    const validatedIntent = validateNormalizedIntent(value.normalizedIntent);
    const attempts = boundedArray(
      value.attempts,
      0,
      POLICY.limits.maximumProposals
    ).map((attempt, index) =>
      validateAttempt(attempt, index, validatedIntent)
    );
    assertUnique(attempts.map((attempt) => attempt.attemptId));
    assertUnique(attempts.map((attempt) => attempt.provenance.proposalId));

    const state = enumValue(value.state, POLICY.states);
    const expectedState = deriveEnvelopeState(attempts, state);
    if (state !== expectedState) invalid();

    const remainingLimitations = uniqueEnumArray(
      value.remainingLimitations,
      [
        ...CANDIDATE_POLICY.limitationCodes,
        ...POLICY.adapterLimitationCodes
      ],
      CANDIDATE_POLICY.limits.maximumKnownLimitations +
        POLICY.adapterLimitationCodes.length
    );
    const expectedLimitations = deriveRemainingLimitations(attempts, state);
    if (!sameValue(remainingLimitations, expectedLimitations)) invalid();

    const envelope = {
      schemaVersion: POLICY.schemaVersion,
      state,
      normalizedIntent: validatedIntent,
      candidatePlanPolicyVersion: POLICY.sourceCandidatePlanPolicyVersion,
      routingAdapterPolicyVersion: POLICY.policyVersion,
      attempts,
      remainingLimitations
    };
    enforceSerializedSize(envelope);
    return deepFreeze(envelope);
  } catch (error) {
    if (
      error instanceof ResearchGuidedRoutingAdapterError &&
      error.code === "output_too_large"
    ) {
      throw error;
    }
    throw new ResearchGuidedRoutingAdapterError("invalid_envelope");
  }
}

export function serializeResearchGuidedRoutedAlternativesV1(input) {
  const validated = validateResearchGuidedRoutedAlternativesV1(input);
  const serialized = canonical(validated);
  if (
    Buffer.byteLength(serialized, "utf8") >
    POLICY.limits.maximumEnvelopeBytes
  ) {
    throw new ResearchGuidedRoutingAdapterError("output_too_large");
  }
  return serialized;
}

export function validateResearchGuidedRoutePathV1(input) {
  return validatePath(input);
}

function validateNormalizedIntent(input) {
  let validated;
  try {
    validated = validateAdventureResearchIntentV1(input);
  } catch {
    invalid();
  }
  const canonicalized =
    canonicalizeResearchGuidedRouteIntentV1(validated);
  if (!sameValue(validated, canonicalized)) invalid();
  return canonicalized;
}

function validateAttempt(input, expectedIndex, normalizedIntent) {
  const value = strictObject(input, [
    "attemptId",
    "proposalIndex",
    "state",
    "provenance",
    "routeResults",
    "failureCode"
  ]);
  const proposalIndex = integer(
    value.proposalIndex,
    0,
    POLICY.limits.maximumProposals - 1
  );
  if (proposalIndex !== expectedIndex) invalid();
  const provenance = validateProvenance(
    value.provenance,
    normalizedIntent
  );
  const expectedAttemptId =
    deriveResearchGuidedRouteAttemptIdV1(provenance.proposalId);
  const attemptId = boundedString(value.attemptId, 39, 39);
  if (
    !ATTEMPT_ID_PATTERN.test(attemptId) ||
    attemptId !== expectedAttemptId
  ) {
    invalid();
  }
  const state = enumValue(value.state, POLICY.attemptStates);
  const routeResults = boundedArray(
    value.routeResults,
    0,
    POLICY.limits.maximumPathsPerAttempt
  ).map((result, pathIndex) =>
    validateRouteResult(
      result,
      pathIndex,
      attemptId,
      normalizedIntent,
      provenance
    )
  );
  assertUnique(routeResults.map((result) => result.routeResultId));
  const failureCode = value.failureCode === null
    ? null
    : enumValue(value.failureCode, POLICY.failureCodes);
  if (
    (state === "routed") !==
      (routeResults.length > 0 && failureCode === null)
  ) {
    invalid();
  }
  if (
    state !== "routed" &&
    (routeResults.length !== 0 || failureCode === null)
  ) {
    invalid();
  }
  if (
    state === "unsupported" &&
    ![
      "unsupported_point_to_point",
      "unsupported_out_and_back",
      "unsupported_candidate_plan"
    ].includes(failureCode)
  ) {
    invalid();
  }
  return {
    attemptId,
    proposalIndex,
    state,
    provenance,
    routeResults,
    failureCode
  };
}

function validateProvenance(input, normalizedIntent) {
  const value = strictObject(input, [
    "proposalId",
    "lineageId",
    "strategy",
    "activity",
    "routeType",
    "selectedWaypoints",
    "mappedNetworkCandidates",
    "evidenceClaimIds",
    "requiredVerification",
    "knownLimitations",
    "sourceCandidatePlanPolicyVersion"
  ]);
  const selectedWaypoints = boundedArray(
    value.selectedWaypoints,
    1,
    POLICY.limits.maximumSelectedWaypoints
  ).map(validateSelectedWaypoint);
  const mappedNetworkCandidates = boundedArray(
    value.mappedNetworkCandidates,
    0,
    POLICY.limits.maximumMappedNetworkCandidates
  ).map(validateMappedNetworkCandidate);
  assertUnique(selectedWaypoints.map((item) => item.entityId));
  assertUnique(mappedNetworkCandidates.map((item) => item.entityId));

  const evidenceClaimIds = uniqueUuidArray(
    value.evidenceClaimIds,
    1,
    POLICY.limits.maximumEvidenceClaimIds
  );
  const expectedEvidence = uniqueSorted([
    ...selectedWaypoints.flatMap((item) => item.evidenceClaimIds),
    ...mappedNetworkCandidates.flatMap((item) => item.evidenceClaimIds)
  ]);
  if (!sameValue(evidenceClaimIds, expectedEvidence)) invalid();

  const proposalId = boundedString(value.proposalId, 39, 39);
  if (!PROPOSAL_ID_PATTERN.test(proposalId)) invalid();
  const strategy = enumValue(value.strategy, CANDIDATE_POLICY.strategies);
  const activity = enumValue(
    value.activity,
    CANDIDATE_POLICY.supportedActivities
  );
  const routeType = enumValue(
    value.routeType,
    CANDIDATE_POLICY.supportedRouteTypes
  );
  if (
    activity !== normalizedIntent.activity ||
    routeType !== normalizedIntent.routeType ||
    value.sourceCandidatePlanPolicyVersion !==
      POLICY.sourceCandidatePlanPolicyVersion
  ) {
    invalid();
  }
  const expectedProposalId = deriveResearchGuidedRouteProposalIdV1({
    normalizedIntent,
    viaEntityIds: selectedWaypoints.map((item) => item.entityId),
    mappedNetworkEntityIds:
      mappedNetworkCandidates.map((item) => item.entityId),
    strategy
  });
  if (proposalId !== expectedProposalId) invalid();

  const provenance = {
    proposalId,
    lineageId: boundedString(value.lineageId, 39, 39),
    strategy,
    activity,
    routeType,
    selectedWaypoints,
    mappedNetworkCandidates,
    evidenceClaimIds,
    requiredVerification: uniqueEnumArray(
      value.requiredVerification,
      CANDIDATE_POLICY.verificationCodes,
      POLICY.limits.maximumVerificationCodes
    ),
    knownLimitations: uniqueEnumArray(
      value.knownLimitations,
      CANDIDATE_POLICY.limitationCodes,
      POLICY.limits.maximumKnownLimitations
    ),
    sourceCandidatePlanPolicyVersion:
      POLICY.sourceCandidatePlanPolicyVersion
  };
  if (
    !LINEAGE_ID_PATTERN.test(provenance.lineageId) ||
    provenance.lineageId !==
      deriveResearchGuidedRouteLineageIdV1(provenance)
  ) {
    invalid();
  }
  return provenance;
}

function validateSelectedWaypoint(input) {
  const value = strictObject(input, [
    "entityId",
    "coordinate",
    "highlightCategory",
    "role",
    "evidenceClaimIds",
    "selectionReasons",
    "requiredVerification",
    "knownLimitations"
  ]);
  return {
    entityId: uuid(value.entityId),
    coordinate: coordinate(value.coordinate),
    highlightCategory: enumValue(value.highlightCategory, [
      "viewpoint",
      "waterfall",
      "peak",
      "lake",
      "alpine_hut",
      "wilderness_hut",
      "landmark"
    ]),
    role: enumValue(value.role, CANDIDATE_POLICY.candidateRoles),
    evidenceClaimIds: uniqueUuidArray(
      value.evidenceClaimIds,
      1,
      CANDIDATE_POLICY.limits.maximumEvidenceReferencesPerCandidate
    ),
    selectionReasons: uniqueEnumArray(
      value.selectionReasons,
      CANDIDATE_POLICY.selectionReasons,
      CANDIDATE_POLICY.limits.maximumSelectionReasonsPerCandidate
    ),
    requiredVerification: uniqueEnumArray(
      value.requiredVerification,
      CANDIDATE_POLICY.verificationCodes,
      POLICY.limits.maximumVerificationCodes
    ),
    knownLimitations: uniqueEnumArray(
      value.knownLimitations,
      CANDIDATE_POLICY.limitationCodes,
      POLICY.limits.maximumKnownLimitations
    )
  };
}

function validateMappedNetworkCandidate(input) {
  const value = strictObject(input, [
    "entityId",
    "sourceBasis",
    "evidenceClaimIds",
    "requiredVerification",
    "knownLimitations"
  ]);
  return {
    entityId: uuid(value.entityId),
    sourceBasis: enumValue(value.sourceBasis, ["mapped", "official", "mixed"]),
    evidenceClaimIds: uniqueUuidArray(
      value.evidenceClaimIds,
      1,
      CANDIDATE_POLICY.limits.maximumEvidenceReferencesPerCandidate
    ),
    requiredVerification: uniqueEnumArray(
      value.requiredVerification,
      CANDIDATE_POLICY.verificationCodes,
      POLICY.limits.maximumVerificationCodes
    ),
    knownLimitations: uniqueEnumArray(
      value.knownLimitations,
      CANDIDATE_POLICY.limitationCodes,
      POLICY.limits.maximumKnownLimitations
    )
  };
}

function validateRouteResult(
  input,
  expectedPathIndex,
  attemptId,
  normalizedIntent,
  provenance
) {
  const value = strictObject(input, [
    "routeResultId",
    "pathIndex",
    "geometryProvider",
    "routingStrategy",
    "path",
    "waypointVisits"
  ]);
  const pathIndex = integer(
    value.pathIndex,
    0,
    POLICY.limits.maximumPathsPerAttempt - 1
  );
  if (pathIndex !== expectedPathIndex) invalid();
  const routeResultId = boundedString(
    value.routeResultId,
    46,
    46
  );
  if (
    !RESULT_ID_PATTERN.test(routeResultId) ||
    routeResultId !==
      deriveResearchGuidedRouteResultIdV1(attemptId, pathIndex)
  ) {
    invalid();
  }
  if (
    value.geometryProvider !== "graphhopper" ||
    value.routingStrategy !== "backend"
  ) {
    invalid();
  }
  const path = validatePath(value.path);
  const waypointVisits = boundedArray(
    value.waypointVisits,
    provenance.selectedWaypoints.length + 2,
    provenance.selectedWaypoints.length + 2
  ).map((visit, index) =>
    validateWaypointVisit(
      visit,
      index,
      normalizedIntent,
      provenance.selectedWaypoints
    )
  );
  return {
    routeResultId,
    pathIndex,
    geometryProvider: "graphhopper",
    routingStrategy: "backend",
    path,
    waypointVisits
  };
}

function validateWaypointVisit(
  input,
  expectedIndex,
  normalizedIntent,
  selectedWaypoints
) {
  const value = strictObject(input, [
    "waypointIndex",
    "role",
    "entityId",
    "requestedCoordinate",
    "snappedCoordinate",
    "snapDistanceMeters",
    "withinVisitTolerance"
  ]);
  const waypointIndex = integer(
    value.waypointIndex,
    0,
    selectedWaypoints.length + 1
  );
  if (waypointIndex !== expectedIndex) invalid();
  const expectedRole = expectedIndex === 0
    ? "anchor"
    : expectedIndex === selectedWaypoints.length + 1
      ? "return_anchor"
      : "via";
  if (value.role !== expectedRole) invalid();
  const expectedWaypoint = expectedRole === "via"
    ? selectedWaypoints[expectedIndex - 1]
    : null;
  const entityId = value.entityId === null ? null : uuid(value.entityId);
  if (entityId !== (expectedWaypoint?.entityId ?? null)) invalid();
  const requestedCoordinate = coordinate(value.requestedCoordinate);
  const expectedCoordinate = expectedWaypoint?.coordinate ??
    normalizedIntent.geographicAnchor.coordinate;
  if (!sameValue(requestedCoordinate, expectedCoordinate)) invalid();

  const snappedCoordinate = value.snappedCoordinate === null
    ? null
    : coordinateWithOptionalElevation(value.snappedCoordinate);
  const snapDistanceMeters = value.snapDistanceMeters === null
    ? null
    : finiteNumber(
      value.snapDistanceMeters,
      0,
      POLICY.limits.maximumRouteDistanceMeters
    );
  if ((snappedCoordinate === null) !== (snapDistanceMeters === null)) {
    invalid();
  }
  const withinVisitTolerance = boolean(value.withinVisitTolerance);
  if (snappedCoordinate === null) {
    if (withinVisitTolerance) invalid();
  } else {
    const expectedDistance = haversineDistance(
      requestedCoordinate,
      snappedCoordinate
    );
    if (Math.abs(expectedDistance - snapDistanceMeters) > 0.01) invalid();
    if (
      withinVisitTolerance !==
      (snapDistanceMeters <=
        POLICY.limits.waypointVisitToleranceMeters)
    ) {
      invalid();
    }
  }
  return {
    waypointIndex,
    role: expectedRole,
    entityId,
    requestedCoordinate,
    snappedCoordinate,
    snapDistanceMeters,
    withinVisitTolerance
  };
}

function validatePath(input) {
  const value = strictObject(input, PATH_FIELDS, false);
  requireFields(value, ["distance", "time", "points", "instructions"]);
  const points = validateLineString(value.points);
  const maximumCoordinateIndex = points.coordinates.length - 1;
  const instructions = boundedArray(
    value.instructions,
    0,
    POLICY.limits.maximumInstructionsPerPath
  ).map((instruction) =>
    validateInstruction(instruction, maximumCoordinateIndex)
  );
  const details = value.details === undefined
    ? undefined
    : validatePathDetails(value.details, maximumCoordinateIndex);
  const result = {
    distance: finiteNumber(
      value.distance,
      10,
      POLICY.limits.maximumRouteDistanceMeters
    ),
    time: integer(
      value.time,
      1,
      POLICY.limits.maximumRouteDurationMilliseconds
    ),
    points,
    instructions
  };
  if (value.ascend !== undefined) {
    result.ascend = finiteNumber(
      value.ascend,
      0,
      POLICY.limits.maximumAbsoluteElevationMeters
    );
  }
  if (value.descend !== undefined) {
    result.descend = finiteNumber(
      value.descend,
      0,
      POLICY.limits.maximumAbsoluteElevationMeters
    );
  }
  if (details !== undefined) result.details = details;
  return result;
}

function validateLineString(input) {
  const value = strictObject(input, ["type", "coordinates"]);
  if (value.type !== "LineString") invalid();
  const coordinates = boundedArray(
    value.coordinates,
    2,
    POLICY.limits.maximumCoordinatesPerPath
  ).map((item) => {
    if (!Array.isArray(item) || (item.length !== 2 && item.length !== 3)) {
      invalid();
    }
    const result = [
      finiteNumber(item[0], -180, 180),
      finiteNumber(item[1], -90, 90)
    ];
    if (item.length === 3) {
      result.push(finiteNumber(
        item[2],
        -POLICY.limits.maximumAbsoluteElevationMeters,
        POLICY.limits.maximumAbsoluteElevationMeters
      ));
    }
    return result;
  });
  if (
    !coordinates.slice(1).some((item) =>
      item[0] !== coordinates[0][0] ||
      item[1] !== coordinates[0][1]
    )
  ) {
    invalid();
  }
  return { type: "LineString", coordinates };
}

function validateInstruction(input, maximumCoordinateIndex) {
  const value = strictObject(input, [
    "text",
    "street_name",
    "distance",
    "time",
    "interval",
    "sign"
  ], false);
  requireFields(value, ["text", "distance", "time", "interval", "sign"]);
  if (
    !Array.isArray(value.interval) ||
    value.interval.length !== 2
  ) {
    invalid();
  }
  const interval = value.interval.map((item) =>
    integer(item, 0, maximumCoordinateIndex)
  );
  if (interval[0] > interval[1]) invalid();
  const result = {
    text: boundedString(
      value.text,
      0,
      POLICY.limits.maximumStringLength
    ),
    distance: finiteNumber(
      value.distance,
      0,
      POLICY.limits.maximumRouteDistanceMeters
    ),
    time: integer(
      value.time,
      0,
      POLICY.limits.maximumRouteDurationMilliseconds
    ),
    interval,
    sign: integer(value.sign, -100, 100)
  };
  if (value.street_name !== undefined) {
    result.street_name = boundedString(
      value.street_name,
      0,
      POLICY.limits.maximumStringLength
    );
  }
  return result;
}

function validatePathDetails(input, maximumCoordinateIndex) {
  const value = strictObject(input, PATH_DETAIL_FIELDS, false);
  const result = {};
  let totalCount = 0;
  for (const field of PATH_DETAIL_FIELDS) {
    if (value[field] === undefined) continue;
    const entries = boundedArray(
      value[field],
      0,
      POLICY.limits.maximumPathDetailsPerPath
    ).map((entry) =>
      validatePathDetail(entry, maximumCoordinateIndex)
    );
    totalCount += entries.length;
    result[field] = entries;
  }
  if (totalCount > POLICY.limits.maximumPathDetailsPerPath) invalid();
  return result;
}

function validatePathDetail(input, maximumCoordinateIndex) {
  if (!Array.isArray(input) || input.length !== 3) invalid();
  const from = integer(input[0], 0, maximumCoordinateIndex);
  const to = integer(input[1], 0, maximumCoordinateIndex);
  if (from > to) invalid();
  const value = input[2];
  if (
    !(
      typeof value === "boolean" ||
      (typeof value === "number" && Number.isFinite(value)) ||
      (
        typeof value === "string" &&
        value.length <= CANDIDATE_POLICY.limits.maximumStringLength &&
        !CONTROL_CHARACTER_PATTERN.test(value)
      )
    )
  ) {
    invalid();
  }
  return [from, to, value];
}

function deriveEnvelopeState(attempts, declaredState) {
  if (attempts.length === 0) {
    if (
      declaredState !== "unsupported" &&
      declaredState !== "no_viable_route"
    ) {
      invalid();
    }
    return declaredState;
  }
  const routedCount = attempts.filter(
    (attempt) => attempt.state === "routed"
  ).length;
  if (routedCount === attempts.length) return "routed";
  if (routedCount > 0) return "partial";
  if (attempts.every((attempt) => attempt.state === "unsupported")) {
    return "unsupported";
  }
  return "no_viable_route";
}

function deriveRemainingLimitations(attempts, state) {
  const candidateLimitations = attempts.flatMap(
    (attempt) => attempt.provenance.knownLimitations
  );
  const adapterLimitations = [];
  if (attempts.length === 0) {
    adapterLimitations.push("candidate_plan_not_routable");
  }
  if (attempts.some((attempt) => attempt.state === "failed")) {
    adapterLimitations.push("provider_failure");
  }
  if (attempts.some((attempt) => attempt.state === "unsupported")) {
    adapterLimitations.push("route_type_unsupported");
  }
  const visits = attempts.flatMap((attempt) =>
    attempt.routeResults.flatMap((result) => result.waypointVisits)
  );
  if (
    visits.some((visit) =>
      visit.role === "via" && visit.snappedCoordinate === null
    )
  ) {
    adapterLimitations.push("snapping_unavailable");
  }
  if (
    visits.some((visit) =>
      visit.role === "via" &&
      visit.snappedCoordinate !== null &&
      !visit.withinVisitTolerance
    )
  ) {
    adapterLimitations.push("snapping_exceeds_tolerance");
  }
  if (state === "unsupported" && attempts.length === 0) {
    adapterLimitations.push("candidate_plan_unsupported");
  }
  return orderedUnique(
    [...candidateLimitations, ...adapterLimitations],
    [
      ...CANDIDATE_POLICY.limitationCodes,
      ...POLICY.adapterLimitationCodes
    ]
  );
}

function coordinate(input) {
  const value = strictObject(input, ["latitude", "longitude"]);
  return {
    latitude: finiteNumber(value.latitude, -90, 90),
    longitude: finiteNumber(value.longitude, -180, 180)
  };
}

function coordinateWithOptionalElevation(input) {
  const value = strictObject(
    input,
    ["latitude", "longitude", "elevationMeters"],
    false
  );
  requireFields(value, ["latitude", "longitude"]);
  const result = coordinate({
    latitude: value.latitude,
    longitude: value.longitude
  });
  if (value.elevationMeters !== undefined) {
    result.elevationMeters = finiteNumber(
      value.elevationMeters,
      -POLICY.limits.maximumAbsoluteElevationMeters,
      POLICY.limits.maximumAbsoluteElevationMeters
    );
  }
  return result;
}

function haversineDistance(start, finish) {
  const earthRadiusMeters = 6_371_000;
  const radians = Math.PI / 180;
  const latitudeDelta =
    (finish.latitude - start.latitude) * radians;
  const longitudeDelta =
    (finish.longitude - start.longitude) * radians;
  const startLatitude = start.latitude * radians;
  const finishLatitude = finish.latitude * radians;
  const value =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(startLatitude) *
      Math.cos(finishLatitude) *
      Math.sin(longitudeDelta / 2) ** 2;
  return earthRadiusMeters * 2 *
    Math.atan2(Math.sqrt(value), Math.sqrt(Math.max(0, 1 - value)));
}

function strictObject(input, fields, exact = true) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    invalid();
  }
  const allowed = new Set(fields);
  if (Object.keys(input).some((key) => !allowed.has(key))) invalid();
  if (exact) requireFields(input, fields);
  return input;
}

function requireFields(input, fields) {
  if (fields.some((field) => !Object.hasOwn(input, field))) invalid();
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

function uniqueEnumArray(input, allowed, maximum) {
  const result = boundedArray(input, 0, maximum).map((item) =>
    enumValue(item, allowed)
  );
  assertUnique(result);
  return result;
}

function uniqueUuidArray(input, minimum, maximum) {
  const result = boundedArray(input, minimum, maximum).map(uuid);
  assertUnique(result);
  return result;
}

function enumValue(value, allowed) {
  if (!new Set(allowed).has(value)) invalid();
  return value;
}

function boundedString(value, minimum, maximum) {
  if (
    typeof value !== "string" ||
    value !== value.trim() ||
    value.length < minimum ||
    value.length > maximum ||
    CONTROL_CHARACTER_PATTERN.test(value) ||
    value.includes("<") ||
    value.includes(">")
  ) {
    invalid();
  }
  return value;
}

function uuid(value) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) invalid();
  return value.toLowerCase();
}

function finiteNumber(value, minimum, maximum) {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    invalid();
  }
  return value;
}

function integer(value, minimum, maximum) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    invalid();
  }
  return value;
}

function boolean(value) {
  if (typeof value !== "boolean") invalid();
  return value;
}

function assertUnique(values) {
  if (new Set(values).size !== values.length) invalid();
}

function uniqueSorted(values) {
  return [...new Set(values)].sort(compareText);
}

function orderedUnique(values, vocabulary) {
  return [...new Set(values)].sort(
    (left, right) =>
      vocabulary.indexOf(left) - vocabulary.indexOf(right) ||
      compareText(left, right)
  );
}

function sameValue(left, right) {
  return canonical(left) === canonical(right);
}

function canonical(value) {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort(compareText)
      .map((key) => [key, sortKeys(value[key])])
  );
}

function compareText(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function enforceSerializedSize(input) {
  let serialized;
  try {
    serialized = JSON.stringify(input);
  } catch {
    invalid();
  }
  if (
    serialized === undefined ||
    Buffer.byteLength(serialized, "utf8") >
      POLICY.limits.maximumEnvelopeBytes
  ) {
    throw new ResearchGuidedRoutingAdapterError("output_too_large");
  }
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function invalid() {
  throw new ResearchGuidedRoutingAdapterError("invalid_envelope");
}
