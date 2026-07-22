export const OUTDOOR_RESEARCH_TEST_IDS = Object.freeze({
  entity: "11111111-1111-4111-8111-111111111111",
  secondEntity: "22222222-2222-4222-8222-222222222222",
  region: "33333333-3333-4333-8333-333333333333",
  source: "44444444-4444-4444-8444-444444444444",
  secondSource: "55555555-5555-4555-8555-555555555555",
  claim: "66666666-6666-4666-8666-666666666666",
  secondClaim: "77777777-7777-4777-8777-777777777777"
});

export function completeAdventureResearchIntent(overrides = {}) {
  return {
    schemaVersion: 1,
    activity: "hiking",
    geographicAnchor: {
      state: "resolved",
      name: "Innsbruck",
      coordinate: { latitude: 47.2692, longitude: 11.4041 },
      regionEntityId: OUTDOOR_RESEARCH_TEST_IDS.region
    },
    routeType: "loop",
    distanceRangeKm: { min: 10, max: 16 },
    durationRangeMinutes: { min: 210, max: 270 },
    maximumElevationGainMeters: 700,
    maximumTechnicalDifficulty: "hiking",
    mustHaveExperiences: [
      { experience: "viewpoint", minimumCount: 2 },
      { experience: "waterfall", minimumCount: 1 }
    ],
    preferredExperiences: ["alpine_hut"],
    avoidedExperiences: ["exposed_trails"],
    requiredFacilities: ["lunch_hut"],
    groupContext: {
      partySize: 2,
      includesChildren: false,
      youngestAge: null,
      mobility: "standard",
      experienceLevel: "intermediate"
    },
    dateOrSeason: { kind: "season", season: "summer", year: 2026 },
    overnightRequirements: {
      required: false,
      nights: 0,
      allowedAccommodationTypes: []
    },
    transportRequirements: {
      arrivalMode: "public_transport",
      returnToStart: true,
      publicTransportRequired: false
    },
    unresolvedClarificationQuestions: [],
    ...overrides
  };
}

export function minimalAdventureResearchIntent(overrides = {}) {
  return completeAdventureResearchIntent({
    geographicAnchor: { state: "unresolved", requirementCode: "location_required" },
    distanceRangeKm: null,
    durationRangeMinutes: null,
    maximumElevationGainMeters: null,
    maximumTechnicalDifficulty: null,
    mustHaveExperiences: [],
    preferredExperiences: [],
    avoidedExperiences: [],
    requiredFacilities: [],
    groupContext: {
      partySize: 1,
      includesChildren: false,
      youngestAge: null,
      mobility: "unknown",
      experienceLevel: "unknown"
    },
    dateOrSeason: null,
    transportRequirements: {
      arrivalMode: "unknown",
      returnToStart: true,
      publicTransportRequired: false
    },
    unresolvedClarificationQuestions: [{ code: "location_required", field: "geographicAnchor" }],
    ...overrides
  });
}

export function researchPlan(overrides = {}) {
  return {
    schemaVersion: 1,
    intentSchemaVersion: 1,
    operations: [{
      operationId: "discover_viewpoints",
      operationType: "discover_highlights",
      informationNeed: "highlight_candidates",
      reasonCode: "must_have_experience",
      acceptableSourceCategories: ["openstreetmap_open_mapping", "official_authority"],
      entityCategories: ["viewpoint", "waterfall"],
      predicates: ["entity_category", "viewpoint_presence", "waterfall_presence"]
    }],
    ...overrides
  };
}

export function evidenceClaim(overrides = {}) {
  return {
    schemaVersion: 1,
    claimId: OUTDOOR_RESEARCH_TEST_IDS.claim,
    entityId: OUTDOOR_RESEARCH_TEST_IDS.entity,
    predicate: "entity_category",
    value: { type: "text", value: "viewpoint" },
    evidenceClass: "mapped",
    sourceReference: {
      sourceId: OUTDOOR_RESEARCH_TEST_IDS.source,
      sourceKey: "openstreetmap.harz-v1",
      sourceCategory: "openstreetmap_open_mapping"
    },
    provenance: {
      identifier: "node/123",
      adapterVersion: "osm-graph-v1",
      recordVersion: 7
    },
    observedAt: "2026-07-20T08:00:00Z",
    retrievedAt: "2026-07-20T09:00:00Z",
    validFrom: null,
    validUntil: null,
    freshness: "current",
    resolutionState: "known",
    relevantLimitationCodes: ["mapped_presence_only"],
    ...overrides
  };
}

export function officialClaim(overrides = {}) {
  return evidenceClaim({
    predicate: "public_access",
    value: { type: "boolean", value: true },
    evidenceClass: "official",
    sourceReference: {
      sourceId: OUTDOOR_RESEARCH_TEST_IDS.source,
      sourceKey: "tirol.authority",
      sourceCategory: "official_authority"
    },
    provenance: {
      identifier: "access-record/123",
      adapterVersion: "authority-v1",
      recordVersion: 1
    },
    relevantLimitationCodes: [],
    ...overrides
  });
}

export function highlightCandidate(overrides = {}) {
  return {
    schemaVersion: 1,
    entityId: OUTDOOR_RESEARCH_TEST_IDS.entity,
    highlightCategory: "viewpoint",
    coordinate: { latitude: 47.28, longitude: 11.42 },
    relevanceReasons: [{
      code: "mapped_viewpoint",
      evidenceClaimIds: [OUTDOOR_RESEARCH_TEST_IDS.claim]
    }],
    evidenceClaimIds: [OUTDOOR_RESEARCH_TEST_IDS.claim],
    knownLimitations: ["mapped_presence_only"],
    suitabilityState: "conditional",
    uncertaintyState: "insufficient_evidence",
    ...overrides
  };
}

export function adventureResearchDossier(overrides = {}) {
  return {
    schemaVersion: 1,
    normalizedIntent: completeAdventureResearchIntent(),
    regionCoverage: {
      state: "partial",
      regionEntityIds: [OUTDOOR_RESEARCH_TEST_IDS.region],
      limitationCodes: ["partial_regional_coverage"]
    },
    evidenceClaims: [evidenceClaim()],
    candidateHighlights: [highlightCandidate()],
    mappedOrOfficialRouteCandidates: [],
    overnightCandidates: [],
    timeSensitiveChecks: [],
    conflictingEvidence: [],
    evidenceGaps: [{
      code: "missing_access_evidence",
      entityId: OUTDOOR_RESEARCH_TEST_IDS.entity,
      predicate: "public_access"
    }],
    unresolvedQuestions: [],
    sourceProvenanceSummary: [{
      sourceId: OUTDOOR_RESEARCH_TEST_IDS.source,
      sourceKey: "openstreetmap.harz-v1",
      sourceCategory: "openstreetmap_open_mapping",
      evidenceClasses: ["mapped"],
      licenseIdentifier: "ODbL-1.0",
      attributionRequired: true,
      retrievedAt: "2026-07-20T09:00:00Z"
    }],
    generatedAt: "2026-07-20T10:00:00Z",
    expiresAt: "2026-07-21T10:00:00Z",
    freshnessState: "current",
    ...overrides
  };
}
