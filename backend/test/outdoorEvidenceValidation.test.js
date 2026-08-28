import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  loadOutdoorRegionDefinitions,
  outdoorRegionDefinition
} from "../src/outdoorEvidence/regions.js";
import { validateOutdoorEvidenceRequest } from "../src/outdoorEvidence/outdoorEvidenceValidation.js";
import { outdoorEvidenceRequest } from "./outdoorEvidenceTestSupport.js";

const backendRoot = dirname(dirname(fileURLToPath(import.meta.url)));

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

  it("loads named Free staging cores only through an explicit profile directory", () => {
    const directory = join(
      backendRoot,
      "config",
      "outdoor-capacity-profiles",
      "supabase-free-bounded-two-core-v1",
      "regions"
    );
    const regions = loadOutdoorRegionDefinitions({ directory });

    assert.deepEqual(regions.map((region) => region.regionId), [
      "harz-v1", "innsbruck-alps-v1"
    ]);
    assert.match(regions[0].name, /staging only; partial Harz coverage/);
    assert.match(regions[1].name, /staging only; partial pilot coverage/);
    assert.deepEqual(regions[0].boundaryFeature.geometry.coordinates[0][0], [10.583, 51.74]);
    assert.deepEqual(regions[1].boundaryFeature.geometry.coordinates[0][0], [11.37, 47.335]);
    assert(regions[0].boundaryFeature.geometry.coordinates[0].some(
      (coordinate) => coordinate[0] === 10.31 && coordinate[1] === 51.528
    ));
    assert(regions[1].boundaryFeature.geometry.coordinates[0].some(
      (coordinate) => coordinate[0] === 11.338 && coordinate[1] === 47.2355
    ));
    assert.equal(outdoorRegionDefinition("harz-v1").name, "Harz v1");
  });
});
