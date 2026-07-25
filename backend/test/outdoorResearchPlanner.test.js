import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import {
  ENTITY_CATEGORIES,
  EVIDENCE_PREDICATES,
  RESEARCH_OPERATION_TYPES,
  SOURCE_CATEGORIES
} from "../src/outdoorResearch/contracts.js";
import {
  OutdoorResearchPlannerError,
  planOutdoorResearchV1,
  validateResearchPlannerCapabilitiesV1
} from "../src/outdoorResearch/researchPlanner.js";
import {
  RESEARCH_PLANNER_GAP_CODES_V1
} from "../src/outdoorResearch/researchPlannerPolicy.js";
import {
  validateAdventureResearchIntentV1,
  validateResearchPlanV1
} from "../src/outdoorResearch/validation.js";
import {
  completeAdventureResearchIntent,
  minimalAdventureResearchIntent,
  OUTDOOR_RESEARCH_TEST_IDS
} from "./outdoorResearchTestSupport.js";

const SECOND_REGION_ID = "88888888-8888-4888-8888-888888888888";
const UNSUPPORTED_REGION_ID = "99999999-9999-4999-8999-999999999999";
const HIGH_STAKES_PREDICATES = new Set([
  "public_access",
  "access_restriction",
  "current_opening",
  "seasonal_opening",
  "overnight_permission",
  "bookability",
  "drinking_water_availability",
  "closure_status"
]);
const OFFICIAL_SOURCES = new Set(["official_authority", "official_operator"]);

function completeCapabilities(overrides = {}) {
  return {
    supportedRegionIds: [OUTDOOR_RESEARCH_TEST_IDS.region, SECOND_REGION_ID],
    availableSourceCategories: [...SOURCE_CATEGORIES],
    supportedEvidencePredicates: [...EVIDENCE_PREDICATES],
    enabledOperationTypes: [...RESEARCH_OPERATION_TYPES],
    ...overrides
  };
}

function resolvedIntent(overrides = {}) {
  return completeAdventureResearchIntent({
    distanceRangeKm: null,
    durationRangeMinutes: null,
    maximumElevationGainMeters: null,
    maximumTechnicalDifficulty: null,
    mustHaveExperiences: [],
    preferredExperiences: [],
    avoidedExperiences: [],
    requiredFacilities: [],
    dateOrSeason: null,
    ...overrides
  });
}

describe("outdoor research planner v1 validation and bounds", () => {
  it("validates intent before use and returns only a bounded safe error", () => {
    const invalid = { ...resolvedIntent(), originalPrompt: "must never be copied" };
    assert.throws(
      () => planOutdoorResearchV1(invalid, completeCapabilities()),
      (error) => {
        assert.equal(error instanceof OutdoorResearchPlannerError, true);
        assert.equal(error.code, "invalid_intent");
        assert.equal(error.message, "Outdoor research intent is invalid.");
        assert.equal(error.message.includes("originalPrompt"), false);
        assert.equal(error.message.length < 80, true);
        return true;
      }
    );
  });

  it("rejects malformed, unknown, duplicate and excessive capability fields", () => {
    for (const capabilities of [
      null,
      [],
      { providerUrl: "forbidden" },
      { availableSourceCategories: ["not_a_source"] },
      { availableSourceCategories: ["official_authority", "official_authority"] },
      {
        supportedRegionIds: Array.from(
          { length: 33 },
          (_, index) => `10000000-0000-4000-8000-${String(index).padStart(12, "0")}`
        )
      }
    ]) {
      assert.throws(
        () => validateResearchPlannerCapabilitiesV1(capabilities),
        (error) => error instanceof OutdoorResearchPlannerError &&
          error.code === "invalid_capabilities" &&
          error.message === "Outdoor research capabilities are invalid."
      );
    }
  });

  it("treats missing capability fields as unavailable and fails closed", () => {
    const result = planOutdoorResearchV1(resolvedIntent(), {});
    assert.equal(result.state, "unsupported");
    assert.deepEqual(result.planningGaps.map((gap) => gap.code), ["unsupported_region"]);
  });

  it("validates every generated ready plan and keeps it within 24 operations", () => {
    const result = planOutdoorResearchV1(maximumIntent(), completeCapabilities());
    assert.equal(result.state, "ready");
    assert.deepEqual(validateResearchPlanV1(result.plan), result.plan);
    assert.equal(result.plan.operations.length <= 24, true);
    assert.equal(JSON.stringify(result.plan).length < 64 * 1_024, true);
  });

  it("returns deeply immutable capabilities, plans, gaps and clarification results", () => {
    const capabilities = validateResearchPlannerCapabilitiesV1(completeCapabilities());
    assertDeeplyFrozen(capabilities);
    const ready = planOutdoorResearchV1(resolvedIntent({
      preferredExperiences: ["viewpoint"],
      avoidedExperiences: ["major_roads"]
    }), capabilities);
    assertDeeplyFrozen(ready);
    const clarification = planOutdoorResearchV1(minimalAdventureResearchIntent(), capabilities);
    assertDeeplyFrozen(clarification);
  });

  it("preserves the complete validated execution intent without losing constraints", () => {
    const intent = resolvedIntent({
      activity: "trail_running",
      geographicAnchor: {
        state: "resolved",
        name: "Innsbruck",
        coordinate: { latitude: 47.2692, longitude: 11.4041 },
        regionEntityId: SECOND_REGION_ID
      },
      routeType: "point_to_point",
      maximumElevationGainMeters: 950,
      maximumTechnicalDifficulty: "mountain_hiking",
      mustHaveExperiences: [{ experience: "viewpoint", minimumCount: 2 }],
      avoidedExperiences: ["exposed_trails"],
      requiredFacilities: ["lunch_hut", "drinking_water"],
      dateOrSeason: { kind: "date", date: "2026-09-15" },
      overnightRequirements: {
        required: true,
        nights: 2,
        allowedAccommodationTypes: ["alpine_hut", "official_campsite"]
      }
    });
    const result = planOutdoorResearchV1(intent, completeCapabilities());
    const validated = normalizedIntentExpectation(intent);

    assert.equal(result.state, "ready");
    assert.deepEqual(result.normalizedIntent, validated);
    assert.deepEqual(result.normalizedIntent.geographicAnchor, intent.geographicAnchor);
    assert.equal(result.normalizedIntent.activity, "trail_running");
    assert.equal(result.normalizedIntent.routeType, "point_to_point");
    assert.deepEqual(result.normalizedIntent.dateOrSeason, {
      kind: "date",
      date: "2026-09-15"
    });
    assert.deepEqual(result.normalizedIntent.mustHaveExperiences, [
      { experience: "viewpoint", minimumCount: 2 }
    ]);
    assert.deepEqual(result.normalizedIntent.overnightRequirements, {
      required: true,
      nights: 2,
      allowedAccommodationTypes: ["alpine_hut", "official_campsite"]
    });
    assert.equal(result.normalizedIntent.maximumElevationGainMeters, 950);
    assert.equal(result.normalizedIntent.maximumTechnicalDifficulty, "mountain_hiking");
    assert.deepEqual(result.normalizedIntent.avoidedExperiences, ["exposed_trails"]);
    assert.deepEqual(result.normalizedIntent.requiredFacilities, [
      "drinking_water",
      "lunch_hut"
    ]);
    assertDeeplyFrozen(result.normalizedIntent);
  });

  it("preserves an exact season independently of an exact date", () => {
    const intent = resolvedIntent({
      dateOrSeason: { kind: "season", season: "winter", year: 2027 }
    });
    const result = planOutdoorResearchV1(intent, completeCapabilities());
    assert.deepEqual(result.normalizedIntent.dateOrSeason, {
      kind: "season",
      season: "winter",
      year: 2027
    });
    assertDeeplyFrozen(result.normalizedIntent.dateOrSeason);
  });
});

