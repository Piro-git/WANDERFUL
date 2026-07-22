import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveEvidenceClaimsV1 } from "../src/outdoorResearch/evidenceResolution.js";
import {
  evidenceClaim,
  officialClaim,
  OUTDOOR_RESEARCH_TEST_IDS
} from "./outdoorResearchTestSupport.js";

const NOW = "2026-07-22T10:00:00Z";

describe("outdoor research evidence resolution", () => {
  it("keeps missing access unknown instead of permitted or false", () => {
    const resolved = resolveEvidenceClaimsV1([], {
      now: NOW,
      entityId: OUTDOOR_RESEARCH_TEST_IDS.entity,
      predicate: "public_access"
    });
    assert.equal(resolved.state, "unknown");
    assert.equal(resolved.value, null);
    assert.equal(Object.hasOwn(resolved, "confidencePercentage"), false);
  });

  it("does not infer opening, overnight legality or beauty from mapped entity categories", () => {
    const hut = evidenceClaim({ value: { type: "text", value: "alpine_hut" } });
    for (const predicate of ["current_opening", "overnight_permission"]) {
      const resolved = resolveEvidenceClaimsV1([hut], {
        now: NOW, entityId: OUTDOOR_RESEARCH_TEST_IDS.entity, predicate
      });
      assert.equal(resolved.state, "unknown");
    }
    assert.throws(() => resolveEvidenceClaimsV1([evidenceClaim({ predicate: "scenic_quality" })], {
      now: NOW, entityId: OUTDOOR_RESEARCH_TEST_IDS.entity, predicate: "scenic_quality"
    }));
  });

  it("does not infer current waterfall flow from mapped waterfall presence", () => {
    const waterfall = evidenceClaim({
      predicate: "waterfall_presence",
      value: { type: "boolean", value: true }
    });
    const resolved = resolveEvidenceClaimsV1([waterfall], {
      now: NOW,
      entityId: OUTDOOR_RESEARCH_TEST_IDS.entity,
      predicate: "drinking_water_availability"
    });
    assert.equal(resolved.state, "unknown");
  });

  it("prevents community, model and derived evidence from independently resolving high stakes", () => {
    const variants = [
      {
        evidenceClass: "community_observed",
        sourceReference: {
          sourceId: OUTDOOR_RESEARCH_TEST_IDS.source,
          sourceKey: "trailmind.community",
          sourceCategory: "trailmind_community"
        }
      },
      {
        evidenceClass: "model_inferred",
        sourceReference: {
          sourceId: OUTDOOR_RESEARCH_TEST_IDS.source,
          sourceKey: "trailmind.model",
          sourceCategory: "model_inference"
        }
      },
      {
        evidenceClass: "derived",
        sourceReference: {
          sourceId: OUTDOOR_RESEARCH_TEST_IDS.source,
          sourceKey: "trailmind.derived",
          sourceCategory: "derived_computation"
        }
      }
    ];
    for (const variant of variants) {
      const claim = officialClaim({
        ...variant,
        resolutionState: "unknown",
        relevantLimitationCodes: ["insufficient_evidence"]
      });
      const resolved = resolveEvidenceClaimsV1([claim], {
        now: NOW,
        entityId: OUTDOOR_RESEARCH_TEST_IDS.entity,
        predicate: "public_access"
      });
      assert.equal(resolved.state, "unavailable");
      assert(resolved.limitationCodes.includes("official_evidence_required"));
    }
  });

  it("returns conflicted for conflicting current authoritative assertions", () => {
    const claims = [
      officialClaim(),
      officialClaim({
        claimId: OUTDOOR_RESEARCH_TEST_IDS.secondClaim,
        value: { type: "boolean", value: false },
        sourceReference: {
          sourceId: OUTDOOR_RESEARCH_TEST_IDS.secondSource,
          sourceKey: "innsbruck.operator",
          sourceCategory: "official_operator"
        },
        provenance: {
          identifier: "operator-access/42", adapterVersion: "operator-v1", recordVersion: 1
        }
      })
    ];
    const resolved = resolveEvidenceClaimsV1(claims, {
      now: NOW,
      entityId: OUTDOOR_RESEARCH_TEST_IDS.entity,
      predicate: "public_access"
    });
    assert.equal(resolved.state, "conflicted");
    assert.equal(resolved.conflictingValues.length, 2);
  });

  it("returns known only for agreeing, current and temporally valid evidence", () => {
    const resolved = resolveEvidenceClaimsV1([officialClaim()], {
      now: NOW,
      entityId: OUTDOOR_RESEARCH_TEST_IDS.entity,
      predicate: "public_access"
    });
    assert.equal(resolved.state, "known");
    assert.deepEqual(resolved.value, { type: "boolean", value: true });
    assert.deepEqual(resolved.evidenceClasses, ["official"]);
  });

  it("honors explicit unavailable, unknown and conflicted resolution states", () => {
    for (const resolutionState of ["unavailable", "unknown"]) {
      const resolved = resolveEvidenceClaimsV1([officialClaim({ resolutionState })], {
        now: NOW,
        entityId: OUTDOOR_RESEARCH_TEST_IDS.entity,
        predicate: "public_access"
      });
      assert.equal(resolved.state, "unavailable");
      assert.equal(resolved.value, null);
    }
    const conflicted = resolveEvidenceClaimsV1([officialClaim({ resolutionState: "conflicted" })], {
      now: NOW,
      entityId: OUTDOOR_RESEARCH_TEST_IDS.entity,
      predicate: "public_access"
    });
    assert.equal(conflicted.state, "conflicted");
    assert.equal(conflicted.value, null);
  });

  it("excludes stale and expired evidence from current resolution", () => {
    const stale = officialClaim({
      freshness: "stale",
      resolutionState: "stale",
      relevantLimitationCodes: ["source_stale"]
    });
    assert.equal(resolveEvidenceClaimsV1([stale], {
      now: NOW, entityId: OUTDOOR_RESEARCH_TEST_IDS.entity, predicate: "public_access"
    }).state, "stale");

    const expiredByTime = officialClaim({
      retrievedAt: "2026-07-20T09:00:00Z",
      validUntil: "2026-07-21T09:00:00Z"
    });
    assert.equal(resolveEvidenceClaimsV1([expiredByTime], {
      now: NOW, entityId: OUTDOOR_RESEARCH_TEST_IDS.entity, predicate: "public_access"
    }).state, "stale");
  });
});
