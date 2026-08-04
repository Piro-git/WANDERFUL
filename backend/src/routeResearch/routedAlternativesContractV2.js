import { createHash } from "node:crypto";
import { validateAdventureResearchIntentV1 } from "../outdoorResearch/validation.js";
import { validateResearchGuidedRoutePathV1 } from "./routedAlternativesContract.js";
import { validateResearchTrailAccessCandidateV1 } from "./trailAccessCandidateContract.js";
import { RESEARCH_TRAIL_ACCESS_CANDIDATE_POLICY_V1 } from "./trailAccessCandidatePolicy.js";
import { RESEARCH_GUIDED_ROUTE_CANDIDATE_POLICY_V1 } from "./policy.js";
import { RESEARCH_GUIDED_ROUTE_CANDIDATE_POLICY_V2 } from "./researchGuidedRouteCandidatePolicyV2.js";
import { RESEARCH_GUIDED_ROUTED_ALTERNATIVES_POLICY_V2 } from "./routedAlternativesPolicyV2.js";

const POLICY = RESEARCH_GUIDED_ROUTED_ALTERNATIVES_POLICY_V2;
const CANDIDATE_POLICY = RESEARCH_GUIDED_ROUTE_CANDIDATE_POLICY_V2;
const ATTEMPT_ID = /^rrrav2_[0-9a-f]{32}$/;
const LINEAGE_ID = /^rrlpv2_[0-9a-f]{32}$/;
const RESULT_ID = /^rrrv2_[0-9a-f]{32}$/;
const PROPOSAL_ID = /^rrcpv2_[0-9a-f]{32}$/;
const SOURCE_PROPOSAL_ID = /^rrcpv1_[0-9a-f]{32}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const V1_POLICY = RESEARCH_GUIDED_ROUTE_CANDIDATE_POLICY_V1;
const ACCESS_POLICY = RESEARCH_TRAIL_ACCESS_CANDIDATE_POLICY_V1;
const VERIFICATION_CODES = [...new Set([
  ...V1_POLICY.verificationCodes,
  ...ACCESS_POLICY.requiredVerification
])];
const LIMITATION_CODES = [...new Set([
  ...V1_POLICY.limitationCodes,
  ...ACCESS_POLICY.knownLimitations,
  ...CANDIDATE_POLICY.knownLimitations
])];

export function deriveResearchGuidedRouteLineageIdV2(provenance) {
  const { lineageId: _ignored, ...unsigned } = provenance;
  return `rrlpv2_${digest({
    policyVersion: POLICY.policyVersion,
    provenance: identityValue(unsigned)
  })}`;
}

export function deriveResearchGuidedRouteAttemptIdV2(proposalId, lineageId) {
  if (!PROPOSAL_ID.test(proposalId) || !LINEAGE_ID.test(lineageId)) invalid();
  return `rrrav2_${digest({
    policyVersion: POLICY.policyVersion,
    proposalId,
    lineageId
  })}`;
}

export function deriveResearchGuidedRouteResultIdV2(
  attemptId,
  pathIndex,
  routeResult
) {
  if (!ATTEMPT_ID.test(attemptId)) invalid();
  integer(pathIndex, 0, POLICY.limits.maximumPathsPerAttempt - 1);
  if (!routeResult || typeof routeResult !== "object" ||
      Array.isArray(routeResult)) invalid();
  const { routeResultId: _ignored, ...unsigned } = routeResult;
  return `rrrv2_${digest({
    policyVersion: POLICY.policyVersion,
    attemptId,
    pathIndex,
    routeResult: identityValue(unsigned)
  })}`;
}

