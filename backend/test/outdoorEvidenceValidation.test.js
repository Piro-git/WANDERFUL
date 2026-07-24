import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  loadOutdoorRegionDefinitions,
  outdoorRegionDefinition
} from "../src/outdoorEvidence/regions.js";
import { validateOutdoorEvidenceRequest } from "../src/outdoorEvidence/outdoorEvidenceValidation.js";
import { outdoorEvidenceRequest } from "./outdoorEvidenceTestSupport.js";

describe("outdoor evidence request validation", () => {
  it("encodes PostGIS GeoJSON in longitude-latitude order", () => {
    const result = validateOutdoorEvidenceRequest(outdoorEvidenceRequest());
    assert.deepEqual(result.routeGeoJSON.coordinates[0], [10.61, 51.8]);
    assert.deepEqual(result.geometry[0], { latitude: 51.8, longitude: 10.61 });
  });

  it("rejects non-finite and out-of-range coordinates", () => {
    for (const point of [
      { latitude: Number.NaN, longitude: 10 },
      { latitude: Number.POSITIVE_INFINITY, longitude: 10 },
      { latitude: 91, longitude: 10 },
      { latitude: 51, longitude: -181 }
    ]) {
      assert.throws(
        () => validateOutdoorEvidenceRequest(outdoorEvidenceRequest({ geometry: [point, { latitude: 51.1, longitude: 10.1 }] })),
        (error) => error.code === "invalid_coordinates"
      );
    }
  });

  it("enforces schema, fingerprint, geometry, distance and corridor allowlists", () => {
    assert.throws(() => validateOutdoorEvidenceRequest(outdoorEvidenceRequest({ schemaVersion: 2 })));
    assert.throws(() => validateOutdoorEvidenceRequest(outdoorEvidenceRequest({ routeFingerprint: "secret value" })));
    assert.throws(() => validateOutdoorEvidenceRequest(outdoorEvidenceRequest({ geometry: [{ latitude: 51, longitude: 10 }] })));
    assert.throws(() => validateOutdoorEvidenceRequest(outdoorEvidenceRequest({ corridorWidthMeters: 101 })));
    assert.throws(() => validateOutdoorEvidenceRequest(outdoorEvidenceRequest({
      geometry: [{ latitude: 51, longitude: 10 }, { latitude: 54, longitude: 10 }]
    })));
    assert.throws(() => validateOutdoorEvidenceRequest(outdoorEvidenceRequest({ unknown: true })));
  });

  it("loads a versioned Harz definition that contains every required anchor", () => {
    const region = outdoorRegionDefinition("harz-v1");
    assert.equal(region.schemaVersion, 1);
    assert.equal(region.metricSRID, 25832);
    assert.equal(region.boundaryKind, "trailmind-operational-polygon");
    assert.deepEqual(
      region.requiredAnchors.map((anchor) => anchor.name),
      ["Ilsenburg", "Schierke", "Brocken", "Wernigerode", "Bad Harzburg"]
    );
    for (const field of [
      "datasetName", "sourceIdentifier", "sourceDataTimestamp", "retrievedAt",
      "acquisitionChannel", "inputFileSha256"
    ]) {
      assert(region.sourceMetadataContract.required.includes(field));
    }
  });

  it("loads both regions deterministically and bounds the Innsbruck Alpine pilot", () => {
    const regions = loadOutdoorRegionDefinitions();
    assert.deepEqual(regions.map((region) => region.regionId), ["harz-v1", "innsbruck-alps-v1"]);

    const alpine = outdoorRegionDefinition("innsbruck-alps-v1");
    assert.equal(alpine.schemaVersion, 1);
    assert.equal(alpine.metricSRID, 25832);
    assert.equal(alpine.coordinateReferenceSystem, "EPSG:4326");
    assert.deepEqual(
      alpine.requiredAnchors.map((anchor) => anchor.name),
      ["Innsbruck", "Nordkette", "Seefeld in Tirol", "Fulpmes", "Neustift im Stubaital"]
    );
    assert.match(alpine.boundaryFeature.properties.boundaryNotice, /not a complete or official Alps boundary/);
    assert.equal(outdoorRegionDefinition("the-alps"), undefined);
  });
});
