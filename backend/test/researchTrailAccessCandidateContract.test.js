import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildResearchTrailAccessResolutionV1,
  deriveResearchTrailAccessCandidateIdV1,
  RESEARCH_TRAIL_ACCESS_CANDIDATE_POLICY_V1,
  serializeResearchTrailAccessResolutionV1,
  validateResearchTrailAccessCandidateV1,
  validateResearchTrailAccessResolutionV1
} from "../src/routeResearch/index.js";

const HIGHLIGHT_ID = "11111111-1111-4111-8111-111111111111";
const TRAIL_ID = "22222222-2222-4222-8222-222222222222";
const CLAIM_ID = "33333333-3333-4333-8333-333333333333";
const RUN_ID = "44444444-4444-4444-8444-444444444444";
const IMPORT_ID = "55555555-5555-4555-8555-555555555555";
const SOURCE_ID = "66666666-6666-4666-8666-666666666666";
const POLICY_ID = "77777777-7777-4777-8777-777777777777";

describe("ResearchTrailAccessCandidateV1 contract", () => {
  it("keeps evidence and routing coordinates separate without provider verification", () => {
    const candidate = validCandidate();
    const validated = validateResearchTrailAccessCandidateV1(candidate);
    assert.deepEqual(validated.evidenceCoordinate, {
      latitude: 47.2692,
      longitude: 11.4041
    });
    assert.notDeepEqual(
      validated.routingCoordinate,
      validated.evidenceCoordinate
    );
    assert.equal(validated.accessCandidateState, "candidate");
    assert(validated.knownLimitations.includes(
      "provider_connectivity_unverified"
    ));
    assert(validated.requiredVerification.includes("provider_snap_required"));
    assert.equal(Object.hasOwn(validated, "providerVerifiedAccess"), false);
  });

  it("binds identity to both coordinates and complete source lineage", () => {
    const original = validCandidate();
    const moved = validCandidate({
      routingCoordinate: { latitude: 47.2693, longitude: 11.4041 },
      poiToAccessPointDistanceMeters: 11.12
    });
    const changedRun = validCandidate({
      sourceSnapshot: {
        ...original.sourceSnapshot,
        projectionRunId: "88888888-8888-4888-8888-888888888888"
      }
    });
    const changedFreshness = validCandidate({
      freshness: {
        state: "current",
        sourceDataDate: "2026-08-03",
        retrievedDate: "2026-08-05"
      }
    });
    assert.notEqual(original.candidateId, moved.candidateId);
    assert.notEqual(original.candidateId, changedRun.candidateId);
    assert.notEqual(original.candidateId, changedFreshness.candidateId);
  });

  it("fails closed for unknown fields, malformed coordinates and tampering", () => {
    assert.throws(() => validateResearchTrailAccessCandidateV1({
      ...validCandidate(),
      providerVerifiedAccess: true
    }));
    assert.throws(() => validateResearchTrailAccessCandidateV1({
      ...validCandidate(),
      routingCoordinate: { latitude: 91, longitude: 11.4041 }
    }));
    assert.throws(() => validateResearchTrailAccessCandidateV1({
      ...validCandidate(),
      candidateId: "rtacv1_00000000000000000000000000000000"
    }));
  });

  it("enforces the reviewed radius and coordinate-distance coherence", () => {
    assert.throws(() => validateResearchTrailAccessCandidateV1(
      validCandidate({
        routingCoordinate: { latitude: 47.2700, longitude: 11.4041 },
        poiToAccessPointDistanceMeters:
          RESEARCH_TRAIL_ACCESS_CANDIDATE_POLICY_V1
            .maximumPoiToTrailDistanceMeters + 0.001
      })
    ));
    assert.throws(() => validateResearchTrailAccessCandidateV1(
      validCandidate({ poiToAccessPointDistanceMeters: 40 })
    ));
  });

  it("requires one bounded outcome for every requested highlight", () => {
    const resolution = validResolution();
    assert.equal(validateResearchTrailAccessResolutionV1(resolution)
      .candidates.length, 1);
    assert.throws(() => validateResearchTrailAccessResolutionV1({
      ...resolution,
      candidates: [],
      shortfalls: []
    }));
    assert.throws(() => validateResearchTrailAccessResolutionV1({
      ...resolution,
      shortfalls: [{
        entityId: HIGHLIGHT_ID,
        highlightCategory: "viewpoint",
        evidenceCoordinate: { latitude: 47.2692, longitude: 11.4041 },
        code: "no_eligible_mapped_trail_within_radius",
        knownLimitations: ["mapped_trail_only"]
      }]
    }));
  });

  it("rejects mixed candidate source snapshots across every authority field", () => {
    const resolution = validResolution();
    const mutations = [
      ["importId", "88888888-8888-4888-8888-888888888888"],
      ["sourceId", "88888888-8888-4888-8888-888888888888"],
      ["sourcePolicyId", "88888888-8888-4888-8888-888888888888"],
      ["sourcePolicyVersion", "osm-foundational-v2"],
      ["adapterSchemaVersion", "osm-evidence-graph-v2"],
      ["projectionRunId", "88888888-8888-4888-8888-888888888888"],
      ["operationalRegionId", "unauthorized-region-v1"]
    ];
    for (const [field, value] of mutations) {
      const sourceSnapshot = {
        ...candidateSourceSnapshot(),
        [field]: value
      };
      const sourceTrailRecord = {
        ...validCandidate().sourceTrailRecord,
        ...(field === "importId" ? { importId: value } : {}),
        ...(field === "operationalRegionId"
          ? { operationalRegionId: value }
          : {})
      };
      const mixed = validCandidate({
        sourceSnapshot,
        sourceTrailRecord,
        sourceTrailSegmentEntityId:
          "99999999-9999-4999-8999-999999999999"
      });
      assert.throws(
        () => validateResearchTrailAccessResolutionV1({
          ...resolution,
          candidates: [resolution.candidates[0], mixed]
        }),
        undefined,
        field
      );
    }
  });

  it("rejects resolution region, run and freshness inconsistent with its snapshot", () => {
    const resolution = validResolution();
    assert.throws(() => validateResearchTrailAccessResolutionV1({
      ...resolution,
      projectionRunId: "88888888-8888-4888-8888-888888888888"
    }));
    assert.throws(() => validateResearchTrailAccessResolutionV1({
      ...resolution,
      operationalRegionId: "unauthorized-region-v1"
    }));
    assert.throws(() => validateResearchTrailAccessResolutionV1({
      ...resolution,
      sourceSnapshot: {
        ...resolution.sourceSnapshot,
        freshness: {
          ...resolution.sourceSnapshot.freshness,
          sourceDataDate: "2026-08-02"
        }
      }
    }));
  });

  it("serializes deterministically", () => {
    const resolution = validResolution();
    assert.equal(
      serializeResearchTrailAccessResolutionV1(resolution),
      serializeResearchTrailAccessResolutionV1(reverseKeys(resolution))
    );
  });
});