export function validateResearchGuidedRoutedAlternativesV2(input) {
  try {
    enforceBytes(input);
    const value = strict(input, [
      "schemaVersion", "state", "normalizedIntent",
      "candidatePlanPolicyVersion", "routingAdapterPolicyVersion",
      "attempts", "remainingLimitations"
    ]);
    if (
      value.schemaVersion !== POLICY.schemaVersion ||
      value.candidatePlanPolicyVersion !==
        POLICY.sourceCandidatePlanPolicyVersion ||
      value.routingAdapterPolicyVersion !== POLICY.policyVersion
    ) invalid();
    const normalizedIntent = validateAdventureResearchIntentV1(
      value.normalizedIntent
    );
    const attempts = array(value.attempts, 0, POLICY.limits.maximumProposals)
      .map((attempt, index) => validateAttempt(attempt, index, normalizedIntent));
    unique(attempts.map((item) => item.attemptId));
    const state = enumValue(value.state, POLICY.states);
    if (state !== envelopeState(attempts, state)) invalid();
    const remainingLimitations = stringArray(value.remainingLimitations, 128);
    if (canonical(remainingLimitations) !== canonical(limitationsFor(attempts, state))) {
      invalid();
    }
    const result = {
      schemaVersion: 2,
      state,
      normalizedIntent,
      candidatePlanPolicyVersion: POLICY.sourceCandidatePlanPolicyVersion,
      routingAdapterPolicyVersion: POLICY.policyVersion,
      attempts,
      remainingLimitations
    };
    enforceBytes(result);
    return deepFreeze(result);
  } catch (error) {
    throw new TypeError("invalid ResearchGuidedRoutedAlternativesV2", {
      cause: error
    });
  }
}

export function serializeResearchGuidedRoutedAlternativesV2(input) {
  return canonical(validateResearchGuidedRoutedAlternativesV2(input));
}

function validateAttempt(input, expectedIndex, normalizedIntent) {
  const value = strict(input, [
    "attemptId", "proposalIndex", "state", "provenance",
    "routeResults", "failureCode"
  ]);
  if (integer(value.proposalIndex, 0, 5) !== expectedIndex) invalid();
  const provenance = validateProvenance(value.provenance, normalizedIntent);
  const attemptId = text(value.attemptId, 39);
  if (
    !ATTEMPT_ID.test(attemptId) ||
    attemptId !== deriveResearchGuidedRouteAttemptIdV2(
      provenance.proposalId,
      provenance.lineageId
    )
  ) invalid();
  const state = enumValue(value.state, POLICY.attemptStates);
  const routeResults = array(value.routeResults, 0, 3).map((result, index) =>
    validateRouteResult(result, index, attemptId, provenance, normalizedIntent)
  );
  const failureCode = value.failureCode === null
    ? null
    : enumValue(value.failureCode, POLICY.failureCodes);
  if ((state === "routed") !== (routeResults.length > 0 && failureCode === null)) {
    invalid();
  }
  if (state !== "routed" && (routeResults.length !== 0 || failureCode === null)) {
    invalid();
  }
  return {
    attemptId,
    proposalIndex: expectedIndex,
    state,
    provenance,
    routeResults,
    failureCode
  };
}

function validateProvenance(input, normalizedIntent) {
  const value = strict(input, [
    "proposalId", "lineageId", "sourceProposalId", "strategy", "activity",
    "routeType", "selectedHighlights", "mappedNetworkCandidates",
    "evidenceClaimIds", "requiredVerification", "knownLimitations",
    "sourceCandidatePlanPolicyVersion", "trailAccessPolicyVersion"
  ]);
  if (!PROPOSAL_ID.test(value.proposalId)) invalid();
  if (
    value.activity !== normalizedIntent.activity ||
    value.routeType !== normalizedIntent.routeType ||
    value.sourceCandidatePlanPolicyVersion !==
      POLICY.sourceCandidatePlanPolicyVersion ||
    value.trailAccessPolicyVersion !== POLICY.trailAccessPolicyVersion
  ) invalid();
  const selectedHighlights = array(value.selectedHighlights, 1, 5)
    .map(validateSelectedHighlight);
  unique(selectedHighlights.map((item) => item.entityId));
  const sourceProposalId = enumPattern(value.sourceProposalId, SOURCE_PROPOSAL_ID);
  const provenance = {
    proposalId: value.proposalId,
    lineageId: value.lineageId,
    sourceProposalId,
    strategy: enumValue(value.strategy, V1_POLICY.strategies),
    activity: value.activity,
    routeType: value.routeType,
    selectedHighlights,
    mappedNetworkCandidates: array(value.mappedNetworkCandidates, 0, 8)
      .map(validateMappedNetworkCandidate),
    evidenceClaimIds: uuidArray(value.evidenceClaimIds, 1, 64),
    requiredVerification: enumArray(
      value.requiredVerification,
      VERIFICATION_CODES,
      64
    ),
    knownLimitations: enumArray(
      value.knownLimitations,
      LIMITATION_CODES,
      96
    ),
    sourceCandidatePlanPolicyVersion: value.sourceCandidatePlanPolicyVersion,
    trailAccessPolicyVersion: value.trailAccessPolicyVersion
  };
  if (
    !LINEAGE_ID.test(provenance.lineageId) ||
    provenance.lineageId !== deriveResearchGuidedRouteLineageIdV2(provenance)
  ) invalid();
  return provenance;
}

