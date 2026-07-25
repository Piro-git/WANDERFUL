import { OUTDOOR_RESEARCH_LIMITS } from "./contracts.js";
import { resolveEvidenceClaimsV1 } from "./evidenceResolution.js";
import {
  outdoorResearchExecutorError,
  strictExecutorDateV1
} from "./executorPolicy.js";
import {
  validateAdventureResearchDossierV1
} from "./validation.js";

const HIGHLIGHT_CATEGORIES = new Set([
  "viewpoint",
  "waterfall",
  "peak",
  "lake",
  "alpine_hut",
  "wilderness_hut",
  "landmark"
]);
const HUT_CATEGORIES = new Set(["alpine_hut", "wilderness_hut"]);
const GAP_PREDICATES = Object.freeze({
  missing_access_evidence: "access_restriction",
  missing_opening_evidence: "current_opening",
  missing_overnight_evidence: "overnight_permission",
  missing_water_evidence: "drinking_water_availability",
  missing_current_conditions: "closure_status",
  missing_official_status: null,
  missing_route_connection: null,
  missing_seasonal_evidence: "seasonal_opening",
  partial_region_coverage: null
});

export function assembleAdventureResearchDossierV1(input) {
  try {
    const records = validateRecords(input?.evidenceRecords);
    const claims = uniqueSortedClaims(records);
    const generatedAt = timestamp(input?.generatedAt);
    const claimsByCohort = cohortClaims(claims);
    const resolutions = resolveCohorts(claimsByCohort, generatedAt);
    const candidateHighlights = assembleHighlightCandidates(
      records,
      claimsByCohort,
      resolutions,
      input.normalizedIntent
    );
    const mappedOrOfficialRouteCandidates = assembleRouteCandidates(
      records,
      claimsByCohort,
      resolutions
    );
    const overnightCandidates = assembleOvernightCandidates(
      candidateHighlights,
      claimsByCohort,
      resolutions,
      input.normalizedIntent
    );
    const evidenceGaps = assembleEvidenceGaps({
      intent: input.normalizedIntent,
      planningGaps: input.planningGaps,
      highlights: candidateHighlights,
      routes: mappedOrOfficialRouteCandidates,
      claims,
      regionEntityId: input.binding.regionEntityId,
      partialCoverage: input.searchRadiusMeters >
        input.snapshot.boundaryDistanceMeters
    });
    const conflictingEvidence = assembleConflicts(resolutions);
    const timeSensitiveChecks = assembleTimeSensitiveChecks(
      claimsByCohort,
      resolutions,
      evidenceGaps,
      input.binding.regionEntityId
    );
    const dossier = {
      schemaVersion: 1,
      normalizedIntent: input.normalizedIntent,
      regionCoverage: {
        state: input.searchRadiusMeters <= input.snapshot.boundaryDistanceMeters
          ? "full"
          : "partial",
        regionEntityIds: [input.binding.regionEntityId],
        limitationCodes:
          input.searchRadiusMeters <= input.snapshot.boundaryDistanceMeters
            ? []
            : ["partial_regional_coverage"]
      },
      evidenceClaims: claims,
      candidateHighlights,
      mappedOrOfficialRouteCandidates,
      overnightCandidates,
      timeSensitiveChecks,
      conflictingEvidence,
      evidenceGaps,
      unresolvedQuestions: input.normalizedIntent.unresolvedClarificationQuestions,
      sourceProvenanceSummary: assembleSourceSummaries(records),
      generatedAt,
      expiresAt: dossierExpiry(input.snapshot, generatedAt),
      freshnessState: dossierFreshness(claims)
    };
    return validateAdventureResearchDossierV1(dossier);
  } catch (error) {
    if (error?.name === "OutdoorResearchExecutorError") throw error;
    throw outdoorResearchExecutorError("dossier_validation_failed", {
      cause: error
    });
  }
}