describe("trail access row resolver", () => {
  it("materializes bounded source lineage and coarse current freshness", () => {
    const resolution = buildResearchTrailAccessResolutionV1({
      operationalRegionId: "innsbruck-alps-v1",
      projectionRunId: RUN_ID,
      sourceSnapshot: resolutionSourceSnapshot(),
      highlights: [requestedHighlight()],
      rows: [validRow()]
    });
    const candidate = resolution.candidates[0];
    assert.equal(candidate.sourceTrailSegmentEntityId, TRAIL_ID);
    assert.deepEqual(
      candidate.sourceTrailCategoryEvidenceClaimIds,
      [CLAIM_ID]
    );
    assert.deepEqual(candidate.sourceTrailRecord, {
      importId: IMPORT_ID,
      operationalRegionId: "innsbruck-alps-v1",
      osmType: "way",
      osmId: "123456",
      highwayClass: "path"
    });
    assert.deepEqual(candidate.freshness, {
      state: "current",
      sourceDataDate: "2026-08-03",
      retrievedDate: "2026-08-04"
    });
    assert.equal(candidate.displayName, "Mapped Viewpoint");
  });

  it("rejects rows from a different import, source, policy or adapter snapshot", () => {
    const fields = [
      ["import_id", "88888888-8888-4888-8888-888888888888"],
      ["source_id", "88888888-8888-4888-8888-888888888888"],
      ["source_policy_id", "88888888-8888-4888-8888-888888888888"],
      ["source_policy_version", "osm-foundational-v2"],
      ["adapter_schema_version", "osm-evidence-graph-v2"],
      ["projection_run_id", "88888888-8888-4888-8888-888888888888"],
      ["operational_region_id", "unauthorized-region-v1"]
    ];
    for (const [field, value] of fields) {
      assert.throws(() => buildResearchTrailAccessResolutionV1({
        operationalRegionId: "innsbruck-alps-v1",
        projectionRunId: RUN_ID,
        sourceSnapshot: resolutionSourceSnapshot(),
        highlights: [requestedHighlight()],
        rows: [validRow({ [field]: value })]
      }), undefined, field);
    }
  });

  it("returns a typed shortfall instead of inventing an access point", () => {
    const resolution = buildResearchTrailAccessResolutionV1({
      operationalRegionId: "innsbruck-alps-v1",
      projectionRunId: RUN_ID,
      sourceSnapshot: resolutionSourceSnapshot(),
      highlights: [requestedHighlight()],
      rows: []
    });
    assert.equal(resolution.candidates.length, 0);
    assert.equal(
      resolution.shortfalls[0].code,
      "no_eligible_mapped_trail_within_radius"
    );
    assert.deepEqual(
      resolution.shortfalls[0].evidenceCoordinate,
      requestedHighlight().evidenceCoordinate
    );
  });
});

