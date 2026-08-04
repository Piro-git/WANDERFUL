import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import {
  validateOutdoorAdventurePlanningResponseV1
} from "../src/outdoorAdventure/orchestrationContract.js";
import {
  serializeOutdoorAdventurePlanningResponseV2,
  validateOutdoorAdventurePlanningResponseV2
} from "../src/outdoorAdventure/orchestrationContractV2.js";

const CORPUS_URL = new URL(
  "../../TrailMindTests/Fixtures/" +
    "outdoor_adventure_planning_v2_contract_corpus.json",
  import.meta.url
);
const bytes = await readFile(CORPUS_URL);
const corpus = JSON.parse(bytes.toString("utf8"));

describe("outdoor-adventure cross-language contract corpus v2", () => {
  it("declares additive versions, bounded deterministic cases and no secrets", () => {
    assert(bytes.byteLength < 256 * 1_024);
    exactKeys(corpus, [
      "corpusSchemaVersion", "contractVersions", "policyVersions",
      "envelopes", "cases"
    ]);
    assert.equal(corpus.corpusSchemaVersion, 2);
    assert.deepEqual(corpus.contractVersions, {
      outdoorAdventurePlanningResponse: 2,
      researchGuidedRoutedAlternatives: 2,
      researchTrailAccessCandidate: 1
    });
    assert.deepEqual(corpus.policyVersions, {
      orchestration: "outdoor-adventure-orchestration-v2",
      candidatePlan: "research-guided-route-candidates-v2",
      routedAdapter: "research-guided-routing-adapter-v2",
      trailAccess: "research-trail-access-candidates-v1"
    });
    const ids = corpus.cases.map((item) => item.id);
    assert.equal(new Set(ids).size, ids.length);
    assert.deepEqual(ids, [...ids].sort());
    assert(corpus.cases.some((item) => item.id === "routed_reached_highlight"));
    assert(corpus.cases.some((item) => item.id === "invalid_lineage_id_tamper"));
    assert(corpus.cases.some((item) => item.id === "invalid_routed_with_planning_gap"));
    assert.doesNotMatch(bytes.toString("utf8"), /Bearer\s|api[_-]?key|secret|token/i);
  });

  it("accepts and canonically serializes every valid V2 response", () => {
    for (const item of corpus.cases.filter((entry) => entry.accepted)) {
      const input = structuredClone(corpus.envelopes[item.envelope]);
      const validated = validateOutdoorAdventurePlanningResponseV2(input);
      assert.equal(validated.schemaVersion, 2, item.id);
      assert.equal(
        serializeOutdoorAdventurePlanningResponseV2(input),
        serializeOutdoorAdventurePlanningResponseV2(reverseKeys(input)),
        item.id
      );
    }
    const approach = corpus.envelopes.routed.routedAlternatives.attempts[0]
      .routeResults[0].highlightVerifications[0];
    assert.notDeepEqual(approach.evidenceCoordinate, approach.routingCoordinate);
    assert.equal(approach.providerVerifiedAccess, true);
    assert.equal(approach.approachState, "reached");
  });

  it("rejects every shared V2 mutation and keeps V1/V2 version boundaries", () => {
    for (const item of corpus.cases.filter((entry) => !entry.accepted)) {
      const input = structuredClone(corpus.envelopes[item.envelope]);
      setAtPath(input, item.mutation.path, item.mutation.value);
      assert.throws(
        () => validateOutdoorAdventurePlanningResponseV2(input),
        undefined,
        item.id
      );
    }
    assert.throws(() => validateOutdoorAdventurePlanningResponseV1(
      corpus.envelopes.routed
    ));
    const v1 = structuredClone(corpus.envelopes.noViable);
    v1.schemaVersion = 1;
    v1.policyVersion = "outdoor-adventure-orchestration-v1";
    assert.throws(() => validateOutdoorAdventurePlanningResponseV2(v1));
  });

  it("keeps a routed nested envelope coherent as partial when planning gaps remain", () => {
    const partial = structuredClone(corpus.envelopes.routed);
    partial.state = "partial";
    partial.planningGaps = [{
      code: "official_source_unavailable",
      affectedField: "capabilities",
      affectedValue: "retrieve_mapped_hiking_routes",
      reason: "authority_not_available",
      requiresClarification: false,
      requiresCapability: true
    }];
    const validated = validateOutdoorAdventurePlanningResponseV2(partial);
    assert.equal(validated.state, "partial");
    assert.equal(validated.routedAlternatives.state, "routed");
    assert.equal(validated.planningGaps.length, 1);
  });
});

function setAtPath(root, path, replacement) {
  let cursor = root;
  for (const segment of path.slice(0, -1)) cursor = cursor[segment];
  cursor[path.at(-1)] = replacement;
}

function exactKeys(value, fields) {
  assert(value && typeof value === "object" && !Array.isArray(value));
  assert.deepEqual(Object.keys(value).sort(), [...fields].sort());
}

function reverseKeys(value) {
  if (Array.isArray(value)) return value.map(reverseKeys);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value).reverse().map((key) => [key, reverseKeys(value[key])])
  );
}
