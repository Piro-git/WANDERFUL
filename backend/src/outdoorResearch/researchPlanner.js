import { OUTDOOR_RESEARCH_LIMITS } from "./contracts.js";
import {
  OUTDOOR_RESEARCH_PLANNER_POLICY_V1,
  RESEARCH_PLANNER_AFFECTED_FIELDS_V1,
  RESEARCH_PLANNER_CAPABILITY_FIELDS_V1,
  RESEARCH_PLANNER_GAP_CODES_V1,
  RESEARCH_PLANNER_GAP_REASONS_V1
} from "./researchPlannerPolicy.js";
import {
  validateAdventureResearchIntentV1,
  validateResearchPlanV1
} from "./validation.js";

const POLICY = OUTDOOR_RESEARCH_PLANNER_POLICY_V1;
const FOUNDATIONAL_HIKING_NETWORK = POLICY.foundationalHikingNetwork;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_ERROR_MESSAGES = Object.freeze({
  invalid_intent: "Outdoor research intent is invalid.",
  invalid_capabilities: "Outdoor research capabilities are invalid.",
  invalid_generated_plan: "Outdoor research planning could not produce a valid plan."
});
const GAP_CODE_SET = new Set(RESEARCH_PLANNER_GAP_CODES_V1);
const GAP_REASON_SET = new Set(RESEARCH_PLANNER_GAP_REASONS_V1);
const GAP_FIELD_SET = new Set(RESEARCH_PLANNER_AFFECTED_FIELDS_V1);
const HIGH_STAKES_SET = new Set(POLICY.highStakesPredicates);

export class OutdoorResearchPlannerError extends Error {
  constructor(code) {
    super(SAFE_ERROR_MESSAGES[code] ?? SAFE_ERROR_MESSAGES.invalid_generated_plan);
    this.name = "OutdoorResearchPlannerError";
    this.code = code;
  }
}

export function validateResearchPlannerCapabilitiesV1(input = {}) {
  try {
    assertCapabilityObject(input);
    return deepFreeze({
      supportedRegionIds: normalizedUuidArray(
        input.supportedRegionIds ?? [],
        POLICY.maximumSupportedRegions
      ),
      availableSourceCategories: normalizedEnumArray(
        input.availableSourceCategories ?? [],
        POLICY.sourceCategories,
        POLICY.sourceCategories.length
      ),
      supportedEvidencePredicates: normalizedEnumArray(
        input.supportedEvidencePredicates ?? [],
        POLICY.evidencePredicates,
        POLICY.evidencePredicates.length
      ),
      enabledOperationTypes: normalizedEnumArray(
        input.enabledOperationTypes ?? [],
        POLICY.operationTypes,
        POLICY.operationTypes.length
      )
    });
  } catch (error) {
    if (error instanceof OutdoorResearchPlannerError) throw error;
    throw new OutdoorResearchPlannerError("invalid_capabilities");
  }
}

