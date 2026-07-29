import {
  EVIDENCE_PREDICATES,
  RESEARCH_OPERATION_TYPES,
  SOURCE_CATEGORIES
} from "../../src/outdoorResearch/contracts.js";
import {
  buildResearchGuidedRouteCandidatePlanV1
} from "../../src/routeResearch/researchGuidedRouteCandidatePlanner.js";

export const SYNTHETIC_EVALUATION_CLOCK_V1 = "2026-07-22T10:00:00Z";

export const SYNTHETIC_EVALUATION_IDS_V1 = Object.freeze({
  harzRegion: "10000000-0000-4000-8000-000000000001",
  innsbruckRegion: "10000000-0000-4000-8000-000000000002",
  unsupportedRegion: "10000000-0000-4000-8000-000000000003",
  source: "20000000-0000-4000-8000-000000000001",
  secondSource: "20000000-0000-4000-8000-000000000002"
});

const BOOLEAN_PREDICATES = new Set([
  "public_access",
  "current_opening",
  "overnight_permission",
  "bookability",
  "drinking_water_availability",
  "viewpoint_presence",
  "waterfall_presence"
]);

export function syntheticEvaluationCapabilitiesV1(overrides = {}) {
  return {
    supportedRegionIds: [
      SYNTHETIC_EVALUATION_IDS_V1.harzRegion,
      SYNTHETIC_EVALUATION_IDS_V1.innsbruckRegion
    ],
    availableSourceCategories: [...SOURCE_CATEGORIES],
    supportedEvidencePredicates: [...EVIDENCE_PREDICATES],
    enabledOperationTypes: [...RESEARCH_OPERATION_TYPES],
    ...structuredClone(overrides)
  };
}

export function syntheticAdventureResearchIntentV1(spec = {}) {
  const region = spec.region ?? "harz";
  const anchor = syntheticAnchor(region, spec.anchorState);
  const base = {
    schemaVersion: 1,
    activity: "hiking",
    geographicAnchor: anchor,
    routeType: "loop",
    distanceRangeKm: { min: 10, max: 14 },
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
      mobility: "standard",
      experienceLevel: "intermediate"
    },
    dateOrSeason: null,
    overnightRequirements: {
      required: false,
      nights: 0,
      allowedAccommodationTypes: []
    },
    transportRequirements: {
      arrivalMode: "walking",
      returnToStart: true,
      publicTransportRequired: false
    },
    unresolvedClarificationQuestions: anchor.state === "unresolved"
      ? [{ code: "location_required", field: "geographicAnchor" }]
      : []
  };
  const patch = structuredClone(spec.intent ?? {});
  return {
    ...base,
    ...patch,
    geographicAnchor: patch.geographicAnchor ?? base.geographicAnchor,
    groupContext: {
      ...base.groupContext,
      ...(patch.groupContext ?? {})
    },
    overnightRequirements: {
      ...base.overnightRequirements,
      ...(patch.overnightRequirements ?? {})
    },
    transportRequirements: {
      ...base.transportRequirements,
      ...(patch.transportRequirements ?? {})
    }
  };
}

export function syntheticEvidenceClaimV1(spec = {}, index = 1) {
  const source = sourceDetails(spec.source ?? "mapped", index);
  const predicate = spec.predicate ?? "entity_category";
  return {
    schemaVersion: 1,
    claimId: spec.claimId ?? stableUuid(3, index),
    entityId: spec.entityId ?? stableUuid(4, spec.entityIndex ?? 1),
    predicate,
    value: spec.value ?? defaultEvidenceValue(predicate, spec.category),
    evidenceClass: source.evidenceClass,
    sourceReference: {
      sourceId: spec.sourceId ?? stableUuid(5, source.sourceIndex),
      sourceKey: source.sourceKey,
      sourceCategory: source.sourceCategory
    },
    provenance: {
      identifier: spec.provenanceIdentifier ?? `synthetic-record/${index}`,
      adapterVersion: "synthetic-evaluation-v1",
      recordVersion: 1
    },
    observedAt: spec.observedAt === undefined
      ? "2026-07-20T08:00:00Z"
      : spec.observedAt,
    retrievedAt: spec.retrievedAt ?? "2026-07-20T09:00:00Z",
    validFrom: spec.validFrom ?? null,
    validUntil: spec.validUntil ?? null,
    freshness: spec.freshness ?? "current",
    resolutionState: spec.resolutionState ?? "known",
    relevantLimitationCodes: spec.relevantLimitationCodes ??
      defaultLimitations(source.evidenceClass, predicate)
  };
}