describe("outdoor research planner v1 determinism", () => {
  it("produces byte-for-byte equivalent output for the same input", () => {
    const intent = resolvedIntent({
      mustHaveExperiences: [
        { experience: "waterfall", minimumCount: 1 },
        { experience: "viewpoint", minimumCount: 2 }
      ],
      requiredFacilities: ["lunch_hut"],
      dateOrSeason: { kind: "season", season: "summer", year: 2026 }
    });
    const first = planOutdoorResearchV1(intent, completeCapabilities());
    const second = planOutdoorResearchV1(intent, completeCapabilities());
    assert.equal(JSON.stringify(first), JSON.stringify(second));
  });

  it("ignores object key ordering and semantically unordered intent arrays", () => {
    const intent = resolvedIntent({
      mustHaveExperiences: [
        { experience: "viewpoint", minimumCount: 2 },
        { experience: "waterfall", minimumCount: 1 }
      ],
      preferredExperiences: ["lake", "peak"],
      avoidedExperiences: ["technical_terrain", "steep_climbs"],
      requiredFacilities: ["emergency_shelter", "lunch_hut"]
    });
    const shuffled = {
      ...Object.fromEntries(Object.entries(intent).reverse()),
      mustHaveExperiences: [...intent.mustHaveExperiences].reverse(),
      preferredExperiences: [...intent.preferredExperiences].reverse(),
      avoidedExperiences: [...intent.avoidedExperiences].reverse(),
      requiredFacilities: [...intent.requiredFacilities].reverse()
    };
    const capabilities = completeCapabilities();
    const shuffledCapabilities = {
      ...Object.fromEntries(Object.entries(capabilities).reverse()),
      supportedRegionIds: [...capabilities.supportedRegionIds].reverse(),
      availableSourceCategories: [...capabilities.availableSourceCategories].reverse(),
      supportedEvidencePredicates: [...capabilities.supportedEvidencePredicates].reverse(),
      enabledOperationTypes: [...capabilities.enabledOperationTypes].reverse()
    };
    assert.equal(
      JSON.stringify(planOutdoorResearchV1(intent, capabilities)),
      JSON.stringify(planOutdoorResearchV1(shuffled, shuffledCapabilities))
    );
  });

  it("keeps deterministic operation IDs, ordering and duplicate-free operations", () => {
    const result = planOutdoorResearchV1(resolvedIntent({
      mustHaveExperiences: [
        { experience: "viewpoint", minimumCount: 1 },
        { experience: "waterfall", minimumCount: 1 }
      ],
      preferredExperiences: ["viewpoint", "waterfall"],
      requiredFacilities: ["lunch_hut"],
      overnightRequirements: {
        required: true,
        nights: 1,
        allowedAccommodationTypes: ["alpine_hut"]
      },
      dateOrSeason: { kind: "date", date: "2026-08-10" }
    }), completeCapabilities());
    const ids = result.plan.operations.map((operation) => operation.operationId);
    assert.deepEqual(ids, ids.map((id, index) =>
      `op_${String(index + 1).padStart(2, "0")}_${result.plan.operations[index].operationType}`
    ));
    assert.equal(new Set(ids).size, ids.length);
    assert.equal(new Set(result.plan.operations.map(operationSignature)).size, ids.length);
    assert.deepEqual(
      result.plan.operations.map((operation) => operation.operationType),
      [...result.plan.operations]
        .sort(compareByDocumentedOperationOrder)
        .map((operation) => operation.operationType)
    );
  });

  it("contains no timestamps, random identifiers, prompts or executable/provider fields", () => {
    const result = planOutdoorResearchV1(resolvedIntent({
      preferredExperiences: ["viewpoint"],
      requiredFacilities: ["lunch_hut"]
    }), completeCapabilities());
    const serialized = JSON.stringify(result);
    for (const forbidden of [
      "providerUrl",
      "sql",
      "shellCommand",
      "routeGeometry",
      "originalPrompt",
      "generatedAt",
      "http://",
      "https://"
    ]) {
      assert.equal(serialized.includes(forbidden), false);
    }
    assert.equal(/\d{4}-\d{2}-\d{2}T/.test(serialized), false);
    assert.equal(/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i
      .test(JSON.stringify(result.plan)), false);
  });
});

