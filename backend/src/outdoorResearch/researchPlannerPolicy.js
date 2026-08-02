import {
  ENTITY_CATEGORIES,
  EVIDENCE_PREDICATES,
  RESEARCH_OPERATION_TYPES,
  SOURCE_CATEGORIES
} from "./contracts.js";

export const RESEARCH_PLANNER_CAPABILITY_FIELDS_V1 = Object.freeze([
  "supportedRegionIds",
  "availableSourceCategories",
  "supportedEvidencePredicates",
  "enabledOperationTypes"
]);

export const RESEARCH_PLANNER_GAP_CODES_V1 = Object.freeze([
  "unsupported_region",
  "unsupported_evidence_dimension",
  "official_source_unavailable",
  "current_source_unavailable",
  "mapped_source_unavailable",
  "derived_source_unavailable",
  "operation_type_unavailable",
  "predicate_unavailable",
  "transport_evidence_not_modeled",
  "biking_network_not_modeled",
  "toilet_evidence_not_modeled",
  "scenic_quality_not_verifiable",
  "water_availability_source_missing"
]);

export const RESEARCH_PLANNER_GAP_REASONS_V1 = Object.freeze([
  "coverage_not_configured",
  "contract_dimension_missing",
  "accepted_source_not_available",
  "operation_not_enabled",
  "predicate_not_supported",
  "authority_not_available",
  "current_evidence_not_available",
  "clarification_needed"
]);

export const RESEARCH_PLANNER_AFFECTED_FIELDS_V1 = Object.freeze([
  "activity",
  "geographicAnchor",
  "maximumElevationGainMeters",
  "maximumTechnicalDifficulty",
  "mustHaveExperiences",
  "preferredExperiences",
  "avoidedExperiences",
  "requiredFacilities",
  "groupContext",
  "dateOrSeason",
  "overnightRequirements",
  "transportRequirements",
  "capabilities",
  "researchPlan"
]);

const INFORMATION_NEEDS = [
  "highlight_candidates",
  "mapped_hiking_routes",
  "terrain_characteristics",
  "access_and_legal_status",
  "opening_and_operating_status",
  "overnight_legality",
  "seasonal_relevance",
  "recent_conditions"
];

const REASON_CODES = [
  "must_have_experience",
  "preferred_experience",
  "avoidance_constraint",
  "required_facility",
  "high_stakes_verification",
  "seasonal_verification",
  "coverage_gap",
  "overnight_requirement"
];

const EXPERIENCE_ENTITY_CATEGORIES = Object.freeze({
  viewpoint: Object.freeze(["viewpoint"]),
  waterfall: Object.freeze(["waterfall"]),
  peak: Object.freeze(["peak"]),
  lake: Object.freeze(["lake"]),
  alpine_hut: Object.freeze(["alpine_hut"]),
  wilderness_hut: Object.freeze(["wilderness_hut"]),
  landmark: Object.freeze(["landmark"])
});

const EXPERIENCE_PREDICATES = Object.freeze({
  viewpoint: Object.freeze(["entity_category", "viewpoint_presence"]),
  waterfall: Object.freeze(["entity_category", "waterfall_presence"]),
  peak: Object.freeze(["entity_category"]),
  lake: Object.freeze(["entity_category"]),
  alpine_hut: Object.freeze(["entity_category"]),
  wilderness_hut: Object.freeze(["entity_category"]),
  landmark: Object.freeze(["entity_category"])
});

const FACILITY_ENTITY_CATEGORIES = Object.freeze({
  lunch_hut: Object.freeze(["alpine_hut", "wilderness_hut"]),
  emergency_shelter: Object.freeze(["emergency_shelter"]),
  official_campsite: Object.freeze(["official_campsite"]),
  designated_bivouac: Object.freeze(["designated_bivouac"])
});

const OPERATION_ORDER = Object.freeze([
  "discover_highlights",
  "retrieve_mapped_hiking_routes",
  "analyze_terrain",
  "inspect_access_evidence",
  "check_current_status",
  "research_overnight_options",
  "check_seasonal_evidence",
  "check_recent_conditions"
]);

const policy = {
  maximumCapabilityBytes: 16 * 1_024,
  maximumSupportedRegions: 32,
  sourceCategories: SOURCE_CATEGORIES,
  entityCategories: ENTITY_CATEGORIES,
  evidencePredicates: EVIDENCE_PREDICATES,
  operationTypes: RESEARCH_OPERATION_TYPES,
  informationNeeds: INFORMATION_NEEDS,
  reasonCodes: REASON_CODES,
  operationOrder: OPERATION_ORDER,
  sourceScopes: {
    mappedDiscovery: ["openstreetmap_open_mapping", "wikimedia_open_knowledge"],
    officialOnly: ["official_authority", "official_operator"],
    terrainAnalysis: ["derived_computation", "official_authority"],
    currentOfficial: ["official_authority", "official_operator"]
  },
  foundationalHikingNetwork: {
    operationType: "retrieve_mapped_hiking_routes",
    informationNeed: "mapped_hiking_routes",
    reasonCode: "coverage_gap",
    requiredPredicate: "mapped_hiking_route_membership",
    requiredPredicates: ["entity_category", "mapped_hiking_route_membership"],
    sourceCategories: ["openstreetmap_open_mapping"]
  },
  defaultMappedHighlightDiscovery: {
    operationType: "discover_highlights",
    informationNeed: "highlight_candidates",
    reasonCode: "coverage_gap",
    requiredPredicate: "entity_category",
    sourceCategories: ["openstreetmap_open_mapping"],
    entityCategories: ["viewpoint", "waterfall"]
  },
  experienceEntityCategories: EXPERIENCE_ENTITY_CATEGORIES,
  experiencePredicates: EXPERIENCE_PREDICATES,
  facilityEntityCategories: FACILITY_ENTITY_CATEGORIES,
  unsupportedExperiences: ["forest", "quiet_trails"],
  unsupportedAvoidances: ["major_roads", "repeated_path", "crowds", "unpaved_surface"],
  terrainAvoidances: ["exposed_trails", "technical_terrain", "steep_climbs"],
  currentFacilityEntityCategories: ["alpine_hut", "wilderness_hut"],
  highStakesPredicates: [
    "public_access",
    "access_restriction",
    "current_opening",
    "seasonal_opening",
    "overnight_permission",
    "bookability",
    "drinking_water_availability",
    "closure_status"
  ]
};

export const OUTDOOR_RESEARCH_PLANNER_POLICY_V1 = deepFreeze(policy);

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}
