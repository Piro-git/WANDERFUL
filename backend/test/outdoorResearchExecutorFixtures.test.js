import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

const FIXTURE_URL = new URL(
  "./fixtures/outdoorResearchExecutorV1.json",
  import.meta.url
);
const STATES = new Set(["ready", "clarification_required", "unsupported"]);
const REGIONS = new Set(["harz-v1", "innsbruck-alps-v1"]);
const REQUIRED_TOPICS = new Set([
  "viewpoints",
  "waterfalls",
  "peaks",
  "lakes",
  "huts",
  "mapped_hiking_routes",
  "sac_scale",
  "trail_visibility",
  "access_restrictions",
  "multiple_must_have",
  "insufficient_must_have",
  "stale_data",
  "revoked_policy",
  "unsupported_official_claims",
  "overnight_requests",
  "exact_date",
  "biking_limitations",
  "unresolved_geography",
  "no_evidence"
]);

describe("outdoor research executor v1 evaluation fixture", () => {
  it("validates at least 40 deterministic Harz/Innsbruck scenarios", async () => {
    const raw = await readFile(FIXTURE_URL, "utf8");
    const corpus = JSON.parse(raw);
    assert.equal(corpus.schemaVersion, 1);
    assert(corpus.scenarios.length >= 40);
    assert.equal(new Set(corpus.scenarios.map((item) => item.id)).size,
      corpus.scenarios.length);
    const topics = new Set();
    const regionCounts = new Map();
    for (const scenario of corpus.scenarios) {
      assert.deepEqual(Object.keys(scenario).sort(), [
        "evidenceProfile", "expected", "id", "region", "topic"
      ]);
      assert.match(scenario.id, /^[a-z0-9_]{3,80}$/);
      assert(REGIONS.has(scenario.region));
      assert.equal(typeof scenario.evidenceProfile, "string");
      topics.add(scenario.topic);
      regionCounts.set(
        scenario.region,
        (regionCounts.get(scenario.region) ?? 0) + 1
      );
      assert.deepEqual(Object.keys(scenario.expected).sort(), [
        "candidateCategories",
        "forbiddenPredicates",
        "orderedCandidateKeys",
        "requiredGapCodes",
        "state"
      ]);
      assert(STATES.has(scenario.expected.state));
      for (const field of [
        "forbiddenPredicates",
        "orderedCandidateKeys",
        "requiredGapCodes"
      ]) {
        assert(Array.isArray(scenario.expected[field]));
        assert.equal(
          new Set(scenario.expected[field]).size,
          scenario.expected[field].length
        );
      }
      assert(Array.isArray(scenario.expected.candidateCategories));
      if (scenario.expected.state === "ready" &&
          scenario.expected.candidateCategories.length > 0) {
        assert(
          scenario.expected.requiredGapCodes.includes(
            "missing_route_connection"
          ),
          scenario.id
        );
      }
      if (scenario.expected.state !== "ready") {
        assert.deepEqual(scenario.expected.candidateCategories, []);
        assert.deepEqual(scenario.expected.orderedCandidateKeys, []);
      }
    }
    for (const topic of REQUIRED_TOPICS) assert(topics.has(topic), topic);
    assert(regionCounts.get("harz-v1") >= 20);
    assert(regionCounts.get("innsbruck-alps-v1") >= 20);
    assert.equal(JSON.stringify(JSON.parse(raw)), JSON.stringify(corpus));
  });

  it("forbids unsupported official/current facts in every ready profile", async () => {
    const corpus = JSON.parse(await readFile(FIXTURE_URL, "utf8"));
    for (const scenario of corpus.scenarios.filter((item) =>
      item.expected.state === "ready"
    )) {
      const forbidden = new Set(scenario.expected.forbiddenPredicates);
      assert(
        forbidden.has("public_access") ||
        forbidden.has("closure_status") ||
        forbidden.has("current_opening") ||
        forbidden.has("mapped_hiking_route_membership")
      );
    }
  });
});