function validateRecords(input) {
  if (!Array.isArray(input) ||
      input.length > OUTDOOR_RESEARCH_LIMITS.maximumEvidenceClaims * 2) {
    throw outdoorResearchExecutorError("result_too_large");
  }
  return input.map((record) => {
    if (!record || typeof record !== "object" || Array.isArray(record) ||
        !record.claim || !record.sourceMetadata ||
        typeof record.entityCategory !== "string") {
      throw outdoorResearchExecutorError("malformed_evidence");
    }
    if (record.coordinate !== null) {
      if (!record.coordinate || !Number.isFinite(record.coordinate.latitude) ||
          !Number.isFinite(record.coordinate.longitude) ||
          record.coordinate.latitude < -90 || record.coordinate.latitude > 90 ||
          record.coordinate.longitude < -180 || record.coordinate.longitude > 180 ||
          !Number.isFinite(record.distanceMeters) || record.distanceMeters < 0) {
        throw outdoorResearchExecutorError("malformed_evidence");
      }
    }
    return record;
  });
}

function uniqueSortedClaims(records) {
  const byId = new Map();
  for (const record of records) {
    const canonical = JSON.stringify(record.claim);
    const existing = byId.get(record.claim.claimId);
    if (existing && existing.canonical !== canonical) {
      throw outdoorResearchExecutorError("malformed_evidence");
    }
    if (!existing) byId.set(record.claim.claimId, { canonical, claim: record.claim });
  }
  if (byId.size > OUTDOOR_RESEARCH_LIMITS.maximumEvidenceClaims) {
    throw outdoorResearchExecutorError("result_too_large");
  }
  return [...byId.values()]
    .map((entry) => entry.claim)
    .sort(compareClaims);
}

function cohortClaims(claims) {
  const cohorts = new Map();
  for (const claim of claims) {
    const key = cohortKey(claim.entityId, claim.predicate);
    if (!cohorts.has(key)) cohorts.set(key, []);
    cohorts.get(key).push(claim);
  }
  return cohorts;
}

function resolveCohorts(cohorts, generatedAt) {
  const resolutions = new Map();
  for (const [key, claims] of [...cohorts.entries()].sort(([left], [right]) =>
    left.localeCompare(right)
  )) {
    const [entityId, predicate] = key.split("|");
    resolutions.set(key, resolveEvidenceClaimsV1(claims, {
      now: generatedAt,
      entityId,
      predicate
    }));
  }
  return resolutions;
}

function assembleHighlightCandidates(records, cohorts, resolutions, intent) {
  const metadataByEntity = entityMetadata(records);
  const categories = categoryClaims(cohorts, resolutions);
  const candidates = [];
  for (const [entityId, category] of categories) {
    if (!HIGHLIGHT_CATEGORIES.has(category)) continue;
    const metadata = metadataByEntity.get(entityId);
    if (!metadata?.coordinate) continue;
    if (metadata.entityCategory !== category) {
      throw outdoorResearchExecutorError("malformed_evidence");
    }
    const supportClaim = knownCategorySupport(entityId, category, cohorts, resolutions);
    if (!supportClaim) continue;
    const reasons = relevanceReasons(intent, category, supportClaim.claimId);
    if (reasons.length === 0) continue;
    const referencedClaims = candidateClaims(
      entityId,
      cohorts,
      resolutions,
      new Set([
        "entity_category",
        "name",
        "viewpoint_presence",
        "waterfall_presence"
      ])
    );
    const limitations = new Set(referencedClaims.flatMap((claim) =>
      claim.relevantLimitationCodes
    ));
    limitations.add("access_unverified");
    limitations.add("route_connection_unverified");
    if (HUT_CATEGORIES.has(category)) {
      addHutLimitations(limitations);
    }
    candidates.push({
      candidate: {
        schemaVersion: 1,
        entityId,
        highlightCategory: category,
        coordinate: metadata.coordinate,
        relevanceReasons: reasons,
        evidenceClaimIds: referencedClaims.map((claim) => claim.claimId),
        knownLimitations: [...limitations].sort(),
        suitabilityState: "conditional",
        uncertaintyState: candidateUncertainty(
          referencedClaims,
          resolutions
        )
      },
      distanceMeters: metadata.distanceMeters,
      tier: candidateTier(intent, category)
    });
  }
  return candidates
    .sort((left, right) =>
      left.tier - right.tier ||
      left.distanceMeters - right.distanceMeters ||
      left.candidate.entityId.localeCompare(right.candidate.entityId)
    )
    .slice(0, OUTDOOR_RESEARCH_LIMITS.maximumHighlightCandidates)
    .map((entry) => entry.candidate);
}

