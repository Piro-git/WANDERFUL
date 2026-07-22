import {
  CONTRACT_NAMES,
  ENTITY_CATEGORIES,
  EVIDENCE_CLASSES,
  EVIDENCE_PREDICATES,
  HIGH_STAKES_PREDICATES,
  OUTDOOR_RESEARCH_CONTRACT_MANIFEST_V1,
  OUTDOOR_RESEARCH_LIMITS,
  RESEARCH_OPERATION_TYPES,
  SOURCE_CATEGORIES
} from "./contracts.js";
import { resolveValidatedEvidenceClaimsV1 } from "./evidenceResolutionCore.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KEY_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const OPERATION_ID_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

const ACTIVITY_VALUES = ["hiking", "trail_running", "biking"];
const ROUTE_TYPE_VALUES = ["loop", "point_to_point", "out_and_back"];
const DIFFICULTY_VALUES = [
  "strolling", "hiking", "mountain_hiking", "demanding_mountain_hiking",
  "alpine_hiking", "demanding_alpine_hiking", "difficult_alpine_hiking"
];
const EXPERIENCE_VALUES = [
  "viewpoint", "waterfall", "peak", "lake", "forest", "quiet_trails",
  "official_hiking_route", "alpine_hut", "wilderness_hut", "landmark"
];
const AVOIDED_EXPERIENCE_VALUES = [
  "exposed_trails", "technical_terrain", "major_roads", "steep_climbs",
  "repeated_path", "crowds", "unpaved_surface"
];
const FACILITY_VALUES = [
  "drinking_water", "lunch_hut", "emergency_shelter", "public_transport",
  "official_campsite", "designated_bivouac", "toilets"
];
const LIMITATION_CODES = [
  "access_unverified", "opening_unverified", "overnight_legality_unverified",
  "water_availability_unverified", "current_conditions_unavailable", "source_stale",
  "source_timestamp_unavailable", "conflicting_authoritative_evidence",
  "mapped_presence_only", "terrain_derived_only", "partial_regional_coverage",
  "official_status_unverified", "route_connection_unverified", "insufficient_evidence"
];
const QUESTION_CODES = [
  "location_required", "start_required", "destination_required", "distance_required",
  "duration_required", "date_or_season_required", "overnight_legality_required",
  "transport_requirement_required", "difficulty_clarification_required"
];
const QUESTION_FIELDS = [
  "geographicAnchor", "routeType", "distanceRangeKm", "durationRangeMinutes",
  "dateOrSeason", "overnightRequirements", "transportRequirements",
  "maximumTechnicalDifficulty"
];
const RESOLUTION_STATES = ["known", "conflicted", "stale", "unavailable", "unknown"];
const FRESHNESS_STATES = ["current", "stale", "expired", "unknown"];
const INFORMATION_NEEDS = [
  "highlight_candidates", "mapped_hiking_routes", "terrain_characteristics",
  "access_and_legal_status", "opening_and_operating_status", "overnight_legality",
  "seasonal_relevance", "recent_conditions"
];
const REASON_CODES = [
  "must_have_experience", "preferred_experience", "avoidance_constraint",
  "required_facility", "high_stakes_verification", "seasonal_verification",
  "coverage_gap", "overnight_requirement"
];
const HIGHLIGHT_REASON_CODES = [
  "mapped_viewpoint", "mapped_waterfall", "terrain_derived_broad_viewshed",
  "request_must_have", "request_preference", "facility_match",
  "official_route_connection"
];
const EVIDENCE_GAP_CODES = [
  "missing_access_evidence", "missing_opening_evidence", "missing_overnight_evidence",
  "missing_water_evidence", "missing_current_conditions", "missing_official_status",
  "missing_route_connection", "missing_seasonal_evidence", "unsupported_region",
  "partial_region_coverage"
];

const PREDICATE_TEXT_VALUES = Object.freeze({
  entity_category: ENTITY_CATEGORIES,
  access_restriction: ["restricted", "prohibited", "conditional", "permit_required"],
  seasonal_opening: ["open_seasonally", "closed_seasonally", "conditional"],
  trail_difficulty: DIFFICULTY_VALUES,
  trail_visibility: ["excellent", "good", "intermediate", "bad", "horrible", "no"],
  closure_status: ["open", "closed", "partial", "conditional"]
});
const BOOLEAN_PREDICATES = new Set([
  "public_access", "current_opening", "overnight_permission", "bookability",
  "drinking_water_availability", "viewpoint_presence", "waterfall_presence"
]);
const SOURCE_CATEGORY_SET = new Set(SOURCE_CATEGORIES);
const EVIDENCE_CLASS_SET = new Set(EVIDENCE_CLASSES);
const ENTITY_CATEGORY_SET = new Set(ENTITY_CATEGORIES);
const PREDICATE_SET = new Set(EVIDENCE_PREDICATES);
const HIGH_STAKES_SET = new Set(HIGH_STAKES_PREDICATES);

export class OutdoorResearchValidationError extends Error {
  constructor(path, message) {
    super(`${path}: ${message}`);
    this.name = "OutdoorResearchValidationError";
    this.code = "invalid_outdoor_research_contract";
    this.path = path;
  }
}

