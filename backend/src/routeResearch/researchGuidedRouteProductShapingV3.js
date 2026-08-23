import {
  RESEARCH_GUIDED_ROUTE_PRODUCT_SHAPING_POLICY_V3_1
} from "./researchGuidedRouteProductShapingPolicyV3_1.js";

const POLICY = RESEARCH_GUIDED_ROUTE_PRODUCT_SHAPING_POLICY_V3_1;
const HARD_ROLES = new Set([
  "must_have",
  "facility_candidate",
  "overnight_candidate"
]);

export function shapeResearchGuidedLoopSourceProposalV3({
  anchor,
  targetRange,
  sourceProposal,
  accessCandidatesByEntity,
  materializeHighlight
}) {
  assertCoordinate(anchor);
  assertTargetRange(targetRange);
  if (
    !sourceProposal ||
    typeof sourceProposal !== "object" ||
    sourceProposal.routeType !== "loop" ||
    !Array.isArray(sourceProposal.viaCandidates) ||
    sourceProposal.viaCandidates.length < 1 ||
    sourceProposal.viaCandidates.length >
      POLICY.limits.maximumSelectedHighlightsPerProposal ||
    !(accessCandidatesByEntity instanceof Map) ||
    typeof materializeHighlight !== "function"
  ) {
    invalid();
  }
  const viaEntityIds = new Set();
  for (const via of sourceProposal.viaCandidates) {
    if (
      !via ||
      typeof via !== "object" ||
      typeof via.entityId !== "string" ||
      ![
        "must_have",
        "facility_candidate",
        "overnight_candidate",
        "preferred",
        "available_candidate"
      ].includes(via.role) ||
      viaEntityIds.has(via.entityId)
    ) {
      invalid();
    }
    viaEntityIds.add(via.entityId);
  }

  const unavailable = [];
  const accessible = [];
  for (const via of [...sourceProposal.viaCandidates].sort(compareVia)) {
    assertCoordinate(via.coordinate);
    const accessCandidates = canonicalAccessCandidates(
      accessCandidatesByEntity.get(via.entityId) ?? []
    );
    if (accessCandidates.length === 0) {
      unavailable.push({ via, hard: isHardRole(via.role) });
      continue;
    }
    const materialized = accessCandidates.map((candidate) => {
      assertCoordinate(candidate.routingCoordinate);
      return materializeHighlight(via, candidate);
    });
    accessible.push({ via, materialized });
  }

  if (unavailable.some((item) => item.hard) || accessible.length === 0) {
    return deepFreeze({
      policyVersion: POLICY.policyVersion,
      shapes: [],
      unavailable,
      excluded: [],
      searchMetrics: emptyMetrics()
    });
  }

  const hard = accessible.filter((item) => isHardRole(item.via.role));
  const optional = accessible.filter((item) => !isHardRole(item.via.role));
  const optionalSubsets = boundedOptionalSubsets(optional);
  const rawShapes = [];
  const baselineStates = [];
  const metrics = emptyMetrics();
  let exhausted = false;

  for (const optionalSubset of optionalSubsets) {
    if (exhausted) break;
    const selection = [...hard, ...optionalSubset].sort(compareSelectionEntry);
    if (selection.length === 0) continue;
    const assignments = accessAssignments(selection);
    const baselineShapes = evaluateAssignment(
      assignments[0],
      anchor,
      targetRange,
      metrics
    );
    if (baselineShapes.length === 0) break;
    rawShapes.push(...baselineShapes);
    baselineStates.push({
      baseline: baselineShapes[0],
      assignments: assignments.slice(1)
    });
  }

  baselineStates.sort((left, right) =>
    compareShape(left.baseline, right.baseline, targetRange)
  );
  for (const { baseline, assignments } of baselineStates) {
    if (exhausted) break;
    for (const assignment of assignments) {
      if (metrics.searchStates >= POLICY.limits.maximumSearchStates) {
        exhausted = true;
        break;
      }
      const alternatives = evaluateAssignment(
        assignment,
        anchor,
        targetRange,
        metrics
      );
      for (const alternative of alternatives) {
        if (
          materiallyImprovesAccessSelection(alternative, baseline, targetRange)
        ) {
          rawShapes.push(alternative);
          metrics.materialAccessAlternatives += 1;
        }
      }
    }
  }

  const selected = selectMeaningfulShapes(
    rawShapes,
    accessible,
    anchor,
    targetRange,
    metrics
  );
  const shapes = selected.shapes;
  metrics.optionalSubsetStates = optionalSubsets.length;
  metrics.searchExhausted = exhausted ||
    metrics.searchStates >= POLICY.limits.maximumSearchStates;
  metrics.generatedShapes = rawShapes.length;
  metrics.selectedShapes = shapes.length;
  return deepFreeze({
    policyVersion: POLICY.policyVersion,
    shapes,
    unavailable,
    excluded: selected.excluded,
    searchMetrics: metrics
  });
}

