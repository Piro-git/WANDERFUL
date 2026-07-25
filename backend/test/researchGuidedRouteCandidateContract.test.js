import assert from "node:assert/strict";
import test from "node:test";
import {
  RESEARCH_GUIDED_ROUTE_CANDIDATE_ERROR_CODES_V1,
  RESEARCH_GUIDED_ROUTE_CANDIDATE_POLICY_V1,
  ResearchGuidedRouteCandidateError,
  buildResearchGuidedRouteCandidatePlanV1,
  serializeResearchGuidedRouteCandidatePlanV1,
  validateResearchGuidedRouteCandidatePlanV1
} from "../src/routeResearch/index.js";
import {
  adventureResearchDossier
} from "./outdoorResearchTestSupport.js";

test("policy and validated plan are deeply immutable", () => {
  const plan = buildResearchGuidedRouteCandidatePlanV1(
    adventureResearchDossier()
  );

  assert.equal(Object.isFrozen(RESEARCH_GUIDED_ROUTE_CANDIDATE_POLICY_V1), true);
  assert.equal(
    Object.isFrozen(RESEARCH_GUIDED_ROUTE_CANDIDATE_POLICY_V1.limits),
    true
  );
  assertDeeplyFrozen(plan);
});

test("strict validator rejects unknown fields at every plan-owned level", () => {
  const plan = mutable(
    buildResearchGuidedRouteCandidatePlanV1(adventureResearchDossier())
  );
  const mutations = [
    (value) => { value.unexpected = true; },
    (value) => { value.anchor.unexpected = true; },
    (value) => { value.proposals[0].unexpected = true; },
    (value) => { value.proposals[0].viaCandidates[0].unexpected = true; },
    (value) => {
      value.proposals[0].viaCandidates[0].coordinate.altitude = 100;
    },
    (value) => {
      value.proposals[0].unsatisfiedRequirements[0].unexpected = true;
    },
    (value) => {
      value.proposals[0].preliminaryDistanceEnvelope.unexpected = true;
    },
    (value) => { value.evidenceGaps[0].unexpected = true; }
  ];

  for (const mutate of mutations) {
    const candidate = mutable(plan);
    mutate(candidate);
    assertSafePlanError(
      () => validateResearchGuidedRouteCandidatePlanV1(candidate),
      "invalid_plan"
    );
  }
});

test("strict validator enforces proposal/state and requirement invariants", () => {
  const plan = mutable(
    buildResearchGuidedRouteCandidatePlanV1(adventureResearchDossier())
  );

  const emptyReady = mutable(plan);
  emptyReady.state = "ready";
  emptyReady.proposals = [];
  emptyReady.unmetRequirements = [];
  assertSafePlanError(
    () => validateResearchGuidedRouteCandidatePlanV1(emptyReady),
    "invalid_plan"
  );

  const falseShortfall = mutable(plan);
  falseShortfall.proposals[0].unsatisfiedRequirements[0].shortfallCount = 0;
  assertSafePlanError(
    () => validateResearchGuidedRouteCandidatePlanV1(falseShortfall),
    "invalid_plan"
  );

  const changedCoordinate = mutable(plan);
  changedCoordinate.proposals[0].viaCandidates[0].coordinate.latitude += 0.001;
  assert.doesNotThrow(() =>
    validateResearchGuidedRouteCandidatePlanV1(changedCoordinate)
  );
});

