import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import {
  orderResearchGuidedLoopSelectionV3,
  researchGuidedRouteProductShapingInternalsForTesting,
  shapeResearchGuidedLoopSourceProposalV3
} from "../src/routeResearch/researchGuidedRouteProductShapingV3.js";
import {
  RESEARCH_GUIDED_ROUTE_PRODUCT_SHAPING_POLICY_V3_1
} from "../src/routeResearch/researchGuidedRouteProductShapingPolicyV3_1.js";

const POLICY = RESEARCH_GUIDED_ROUTE_PRODUCT_SHAPING_POLICY_V3_1;

describe("research-guided route product shaping v3", () => {
  it("preserves every hard role and never lets preferences displace them", () => {
    const result = shape({
      targetRange: { min: 3, max: 3 },
      vias: [
        via("must", "must_have", { latitude: 0, longitude: 0.01 }),
        via("facility", "facility_candidate", {
          latitude: 0.01,
          longitude: 0
        }),
        via("overnight", "overnight_candidate", {
          latitude: -0.01,
          longitude: 0
        }),
        via("preference", "preferred", {
          latitude: 0,
          longitude: 0.2
        })
      ]
    });

    assert.equal(result.policyVersion, POLICY.policyVersion);
    assert(result.shapes.length > 0);
    for (const shaped of result.shapes) {
      assert.deepEqual(
        shaped.selected
          .filter((item) => isHard(item.role))
          .map((item) => item.entityId)
          .sort(),
        ["facility", "must", "overnight"]
      );
    }
    assert(result.shapes.some((item) =>
      item.removed.some((removed) =>
        removed.candidate.entityId === "preference" &&
        removed.code === "optional_removed_for_target_distance"
      )
    ));
  });

  it("fails a missing hard access point closed with a typed unavailable record", () => {
    const result = shape({
      vias: [
        via("must", "must_have", { latitude: 0, longitude: 0.01 }),
        via("preference", "preferred", { latitude: 0.01, longitude: 0 })
      ],
      accessByEntity: new Map([
        ["preference", [access("preference", 0, {
          latitude: 0.01,
          longitude: 0
        })]]
      ])
    });

    assert.deepEqual(result.shapes, []);
    assert.equal(result.unavailable.length, 1);
    assert.equal(result.unavailable[0].via.entityId, "must");
    assert.equal(result.unavailable[0].hard, true);
    assert.equal(result.policyVersion, POLICY.policyVersion);
  });

  it("evaluates clockwise and counterclockwise angular order, then dedupes reversal", async () => {
    const fixture = await topologyFixture();
    const selected = fixture.topologies.triangle.map((coordinate, index) =>
      materialized(via(`triangle-${index}`, "must_have", coordinate),
        access(`triangle-${index}`, 0, coordinate))
    );
    const orderings = orderResearchGuidedLoopSelectionV3(
      fixture.anchor,
      selected
    );

    assert.deepEqual(
      [...new Set(orderings.map((item) => item.direction))],
      ["counterclockwise", "clockwise"]
    );
    const counterclockwise = orderings.find((item) =>
      item.direction === "counterclockwise" && item.rotation === 0
    );
    const clockwise = orderings.find((item) =>
      item.direction === "clockwise" && item.rotation === 0
    );
    assert.deepEqual(
      clockwise.selected.map((item) => item.entityId),
      [...counterclockwise.selected].reverse().map((item) => item.entityId)
    );
    assert(orderings.length <= POLICY.limits.maximumOrderingsPerSelection);

    const result = shape({
      anchor: fixture.anchor,
      vias: fixture.topologies.triangle.map((coordinate, index) =>
        via(`triangle-${index}`, "must_have", coordinate)
      )
    });
    assert.equal(result.searchMetrics.orderingsEvaluated >= 2, true);
    assert.equal(result.shapes.length > 1, true);
    assert.equal(
      new Set(result.shapes.map((item) => item.topologyKey)).size,
      result.shapes.length
    );
    assert.equal(
      new Set(result.shapes.map((item) =>
        researchGuidedRouteProductShapingInternalsForTesting
          .corridorKey(item.selected)
      )).size,
      result.shapes.length
    );

    const preferred = materialized(
      via("role-sensitive", "preferred", fixture.topologies.triangle[0]),
      access("role-sensitive", 0, fixture.topologies.triangle[0])
    );
    const required = { ...preferred, role: "must_have" };
    assert.notEqual(
      researchGuidedRouteProductShapingInternalsForTesting
        .topologyKey([preferred]),
      researchGuidedRouteProductShapingInternalsForTesting
        .topologyKey([required])
    );
  });

  it("flags radial, collinear and same-corridor risk before provider routing", async () => {
    const fixture = await topologyFixture();
    const radial = shape({
      anchor: fixture.anchor,
      vias: fixture.topologies.radial.map((coordinate, index) =>
        via(`radial-${index}`, "must_have", coordinate)
      )
    });
    assert.equal(radial.shapes[0].riskState, "required_mapped_corridor_risk");
    assert.deepEqual(
      radial.shapes[0].requiredRiskEntityIds,
      ["radial-0", "radial-1", "radial-2"]
    );

    const corridorVias = [
      via("corridor-a", "must_have", { latitude: 0, longitude: 0.01 }),
      via("corridor-b", "must_have", { latitude: 0, longitude: 0.011 })
    ];
    const corridorAccess = automaticAccess(corridorVias);
    for (const candidates of corridorAccess.values()) {
      candidates[0].sourceTrailSegmentEntityId = "same-corridor";
    }
    const corridor = shape({ vias: corridorVias, accessByEntity: corridorAccess });
    assert.equal(corridor.shapes[0].riskState, "required_mapped_corridor_risk");

    const optionalRadial = shape({
      vias: [via("optional", "preferred", {
        latitude: 0,
        longitude: 0.01
      })]
    });
    assert.deepEqual(optionalRadial.shapes, []);
    assert.deepEqual(optionalRadial.excluded.map((item) => [
      item.candidate.entityId,
      item.code
    ]), [["optional", "optional_removed_for_loop_shape"]]);
  });

  it("retains useful shaping points when no target exists and removes harmful optional detours", async () => {
    const fixture = await topologyFixture();
    const useful = shape({
      anchor: fixture.anchor,
      targetRange: null,
      vias: fixture.topologies.triangle.map((coordinate, index) =>
        via(`useful-${index}`, index === 0 ? "must_have" : "preferred", coordinate)
      )
    });
    assert.equal(useful.shapes[0].selected.length, 3);
    assert.equal(useful.shapes[0].riskState, "none");

    const harmful = shape({
      targetRange: { min: 2, max: 2 },
      vias: [
        via("required", "must_have", { latitude: 0, longitude: 0.006 }),
        via("detour", "preferred", { latitude: 0, longitude: 0.08 })
      ]
    });
    assert.equal(harmful.shapes[0].selected.some(
      (item) => item.entityId === "required"
    ), true);
    assert.equal(harmful.shapes[0].selected.some(
      (item) => item.entityId === "detour"
    ), false);
  });

  it("only admits a farther access candidate when it materially improves target fit", () => {
    const targetVia = via("target", "must_have", {
      latitude: 0,
      longitude: 0.02
    });
    const improved = shape({
      targetRange: { min: 8, max: 8 },
      vias: [targetVia],
      accessByEntity: new Map([["target", [
        access("target", 0, { latitude: 0, longitude: 0.02 }, 10),
        access("target", 1, { latitude: 0, longitude: 0.025 }, 20)
      ]]])
    });
    assert(improved.shapes.some((item) =>
      item.selected[0].trailAccessCandidate.candidateId === "access-target-1"
    ));
    assert.equal(improved.searchMetrics.materialAccessAlternatives, 1);

    const noImprovement = shape({
      targetRange: null,
      vias: [targetVia],
      accessByEntity: new Map([["target", [
        access("target", 0, { latitude: 0, longitude: 0.02 }, 10),
        access("target", 1, { latitude: 0, longitude: 0.025 }, 20)
      ]]])
    });
    assert.equal(noImprovement.shapes.some((item) =>
      item.selected[0].trailAccessCandidate.candidateId === "access-target-1"
    ), false);

    const cosmetic = shape({
      targetRange: null,
      vias: [targetVia],
      accessByEntity: new Map([["target", [
        access("target", 0, { latitude: 0, longitude: 0.02 }, 10),
        access("target", 1, { latitude: 0, longitude: 0.02 }, 10)
      ]]])
    });
    assert.deepEqual(
      cosmetic.shapes.map((item) =>
        item.selected[0].trailAccessCandidate.candidateId
      ),
      ["access-target-0"]
    );

    const boundaryVia = via("boundary-access", "must_have", {
      latitude: 0,
      longitude: 0.01
    });
    const boundaryBaseline = materialized(
      boundaryVia,
      access("boundary-access", 0, boundaryVia.coordinate, 10)
    );
    const exactBoundary = researchGuidedRouteProductShapingInternalsForTesting
      .lowerBoundKm(
        { latitude: 0, longitude: 0 },
        [boundaryBaseline]
      );
    assert(Number(exactBoundary.toFixed(3)) > exactBoundary);
    const roundingOnly = shape({
      targetRange: { min: exactBoundary, max: exactBoundary },
      vias: [boundaryVia],
      accessByEntity: new Map([["boundary-access", [
        access("boundary-access", 0, boundaryVia.coordinate, 10),
        access("boundary-access", 1, {
          latitude: 0,
          longitude: 0.009996
        }, 20)
      ]]])
    });
    assert.deepEqual(
      roundingOnly.shapes.map((item) =>
        item.selected[0].trailAccessCandidate.candidateId
      ),
      ["access-boundary-access-0"]
    );
  });

  it("uses typed lower and upper heuristic ranges without claiming routed distance", () => {
    const analyze = researchGuidedRouteProductShapingInternalsForTesting
      .distanceHeuristic;
    const intersects = analyze(10, { min: 15, max: 15 });
    assert.deepEqual(intersects.rangeKm, { min: 11.5, max: 16.5 });
    assert.equal(intersects.state, "heuristic_range_intersects_target");
    assert.equal(Object.hasOwn(intersects, "routeDistanceKm"), false);
    assert.equal(Object.hasOwn(intersects, "verified"), false);

    assert.equal(
      analyze(5, { min: 15, max: 15 }).state,
      "heuristic_range_below_target"
    );
    assert.equal(
      analyze(14, { min: 15, max: 15 }).state,
      "heuristic_range_above_target"
    );
    assert.equal(
      analyze(15, { min: 15, max: 15 }).state,
      "heuristic_range_above_target"
    );
    assert.equal(
      analyze(15.000001, { min: 15, max: 15 }).state,
      "lower_bound_exceeds_target"
    );
  });

  it("explores bounded multi-point access assignments and keeps exact evidence coordinates", () => {
    const anchor = { latitude: 47.2868, longitude: 11.3997 };
    const vias = [
      via("viewpoint-a", "must_have", {
        latitude: 47.2875,
        longitude: 11.4001
      }),
      via("viewpoint-b", "must_have", {
        latitude: 47.2882,
        longitude: 11.4005
      }),
      via("viewpoint-c", "must_have", {
        latitude: 47.2889,
        longitude: 11.4009
      })
    ];
    const alternatives = [
      { latitude: 47.2877, longitude: 11.3997 },
      { latitude: 47.2880, longitude: 11.4010 },
      { latitude: 47.2891, longitude: 11.4005 }
    ];
    const accessByEntity = new Map(vias.map((item, index) => [
      item.entityId,
      [
        accessForVia(item, 0, item.coordinate, 5, "shared-corridor"),
        accessForVia(
          item,
          1,
          alternatives[index],
          45,
          `distinct-corridor-${index}`
        )
      ]
    ]));
    const result = shape({
      anchor,
      targetRange: { min: 0.4, max: 1.2 },
      vias,
      accessByEntity
    });
    const multiAlternative = result.shapes.find((item) =>
      item.selected.filter((selected) =>
        selected.trailAccessCandidate.candidateId.endsWith("-1")
      ).length >= 2
    );

    assert(multiAlternative);
    assert.equal(multiAlternative.riskScore < 45, true);
    for (const selected of multiAlternative.selected) {
      assert.deepEqual(
        selected.evidenceCoordinate,
        vias.find((item) => item.entityId === selected.entityId).coordinate
      );
      assert.deepEqual(
        selected.trailAccessCandidate.evidenceCoordinate,
        selected.evidenceCoordinate
      );
    }
    assert(result.searchMetrics.searchStates <=
      POLICY.limits.maximumSearchStates);
  });

  it("regresses the recorded V3 failures without converting history into provider proof", async () => {
    const receipt = await v3ProofReceipt();
    const brocken = receipt.cases.find((item) =>
      item.caseId === "case-04-harz-brocken-must-have-landmark"
    );
    assert.equal(brocken.selectedRoute.distanceKm, 23.799);
    assert.equal(brocken.selectedRoute.targetDeviationRatio, 0.5866);
    assert.equal(brocken.selectedRoute.maximumSnapMeters, 41.9);
    assert.equal(brocken.selectedRoute.waypointsReached, 3);
    assert.equal(brocken.selectedRoute.waypointCount, 3);

    const innsbruck = receipt.cases.find((item) =>
      item.caseId === "case-07-innsbruck-viewpoint-loop"
    );
    assert.deepEqual(
      innsbruck.observedRoutes.map((item) => [
        item.distanceKm,
        item.maximumSnapMeters,
        item.waypointsReached,
        item.waypointCount
      ]),
      [[21.201, 427.6, 0, 3], [21.29, 441.1, 1, 3]]
    );

    const survivor = receipt.cases.find((item) =>
      item.caseId === "case-15-partial-provider-failure-survivor"
    );
    assert.deepEqual(
      survivor.observedRoutes.map((item) => item.backtrackingRatio),
      [0.7311, 0.6552]
    );
    const fixture = await topologyFixture();
    const blockedRadial = shape({
      anchor: fixture.anchor,
      targetRange: { min: 10.8, max: 13.2 },
      vias: fixture.topologies.radial.map((coordinate, index) =>
        via(`controlled-${index}`, "preferred", coordinate)
      )
    });
    assert.deepEqual(blockedRadial.shapes, []);
    assert.equal(blockedRadial.excluded.length, 3);

    const requiredRadial = shape({
      anchor: fixture.anchor,
      targetRange: { min: 10.8, max: 13.2 },
      vias: fixture.topologies.radial.map((coordinate, index) =>
        via(`required-${index}`, "must_have", coordinate)
      )
    });
    assert(requiredRadial.shapes.length > 0);
    assert.equal(
      requiredRadial.shapes[0].riskState,
      "required_mapped_corridor_risk"
    );

    const easy = receipt.cases.find((item) =>
      item.caseId === "case-08-innsbruck-easy-conservative-loop"
    );
    assert.equal(easy.routeMetricsObserved, false);
    assert.deepEqual(easy.failureReasons, [
      "routing_rate_limited",
      "provider_batch_stopped"
    ]);
  });

  it("treats the exact lower-bound target edge as admissible and exposes impossible hard detours", () => {
    const required = via("required", "must_have", {
      latitude: 0,
      longitude: 0.01
    });
    const selected = materialized(
      required,
      access("required", 0, required.coordinate)
    );
    const lowerBound = researchGuidedRouteProductShapingInternalsForTesting
      .lowerBoundKm({ latitude: 0, longitude: 0 }, [selected]);
    const boundary = shape({
      targetRange: { min: lowerBound, max: lowerBound },
      vias: [required]
    });
    assert.equal(boundary.shapes.length, 1);
    assert.equal(boundary.shapes[0].lowerBoundKm, Number(lowerBound.toFixed(3)));

    const impossible = shape({
      targetRange: { min: 0.1, max: 0.1 },
      vias: [required]
    });
    assert.equal(impossible.shapes[0].selected[0].entityId, "required");
    assert(impossible.shapes[0].lowerBoundKm > 0.115);
  });

  it("is input-order independent, meaningfully diverse, and bounded at maximum complexity", async () => {
    const fixture = await topologyFixture();
    const vias = fixture.topologies.spread.map((coordinate, index) =>
      via(`spread-${index}`, index === 0 ? "must_have" : "preferred", coordinate)
    );
    const accessByEntity = automaticAccess(vias, 3);
    const first = shape({ anchor: fixture.anchor, vias, accessByEntity });
    const reversedAccess = new Map(
      [...accessByEntity.entries()].reverse().map(([entityId, candidates]) =>
        [entityId, [...candidates].reverse()]
      )
    );
    const second = shape({
      anchor: fixture.anchor,
      vias: [...vias].reverse(),
      accessByEntity: reversedAccess
    });

    assert.deepEqual(shapeSignature(first), shapeSignature(second));
    assert(first.shapes.length > 1);
    assert.equal(
      new Set(first.shapes.map((item) => item.topologyKey)).size,
      first.shapes.length
    );
    assert(first.searchMetrics.searchStates <=
      POLICY.limits.maximumSearchStates);
    assert(first.searchMetrics.dominanceComparisons <=
      POLICY.limits.maximumDominanceComparisons);
    assert(first.searchMetrics.optionalSubsetStates <=
      POLICY.limits.maximumOptionalSubsetStates);
    assert(first.shapes.length <= POLICY.limits.maximumProposals);
    assert(first.shapes.every((item) =>
      item.selected.length <=
        POLICY.limits.maximumSelectedHighlightsPerProposal
    ));

    const allOptional = vias.map((item) => ({
      ...item,
      role: "preferred",
      selectionReasons: ["preferred"]
    }));
    const maximumSubsets = shape({
      anchor: fixture.anchor,
      vias: allOptional,
      accessByEntity: automaticAccess(allOptional, 3)
    });
    assert.equal(
      maximumSubsets.searchMetrics.optionalSubsetStates,
      POLICY.limits.maximumOptionalSubsetStates
    );
    assert.equal(
      maximumSubsets.searchMetrics.searchStates,
      POLICY.limits.maximumSearchStates
    );
    assert.equal(maximumSubsets.searchMetrics.searchExhausted, true);
    assert(maximumSubsets.searchMetrics.dominanceComparisons <=
      POLICY.limits.maximumDominanceComparisons);
  });

  it("fails malformed coordinates closed and owns no random, time, network or global state", async () => {
    assert.throws(() => shape({
      anchor: { latitude: 91, longitude: 0 },
      vias: [via("bad", "must_have", { latitude: 0, longitude: 0 })]
    }), /invalid ResearchGuidedRouteProductShapingV3 input/);
    assert.throws(() => shape({
      vias: [via("bad", "must_have", { latitude: 0, longitude: 0 })],
      accessByEntity: new Map([["bad", [access("bad", 0, {
        latitude: 0,
        longitude: 181
      })]]])
    }), /invalid ResearchGuidedRouteProductShapingV3 input/);
    const excessiveVias = Array.from({ length: 6 }, (_, index) =>
      via(`excess-${index}`, "preferred", {
        latitude: index * 0.001,
        longitude: index * 0.001
      })
    );
    assert.throws(
      () => shape({ vias: excessiveVias }),
      /invalid ResearchGuidedRouteProductShapingV3 input/
    );
    const boundedVia = via("bounded", "must_have", {
      latitude: 0,
      longitude: 0.01
    });
    assert.throws(() => shape({
      vias: [boundedVia],
      accessByEntity: automaticAccess([boundedVia], 4)
    }), /invalid ResearchGuidedRouteProductShapingV3 input/);

    const source = await readFile(new URL(
      "../src/routeResearch/researchGuidedRouteProductShapingV3.js",
      import.meta.url
    ), "utf8");
    for (const forbidden of [
      "Date.now(",
      "Math.random(",
      "fetch(",
      "process.env",
      "GraphHopper",
      "PostGIS",
      "http://",
      "https://"
    ]) {
      assert.equal(source.includes(forbidden), false, forbidden);
    }
    assert.equal(Object.isFrozen(POLICY), true);
    assert.equal(Object.isFrozen(POLICY.limits), true);
  });
});