describe("outdoor research planner v1 clarification and coverage", () => {
  it("returns validated clarification fields and creates no operations for unresolved anchors", () => {
    const intent = minimalAdventureResearchIntent({
      unresolvedClarificationQuestions: [
        { code: "location_required", field: "geographicAnchor" },
        { code: "duration_required", field: "durationRangeMinutes" }
      ]
    });
    const result = planOutdoorResearchV1(intent, completeCapabilities());
    const normalizedIntent = normalizedIntentExpectation(intent);
    assert.deepEqual(result, {
      state: "clarification_required",
      normalizedIntent,
      plan: null,
      clarificationQuestions: normalizedIntent.unresolvedClarificationQuestions,
      planningGaps: []
    });
    assert.equal(JSON.stringify(result).includes("operations"), false);
  });

  it("preserves broad-area clarification instead of selecting a centroid", () => {
    const intent = minimalAdventureResearchIntent({
      geographicAnchor: { state: "unresolved", requirementCode: "start_required" },
      unresolvedClarificationQuestions: [
        { code: "start_required", field: "geographicAnchor" }
      ]
    });
    const result = planOutdoorResearchV1(intent, completeCapabilities());
    assert.equal(result.state, "clarification_required");
    assert.deepEqual(result.normalizedIntent, normalizedIntentExpectation(intent));
    assert.equal(result.plan, null);
    assert.deepEqual(result.clarificationQuestions, intent.unresolvedClarificationQuestions);
    assert.equal(JSON.stringify(result).includes("coordinate"), false);
  });

  it("returns unsupported for a resolved anchor outside configured coverage", () => {
    const result = planOutdoorResearchV1(resolvedIntent({
      geographicAnchor: {
        state: "resolved",
        name: "Unsupported region",
        coordinate: { latitude: 45, longitude: 8 },
        regionEntityId: UNSUPPORTED_REGION_ID
      }
    }), completeCapabilities());
    assert.equal(result.state, "unsupported");
    assert.deepEqual(result.normalizedIntent, normalizedIntentExpectation(
      resolvedIntent({
        geographicAnchor: {
          state: "resolved",
          name: "Unsupported region",
          coordinate: { latitude: 45, longitude: 8 },
          regionEntityId: UNSUPPORTED_REGION_ID
        }
      })
    ));
    assert.equal(result.plan, null);
    assert.deepEqual(result.planningGaps.map((gap) => gap.code), ["unsupported_region"]);
    assert.equal(JSON.stringify(result).includes("operations"), false);
  });
});

