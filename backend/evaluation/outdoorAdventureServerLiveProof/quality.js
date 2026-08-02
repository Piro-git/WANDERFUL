import {
  safeProofDigestV1
} from "./manifest.js";

export const SERVER_LIVE_QUALITY_POLICY_VERSION =
  "hiking-route-quality-v1-server-proof-projection";

const POLICY = Object.freeze({
  corridorMeters: 35,
  nearDuplicateSimilarity: 0.86,
  maximumLoopClosureMeters: 250,
  loopClosureLengthFraction: 0.015,
  maximumSelfBacktrackingRatio: 0.55,
  maximumSelfOverlapRatio: 0.55,
  minimumLoopShapeQuality: 0.025,
  minimumDistanceRatio: 0.55,
  maximumDistanceRatio: 1.75,
  minimumStrongEvidenceCoverage: 0.60,
  maximumMajorRoadRatioWhenExplicitlyAvoided: 0.25,
  maximumKnownHikeRatingForEasyRequest: 1,
  minimumDemandingTechnicalDistanceMeters: 100
});
const PATH_CLASSES = new Set(["track", "footway", "path", "steps"]);
const TRAIL_CLASSES = new Set(["track", "footway", "path"]);
const MAJOR_ROAD_CLASSES = new Set([
  "motorway", "trunk", "primary", "secondary"
]);

export function evaluateServerLiveRouteQualityV1({
  caseId,
  input,
  routedAlternatives
}) {
  const routed = routedAlternatives?.attempts?.flatMap((attempt) =>
    attempt.routeResults.map((result) => ({ attempt, result }))
  ) ?? [];
  const assessed = routed.map(({ attempt, result }, providerIndex) =>
    assessRoute({ caseId, input, attempt, result, providerIndex })
  );
  const eligible = assessed.filter((item) => item.eligible);
  const ranked = rankAndDeduplicate(eligible);
  const selectedIds = new Set(ranked.map((item) => item.routeDigest));
  const routes = assessed.map((item) => ({
    ...item,
    selected: selectedIds.has(item.routeDigest),
    rank: ranked.findIndex((rankedItem) =>
      rankedItem.routeDigest === item.routeDigest
    ) + 1 || null
  }));
  return Object.freeze({
    policyVersion: SERVER_LIVE_QUALITY_POLICY_VERSION,
    providerOrderUsedAsRanking: false,
    routeCount: routes.length,
    eligibleCount: eligible.length,
    selectedCount: ranked.length,
    rejectionCount: routes.filter((item) => !item.eligible).length,
    nearDuplicateRejectionCount:
      eligible.length - ranked.length,
    maximumPairwiseSimilarity: round(maximumPairwiseSimilarity(assessed), 4),
    routes: Object.freeze(routes)
  });
}

export function analyzeRouteGeometryV1(coordinates) {
  const decoded = coordinates.map(decodeCoordinate);
  const geometryLengthMeters = polylineLength(decoded);
  const closureGapMeters = distance(decoded[0], decoded.at(-1));
  const closureToleranceMeters = Math.min(
    POLICY.maximumLoopClosureMeters,
    Math.max(75, geometryLengthMeters * POLICY.loopClosureLengthFraction)
  );
  return {
    decoded,
    geometryLengthMeters,
    closureGapMeters,
    closureToleranceMeters,
    isClosedLoop: closureGapMeters <= closureToleranceMeters,
    selfBacktrackingRatio: repeatedSegmentRatio(
      decoded,
      POLICY.corridorMeters,
      "opposite"
    ),
    selfOverlapRatio: repeatedSegmentRatio(
      decoded,
      POLICY.corridorMeters,
      "parallel"
    ),
    shapeQuality: shapeQuality(decoded)
  };
}