export function validateAdventureResearchIntentV1(input) {
  enforceSerializedSize(input, OUTDOOR_RESEARCH_LIMITS.intentBytes, "AdventureResearchIntentV1");
  const value = strictObject(input, OUTDOOR_RESEARCH_CONTRACT_MANIFEST_V1.AdventureResearchIntentV1.fields,
    OUTDOOR_RESEARCH_CONTRACT_MANIFEST_V1.AdventureResearchIntentV1.fields, "intent");
  schemaVersion(value.schemaVersion, "intent.schemaVersion");
  const intent = {
    schemaVersion: 1,
    activity: enumValue(value.activity, ACTIVITY_VALUES, "intent.activity"),
    geographicAnchor: geographicAnchor(value.geographicAnchor, "intent.geographicAnchor"),
    routeType: enumValue(value.routeType, ROUTE_TYPE_VALUES, "intent.routeType"),
    distanceRangeKm: nullableRange(value.distanceRangeKm, 0.1, 500, "intent.distanceRangeKm"),
    durationRangeMinutes: nullableIntegerRange(
      value.durationRangeMinutes, 15, 10_080, "intent.durationRangeMinutes"
    ),
    maximumElevationGainMeters: nullableInteger(
      value.maximumElevationGainMeters, 0, 20_000, "intent.maximumElevationGainMeters"
    ),
    maximumTechnicalDifficulty: nullableEnum(
      value.maximumTechnicalDifficulty, DIFFICULTY_VALUES, "intent.maximumTechnicalDifficulty"
    ),
    mustHaveExperiences: experienceRequirements(
      value.mustHaveExperiences, "intent.mustHaveExperiences"
    ),
    preferredExperiences: uniqueEnumArray(
      value.preferredExperiences, EXPERIENCE_VALUES, OUTDOOR_RESEARCH_LIMITS.maximumIntentItems,
      "intent.preferredExperiences"
    ),
    avoidedExperiences: uniqueEnumArray(
      value.avoidedExperiences, AVOIDED_EXPERIENCE_VALUES,
      OUTDOOR_RESEARCH_LIMITS.maximumIntentItems, "intent.avoidedExperiences"
    ),
    requiredFacilities: uniqueEnumArray(
      value.requiredFacilities, FACILITY_VALUES, OUTDOOR_RESEARCH_LIMITS.maximumIntentItems,
      "intent.requiredFacilities"
    ),
    groupContext: groupContext(value.groupContext, "intent.groupContext"),
    dateOrSeason: dateOrSeason(value.dateOrSeason, "intent.dateOrSeason"),
    overnightRequirements: overnightRequirements(
      value.overnightRequirements, "intent.overnightRequirements"
    ),
    transportRequirements: transportRequirements(
      value.transportRequirements, "intent.transportRequirements"
    ),
    unresolvedClarificationQuestions: clarificationQuestions(
      value.unresolvedClarificationQuestions, "intent.unresolvedClarificationQuestions"
    )
  };
  if (intent.geographicAnchor.state === "unresolved" &&
      !intent.unresolvedClarificationQuestions.some((question) =>
        question.code === "location_required" || question.code === "start_required")) {
    invalid("intent.unresolvedClarificationQuestions", "an unresolved anchor requires a location question");
  }
  return deepFreeze(intent);
}

export function validateResearchPlanV1(input) {
  enforceSerializedSize(input, OUTDOOR_RESEARCH_LIMITS.planBytes, "ResearchPlanV1");
  const value = strictObject(input, ["schemaVersion", "intentSchemaVersion", "operations"],
    ["schemaVersion", "intentSchemaVersion", "operations"], "plan");
  schemaVersion(value.schemaVersion, "plan.schemaVersion");
  schemaVersion(value.intentSchemaVersion, "plan.intentSchemaVersion");
  const operations = boundedArray(
    value.operations, 1, OUTDOOR_RESEARCH_LIMITS.maximumResearchOperations, "plan.operations"
  ).map((operation, index) => researchOperation(operation, `plan.operations[${index}]`));
  assertUnique(operations.map((operation) => operation.operationId), "plan.operations", "operationId");
  return deepFreeze({ schemaVersion: 1, intentSchemaVersion: 1, operations });
}

export function validateEvidenceClaimV1(input) {
  enforceSerializedSize(input, OUTDOOR_RESEARCH_LIMITS.evidenceClaimBytes, "EvidenceClaimV1");
  const fields = OUTDOOR_RESEARCH_CONTRACT_MANIFEST_V1.EvidenceClaimV1.fields;
  const value = strictObject(input, fields, fields, "claim");
  schemaVersion(value.schemaVersion, "claim.schemaVersion");
  const predicate = enumValue(value.predicate, EVIDENCE_PREDICATES, "claim.predicate");
  const evidenceClass = enumValue(value.evidenceClass, EVIDENCE_CLASSES, "claim.evidenceClass");
  const sourceReference = evidenceSourceReference(value.sourceReference, "claim.sourceReference");
  validateSourceEvidencePair(sourceReference.sourceCategory, evidenceClass, "claim.evidenceClass");
  const claim = {
    schemaVersion: 1,
    claimId: uuid(value.claimId, "claim.claimId"),
    entityId: uuid(value.entityId, "claim.entityId"),
    predicate,
    value: evidenceValue(value.value, predicate, "claim.value"),
    evidenceClass,
    sourceReference,
    provenance: provenance(value.provenance, "claim.provenance"),
    observedAt: nullableTimestamp(value.observedAt, "claim.observedAt"),
    retrievedAt: timestamp(value.retrievedAt, "claim.retrievedAt"),
    validFrom: nullableTimestamp(value.validFrom, "claim.validFrom"),
    validUntil: nullableTimestamp(value.validUntil, "claim.validUntil"),
    freshness: enumValue(value.freshness, FRESHNESS_STATES, "claim.freshness"),
    resolutionState: enumValue(value.resolutionState, RESOLUTION_STATES, "claim.resolutionState"),
    relevantLimitationCodes: uniqueEnumArray(
      value.relevantLimitationCodes, LIMITATION_CODES, 16, "claim.relevantLimitationCodes"
    )
  };
  validateClaimTimeConsistency(claim);
  if (claim.value.type === "unknown" && claim.resolutionState === "known") {
    invalid("claim.resolutionState", "an unknown value cannot be known");
  }
  if (HIGH_STAKES_SET.has(predicate) && claim.resolutionState === "known" && evidenceClass !== "official") {
    invalid("claim.resolutionState", "high-stakes claims require current official evidence to resolve as known");
  }
  if (claim.resolutionState === "known" && claim.freshness !== "current") {
    invalid("claim.resolutionState", "known claims must be current");
  }
  return deepFreeze(claim);
}