describe("outdoor research planner v1 trust safeguards", () => {
  it("keeps high-stakes predicates official except for narrow unresolved mapped access context", () => {
    const result = planOutdoorResearchV1(maximumIntent(), completeCapabilities());
    for (const operation of result.plan.operations) {
      if (operation.predicates.some((predicate) => HIGH_STAKES_PREDICATES.has(predicate))) {
        const mappedAccessContext =
          operation.operationType === "retrieve_mapped_hiking_routes" &&
          operation.informationNeed === "mapped_hiking_routes" &&
          operation.reasonCode === "coverage_gap" &&
          operation.acceptableSourceCategories.length === 1 &&
          operation.acceptableSourceCategories[0] === "openstreetmap_open_mapping" &&
          operation.predicates.filter((predicate) =>
            HIGH_STAKES_PREDICATES.has(predicate)
          ).every((predicate) => predicate === "access_restriction");
        assert.equal(
          mappedAccessContext ||
            operation.acceptableSourceCategories.every((source) =>
              OFFICIAL_SOURCES.has(source)
            ),
          true
        );
      }
    }
  });

  it("keeps mapped viewpoint and waterfall discovery separate from access/current status", () => {
    const result = planOutdoorResearchV1(resolvedIntent({
      mustHaveExperiences: [
        { experience: "viewpoint", minimumCount: 1 },
        { experience: "waterfall", minimumCount: 1 }
      ]
    }), completeCapabilities());
    const discovery = result.plan.operations.find((operation) =>
      operation.operationType === "discover_highlights" &&
      operation.reasonCode === "must_have_experience"
    );
    assert.deepEqual(discovery.acceptableSourceCategories, [
      "openstreetmap_open_mapping",
      "wikimedia_open_knowledge"
    ]);
    assert.equal(discovery.predicates.includes("current_opening"), false);
    assert.equal(discovery.predicates.includes("public_access"), false);
    const access = result.plan.operations.find((operation) =>
      operation.operationType === "inspect_access_evidence"
    );
    assert.equal(access.entityCategories.includes("viewpoint"), true);
    assert.equal(access.entityCategories.includes("waterfall"), true);
  });

  it("does not treat a mapped hut as open, bookable, watered or overnight-permitted", () => {
    const result = planOutdoorResearchV1(resolvedIntent({
      preferredExperiences: ["alpine_hut"]
    }), completeCapabilities());
    const discovery = result.plan.operations.find((operation) =>
      operation.operationType === "discover_highlights"
    );
    assert.deepEqual(discovery.predicates, ["entity_category"]);
    for (const predicate of [
      "current_opening",
      "bookability",
      "drinking_water_availability",
      "overnight_permission"
    ]) {
      assert.equal(discovery.predicates.includes(predicate), false);
    }
  });

  it("never upgrades an OSM route relation into official status", () => {
    const result = planOutdoorResearchV1(resolvedIntent({
      mustHaveExperiences: [{ experience: "official_hiking_route", minimumCount: 1 }]
    }), completeCapabilities());
    const officialResearch = result.plan.operations.find((operation) =>
      operation.operationType === "retrieve_mapped_hiking_routes" &&
      operation.reasonCode === "must_have_experience"
    );
    assert.deepEqual(officialResearch.acceptableSourceCategories, [
      "official_authority",
      "official_operator"
    ]);
    assert.equal(
      result.planningGaps.some((gap) =>
        gap.code === "unsupported_evidence_dimension" &&
        gap.affectedValue === "official_hiking_route_status"
      ),
      true
    );
  });

  it("does not verify scenic quality, current waterfall flow or safety", () => {
    const result = planOutdoorResearchV1(resolvedIntent({
      mustHaveExperiences: [
        { experience: "viewpoint", minimumCount: 1 },
        { experience: "waterfall", minimumCount: 1 }
      ],
      groupContext: {
        partySize: 3,
        includesChildren: true,
        youngestAge: 8,
        mobility: "standard",
        experienceLevel: "beginner"
      }
    }), completeCapabilities());
    const serialized = JSON.stringify(result);
    for (const forbidden of [
      "scenic",
      "beautiful",
      "waterfall_flow",
      "safe_for_children",
      "safety_guarantee"
    ]) {
      assert.equal(serialized.includes(forbidden), false);
    }
    assert.equal(
      result.planningGaps.some((gap) => gap.affectedValue === "children_suitability"),
      true
    );
  });

  it("always reports the accepted-source gap for drinking water", () => {
    const result = planOutdoorResearchV1(resolvedIntent({
      requiredFacilities: ["drinking_water"]
    }), completeCapabilities());
    assert.equal(
      result.planningGaps.some((gap) => gap.code === "water_availability_source_missing"),
      true
    );
    const operation = result.plan.operations.find((candidate) =>
      candidate.predicates.includes("drinking_water_availability")
    );
    assert.deepEqual(operation.acceptableSourceCategories, [
      "official_authority",
      "official_operator"
    ]);
  });
});