export function pairwiseSimilarityV1(left, right) {
  if (left.length < 2 || right.length < 2) return 0;
  const lhs = left.map(decodeCoordinate);
  const rhs = right.map(decodeCoordinate);
  const originLatitude = (lhs[0].latitude + rhs[0].latitude) / 2;
  const originLongitude = (lhs[0].longitude + rhs[0].longitude) / 2;
  const lhsSamples = resample(project(lhs, originLatitude, originLongitude), 192);
  const rhsSamples = resample(project(rhs, originLatitude, originLongitude), 192);
  return Math.min(
    directedCoverage(lhsSamples, rhsSamples, POLICY.corridorMeters),
    directedCoverage(rhsSamples, lhsSamples, POLICY.corridorMeters)
  );
}

function assessRoute({ caseId, input, attempt, result, providerIndex }) {
  const analysis = analyzeRouteGeometryV1(result.path.points.coordinates);
  const characteristics = characteristicsFor(
    result.path.details ?? {},
    analysis.decoded,
    result.path.distance
  );
  const viaVisits = result.waypointVisits.filter((visit) =>
    visit.role === "via"
  );
  const reachedCount = viaVisits.filter((visit) =>
    visit.withinVisitTolerance === true
  ).length;
  const maximumSnapDistanceMeters = Math.max(
    0,
    ...result.waypointVisits.map((visit) => visit.snapDistanceMeters ?? 0)
  );
  const distanceRatio = result.path.distance / (input.targetDistanceKm * 1_000);
  const distanceDeviationRatio = Math.abs(distanceRatio - 1);
  const rejectionReasons = [];
  if (
    analysis.decoded.length < 4 ||
    analysis.geometryLengthMeters < 100 ||
    !Number.isFinite(result.path.distance) ||
    result.path.distance <= 0 ||
    !Number.isInteger(result.path.time) ||
    result.path.time <= 0
  ) {
    rejectionReasons.push("invalid_geometry");
  } else if (!analysis.isClosedLoop) {
    rejectionReasons.push("open_loop");
  } else if (
    analysis.selfBacktrackingRatio > POLICY.maximumSelfBacktrackingRatio
  ) {
    rejectionReasons.push("excessive_backtracking");
  } else if (analysis.selfOverlapRatio > POLICY.maximumSelfOverlapRatio) {
    rejectionReasons.push("excessive_self_overlap");
  } else if (analysis.shapeQuality < POLICY.minimumLoopShapeQuality) {
    rejectionReasons.push("degenerate_loop_shape");
  } else if (
    distanceRatio < POLICY.minimumDistanceRatio ||
    distanceRatio > POLICY.maximumDistanceRatio
  ) {
    rejectionReasons.push("distance_outside_hard_envelope");
  }
  if (reachedCount !== viaVisits.length || maximumSnapDistanceMeters > 100) {
    rejectionReasons.push("excessive_snapping");
  }
  if (
    input.maximumTechnicalDifficulty === "hiking" &&
    characteristics.maximumKnownHikeRating !== null &&
    characteristics.maximumKnownHikeRating >
      POLICY.maximumKnownHikeRatingForEasyRequest &&
    characteristics.demandingTechnicalDistanceMeters >=
      POLICY.minimumDemandingTechnicalDistanceMeters
  ) {
    rejectionReasons.push("known_technical_difficulty_above_easy_request");
  }
  if (
    input.avoidedExperiences.includes("major_roads") &&
    characteristics.roadClassCoverageRatio >=
      POLICY.minimumStrongEvidenceCoverage &&
    characteristics.majorRoadRatio >
      POLICY.maximumMajorRoadRatioWhenExplicitlyAvoided
  ) {
    rejectionReasons.push("excessive_known_major_road_exposure");
  }
  const selectedEvidenceValid =
    attempt.provenance.selectedWaypoints.length === viaVisits.length &&
    attempt.provenance.selectedWaypoints.every((waypoint) =>
      Array.isArray(waypoint.evidenceClaimIds) &&
      waypoint.evidenceClaimIds.length > 0
    );
  if (!selectedEvidenceValid) {
    rejectionReasons.push("selected_waypoint_provenance_invalid");
  }
  const limitations = new Set(attempt.provenance.knownLimitations);
  if (input.preferredExperiences.length > 0) {
    limitations.add("requested_preferences_unverified");
  }
  if (characteristics.roadClassCoverageRatio < POLICY.minimumStrongEvidenceCoverage) {
    limitations.add("road_class_coverage_limited");
  }
  if (characteristics.hikeRatingCoverageRatio < POLICY.minimumStrongEvidenceCoverage) {
    limitations.add("technical_difficulty_coverage_limited");
  }
  return Object.freeze({
    routeDigest: safeProofDigestV1({
      caseId,
      routeResultId: result.routeResultId,
      distance: Math.round(result.path.distance),
      time: result.path.time
    }, "route"),
    proposalDigest: safeProofDigestV1(
      attempt.provenance.proposalId,
      "proposal"
    ),
    providerIndex,
    geometryProvider: result.geometryProvider,
    routingStrategy: result.routingStrategy,
    researchProvenanceDistinctFromRoutingProvenance:
      result.geometryProvider === "graphhopper" &&
      selectedEvidenceValid,
    waypointOrderPreserved: result.waypointVisits.every((visit, index) =>
      visit.waypointIndex === index
    ),
    selectedWaypointCount: viaVisits.length,
    reachedSelectedWaypointCount: reachedCount,
    reachedSelectedWaypointRatio:
      viaVisits.length === 0 ? 1 : round(reachedCount / viaVisits.length, 4),
    maximumSnapDistanceMeters: round(maximumSnapDistanceMeters, 1),
    excessiveSnapping: maximumSnapDistanceMeters > 100,
    distanceKm: round(result.path.distance / 1_000, 3),
    durationMinutes: round(result.path.time / 60_000, 1),
    ascentMeters: round(result.path.ascend ?? 0, 1),
    descentMeters: round(result.path.descend ?? 0, 1),
    targetDistanceDeviationRatio: round(distanceDeviationRatio, 4),
    loopClosureMeters: round(analysis.closureGapMeters, 1),
    loopClosureToleranceMeters: round(analysis.closureToleranceMeters, 1),
    genuineLoop: analysis.isClosedLoop,
    selfBacktrackingRatio: round(analysis.selfBacktrackingRatio, 4),
    selfOverlapRatio: round(analysis.selfOverlapRatio, 4),
    loopShapeQuality: round(analysis.shapeQuality, 4),
    roadClassCoverageRatio: round(characteristics.roadClassCoverageRatio, 4),
    pathAndTrackRatio: round(characteristics.pathAndTrackRatio, 4),
    trailRatio: round(characteristics.trailRatio, 4),
    majorRoadRatio: round(characteristics.majorRoadRatio, 4),
    surfaceCoverageRatio: round(characteristics.surfaceCoverageRatio, 4),
    hikeRatingCoverageRatio: round(characteristics.hikeRatingCoverageRatio, 4),
    maximumKnownHikeRating: characteristics.maximumKnownHikeRating,
    demandingTechnicalDistanceMeters: round(
      characteristics.demandingTechnicalDistanceMeters,
      1
    ),
    mappedNetworkBasis: Object.freeze([
      ...new Set(attempt.provenance.mappedNetworkCandidates.map((candidate) =>
        candidate.sourceBasis
      ))
    ].sort()),
    eligible: rejectionReasons.length === 0,
    rejectionReasons: Object.freeze([...new Set(rejectionReasons)]),
    limitations: Object.freeze([...limitations].sort()),
    _geometry: result.path.points.coordinates
  });
}

