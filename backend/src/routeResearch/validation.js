import {
  EVIDENCE_PREDICATES,
  OUTDOOR_RESEARCH_LIMITS
} from "../outdoorResearch/contracts.js";
import { validateAdventureResearchIntentV1 } from "../outdoorResearch/validation.js";
import {
  aggregateResearchGuidedRouteRequirementsV1,
  aggregateResearchGuidedRouteVerificationV1,
  canonicalizeResearchGuidedRouteIntentV1,
  deriveResearchGuidedRoutePlanStateV1,
  deriveResearchGuidedRouteProposalIdV1,
  deriveResearchGuidedRouteProposalVerificationV1
} from "./contractSemantics.js";
import { ResearchGuidedRouteCandidateError } from "./errors.js";
import { RESEARCH_GUIDED_ROUTE_CANDIDATE_POLICY_V1 } from "./policy.js";

const POLICY = RESEARCH_GUIDED_ROUTE_CANDIDATE_POLICY_V1;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROPOSAL_ID_PATTERN = /^rrcpv1_[0-9a-f]{32}$/;
const CONTROL_CHARACTER_PATTERN =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const STATES = ["ready", "partial", "insufficient_evidence", "unsupported"];
const FEASIBILITY_STATES = [
  "not_ruled_out",
  "lower_bound_exceeds_target",
  "target_unspecified"
];
const HIGHLIGHT_CATEGORIES = [
  "viewpoint",
  "waterfall",
  "peak",
  "lake",
  "alpine_hut",
  "wilderness_hut",
  "landmark"
];
const REQUIREMENT_VALUE_SET = new Set(POLICY.requirementValues);
const PREDICATE_SET = new Set(EVIDENCE_PREDICATES);

export function validateResearchGuidedRouteCandidatePlanV1(input) {
  try {
    enforceSerializedSize(input);
    const value = strictObject(input, [
      "schemaVersion",
      "state",
      "normalizedIntent",
      "anchor",
      "proposals",
      "unmetRequirements",
      "requiredVerification",
      "evidenceGaps",
      "policyVersion"
    ], "plan");
    if (value.schemaVersion !== POLICY.schemaVersion) invalid();
    if (value.policyVersion !== POLICY.policyVersion) invalid();

    const validatedNormalizedIntent = validatedIntent(value.normalizedIntent);
    const normalizedIntent = canonicalizeResearchGuidedRouteIntentV1(
      validatedNormalizedIntent
    );
    if (!sameValue(validatedNormalizedIntent, normalizedIntent)) invalid();
    const anchor = validateAnchor(value.anchor);
    if (!sameValue(anchor, normalizedIntent.geographicAnchor)) invalid();

    const proposals = boundedArray(
      value.proposals,
      0,
      POLICY.limits.maximumProposals
    ).map(validateProposal);
    assertUnique(proposals.map((proposal) => proposal.proposalId));

    for (const proposal of proposals) {
      if (
        proposal.activity !== normalizedIntent.activity ||
        proposal.routeType !== normalizedIntent.routeType ||
        !sameValue(proposal.targetDistanceRangeKm, normalizedIntent.distanceRangeKm) ||
        !sameValue(
          proposal.targetDurationRangeMinutes,
          normalizedIntent.durationRangeMinutes
        ) ||
        proposal.maximumElevationGainMeters !==
          normalizedIntent.maximumElevationGainMeters ||
        proposal.maximumTechnicalDifficulty !==
          normalizedIntent.maximumTechnicalDifficulty
      ) {
        invalid();
      }
      const expectedProposalId = deriveResearchGuidedRouteProposalIdV1({
        normalizedIntent,
        viaEntityIds: proposal.viaCandidates.map(
          (candidate) => candidate.entityId
        ),
        mappedNetworkEntityIds: proposal.mappedNetworkCandidates.map(
          (candidate) => candidate.entityId
        ),
        strategy: proposal.strategy
      });
      if (proposal.proposalId !== expectedProposalId) invalid();
      const expectedProposalVerification =
        deriveResearchGuidedRouteProposalVerificationV1(
          normalizedIntent,
          proposal.viaCandidates,
          proposal.mappedNetworkCandidates
        );
      if (
        !sameValue(
          proposal.requiredVerification,
          expectedProposalVerification
        )
      ) {
        invalid();
      }
    }

    const state = enumValue(value.state, STATES);
    if (
      (state === "ready" || state === "partial") !== (proposals.length > 0)
    ) {
      invalid();
    }

    const unmetRequirements = boundedArray(
      value.unmetRequirements,
      0,
      POLICY.limits.maximumRequirementItems
    ).map((item) => validateRequirement(item, false));
    assertUnique(unmetRequirements.map(canonical));

    const requiredVerification = uniqueEnumArray(
      value.requiredVerification,
      POLICY.verificationCodes,
      POLICY.limits.maximumVerificationCodes
    );
    const evidenceGaps = boundedArray(
      value.evidenceGaps,
      0,
      POLICY.limits.maximumEvidenceGaps
    ).map(validateEvidenceGap);
    assertUnique(evidenceGaps.map(canonical));
    const expectedUnmetRequirements =
      aggregateResearchGuidedRouteRequirementsV1(
        proposals.flatMap(
          (proposal) => proposal.unsatisfiedRequirements
        ),
        "maximum_shortfall"
      );
    if (!sameValue(unmetRequirements, expectedUnmetRequirements)) invalid();
    const expectedRequiredVerification =
      aggregateResearchGuidedRouteVerificationV1(proposals);
    if (
      !sameValue(requiredVerification, expectedRequiredVerification)
    ) {
      invalid();
    }
    if (proposals.length > 0) {
      const expectedState = deriveResearchGuidedRoutePlanStateV1(
        proposals,
        evidenceGaps
      );
      if (state !== expectedState) invalid();
    }

    const plan = {
      schemaVersion: 1,
      state,
      normalizedIntent,
      anchor,
      proposals,
      unmetRequirements,
      requiredVerification,
      evidenceGaps,
      policyVersion: POLICY.policyVersion
    };
    enforceSerializedSize(plan);
    return deepFreeze(plan);
  } catch (error) {
    if (
      error instanceof ResearchGuidedRouteCandidateError &&
      error.code === "output_too_large"
    ) {
      throw error;
    }
    throw new ResearchGuidedRouteCandidateError("invalid_plan");
  }
}