export function syntheticAdventureResearchDossierV1(spec = {}) {
  const candidates = spec.candidates ?? [{
    category: "viewpoint",
    coordinate: coordinateFor(1)
  }];
  const evidenceClaims = [];
  const candidateHighlights = [];
  candidates.forEach((candidate, index) => {
    const ordinal = index + 1;
    const entityId = candidate.entityId ?? stableUuid(4, ordinal);
    const claimId = candidate.claimId ?? stableUuid(3, ordinal);
    evidenceClaims.push(syntheticEvidenceClaimV1({
      claimId,
      entityId,
      entityIndex: ordinal,
      category: candidate.category,
      predicate: "entity_category",
      value: { type: "text", value: candidate.category },
      source: candidate.source ?? "mapped"
    }, ordinal));
    candidateHighlights.push({
      schemaVersion: 1,
      entityId,
      highlightCategory: candidate.category,
      coordinate: candidate.coordinate ?? coordinateFor(ordinal),
      relevanceReasons: [{
        code: relevanceCode(candidate.category),
        evidenceClaimIds: [claimId]
      }],
      evidenceClaimIds: [claimId],
      knownLimitations: candidate.knownLimitations ?? [
        "access_unverified",
        "mapped_presence_only",
        "route_connection_unverified"
      ],
      suitabilityState: candidate.suitabilityState ?? "conditional",
      uncertaintyState: candidate.uncertaintyState ?? "insufficient_evidence"
    });
  });

  const mappedOrOfficialRouteCandidates = [];
  if (spec.mappedRoute === true) {
    const entityId = stableUuid(4, 90);
    const claimId = stableUuid(3, 90);
    evidenceClaims.push(syntheticEvidenceClaimV1({
      claimId,
      entityId,
      predicate: "entity_category",
      value: { type: "text", value: "hiking_route" },
      source: "mapped"
    }, 90));
    mappedOrOfficialRouteCandidates.push({
      entityId,
      entityCategory: "hiking_route",
      sourceBasis: "mapped",
      evidenceClaimIds: [claimId],
      knownLimitations: [
        "mapped_presence_only",
        "route_connection_unverified"
      ]
    });
  }

  if (spec.additionalClaims) {
    evidenceClaims.push(...spec.additionalClaims.map((claim) =>
      structuredClone(claim)
    ));
  }
  const sourceProvenanceSummary = [...evidenceClaims.reduce(
    (summaries, claim) => {
      const key = claim.sourceReference.sourceId;
      const existing = summaries.get(key);
      if (existing) {
        if (!existing.evidenceClasses.includes(claim.evidenceClass)) {
          existing.evidenceClasses.push(claim.evidenceClass);
          existing.evidenceClasses.sort();
        }
        return summaries;
      }
      summaries.set(key, {
        sourceId: claim.sourceReference.sourceId,
        sourceKey: claim.sourceReference.sourceKey,
        sourceCategory: claim.sourceReference.sourceCategory,
        evidenceClasses: [claim.evidenceClass],
        licenseIdentifier: "synthetic-evaluation-only",
        attributionRequired: false,
        retrievedAt: claim.retrievedAt
      });
      return summaries;
    },
    new Map()
  ).values()].sort((left, right) =>
    left.sourceId.localeCompare(right.sourceId)
  );
  const region = spec.region ?? "harz";
  const regionId = region === "innsbruck_alps"
    ? SYNTHETIC_EVALUATION_IDS_V1.innsbruckRegion
    : SYNTHETIC_EVALUATION_IDS_V1.harzRegion;
  const coverageState = spec.coverageState ?? "full";
  return {
    schemaVersion: 1,
    normalizedIntent: syntheticAdventureResearchIntentV1({
      region,
      intent: spec.intent ?? {}
    }),
    regionCoverage: {
      state: coverageState,
      regionEntityIds: [regionId],
      limitationCodes: coverageState === "full"
        ? []
        : ["partial_regional_coverage"]
    },
    evidenceClaims,
    candidateHighlights,
    mappedOrOfficialRouteCandidates,
    overnightCandidates: [],
    timeSensitiveChecks: [],
    conflictingEvidence: [],
    evidenceGaps: spec.evidenceGaps ?? [],
    unresolvedQuestions: [],
    sourceProvenanceSummary,
    generatedAt: "2026-07-20T10:00:00Z",
    expiresAt: "2026-07-23T10:00:00Z",
    freshnessState: spec.freshnessState ?? "current"
  };
}

export function syntheticResearchGuidedCandidatePlanV1(spec = {}) {
  return buildResearchGuidedRouteCandidatePlanV1(
    syntheticAdventureResearchDossierV1(spec),
    spec.maximumProposals === undefined
      ? {}
      : { maximumProposals: spec.maximumProposals }
  );
}

