import {
  adventureResearchDossier,
  completeAdventureResearchIntent,
  evidenceClaim,
  highlightCandidate,
  OUTDOOR_RESEARCH_TEST_IDS
} from "../outdoorResearchTestSupport.js";

const HARZ_REGION_ID = "30000000-0000-4000-8000-000000000002";
const INNSBRUCK_REGION_ID = "30000000-0000-4000-8000-000000000001";

export const HARZ_DOSSIER_EXAMPLE_V1 = adventureResearchDossier({
  normalizedIntent: exampleIntent({
    name: "Harz",
    latitude: 51.8,
    longitude: 10.6,
    regionEntityId: HARZ_REGION_ID,
    experience: "viewpoint"
  }),
  regionCoverage: {
    state: "full",
    regionEntityIds: [HARZ_REGION_ID],
    limitationCodes: []
  },
  candidateHighlights: [highlightCandidate({
    knownLimitations: [
      "mapped_presence_only",
      "route_connection_unverified"
    ]
  })],
  evidenceGaps: [{
    code: "missing_access_evidence",
    entityId: null,
    predicate: "access_restriction"
  }, {
    code: "missing_route_connection",
    entityId: null,
    predicate: null
  }]
});

const innsbruckClaim = evidenceClaim({
  claimId: OUTDOOR_RESEARCH_TEST_IDS.secondClaim,
  entityId: OUTDOOR_RESEARCH_TEST_IDS.secondEntity,
  predicate: "entity_category",
  value: { type: "text", value: "waterfall" },
  provenance: {
    identifier: "node/456",
    adapterVersion: "osm-graph-v1",
    recordVersion: 4
  }
});

export const INNSBRUCK_DOSSIER_EXAMPLE_V1 = adventureResearchDossier({
  normalizedIntent: exampleIntent({
    name: "Innsbruck Alpine Pilot",
    latitude: 47.2692,
    longitude: 11.4041,
    regionEntityId: INNSBRUCK_REGION_ID,
    experience: "waterfall"
  }),
  regionCoverage: {
    state: "full",
    regionEntityIds: [INNSBRUCK_REGION_ID],
    limitationCodes: []
  },
  evidenceClaims: [innsbruckClaim],
  candidateHighlights: [highlightCandidate({
    entityId: OUTDOOR_RESEARCH_TEST_IDS.secondEntity,
    highlightCategory: "waterfall",
    coordinate: { latitude: 47.28, longitude: 11.42 },
    relevanceReasons: [{
      code: "mapped_waterfall",
      evidenceClaimIds: [OUTDOOR_RESEARCH_TEST_IDS.secondClaim]
    }, {
      code: "request_must_have",
      evidenceClaimIds: [OUTDOOR_RESEARCH_TEST_IDS.secondClaim]
    }],
    evidenceClaimIds: [OUTDOOR_RESEARCH_TEST_IDS.secondClaim],
    knownLimitations: [
      "mapped_presence_only",
      "route_connection_unverified"
    ]
  })],
  evidenceGaps: [{
    code: "missing_access_evidence",
    entityId: null,
    predicate: "access_restriction"
  }, {
    code: "missing_route_connection",
    entityId: null,
    predicate: null
  }]
});

export const INSUFFICIENT_EVIDENCE_DOSSIER_EXAMPLE_V1 =
  adventureResearchDossier({
    normalizedIntent: exampleIntent({
      name: "Harz",
      latitude: 51.8,
      longitude: 10.6,
      regionEntityId: HARZ_REGION_ID,
      experience: "viewpoint",
      minimumCount: 2
    }),
    regionCoverage: {
      state: "full",
      regionEntityIds: [HARZ_REGION_ID],
      limitationCodes: []
    },
    evidenceClaims: [],
    candidateHighlights: [],
    sourceProvenanceSummary: [],
    freshnessState: "unknown",
    evidenceGaps: [{
      code: "insufficient_candidate_count",
      experience: "viewpoint",
      requiredMinimumCount: 2,
      foundCount: 0
    }, {
      code: "missing_route_connection",
      entityId: null,
      predicate: null
    }]
  });

export const STALE_SOURCE_RESULT_EXAMPLE_V1 = Object.freeze({
  state: "unsupported",
  normalizedIntent: exampleIntent({
    name: "Innsbruck Alpine Pilot",
    latitude: 47.2692,
    longitude: 11.4041,
    regionEntityId: INNSBRUCK_REGION_ID,
    experience: "viewpoint"
  }),
  planningGaps: Object.freeze([Object.freeze({
    code: "mapped_source_unavailable",
    affectedField: "capabilities",
    affectedValue: "openstreetmap_open_mapping",
    reason: "accepted_source_not_available",
    requiresClarification: false,
    requiresCapability: true
  })]),
  availabilityState: "source_stale"
});

function exampleIntent(input) {
  return completeAdventureResearchIntent({
    geographicAnchor: {
      state: "resolved",
      name: input.name,
      coordinate: {
        latitude: input.latitude,
        longitude: input.longitude
      },
      regionEntityId: input.regionEntityId
    },
    distanceRangeKm: { min: 10, max: 14 },
    durationRangeMinutes: null,
    maximumElevationGainMeters: null,
    maximumTechnicalDifficulty: null,
    mustHaveExperiences: [{
      experience: input.experience,
      minimumCount: input.minimumCount ?? 1
    }],
    preferredExperiences: [],
    avoidedExperiences: [],
    requiredFacilities: [],
    dateOrSeason: null,
    transportRequirements: {
      arrivalMode: "walking",
      returnToStart: true,
      publicTransportRequired: false
    }
  });
}