function validateSelectedHighlight(input) {
  const value = strict(input, [
    "entityId", "highlightCategory", "role", "evidenceCoordinate",
    "routingCoordinate", "trailAccessCandidate", "evidenceClaimIds",
    "selectionReasons", "requiredVerification", "knownLimitations"
  ]);
  const trailAccessCandidate = validateResearchTrailAccessCandidateV1(
    value.trailAccessCandidate
  );
  const evidenceCoordinate = coordinate(value.evidenceCoordinate);
  const routingCoordinate = coordinate(value.routingCoordinate);
  if (
    value.entityId !== trailAccessCandidate.originalHighlightEntityId ||
    value.highlightCategory !== trailAccessCandidate.highlightCategory ||
    canonical(evidenceCoordinate) !==
      canonical(trailAccessCandidate.evidenceCoordinate) ||
    canonical(routingCoordinate) !==
      canonical(trailAccessCandidate.routingCoordinate)
  ) invalid();
  return {
    entityId: uuid(value.entityId),
    highlightCategory: value.highlightCategory,
    role: enumValue(value.role, [
      ...CANDIDATE_POLICY.hardRoles,
      ...CANDIDATE_POLICY.optionalRoles
    ]),
    evidenceCoordinate,
    routingCoordinate,
    trailAccessCandidate,
    evidenceClaimIds: uuidArray(value.evidenceClaimIds, 1, 32),
    selectionReasons: enumArray(
      value.selectionReasons,
      V1_POLICY.selectionReasons,
      32
    ),
    requiredVerification: enumArray(
      value.requiredVerification,
      V1_POLICY.verificationCodes,
      32
    ),
    knownLimitations: enumArray(
      value.knownLimitations,
      V1_POLICY.limitationCodes,
      32
    )
  };
}

function validateMappedNetworkCandidate(input) {
  const value = strict(input, [
    "entityId", "sourceBasis", "evidenceClaimIds",
    "requiredVerification", "knownLimitations"
  ]);
  return {
    entityId: uuid(value.entityId),
    sourceBasis: enumValue(value.sourceBasis, ["mapped", "official", "mixed"]),
    evidenceClaimIds: uuidArray(value.evidenceClaimIds, 1, 32),
    requiredVerification: enumArray(
      value.requiredVerification,
      V1_POLICY.verificationCodes,
      32
    ),
    knownLimitations: enumArray(
      value.knownLimitations,
      V1_POLICY.limitationCodes,
      32
    )
  };
}

function validateRouteResult(input, expectedIndex, attemptId, provenance, intent) {
  const value = strict(input, [
    "routeResultId", "pathIndex", "geometryProvider", "routingStrategy",
    "verificationState", "path", "waypointSnaps",
    "highlightVerifications", "distanceVerification"
  ]);
  if (value.pathIndex !== expectedIndex) invalid();
  if (
    !RESULT_ID.test(value.routeResultId) ||
    value.geometryProvider !== "graphhopper" ||
    value.routingStrategy !== "backend"
  ) invalid();
  const path = validateResearchGuidedRoutePathV1(value.path);
  const waypointSnaps = array(
    value.waypointSnaps,
    provenance.selectedHighlights.length + 2,
    provenance.selectedHighlights.length + 2
  ).map((snap, index) => validateWaypointSnap(snap, index, provenance, intent));
  const highlightVerifications = array(
    value.highlightVerifications,
    provenance.selectedHighlights.length,
    provenance.selectedHighlights.length
  ).map((verification, index) => validateHighlightVerification(
    verification,
    index,
    provenance.selectedHighlights[index],
    waypointSnaps[index + 1],
    path
  ));
  const distanceVerification = validateDistanceVerification(
    value.distanceVerification,
    path.distance,
    intent.distanceRangeKm
  );
  const expectedState = routeVerificationState(
    provenance.selectedHighlights,
    highlightVerifications
  );
  if (value.verificationState !== expectedState) invalid();
  const result = {
    pathIndex: expectedIndex,
    geometryProvider: "graphhopper",
    routingStrategy: "backend",
    verificationState: expectedState,
    path,
    waypointSnaps,
    highlightVerifications,
    distanceVerification
  };
  const routeResultId = deriveResearchGuidedRouteResultIdV2(
    attemptId,
    expectedIndex,
    result
  );
  if (value.routeResultId !== routeResultId) invalid();
  return { routeResultId, ...result };
}

