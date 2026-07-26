import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import {
  serializeOutdoorAdventurePlanningResponseV1,
  validateOutdoorAdventurePlanningResponseV1
} from "../src/outdoorAdventure/orchestrationContract.js";

const CORPUS_URL = new URL(
  "../../TrailMindTests/Fixtures/" +
    "outdoor_adventure_planning_v1_contract_corpus.json",
  import.meta.url
);
const MAXIMUM_CORPUS_BYTES = 2 * 1_024 * 1_024;
const MUTATION_OPERATIONS = new Set([
  "append_outer_padding_bytes",
  "repeat_attempt_to_count",
  "repeat_route_result_to_count"
]);
const REQUIRED_ACCEPTED_CASE_IDS = new Set([
  "advisory_mapped_network",
  "clarification_required",
  "no_viable_route",
  "partial_harz_route",
  "partial_innsbruck_route",
  "partial_provider_failure",
  "quality_reduction",
  "routed_harz_route",
  "unsupported_activity",
  "unsupported_region"
]);
const REQUIRED_REJECTED_CASE_IDS = new Set([
  "invalid_clarification_questions_differ",
  "invalid_clarification_with_empty_questions",
  "invalid_coordinate_range",
  "invalid_duplicate_clarification_questions",
  "invalid_duplicate_planning_gaps",
  "invalid_duplicate_proposal_identity",
  "invalid_excessive_attempts",
  "invalid_excessive_route_results",
  "invalid_graphhopper_geometry",
  "invalid_infinity_like_duration",
  "invalid_lineage_identity",
  "invalid_mapped_evidence_relabelled_official",
  "invalid_nan_like_distance",
  "invalid_nested_unknown_field",
  "invalid_outer_nested_intent_mismatch",
  "invalid_oversized_response",
  "invalid_partial_with_null_alternatives",
  "invalid_proposal_identity",
  "invalid_route_provenance_activity",
  "invalid_routed_with_null_alternatives",
  "invalid_routed_with_only_failed_attempts",
  "invalid_routed_with_planning_gaps",
  "invalid_routed_with_zero_route_results",
  "invalid_tampered_waypoint_coordinate",
  "invalid_unknown_evidence_limitation",
  "invalid_unknown_outer_field",
  "invalid_unknown_outer_state",
  "invalid_unsupported_with_success",
  "invalid_wrong_outer_schema_version",
  "invalid_wrong_policy_version"
]);
const FORBIDDEN_CORPUS_KEYS = new Set([
  "apikey",
  "authorization",
  "authorizationheader",
  "credential",
  "credentials",
  "providermessage",
  "provider_message",
  "prompt",
  "rawprompt",
  "secret",
  "token"
]);

const corpusBytes = await readFile(CORPUS_URL);
const corpusText = corpusBytes.toString("utf8");
const corpus = JSON.parse(corpusText);