export function planOutdoorResearchV1(intentInput, capabilitiesInput = {}) {
  const intent = validatedIntent(intentInput);
  const capabilities = validateResearchPlannerCapabilitiesV1(capabilitiesInput);

  if (intent.geographicAnchor.state === "unresolved") {
    return deepFreeze({
      state: "clarification_required",
      normalizedIntent: intent,
      plan: null,
      clarificationQuestions: intent.unresolvedClarificationQuestions,
      planningGaps: []
    });
  }

  const regionEntityId = intent.geographicAnchor.regionEntityId;
  if (!regionEntityId || !capabilities.supportedRegionIds.includes(regionEntityId)) {
    return deepFreeze({
      state: "unsupported",
      normalizedIntent: intent,
      plan: null,
      planningGaps: [
        planningGap(
          "unsupported_region",
          "geographicAnchor",
          regionEntityId,
          "coverage_not_configured",
          false,
          true
        )
      ]
    });
  }

  const context = {
    intent,
    capabilities,
    proposals: [],
    gaps: [],
    accessEntityCategories: new Set(),
    requiresFoundationalHikingNetwork:
      intent.activity === "hiking" || intent.activity === "trail_running"
  };

  planMappedNetwork(context);
  planExperiences(context);
  planFacilities(context);
  planAvoidancesAndDifficulty(context);
  planGroupNeeds(context);
  planOvernight(context);
  planAccessVerification(context);
  planSeasonAndRecentConditions(context);

  const operations = materializeOperations(context);
  const planningGaps = normalizeGaps(context.gaps);
  if (context.requiresFoundationalHikingNetwork &&
      !hasFoundationalHikingNetworkOperation(operations)) {
    return deepFreeze({
      state: "unsupported",
      normalizedIntent: intent,
      plan: null,
      planningGaps
    });
  }
  if (operations.length === 0) {
    return deepFreeze({
      state: "unsupported",
      normalizedIntent: intent,
      plan: null,
      planningGaps
    });
  }

  let plan;
  try {
    plan = validateResearchPlanV1({
      schemaVersion: 1,
      intentSchemaVersion: 1,
      operations
    });
  } catch {
    throw new OutdoorResearchPlannerError("invalid_generated_plan");
  }

  return deepFreeze({
    state: "ready",
    normalizedIntent: intent,
    plan,
    planningGaps
  });
}

function validatedIntent(input) {
  try {
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
  } catch {
    throw new OutdoorResearchPlannerError("invalid_intent");
  }
}

function compareText(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function assertCapabilityObject(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("capabilities");
  }
  let serialized;
  try {
    serialized = JSON.stringify(input);
  } catch {
    throw new TypeError("capabilities");
  }
  if (serialized === undefined ||
      Buffer.byteLength(serialized, "utf8") > POLICY.maximumCapabilityBytes) {
    throw new TypeError("capabilities");
  }
  const allowed = new Set(RESEARCH_PLANNER_CAPABILITY_FIELDS_V1);
  if (Object.keys(input).some((key) => !allowed.has(key))) {
    throw new TypeError("capabilities");
  }
}

function normalizedUuidArray(input, maximum) {
  if (!Array.isArray(input) || input.length > maximum) throw new TypeError("capabilities");
  const normalized = input.map((value) => {
    if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
      throw new TypeError("capabilities");
    }
    return value.toLowerCase();
  });
  assertUnique(normalized);
  return normalized.sort((left, right) => left.localeCompare(right));
}

function normalizedEnumArray(input, allowedValues, maximum) {
  if (!Array.isArray(input) || input.length > maximum) throw new TypeError("capabilities");
  const allowed = new Set(allowedValues);
  if (input.some((value) => !allowed.has(value))) throw new TypeError("capabilities");
  assertUnique(input);
  return ordered(input, allowedValues);
}

function assertUnique(values) {
  if (new Set(values).size !== values.length) throw new TypeError("capabilities");
}

function planMappedNetwork(context) {
  if (context.intent.activity === "biking") {
    addGap(
      context,
      "biking_network_not_modeled",
      "activity",
      "biking",
      "contract_dimension_missing"
    );
    return;
  }
  const foundationalCapabilitiesAvailable =
    context.capabilities.enabledOperationTypes.includes(
      FOUNDATIONAL_HIKING_NETWORK.operationType
    ) &&
    FOUNDATIONAL_HIKING_NETWORK.sourceCategories.some((category) =>
      context.capabilities.availableSourceCategories.includes(category)
    ) &&
    context.capabilities.supportedEvidencePredicates.includes(
      FOUNDATIONAL_HIKING_NETWORK.requiredPredicate
    );
  propose(context, {
    operationType: FOUNDATIONAL_HIKING_NETWORK.operationType,
    informationNeed: FOUNDATIONAL_HIKING_NETWORK.informationNeed,
    reasonCode: FOUNDATIONAL_HIKING_NETWORK.reasonCode,
    sourceCategories: FOUNDATIONAL_HIKING_NETWORK.sourceCategories,
    sourceGapCode: "mapped_source_unavailable",
    entityCategories: ["hiking_route", "trail_segment"],
    predicates: [
      FOUNDATIONAL_HIKING_NETWORK.requiredPredicate,
      "trail_difficulty",
      "trail_visibility"
    ],
    allowEmptyPredicates: false
  });
  if (foundationalCapabilitiesAvailable) {
    context.accessEntityCategories.add("hiking_route");
    context.accessEntityCategories.add("trail_segment");
  }
}