export function serializeResearchGuidedRouteCandidatePlanV1(input) {
  const validated = validateResearchGuidedRouteCandidatePlanV1(input);
  const serialized = JSON.stringify(sortKeys(validated));
  if (
    Buffer.byteLength(serialized, "utf8") >
    POLICY.limits.maximumPlanBytes
  ) {
    throw new ResearchGuidedRouteCandidateError("output_too_large");
  }
  return serialized;
}

function validateProposal(input) {
  const value = strictObject(input, [
    "proposalId",
    "strategy",
    "activity",
    "routeType",
    "targetDistanceRangeKm",
    "targetDurationRangeMinutes",
    "maximumElevationGainMeters",
    "maximumTechnicalDifficulty",
    "viaCandidates",
    "mappedNetworkCandidates",
    "satisfiedRequirements",
    "unsatisfiedRequirements",
    "requiredVerification",
    "preliminaryDistanceEnvelope",
    "evidenceClaimIds",
    "knownLimitations"
  ], "proposal");

  const proposalId = boundedString(value.proposalId, 39, 39);
  if (!PROPOSAL_ID_PATTERN.test(proposalId)) invalid();
  const viaCandidates = boundedArray(
    value.viaCandidates,
    1,
    POLICY.limits.maximumViaCandidatesPerProposal
  ).map(validateViaCandidate);
  const mappedNetworkCandidates = boundedArray(
    value.mappedNetworkCandidates,
    0,
    POLICY.limits.maximumMappedNetworkCandidatesPerProposal
  ).map(validateMappedNetworkCandidate);
  assertUnique(viaCandidates.map((candidate) => candidate.entityId));
  assertUnique(mappedNetworkCandidates.map((candidate) => candidate.entityId));

  const evidenceClaimIds = uniqueUuidArray(
    value.evidenceClaimIds,
    1,
    POLICY.limits.maximumEvidenceReferencesPerProposal
  );
  const expectedClaimIds = [
    ...new Set([
      ...viaCandidates.flatMap((candidate) => candidate.evidenceClaimIds),
      ...mappedNetworkCandidates.flatMap((candidate) => candidate.evidenceClaimIds)
    ])
  ].sort(compareText);
  if (!sameValue(evidenceClaimIds, expectedClaimIds)) invalid();

  const satisfiedRequirements = boundedArray(
    value.satisfiedRequirements,
    0,
    POLICY.limits.maximumRequirementItems
  ).map((item) => validateRequirement(item, true));
  const unsatisfiedRequirements = boundedArray(
    value.unsatisfiedRequirements,
    0,
    POLICY.limits.maximumRequirementItems
  ).map((item) => validateRequirement(item, false));
  assertUnique([
    ...satisfiedRequirements,
    ...unsatisfiedRequirements
  ].map((item) => `${item.requirementType}:${item.value}`));

  return {
    proposalId,
    strategy: enumValue(value.strategy, POLICY.strategies),
    activity: enumValue(value.activity, POLICY.supportedActivities),
    routeType: enumValue(value.routeType, POLICY.supportedRouteTypes),
    targetDistanceRangeKm: nullableRange(value.targetDistanceRangeKm, 0.1, 500),
    targetDurationRangeMinutes: nullableIntegerRange(
      value.targetDurationRangeMinutes,
      15,
      10_080
    ),
    maximumElevationGainMeters: nullableInteger(
      value.maximumElevationGainMeters,
      0,
      20_000
    ),
    maximumTechnicalDifficulty: nullableEnum(
      value.maximumTechnicalDifficulty,
      POLICY.difficultyOrder
    ),
    viaCandidates,
    mappedNetworkCandidates,
    satisfiedRequirements,
    unsatisfiedRequirements,
    requiredVerification: uniqueEnumArray(
      value.requiredVerification,
      POLICY.verificationCodes,
      POLICY.limits.maximumVerificationCodes
    ),
    preliminaryDistanceEnvelope: validateDistanceEnvelope(
      value.preliminaryDistanceEnvelope
    ),
    evidenceClaimIds,
    knownLimitations: uniqueEnumArray(
      value.knownLimitations,
      POLICY.limitationCodes,
      POLICY.limits.maximumKnownLimitations
    )
  };
}