function validCandidate(overrides = {}) {
  const base = {
    schemaVersion: 1,
    originalHighlightEntityId: HIGHLIGHT_ID,
    highlightCategory: "viewpoint",
    evidenceCoordinate: { latitude: 47.2692, longitude: 11.4041 },
    routingCoordinate: { latitude: 47.26925, longitude: 11.4041 },
    sourceTrailSegmentEntityId: TRAIL_ID,
    sourceTrailCategoryEvidenceClaimIds: [CLAIM_ID],
    sourceSnapshot: candidateSourceSnapshot(),
    derivationPolicyVersion: "research-trail-access-candidates-v1",
    derivationAlgorithm: "postgis-st-closest-point-v1",
    poiToAccessPointDistanceMeters: 5.56,
    sourceTrailHighwayClass: "path",
    sourceTrailRecord: {
      importId: IMPORT_ID,
      operationalRegionId: "innsbruck-alps-v1",
      osmType: "way",
      osmId: "123456",
      highwayClass: "path"
    },
    lifecycleState: "current",
    accessCandidateState: "candidate",
    knownLimitations: [
      "mapped_trail_only",
      "provider_connectivity_unverified",
      "provider_access_unverified",
      "public_access_unverified"
    ],
    requiredVerification: [
      "provider_routing_required",
      "provider_snap_required",
      "route_geometry_approach_required",
      "public_access_required"
    ],
    displayName: "Mapped Viewpoint",
    freshness: {
      state: "current",
      sourceDataDate: "2026-08-03",
      retrievedDate: "2026-08-04"
    }
  };
  const value = { ...base, ...overrides };
  value.candidateId = deriveResearchTrailAccessCandidateIdV1(value);
  return value;
}

function validResolution() {
  return {
    schemaVersion: 1,
    policyVersion: "research-trail-access-candidates-v1",
    operationalRegionId: "innsbruck-alps-v1",
    projectionRunId: RUN_ID,
    sourceSnapshot: resolutionSourceSnapshot(),
    requestedHighlights: [requestedHighlight()],
    candidates: [validCandidate()],
    shortfalls: []
  };
}

function candidateSourceSnapshot() {
  return {
    operationalRegionId: "innsbruck-alps-v1",
    projectionRunId: RUN_ID,
    importId: IMPORT_ID,
    sourceId: SOURCE_ID,
    sourcePolicyId: POLICY_ID,
    sourcePolicyVersion: "osm-foundational-v1",
    adapterSchemaVersion: "osm-evidence-graph-v1"
  };
}

function resolutionSourceSnapshot() {
  return {
    ...candidateSourceSnapshot(),
    freshness: {
      state: "current",
      sourceDataDate: "2026-08-03",
      retrievedDate: "2026-08-04"
    }
  };
}

function requestedHighlight() {
  return {
    entityId: HIGHLIGHT_ID,
    highlightCategory: "viewpoint",
    evidenceCoordinate: { latitude: 47.2692, longitude: 11.4041 }
  };
}

function validRow(overrides = {}) {
  return {
    highlight_entity_id: HIGHLIGHT_ID,
    highlight_category: "viewpoint",
    evidence_latitude: 47.2692,
    evidence_longitude: 11.4041,
    trail_entity_id: TRAIL_ID,
    routing_latitude: 47.26925,
    routing_longitude: 11.4041,
    poi_to_access_distance_meters: 5.56,
    highway_class: "path",
    trail_category_evidence_claim_ids: [CLAIM_ID],
    trail_osm_type: "way",
    trail_osm_id: "123456",
    display_name: "Mapped Viewpoint",
    operational_region_id: "innsbruck-alps-v1",
    projection_run_id: RUN_ID,
    import_id: IMPORT_ID,
    source_id: SOURCE_ID,
    source_policy_id: POLICY_ID,
    source_policy_version: "osm-foundational-v1",
    adapter_schema_version: "osm-evidence-graph-v1",
    source_data_at: "2026-08-03T20:21:36Z",
    retrieved_at: "2026-08-04T00:00:00Z",
    ...overrides
  };
}

function reverseKeys(value) {
  if (Array.isArray(value)) return value.map(reverseKeys);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value).reverse().map((key) => [key, reverseKeys(value[key])])
  );
}
