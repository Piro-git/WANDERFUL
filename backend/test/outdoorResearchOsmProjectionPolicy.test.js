import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  boundedMappedText,
  canonicalCategoryForOutdoorEvidence,
  deterministicOsmEntityId,
  deterministicUuidV3,
  exactRelationshipScopeSetMatches,
  exactScopeSetMatches,
  isRecognizedSacScale,
  isRecognizedTrailVisibility,
  mappedAccessRestriction,
  OSM_ACQUISITION_CHANNELS,
  OSM_ALLOWED_ASSERTION_PREDICATES,
  OSM_ASSERTION_POLICY_SCOPES,
  OSM_FORBIDDEN_HIGH_STAKES_PREDICATES,
  OSM_PROJECTION_ADAPTER_VERSION,
  OSM_PROJECTION_POLICY_REACTIVATION_VERSION,
  OSM_PROJECTION_POLICY_VERSION,
  OSM_PROJECTION_REGION_IDS,
  OSM_RELATIONSHIP_POLICY_SCOPES,
  OSM_RESEARCH_SOURCE_KEY,
  OSM_SOURCE_CONTRACT,
  OsmProjectionError,
  projectionKey,
  recognizedOsmProjectionPolicy,
  strictUtcPolicyTimestamp,
  validatedOsmProjectionAcquisition,
  stableOsmIdentity
} from "../src/outdoorResearch/osmProjectionPolicy.js";