function validateViaCandidate(input) {
  const value = strictObject(input, [
    "entityId",
    "coordinate",
    "highlightCategory",
    "role",
    "evidenceClaimIds",
    "selectionReasons",
    "knownLimitations",
    "requiredVerification"
  ], "viaCandidate");
  return {
    entityId: uuid(value.entityId),
    coordinate: coordinate(value.coordinate),
    highlightCategory: enumValue(value.highlightCategory, HIGHLIGHT_CATEGORIES),
    role: enumValue(value.role, POLICY.candidateRoles),
    evidenceClaimIds: uniqueUuidArray(
      value.evidenceClaimIds,
      1,
      POLICY.limits.maximumEvidenceReferencesPerCandidate
    ),
    selectionReasons: uniqueEnumArray(
      value.selectionReasons,
      POLICY.selectionReasons,
      POLICY.limits.maximumSelectionReasonsPerCandidate
    ),
    knownLimitations: uniqueEnumArray(
      value.knownLimitations,
      POLICY.limitationCodes,
      POLICY.limits.maximumKnownLimitations
    ),
    requiredVerification: uniqueEnumArray(
      value.requiredVerification,
      POLICY.verificationCodes,
      POLICY.limits.maximumVerificationCodes
    )
  };
}

function validateMappedNetworkCandidate(input) {
  const value = strictObject(input, [
    "entityId",
    "sourceBasis",
    "evidenceClaimIds",
    "knownLimitations",
    "requiredVerification"
  ], "mappedNetworkCandidate");
  return {
    entityId: uuid(value.entityId),
    sourceBasis: enumValue(value.sourceBasis, ["mapped", "official", "mixed"]),
    evidenceClaimIds: uniqueUuidArray(
      value.evidenceClaimIds,
      1,
      POLICY.limits.maximumEvidenceReferencesPerCandidate
    ),
    knownLimitations: uniqueEnumArray(
      value.knownLimitations,
      POLICY.limitationCodes,
      POLICY.limits.maximumKnownLimitations
    ),
    requiredVerification: uniqueEnumArray(
      value.requiredVerification,
      POLICY.verificationCodes,
      POLICY.limits.maximumVerificationCodes
    )
  };
}