test("standalone validator recomputes state, aggregates, and proposal identity", () => {
  const plan = mutable(
    buildResearchGuidedRouteCandidatePlanV1(adventureResearchDossier())
  );

  const falseReady = mutable(plan);
  falseReady.state = "ready";
  assertSafePlanError(
    () => validateResearchGuidedRouteCandidatePlanV1(falseReady),
    "invalid_plan"
  );

  const highStakesReady = mutable(plan);
  highStakesReady.proposals[0].unsatisfiedRequirements = [];
  highStakesReady.unmetRequirements = [];
  highStakesReady.state = "ready";
  assertSafePlanError(
    () => validateResearchGuidedRouteCandidatePlanV1(highStakesReady),
    "invalid_plan"
  );

  const falsePartial = mutable(plan);
  falsePartial.proposals[0].unsatisfiedRequirements = [];
  falsePartial.proposals[0].viaCandidates[0].requiredVerification = [
    "connectivity_required"
  ];
  falsePartial.proposals[0].requiredVerification = [
    "real_routing_required",
    "connectivity_required",
    "actual_distance_required",
    "actual_duration_required",
    "actual_elevation_required"
  ];
  falsePartial.unmetRequirements = [];
  falsePartial.requiredVerification = [
    ...falsePartial.proposals[0].requiredVerification
  ];
  falsePartial.state = "partial";
  assertSafePlanError(
    () => validateResearchGuidedRouteCandidatePlanV1(falsePartial),
    "invalid_plan"
  );

  const wrongUnmet = mutable(plan);
  wrongUnmet.unmetRequirements = [];
  assertSafePlanError(
    () => validateResearchGuidedRouteCandidatePlanV1(wrongUnmet),
    "invalid_plan"
  );

  const wrongVerification = mutable(plan);
  wrongVerification.requiredVerification =
    wrongVerification.requiredVerification.slice(1);
  assertSafePlanError(
    () => validateResearchGuidedRouteCandidatePlanV1(wrongVerification),
    "invalid_plan"
  );

  const reorderedVerification = mutable(plan);
  reorderedVerification.requiredVerification.reverse();
  assertSafePlanError(
    () => validateResearchGuidedRouteCandidatePlanV1(
      reorderedVerification
    ),
    "invalid_plan"
  );

  const mutatedId = mutable(plan);
  const currentId = mutatedId.proposals[0].proposalId;
  mutatedId.proposals[0].proposalId =
    `${currentId.slice(0, -1)}${currentId.endsWith("a") ? "b" : "a"}`;
  assert.match(
    mutatedId.proposals[0].proposalId,
    /^rrcpv1_[0-9a-f]{32}$/
  );
  assertSafePlanError(
    () => validateResearchGuidedRouteCandidatePlanV1(mutatedId),
    "invalid_plan"
  );
});

test("serializer canonicalizes object key order and is byte deterministic", () => {
  const plan = buildResearchGuidedRouteCandidatePlanV1(
    adventureResearchDossier()
  );
  const shuffledKeys = reverseObjectKeys(plan);

  assert.equal(
    serializeResearchGuidedRouteCandidatePlanV1(plan),
    serializeResearchGuidedRouteCandidatePlanV1(shuffledKeys)
  );
  assert.equal(
    serializeResearchGuidedRouteCandidatePlanV1(plan),
    serializeResearchGuidedRouteCandidatePlanV1(plan)
  );
});

test("validator rejects duplicate references and dangling proposal references", () => {
  const plan = mutable(
    buildResearchGuidedRouteCandidatePlanV1(adventureResearchDossier())
  );
  const duplicate = mutable(plan);
  duplicate.proposals[0].evidenceClaimIds.push(
    duplicate.proposals[0].evidenceClaimIds[0]
  );
  assertSafePlanError(
    () => validateResearchGuidedRouteCandidatePlanV1(duplicate),
    "invalid_plan"
  );

  const dangling = mutable(plan);
  dangling.proposals[0].evidenceClaimIds[0] =
    "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  assertSafePlanError(
    () => validateResearchGuidedRouteCandidatePlanV1(dangling),
    "invalid_plan"
  );
});

test("oversized plan rejection uses a fixed bounded safe error", () => {
  const oversized = {
    unexpected: "x".repeat(
      RESEARCH_GUIDED_ROUTE_CANDIDATE_POLICY_V1.limits.maximumPlanBytes + 1
    )
  };
  assertSafePlanError(
    () => validateResearchGuidedRouteCandidatePlanV1(oversized),
    "output_too_large"
  );
});

test("error vocabulary is fixed and error messages reflect no input", () => {
  assert.deepEqual(RESEARCH_GUIDED_ROUTE_CANDIDATE_ERROR_CODES_V1, [
    "invalid_dossier",
    "invalid_options",
    "invalid_plan",
    "policy_inconsistent",
    "output_too_large"
  ]);
  const marker = "private-prompt-coordinate-47.0000";
  let thrown;
  try {
    validateResearchGuidedRouteCandidatePlanV1({ marker });
  } catch (error) {
    thrown = error;
  }
  assert.ok(thrown instanceof ResearchGuidedRouteCandidateError);
  assert.equal(thrown.code, "invalid_plan");
  assert.equal(thrown.message, "Route candidate plan is invalid.");
  assert.equal(thrown.message.includes(marker), false);
  assert.equal(thrown.stack.includes(marker), false);
});

function assertSafePlanError(action, code) {
  assert.throws(action, (error) => {
    assert.ok(error instanceof ResearchGuidedRouteCandidateError);
    assert.equal(error.code, code);
    assert.ok(error.message.length <= 64);
    return true;
  });
}

function mutable(value) {
  return structuredClone(value);
}

function reverseObjectKeys(value) {
  if (Array.isArray(value)) return value.map(reverseObjectKeys);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .reverse()
      .map((key) => [key, reverseObjectKeys(value[key])])
  );
}

function assertDeeplyFrozen(value) {
  if (!value || typeof value !== "object") return;
  assert.equal(Object.isFrozen(value), true);
  for (const child of Object.values(value)) assertDeeplyFrozen(child);
}