export function orderResearchGuidedLoopSelectionV3(anchor, selectedInput) {
  assertCoordinate(anchor);
  if (!Array.isArray(selectedInput) || selectedInput.length === 0) invalid();
  const decorated = selectedInput.map((item) => {
    assertCoordinate(item.routingCoordinate);
    const projected = projectKm(anchor, item.routingCoordinate);
    return {
      item,
      angle: Math.atan2(projected.y, projected.x),
      radius: Math.hypot(projected.x, projected.y)
    };
  }).sort((left, right) =>
    left.angle - right.angle ||
    left.radius - right.radius ||
    compareText(selectionIdentity(left.item), selectionIdentity(right.item))
  );
  const counterclockwise = decorated.map((entry) => entry.item);
  const clockwise = [...counterclockwise].reverse();
  const orderings = [];
  for (const [direction, sequence] of [
    ["counterclockwise", counterclockwise],
    ["clockwise", clockwise]
  ]) {
    for (let rotation = 0; rotation < sequence.length; rotation += 1) {
      orderings.push({
        direction,
        rotation,
        selected: [...sequence.slice(rotation), ...sequence.slice(0, rotation)]
      });
      if (orderings.length >= POLICY.limits.maximumOrderingsPerSelection) {
        return deepFreeze(orderings);
      }
    }
  }
  return deepFreeze(orderings);
}

export const researchGuidedRouteProductShapingInternalsForTesting =
  Object.freeze({
    analyzePreRoutingShapeV3,
    distanceHeuristic: analyzeResearchGuidedDistanceHeuristicV3,
    lowerBoundKm,
    materiallyImprovesAccessSelection,
    corridorKey: deriveResearchGuidedLoopCorridorKeyV3,
    topologyKey: deriveResearchGuidedLoopTopologyKeyV3
  });

function evaluateAssignment(assignment, anchor, targetRange, metrics) {
  const orderings = orderResearchGuidedLoopSelectionV3(anchor, assignment);
  const byTopology = new Map();
  for (const ordering of orderings) {
    if (metrics.searchStates >= POLICY.limits.maximumSearchStates) break;
    metrics.searchStates += 1;
    metrics.orderingsEvaluated += 1;
    const selected = ordering.selected;
    const lowerBound = lowerBoundKm(anchor, selected);
    const distanceHeuristic = analyzeResearchGuidedDistanceHeuristicV3(
      lowerBound,
      targetRange
    );
    const risk = analyzePreRoutingShapeV3(anchor, selected);
    const candidate = {
      selected,
      direction: ordering.direction,
      rawLowerBoundKm: lowerBound,
      lowerBoundKm: roundDistance(lowerBound),
      heuristicRangeKm: distanceHeuristic.rangeKm,
      heuristicState: distanceHeuristic.state,
      targetGapPenalty: distanceHeuristic.targetGapPenalty,
      targetCenterPenalty: distanceHeuristic.targetCenterPenalty,
      riskScore: risk.score,
      riskState: risk.state,
      riskyEntityIds: risk.riskyEntityIds,
      requiredRiskEntityIds: risk.requiredRiskEntityIds,
      optionalCount: selected.filter((item) => !isHardRole(item.role)).length,
      totalPoiToAccessDistanceMeters: roundDistance(selected.reduce(
        (sum, item) =>
          sum + item.trailAccessCandidate.poiToAccessPointDistanceMeters,
        0
      )),
      topologyKey: deriveResearchGuidedLoopTopologyKeyV3(selected)
    };
    const prior = byTopology.get(candidate.topologyKey);
    if (!prior || compareShape(candidate, prior, targetRange) < 0) {
      byTopology.set(candidate.topologyKey, candidate);
    }
  }
  return [...byTopology.values()].sort((left, right) =>
    compareShape(left, right, targetRange)
  );
}