describe("outdoor research planner v1 planning logic", () => {
  it("gives must-have experiences stronger access research than preferences", () => {
    const mustHave = planOutdoorResearchV1(resolvedIntent({
      mustHaveExperiences: [{ experience: "viewpoint", minimumCount: 1 }]
    }), completeCapabilities());
    const preferred = planOutdoorResearchV1(resolvedIntent({
      preferredExperiences: ["viewpoint"]
    }), completeCapabilities());
    const mustAccess = mustHave.plan.operations.find((operation) =>
      operation.operationType === "inspect_access_evidence"
    );
    const preferredAccess = preferred.plan.operations.find((operation) =>
      operation.operationType === "inspect_access_evidence"
    );
    assert.equal(mustAccess.entityCategories.includes("viewpoint"), true);
    assert.equal(preferredAccess.entityCategories.includes("viewpoint"), false);
  });

  it("merges compatible overlapping operations but keeps trust scopes separate", () => {
    const result = planOutdoorResearchV1(resolvedIntent({
      mustHaveExperiences: [
        { experience: "viewpoint", minimumCount: 1 },
        { experience: "waterfall", minimumCount: 1 },
        { experience: "peak", minimumCount: 1 }
      ],
      requiredFacilities: ["lunch_hut"],
      overnightRequirements: {
        required: true,
        nights: 1,
        allowedAccommodationTypes: ["alpine_hut"]
      }
    }), completeCapabilities());
    const mustDiscovery = result.plan.operations.filter((operation) =>
      operation.operationType === "discover_highlights" &&
      operation.reasonCode === "must_have_experience"
    );
    assert.equal(mustDiscovery.length, 1);
    assert.deepEqual(mustDiscovery[0].entityCategories, ["viewpoint", "waterfall", "peak"]);
    const hutDiscovery = result.plan.operations.filter((operation) =>
      operation.operationType === "discover_highlights" &&
      ["required_facility", "overnight_requirement"].includes(operation.reasonCode)
    );
    assert.equal(hutDiscovery.length, 2);
    const mappedNetwork = result.plan.operations.find((operation) =>
      operation.operationType === "retrieve_mapped_hiking_routes" &&
      operation.reasonCode === "coverage_gap"
    );
    const access = result.plan.operations.find((operation) =>
      operation.operationType === "inspect_access_evidence"
    );
    assert.deepEqual(mappedNetwork.acceptableSourceCategories, ["openstreetmap_open_mapping"]);
    assert.deepEqual(access.acceptableSourceCategories, [
      "official_authority",
      "official_operator"
    ]);
  });

  it("plans overnight legality, current opening, season and recent conditions separately", () => {
    const result = planOutdoorResearchV1(resolvedIntent({
      overnightRequirements: {
        required: true,
        nights: 2,
        allowedAccommodationTypes: ["alpine_hut", "official_campsite"]
      }
    }), completeCapabilities());
    for (const type of [
      "research_overnight_options",
      "check_current_status",
      "check_seasonal_evidence",
      "check_recent_conditions"
    ]) {
      assert.equal(result.plan.operations.some((operation) =>
        operation.operationType === type &&
        operation.reasonCode === "overnight_requirement"
      ), true);
    }
    assert.equal(result.plan.operations.some((operation) =>
      operation.predicates.includes("overnight_permission")
    ), true);
  });

  it("plans seasonal and recent checks only when date/season makes them relevant", () => {
    const undated = planOutdoorResearchV1(resolvedIntent(), completeCapabilities());
    const dated = planOutdoorResearchV1(resolvedIntent({
      dateOrSeason: { kind: "date", date: "2026-12-20" }
    }), completeCapabilities());
    assert.equal(undated.plan.operations.some((operation) =>
      ["check_seasonal_evidence", "check_recent_conditions"].includes(operation.operationType)
    ), false);
    assert.equal(dated.plan.operations.some((operation) =>
      operation.operationType === "check_seasonal_evidence"
    ), true);
    assert.equal(dated.plan.operations.some((operation) =>
      operation.operationType === "check_recent_conditions"
    ), true);
  });

  it("uses terrain/difficulty research for technical and elevation constraints", () => {
    for (const overrides of [
      { avoidedExperiences: ["technical_terrain"] },
      { avoidedExperiences: ["steep_climbs"] },
      { maximumElevationGainMeters: 500 },
      { maximumTechnicalDifficulty: "mountain_hiking" }
    ]) {
      const result = planOutdoorResearchV1(resolvedIntent(overrides), completeCapabilities());
      assert.equal(result.plan.operations.some((operation) =>
        operation.operationType === "analyze_terrain"
      ), true);
    }
  });

  it("returns unsupported for bare biking and emits no hiking semantics", () => {
    const result = planOutdoorResearchV1(resolvedIntent({
      activity: "biking"
    }), completeCapabilities());
    assert.equal(result.state, "unsupported");
    assert.equal(result.plan, null);
    assert.equal(
      result.planningGaps.some((gap) => gap.code === "biking_network_not_modeled"),
      true
    );
    assert.deepEqual(result.normalizedIntent.activity, "biking");
  });

  it("allows independent biking viewpoint research without any hiking semantics", () => {
    const result = planOutdoorResearchV1(resolvedIntent({
      activity: "biking",
      preferredExperiences: ["viewpoint"]
    }), completeCapabilities());
    assert.equal(result.state, "ready");
    assert.deepEqual(
      [...new Set(result.plan.operations.map((operation) => operation.operationType))],
      ["discover_highlights"]
    );
    assertNoBikingHikingSemantics(result.plan.operations);
    assert.equal(
      result.planningGaps.some((gap) => gap.code === "biking_network_not_modeled"),
      true
    );
  });

  it("keeps every biking operation free of hiking routes, segments and membership", () => {
    const result = planOutdoorResearchV1(resolvedIntent({
      activity: "biking",
      mustHaveExperiences: [{ experience: "viewpoint", minimumCount: 1 }],
      maximumElevationGainMeters: 800,
      requiredFacilities: ["lunch_hut"],
      dateOrSeason: { kind: "season", season: "summer", year: 2027 }
    }), completeCapabilities());
    assert.equal(result.state, "ready");
    assertNoBikingHikingSemantics(result.plan.operations);
  });

  it("requires all foundational mapped hiking-network capabilities", () => {
    const cases = [
      {
        name: "mapped source",
        capabilities: completeCapabilities({
          availableSourceCategories: SOURCE_CATEGORIES.filter((category) =>
            category !== "openstreetmap_open_mapping"
          )
        }),
        gap: "mapped_source_unavailable"
      },
      {
        name: "network operation",
        capabilities: completeCapabilities({
          enabledOperationTypes: RESEARCH_OPERATION_TYPES.filter((operationType) =>
            operationType !== "retrieve_mapped_hiking_routes"
          )
        }),
        gap: "operation_type_unavailable"
      },
      {
        name: "membership predicate",
        capabilities: completeCapabilities({
          supportedEvidencePredicates: EVIDENCE_PREDICATES.filter((predicate) =>
            predicate !== "mapped_hiking_route_membership"
          )
        }),
        gap: "predicate_unavailable"
      }
    ];
    for (const testCase of cases) {
      const result = planOutdoorResearchV1(resolvedIntent(), testCase.capabilities);
      assert.equal(result.state, "unsupported", testCase.name);
      assert.equal(result.plan, null, testCase.name);
      assert.equal(result.planningGaps.some((gap) => gap.code === testCase.gap),
        true, testCase.name);
      assert.deepEqual(result.normalizedIntent, normalizedIntentExpectation(
        resolvedIntent()
      ));
    }
  });

  it("records unsupported forest, quiet, transport, toilet and avoidance dimensions", () => {
    const result = planOutdoorResearchV1(resolvedIntent({
      preferredExperiences: ["forest", "quiet_trails"],
      avoidedExperiences: ["major_roads", "repeated_path", "crowds", "unpaved_surface"],
      requiredFacilities: ["public_transport", "toilets"],
      transportRequirements: {
        arrivalMode: "public_transport",
        returnToStart: false,
        publicTransportRequired: true
      }
    }), completeCapabilities());
    const gapCodes = new Set(result.planningGaps.map((gap) => gap.code));
    assert.equal(gapCodes.has("unsupported_evidence_dimension"), true);
    assert.equal(gapCodes.has("transport_evidence_not_modeled"), true);
    assert.equal(gapCodes.has("toilet_evidence_not_modeled"), true);
  });

  it("turns missing operation, predicate and source capabilities into gaps", () => {
    const result = planOutdoorResearchV1(resolvedIntent({
      preferredExperiences: ["viewpoint"],
      maximumElevationGainMeters: 500,
      requiredFacilities: ["lunch_hut"]
    }), completeCapabilities({
      availableSourceCategories: ["openstreetmap_open_mapping"],
      supportedEvidencePredicates: ["entity_category", "mapped_hiking_route_membership"],
      enabledOperationTypes: [
        "discover_highlights",
        "retrieve_mapped_hiking_routes",
        "inspect_access_evidence"
      ]
    }));
    const gapCodes = new Set(result.planningGaps.map((gap) => gap.code));
    assert.equal(gapCodes.has("official_source_unavailable"), true);
    assert.equal(gapCodes.has("operation_type_unavailable"), true);
    assert.equal(gapCodes.has("predicate_unavailable"), true);
    assert.equal(result.state, "ready");
  });
});