function rankAndDeduplicate(eligible) {
  const ordered = [...eligible].sort(compareQuality);
  const selected = [];
  for (const candidate of ordered) {
    if (selected.some((existing) =>
      pairwiseSimilarityV1(candidate._geometry, existing._geometry) >=
        POLICY.nearDuplicateSimilarity
    )) {
      continue;
    }
    selected.push(candidate);
    if (selected.length === 3) break;
  }
  return selected;
}

function compareQuality(left, right) {
  return compareNumber(left.targetDistanceDeviationRatio, right.targetDistanceDeviationRatio) ||
    compareNumber(left.majorRoadRatio, right.majorRoadRatio) ||
    compareNumber(left.selfBacktrackingRatio, right.selfBacktrackingRatio) ||
    compareNumber(left.selfOverlapRatio, right.selfOverlapRatio) ||
    compareNumber(right.loopShapeQuality, left.loopShapeQuality) ||
    left.routeDigest.localeCompare(right.routeDigest);
}

function maximumPairwiseSimilarity(assessed) {
  let maximum = 0;
  for (let left = 0; left < assessed.length; left += 1) {
    for (let right = left + 1; right < assessed.length; right += 1) {
      maximum = Math.max(maximum, pairwiseSimilarityV1(
        assessed[left]._geometry,
        assessed[right]._geometry
      ));
    }
  }
  return maximum;
}