describe("outdoor-adventure cross-language contract corpus v1", () => {
  it("has a strict bounded schema, deterministic IDs and no sensitive data", () => {
    assert(corpusBytes.byteLength < MAXIMUM_CORPUS_BYTES);
    exactKeys(corpus, [
      "corpusSchemaVersion",
      "contractVersions",
      "policyVersions",
      "cases"
    ]);
    assert.equal(corpus.corpusSchemaVersion, 1);
    exactKeys(corpus.contractVersions, [
      "outdoorAdventurePlanningResponse",
      "researchGuidedRoutedAlternatives"
    ]);
    assert.deepEqual(corpus.contractVersions, {
      outdoorAdventurePlanningResponse: 1,
      researchGuidedRoutedAlternatives: 1
    });
    exactKeys(corpus.policyVersions, [
      "candidatePlan",
      "hikingQuality",
      "orchestration",
      "routedAdapter"
    ]);
    assert.deepEqual(corpus.policyVersions, {
      orchestration: "outdoor-adventure-orchestration-v1",
      candidatePlan: "research-guided-route-candidates-v1",
      routedAdapter: "research-guided-routing-adapter-v1",
      hikingQuality: "hiking-route-quality-v1"
    });
    assert(Array.isArray(corpus.cases));
    assert(corpus.cases.length >= 40);

    const ids = corpus.cases.map((item) => item.id);
    assert.equal(new Set(ids).size, ids.length);
    assert.deepEqual(
      ids,
      [...ids].sort((left, right) => left.localeCompare(right))
    );

    const acceptedIds = new Set(
      corpus.cases.filter((item) => item.accepted).map((item) => item.id)
    );
    const rejectedIds = new Set(
      corpus.cases.filter((item) => !item.accepted).map((item) => item.id)
    );
    assertSetContains(acceptedIds, REQUIRED_ACCEPTED_CASE_IDS);
    assertSetContains(rejectedIds, REQUIRED_REJECTED_CASE_IDS);

    const casesById = validateCaseSchemas(corpus.cases);
    for (const item of corpus.cases) {
      if (item.mutation) {
        const base = casesById.get(item.mutation.baseCaseId);
        assert(base?.accepted, `${item.id} mutation base must be accepted`);
      }
    }

    walkJSON(corpus, (key, value) => {
      if (key !== null) {
        assert.equal(
          FORBIDDEN_CORPUS_KEYS.has(key.toLowerCase()),
          false,
          `forbidden corpus key: ${key}`
        );
      }
      if (typeof value === "string") {
        assert.doesNotMatch(value, /\bBearer\s+/i);
        assert.doesNotMatch(value, /\bsk-[a-z0-9_-]+/i);
        assert.doesNotMatch(value, /\bapi[_-]?key\b/i);
      }
    });
  });

  it("accepts and canonically serializes every valid response", () => {
    for (const item of corpus.cases.filter((entry) => entry.accepted)) {
      const validated = validateOutdoorAdventurePlanningResponseV1(
        item.response
      );
      assert.equal(validated.state, item.expected.outerState, item.id);
      assert.equal(
        validated.routedAlternatives?.state ?? null,
        item.expected.nestedState,
        item.id
      );
      assert.equal(
        validated.planningGaps.length,
        item.expected.planningGapCount,
        item.id
      );
      assert.equal(
        validated.clarificationQuestions.length,
        item.expected.clarificationQuestionCount,
        item.id
      );
      const routeCount = countRouteResults(validated);
      assertRange(
        routeCount,
        item.expected.backendRouteResultCount,
        item.id
      );
      if (validated.state === "routed") {
        assert.equal(validated.planningGaps.length, 0, item.id);
      }

      const serialized =
        serializeOutdoorAdventurePlanningResponseV1(item.response);
      assert.equal(
        serialized,
        serializeOutdoorAdventurePlanningResponseV1(item.response),
        item.id
      );
      assert.equal(
        serialized,
        serializeOutdoorAdventurePlanningResponseV1(
          reverseObjectKeys(item.response)
        ),
        item.id
      );
      assert.deepEqual(
        JSON.parse(serialized),
        validated,
        item.id
      );
    }

    const advisory = corpus.cases.find(
      (item) => item.id === "advisory_mapped_network"
    );
    const mappedCandidates = advisory.response.routedAlternatives.attempts
      .flatMap((attempt) => attempt.provenance.mappedNetworkCandidates);
    assert(mappedCandidates.length > 0);
    assert(mappedCandidates.every((candidate) =>
      candidate.sourceBasis === "mapped" &&
      candidate.knownLimitations.includes("mapped_presence_only") &&
      candidate.knownLimitations.includes("route_connection_unverified")
    ));
    assert(advisory.response.routedAlternatives.attempts.every((attempt) =>
      attempt.routeResults.every((result) =>
        result.geometryProvider === "graphhopper" &&
        result.routingStrategy === "backend"
      )
    ));
    const advisoryKeys = new Set();
    walkJSON(advisory.response, (key) => {
      if (key !== null) advisoryKeys.add(key);
    });
    for (const promotedClaimKey of [
      "isOfficial",
      "isCurrent",
      "isSafe",
      "isScenic",
      "officialRoute"
    ]) {
      assert.equal(advisoryKeys.has(promotedClaimKey), false);
    }
  });

  it("rejects every inconsistent or tampered response with a safe code", () => {
    const casesById = new Map(
      corpus.cases.map((item) => [item.id, item])
    );
    for (const item of corpus.cases.filter((entry) => !entry.accepted)) {
      const response = item.response ??
        materializeMutation(item.mutation, casesById);
      assert.throws(
        () => validateOutdoorAdventurePlanningResponseV1(response),
        (error) => {
          assert.equal(
            error.code,
            item.expected.backendErrorCode,
            item.id
          );
          assert.equal(error.message.length < 120, true, item.id);
          assert.equal(error.message.includes(JSON.stringify(response)), false);
          return true;
        },
        item.id
      );
    }
  });
});