export function syntheticGraphHopperResponseV1(
  request,
  { snapOffsetDegrees = 0, malformed = false, empty = false } = {}
) {
  if (malformed) {
    return {
      provider: "graphhopper",
      paths: [{
        distance: 12_000,
        time: 10_800_000,
        points: { type: "LineString", coordinates: [] },
        instructions: [],
        providerPrivateError: "synthetic-private-provider-sentinel"
      }]
    };
  }
  if (empty) return { provider: "graphhopper", paths: [] };
  const coordinates = request.points.map((point, index) => [
    point.longitude + (index === 1 ? 0.002 : 0),
    point.latitude,
    500 + index * 25
  ]);
  if (coordinates.length === 2) {
    coordinates.splice(1, 0, [
      request.points[0].longitude + 0.002,
      request.points[0].latitude - 0.002,
      525
    ]);
  }
  const snappedCoordinates = request.points.map((point, index) => [
    point.longitude + (index === 1 ? snapOffsetDegrees : 0),
    point.latitude
  ]);
  return {
    provider: "graphhopper",
    paths: [{
      distance: 12_000,
      time: 10_800_000,
      ascend: 400,
      descend: 400,
      points: { type: "LineString", coordinates },
      instructions: [{
        text: "Continue",
        distance: 12_000,
        time: 10_800_000,
        interval: [0, coordinates.length - 1],
        sign: 0
      }],
      details: {
        surface: [[0, coordinates.length - 1, "ground"]],
        road_class: [[0, coordinates.length - 1, "path"]],
        hike_rating: [[0, coordinates.length - 1, "1"]]
      },
      snapped_waypoints: {
        type: "LineString",
        coordinates: snappedCoordinates
      }
    }]
  };
}

function syntheticAnchor(region, anchorState) {
  if (anchorState === "unresolved" || region === "none") {
    return { state: "unresolved", requirementCode: "location_required" };
  }
  if (region === "innsbruck_alps") {
    return {
      state: "resolved",
      name: "Synthetic Innsbruck Alps anchor",
      coordinate: { latitude: 47.2692, longitude: 11.4041 },
      regionEntityId: SYNTHETIC_EVALUATION_IDS_V1.innsbruckRegion
    };
  }
  if (region === "unsupported") {
    return {
      state: "resolved",
      name: "Synthetic unsupported-region anchor",
      coordinate: { latitude: 48, longitude: 12 },
      regionEntityId: SYNTHETIC_EVALUATION_IDS_V1.unsupportedRegion
    };
  }
  return {
    state: "resolved",
    name: "Synthetic Harz anchor",
    coordinate: { latitude: 51.8, longitude: 10.6 },
    regionEntityId: SYNTHETIC_EVALUATION_IDS_V1.harzRegion
  };
}

function sourceDetails(source, index) {
  const values = {
    official: {
      evidenceClass: "official",
      sourceCategory: "official_authority",
      sourceKey: "synthetic.official-authority",
      sourceIndex: 10 + index
    },
    official_operator: {
      evidenceClass: "official",
      sourceCategory: "official_operator",
      sourceKey: "synthetic.official-operator",
      sourceIndex: 20 + index
    },
    mapped: {
      evidenceClass: "mapped",
      sourceCategory: "openstreetmap_open_mapping",
      sourceKey: "synthetic.open-mapping",
      sourceIndex: 30 + index
    },
    community: {
      evidenceClass: "community_observed",
      sourceCategory: "trailmind_community",
      sourceKey: "synthetic.community",
      sourceIndex: 40 + index
    },
    derived: {
      evidenceClass: "derived",
      sourceCategory: "derived_computation",
      sourceKey: "synthetic.derived",
      sourceIndex: 50 + index
    },
    model: {
      evidenceClass: "model_inferred",
      sourceCategory: "model_inference",
      sourceKey: "synthetic.model",
      sourceIndex: 60 + index
    }
  };
  return values[source] ?? values.mapped;
}

function defaultEvidenceValue(predicate, category) {
  if (BOOLEAN_PREDICATES.has(predicate)) {
    return { type: "boolean", value: true };
  }
  const values = {
    entity_category: category ?? "viewpoint",
    access_restriction: "restricted",
    seasonal_opening: "open_seasonally",
    trail_difficulty: "hiking",
    trail_visibility: "good",
    closure_status: "open",
    name: "Synthetic entity",
    operator: "Synthetic operator",
    mapped_hiking_route_membership: "synthetic-route"
  };
  return { type: "text", value: values[predicate] ?? "synthetic" };
}

function defaultLimitations(evidenceClass, predicate) {
  if (evidenceClass === "official") return [];
  if (predicate === "entity_category") return ["mapped_presence_only"];
  return ["insufficient_evidence"];
}

function relevanceCode(category) {
  if (category === "viewpoint") return "mapped_viewpoint";
  if (category === "waterfall") return "mapped_waterfall";
  return "request_must_have";
}

function coordinateFor(index) {
  return {
    latitude: 51.8 + index * 0.01,
    longitude: 10.6 + index * 0.015
  };
}

function stableUuid(namespace, index) {
  return `${String(namespace).padStart(8, "0")}-0000-4000-8000-${String(index)
    .padStart(12, "0")}`;
}