function analyzePreRoutingShapeV3(anchor, selected) {
  const riskyEntityIds = new Set();
  let score = 0;
  for (let index = 0; index < selected.length; index += 1) {
    for (let otherIndex = index + 1; otherIndex < selected.length; otherIndex += 1) {
      const left = selected[index];
      const right = selected[otherIndex];
      const distanceMeters = haversineKm(
        left.routingCoordinate,
        right.routingCoordinate
      ) * 1_000;
      const near = distanceMeters <= POLICY.shape.nearDuplicateAccessMeters;
      const sameSegment =
        left.trailAccessCandidate.sourceTrailSegmentEntityId ===
          right.trailAccessCandidate.sourceTrailSegmentEntityId &&
        distanceMeters <= POLICY.shape.sameMappedSegmentMeters;
      if (near || sameSegment) {
        score += near ? 80 : 55;
        riskyEntityIds.add(left.entityId);
        riskyEntityIds.add(right.entityId);
      }
    }
  }

  if (selected.length === 1) {
    score += 70;
    riskyEntityIds.add(selected[0].entityId);
  } else {
    const projected = selected.map((item) => ({
      item,
      ...projectKm(anchor, item.routingCoordinate)
    }));
    const maximumRadius = Math.max(
      ...projected.map((item) => Math.hypot(item.x, item.y)),
      0.001
    );
    const polygon = [{ x: 0, y: 0 }, ...projected, { x: 0, y: 0 }];
    let doubleArea = 0;
    for (let index = 0; index < polygon.length - 1; index += 1) {
      doubleArea += polygon[index].x * polygon[index + 1].y -
        polygon[index + 1].x * polygon[index].y;
    }
    const areaRatio = Math.abs(doubleArea / 2) / (maximumRadius ** 2);
    const angles = projected.map((item) =>
      normalizedAngle(Math.atan2(item.y, item.x))
    ).sort((left, right) => left - right);
    const angularSpread = minimumContainingArc(angles);
    const radial = angularSpread <=
      POLICY.shape.maximumRadialAngularSpreadDegrees * Math.PI / 180;
    const collinear = areaRatio < POLICY.shape.collinearAreaRatio;
    if (radial || collinear) {
      score += radial ? 65 : 45;
      for (const item of selected) riskyEntityIds.add(item.entityId);
    }
  }

  const requiredRiskEntityIds = selected
    .filter((item) =>
      riskyEntityIds.has(item.entityId) && isHardRole(item.role)
    )
    .map((item) => item.entityId)
    .sort(compareText);
  const orderedRiskyEntityIds = [...riskyEntityIds].sort(compareText);
  return {
    score,
    state: orderedRiskyEntityIds.length === 0
      ? "none"
      : requiredRiskEntityIds.length > 0
        ? "required_mapped_corridor_risk"
        : "pre_routing_backtracking_risk",
    riskyEntityIds: orderedRiskyEntityIds,
    requiredRiskEntityIds
  };
}