function validateRequirement(input, satisfied) {
  const value = strictObject(input, [
    "requirementType",
    "value",
    "requestedCount",
    "availableCount",
    "includedCount",
    "shortfallCount"
  ], "requirement");
  const result = {
    requirementType: enumValue(value.requirementType, POLICY.requirementTypes),
    value: enumValue(value.value, POLICY.requirementValues),
    requestedCount: integer(value.requestedCount, 1, 32),
    availableCount: integer(value.availableCount, 0, 32),
    includedCount: integer(value.includedCount, 0, 32),
    shortfallCount: integer(value.shortfallCount, 0, 32)
  };
  if (
    result.includedCount > result.availableCount ||
    result.includedCount > result.requestedCount ||
    result.shortfallCount !== result.requestedCount - result.includedCount ||
    satisfied !== (result.shortfallCount === 0)
  ) {
    invalid();
  }
  return result;
}

function validateDistanceEnvelope(input) {
  const value = strictObject(input, [
    "kind",
    "lowerBoundKm",
    "heuristicRangeKm",
    "targetRangeKm",
    "feasibilityState",
    "limitationCode"
  ], "preliminaryDistanceEnvelope");
  if (
    value.kind !== POLICY.preliminaryDistance.kind ||
    value.limitationCode !== POLICY.preliminaryDistance.limitationCode
  ) {
    invalid();
  }
  const lowerBoundKm = finiteNumber(value.lowerBoundKm, 0, 100_000);
  const heuristicRangeKm = range(value.heuristicRangeKm, 0, 165_000);
  if (heuristicRangeKm.min < lowerBoundKm) invalid();
  const targetRangeKm = nullableRange(value.targetRangeKm, 0.1, 500);
  const feasibilityState = enumValue(
    value.feasibilityState,
    FEASIBILITY_STATES
  );
  if (
    (targetRangeKm === null) !==
      (feasibilityState === "target_unspecified") ||
    (
      targetRangeKm !== null &&
      (lowerBoundKm > targetRangeKm.max) !==
        (feasibilityState === "lower_bound_exceeds_target")
    )
  ) {
    invalid();
  }
  return {
    kind: POLICY.preliminaryDistance.kind,
    lowerBoundKm,
    heuristicRangeKm,
    targetRangeKm,
    feasibilityState,
    limitationCode: POLICY.preliminaryDistance.limitationCode
  };
}

function validateEvidenceGap(input) {
  const value = strictObject(input, [
    "code",
    "entityId",
    "predicate",
    "experience",
    "requiredCount",
    "availableCount"
  ], "evidenceGap");
  const predicate = value.predicate === null
    ? null
    : boundedString(value.predicate, 1, 80);
  if (predicate !== null && !PREDICATE_SET.has(predicate)) invalid();
  const experience = value.experience === null
    ? null
    : enumValue(value.experience, POLICY.requirementValues);
  const requiredCount = nullableInteger(value.requiredCount, 0, 32);
  const availableCount = nullableInteger(value.availableCount, 0, 32);
  if (
    (requiredCount === null) !== (availableCount === null) ||
    (
      requiredCount !== null &&
      (
        requiredCount < 1 ||
        availableCount >= requiredCount
      )
    )
  ) {
    invalid();
  }
  return {
    code: enumValue(value.code, POLICY.evidenceGapCodes),
    entityId: value.entityId === null ? null : uuid(value.entityId),
    predicate,
    experience,
    requiredCount,
    availableCount
  };
}

function validateAnchor(input) {
  const value = strictObject(
    input,
    ["state", "name", "coordinate", "regionEntityId", "requirementCode"],
    "anchor",
    false
  );
  const state = enumValue(value.state, ["resolved", "unresolved"]);
  if (state === "resolved") {
    requireExactFields(
      value,
      ["state", "name", "coordinate", "regionEntityId"]
    );
    return {
      state,
      name: boundedString(value.name, 1, POLICY.limits.maximumStringLength),
      coordinate: coordinate(value.coordinate),
      regionEntityId:
        value.regionEntityId === null ? null : uuid(value.regionEntityId)
    };
  }
  requireExactFields(value, ["state", "requirementCode"]);
  return {
    state,
    requirementCode: enumValue(value.requirementCode, [
      "location_required",
      "start_required",
      "destination_required"
    ])
  };
}

function validatedIntent(input) {
  try {
    return validateAdventureResearchIntentV1(input);
  } catch {
    invalid();
  }
}