describe("OSM outdoor research projection policy", () => {
  it("maps only the reviewed outdoor evidence categories", () => {
    assert.deepEqual({
      viewpoint: canonicalCategoryForOutdoorEvidence("viewpoint"),
      waterfall: canonicalCategoryForOutdoorEvidence("waterfall"),
      peak: canonicalCategoryForOutdoorEvidence("peak"),
      lake: canonicalCategoryForOutdoorEvidence("lake"),
      alpineHut: canonicalCategoryForOutdoorEvidence("alpineHut"),
      wildernessHut: canonicalCategoryForOutdoorEvidence("wildernessHut")
    }, {
      viewpoint: "viewpoint",
      waterfall: "waterfall",
      peak: "peak",
      lake: "lake",
      alpineHut: "alpine_hut",
      wildernessHut: "wilderness_hut"
    });
    assert.equal(canonicalCategoryForOutdoorEvidence("campsite"), undefined);
    assert.equal(canonicalCategoryForOutdoorEvidence("beautiful_place"), undefined);
  });

  it("accepts only bounded, non-control mapped text", () => {
    assert.equal(boundedMappedText("  Brockenblick  ", 160), "Brockenblick");
    assert.equal(boundedMappedText("", 160), undefined);
    assert.equal(boundedMappedText("x".repeat(161), 160), undefined);
    assert.equal(boundedMappedText("unsafe\u0000text", 160), undefined);
    assert.equal(boundedMappedText(123, 160), undefined);
  });

  it("recognizes the bounded OSM SAC and visibility vocabularies", () => {
    for (const value of [
      "strolling", "hiking", "mountain_hiking", "demanding_mountain_hiking",
      "alpine_hiking", "demanding_alpine_hiking", "difficult_alpine_hiking"
    ]) {
      assert.equal(isRecognizedSacScale(value), true);
    }
    for (const value of [
      "excellent", "good", "intermediate", "bad", "horrible", "no"
    ]) {
      assert.equal(isRecognizedTrailVisibility(value), true);
    }
    assert.equal(isRecognizedSacScale("technical_climbing"), false);
    assert.equal(isRecognizedTrailVisibility("perfect"), false);
  });

  it("emits cautious negative or conditional access semantics and omits positive access", () => {
    assert.equal(mappedAccessRestriction({ footTag: "no" }), "prohibited");
    assert.equal(mappedAccessRestriction({ accessTag: "private" }), "restricted");
    assert.equal(mappedAccessRestriction({ accessTag: "permit" }), "permit_required");
    assert.equal(mappedAccessRestriction({ permitTag: "required" }), "permit_required");
    assert.equal(mappedAccessRestriction({
      footTag: "yes",
      footConditional: "no @ (Nov-Mar)"
    }), "conditional");
    assert.equal(mappedAccessRestriction({ seasonalTag: "yes" }), "conditional");
    assert.equal(mappedAccessRestriction({ footTag: "yes" }), undefined);
    assert.equal(mappedAccessRestriction({ accessTag: "permissive" }), undefined);
    assert.equal(mappedAccessRestriction({}), undefined);
    assert.equal(mappedAccessRestriction({ accessTag: "unknown" }), undefined);
  });

  it("keeps OpenStreetMap as the sole evidence authority", () => {
    assert.equal(OSM_RESEARCH_SOURCE_KEY, "osm_foundational_data");
    assert.equal(OSM_SOURCE_CONTRACT.sourceCategory, "openstreetmap_open_mapping");
    assert.equal(OSM_SOURCE_CONTRACT.authorityClass, "open_community");
    assert.equal(OSM_SOURCE_CONTRACT.licenseIdentifier, "ODbL-1.0");
    assert.equal(OSM_SOURCE_CONTRACT.normalizedFactsAllowed, true);
    assert.equal(OSM_SOURCE_CONTRACT.derivedFeaturesAllowed, false);
    assert.equal(OSM_SOURCE_CONTRACT.canonicalOrigin, "https://www.openstreetmap.org");
    assert.doesNotMatch(JSON.stringify(OSM_SOURCE_CONTRACT), /geofabrik/i);
    assert.deepEqual(OSM_PROJECTION_REGION_IDS, [
      "harz-v1", "innsbruck-alps-v1"
    ]);
  });

  it("uses an exact reviewed claim and relationship scope", () => {
    const policy = recognizedOsmProjectionPolicy(OSM_PROJECTION_POLICY_VERSION);
    assert(policy);
    assert.equal(policy.adapterSchemaVersion, OSM_PROJECTION_ADAPTER_VERSION);
    assert.equal(policy.maximumInputAgeDays, 14);
    assert.equal(policy.derivedFeaturesAllowed, false);
    assert.equal(exactScopeSetMatches(OSM_ASSERTION_POLICY_SCOPES), true);
    assert.equal(exactRelationshipScopeSetMatches(OSM_RELATIONSHIP_POLICY_SCOPES), true);
    assert.equal(exactScopeSetMatches([
      ...OSM_ASSERTION_POLICY_SCOPES,
      { predicate: "public_access", entityCategory: "trail_segment" }
    ]), false);
    assert.equal(exactScopeSetMatches(OSM_ASSERTION_POLICY_SCOPES.slice(1)), false);
    assert.equal(exactRelationshipScopeSetMatches([]), false);
    assert.deepEqual(OSM_RELATIONSHIP_POLICY_SCOPES, [{
      relationshipType: "trail_segment_member_of_route",
      subjectEntityCategory: "trail_segment",
      objectEntityCategory: "hiking_route"
    }]);
    for (const predicate of OSM_FORBIDDEN_HIGH_STAKES_PREDICATES) {
      assert.equal(OSM_ALLOWED_ASSERTION_PREDICATES.includes(predicate), false);
    }
  });

  it("accepts only calendar-valid, non-future UTC policy timestamps", () => {
    const clock = () => new Date("2026-07-24T12:00:00.000Z");
    assert.equal(
      strictUtcPolicyTimestamp("2026-07-24T11:59:59Z", clock),
      "2026-07-24T11:59:59.000Z"
    );
    assert.equal(
      strictUtcPolicyTimestamp("2024-02-29T09:00:00.123Z", clock),
      "2024-02-29T09:00:00.123Z"
    );
    for (const value of [
      "2026-02-30T09:00:00Z",
      "2025-02-29T09:00:00Z",
      "2026",
      "2026-07-24",
      "2026-07-24T09:00:00+00:00",
      "2026-07-24T11:00:00.12Z",
      "2026-07-24 11:00:00Z"
    ]) {
      assert.throws(
        () => strictUtcPolicyTimestamp(value, clock),
        (error) => error instanceof OsmProjectionError &&
          error.code === "invalid_review_timestamp"
      );
    }
    assert.throws(
      () => strictUtcPolicyTimestamp("2026-07-24T12:00:00.001Z", clock),
      (error) => error instanceof OsmProjectionError &&
        error.code === "future_review_timestamp"
    );
  });

  it("requires complete acquisition provenance before graph projection", () => {
    const completeGeofabrik = {
      sourceDatasetName: "Geofabrik Germany regional extract",
      sourceIdentifier: "https://download.geofabrik.de/europe/germany-latest.osm.pbf",
      sourceDataAt: "2026-07-20T06:00:00Z",
      retrievedAt: "2026-07-20T08:00:00Z",
      importedAt: "2026-07-20T08:30:00Z",
      acquisitionChannel: "geofabrik_regional_extract",
      sourceChecksumAlgorithm: "md5",
      sourceChecksum: "a".repeat(32),
      sourceChecksumVerifiedAt: "2026-07-20T08:10:00Z",
      inputFileSha256: "b".repeat(64)
    };
    assert.deepEqual(OSM_ACQUISITION_CHANNELS, [
      "geofabrik_regional_extract",
      "operator_supplied_local",
      "other_reviewed_bulk"
    ]);
    assert.equal(
      validatedOsmProjectionAcquisition(completeGeofabrik).acquisitionChannel,
      "geofabrik_regional_extract"
    );
    assert.equal(
      validatedOsmProjectionAcquisition({
        ...completeGeofabrik,
        acquisitionChannel: "operator_supplied_local",
        sourceChecksumAlgorithm: null,
        sourceChecksum: null,
        sourceChecksumVerifiedAt: null
      }).inputFileSha256,
      "b".repeat(64)
    );
    for (const [change, code] of [
      [{ acquisitionChannel: null }, "acquisition_channel_missing"],
      [{ inputFileSha256: null }, "input_file_sha256_missing"],
      [{ inputFileSha256: "not-a-sha256" }, "input_file_sha256_invalid"],
      [{
        sourceChecksumAlgorithm: null,
        sourceChecksum: null,
        sourceChecksumVerifiedAt: null
      }, "geofabrik_checksum_missing"],
      [{ sourceChecksumVerifiedAt: null }, "checksum_verification_missing"]
    ]) {
      assert.throws(
        () => validatedOsmProjectionAcquisition({
          ...completeGeofabrik,
          ...change
        }),
        (error) => error instanceof OsmProjectionError && error.code === code
      );
    }
  });

  it("allows only explicit reviewed lifecycle policy versions", () => {
    assert(recognizedOsmProjectionPolicy(OSM_PROJECTION_POLICY_VERSION));
    assert(recognizedOsmProjectionPolicy(
      OSM_PROJECTION_POLICY_REACTIVATION_VERSION
    ));
    assert.equal(
      recognizedOsmProjectionPolicy("osm-foundational-mapped-v3"),
      undefined
    );
  });

  it("derives stable source/type/id identities and deterministic IDs", () => {
    assert.equal(stableOsmIdentity("way", 42n), "osm_foundational_data:way:42");
    const entityId = deterministicOsmEntityId("way", 42);
    assert.equal(entityId, deterministicOsmEntityId("way", 42n));
    assert.notEqual(entityId, deterministicOsmEntityId("relation", 42));
    assert.equal(entityId, "7122c14f-3fcf-3b67-a28c-efb612b80e8e");
    assert.equal(
      deterministicUuidV3("namespace", "identity"),
      deterministicUuidV3("namespace", "identity")
    );
    assert.throws(
      () => stableOsmIdentity("changeset", 42),
      (error) => error instanceof OsmProjectionError &&
        error.code === "invalid_osm_identity"
    );
    assert.throws(() => stableOsmIdentity("node", 0), OsmProjectionError);
  });

  it("keys a projection by region, import, reviewed policy and adapter", () => {
    const input = {
      regionId: "harz-v1",
      importId: "11111111-1111-4111-8111-111111111111",
      policyVersion: OSM_PROJECTION_POLICY_VERSION
    };
    const key = projectionKey(input);
    assert.match(key, /^[a-f0-9]{64}$/);
    assert.equal(key, projectionKey(input));
    assert.notEqual(key, projectionKey({ ...input, regionId: "innsbruck-alps-v1" }));
    assert.throws(() => projectionKey({ ...input, importId: "" }), OsmProjectionError);
  });
});