function planExperiences(context) {
  for (const [field, requirements, reasonCode] of [
    ["mustHaveExperiences", context.intent.mustHaveExperiences, "must_have_experience"],
    [
      "preferredExperiences",
      context.intent.preferredExperiences.map((experience) => ({ experience, minimumCount: 1 })),
      "preferred_experience"
    ]
  ]) {
    const entityCategories = new Set();
    const predicates = new Set();
    const orderedRequirements = [...requirements].sort((left, right) =>
      left.experience.localeCompare(right.experience)
    );
    for (const requirement of orderedRequirements) {
      const experience = requirement.experience;
      if (POLICY.unsupportedExperiences.includes(experience)) {
        addGap(
          context,
          "unsupported_evidence_dimension",
          field,
          experience,
          "contract_dimension_missing"
        );
        continue;
      }
      if (experience === "official_hiking_route") {
        planOfficialHikingRoute(context, field, reasonCode);
        continue;
      }
      for (const category of POLICY.experienceEntityCategories[experience] ?? []) {
        entityCategories.add(category);
        if (field === "mustHaveExperiences") context.accessEntityCategories.add(category);
      }
      for (const predicate of POLICY.experiencePredicates[experience] ?? []) {
        predicates.add(predicate);
      }
    }
    if (entityCategories.size > 0) {
      propose(context, {
        operationType: "discover_highlights",
        informationNeed: "highlight_candidates",
        reasonCode,
        sourceCategories: POLICY.sourceScopes.mappedDiscovery,
        sourceGapCode: "mapped_source_unavailable",
        entityCategories: [...entityCategories],
        predicates: [...predicates],
        allowEmptyPredicates: false
      });
    }
  }
}

function planOfficialHikingRoute(context, field, reasonCode) {
  if (context.intent.activity === "biking") {
    addGap(
      context,
      "unsupported_evidence_dimension",
      field,
      "official_hiking_route_status",
      "contract_dimension_missing"
    );
    return;
  }
  propose(context, {
    operationType: "retrieve_mapped_hiking_routes",
    informationNeed: "mapped_hiking_routes",
    reasonCode,
    sourceCategories: POLICY.sourceScopes.officialOnly,
    sourceGapCode: "official_source_unavailable",
    entityCategories: ["hiking_route", "trail_segment"],
    predicates: ["mapped_hiking_route_membership"],
    allowEmptyPredicates: false
  });
  addGap(
    context,
    "unsupported_evidence_dimension",
    field,
    "official_hiking_route_status",
    "contract_dimension_missing"
  );
}