function boundedOptionalSubsets(optional) {
  const count = Math.min(
    2 ** optional.length,
    POLICY.limits.maximumOptionalSubsetStates
  );
  const subsets = [];
  for (let mask = 0; mask < count; mask += 1) {
    const subset = optional.filter((_, index) => (mask & (1 << index)) !== 0);
    subsets.push(subset);
  }
  return subsets.sort((left, right) =>
    right.length - left.length ||
    compareText(
      left.map((item) => item.via.entityId).join(":"),
      right.map((item) => item.via.entityId).join(":")
    )
  );
}

function accessAssignments(selection) {
  const initial = selection.map(() => 0);
  const frontier = [initial];
  const queued = new Set([accessAssignmentIndexKey(initial)]);
  const assignments = [];
  let generatedStates = 1;

  while (
    frontier.length > 0 &&
    assignments.length < POLICY.limits.maximumAccessAssignmentsPerSelection
  ) {
    frontier.sort(compareAccessAssignmentIndexes);
    const indexes = frontier.shift();
    assignments.push(indexes.map((accessIndex, selectionIndex) =>
      selection[selectionIndex].materialized[accessIndex]
    ));
    for (let index = 0; index < indexes.length; index += 1) {
      if (indexes[index] + 1 >= selection[index].materialized.length) continue;
      const next = [...indexes];
      next[index] += 1;
      const key = accessAssignmentIndexKey(next);
      if (queued.has(key)) continue;
      if (
        generatedStates >=
          POLICY.limits.maximumAccessAssignmentFrontierStates
      ) {
        continue;
      }
      queued.add(key);
      frontier.push(next);
      generatedStates += 1;
    }
  }
  return assignments;
}

function materiallyImprovesAccessSelection(alternative, baseline, targetRange) {
  if (
    baseline.riskScore - alternative.riskScore >=
      POLICY.accessSelection.minimumRiskImprovement
  ) {
    return true;
  }
  if (targetRange !== null) {
    if (
      baseline.rawLowerBoundKm > targetRange.max &&
      alternative.rawLowerBoundKm <= targetRange.max
    ) {
      return true;
    }
    if (
      distanceHeuristicStateRank(baseline.heuristicState) >
        distanceHeuristicStateRank(alternative.heuristicState)
    ) {
      return true;
    }
    if (
      baseline.targetGapPenalty - alternative.targetGapPenalty >=
        POLICY.accessSelection.minimumNormalizedTargetImprovement ||
      baseline.targetCenterPenalty - alternative.targetCenterPenalty >=
        POLICY.accessSelection.minimumNormalizedTargetImprovement
    ) {
      return true;
    }
  }
  return false;
}

function selectMeaningfulShapes(
  rawShapes,
  accessible,
  anchor,
  targetRange,
  metrics
) {
  const frontier = rawShapes.filter((candidate) =>
    !rawShapes.some((alternative) => {
      if (candidate === alternative) return false;
      metrics.dominanceComparisons += 1;
      if (
        metrics.dominanceComparisons >
          POLICY.limits.maximumDominanceComparisons
      ) {
        invalid();
      }
      return dominatesByRemovingOptional(
        alternative,
        candidate,
        targetRange
      );
    })
  );
  const byTopology = new Map();
  for (const shape of frontier) {
    const prior = byTopology.get(shape.topologyKey);
    if (!prior || compareShape(shape, prior, targetRange) < 0) {
      byTopology.set(shape.topologyKey, shape);
    }
  }
  const byCorridor = new Map();
  for (const shape of byTopology.values()) {
    const corridorKey = deriveResearchGuidedLoopCorridorKeyV3(shape.selected);
    const prior = byCorridor.get(corridorKey);
    if (!prior || compareShape(shape, prior, targetRange) < 0) {
      byCorridor.set(corridorKey, shape);
    }
  }
  const admissible = [...byCorridor.values()].filter((shape) =>
    !isExcludableOptionalShape(shape)
  );
  const shapes = admissible
    .sort((left, right) => compareShape(left, right, targetRange))
    .slice(0, POLICY.limits.maximumProposals)
    .map((shape) => ({
      selected: shape.selected,
      direction: shape.direction,
      lowerBoundKm: shape.lowerBoundKm,
      heuristicRangeKm: shape.heuristicRangeKm,
      heuristicState: shape.heuristicState,
      riskState: shape.riskState,
      riskScore: shape.riskScore,
      riskyEntityIds: shape.riskyEntityIds,
      requiredRiskEntityIds: shape.requiredRiskEntityIds,
      topologyKey: shape.topologyKey,
      removed: removedOptionalRecords(
        shape,
        accessible,
        anchor,
        targetRange
      )
    }));
  const excluded = shapes.length === 0
    ? accessible
      .filter((entry) => !isHardRole(entry.via.role))
      .map((entry) => ({
        candidate: entry.materialized[0],
        code: "optional_removed_for_loop_shape"
      }))
    : [];
  return { shapes, excluded };
}