function validateWaypointSnap(input, index, provenance, intent) {
  const value = strict(input, [
    "waypointIndex", "role", "entityId", "requestedCoordinate",
    "snappedCoordinate", "snapDistanceMeters", "withinAccessTolerance"
  ]);
  if (value.waypointIndex !== index) invalid();
  const isVia = index > 0 && index <= provenance.selectedHighlights.length;
  const expected = isVia
    ? provenance.selectedHighlights[index - 1]
    : null;
  const role = isVia
    ? "via_access"
    : index === 0 ? "anchor" : "return_anchor";
  if (value.role !== role || value.entityId !== (expected?.entityId ?? null)) {
    invalid();
  }
  const requestedCoordinate = coordinate(value.requestedCoordinate);
  const expectedCoordinate = expected?.routingCoordinate ??
    intent.geographicAnchor.coordinate;
  if (canonical(requestedCoordinate) !== canonical(expectedCoordinate)) invalid();
  const snappedCoordinate = value.snappedCoordinate === null
    ? null
    : coordinate(value.snappedCoordinate, true);
  const snapDistanceMeters = value.snapDistanceMeters === null
    ? null
    : number(value.snapDistanceMeters, 0, 1_000_000);
  if ((snappedCoordinate === null) !== (snapDistanceMeters === null)) invalid();
  const expectedDistance = snappedCoordinate === null
    ? null
    : haversine(requestedCoordinate, snappedCoordinate);
  if (
    expectedDistance !== null &&
    Math.abs(expectedDistance - snapDistanceMeters) >
      POLICY.limits.calculationToleranceMeters
  ) invalid();
  const within = expectedDistance !== null &&
    expectedDistance <= POLICY.limits.providerAccessSnapToleranceMeters;
  if (value.withinAccessTolerance !== within) invalid();
  return {
    waypointIndex: index,
    role,
    entityId: expected?.entityId ?? null,
    requestedCoordinate,
    snappedCoordinate,
    snapDistanceMeters,
    withinAccessTolerance: within
  };
}

function validateHighlightVerification(input, index, highlight, snap, path) {
  const value = strict(input, [
    "highlightIndex", "entityId", "role", "evidenceCoordinate",
    "routingCoordinate", "providerSnappedCoordinate",
    "providerSnapDistanceMeters", "routeClosestApproachCoordinate",
    "routeGeometryDistanceToAccessMeters",
    "routeGeometryDistanceToEvidenceMeters", "providerVerifiedAccess",
    "approachState"
  ]);
  if (
    value.highlightIndex !== index ||
    value.entityId !== highlight.entityId || value.role !== highlight.role ||
    canonical(value.evidenceCoordinate) !== canonical(highlight.evidenceCoordinate) ||
    canonical(value.routingCoordinate) !== canonical(highlight.routingCoordinate) ||
    canonical(value.providerSnappedCoordinate) !== canonical(snap.snappedCoordinate) ||
    value.providerSnapDistanceMeters !== snap.snapDistanceMeters
  ) invalid();
  const closest = closestPointOnPath(path.points.coordinates, highlight.evidenceCoordinate);
  const accessClosest = closestPointOnPath(path.points.coordinates, highlight.routingCoordinate);
  const closestCoordinate = coordinate(value.routeClosestApproachCoordinate);
  if (
    haversine(closestCoordinate, closest.coordinate) >
      POLICY.limits.calculationToleranceMeters ||
    Math.abs(value.routeGeometryDistanceToEvidenceMeters - closest.distanceMeters) >
      POLICY.limits.calculationToleranceMeters ||
    Math.abs(value.routeGeometryDistanceToAccessMeters - accessClosest.distanceMeters) >
      POLICY.limits.calculationToleranceMeters
  ) invalid();
  const providerVerifiedAccess = snap.withinAccessTolerance &&
    accessClosest.distanceMeters <= POLICY.limits.routeAccessToleranceMeters;
  const approachState = approachFor(providerVerifiedAccess, closest.distanceMeters);
  if (
    value.providerVerifiedAccess !== providerVerifiedAccess ||
    value.approachState !== approachState
  ) invalid();
  return {
    highlightIndex: index,
    entityId: highlight.entityId,
    role: highlight.role,
    evidenceCoordinate: highlight.evidenceCoordinate,
    routingCoordinate: highlight.routingCoordinate,
    providerSnappedCoordinate: snap.snappedCoordinate,
    providerSnapDistanceMeters: snap.snapDistanceMeters,
    routeClosestApproachCoordinate: closestCoordinate,
    routeGeometryDistanceToAccessMeters: value.routeGeometryDistanceToAccessMeters,
    routeGeometryDistanceToEvidenceMeters: value.routeGeometryDistanceToEvidenceMeters,
    providerVerifiedAccess,
    approachState
  };
}