function assembleRouteCandidates(records, cohorts, resolutions) {
  const categories = categoryClaims(cohorts, resolutions);
  const distanceByRoute = new Map();
  for (const record of records) {
    if (record.relationship !== true) continue;
    const current = distanceByRoute.get(record.claim.entityId);
    if (current === undefined || record.distanceMeters < current) {
      distanceByRoute.set(record.claim.entityId, record.distanceMeters);
    }
  }
  const candidates = [];
  for (const [entityId, category] of categories) {
    if (category !== "hiking_route") continue;
    const categoryClaim = knownCategorySupport(
      entityId,
      category,
      cohorts,
      resolutions
    );
    const membership = knownClaims(
      cohorts.get(cohortKey(entityId, "mapped_hiking_route_membership")) ?? [],
      resolutions.get(cohortKey(entityId, "mapped_hiking_route_membership"))
    );
    if (!categoryClaim || membership.length === 0) continue;
    const claims = [
      categoryClaim,
      ...membership,
      ...candidateClaims(
        entityId,
        cohorts,
        resolutions,
        new Set(["name", "operator"])
      )
    ];
    const unique = uniqueClaims(claims).slice(0, 32);
    candidates.push({
      distanceMeters: distanceByRoute.get(entityId) ?? Number.MAX_SAFE_INTEGER,
      candidate: {
        entityId,
        entityCategory: "hiking_route",
        sourceBasis: "mapped",
        evidenceClaimIds: unique.map((claim) => claim.claimId),
        knownLimitations: [
          "access_unverified",
          "mapped_presence_only",
          "official_status_unverified"
        ]
      }
    });
  }
  return candidates
    .sort((left, right) =>
      left.distanceMeters - right.distanceMeters ||
      left.candidate.entityId.localeCompare(right.candidate.entityId)
    )
    .slice(0, OUTDOOR_RESEARCH_LIMITS.maximumRouteCandidates)
    .map((entry) => entry.candidate);
}

function assembleOvernightCandidates(highlights, cohorts, resolutions, intent) {
  const hutRelevant = intent.overnightRequirements.required ||
    intent.requiredFacilities.includes("lunch_hut") ||
    intent.mustHaveExperiences.some((item) => HUT_CATEGORIES.has(item.experience)) ||
    intent.preferredExperiences.some((item) => HUT_CATEGORIES.has(item));
  if (!hutRelevant) return [];
  return highlights
    .filter((candidate) => HUT_CATEGORIES.has(candidate.highlightCategory))
    .map((candidate) => {
      const claims = candidateClaims(
        candidate.entityId,
        cohorts,
        resolutions,
        new Set(["entity_category", "name"])
      );
      return {
        entityId: candidate.entityId,
        entityCategory: candidate.highlightCategory,
        sourceBasis: "mapped",
        evidenceClaimIds: claims.map((claim) => claim.claimId),
        knownLimitations: [
          "access_unverified",
          "bookability_unverified",
          "current_conditions_unavailable",
          "mapped_presence_only",
          "opening_unverified",
          "overnight_legality_unverified",
          "seasonal_status_unverified",
          "water_availability_unverified"
        ]
      };
    })
    .slice(0, OUTDOOR_RESEARCH_LIMITS.maximumOvernightCandidates);
}