function dominatesByRemovingOptional(alternative, candidate, targetRange) {
  if (alternative.selected.length >= candidate.selected.length) return false;
  const alternativeHard = alternative.selected
    .filter((item) => isHardRole(item.role))
    .map(selectionIdentity)
    .sort(compareText);
  const candidateHard = candidate.selected
    .filter((item) => isHardRole(item.role))
    .map(selectionIdentity)
    .sort(compareText);
  if (alternativeHard.join(":") !== candidateHard.join(":")) return false;
  const candidateNodes = new Set(candidate.selected.map(selectionIdentity));
  if (!alternative.selected.every((item) =>
    candidateNodes.has(selectionIdentity(item))
  )) {
    return false;
  }
  if (targetRange === null) {
    return candidate.riskScore - alternative.riskScore >=
      POLICY.accessSelection.minimumRiskImprovement;
  }
  const clearsMaximum = candidate.rawLowerBoundKm > targetRange.max &&
    alternative.rawLowerBoundKm <= targetRange.max;
  const materiallyImprovesTarget =
    distanceHeuristicStateRank(candidate.heuristicState) >
      distanceHeuristicStateRank(alternative.heuristicState) ||
    candidate.targetGapPenalty - alternative.targetGapPenalty >=
      POLICY.accessSelection.minimumNormalizedTargetImprovement ||
    candidate.targetCenterPenalty - alternative.targetCenterPenalty >=
      POLICY.accessSelection.minimumNormalizedTargetImprovement;
  const materiallyReducesRisk = candidate.riskScore - alternative.riskScore >=
    POLICY.accessSelection.minimumRiskImprovement;
  const targetDoesNotMateriallyWorsen =
    distanceHeuristicStateRank(alternative.heuristicState) <=
      distanceHeuristicStateRank(candidate.heuristicState) &&
    alternative.targetGapPenalty <= candidate.targetGapPenalty +
      POLICY.accessSelection.minimumNormalizedTargetImprovement &&
    alternative.targetCenterPenalty <= candidate.targetCenterPenalty +
      POLICY.accessSelection.minimumNormalizedTargetImprovement;
  return ((clearsMaximum || materiallyImprovesTarget) &&
      alternative.riskScore <= candidate.riskScore) ||
    (materiallyReducesRisk && targetDoesNotMateriallyWorsen);
}