export function validateHighlightCandidateV1(input) {
  enforceSerializedSize(
    input, OUTDOOR_RESEARCH_LIMITS.highlightCandidateBytes, "HighlightCandidateV1"
  );
  const fields = OUTDOOR_RESEARCH_CONTRACT_MANIFEST_V1.HighlightCandidateV1.fields;
  const value = strictObject(input, fields, fields, "highlight");
  schemaVersion(value.schemaVersion, "highlight.schemaVersion");
  const evidenceClaimIds = uniqueUuidArray(value.evidenceClaimIds, 1, 32, "highlight.evidenceClaimIds");
  const reasons = boundedArray(value.relevanceReasons, 1, 12, "highlight.relevanceReasons")
    .map((reason, index) => relevanceReason(reason, `highlight.relevanceReasons[${index}]`));
  for (const reason of reasons) {
    if (reason.evidenceClaimIds.some((claimId) => !evidenceClaimIds.includes(claimId))) {
      invalid("highlight.relevanceReasons", "reason claim references must be in evidenceClaimIds");
    }
  }
  return deepFreeze({
    schemaVersion: 1,
    entityId: uuid(value.entityId, "highlight.entityId"),
    highlightCategory: enumValue(
      value.highlightCategory,
      ["viewpoint", "waterfall", "peak", "lake", "alpine_hut", "wilderness_hut", "landmark"],
      "highlight.highlightCategory"
    ),
    coordinate: coordinate(value.coordinate, "highlight.coordinate"),
    relevanceReasons: reasons,
    evidenceClaimIds,
    knownLimitations: uniqueEnumArray(
      value.knownLimitations, LIMITATION_CODES, 16, "highlight.knownLimitations"
    ),
    suitabilityState: enumValue(
      value.suitabilityState, ["eligible", "conditional", "ineligible", "unknown"],
      "highlight.suitabilityState"
    ),
    uncertaintyState: enumValue(
      value.uncertaintyState, ["resolved", "conflicted", "stale", "insufficient_evidence"],
      "highlight.uncertaintyState"
    )
  });
}

export function validateAdventureResearchDossierV1(input) {
  enforceSerializedSize(input, OUTDOOR_RESEARCH_LIMITS.dossierBytes, "AdventureResearchDossierV1");
  const fields = OUTDOOR_RESEARCH_CONTRACT_MANIFEST_V1.AdventureResearchDossierV1.fields;
  const value = strictObject(input, fields, fields, "dossier");
  schemaVersion(value.schemaVersion, "dossier.schemaVersion");
  const evidenceClaims = boundedArray(
    value.evidenceClaims, 0, OUTDOOR_RESEARCH_LIMITS.maximumEvidenceClaims, "dossier.evidenceClaims"
  ).map((claim) => validateEvidenceClaimV1(claim));
  const claimIds = evidenceClaims.map((claim) => claim.claimId);
  assertUnique(claimIds, "dossier.evidenceClaims", "claimId");
  const claimsById = new Map(evidenceClaims.map((claim) => [claim.claimId, claim]));
  const generatedAt = timestamp(value.generatedAt, "dossier.generatedAt");
  const candidateHighlights = boundedArray(
    value.candidateHighlights, 0, OUTDOOR_RESEARCH_LIMITS.maximumHighlightCandidates,
    "dossier.candidateHighlights"
  ).map((candidate) => validateHighlightCandidateV1(candidate));
  assertUnique(candidateHighlights.map((candidate) => candidate.entityId),
    "dossier.candidateHighlights", "entityId");
  for (const [index, candidate] of candidateHighlights.entries()) {
    validateHighlightEvidence(
      candidate, claimsById, `dossier.candidateHighlights[${index}]`
    );
  }
  const mappedOrOfficialRouteCandidates = boundedArray(
    value.mappedOrOfficialRouteCandidates, 0, OUTDOOR_RESEARCH_LIMITS.maximumRouteCandidates,
    "dossier.mappedOrOfficialRouteCandidates"
  ).map((candidate, index) => entityCandidate(
    candidate, ["hiking_route"], `dossier.mappedOrOfficialRouteCandidates[${index}]`
  ));
  const overnightCandidates = boundedArray(
    value.overnightCandidates, 0, OUTDOOR_RESEARCH_LIMITS.maximumOvernightCandidates,
    "dossier.overnightCandidates"
  ).map((candidate, index) => entityCandidate(
    candidate,
    ["alpine_hut", "wilderness_hut", "official_campsite", "designated_bivouac", "emergency_shelter"],
    `dossier.overnightCandidates[${index}]`
  ));
  assertUnique(mappedOrOfficialRouteCandidates.map((candidate) => candidate.entityId),
    "dossier.mappedOrOfficialRouteCandidates", "entityId");
  assertUnique(overnightCandidates.map((candidate) => candidate.entityId),
    "dossier.overnightCandidates", "entityId");
  for (const [index, candidate] of mappedOrOfficialRouteCandidates.entries()) {
    validateEntityCandidateEvidence(
      candidate, claimsById, `dossier.mappedOrOfficialRouteCandidates[${index}]`
    );
  }
  for (const [index, candidate] of overnightCandidates.entries()) {
    validateEntityCandidateEvidence(
      candidate, claimsById, `dossier.overnightCandidates[${index}]`
    );
  }
  const timeSensitiveChecks = boundedArray(
    value.timeSensitiveChecks, 0, 48, "dossier.timeSensitiveChecks"
  ).map((check, index) => timeSensitiveCheck(check, `dossier.timeSensitiveChecks[${index}]`));
  const conflictingEvidence = boundedArray(
    value.conflictingEvidence, 0, 32, "dossier.conflictingEvidence"
  ).map((conflict, index) => conflictGroup(conflict, `dossier.conflictingEvidence[${index}]`));
  for (const [index, check] of timeSensitiveChecks.entries()) {
    validateTimeSensitiveEvidence(
      check, claimsById, generatedAt, `dossier.timeSensitiveChecks[${index}]`
    );
  }
  for (const [index, conflict] of conflictingEvidence.entries()) {
    validateConflictEvidence(
      conflict, claimsById, generatedAt, `dossier.conflictingEvidence[${index}]`
    );
  }
  const expiresAt = nullableTimestamp(value.expiresAt, "dossier.expiresAt");
  if (expiresAt && Date.parse(expiresAt) <= Date.parse(generatedAt)) {
    invalid("dossier.expiresAt", "must be after generatedAt");
  }
  const sourceProvenanceSummary = boundedArray(
    value.sourceProvenanceSummary, 0, OUTDOOR_RESEARCH_LIMITS.maximumSourceSummaries,
    "dossier.sourceProvenanceSummary"
  ).map((summary, index) => sourceSummary(summary, `dossier.sourceProvenanceSummary[${index}]`));
  assertUnique(sourceProvenanceSummary.map((summary) => summary.sourceId),
    "dossier.sourceProvenanceSummary", "sourceId");
  const summariesBySource = new Map(sourceProvenanceSummary.map((summary) => [summary.sourceId, summary]));
  for (const claim of evidenceClaims) {
    const summary = summariesBySource.get(claim.sourceReference.sourceId);
    if (!summary || summary.sourceKey !== claim.sourceReference.sourceKey ||
        summary.sourceCategory !== claim.sourceReference.sourceCategory ||
        !summary.evidenceClasses.includes(claim.evidenceClass)) {
      invalid("dossier.sourceProvenanceSummary", "does not cover every claim source and evidence class");
    }
  }
  return deepFreeze({
    schemaVersion: 1,
    normalizedIntent: validateAdventureResearchIntentV1(value.normalizedIntent),
    regionCoverage: regionCoverage(value.regionCoverage, "dossier.regionCoverage"),
    evidenceClaims,
    candidateHighlights,
    mappedOrOfficialRouteCandidates,
    overnightCandidates,
    timeSensitiveChecks,
    conflictingEvidence,
    evidenceGaps: boundedArray(value.evidenceGaps, 0, 64, "dossier.evidenceGaps")
      .map((gap, index) => evidenceGap(gap, `dossier.evidenceGaps[${index}]`)),
    unresolvedQuestions: clarificationQuestions(value.unresolvedQuestions, "dossier.unresolvedQuestions"),
    sourceProvenanceSummary,
    generatedAt,
    expiresAt,
    freshnessState: enumValue(value.freshnessState, FRESHNESS_STATES, "dossier.freshnessState")
  });
}