describe("outdoor research planner v1 evaluation fixture", () => {
  it("validates and evaluates at least 50 structured cases", async () => {
    const fixture = JSON.parse(await readFile(
      new URL("./fixtures/outdoorResearchPlannerV1.json", import.meta.url),
      "utf8"
    ));
    assert.equal(fixture.schemaVersion, 1);
    assert.equal(fixture.cases.length >= 50, true);
    const identifiers = fixture.cases.map((testCase) => testCase.id);
    assert.equal(new Set(identifiers).size, identifiers.length);
    const serializedFixture = JSON.stringify(fixture);
    for (const forbidden of [
      "http://",
      "https://",
      "apiKey",
      "secret",
      "password",
      "originalPrompt"
    ]) {
      assert.equal(serializedFixture.includes(forbidden), false);
    }

    for (const testCase of fixture.cases) {
      validateFixtureExpectation(testCase);
      const capabilities = testCase.capabilities ?? fixture.capabilities;
      if (testCase.expected.state === "invalid_input") {
        assert.throws(
          () => planOutdoorResearchV1(testCase.intent, capabilities),
          (error) => error instanceof OutdoorResearchPlannerError &&
            error.code === testCase.expected.errorCode,
          testCase.id
        );
        continue;
      }

      const normalizedIntent = normalizedIntentExpectation(testCase.intent);
      const result = planOutdoorResearchV1(testCase.intent, capabilities);
      assert.equal(result.state, testCase.expected.state, testCase.id);
      assert.deepEqual(result.normalizedIntent, normalizedIntent, testCase.id);
      assertDeeplyFrozen(result.normalizedIntent);
      const gapCodes = new Set(result.planningGaps.map((gap) => gap.code));
      for (const gapCode of testCase.expected.planningGapCodes) {
        assert.equal(gapCodes.has(gapCode), true, `${testCase.id}: gap ${gapCode}`);
      }
      const operations = result.plan?.operations ?? [];
      assertFixtureOperationBoundaries(testCase, operations);
      if (result.state !== "ready") {
        assert.equal(result.plan, null, testCase.id);
        continue;
      }

      validateResearchPlanV1(result.plan);
      assert.equal(result.plan.operations.length <= 24, true, testCase.id);
      assert.equal(new Set(result.plan.operations.map(operationSignature)).size,
        result.plan.operations.length, testCase.id);
      const operationTypes = new Set(result.plan.operations.map((operation) =>
        operation.operationType
      ));
      const informationNeeds = new Set(result.plan.operations.map((operation) =>
        operation.informationNeed
      ));
      const predicates = new Set(result.plan.operations.flatMap((operation) =>
        operation.predicates
      ));
      for (const operationType of testCase.expected.operationTypes) {
        assert.equal(operationTypes.has(operationType), true,
          `${testCase.id}: operation ${operationType}`);
      }
      for (const informationNeed of testCase.expected.informationNeeds) {
        assert.equal(informationNeeds.has(informationNeed), true,
          `${testCase.id}: need ${informationNeed}`);
      }
      for (const predicate of testCase.expected.criticalPredicates) {
        assert.equal(predicates.has(predicate), true,
          `${testCase.id}: predicate ${predicate}`);
      }
      for (const restriction of testCase.expected.sourceCategoryRestrictions) {
        const relevant = result.plan.operations.filter((operation) =>
          operation.predicates.includes(restriction.predicate)
        );
        assert.equal(relevant.length > 0, true,
          `${testCase.id}: restricted predicate ${restriction.predicate}`);
        for (const operation of relevant) {
          assert.equal(operation.acceptableSourceCategories.every((category) =>
            restriction.allowed.includes(category)
          ), true, `${testCase.id}: source restriction ${restriction.predicate}`);
        }
      }
    }
  });
});