function planFacilities(context) {
  const discoveryCategories = new Set();
  const currentCategories = new Set();
  const legalityCategories = new Set();
  const facilities = ordered(context.intent.requiredFacilities, [
    "drinking_water",
    "lunch_hut",
    "emergency_shelter",
    "public_transport",
    "official_campsite",
    "designated_bivouac",
    "toilets"
  ]);

  for (const facility of facilities) {
    if (facility === "public_transport") {
      addGap(
        context,
        "transport_evidence_not_modeled",
        "requiredFacilities",
        facility,
        "contract_dimension_missing"
      );
      continue;
    }
    if (facility === "toilets") {
      addGap(
        context,
        "toilet_evidence_not_modeled",
        "requiredFacilities",
        facility,
        "contract_dimension_missing"
      );
      continue;
    }
    if (facility === "drinking_water") {
      planDrinkingWater(context);
      continue;
    }
    for (const category of POLICY.facilityEntityCategories[facility] ?? []) {
      discoveryCategories.add(category);
      context.accessEntityCategories.add(category);
      if (facility === "lunch_hut") currentCategories.add(category);
      if (facility === "official_campsite" || facility === "designated_bivouac") {
        legalityCategories.add(category);
      }
    }
  }

  if (context.intent.transportRequirements.publicTransportRequired &&
      !facilities.includes("public_transport")) {
    addGap(
      context,
      "transport_evidence_not_modeled",
      "transportRequirements",
      "public_transport",
      "contract_dimension_missing"
    );
  }

  if (discoveryCategories.size > 0) {
    propose(context, {
      operationType: "discover_highlights",
      informationNeed: "highlight_candidates",
      reasonCode: "required_facility",
      sourceCategories: POLICY.sourceScopes.mappedDiscovery,
      sourceGapCode: "mapped_source_unavailable",
      entityCategories: [...discoveryCategories],
      predicates: ["entity_category"],
      allowEmptyPredicates: false
    });
  }

  if (currentCategories.size > 0) {
    propose(context, {
      operationType: "check_current_status",
      informationNeed: "opening_and_operating_status",
      reasonCode: "required_facility",
      sourceCategories: POLICY.sourceScopes.currentOfficial,
      sourceGapCode: "current_source_unavailable",
      entityCategories: [...currentCategories],
      predicates: ["current_opening", "seasonal_opening", "bookability"],
      allowEmptyPredicates: false
    });
  }

  if (legalityCategories.size > 0) {
    propose(context, {
      operationType: "research_overnight_options",
      informationNeed: "overnight_legality",
      reasonCode: "required_facility",
      sourceCategories: POLICY.sourceScopes.officialOnly,
      sourceGapCode: "official_source_unavailable",
      entityCategories: [...legalityCategories],
      predicates: [
        "overnight_permission",
        "public_access",
        "access_restriction",
        "closure_status"
      ],
      allowEmptyPredicates: false
    });
  }
}

function planDrinkingWater(context) {
  propose(context, {
    operationType: "check_current_status",
    informationNeed: "opening_and_operating_status",
    reasonCode: "required_facility",
    sourceCategories: POLICY.sourceScopes.currentOfficial,
    sourceGapCode: "current_source_unavailable",
    entityCategories: ["alpine_hut", "wilderness_hut", "trailhead"],
    predicates: ["drinking_water_availability"],
    allowEmptyPredicates: false
  });
  addGap(
    context,
    "water_availability_source_missing",
    "requiredFacilities",
    "drinking_water",
    "accepted_source_not_available",
    false,
    true
  );
}

function planAvoidancesAndDifficulty(context) {
  const terrainReasons = [];
  for (const avoidance of ordered(
    context.intent.avoidedExperiences,
    [
      "exposed_trails",
      "technical_terrain",
      "major_roads",
      "steep_climbs",
      "repeated_path",
      "crowds",
      "unpaved_surface"
    ]
  )) {
    if (POLICY.terrainAvoidances.includes(avoidance)) {
      terrainReasons.push(avoidance);
      if (avoidance === "exposed_trails") {
        addGap(
          context,
          "unsupported_evidence_dimension",
          "avoidedExperiences",
          "exposure_not_fully_verifiable",
          "contract_dimension_missing"
        );
      }
      continue;
    }
    if (POLICY.unsupportedAvoidances.includes(avoidance)) {
      addGap(
        context,
        "unsupported_evidence_dimension",
        "avoidedExperiences",
        avoidance,
        "contract_dimension_missing"
      );
    }
  }

  if (context.intent.maximumElevationGainMeters !== null) {
    terrainReasons.push("maximum_elevation_gain");
  }
  if (context.intent.maximumTechnicalDifficulty !== null) {
    terrainReasons.push("maximum_technical_difficulty");
  }
  if (terrainReasons.length > 0) {
    const predicates = context.intent.activity !== "biking" &&
      terrainReasons.some((reason) =>
      reason === "exposed_trails" ||
      reason === "technical_terrain" ||
      reason === "maximum_technical_difficulty"
    ) ? ["trail_difficulty", "trail_visibility"] : [];
    propose(context, {
      operationType: "analyze_terrain",
      informationNeed: "terrain_characteristics",
      reasonCode: "avoidance_constraint",
      sourceCategories: POLICY.sourceScopes.terrainAnalysis,
      sourceGapCode: "derived_source_unavailable",
      entityCategories: context.intent.activity === "biking" ? ["region"] : ["trail_segment"],
      predicates,
      allowEmptyPredicates: true
    });
  }
}