function validateCaseSchemas(cases) {
  const casesById = new Map(cases.map((item) => [item.id, item]));
  for (const item of cases) {
    assert.equal(
      typeof item.id,
      "string",
      "case id must be a string"
    );
    assert.match(item.id, /^[a-z0-9_]+$/);
    assert.equal(typeof item.accepted, "boolean", item.id);
    const hasResponse = Object.hasOwn(item, "response");
    const hasMutation = Object.hasOwn(item, "mutation");
    assert.notEqual(hasResponse, hasMutation, item.id);
    exactKeys(
      item,
      hasResponse
        ? ["id", "accepted", "expected", "response"]
        : ["id", "accepted", "expected", "mutation"]
    );
    exactKeys(item.expected, [
      "backendErrorCode",
      "backendRouteResultCount",
      "clarificationQuestionCount",
      "iosAlternativeCount",
      "nestedState",
      "outerState",
      "planningGapCount"
    ]);

    if (item.accepted) {
      assert(hasResponse, item.id);
      assert.equal(item.expected.backendErrorCode, null, item.id);
      assert.equal(typeof item.expected.outerState, "string", item.id);
      assert(
        item.expected.nestedState === null ||
        typeof item.expected.nestedState === "string",
        item.id
      );
      assertNonnegativeInteger(
        item.expected.planningGapCount,
        item.id
      );
      assertNonnegativeInteger(
        item.expected.clarificationQuestionCount,
        item.id
      );
      validateRange(item.expected.backendRouteResultCount, item.id);
      validateRange(item.expected.iosAlternativeCount, item.id);
    } else {
      assert.equal(
        item.expected.backendErrorCode === "internal_failure" ||
        item.expected.backendErrorCode === "response_too_large",
        true,
        item.id
      );
      for (const field of [
        "outerState",
        "nestedState",
        "planningGapCount",
        "clarificationQuestionCount",
        "backendRouteResultCount",
        "iosAlternativeCount"
      ]) {
        assert.equal(item.expected[field], null, `${item.id}/${field}`);
      }
    }

    if (hasMutation) {
      exactKeys(item.mutation, [
        "baseCaseId",
        "count",
        "operation"
      ]);
      assert.equal(
        MUTATION_OPERATIONS.has(item.mutation.operation),
        true,
        item.id
      );
      assertNonnegativeInteger(item.mutation.count, item.id);
    }
  }
  return casesById;
}

function materializeMutation(descriptor, casesById) {
  const base = structuredClone(
    casesById.get(descriptor.baseCaseId).response
  );
  switch (descriptor.operation) {
  case "repeat_attempt_to_count": {
    const attempts = base.routedAlternatives.attempts;
    while (attempts.length < descriptor.count) {
      attempts.push(structuredClone(attempts[0]));
    }
    return base;
  }
  case "repeat_route_result_to_count": {
    const results = base.routedAlternatives.attempts[0].routeResults;
    while (results.length < descriptor.count) {
      results.push(structuredClone(results[0]));
    }
    return base;
  }
  case "append_outer_padding_bytes":
    base.padding = "x".repeat(descriptor.count);
    return base;
  default:
    assert.fail(`unsupported corpus mutation: ${descriptor.operation}`);
  }
}

function countRouteResults(response) {
  return response.routedAlternatives?.attempts.reduce(
    (total, attempt) => total + attempt.routeResults.length,
    0
  ) ?? 0;
}

function exactKeys(value, expected) {
  assert(value && typeof value === "object" && !Array.isArray(value));
  assert.deepEqual(Object.keys(value).sort(), [...expected].sort());
}

function assertSetContains(actual, expected) {
  for (const value of expected) {
    assert(actual.has(value), `missing required case: ${value}`);
  }
}

function assertNonnegativeInteger(value, context) {
  assert(
    Number.isInteger(value) && value >= 0,
    `${context}: expected nonnegative integer`
  );
}

function validateRange(range, context) {
  exactKeys(range, ["maximum", "minimum"]);
  assertNonnegativeInteger(range.minimum, context);
  assertNonnegativeInteger(range.maximum, context);
  assert(range.minimum <= range.maximum, context);
}

function assertRange(value, range, context) {
  assert(
    value >= range.minimum && value <= range.maximum,
    `${context}: ${value} outside ${range.minimum}...${range.maximum}`
  );
}

function reverseObjectKeys(value) {
  if (Array.isArray(value)) return value.map(reverseObjectKeys);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .reverse()
      .map(([key, child]) => [key, reverseObjectKeys(child)])
  );
}

function walkJSON(value, visit, key = null) {
  visit(key, value);
  if (Array.isArray(value)) {
    for (const child of value) walkJSON(child, visit, null);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [childKey, child] of Object.entries(value)) {
    walkJSON(child, visit, childKey);
  }
}