function removedOptionalRecords(shape, accessible, anchor, targetRange) {
  const selectedIds = new Set(shape.selected.map((item) => item.entityId));
  return accessible
    .filter((entry) =>
      !isHardRole(entry.via.role) && !selectedIds.has(entry.via.entityId)
    )
    .map((entry) => {
      const candidate = entry.materialized[0];
      const conflict = shape.selected.find((selected) => {
        const distanceMeters = haversineKm(
          selected.routingCoordinate,
          candidate.routingCoordinate
        ) * 1_000;
        return distanceMeters <= POLICY.shape.nearDuplicateAccessMeters ||
          (
            selected.trailAccessCandidate.sourceTrailSegmentEntityId ===
              candidate.trailAccessCandidate.sourceTrailSegmentEntityId &&
            distanceMeters <= POLICY.shape.sameMappedSegmentMeters
          );
      });
      if (conflict) {
        const distanceMeters = haversineKm(
          conflict.routingCoordinate,
          candidate.routingCoordinate
        ) * 1_000;
        return {
          candidate,
          code: distanceMeters <= POLICY.shape.nearDuplicateAccessMeters
            ? "optional_near_duplicate_access_candidate"
            : "optional_same_mapped_corridor_risk"
        };
      }
      const withCandidate = orderResearchGuidedLoopSelectionV3(
        anchor,
        [...shape.selected, candidate]
      )[0].selected;
      const withCandidateLowerBound = lowerBoundKm(anchor, withCandidate);
      if (
        targetRange !== null &&
        compareDistanceHeuristics(
          analyzeResearchGuidedDistanceHeuristicV3(
            withCandidateLowerBound,
            targetRange
          ),
          analyzeResearchGuidedDistanceHeuristicV3(
            shape.rawLowerBoundKm,
            targetRange
          )
        ) > 0
      ) {
        return { candidate, code: "optional_removed_for_target_distance" };
      }
      return { candidate, code: "optional_removed_for_loop_shape" };
    });
}

function compareShape(left, right, targetRange) {
  const exactFeasibilityComparison =
    Number(left.rawLowerBoundKm > (targetRange?.max ?? Number.POSITIVE_INFINITY)) -
    Number(right.rawLowerBoundKm > (targetRange?.max ?? Number.POSITIVE_INFINITY));
  if (exactFeasibilityComparison !== 0) return exactFeasibilityComparison;
  const severeRiskComparison = Number(isSevereShapeRisk(left)) -
    Number(isSevereShapeRisk(right));
  if (severeRiskComparison !== 0) return severeRiskComparison;
  if (targetRange !== null) {
    const heuristicStateComparison =
      distanceHeuristicStateRank(left.heuristicState) -
      distanceHeuristicStateRank(right.heuristicState);
    if (heuristicStateComparison !== 0) return heuristicStateComparison;
    const gapComparison = left.targetGapPenalty - right.targetGapPenalty;
    if (Math.abs(gapComparison) > 1e-12) return gapComparison;
  }
  const riskComparison = left.riskScore - right.riskScore;
  if (riskComparison !== 0) return riskComparison;
  if (targetRange !== null) {
    const centerComparison =
      left.targetCenterPenalty - right.targetCenterPenalty;
    if (Math.abs(centerComparison) > 1e-12) return centerComparison;
  }
  return (
    right.optionalCount - left.optionalCount ||
    left.totalPoiToAccessDistanceMeters - right.totalPoiToAccessDistanceMeters ||
    left.lowerBoundKm - right.lowerBoundKm ||
    compareText(selectionOrderKey(left.selected), selectionOrderKey(right.selected))
  );
}

export function deriveResearchGuidedLoopTopologyKeyV3(selected) {
  const nodes = selected.map(selectionIdentity);
  const edges = [];
  let prior = "anchor";
  for (const node of nodes) {
    edges.push([prior, node].sort(compareText).join("~"));
    prior = node;
  }
  edges.push([prior, "anchor"].sort(compareText).join("~"));
  return [
    [...nodes].sort(compareText).join(":"),
    edges.sort(compareText).join(":")
  ].join("|");
}

export function deriveResearchGuidedLoopCorridorKeyV3(selected) {
  const nodes = selected.map((item) => [
    item.role,
    item.entityId,
    item.trailAccessCandidate.sourceTrailSegmentEntityId
  ].join("@"));
  const edges = [];
  let prior = "anchor";
  for (const node of nodes) {
    edges.push([prior, node].sort(compareText).join("~"));
    prior = node;
  }
  edges.push([prior, "anchor"].sort(compareText).join("~"));
  return [
    [...nodes].sort(compareText).join(":"),
    edges.sort(compareText).join(":")
  ].join("|");
}