function planGroupNeeds(context) {
  const group = context.intent.groupContext;
  const affectedValues = [];
  if (group.experienceLevel === "beginner") affectedValues.push("beginner_suitability");
  if (group.includesChildren) affectedValues.push("children_suitability");
  if (group.mobility === "limited") affectedValues.push("limited_mobility_suitability");
  if (affectedValues.length === 0) return;

  propose(context, {
    operationType: "analyze_terrain",
    informationNeed: "terrain_characteristics",
    reasonCode: "avoidance_constraint",
    sourceCategories: POLICY.sourceScopes.terrainAnalysis,
    sourceGapCode: "derived_source_unavailable",
    entityCategories: context.intent.activity === "biking" ? ["region"] : ["trail_segment"],
    predicates: context.intent.activity === "biking"
      ? []
      : ["trail_difficulty", "trail_visibility"],
    allowEmptyPredicates: true
  });
  for (const affectedValue of affectedValues) {
    addGap(
      context,
      "unsupported_evidence_dimension",
      "groupContext",
      affectedValue,
      "contract_dimension_missing"
    );
  }
}

function planOvernight(context) {
  const overnight = context.intent.overnightRequirements;
  if (!overnight.required) return;
  const categories = ordered(
    overnight.allowedAccommodationTypes,
    POLICY.entityCategories
  );
  for (const category of categories) context.accessEntityCategories.add(category);

  propose(context, {
    operationType: "discover_highlights",
    informationNeed: "highlight_candidates",
    reasonCode: "overnight_requirement",
    sourceCategories: POLICY.sourceScopes.mappedDiscovery,
    sourceGapCode: "mapped_source_unavailable",
    entityCategories: categories,
    predicates: ["entity_category"],
    allowEmptyPredicates: false
  });
  propose(context, {
    operationType: "research_overnight_options",
    informationNeed: "overnight_legality",
    reasonCode: "overnight_requirement",
    sourceCategories: POLICY.sourceScopes.officialOnly,
    sourceGapCode: "official_source_unavailable",
    entityCategories: categories,
    predicates: [
      "overnight_permission",
      "public_access",
      "access_restriction",
      "closure_status"
    ],
    allowEmptyPredicates: false
  });
  propose(context, {
    operationType: "check_current_status",
    informationNeed: "opening_and_operating_status",
    reasonCode: "overnight_requirement",
    sourceCategories: POLICY.sourceScopes.currentOfficial,
    sourceGapCode: "current_source_unavailable",
    entityCategories: categories,
    predicates: ["current_opening", "seasonal_opening", "bookability"],
    allowEmptyPredicates: false
  });
  propose(context, {
    operationType: "check_seasonal_evidence",
    informationNeed: "seasonal_relevance",
    reasonCode: "overnight_requirement",
    sourceCategories: POLICY.sourceScopes.currentOfficial,
    sourceGapCode: "current_source_unavailable",
    entityCategories: categories,
    predicates: ["seasonal_opening", "closure_status"],
    allowEmptyPredicates: false
  });
  propose(context, {
    operationType: "check_recent_conditions",
    informationNeed: "recent_conditions",
    reasonCode: "overnight_requirement",
    sourceCategories: POLICY.sourceScopes.currentOfficial,
    sourceGapCode: "current_source_unavailable",
    entityCategories: categories,
    predicates: ["closure_status"],
    allowEmptyPredicates: false
  });
}