export function serializeOutdoorResearchContract(contractName, input) {
  enumValue(contractName, CONTRACT_NAMES, "contractName");
  const validators = {
    AdventureResearchIntentV1: validateAdventureResearchIntentV1,
    ResearchPlanV1: validateResearchPlanV1,
    EvidenceClaimV1: validateEvidenceClaimV1,
    HighlightCandidateV1: validateHighlightCandidateV1,
    AdventureResearchDossierV1: validateAdventureResearchDossierV1
  };
  return JSON.stringify(sortKeys(validators[contractName](input)));
}

function geographicAnchor(input, path) {
  const value = strictObject(input, ["state", "name", "coordinate", "regionEntityId", "requirementCode"],
    ["state"], path);
  const state = enumValue(value.state, ["resolved", "unresolved"], `${path}.state`);
  if (state === "resolved") {
    requireExactFields(value, ["state", "name", "coordinate", "regionEntityId"], path);
    return {
      state,
      name: boundedString(value.name, 1, 160, `${path}.name`),
      coordinate: coordinate(value.coordinate, `${path}.coordinate`),
      regionEntityId: nullableUuid(value.regionEntityId, `${path}.regionEntityId`)
    };
  }
  requireExactFields(value, ["state", "requirementCode"], path);
  return {
    state,
    requirementCode: enumValue(
      value.requirementCode, ["location_required", "start_required", "destination_required"],
      `${path}.requirementCode`
    )
  };
}

function groupContext(input, path) {
  const fields = ["partySize", "includesChildren", "youngestAge", "mobility", "experienceLevel"];
  const value = strictObject(input, fields, fields, path);
  const result = {
    partySize: integer(value.partySize, 1, 100, `${path}.partySize`),
    includesChildren: booleanValue(value.includesChildren, `${path}.includesChildren`),
    youngestAge: nullableInteger(value.youngestAge, 0, 17, `${path}.youngestAge`),
    mobility: enumValue(value.mobility, ["standard", "limited", "unknown"], `${path}.mobility`),
    experienceLevel: enumValue(
      value.experienceLevel, ["beginner", "intermediate", "advanced", "unknown"],
      `${path}.experienceLevel`
    )
  };
  if (result.includesChildren !== (result.youngestAge !== null)) {
    invalid(`${path}.youngestAge`, "must be present exactly when includesChildren is true");
  }
  return result;
}

function dateOrSeason(input, path) {
  if (input === null) return null;
  const value = strictObject(input, ["kind", "date", "season", "year"], ["kind"], path);
  const kind = enumValue(value.kind, ["date", "season"], `${path}.kind`);
  if (kind === "date") {
    requireExactFields(value, ["kind", "date"], path);
    const date = boundedString(value.date, 10, 10, `${path}.date`);
    if (!isStrictISODate(date)) {
      invalid(`${path}.date`, "must be an ISO calendar date");
    }
    return { kind, date };
  }
  requireExactFields(value, ["kind", "season", "year"], path);
  return {
    kind,
    season: enumValue(value.season, ["spring", "summer", "autumn", "winter"], `${path}.season`),
    year: nullableInteger(value.year, 2020, 2100, `${path}.year`)
  };
}

function overnightRequirements(input, path) {
  const fields = ["required", "nights", "allowedAccommodationTypes"];
  const value = strictObject(input, fields, fields, path);
  const required = booleanValue(value.required, `${path}.required`);
  const nights = integer(value.nights, 0, 30, `${path}.nights`);
  const allowedAccommodationTypes = uniqueEnumArray(
    value.allowedAccommodationTypes,
    ["alpine_hut", "wilderness_hut", "official_campsite", "designated_bivouac"],
    8,
    `${path}.allowedAccommodationTypes`
  );
  if ((!required && (nights !== 0 || allowedAccommodationTypes.length !== 0)) ||
      (required && (nights < 1 || allowedAccommodationTypes.length === 0))) {
    invalid(path, "overnight fields are inconsistent with required");
  }
  return { required, nights, allowedAccommodationTypes };
}