function characteristicsFor(details, coordinates, routedDistanceMeters) {
  const segmentDistances = coordinates.slice(1).map((point, index) =>
    distance(coordinates[index], point)
  );
  const surface = characteristicBreakdown(details.surface, segmentDistances);
  const roadClass = characteristicBreakdown(
    details.road_class,
    segmentDistances
  );
  const hikeRating = characteristicBreakdown(
    details.hike_rating,
    segmentDistances
  );
  const denominator = Math.max(routedDistanceMeters, 1);
  const distanceFor = (values, accepted) => [...values.entries()]
    .filter(([value]) => accepted.has(value))
    .reduce((total, [, meters]) => total + meters, 0);
  let maximumKnownHikeRating = null;
  let demandingTechnicalDistanceMeters = 0;
  let knownHikeRatingDistance = 0;
  for (const [value, meters] of hikeRating.values.entries()) {
    const rating = Number.parseInt(value, 10);
    if (!Number.isInteger(rating) || rating < 1 || rating > 6) continue;
    maximumKnownHikeRating = Math.max(maximumKnownHikeRating ?? rating, rating);
    knownHikeRatingDistance += meters;
    if (rating > 1) demandingTechnicalDistanceMeters += meters;
  }
  return {
    surfaceCoverageRatio: clamp(surface.coverage / denominator),
    roadClassCoverageRatio: clamp(roadClass.coverage / denominator),
    hikeRatingCoverageRatio: clamp(knownHikeRatingDistance / denominator),
    pathAndTrackRatio: clamp(
      distanceFor(roadClass.values, PATH_CLASSES) / denominator
    ),
    trailRatio: clamp(
      distanceFor(roadClass.values, TRAIL_CLASSES) / denominator
    ),
    majorRoadRatio: clamp(
      distanceFor(roadClass.values, MAJOR_ROAD_CLASSES) / denominator
    ),
    maximumKnownHikeRating,
    demandingTechnicalDistanceMeters
  };
}

function characteristicBreakdown(details, segmentDistances) {
  const segmentValues = Array(segmentDistances.length).fill(null);
  for (const detail of Array.isArray(details) ? details : []) {
    if (!Array.isArray(detail) || detail.length !== 3) continue;
    const value = normalizeDetailValue(detail[2]);
    if (value === null) continue;
    const from = Math.min(Math.max(detail[0], 0), segmentDistances.length);
    const to = Math.min(Math.max(detail[1], 0), segmentDistances.length);
    for (let index = from; index < to; index += 1) {
      if (segmentValues[index] === null) segmentValues[index] = value;
    }
  }
  const values = new Map();
  let coverage = 0;
  segmentValues.forEach((value, index) => {
    if (value === null) return;
    const meters = segmentDistances[index];
    values.set(value, (values.get(value) ?? 0) + meters);
    coverage += meters;
  });
  return { values, coverage };
}

function normalizeDetailValue(value) {
  if (["string", "number", "boolean"].includes(typeof value)) {
    return String(value).trim().toLowerCase();
  }
  return null;
}