function assembleEvidenceGaps(input) {
  const gaps = new Map();
  const add = (gap) => gaps.set(JSON.stringify(gap), gap);
  const hasEvidenceCandidates =
    input.highlights.length > 0 || input.routes.length > 0;
  if (hasEvidenceCandidates || input.planningGaps.some((gap) =>
    gap.code === "official_source_unavailable"
  )) {
    addGap(add, "missing_access_evidence", null);
  }
  const requestedHighlight = input.intent.mustHaveExperiences.some((item) =>
    HIGHLIGHT_CATEGORIES.has(item.experience)
  ) || input.intent.preferredExperiences.some((item) =>
    HIGHLIGHT_CATEGORIES.has(item)
  ) || input.intent.requiredFacilities.includes("lunch_hut");
  if (input.highlights.length > 0 || requestedHighlight ||
      (input.routes.length === 0 &&
        ["hiking", "trail_running"].includes(input.intent.activity))) {
    addGap(add, "missing_route_connection", null);
  }
  if (hasRequestedExperience(input.intent, "official_hiking_route")) {
    addGap(add, "missing_official_status", null);
  }
  const hutRelevant = input.intent.overnightRequirements.required ||
    input.intent.requiredFacilities.includes("lunch_hut") ||
    hasRequestedExperience(input.intent, "alpine_hut") ||
    hasRequestedExperience(input.intent, "wilderness_hut");
  if (hutRelevant) addGap(add, "missing_opening_evidence", null);
  if (input.intent.overnightRequirements.required) {
    addGap(add, "missing_overnight_evidence", null);
    addGap(add, "missing_water_evidence", null);
  }
  if (input.intent.requiredFacilities.includes("drinking_water")) {
    addGap(add, "missing_water_evidence", null);
  }
  if (input.intent.dateOrSeason !== null) {
    addGap(add, "missing_seasonal_evidence", null);
    addGap(add, "missing_current_conditions", null);
  }
  if (input.planningGaps.some((gap) =>
    gap.code === "water_availability_source_missing"
  )) {
    addGap(add, "missing_water_evidence", null);
  }
  if (input.partialCoverage) addGap(add, "partial_region_coverage", null);

  const counts = new Map();
  for (const candidate of input.highlights) {
    counts.set(
      candidate.highlightCategory,
      (counts.get(candidate.highlightCategory) ?? 0) + 1
    );
  }
  counts.set(
    "official_hiking_route",
    countOfficialRouteCandidates(input.routes, input.claims)
  );
  for (const requirement of input.intent.mustHaveExperiences) {
    const foundCount = Math.min(8, counts.get(requirement.experience) ?? 0);
    if (foundCount < requirement.minimumCount) {
      add({
        code: "insufficient_candidate_count",
        experience: requirement.experience,
        requiredMinimumCount: requirement.minimumCount,
        foundCount
      });
    }
  }
  return [...gaps.values()]
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))
    .slice(0, 64);
}

function countOfficialRouteCandidates(routes, claims) {
  const claimsById = new Map(claims.map((claim) => [claim.claimId, claim]));
  return routes.filter((candidate) => {
    if (!["official", "mixed"].includes(candidate.sourceBasis)) return false;
    return candidate.evidenceClaimIds.some((claimId) => {
      const claim = claimsById.get(claimId);
      return claim?.predicate === "mapped_hiking_route_membership" &&
        claim.evidenceClass === "official" &&
        ["official_authority", "official_operator"]
          .includes(claim.sourceReference.sourceCategory);
    });
  }).length;
}

function assembleConflicts(resolutions) {
  const conflicts = [];
  for (const [key, resolution] of resolutions) {
    if (resolution.state !== "conflicted") continue;
    const [entityId, predicate] = key.split("|");
    conflicts.push({
      entityId,
      predicate,
      evidenceClaimIds: [...resolution.claimIds].sort()
    });
  }
  return conflicts
    .sort((left, right) =>
      left.entityId.localeCompare(right.entityId) ||
      left.predicate.localeCompare(right.predicate)
    )
    .slice(0, 32);
}

function assembleTimeSensitiveChecks(
  cohorts,
  resolutions,
  gaps,
  regionEntityId
) {
  const checks = new Map();
  for (const [key, claims] of cohorts) {
    const [entityId, predicate] = key.split("|");
    if (![
      "public_access",
      "access_restriction",
      "current_opening",
      "seasonal_opening",
      "overnight_permission",
      "bookability",
      "drinking_water_availability",
      "closure_status"
    ].includes(predicate)) continue;
    const resolution = resolutions.get(key);
    checks.set(key, {
      entityId,
      predicate,
      state: resolution.state === "known" ? "complete" :
        resolution.state === "conflicted" ? "conflicted" : "unavailable",
      evidenceClaimIds: [...resolution.claimIds].sort()
    });
  }
  for (const gap of gaps) {
    if (gap.code === "insufficient_candidate_count") continue;
    const predicate = GAP_PREDICATES[gap.code];
    if (!predicate) continue;
    const key = cohortKey(regionEntityId, predicate);
    if (!checks.has(key)) {
      checks.set(key, {
        entityId: regionEntityId,
        predicate,
        state: "unavailable",
        evidenceClaimIds: []
      });
    }
  }
  return [...checks.values()]
    .sort((left, right) =>
      left.entityId.localeCompare(right.entityId) ||
      left.predicate.localeCompare(right.predicate)
    )
    .slice(0, 48);
}