function transportRequirements(input, path) {
  const fields = ["arrivalMode", "returnToStart", "publicTransportRequired"];
  const value = strictObject(input, fields, fields, path);
  return {
    arrivalMode: enumValue(
      value.arrivalMode, ["walking", "bicycle", "car", "public_transport", "unknown"],
      `${path}.arrivalMode`
    ),
    returnToStart: booleanValue(value.returnToStart, `${path}.returnToStart`),
    publicTransportRequired: booleanValue(
      value.publicTransportRequired, `${path}.publicTransportRequired`
    )
  };
}

function clarificationQuestions(input, path) {
  return boundedArray(input, 0, 16, path).map((question, index) => {
    const itemPath = `${path}[${index}]`;
    const value = strictObject(question, ["code", "field"], ["code", "field"], itemPath);
    return {
      code: enumValue(value.code, QUESTION_CODES, `${itemPath}.code`),
      field: enumValue(value.field, QUESTION_FIELDS, `${itemPath}.field`)
    };
  });
}

function experienceRequirements(input, path) {
  const requirements = boundedArray(
    input, 0, OUTDOOR_RESEARCH_LIMITS.maximumIntentItems, path
  ).map((requirement, index) => {
    const itemPath = `${path}[${index}]`;
    const value = strictObject(
      requirement, ["experience", "minimumCount"], ["experience", "minimumCount"], itemPath
    );
    return {
      experience: enumValue(value.experience, EXPERIENCE_VALUES, `${itemPath}.experience`),
      minimumCount: integer(value.minimumCount, 1, 8, `${itemPath}.minimumCount`)
    };
  });
  assertUnique(requirements.map((requirement) => requirement.experience), path, "experience");
  return requirements;
}

function researchOperation(input, path) {
  const fields = [
    "operationId", "operationType", "informationNeed", "reasonCode",
    "acceptableSourceCategories", "entityCategories", "predicates"
  ];
  const value = strictObject(input, fields, fields, path);
  const operationId = boundedString(value.operationId, 1, 64, `${path}.operationId`);
  if (!OPERATION_ID_PATTERN.test(operationId)) invalid(`${path}.operationId`, "has an invalid format");
  const operation = {
    operationId,
    operationType: enumValue(value.operationType, RESEARCH_OPERATION_TYPES, `${path}.operationType`),
    informationNeed: enumValue(value.informationNeed, INFORMATION_NEEDS, `${path}.informationNeed`),
    reasonCode: enumValue(value.reasonCode, REASON_CODES, `${path}.reasonCode`),
    acceptableSourceCategories: uniqueEnumArray(
      value.acceptableSourceCategories, SOURCE_CATEGORIES, 8, `${path}.acceptableSourceCategories`, 1
    ),
    entityCategories: uniqueEnumArray(value.entityCategories, ENTITY_CATEGORIES, 16, `${path}.entityCategories`),
    predicates: uniqueEnumArray(value.predicates, EVIDENCE_PREDICATES, 16, `${path}.predicates`)
  };
  if (operation.predicates.some((predicate) => HIGH_STAKES_SET.has(predicate)) &&
      !operation.acceptableSourceCategories.some((category) =>
        category === "official_authority" || category === "official_operator")) {
    invalid(
      `${path}.acceptableSourceCategories`,
      "high-stakes research must include an official authority or operator category"
    );
  }
  return operation;
}

function evidenceSourceReference(input, path) {
  const fields = ["sourceId", "sourceKey", "sourceCategory"];
  const value = strictObject(input, fields, fields, path);
  const sourceKey = boundedString(value.sourceKey, 1, 80, `${path}.sourceKey`);
  if (!KEY_PATTERN.test(sourceKey)) invalid(`${path}.sourceKey`, "has an invalid format");
  return {
    sourceId: uuid(value.sourceId, `${path}.sourceId`),
    sourceKey,
    sourceCategory: enumValue(value.sourceCategory, SOURCE_CATEGORIES, `${path}.sourceCategory`)
  };
}

function provenance(input, path) {
  const fields = ["identifier", "adapterVersion", "recordVersion"];
  const value = strictObject(input, fields, fields, path);
  return {
    identifier: boundedString(value.identifier, 1, 500, `${path}.identifier`),
    adapterVersion: boundedString(value.adapterVersion, 1, 80, `${path}.adapterVersion`),
    recordVersion: nullableInteger(value.recordVersion, 1, 2_147_483_647, `${path}.recordVersion`)
  };
}

function evidenceValue(input, predicate, path) {
  const value = strictObject(input, ["type", "value"], ["type"], path);
  const type = enumValue(
    value.type, ["text", "boolean", "number", "integer", "timestamp", "entity_reference", "unknown"],
    `${path}.type`
  );
  if (type === "unknown") {
    requireExactFields(value, ["type"], path);
    return { type };
  }
  requireExactFields(value, ["type", "value"], path);
  if (predicate === "mapped_hiking_route_membership") {
    if (type !== "entity_reference") invalid(`${path}.type`, "must be entity_reference for predicate");
    return { type, value: uuid(value.value, `${path}.value`) };
  }
  if (BOOLEAN_PREDICATES.has(predicate)) {
    if (type !== "boolean") invalid(`${path}.type`, "must be boolean for predicate");
    return { type, value: booleanValue(value.value, `${path}.value`) };
  }
  if (predicate === "name" || predicate === "operator") {
    if (type !== "text") invalid(`${path}.type`, "must be text for predicate");
    return { type, value: boundedString(value.value, 1, predicate === "name" ? 240 : 160, `${path}.value`) };
  }
  const allowedText = PREDICATE_TEXT_VALUES[predicate];
  if (allowedText) {
    if (type !== "text") invalid(`${path}.type`, "must be text for predicate");
    return { type, value: enumValue(value.value, allowedText, `${path}.value`) };
  }
  invalid(path, "predicate has no value contract");
}

function validateSourceEvidencePair(sourceCategory, evidenceClass, path) {
  const required = {
    official_authority: "official",
    official_operator: "official",
    openstreetmap_open_mapping: "mapped",
    wikimedia_open_knowledge: "mapped",
    trailmind_community: "community_observed",
    derived_computation: "derived",
    model_inference: "model_inferred"
  }[sourceCategory];
  if (required && evidenceClass !== required) invalid(path, "does not match source category");
}