function repeatedSegmentRatio(coordinates, corridorMeters, direction) {
  if (coordinates.length < 4) return 1;
  const points = resample(project(
    coordinates,
    coordinates[0].latitude,
    coordinates[0].longitude
  ), 1_024);
  if (points.length < 4) return 1;
  const segmentCount = points.length - 1;
  const minimumSeparation = Math.max(4, Math.floor(segmentCount / 18));
  const matched = new Set();
  for (let leftIndex = 0; leftIndex < segmentCount; leftIndex += 1) {
    const leftStart = points[leftIndex];
    const leftEnd = points[leftIndex + 1];
    const leftVector = {
      x: leftEnd.x - leftStart.x,
      y: leftEnd.y - leftStart.y
    };
    const leftLength = Math.hypot(leftVector.x, leftVector.y);
    if (leftLength <= 0) continue;
    const leftMid = {
      x: (leftStart.x + leftEnd.x) / 2,
      y: (leftStart.y + leftEnd.y) / 2
    };
    for (let rightIndex = leftIndex + 1; rightIndex < segmentCount; rightIndex += 1) {
      const linear = rightIndex - leftIndex;
      const circular = Math.min(linear, segmentCount - linear);
      if (circular < minimumSeparation) continue;
      const rightStart = points[rightIndex];
      const rightEnd = points[rightIndex + 1];
      const rightVector = {
        x: rightEnd.x - rightStart.x,
        y: rightEnd.y - rightStart.y
      };
      const rightLength = Math.hypot(rightVector.x, rightVector.y);
      if (rightLength <= 0) continue;
      const rightMid = {
        x: (rightStart.x + rightEnd.x) / 2,
        y: (rightStart.y + rightEnd.y) / 2
      };
      if (Math.hypot(leftMid.x - rightMid.x, leftMid.y - rightMid.y) > corridorMeters) {
        continue;
      }
      const dot = (
        leftVector.x * rightVector.x + leftVector.y * rightVector.y
      ) / (leftLength * rightLength);
      const repeated = direction === "opposite"
        ? dot <= -0.75
        : Math.abs(dot) >= 0.75;
      if (repeated) {
        matched.add(leftIndex);
        matched.add(rightIndex);
      }
    }
  }
  return matched.size / segmentCount;
}

function shapeQuality(coordinates) {
  if (coordinates.length < 4) return 0;
  const points = project(
    coordinates,
    coordinates[0].latitude,
    coordinates[0].longitude
  );
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const width = Math.max(Math.max(...xs) - Math.min(...xs), 1);
  const height = Math.max(Math.max(...ys) - Math.min(...ys), 1);
  const meanX = xs.reduce((sum, value) => sum + value, 0) / points.length;
  const meanY = ys.reduce((sum, value) => sum + value, 0) / points.length;
  const covarianceXX = points.reduce((sum, point) =>
    sum + (point.x - meanX) ** 2, 0
  ) / points.length;
  const covarianceYY = points.reduce((sum, point) =>
    sum + (point.y - meanY) ** 2, 0
  ) / points.length;
  const covarianceXY = points.reduce((sum, point) =>
    sum + (point.x - meanX) * (point.y - meanY), 0
  ) / points.length;
  const trace = covarianceXX + covarianceYY;
  const discriminant = Math.sqrt(Math.max(
    0,
    (covarianceXX - covarianceYY) ** 2 + 4 * covarianceXY ** 2
  ));
  const major = Math.max((trace + discriminant) / 2, 0);
  const minor = Math.max((trace - discriminant) / 2, 0);
  const spread = major > 0 ? Math.sqrt(minor / major) : 0;
  const area = polygonArea(points);
  const perimeter = points.slice(1).reduce((sum, point, index) =>
    sum + Math.hypot(point.x - points[index].x, point.y - points[index].y), 0
  );
  if (perimeter <= 0) return 0;
  const compactness = Math.min(4 * Math.PI * area / (perimeter ** 2), 1);
  const areaFill = Math.min(area / (width * height), 1);
  return clamp(spread * 0.35 + compactness * 0.45 + areaFill * 0.20);
}

function directedCoverage(samples, reference, corridorMeters) {
  if (samples.length === 0 || reference.length < 2) return 0;
  let covered = 0;
  for (const point of samples) {
    let minimum = Number.POSITIVE_INFINITY;
    for (let index = 0; index < reference.length - 1; index += 1) {
      minimum = Math.min(
        minimum,
        pointToSegmentDistance(point, reference[index], reference[index + 1])
      );
    }
    if (minimum <= corridorMeters) covered += 1;
  }
  return covered / samples.length;
}