function planAccessVerification(context) {
  if (context.accessEntityCategories.size === 0) return;
  propose(context, {
    operationType: "inspect_access_evidence",
    informationNeed: "access_and_legal_status",
    reasonCode: "high_stakes_verification",
    sourceCategories: POLICY.sourceScopes.officialOnly,
    sourceGapCode: "official_source_unavailable",
    entityCategories: [...context.accessEntityCategories],
    predicates: ["public_access", "access_restriction", "closure_status"],
    allowEmptyPredicates: false
  });
}

function planSeasonAndRecentConditions(context) {
  if (context.intent.dateOrSeason === null) return;
  const categories = [...context.accessEntityCategories];
  if (categories.length === 0) return;
  propose(context, {
    operationType: "check_seasonal_evidence",
    informationNeed: "seasonal_relevance",
    reasonCode: "seasonal_verification",
    sourceCategories: POLICY.sourceScopes.currentOfficial,
    sourceGapCode: "current_source_unavailable",
    entityCategories: categories,
    predicates: ["seasonal_opening", "closure_status"],
    allowEmptyPredicates: false
  });
  propose(context, {
    operationType: "check_recent_conditions",
    informationNeed: "recent_conditions",
    reasonCode: "seasonal_verification",
    sourceCategories: POLICY.sourceScopes.currentOfficial,
    sourceGapCode: "current_source_unavailable",
    entityCategories: categories,
    predicates: ["closure_status"],
    allowEmptyPredicates: false
  });
}

function hasFoundationalHikingNetworkOperation(operations) {
  return operations.some((operation) =>
    operation.operationType === FOUNDATIONAL_HIKING_NETWORK.operationType &&
    operation.informationNeed === FOUNDATIONAL_HIKING_NETWORK.informationNeed &&
    operation.reasonCode === FOUNDATIONAL_HIKING_NETWORK.reasonCode &&
    operation.predicates.includes(FOUNDATIONAL_HIKING_NETWORK.requiredPredicate) &&
    operation.acceptableSourceCategories.some((category) =>
      FOUNDATIONAL_HIKING_NETWORK.sourceCategories.includes(category)
    )
  );
}

function propose(context, proposal) {
  context.proposals.push({
    ...proposal,
    sourceCategories: ordered(proposal.sourceCategories, POLICY.sourceCategories),
    entityCategories: ordered(proposal.entityCategories, POLICY.entityCategories),
    predicates: ordered(proposal.predicates, POLICY.evidencePredicates)
  });
}

function materializeOperations(context) {
  const operations = [];
  for (const proposal of context.proposals) {
    if (!context.capabilities.enabledOperationTypes.includes(proposal.operationType)) {
      addGap(
        context,
        "operation_type_unavailable",
        "capabilities",
        proposal.operationType,
        "operation_not_enabled",
        false,
        true
      );
      continue;
    }

    const sourceCategories = proposal.sourceCategories.filter((category) =>
      context.capabilities.availableSourceCategories.includes(category)
    );
    if (sourceCategories.length === 0) {
      addGap(
        context,
        proposal.sourceGapCode,
        "capabilities",
        proposal.operationType,
        proposal.sourceGapCode === "official_source_unavailable"
          ? "authority_not_available"
          : proposal.sourceGapCode === "current_source_unavailable"
            ? "current_evidence_not_available"
            : "accepted_source_not_available",
        false,
        true
      );
      continue;
    }

    const predicates = [];
    for (const predicate of proposal.predicates) {
      if (context.capabilities.supportedEvidencePredicates.includes(predicate)) {
        predicates.push(predicate);
      } else {
        addGap(
          context,
          "predicate_unavailable",
          "capabilities",
          predicate,
          "predicate_not_supported",
          false,
          true
        );
      }
    }
    if (!proposal.allowEmptyPredicates && predicates.length === 0) continue;
    if (predicates.some((predicate) => HIGH_STAKES_SET.has(predicate)) &&
        !sourceCategories.every((category) =>
          category === "official_authority" || category === "official_operator")) {
      throw new OutdoorResearchPlannerError("invalid_generated_plan");
    }

    operations.push({
      operationType: proposal.operationType,
      informationNeed: proposal.informationNeed,
      reasonCode: proposal.reasonCode,
      acceptableSourceCategories: sourceCategories,
      entityCategories: proposal.entityCategories,
      predicates
    });
  }

  const merged = mergeCompatibleOperations(operations);
  merged.sort(compareOperations);
  if (merged.length > OUTDOOR_RESEARCH_LIMITS.maximumResearchOperations) {
    throw new OutdoorResearchPlannerError("invalid_generated_plan");
  }
  return merged.map((operation, index) => ({
    operationId: `op_${String(index + 1).padStart(2, "0")}_${operation.operationType}`,
    ...operation
  }));
}

