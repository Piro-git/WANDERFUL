import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_DIRECTORY = join(
  dirname(dirname(dirname(fileURLToPath(import.meta.url)))),
  "config",
  "outdoor-regions"
);
const REGION_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const FEATURE_CLASSES = new Set([
  "viewpoint", "peak", "lake", "waterfall", "alpineHut", "wildernessHut",
  "trailSegment", "hikingRouteRelation"
]);

export function loadOutdoorRegionDefinitions(options = {}) {
  const directory = options.directory ?? DEFAULT_DIRECTORY;
  const names = readdirSync(directory)
    .filter((name) => name.endsWith(".json") && !name.endsWith(".geojson"))
    .sort();
  const definitions = names.map((name) => {
    const metadata = JSON.parse(readFileSync(join(directory, name), "utf8"));
    const boundaryFeature = JSON.parse(
      readFileSync(join(directory, metadata.boundaryFile), "utf8")
    );
    return validateOutdoorRegionDefinition({ ...metadata, boundaryFeature });
  });
  const ids = new Set();
  for (const definition of definitions) {
    if (ids.has(definition.regionId)) throw new Error("Duplicate outdoor region ID.");
    ids.add(definition.regionId);
  }
  return definitions;
}

export function outdoorRegionDefinition(regionId, options = {}) {
  return loadOutdoorRegionDefinitions(options).find((region) => region.regionId === regionId);
}

export function validateOutdoorRegionDefinition(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) invalid();
  if (input.schemaVersion !== 1) invalid();
  if (typeof input.regionId !== "string" || !REGION_ID_PATTERN.test(input.regionId)) invalid();
  if (typeof input.name !== "string" || input.name.length < 1 || input.name.length > 160) invalid();
  if (input.boundaryKind !== "trailmind-operational-polygon") invalid();
  if (input.coordinateReferenceSystem !== "EPSG:4326") invalid();
  if (!Number.isInteger(input.metricSRID) || input.metricSRID < 1) invalid();
  if (!Number.isInteger(input.freshnessThresholdDays) || input.freshnessThresholdDays < 1) invalid();
  if (
    !Number.isInteger(input.pathMatchToleranceMeters) ||
    input.pathMatchToleranceMeters < 1 || input.pathMatchToleranceMeters > 100
  ) invalid();
  if (
    !Array.isArray(input.supportedFeatureClasses) || input.supportedFeatureClasses.length === 0 ||
    new Set(input.supportedFeatureClasses).size !== input.supportedFeatureClasses.length ||
    input.supportedFeatureClasses.some((value) => !FEATURE_CLASSES.has(value))
  ) invalid();
  validateSourceMetadataContract(input.sourceMetadataContract);
  validateBoundary(input.boundaryFeature, input.regionId);
  validateAnchors(input.requiredAnchors, input.boundaryFeature.geometry.coordinates);
  return Object.freeze({
    schemaVersion: input.schemaVersion,
    regionId: input.regionId,
    name: input.name,
    boundaryFile: input.boundaryFile,
    boundaryKind: input.boundaryKind,
    coordinateReferenceSystem: input.coordinateReferenceSystem,
    metricSRID: input.metricSRID,
    freshnessThresholdDays: input.freshnessThresholdDays,
    pathMatchToleranceMeters: input.pathMatchToleranceMeters,
    supportedFeatureClasses: Object.freeze([...input.supportedFeatureClasses]),
    requiredAnchors: Object.freeze(input.requiredAnchors.map((anchor) => Object.freeze({ ...anchor }))),
    sourceMetadataContract: Object.freeze({
      required: Object.freeze([...input.sourceMetadataContract.required]),
      optional: Object.freeze([...input.sourceMetadataContract.optional])
    }),
    boundaryFeature: Object.freeze(input.boundaryFeature)
  });
}

function validateBoundary(feature, regionId) {
  if (feature?.type !== "Feature" || feature.geometry?.type !== "Polygon") invalid();
  if (feature.properties?.regionId !== regionId) invalid();
  const rings = feature.geometry.coordinates;
  if (!Array.isArray(rings) || rings.length !== 1 || rings[0].length < 4) invalid();
  const ring = rings[0];
  for (const coordinate of ring) {
    if (
      !Array.isArray(coordinate) || coordinate.length !== 2 ||
      !Number.isFinite(coordinate[0]) || !Number.isFinite(coordinate[1]) ||
      coordinate[0] < -180 || coordinate[0] > 180 ||
      coordinate[1] < -90 || coordinate[1] > 90
    ) invalid();
  }
  if (ring[0][0] !== ring.at(-1)[0] || ring[0][1] !== ring.at(-1)[1]) invalid();
}

function validateAnchors(anchors, rings) {
  if (!Array.isArray(anchors) || anchors.length < 1) invalid();
  for (const anchor of anchors) {
    if (
      typeof anchor?.name !== "string" || !Number.isFinite(anchor.latitude) ||
      !Number.isFinite(anchor.longitude) ||
      !pointInPolygon([anchor.longitude, anchor.latitude], rings[0])
    ) invalid();
  }
}

function validateSourceMetadataContract(contract) {
  const required = [
    "datasetName", "sourceIdentifier", "sourceDataTimestamp", "retrievedAt",
    "toolVersion", "importSchemaVersion", "acquisitionChannel", "inputFileSha256"
  ];
  if (!contract || !Array.isArray(contract.required) || !Array.isArray(contract.optional)) invalid();
  if (required.some((field) => !contract.required.includes(field))) invalid();
}

function pointInPolygon([x, y], ring) {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const [xi, yi] = ring[index];
    const [xj, yj] = ring[previous];
    const intersects = ((yi > y) !== (yj > y)) &&
      (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi);
    if (intersects) inside = !inside;
  }
  return inside;
}

function invalid() {
  throw new Error("Invalid outdoor region definition.");
}