function assembleSourceSummaries(records) {
  const sources = new Map();
  for (const record of records) {
    const metadata = record.sourceMetadata;
    const prior = sources.get(metadata.sourceId);
    if (prior && (
      prior.sourceKey !== metadata.sourceKey ||
      prior.sourceCategory !== metadata.sourceCategory ||
      prior.licenseIdentifier !== metadata.licenseIdentifier ||
      prior.attributionRequired !== metadata.attributionRequired
    )) {
      throw outdoorResearchExecutorError("malformed_evidence");
    }
    if (!prior) {
      sources.set(metadata.sourceId, {
        sourceId: metadata.sourceId,
        sourceKey: metadata.sourceKey,
        sourceCategory: metadata.sourceCategory,
        evidenceClasses: new Set(),
        licenseIdentifier: metadata.licenseIdentifier,
        attributionRequired: metadata.attributionRequired,
        retrievedAt: metadata.retrievedAt
      });
    }
    const source = sources.get(metadata.sourceId);
    source.evidenceClasses.add(metadata.evidenceClass);
    if (metadata.retrievedAt &&
        (!source.retrievedAt || metadata.retrievedAt > source.retrievedAt)) {
      source.retrievedAt = metadata.retrievedAt;
    }
  }
  return [...sources.values()]
    .sort((left, right) => left.sourceId.localeCompare(right.sourceId))
    .map((source) => ({
      ...source,
      evidenceClasses: [...source.evidenceClasses].sort()
    }));
}

function entityMetadata(records) {
  const metadata = new Map();
  for (const record of records) {
    if (record.coordinate === null) continue;
    const entityId = record.claim.entityId;
    const current = metadata.get(entityId);
    const candidate = {
      entityCategory: record.entityCategory,
      coordinate: record.coordinate,
      distanceMeters: record.distanceMeters
    };
    if (current && JSON.stringify(current) !== JSON.stringify(candidate)) {
      throw outdoorResearchExecutorError("malformed_evidence");
    }
    metadata.set(entityId, candidate);
  }
  return metadata;
}

function categoryClaims(cohorts, resolutions) {
  const categories = [];
  for (const [key, claims] of cohorts) {
    const [entityId, predicate] = key.split("|");
    if (predicate !== "entity_category") continue;
    const resolution = resolutions.get(key);
    if (resolution.state !== "known" ||
        resolution.value?.type !== "text") continue;
    if (!claims.some((claim) => claim.claimId === resolution.claimIds[0])) continue;
    categories.push([entityId, resolution.value.value]);
  }
  return categories.sort(([leftId], [rightId]) => leftId.localeCompare(rightId));
}

function knownCategorySupport(entityId, category, cohorts, resolutions) {
  const directKey = cohortKey(entityId, "entity_category");
  const directResolution = resolutions.get(directKey);
  if (directResolution?.state === "known" &&
      directResolution.value?.type === "text" &&
      directResolution.value.value === category) {
    return knownClaims(cohorts.get(directKey) ?? [], directResolution)[0];
  }
  return undefined;
}

function candidateClaims(entityId, cohorts, resolutions, predicates) {
  const claims = [];
  for (const predicate of [...predicates].sort()) {
    const key = cohortKey(entityId, predicate);
    claims.push(...knownClaims(cohorts.get(key) ?? [], resolutions.get(key)));
  }
  return uniqueClaims(claims).slice(0, 32);
}