function validateDistanceVerification(input, distanceMeters, targetRange) {
  const value = strict(input, [
    "routeDistanceKm", "targetRangeKm", "state", "deviationKm"
  ]);
  const routeDistanceKm = Number((distanceMeters / 1_000).toFixed(3));
  if (value.routeDistanceKm !== routeDistanceKm || canonical(value.targetRangeKm) !== canonical(targetRange)) invalid();
  let state = "target_unspecified";
  let deviationKm = null;
  if (targetRange !== null) {
    state = routeDistanceKm >= targetRange.min && routeDistanceKm <= targetRange.max
      ? "within_target" : "outside_target";
    deviationKm = routeDistanceKm < targetRange.min
      ? Number((targetRange.min - routeDistanceKm).toFixed(3))
      : routeDistanceKm > targetRange.max
        ? Number((routeDistanceKm - targetRange.max).toFixed(3))
        : 0;
  }
  if (value.state !== state || value.deviationKm !== deviationKm) invalid();
  return { routeDistanceKm, targetRangeKm: targetRange, state, deviationKm };
}

export function closestPointOnPath(coordinates, target) {
  let best = null;
  for (let index = 1; index < coordinates.length; index += 1) {
    const candidate = closestPointOnSegment(
      decodePathCoordinate(coordinates[index - 1]),
      decodePathCoordinate(coordinates[index]),
      target
    );
    if (!best || candidate.distanceMeters < best.distanceMeters) best = candidate;
  }
  return best;
}

function closestPointOnSegment(start, finish, target) {
  const radians = Math.PI / 180;
  const earth = 6_371_000;
  const originLatitude = target.latitude * radians;
  const xy = (point) => ({
    x: (point.longitude - target.longitude) * radians *
      Math.cos(originLatitude) * earth,
    y: (point.latitude - target.latitude) * radians * earth
  });
  const a = xy(start);
  const b = xy(finish);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const denominator = dx * dx + dy * dy;
  const t = denominator === 0 ? 0 : Math.max(0, Math.min(1,
    -(a.x * dx + a.y * dy) / denominator
  ));
  const coordinate = {
    latitude: start.latitude + (finish.latitude - start.latitude) * t,
    longitude: start.longitude + (finish.longitude - start.longitude) * t
  };
  return { coordinate, distanceMeters: haversine(target, coordinate) };
}

function routeVerificationState(highlights, verifications) {
  const hardIds = new Set(highlights
    .filter((item) => CANDIDATE_POLICY.hardRoles.includes(item.role))
    .map((item) => item.entityId));
  if (verifications.some((item) =>
    hardIds.has(item.entityId) && !item.providerVerifiedAccess
  )) {
    return "unverified";
  }
  return verifications.some((item) =>
    hardIds.has(item.entityId) && item.approachState !== "reached"
  ) ? "ineligible" : "eligible";
}

function approachFor(verified, distance) {
  if (!verified) return "unverified";
  if (distance <= POLICY.limits.reachedEvidenceToleranceMeters) return "reached";
  if (distance <= POLICY.limits.passesNearEvidenceToleranceMeters) return "passes_near";
  return "not_reached";
}

function envelopeState(attempts, declared) {
  if (attempts.length === 0) return declared === "unsupported" ? declared : "no_viable_route";
  const results = attempts.flatMap((item) => item.routeResults);
  if (results.some((item) => item.verificationState === "eligible") &&
      attempts.every((item) => item.state === "routed")) return "routed";
  if (results.length > 0) return "partial";
  if (attempts.every((item) => item.state === "unsupported")) return "unsupported";
  return "no_viable_route";
}