function mergeCompatibleOperations(operations) {
  const merged = new Map();
  for (const operation of operations) {
    const key = JSON.stringify([
      operation.operationType,
      operation.informationNeed,
      operation.reasonCode,
      operation.acceptableSourceCategories
    ]);
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, {
        ...operation,
        entityCategories: [...operation.entityCategories],
        predicates: [...operation.predicates]
      });
      continue;
    }
    existing.entityCategories = ordered(
      [...new Set([...existing.entityCategories, ...operation.entityCategories])],
      POLICY.entityCategories
    );
    existing.predicates = ordered(
      [...new Set([...existing.predicates, ...operation.predicates])],
      POLICY.evidencePredicates
    );
  }
  return [...merged.values()];
}

function compareOperations(left, right) {
  return (
    indexOf(POLICY.operationOrder, left.operationType) -
      indexOf(POLICY.operationOrder, right.operationType) ||
    indexOf(POLICY.informationNeeds, left.informationNeed) -
      indexOf(POLICY.informationNeeds, right.informationNeed) ||
    indexOf(POLICY.reasonCodes, left.reasonCode) -
      indexOf(POLICY.reasonCodes, right.reasonCode) ||
    canonicalOperation(left).localeCompare(canonicalOperation(right))
  );
}

function canonicalOperation(operation) {
  return JSON.stringify([
    operation.operationType,
    operation.informationNeed,
    operation.reasonCode,
    operation.acceptableSourceCategories,
    operation.entityCategories,
    operation.predicates
  ]);
}

function addGap(
  context,
  code,
  affectedField,
  affectedValue,
  reason,
  requiresClarification = false,
  requiresCapability = false
) {
  context.gaps.push(planningGap(
    code,
    affectedField,
    affectedValue,
    reason,
    requiresClarification,
    requiresCapability
  ));
}

function planningGap(
  code,
  affectedField,
  affectedValue,
  reason,
  requiresClarification,
  requiresCapability
) {
  if (!GAP_CODE_SET.has(code) || !GAP_FIELD_SET.has(affectedField) ||
      !GAP_REASON_SET.has(reason)) {
    throw new OutdoorResearchPlannerError("invalid_generated_plan");
  }
  if (affectedValue !== null &&
      (typeof affectedValue !== "string" || affectedValue.length > 80)) {
    throw new OutdoorResearchPlannerError("invalid_generated_plan");
  }
  return {
    code,
    affectedField,
    affectedValue,
    reason,
    requiresClarification,
    requiresCapability
  };
}

function normalizeGaps(gaps) {
  const unique = new Map();
  for (const gap of gaps) {
    const key = JSON.stringify(gap);
    if (!unique.has(key)) unique.set(key, gap);
  }
  return [...unique.values()].sort((left, right) =>
    indexOf(RESEARCH_PLANNER_GAP_CODES_V1, left.code) -
      indexOf(RESEARCH_PLANNER_GAP_CODES_V1, right.code) ||
    left.affectedField.localeCompare(right.affectedField) ||
    (left.affectedValue ?? "").localeCompare(right.affectedValue ?? "") ||
    left.reason.localeCompare(right.reason)
  );
}

function ordered(values, order) {
  const unique = [...new Set(values)];
  return unique.sort((left, right) =>
    indexOf(order, left) - indexOf(order, right) ||
    String(left).localeCompare(String(right))
  );
}

function indexOf(values, value) {
  const index = values.indexOf(value);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}