function validateClaimTimeConsistency(claim) {
  const observed = claim.observedAt && Date.parse(claim.observedAt);
  const retrieved = Date.parse(claim.retrievedAt);
  const validFrom = claim.validFrom && Date.parse(claim.validFrom);
  const validUntil = claim.validUntil && Date.parse(claim.validUntil);
  if (observed && observed > retrieved) invalid("claim.observedAt", "must not be after retrievedAt");
  if (validFrom && validUntil && validUntil <= validFrom) {
    invalid("claim.validUntil", "must be after validFrom");
  }
  if (claim.freshness === "expired" && !validUntil) {
    invalid("claim.validUntil", "is required for expired evidence");
  }
  if (claim.freshness === "current" && validUntil && validUntil <= retrieved) {
    invalid("claim.freshness", "cannot be current after its validity ends");
  }
}

function relevanceReason(input, path) {
  const fields = ["code", "evidenceClaimIds"];
  const value = strictObject(input, fields, fields, path);
  return {
    code: enumValue(value.code, HIGHLIGHT_REASON_CODES, `${path}.code`),
    evidenceClaimIds: uniqueUuidArray(value.evidenceClaimIds, 1, 16, `${path}.evidenceClaimIds`)
  };
}

function regionCoverage(input, path) {
  const fields = ["state", "regionEntityIds", "limitationCodes"];
  const value = strictObject(input, fields, fields, path);
  return {
    state: enumValue(value.state, ["full", "partial", "unsupported", "unknown"], `${path}.state`),
    regionEntityIds: uniqueUuidArray(value.regionEntityIds, 0, 16, `${path}.regionEntityIds`),
    limitationCodes: uniqueEnumArray(value.limitationCodes, LIMITATION_CODES, 16, `${path}.limitationCodes`)
  };
}

function entityCandidate(input, categories, path) {
  const fields = ["entityId", "entityCategory", "sourceBasis", "evidenceClaimIds", "knownLimitations"];
  const value = strictObject(input, fields, fields, path);
  return {
    entityId: uuid(value.entityId, `${path}.entityId`),
    entityCategory: enumValue(value.entityCategory, categories, `${path}.entityCategory`),
    sourceBasis: enumValue(value.sourceBasis, ["mapped", "official", "mixed"], `${path}.sourceBasis`),
    evidenceClaimIds: uniqueUuidArray(value.evidenceClaimIds, 1, 32, `${path}.evidenceClaimIds`),
    knownLimitations: uniqueEnumArray(value.knownLimitations, LIMITATION_CODES, 16, `${path}.knownLimitations`)
  };
}

function timeSensitiveCheck(input, path) {
  const fields = ["entityId", "predicate", "state", "evidenceClaimIds"];
  const value = strictObject(input, fields, fields, path);
  const predicate = enumValue(value.predicate, EVIDENCE_PREDICATES, `${path}.predicate`);
  if (!HIGH_STAKES_SET.has(predicate)) invalid(`${path}.predicate`, "is not time-sensitive/high-stakes");
  const result = {
    entityId: uuid(value.entityId, `${path}.entityId`),
    predicate,
    state: enumValue(value.state, ["required", "complete", "conflicted", "unavailable"], `${path}.state`),
    evidenceClaimIds: uniqueUuidArray(value.evidenceClaimIds, 0, 16, `${path}.evidenceClaimIds`)
  };
  if (result.state === "complete" && result.evidenceClaimIds.length < 1) {
    invalid(`${path}.evidenceClaimIds`, "complete checks require evidence");
  }
  if (result.state === "conflicted" && result.evidenceClaimIds.length < 2) {
    invalid(`${path}.evidenceClaimIds`, "conflicted checks require at least two claims");
  }
  return result;
}

function conflictGroup(input, path) {
  const fields = ["entityId", "predicate", "evidenceClaimIds"];
  const value = strictObject(input, fields, fields, path);
  return {
    entityId: uuid(value.entityId, `${path}.entityId`),
    predicate: enumValue(value.predicate, EVIDENCE_PREDICATES, `${path}.predicate`),
    evidenceClaimIds: uniqueUuidArray(value.evidenceClaimIds, 2, 16, `${path}.evidenceClaimIds`)
  };
}

function evidenceGap(input, path) {
  const fields = ["code", "entityId", "predicate"];
  const value = strictObject(input, fields, fields, path);
  return {
    code: enumValue(value.code, EVIDENCE_GAP_CODES, `${path}.code`),
    entityId: nullableUuid(value.entityId, `${path}.entityId`),
    predicate: nullableEnum(value.predicate, EVIDENCE_PREDICATES, `${path}.predicate`)
  };
}

function sourceSummary(input, path) {
  const fields = [
    "sourceId", "sourceKey", "sourceCategory", "evidenceClasses",
    "licenseIdentifier", "attributionRequired", "retrievedAt"
  ];
  const value = strictObject(input, fields, fields, path);
  const sourceKey = boundedString(value.sourceKey, 1, 80, `${path}.sourceKey`);
  if (!KEY_PATTERN.test(sourceKey)) invalid(`${path}.sourceKey`, "has an invalid format");
  return {
    sourceId: uuid(value.sourceId, `${path}.sourceId`),
    sourceKey,
    sourceCategory: enumValue(value.sourceCategory, SOURCE_CATEGORIES, `${path}.sourceCategory`),
    evidenceClasses: uniqueEnumArray(value.evidenceClasses, EVIDENCE_CLASSES, 6, `${path}.evidenceClasses`, 1),
    licenseIdentifier: boundedString(value.licenseIdentifier, 1, 120, `${path}.licenseIdentifier`),
    attributionRequired: booleanValue(value.attributionRequired, `${path}.attributionRequired`),
    retrievedAt: nullableTimestamp(value.retrievedAt, `${path}.retrievedAt`)
  };
}

function coordinate(input, path) {
  const value = strictObject(input, ["latitude", "longitude"], ["latitude", "longitude"], path);
  return {
    latitude: finiteNumber(value.latitude, -90, 90, `${path}.latitude`),
    longitude: finiteNumber(value.longitude, -180, 180, `${path}.longitude`)
  };
}