export function analyzeResearchGuidedDistanceHeuristicV3(
  lowerBound,
  targetRange
) {
  if (!Number.isFinite(lowerBound) || lowerBound < 0) invalid();
  assertTargetRange(targetRange);
  const rawMinimumKm = lowerBound *
    POLICY.distance.heuristicMinimumMultiplier;
  const rawMaximumKm = lowerBound *
    POLICY.distance.heuristicMaximumMultiplier;
  let state;
  if (targetRange === null) {
    state = "target_unspecified";
  } else if (lowerBound > targetRange.max) {
    state = "lower_bound_exceeds_target";
  } else if (rawMaximumKm < targetRange.min) {
    state = "heuristic_range_below_target";
  } else if (rawMinimumKm > targetRange.max) {
    state = "heuristic_range_above_target";
  } else {
    state = "heuristic_range_intersects_target";
  }
  const targetCenter = targetRange === null
    ? null
    : (targetRange.min + targetRange.max) / 2;
  let targetGapPenalty = 0;
  if (targetRange !== null) {
    if (lowerBound > targetRange.max) {
      targetGapPenalty = 1 + (lowerBound - targetRange.max) /
        Math.max(targetCenter, 0.001);
    } else if (rawMaximumKm < targetRange.min) {
      targetGapPenalty = (targetRange.min - rawMaximumKm) /
        Math.max(targetCenter, 0.001);
    } else if (rawMinimumKm > targetRange.max) {
      targetGapPenalty = (rawMinimumKm - targetRange.max) /
        Math.max(targetCenter, 0.001);
    }
  }
  const heuristicCenter = (rawMinimumKm + rawMaximumKm) / 2;
  return {
    rangeKm: {
      min: roundDistance(rawMinimumKm),
      max: roundDistance(rawMaximumKm)
    },
    state,
    targetGapPenalty,
    targetCenterPenalty: targetCenter === null
      ? 0
      : Math.abs(heuristicCenter - targetCenter) /
        Math.max(targetCenter, 0.001)
  };
}

function distanceHeuristicStateRank(state) {
  return {
    target_unspecified: 0,
    heuristic_range_intersects_target: 0,
    heuristic_range_below_target: 1,
    heuristic_range_above_target: 1,
    lower_bound_exceeds_target: 2
  }[state] ?? 3;
}

function compareDistanceHeuristics(left, right) {
  return distanceHeuristicStateRank(left.state) -
      distanceHeuristicStateRank(right.state) ||
    left.targetGapPenalty - right.targetGapPenalty ||
    left.targetCenterPenalty - right.targetCenterPenalty;
}

function isSevereShapeRisk(shape) {
  return shape.riskScore >=
    POLICY.shape.minimumExcludableOptionalRiskScore;
}

function isExcludableOptionalShape(shape) {
  return isSevereShapeRisk(shape) &&
    shape.selected.every((item) => !isHardRole(item.role));
}

function accessAssignmentIndexKey(indexes) {
  return indexes.join(":");
}