function knownClaims(claims, resolution) {
  if (resolution?.state !== "known") return [];
  const ids = new Set(resolution.claimIds);
  return claims.filter((claim) => ids.has(claim.claimId)).sort(compareClaims);
}

function relevanceReasons(intent, category, claimId) {
  const reasons = [];
  if (category === "viewpoint") {
    reasons.push({ code: "mapped_viewpoint", evidenceClaimIds: [claimId] });
  } else if (category === "waterfall") {
    reasons.push({ code: "mapped_waterfall", evidenceClaimIds: [claimId] });
  }
  if (intent.mustHaveExperiences.some((item) => item.experience === category)) {
    reasons.push({ code: "request_must_have", evidenceClaimIds: [claimId] });
  }
  if (intent.preferredExperiences.includes(category)) {
    reasons.push({ code: "request_preference", evidenceClaimIds: [claimId] });
  }
  if (HUT_CATEGORIES.has(category) &&
      (intent.requiredFacilities.includes("lunch_hut") ||
       intent.overnightRequirements.required)) {
    reasons.push({ code: "facility_match", evidenceClaimIds: [claimId] });
  }
  return reasons.sort((left, right) => left.code.localeCompare(right.code));
}

function candidateTier(intent, category) {
  const mustIndex = intent.mustHaveExperiences.findIndex((item) =>
    item.experience === category
  );
  if (mustIndex >= 0) return mustIndex;
  const preferredIndex = intent.preferredExperiences.indexOf(category);
  if (preferredIndex >= 0) return 100 + preferredIndex;
  return 200;
}

function candidateUncertainty(claims, resolutions) {
  let stale = false;
  for (const claim of claims) {
    const state = resolutions.get(cohortKey(claim.entityId, claim.predicate))?.state;
    if (state === "conflicted") return "conflicted";
    if (state === "stale") stale = true;
    if (state !== "known" && state !== "stale") return "insufficient_evidence";
  }
  return stale ? "stale" : "resolved";
}

function addHutLimitations(limitations) {
  limitations.add("bookability_unverified");
  limitations.add("current_conditions_unavailable");
  limitations.add("opening_unverified");
  limitations.add("overnight_legality_unverified");
  limitations.add("seasonal_status_unverified");
  limitations.add("water_availability_unverified");
}

function addGap(add, code, entityId) {
  add({
    code,
    entityId,
    predicate: GAP_PREDICATES[code]
  });
}

function hasRequestedExperience(intent, experience) {
  return intent.mustHaveExperiences.some((item) => item.experience === experience) ||
    intent.preferredExperiences.includes(experience);
}

function dossierExpiry(snapshot, generatedAt) {
  const sourceDataAt = strictExecutorDateV1(
    snapshot.sourceDataAt,
    "malformed_evidence"
  );
  const limit = Number(snapshot.freshnessLimitMilliseconds);
  const expiry = new Date(sourceDataAt.getTime() + limit);
  if (!Number.isFinite(expiry.getTime()) ||
      expiry.getTime() <= strictExecutorDateV1(
        generatedAt,
        "invalid_dependencies"
      ).getTime()) {
    throw outdoorResearchExecutorError("inconsistent_snapshot");
  }
  return expiry.toISOString();
}

function dossierFreshness(claims) {
  if (claims.length === 0) return "unknown";
  if (claims.some((claim) => claim.freshness === "expired")) return "expired";
  if (claims.some((claim) => claim.freshness === "stale")) return "stale";
  if (claims.some((claim) => claim.freshness === "unknown")) return "unknown";
  return "current";
}

function timestamp(value) {
  return strictExecutorDateV1(value, "invalid_dependencies").toISOString();
}

function cohortKey(entityId, predicate) {
  return `${entityId}|${predicate}`;
}

function uniqueClaims(claims) {
  return [...new Map(claims.map((claim) => [claim.claimId, claim])).values()]
    .sort(compareClaims);
}

function compareClaims(left, right) {
  return left.entityId.localeCompare(right.entityId) ||
    left.predicate.localeCompare(right.predicate) ||
    left.sourceReference.sourceId.localeCompare(right.sourceReference.sourceId) ||
    left.claimId.localeCompare(right.claimId);
}