function nullableRange(input, minimum, maximum, path) {
  if (input === null) return null;
  const value = strictObject(input, ["min", "max"], ["min", "max"], path);
  const result = {
    min: finiteNumber(value.min, minimum, maximum, `${path}.min`),
    max: finiteNumber(value.max, minimum, maximum, `${path}.max`)
  };
  if (result.min > result.max) invalid(path, "min must not exceed max");
  return result;
}

function nullableIntegerRange(input, minimum, maximum, path) {
  if (input === null) return null;
  const value = strictObject(input, ["min", "max"], ["min", "max"], path);
  const result = {
    min: integer(value.min, minimum, maximum, `${path}.min`),
    max: integer(value.max, minimum, maximum, `${path}.max`)
  };
  if (result.min > result.max) invalid(path, "min must not exceed max");
  return result;
}

function uniqueEnumArray(input, values, maximum, path, minimum = 0) {
  const result = boundedArray(input, minimum, maximum, path)
    .map((entry, index) => enumValue(entry, values, `${path}[${index}]`));
  assertUnique(result, path, "value");
  return result;
}

function uniqueUuidArray(input, minimum, maximum, path) {
  const result = boundedArray(input, minimum, maximum, path)
    .map((entry, index) => uuid(entry, `${path}[${index}]`));
  assertUnique(result, path, "UUID");
  return result;
}

function strictObject(input, allowedFields, requiredFields, path) {
  if (!input || typeof input !== "object" || Array.isArray(input)) invalid(path, "must be an object");
  const keys = Object.keys(input);
  const allowed = new Set(allowedFields);
  const unknown = keys.find((key) => !allowed.has(key));
  if (unknown) invalid(`${path}.${unknown}`, "is not allowed");
  const missing = requiredFields.find((key) => !Object.hasOwn(input, key));
  if (missing) invalid(`${path}.${missing}`, "is required");
  return input;
}

function requireExactFields(input, fields, path) {
  const expected = new Set(fields);
  const unknown = Object.keys(input).find((key) => !expected.has(key));
  if (unknown) invalid(`${path}.${unknown}`, "is not allowed for this variant");
  const missing = fields.find((field) => !Object.hasOwn(input, field));
  if (missing) invalid(`${path}.${missing}`, "is required for this variant");
}

function schemaVersion(value, path) {
  if (value !== 1) invalid(path, "must be 1");
  return 1;
}

function boundedString(value, minimum, maximum, path) {
  if (typeof value !== "string") invalid(path, "must be a string");
  if (value !== value.trim()) invalid(path, "must not have surrounding whitespace");
  if (value.length < minimum || value.length > maximum) invalid(path, `length must be ${minimum}...${maximum}`);
  if (CONTROL_CHARACTER_PATTERN.test(value)) invalid(path, "contains control characters");
  if (value.includes("<") || value.includes(">")) invalid(path, "must not contain HTML markup");
  return value;
}

function enumValue(value, values, path) {
  if (!new Set(values).has(value)) invalid(path, "is not an allowed value");
  return value;
}

function nullableEnum(value, values, path) {
  return value === null ? null : enumValue(value, values, path);
}

function uuid(value, path) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) invalid(path, "must be a UUID");
  return value.toLowerCase();
}

function nullableUuid(value, path) {
  return value === null ? null : uuid(value, path);
}

function finiteNumber(value, minimum, maximum, path) {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    invalid(path, `must be finite and within ${minimum}...${maximum}`);
  }
  return value;
}

function integer(value, minimum, maximum, path) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    invalid(path, `must be an integer within ${minimum}...${maximum}`);
  }
  return value;
}

function nullableInteger(value, minimum, maximum, path) {
  return value === null ? null : integer(value, minimum, maximum, path);
}

function booleanValue(value, path) {
  if (typeof value !== "boolean") invalid(path, "must be a boolean");
  return value;
}

function timestamp(value, path) {
  const candidate = boundedString(value, 20, 24, path);
  if (!ISO_TIMESTAMP_PATTERN.test(candidate)) invalid(path, "must be an ISO UTC timestamp");
  const [datePart, timePart] = candidate.slice(0, -1).split("T");
  if (!isStrictISODate(datePart)) invalid(path, "must be a valid timestamp");
  const [hourText, minuteText, secondAndFraction] = timePart.split(":");
  const [secondText, fraction = ""] = secondAndFraction.split(".");
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  if (hour > 23 || minute > 59 || second > 59 || fraction.length > 3) {
    invalid(path, "must be a valid timestamp");
  }
  const date = new Date(candidate);
  if (!Number.isFinite(date.getTime())) invalid(path, "must be a valid timestamp");
  return date.toISOString();
}

function nullableTimestamp(value, path) {
  return value === null ? null : timestamp(value, path);
}

function boundedArray(input, minimum, maximum, path) {
  if (!Array.isArray(input) || input.length < minimum || input.length > maximum) {
    invalid(path, `must contain ${minimum}...${maximum} items`);
  }
  return input;
}

function assertUnique(values, path, label) {
  if (new Set(values).size !== values.length) invalid(path, `contains a duplicate ${label}`);
}

function referencedClaims(references, claimsById, path) {
  const claims = [];
  for (const reference of references) {
    const claim = claimsById.get(reference);
    if (!claim) invalid(path, "contains an evidence claim reference absent from the dossier");
    claims.push(claim);
  }
  return claims;
}

function validateHighlightEvidence(candidate, claimsById, path) {
  const claims = referencedClaims(candidate.evidenceClaimIds, claimsById, `${path}.evidenceClaimIds`);
  if (claims.some((claim) => claim.entityId !== candidate.entityId)) {
    invalid(`${path}.evidenceClaimIds`, "claims must belong to the highlighted entity");
  }
  if (!claims.some((claim) => categoryClaimMatches(claim, candidate.highlightCategory))) {
    invalid(`${path}.evidenceClaimIds`, "claims must support the highlighted entity category");
  }
  for (const [index, reason] of candidate.relevanceReasons.entries()) {
    const reasonClaims = referencedClaims(
      reason.evidenceClaimIds, claimsById, `${path}.relevanceReasons[${index}].evidenceClaimIds`
    );
    if (!reasonClaims.some((claim) => relevanceClaimMatches(reason.code, candidate, claim))) {
      invalid(
        `${path}.relevanceReasons[${index}].code`,
        "is not supported by a compatible evidence predicate, category and class"
      );
    }
  }
}