function shape({
  anchor = { latitude: 0, longitude: 0 },
  targetRange = null,
  vias,
  accessByEntity = automaticAccess(vias)
}) {
  return shapeResearchGuidedLoopSourceProposalV3({
    anchor,
    targetRange,
    sourceProposal: {
      proposalId: "synthetic-source-proposal",
      routeType: "loop",
      viaCandidates: vias
    },
    accessCandidatesByEntity: accessByEntity,
    materializeHighlight: materialized
  });
}

function via(entityId, role, coordinate) {
  return {
    entityId,
    highlightCategory: "synthetic_highlight",
    role,
    coordinate,
    evidenceClaimIds: [`claim-${entityId}`],
    selectionReasons: [role],
    requiredVerification: ["real_routing_required"],
    knownLimitations: ["synthetic_evidence_only"]
  };
}

function access(entityId, index, routingCoordinate, distance = index + 1) {
  return {
    candidateId: `access-${entityId}-${index}`,
    originalHighlightEntityId: entityId,
    highlightCategory: "synthetic_highlight",
    evidenceCoordinate: routingCoordinate,
    routingCoordinate,
    sourceTrailSegmentEntityId: `segment-${entityId}-${index}`,
    sourceTrailCategoryEvidenceClaimIds: [`trail-claim-${entityId}-${index}`],
    poiToAccessPointDistanceMeters: distance,
    knownLimitations: ["mapped_trail_only"],
    requiredVerification: ["provider_routing_required"]
  };
}