function maximumIntent() {
  return resolvedIntent({
    distanceRangeKm: { min: 0.1, max: 500 },
    durationRangeMinutes: { min: 15, max: 10_080 },
    maximumElevationGainMeters: 20_000,
    maximumTechnicalDifficulty: "difficult_alpine_hiking",
    mustHaveExperiences: [
      "viewpoint",
      "waterfall",
      "peak",
      "lake",
      "forest",
      "quiet_trails",
      "official_hiking_route",
      "alpine_hut",
      "wilderness_hut",
      "landmark"
    ].map((experience) => ({ experience, minimumCount: 1 })),
    preferredExperiences: [
      "viewpoint",
      "waterfall",
      "peak",
      "lake",
      "forest",
      "quiet_trails",
      "official_hiking_route",
      "alpine_hut",
      "wilderness_hut",
      "landmark"
    ],
    avoidedExperiences: [
      "exposed_trails",
      "technical_terrain",
      "major_roads",
      "steep_climbs",
      "repeated_path",
      "crowds",
      "unpaved_surface"
    ],
    requiredFacilities: [
      "drinking_water",
      "lunch_hut",
      "emergency_shelter",
      "public_transport",
      "official_campsite",
      "designated_bivouac",
      "toilets"
    ],
    groupContext: {
      partySize: 100,
      includesChildren: true,
      youngestAge: 0,
      mobility: "limited",
      experienceLevel: "beginner"
    },
    dateOrSeason: { kind: "season", season: "winter", year: 2100 },
    overnightRequirements: {
      required: true,
      nights: 30,
      allowedAccommodationTypes: [
        "alpine_hut",
        "wilderness_hut",
        "official_campsite",
        "designated_bivouac"
      ]
    },
    transportRequirements: {
      arrivalMode: "public_transport",
      returnToStart: false,
      publicTransportRequired: true
    }
  });
}

function assertDeeplyFrozen(value) {
  if (!value || typeof value !== "object") return;
  assert.equal(Object.isFrozen(value), true);
  for (const child of Object.values(value)) assertDeeplyFrozen(child);
}

function normalizedIntentExpectation(input) {
  const validated = validateAdventureResearchIntentV1(input);
  return validateAdventureResearchIntentV1({
    ...validated,
    mustHaveExperiences: [...validated.mustHaveExperiences].sort(
      (left, right) =>
        compareText(left.experience, right.experience) ||
        left.minimumCount - right.minimumCount
    ),
    preferredExperiences: [...validated.preferredExperiences].sort(),
    avoidedExperiences: [...validated.avoidedExperiences].sort(),
    requiredFacilities: [...validated.requiredFacilities].sort(),
    overnightRequirements: {
      ...validated.overnightRequirements,
      allowedAccommodationTypes: [
        ...validated.overnightRequirements.allowedAccommodationTypes
      ].sort()
    },
    unresolvedClarificationQuestions: [
      ...validated.unresolvedClarificationQuestions
    ].sort(
      (left, right) =>
        compareText(left.code, right.code) ||
        compareText(left.field, right.field)
    )
  });
}