function compareAccessAssignmentIndexes(left, right) {
  const leftRank = left.reduce((sum, value) => sum + value, 0);
  const rightRank = right.reduce((sum, value) => sum + value, 0);
  const leftChanges = left.filter((value) => value > 0).length;
  const rightChanges = right.filter((value) => value > 0).length;
  if (leftRank !== rightRank) return leftRank - rightRank;
  if (leftChanges !== rightChanges) return leftChanges - rightChanges;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

function canonicalAccessCandidates(candidates) {
  if (
    !Array.isArray(candidates) ||
    candidates.length > POLICY.limits.maximumAccessCandidatesPerEntity
  ) {
    invalid();
  }
  return [...candidates]
    .sort((left, right) =>
      left.poiToAccessPointDistanceMeters -
        right.poiToAccessPointDistanceMeters ||
      compareText(
        left.sourceTrailSegmentEntityId,
        right.sourceTrailSegmentEntityId
      ) ||
      compareText(left.candidateId, right.candidateId)
    );
}

function lowerBoundKm(anchor, selected) {
  let result = 0;
  let previous = anchor;
  for (const item of selected) {
    assertCoordinate(item.routingCoordinate);
    result += haversineKm(previous, item.routingCoordinate);
    previous = item.routingCoordinate;
  }
  if (selected.length > 0) result += haversineKm(previous, anchor);
  return result;
}

function projectKm(anchor, coordinate) {
  const radians = Math.PI / 180;
  const latitudeKm = 111.195;
  const longitudeKm = latitudeKm * Math.cos(anchor.latitude * radians);
  return {
    x: (coordinate.longitude - anchor.longitude) * longitudeKm,
    y: (coordinate.latitude - anchor.latitude) * latitudeKm
  };
}

function minimumContainingArc(sortedAngles) {
  if (sortedAngles.length <= 1) return 0;
  let largestGap = 0;
  for (let index = 0; index < sortedAngles.length; index += 1) {
    const next = index === sortedAngles.length - 1
      ? sortedAngles[0] + Math.PI * 2
      : sortedAngles[index + 1];
    largestGap = Math.max(largestGap, next - sortedAngles[index]);
  }
  return Math.PI * 2 - largestGap;
}

function normalizedAngle(value) {
  return value < 0 ? value + Math.PI * 2 : value;
}

function haversineKm(start, finish) {
  const earthRadiusKm = 6_371;
  const radians = Math.PI / 180;
  const latitudeDelta = (finish.latitude - start.latitude) * radians;
  const longitudeDelta = (finish.longitude - start.longitude) * radians;
  const startLatitude = start.latitude * radians;
  const finishLatitude = finish.latitude * radians;
  const value =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(startLatitude) * Math.cos(finishLatitude) *
      Math.sin(longitudeDelta / 2) ** 2;
  return earthRadiusKm * 2 *
    Math.atan2(Math.sqrt(value), Math.sqrt(Math.max(0, 1 - value)));
}

function assertTargetRange(value) {
  if (value === null) return;
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== 2 ||
    !Number.isFinite(value.min) ||
    !Number.isFinite(value.max) ||
    value.min < 0 ||
    value.max < value.min
  ) {
    invalid();
  }
}

function assertCoordinate(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !Number.isFinite(value.latitude) ||
    !Number.isFinite(value.longitude) ||
    value.latitude < -90 ||
    value.latitude > 90 ||
    value.longitude < -180 ||
    value.longitude > 180
  ) {
    invalid();
  }
}

function compareSelectionEntry(left, right) {
  return compareVia(left.via, right.via);
}

function compareVia(left, right) {
  return Number(isHardRole(right.role)) - Number(isHardRole(left.role)) ||
    compareText(left.role, right.role) ||
    compareText(left.entityId, right.entityId);
}

function selectionIdentity(item) {
  return [
    item.role,
    item.entityId,
    item.trailAccessCandidate.candidateId
  ].join("@");
}

function selectionOrderKey(selected) {
  return selected.map(selectionIdentity).join(":");
}

function isHardRole(role) {
  return HARD_ROLES.has(role);
}

function emptyMetrics() {
  return {
    searchStates: 0,
    optionalSubsetStates: 0,
    orderingsEvaluated: 0,
    materialAccessAlternatives: 0,
    dominanceComparisons: 0,
    generatedShapes: 0,
    selectedShapes: 0,
    searchExhausted: false
  };
}

function roundDistance(value) {
  return Number(value.toFixed(3));
}

function compareText(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function invalid() {
  throw new TypeError("invalid ResearchGuidedRouteProductShapingV3 input");
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}
