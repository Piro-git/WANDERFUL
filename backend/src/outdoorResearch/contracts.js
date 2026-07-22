export const OUTDOOR_RESEARCH_SCHEMA_VERSION = 1;

export const OUTDOOR_RESEARCH_LIMITS = Object.freeze({
  intentBytes: 48 * 1_024,
  planBytes: 64 * 1_024,
  evidenceClaimBytes: 16 * 1_024,
  highlightCandidateBytes: 16 * 1_024,
  dossierBytes: 512 * 1_024,
  maximumIntentItems: 16,
  maximumResearchOperations: 24,
  maximumEvidenceClaims: 160,
  maximumHighlightCandidates: 32,
  maximumRouteCandidates: 24,
  maximumOvernightCandidates: 24,
  maximumSourceSummaries: 48
});

export const SOURCE_CATEGORIES = Object.freeze([
  "official_authority",
  "official_operator",
  "openstreetmap_open_mapping",
  "wikimedia_open_knowledge",
  "licensed_partner",
  "trailmind_community",
  "derived_computation",
  "model_inference"
]);

export const EVIDENCE_CLASSES = Object.freeze([
  "official", "mapped", "community_observed", "derived", "model_inferred", "unknown"
]);

export const ENTITY_CATEGORIES = Object.freeze([
  "viewpoint", "waterfall", "peak", "lake", "alpine_hut", "wilderness_hut",
  "official_campsite", "designated_bivouac", "emergency_shelter", "trailhead",
  "landmark", "hiking_route", "trail_segment", "region", "organization"
]);

export const EVIDENCE_PREDICATES = Object.freeze([
  "entity_category", "name", "operator", "public_access", "access_restriction",
  "current_opening", "seasonal_opening", "overnight_permission", "bookability",
  "drinking_water_availability", "trail_difficulty", "trail_visibility",
  "viewpoint_presence", "waterfall_presence", "mapped_hiking_route_membership",
  "closure_status"
]);

export const HIGH_STAKES_PREDICATES = Object.freeze([
  "public_access", "access_restriction", "current_opening", "seasonal_opening",
  "overnight_permission", "bookability", "drinking_water_availability", "closure_status"
]);

export const RESEARCH_OPERATION_TYPES = Object.freeze([
  "discover_highlights", "retrieve_mapped_hiking_routes", "analyze_terrain",
  "inspect_access_evidence", "check_current_status", "research_overnight_options",
  "check_seasonal_evidence", "check_recent_conditions"
]);

export const CONTRACT_NAMES = Object.freeze([
  "AdventureResearchIntentV1",
  "ResearchPlanV1",
  "EvidenceClaimV1",
  "HighlightCandidateV1",
  "AdventureResearchDossierV1"
]);

// This manifest is the checked-in, machine-readable version/size/field contract.
// Runtime validation in validation.js is authoritative for nested shapes and vocabularies.
export const OUTDOOR_RESEARCH_CONTRACT_MANIFEST_V1 = Object.freeze({
  AdventureResearchIntentV1: Object.freeze({
    schemaVersion: 1,
    maximumSerializedBytes: OUTDOOR_RESEARCH_LIMITS.intentBytes,
    fields: Object.freeze([
      "schemaVersion", "activity", "geographicAnchor", "routeType", "distanceRangeKm",
      "durationRangeMinutes", "maximumElevationGainMeters", "maximumTechnicalDifficulty",
      "mustHaveExperiences", "preferredExperiences", "avoidedExperiences",
      "requiredFacilities", "groupContext", "dateOrSeason", "overnightRequirements",
      "transportRequirements", "unresolvedClarificationQuestions"
    ])
  }),
  ResearchPlanV1: Object.freeze({
    schemaVersion: 1,
    maximumSerializedBytes: OUTDOOR_RESEARCH_LIMITS.planBytes,
    fields: Object.freeze(["schemaVersion", "intentSchemaVersion", "operations"])
  }),
  EvidenceClaimV1: Object.freeze({
    schemaVersion: 1,
    maximumSerializedBytes: OUTDOOR_RESEARCH_LIMITS.evidenceClaimBytes,
    fields: Object.freeze([
      "schemaVersion", "claimId", "entityId", "predicate", "value", "evidenceClass",
      "sourceReference", "provenance", "observedAt", "retrievedAt", "validFrom",
      "validUntil", "freshness", "resolutionState", "relevantLimitationCodes"
    ])
  }),
  HighlightCandidateV1: Object.freeze({
    schemaVersion: 1,
    maximumSerializedBytes: OUTDOOR_RESEARCH_LIMITS.highlightCandidateBytes,
    fields: Object.freeze([
      "schemaVersion", "entityId", "highlightCategory", "coordinate", "relevanceReasons",
      "evidenceClaimIds", "knownLimitations", "suitabilityState", "uncertaintyState"
    ])
  }),
  AdventureResearchDossierV1: Object.freeze({
    schemaVersion: 1,
    maximumSerializedBytes: OUTDOOR_RESEARCH_LIMITS.dossierBytes,
    fields: Object.freeze([
      "schemaVersion", "normalizedIntent", "regionCoverage", "evidenceClaims",
      "candidateHighlights", "mappedOrOfficialRouteCandidates", "overnightCandidates",
      "timeSensitiveChecks", "conflictingEvidence", "evidenceGaps", "unresolvedQuestions",
      "sourceProvenanceSummary", "generatedAt", "expiresAt", "freshnessState"
    ])
  })
});