function accessForVia(
  item,
  index,
  routingCoordinate,
  distance,
  sourceTrailSegmentEntityId
) {
  return {
    ...access(item.entityId, index, routingCoordinate, distance),
    evidenceCoordinate: item.coordinate,
    sourceTrailSegmentEntityId
  };
}

function automaticAccess(vias, count = 1) {
  return new Map(vias.map((item) => [
    item.entityId,
    Array.from({ length: count }, (_, index) => access(
      item.entityId,
      index,
      {
        latitude: item.coordinate.latitude + index * 0.0001,
        longitude: item.coordinate.longitude + index * 0.0001
      },
      index + 1
    ))
  ]));
}

function materialized(item, candidate) {
  return {
    entityId: item.entityId,
    highlightCategory: item.highlightCategory,
    role: item.role,
    evidenceCoordinate: item.coordinate,
    routingCoordinate: candidate.routingCoordinate,
    trailAccessCandidate: candidate,
    evidenceClaimIds: item.evidenceClaimIds,
    selectionReasons: item.selectionReasons,
    requiredVerification: item.requiredVerification,
    knownLimitations: item.knownLimitations
  };
}

function shapeSignature(result) {
  return result.shapes.map((item) => ({
    selected: item.selected.map((candidate) => [
      candidate.entityId,
      candidate.trailAccessCandidate.candidateId
    ]),
    riskState: item.riskState,
    topologyKey: item.topologyKey
  }));
}

function isHard(role) {
  return ["must_have", "facility_candidate", "overnight_candidate"]
    .includes(role);
}

async function topologyFixture() {
  return JSON.parse(await readFile(new URL(
    "./fixtures/researchGuidedRouteProductShapingV3.json",
    import.meta.url
  ), "utf8"));
}

async function v3ProofReceipt() {
  return JSON.parse(await readFile(new URL(
    "../../docs/release/OUTDOOR_ADVENTURE_TARGETED_LIVE_ROUTE_QUALITY_PROOF_V3.summary.json",
    import.meta.url
  ), "utf8"));
}
