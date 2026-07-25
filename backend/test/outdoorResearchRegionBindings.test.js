import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  OUTDOOR_RESEARCH_REGION_BINDINGS_V1,
  resolveOutdoorResearchRegionBindingV1,
  validateOutdoorResearchRegionBindingsV1
} from "../src/outdoorResearch/regionBindings.js";
import {
  deriveResearchSearchRadiusMetersV1,
  OUTDOOR_RESEARCH_EXECUTOR_POLICY_V1
} from "../src/outdoorResearch/executorPolicy.js";
import { completeAdventureResearchIntent } from "./outdoorResearchTestSupport.js";

describe("outdoor research region bindings and executor bounds", () => {
  it("binds the exact reviewed Harz and Innsbruck identifiers without fallback", () => {
    assert.deepEqual(
      OUTDOOR_RESEARCH_REGION_BINDINGS_V1.map((binding) => [
        binding.regionEntityId,
        binding.operationalRegionId
      ]),
      [
        ["30000000-0000-4000-8000-000000000001", "innsbruck-alps-v1"],
        ["30000000-0000-4000-8000-000000000002", "harz-v1"]
      ]
    );
    assert.equal(resolveOutdoorResearchRegionBindingV1(
      "30000000-0000-4000-8000-000000000001",
      "hiking"
    ).operationalRegionId, "innsbruck-alps-v1");
    assert.equal(resolveOutdoorResearchRegionBindingV1(
      "30000000-0000-4000-8000-000000000002",
      "trail_running"
    ).operationalRegionId, "harz-v1");
    assert.equal(resolveOutdoorResearchRegionBindingV1(
      "99999999-9999-4999-8999-999999999999",
      "hiking"
    ), undefined);
  });

  it("rejects duplicate IDs, unknown fields, malformed values and empty activity scope", () => {
    const valid = OUTDOOR_RESEARCH_REGION_BINDINGS_V1[0];
    for (const input of [
      [valid, { ...valid }],
      [valid, { ...valid, operationalRegionId: "harz-v1" }],
      [{ ...valid, nearestRegionFallback: true }],
      [{ ...valid, operationalRegionId: "Harz" }],
      [{ ...valid, displayName: " Harz" }],
      [{ ...valid, supportedActivities: [] }],
      [{ ...valid, supportedActivities: ["hiking", "hiking"] }]
    ]) {
      assert.throws(() => validateOutdoorResearchRegionBindingsV1(input));
    }
  });

  it("returns deterministic deeply immutable ordering", () => {
    const reversed = validateOutdoorResearchRegionBindingsV1(
      [...OUTDOOR_RESEARCH_REGION_BINDINGS_V1].reverse().map((binding) => ({
        ...binding,
        supportedActivities: [...binding.supportedActivities].reverse()
      }))
    );
    assert.deepEqual(reversed, OUTDOOR_RESEARCH_REGION_BINDINGS_V1);
    assertDeeplyFrozen(reversed);
  });

  it("derives a documented bounded deterministic search radius", () => {
    assert.equal(deriveResearchSearchRadiusMetersV1(
      completeAdventureResearchIntent({ distanceRangeKm: { min: 10, max: 16 } })
    ), 8_000);
    assert.equal(deriveResearchSearchRadiusMetersV1(
      completeAdventureResearchIntent({ distanceRangeKm: { min: 0.1, max: 0.1 } })
    ), OUTDOOR_RESEARCH_EXECUTOR_POLICY_V1.minimumSearchRadiusMeters);
    assert.equal(deriveResearchSearchRadiusMetersV1(
      completeAdventureResearchIntent({ distanceRangeKm: { min: 400, max: 500 } })
    ), OUTDOOR_RESEARCH_EXECUTOR_POLICY_V1.maximumSearchRadiusMeters);
  });
});

function assertDeeplyFrozen(value) {
  if (!value || typeof value !== "object") return;
  assert.equal(Object.isFrozen(value), true);
  for (const child of Object.values(value)) assertDeeplyFrozen(child);
}