function relevanceClaimMatches(code, candidate, claim) {
  if (claim.entityId !== candidate.entityId) return false;
  if (code === "mapped_viewpoint") {
    return candidate.highlightCategory === "viewpoint" && claim.evidenceClass === "mapped" &&
      categoryClaimMatches(claim, "viewpoint");
  }
  if (code === "mapped_waterfall") {
    return candidate.highlightCategory === "waterfall" && claim.evidenceClass === "mapped" &&
      categoryClaimMatches(claim, "waterfall");
  }
  if (code === "terrain_derived_broad_viewshed") {
    return candidate.highlightCategory === "viewpoint" && claim.evidenceClass === "derived" &&
      claim.predicate === "viewpoint_presence" && claim.value.type === "boolean" && claim.value.value;
  }
  if (code === "request_must_have" || code === "request_preference") {
    return categoryClaimMatches(claim, candidate.highlightCategory);
  }
  if (code === "facility_match") {
    return ["alpine_hut", "wilderness_hut"].includes(candidate.highlightCategory) &&
      categoryClaimMatches(claim, candidate.highlightCategory);
  }
  if (code === "official_route_connection") {
    return claim.predicate === "mapped_hiking_route_membership" &&
      (claim.evidenceClass === "official" || claim.evidenceClass === "mapped");
  }
  return false;
}

function categoryClaimMatches(claim, category) {
  if (claim.predicate === "entity_category") {
    return claim.value.type === "text" && claim.value.value === category;
  }
  if (category === "viewpoint" && claim.predicate === "viewpoint_presence") {
    return claim.value.type === "boolean" && claim.value.value;
  }
  if (category === "waterfall" && claim.predicate === "waterfall_presence") {
    return claim.value.type === "boolean" && claim.value.value;
  }
  return false;
}

function validateEntityCandidateEvidence(candidate, claimsById, path) {
  const claims = referencedClaims(candidate.evidenceClaimIds, claimsById, `${path}.evidenceClaimIds`);
  if (claims.some((claim) => claim.entityId !== candidate.entityId)) {
    invalid(`${path}.evidenceClaimIds`, "claims must belong to the candidate entity");
  }
  if (!claims.some((claim) => categoryClaimMatches(claim, candidate.entityCategory))) {
    invalid(`${path}.evidenceClaimIds`, "claims must support the candidate entity category");
  }
  const classes = new Set(claims.map((claim) => claim.evidenceClass));
  if (candidate.sourceBasis === "mapped" && [...classes].some((item) => item !== "mapped")) {
    invalid(`${path}.sourceBasis`, "mapped basis may reference only mapped evidence");
  }
  if (candidate.sourceBasis === "official" && [...classes].some((item) => item !== "official")) {
    invalid(`${path}.sourceBasis`, "official basis may reference only official evidence");
  }
  if (candidate.sourceBasis === "mixed" &&
      (!classes.has("mapped") || !classes.has("official") ||
       [...classes].some((item) => item !== "mapped" && item !== "official"))) {
    invalid(`${path}.sourceBasis`, "mixed basis requires both mapped and official evidence only");
  }
}

function validateTimeSensitiveEvidence(check, claimsById, generatedAt, path) {
  const claims = referencedClaims(check.evidenceClaimIds, claimsById, `${path}.evidenceClaimIds`);
  if (claims.some((claim) => claim.entityId !== check.entityId || claim.predicate !== check.predicate)) {
    invalid(`${path}.evidenceClaimIds`, "claims must match the declared entity and predicate");
  }
  if (check.state === "required") return;
  const resolved = resolveValidatedEvidenceClaimsV1(claims, {
    now: generatedAt, entityId: check.entityId, predicate: check.predicate
  });
  if (check.state === "complete" && resolved.state !== "known") {
    invalid(`${path}.state`, "complete checks must resolve known from eligible evidence");
  }
  if (check.state === "conflicted" && resolved.state !== "conflicted") {
    invalid(`${path}.state`, "conflicted checks must resolve conflicted");
  }
  if (check.state === "unavailable" && !["unknown", "unavailable", "stale"].includes(resolved.state)) {
    invalid(`${path}.state`, "unavailable checks must not resolve known or conflicted");
  }
}

function validateConflictEvidence(conflict, claimsById, generatedAt, path) {
  const claims = referencedClaims(conflict.evidenceClaimIds, claimsById, `${path}.evidenceClaimIds`);
  if (claims.some((claim) => claim.entityId !== conflict.entityId || claim.predicate !== conflict.predicate)) {
    invalid(`${path}.evidenceClaimIds`, "claims must match the conflict entity and predicate");
  }
  const resolved = resolveValidatedEvidenceClaimsV1(claims, {
    now: generatedAt, entityId: conflict.entityId, predicate: conflict.predicate
  });
  if (resolved.state !== "conflicted") {
    invalid(path, "referenced claims do not resolve conflicted");
  }
}

function isStrictISODate(value) {
  if (!ISO_DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;
}

function enforceSerializedSize(input, maximumBytes, path) {
  let serialized;
  try {
    serialized = JSON.stringify(input);
  } catch {
    invalid(path, "must be JSON serializable");
  }
  if (serialized === undefined || Buffer.byteLength(serialized, "utf8") > maximumBytes) {
    invalid(path, `exceeds the ${maximumBytes}-byte limit`);
  }
}

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortKeys(value[key])]));
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function invalid(path, message) {
  throw new OutdoorResearchValidationError(path, message);
}

export const outdoorResearchValidationVocabularyForTesting = Object.freeze({
  sourceCategories: SOURCE_CATEGORY_SET,
  evidenceClasses: EVIDENCE_CLASS_SET,
  entityCategories: ENTITY_CATEGORY_SET,
  predicates: PREDICATE_SET,
  highStakesPredicates: HIGH_STAKES_SET
});