function compareText(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function assertNoBikingHikingSemantics(operations) {
  for (const operation of operations) {
    assert.equal(operation.entityCategories.includes("hiking_route"), false);
    assert.equal(operation.entityCategories.includes("trail_segment"), false);
    assert.equal(operation.predicates.includes("mapped_hiking_route_membership"), false);
  }
}

function assertFixtureOperationBoundaries(testCase, operations) {
  const operationTypes = [...new Set(operations.map((operation) =>
    operation.operationType
  ))].sort();
  if (testCase.expected.exactOperationTypes) {
    assert.deepEqual(
      operationTypes,
      [...testCase.expected.exactOperationTypes].sort(),
      `${testCase.id}: exact operation types`
    );
  }
  for (const operationType of testCase.expected.forbiddenOperationTypes ?? []) {
    assert.equal(
      operations.some((operation) => operation.operationType === operationType),
      false,
      `${testCase.id}: forbidden operation ${operationType}`
    );
  }
  for (const entityCategory of testCase.expected.forbiddenEntityCategories ?? []) {
    assert.equal(
      operations.some((operation) =>
        operation.entityCategories.includes(entityCategory)
      ),
      false,
      `${testCase.id}: forbidden entity ${entityCategory}`
    );
  }
  for (const predicate of testCase.expected.forbiddenPredicates ?? []) {
    assert.equal(
      operations.some((operation) => operation.predicates.includes(predicate)),
      false,
      `${testCase.id}: forbidden predicate ${predicate}`
    );
  }
}

function operationSignature(operation) {
  return JSON.stringify({
    operationType: operation.operationType,
    informationNeed: operation.informationNeed,
    reasonCode: operation.reasonCode,
    acceptableSourceCategories: operation.acceptableSourceCategories,
    entityCategories: operation.entityCategories,
    predicates: operation.predicates
  });
}

function compareByDocumentedOperationOrder(left, right) {
  const order = [
    "discover_highlights",
    "retrieve_mapped_hiking_routes",
    "analyze_terrain",
    "inspect_access_evidence",
    "check_current_status",
    "research_overnight_options",
    "check_seasonal_evidence",
    "check_recent_conditions"
  ];
  return order.indexOf(left.operationType) - order.indexOf(right.operationType);
}

function validateFixtureExpectation(testCase) {
  assert.equal(typeof testCase.id, "string");
  assert.equal(testCase.id.length > 0 && testCase.id.length <= 80, true);
  assert.equal(typeof testCase.expected, "object");
  assert.equal([
    "ready",
    "clarification_required",
    "unsupported",
    "invalid_input"
  ].includes(testCase.expected.state), true, testCase.id);
  for (const field of [
    "operationTypes",
    "informationNeeds",
    "criticalPredicates",
    "sourceCategoryRestrictions",
    "planningGapCodes"
  ]) {
    assert.equal(Array.isArray(testCase.expected[field]), true, `${testCase.id}: ${field}`);
  }
  assert.equal(testCase.expected.operationTypes.every((value) =>
    RESEARCH_OPERATION_TYPES.includes(value)
  ), true, testCase.id);
  assert.equal(testCase.expected.criticalPredicates.every((value) =>
    EVIDENCE_PREDICATES.includes(value)
  ), true, testCase.id);
  assert.equal(testCase.expected.planningGapCodes.every((value) =>
    RESEARCH_PLANNER_GAP_CODES_V1.includes(value)
  ), true, testCase.id);
  for (const restriction of testCase.expected.sourceCategoryRestrictions) {
    assert.equal(EVIDENCE_PREDICATES.includes(restriction.predicate), true);
    assert.equal(Array.isArray(restriction.allowed) && restriction.allowed.every((value) =>
      SOURCE_CATEGORIES.includes(value)
    ), true);
  }
  for (const [field, values, allowed, maximum] of [
    [
      "exactOperationTypes",
      testCase.expected.exactOperationTypes,
      RESEARCH_OPERATION_TYPES,
      RESEARCH_OPERATION_TYPES.length
    ],
    [
      "forbiddenOperationTypes",
      testCase.expected.forbiddenOperationTypes,
      RESEARCH_OPERATION_TYPES,
      RESEARCH_OPERATION_TYPES.length
    ],
    [
      "forbiddenEntityCategories",
      testCase.expected.forbiddenEntityCategories,
      ENTITY_CATEGORIES,
      ENTITY_CATEGORIES.length
    ],
    [
      "forbiddenPredicates",
      testCase.expected.forbiddenPredicates,
      EVIDENCE_PREDICATES,
      EVIDENCE_PREDICATES.length
    ]
  ]) {
    if (values === undefined) continue;
    assert.equal(Array.isArray(values), true, `${testCase.id}: ${field}`);
    assert.equal(values.length <= maximum, true, `${testCase.id}: ${field}`);
    assert.equal(new Set(values).size, values.length, `${testCase.id}: ${field}`);
    assert.equal(values.every((value) => allowed.includes(value)), true,
      `${testCase.id}: ${field}`);
  }
  if (testCase.expected.state === "invalid_input") {
    assert.equal(["invalid_intent", "invalid_capabilities"].includes(
      testCase.expected.errorCode
    ), true);
  }
  assert.equal(ENTITY_CATEGORIES.length > 0, true);
}
