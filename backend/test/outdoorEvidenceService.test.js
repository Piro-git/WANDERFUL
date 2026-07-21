import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createOutdoorEvidenceService,
  normalizeCorridorRow
} from "../src/outdoorEvidence/outdoorEvidenceService.js";
import { validateOutdoorEvidenceRequest } from "../src/outdoorEvidence/outdoorEvidenceValidation.js";
import {
  innsbruckOutdoorEvidenceRegionRow,
  outdoorEvidenceDatabaseRow,
  outdoorEvidenceRegionRow,
  outdoorEvidenceRequest
} from "./outdoorEvidenceTestSupport.js";

const request = validateOutdoorEvidenceRequest(outdoorEvidenceRequest());
const now = new Date("2026-07-20T00:00:00Z");

describe("outdoor evidence service", () => {
  it("returns a route fully inside Harz with length-weighted provenance", () => {
    const response = normalizeCorridorRow(request, outdoorEvidenceDatabaseRow(), { now, maximumPois: 40 });
    assert.equal(response.schemaVersion, 2);
    assert.equal(response.evidenceStatus, "known");
    assert.equal(response.regions.length, 1);
    assert.equal(response.regions[0].id, "harz-v1");
    assert.equal(response.regions[0].routeCoverageRatio, 1);
    assert.equal(response.overallRegionalCoverageRatio, 1);
    assert.equal(response.attributeCoverage.surface, 0.6);
    assert.equal(response.mappedHikingRouteCoverageRatio, 0.5);
    assert.equal(response.maximumKnownSacScale, "mountain_hiking");
    assert.equal(response.mappedPoiCounts.viewpoint, 1);
    assert.equal(response.mappedPoiCounts.waterfall, 0);
    assert.equal(response.mappedPois[0].provenance.importId, response.regions[0].dataset.importId);
    assert.equal(response.osmAttribution.notice, "© OpenStreetMap contributors");
  });

  it("returns a route fully inside the Innsbruck Alpine pilot with bounded Alpine evidence", () => {
    const region = innsbruckOutdoorEvidenceRegionRow();
    const categories = ["alpineHut", "wildernessHut", "peak", "viewpoint", "lake", "waterfall"];
    const row = outdoorEvidenceDatabaseRow({
      regions: [region],
      mapped_poi_counts: Object.fromEntries(categories.map((category) => [category, 1])),
      mapped_pois: categories.map((category, index) => ({
        osmType: "node", osmId: String(100 + index), category,
        name: `Mapped Alpine fixture ${index}`,
        latitude: 47.27 + index * 0.001, longitude: 11.40 + index * 0.001,
        distanceFromRouteMeters: 10 + index,
        regionId: region.id, importId: region.importId, sourceDataset: region.sourceDataset,
        sourceVersion: 1, sourceTimestamp: "2026-07-18T00:00:00Z"
      })),
      highway_breakdown: [
        { value: "path", lengthMeters: 500 },
        { value: "steps", lengthMeters: 150 },
        { value: "track", lengthMeters: 150 }
      ],
      surface_breakdown: [
        { value: "rock", lengthMeters: 300 },
        { value: "ground", lengthMeters: 300 }
      ],
      trail_visibility_breakdown: [
        { value: "bad", lengthMeters: 200 },
        { value: "intermediate", lengthMeters: 200 }
      ],
      sac_scale_breakdown: [
        { value: "mountain_hiking", lengthMeters: 150 },
        { value: "demanding_mountain_hiking", lengthMeters: 150 }
      ],
      maximum_sac_scale_rank: 4
    });
    const response = normalizeCorridorRow(request, row, { now, maximumPois: 40 });

    assert.equal(response.regions[0].id, "innsbruck-alps-v1");
    assert.equal(response.overallRegionalCoverageRatio, 1);
    assert.deepEqual(Object.values(response.mappedPoiCounts), [1, 1, 1, 1, 1, 1]);
    assert.equal(response.maximumKnownSacScale, "demanding_mountain_hiking");
    assert.equal(response.mappedHikingRouteCoverageRatio, 0.5);
    assert.equal(response.explicitAccessRestrictions.length, 1);
    assert.equal("availability" in response.mappedPois[0], false);
    assert.equal("safe" in response, false);
    assert.equal("publicAccess" in response, false);
    assert(response.warnings.includes("osmMappedEvidenceOnly"));
    assert(response.warnings.includes("missingTagsRemainUnknown"));
  });

  it("keeps a route partially covered by one region explicit", () => {
    const response = normalizeCorridorRow(request, outdoorEvidenceDatabaseRow({
      regions: [outdoorEvidenceRegionRow({ coveredLengthMeters: 1_000 })],
      route_length_meters: 2_000,
      covered_length_meters: 1_000
    }), { now });
    assert.equal(response.regions[0].coverageStatus, "partial");
    assert.equal(response.regions[0].routeCoverageRatio, 0.5);
    assert.equal(response.overallRegionalCoverageRatio, 0.5);
    assert.equal(response.attributeCoverage.highway, 0.4);
    assert(response.warnings.includes("partialRegionalCoverage"));
  });

  it("returns unsupported outside all configured regions and unavailable without a repository", async () => {
    const outside = normalizeCorridorRow(request, {
      route_length_meters: 1_000,
      covered_length_meters: 0,
      regions: []
    });
    assert.equal(outside.evidenceStatus, "unsupported");
    assert.equal(outside.overallRegionalCoverageRatio, 0);
    assert.deepEqual(outside.regions, []);
    assert.equal(outside.mappedPoiCounts, null);

    const service = createOutdoorEvidenceService({});
    const unavailable = await service.corridor(request);
    assert.equal(unavailable.evidenceStatus, "unavailable");
    assert.equal(unavailable.overallRegionalCoverageRatio, null);
  });

  it("orders crossing/overlapping regions deterministically and never double-counts", () => {
    const duplicateImportCandidate = outdoorEvidenceDatabaseRow().mapped_pois[0];
    const response = normalizeCorridorRow(request, outdoorEvidenceDatabaseRow({
      regions: [
        innsbruckOutdoorEvidenceRegionRow({ coveredLengthMeters: 600 }),
        outdoorEvidenceRegionRow({ coveredLengthMeters: 600 })
      ],
      covered_length_meters: 1_000,
      highway_coverage_meters: 1_000,
      highway_breakdown: [{ value: "path", lengthMeters: 1_000 }],
      mapped_hiking_relation_meters: 1_000,
      mapped_poi_counts: { viewpoint: 1 },
      mapped_pois: [duplicateImportCandidate]
    }), { now });

    assert.deepEqual(response.regions.map((region) => region.id), ["harz-v1", "innsbruck-alps-v1"]);
    assert.equal(response.overallRegionalCoverageRatio, 1);
    assert.equal(response.attributeCoverage.highway, 1);
    assert.equal(response.mappedHikingRouteCoverageRatio, 1);
    assert.equal(response.mappedPoiCounts.viewpoint, 1);
    assert.equal(response.mappedPois.length, 1);
    assert(response.warnings.includes("overlappingRegionalCoverage"));
    for (const value of Object.values(response.attributeCoverage)) {
      assert(value === null || (value >= 0 && value <= 1));
    }
  });

  it("tracks independently current, stale, missing-timestamp, and missing imports", () => {
    const mixed = normalizeCorridorRow(request, outdoorEvidenceDatabaseRow({
      regions: [
        outdoorEvidenceRegionRow({ coveredLengthMeters: 600 }),
        innsbruckOutdoorEvidenceRegionRow({
          coveredLengthMeters: 400,
          sourceDataTimestamp: new Date("2026-05-01T00:00:00Z")
        })
      ]
    }), { now });
    assert.equal(mixed.evidenceStatus, "stale");
    assert.deepEqual(mixed.regions.map((region) => region.evidenceStatus), ["known", "stale"]);
    assert(mixed.warnings.includes("datasetStale"));

    const missingTimestamp = normalizeCorridorRow(request, outdoorEvidenceDatabaseRow({
      regions: [outdoorEvidenceRegionRow({ sourceDataTimestamp: null })]
    }), { now });
    assert.equal(missingTimestamp.evidenceStatus, "unavailable");
    assert.equal(missingTimestamp.regions[0].dataset.freshnessStatus, "sourceTimestampUnavailable");
    assert.equal(missingTimestamp.mappedPoiCounts, null);

    const noImport = normalizeCorridorRow(request, outdoorEvidenceDatabaseRow({
      regions: [outdoorEvidenceRegionRow({ importId: null, importStatus: null })]
    }), { now });
    assert.equal(noImport.evidenceStatus, "unavailable");
    assert.equal(noImport.regions[0].dataset, null);
    assert(noImport.warnings.includes("datasetUnavailable"));
  });

  it("leaves missing access and SAC tags unknown rather than permitted or easy", () => {
    const response = normalizeCorridorRow(request, outdoorEvidenceDatabaseRow({
      sac_scale_coverage_meters: 0,
      sac_scale_breakdown: [],
      maximum_sac_scale_rank: null,
      access_coverage_meters: 0,
      explicit_access_restrictions: []
    }), { now });
    assert.equal(response.attributeCoverage.sacScale, 0);
    assert.equal(response.attributeCoverage.explicitAccess, 0);
    assert.equal(response.maximumKnownSacScale, null);
    assert.deepEqual(response.explicitAccessRestrictions, []);
    assert(response.warnings.includes("missingTagsRemainUnknown"));
  });

  it("rejects over-counted ratios, duplicate POIs, and non-restrictive access claims", () => {
    assert.throws(() => normalizeCorridorRow(request, outdoorEvidenceDatabaseRow({
      mapped_hiking_relation_meters: 1_100
    }), { now }));
    const duplicate = outdoorEvidenceDatabaseRow().mapped_pois[0];
    assert.throws(() => normalizeCorridorRow(request, outdoorEvidenceDatabaseRow({
      mapped_pois: [duplicate, { ...duplicate }]
    }), { now, maximumPois: 40 }));
    assert.throws(() => normalizeCorridorRow(request, outdoorEvidenceDatabaseRow({
      explicit_access_restrictions: [{
        osmType: "way", osmId: "42", access: "yes", foot: null,
        conditional: false, seasonal: false, permitRequired: false
      }]
    }), { now }));
  });

  it("enforces the serialized response ceiling", async () => {
    const service = createOutdoorEvidenceService({
      maximumResponseBytes: 8_192,
      repository: { async queryCorridor() {
        return outdoorEvidenceDatabaseRow({
          mapped_poi_counts: { viewpoint: 40, peak: 1 },
          mapped_pois: Array.from({ length: 40 }, (_, index) => ({
            ...outdoorEvidenceDatabaseRow().mapped_pois[0],
            osmId: String(index + 1),
            name: "x".repeat(160)
          }))
        });
      } }
    });
    await assert.rejects(() => service.corridor(request), (error) => error.code === "response_too_large");
  });
});