function strictObject(input, fields, _path, exact = true) {
  if (!input || typeof input !== "object" || Array.isArray(input)) invalid();
  const allowed = new Set(fields);
  if (Object.keys(input).some((key) => !allowed.has(key))) invalid();
  if (exact && fields.some((field) => !Object.hasOwn(input, field))) invalid();
  return input;
}

function requireExactFields(input, fields) {
  const expected = new Set(fields);
  if (
    Object.keys(input).some((key) => !expected.has(key)) ||
    fields.some((field) => !Object.hasOwn(input, field))
  ) {
    invalid();
  }
}

function coordinate(input) {
  const value = strictObject(
    input,
    ["latitude", "longitude"],
    "coordinate"
  );
  return {
    latitude: finiteNumber(value.latitude, -90, 90),
    longitude: finiteNumber(value.longitude, -180, 180)
  };
}

function nullableRange(input, minimum, maximum) {
  return input === null ? null : range(input, minimum, maximum);
}

function range(input, minimum, maximum) {
  const value = strictObject(input, ["min", "max"], "range");
  const result = {
    min: finiteNumber(value.min, minimum, maximum),
    max: finiteNumber(value.max, minimum, maximum)
  };
  if (result.min > result.max) invalid();
  return result;
}

function nullableIntegerRange(input, minimum, maximum) {
  if (input === null) return null;
  const value = strictObject(input, ["min", "max"], "integerRange");
  const result = {
    min: integer(value.min, minimum, maximum),
    max: integer(value.max, minimum, maximum)
  };
  if (result.min > result.max) invalid();
  return result;
}

function uniqueEnumArray(input, allowed, maximum) {
  const result = boundedArray(input, 0, maximum).map((value) =>
    enumValue(value, allowed)
  );
  assertUnique(result);
  return result;
}

function uniqueUuidArray(input, minimum, maximum) {
  const result = boundedArray(input, minimum, maximum).map(uuid);
  assertUnique(result);
  return result;
}

function boundedArray(input, minimum, maximum) {
  if (
    !Array.isArray(input) ||
    input.length < minimum ||
    input.length > maximum
  ) {
    invalid();
  }
  return input;
}

function enumValue(value, allowed) {
  if (!new Set(allowed).has(value)) invalid();
  return value;
}

function nullableEnum(value, allowed) {
  return value === null ? null : enumValue(value, allowed);
}

function boundedString(value, minimum, maximum) {
  if (
    typeof value !== "string" ||
    value !== value.trim() ||
    value.length < minimum ||
    value.length > maximum ||
    CONTROL_CHARACTER_PATTERN.test(value) ||
    value.includes("<") ||
    value.includes(">")
  ) {
    invalid();
  }
  return value;
}

function uuid(value) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) invalid();
  return value.toLowerCase();
}

function finiteNumber(value, minimum, maximum) {
  if (!Number.isFinite(value) || value < minimum || value > maximum) invalid();
  return value;
}

function integer(value, minimum, maximum) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) invalid();
  return value;
}

function nullableInteger(value, minimum, maximum) {
  return value === null ? null : integer(value, minimum, maximum);
}

function assertUnique(values) {
  if (new Set(values).size !== values.length) invalid();
}

function sameValue(left, right) {
  return canonical(left) === canonical(right);
}

function canonical(value) {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value).sort(compareText).map((key) => [key, sortKeys(value[key])])
  );
}

function compareText(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function enforceSerializedSize(input) {
  let serialized;
  try {
    serialized = JSON.stringify(input);
  } catch {
    invalid();
  }
  if (
    serialized === undefined ||
    Buffer.byteLength(serialized, "utf8") >
      POLICY.limits.maximumPlanBytes
  ) {
    throw new ResearchGuidedRouteCandidateError("output_too_large");
  }
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function invalid() {
  throw new ResearchGuidedRouteCandidateError("invalid_plan");
}

export const researchGuidedRouteCandidateValidationVocabularyForTesting =
  Object.freeze({
    states: Object.freeze(STATES),
    feasibilityStates: Object.freeze(FEASIBILITY_STATES),
    highlightCategories: Object.freeze(HIGHLIGHT_CATEGORIES),
    requirementValues: REQUIREMENT_VALUE_SET
  });