function pointToSegmentDistance(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const squaredLength = dx * dx + dy * dy;
  if (squaredLength <= 0) return Math.hypot(point.x - start.x, point.y - start.y);
  const projection = Math.max(0, Math.min(
    1,
    ((point.x - start.x) * dx + (point.y - start.y) * dy) / squaredLength
  ));
  return Math.hypot(
    point.x - (start.x + projection * dx),
    point.y - (start.y + projection * dy)
  );
}

function resample(points, maximumSampleCount) {
  if (points.length < 2) return points;
  const cumulative = [0];
  for (let index = 1; index < points.length; index += 1) {
    cumulative.push(cumulative.at(-1) + Math.hypot(
      points[index].x - points[index - 1].x,
      points[index].y - points[index - 1].y
    ));
  }
  const total = cumulative.at(-1);
  if (total <= 0) return [points[0]];
  const sampleCount = Math.min(
    maximumSampleCount,
    Math.max(16, Math.floor(total / 25) + 1)
  );
  const result = [];
  let segmentIndex = 0;
  for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
    const target = total * sampleIndex / (sampleCount - 1);
    while (
      segmentIndex + 1 < cumulative.length - 1 &&
      cumulative[segmentIndex + 1] < target
    ) {
      segmentIndex += 1;
    }
    const segmentLength = cumulative[segmentIndex + 1] - cumulative[segmentIndex];
    const fraction = segmentLength > 0
      ? (target - cumulative[segmentIndex]) / segmentLength
      : 0;
    const start = points[segmentIndex];
    const end = points[segmentIndex + 1];
    result.push({
      x: start.x + (end.x - start.x) * fraction,
      y: start.y + (end.y - start.y) * fraction
    });
  }
  return result;
}

function project(coordinates, originLatitude, originLongitude) {
  const latitudeRadians = originLatitude * Math.PI / 180;
  return coordinates.map((coordinate) => ({
    x: (coordinate.longitude - originLongitude) *
      Math.cos(latitudeRadians) * 111_320,
    y: (coordinate.latitude - originLatitude) * 110_570
  }));
}

function decodeCoordinate(value) {
  if (
    !Array.isArray(value) ||
    value.length < 2 ||
    !Number.isFinite(value[0]) ||
    !Number.isFinite(value[1])
  ) {
    throw Object.assign(new Error("invalid_geometry"), {
      code: "invalid_geometry"
    });
  }
  return { longitude: value[0], latitude: value[1] };
}

function polylineLength(coordinates) {
  return coordinates.slice(1).reduce((total, coordinate, index) =>
    total + distance(coordinates[index], coordinate), 0
  );
}

function distance(left, right) {
  const radius = 6_371_000;
  const leftLatitude = left.latitude * Math.PI / 180;
  const rightLatitude = right.latitude * Math.PI / 180;
  const latitudeDelta = (right.latitude - left.latitude) * Math.PI / 180;
  const longitudeDelta = (right.longitude - left.longitude) * Math.PI / 180;
  const value = Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(leftLatitude) * Math.cos(rightLatitude) *
    Math.sin(longitudeDelta / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(Math.max(0, 1 - value)));
}

function polygonArea(points) {
  let sum = 0;
  for (let index = 0; index < points.length; index += 1) {
    const next = points[(index + 1) % points.length];
    sum += points[index].x * next.y - next.x * points[index].y;
  }
  return Math.abs(sum) / 2;
}

function compareNumber(left, right) {
  return left === right ? 0 : left < right ? -1 : 1;
}

function clamp(value) {
  return Math.max(0, Math.min(value, 1));
}

function round(value, digits) {
  if (!Number.isFinite(value)) return null;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

export function redactQualityGeometryV1(quality) {
  return {
    ...quality,
    routes: quality.routes.map(({ _geometry, ...route }) => route)
  };
}