function limitationsFor(attempts, state) {
  const values = attempts.flatMap((item) => item.provenance.knownLimitations);
  if (attempts.length === 0) values.push("candidate_plan_not_routable");
  if (state === "unsupported" && attempts.length === 0) values.push("candidate_plan_unsupported");
  if (attempts.some((item) => item.state === "failed")) values.push("provider_failure");
  if (attempts.some((item) => item.state === "unsupported")) values.push("route_type_unsupported");
  for (const result of attempts.flatMap((item) => item.routeResults)) {
    for (const verification of result.highlightVerifications) {
      if (verification.providerSnappedCoordinate === null) values.push("provider_access_snap_unavailable");
      else if (!verification.providerVerifiedAccess) values.push("provider_access_snap_exceeds_tolerance");
      if (verification.routeGeometryDistanceToAccessMeters > POLICY.limits.routeAccessToleranceMeters) values.push("route_misses_access_coordinate");
      if (verification.approachState === "passes_near") values.push("selected_highlight_passes_near");
      if (verification.approachState === "not_reached") values.push("selected_highlight_not_reached");
    }
    if (result.distanceVerification.state === "outside_target") values.push("target_distance_not_met");
  }
  return [...new Set(values)].sort();
}

function decodePathCoordinate(value) {
  return { latitude: value[1], longitude: value[0] };
}

function coordinate(input, elevationAllowed = false) {
  const allowed = elevationAllowed
    ? ["latitude", "longitude", "elevationMeters"]
    : ["latitude", "longitude"];
  if (!input || typeof input !== "object" || Array.isArray(input)) invalid();
  if (Object.keys(input).some((key) => !allowed.includes(key)) ||
      !Object.hasOwn(input, "latitude") || !Object.hasOwn(input, "longitude")) invalid();
  const result = {
    latitude: number(input.latitude, -90, 90),
    longitude: number(input.longitude, -180, 180)
  };
  if (input.elevationMeters !== undefined) result.elevationMeters = number(input.elevationMeters, -100_000, 100_000);
  return result;
}

function haversine(start, finish) {
  const r = Math.PI / 180;
  const dLat = (finish.latitude - start.latitude) * r;
  const dLon = (finish.longitude - start.longitude) * r;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(start.latitude * r) *
    Math.cos(finish.latitude * r) * Math.sin(dLon / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
}

function strict(input, fields) {
  if (!input || typeof input !== "object" || Array.isArray(input)) invalid();
  const keys = Object.keys(input);
  if (keys.length !== fields.length || keys.some((key) => !fields.includes(key)) || fields.some((field) => !Object.hasOwn(input, field))) invalid();
  return input;
}

function array(value, min, max) {
  if (!Array.isArray(value) || value.length < min || value.length > max) invalid();
  return value;
}

function stringArray(value, max) {
  const result = array(value, 0, max).map((item) => text(item, 512));
  if (new Set(result).size !== result.length) invalid();
  return result;
}

function enumArray(value, allowed, max) {
  const result = array(value, 0, max).map((item) => enumValue(item, allowed));
  unique(result);
  return result;
}

function uuidArray(value, min, max) {
  const result = array(value, min, max).map(uuid);
  unique(result);
  return result;
}

function uuid(value) {
  if (typeof value !== "string" || !UUID.test(value)) invalid();
  return value;
}

function enumPattern(value, pattern) {
  if (typeof value !== "string" || !pattern.test(value)) invalid();
  return value;
}

function unique(values) {
  if (new Set(values).size !== values.length) invalid();
}

function enumValue(value, allowed) {
  if (!allowed.includes(value)) invalid();
  return value;
}

function text(value, exactOrMax) {
  if (typeof value !== "string" || value.length < 1 || value.length > exactOrMax) invalid();
  return value;
}

function number(value, min, max) {
  if (!Number.isFinite(value) || value < min || value > max) invalid();
  return value;
}

function integer(value, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) invalid();
  return value;
}

function enforceBytes(value) {
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > POLICY.limits.maximumEnvelopeBytes) invalid();
}

function digest(value) {
  return createHash("sha256").update(canonical(value)).digest("hex").slice(0, 32);
}

function identityValue(value) {
  if (Array.isArray(value)) return value.map(identityValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, identityValue(child)])
    );
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) invalid();
    return value.toFixed(7);
  }
  return value;
}

function canonical(value) {
  return JSON.stringify(sort(value));
}

function sort(value) {
  if (Array.isArray(value)) return value.map(sort);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).filter((key) => value[key] !== undefined).sort().map((key) => [key, sort(value[key])]));
}

function invalid() { throw new TypeError("invalid ResearchGuidedRoutedAlternativesV2"); }

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}
