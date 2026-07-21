import { outdoorEvidenceError } from "./outdoorEvidenceErrors.js";

export const OUTDOOR_EVIDENCE_SCHEMA_VERSION = 1;
export const DEFAULT_CORRIDOR_WIDTH_METERS = 100;
export const ALLOWED_CORRIDOR_WIDTHS_METERS = Object.freeze([25, 50, 100, 250, 500]);
const TOP_LEVEL_FIELDS = new Set([
  "schemaVersion", "routeFingerprint", "geometry", "corridorWidthMeters"
]);
const POINT_FIELDS = new Set(["latitude", "longitude"]);
const FINGERPRINT_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

export function validateOutdoorEvidenceRequest(input, limits = {}) {
  assertObject(input);
  assertKnownFields(input, TOP_LEVEL_FIELDS);
  if (input.schemaVersion !== OUTDOOR_EVIDENCE_SCHEMA_VERSION) {
    throw outdoorEvidenceError("invalid_request", { message: "schemaVersion must be 1." });
  }
  if (typeof input.routeFingerprint !== "string" || !FINGERPRINT_PATTERN.test(input.routeFingerprint)) {
    throw outdoorEvidenceError("invalid_request", { message: "routeFingerprint is invalid." });
  }
  const maximumCoordinates = limits.maximumCoordinates ?? 2_000;
  if (
    !Array.isArray(input.geometry) || input.geometry.length < 2 ||
    input.geometry.length > maximumCoordinates
  ) throw outdoorEvidenceError("invalid_coordinates");

  const geometry = input.geometry.map((point) => {
    assertObject(point, "invalid_coordinates");
    assertKnownFields(point, POINT_FIELDS, "invalid_coordinates");
    if (
      !Number.isFinite(point.latitude) || point.latitude < -90 || point.latitude > 90 ||
      !Number.isFinite(point.longitude) || point.longitude < -180 || point.longitude > 180
    ) throw outdoorEvidenceError("invalid_coordinates");
    return { latitude: point.latitude, longitude: point.longitude };
  });

  const distanceMeters = cumulativeDistance(geometry);
  const minimumDistanceMeters = limits.minimumDistanceMeters ?? 1;
  const maximumDistanceMeters = limits.maximumDistanceMeters ?? 200_000;
  if (distanceMeters < minimumDistanceMeters || distanceMeters > maximumDistanceMeters) {
    throw outdoorEvidenceError("invalid_coordinates", {
      message: `Route geometry must measure between ${minimumDistanceMeters} and ${maximumDistanceMeters} metres.`
    });
  }
  const corridorWidthMeters = input.corridorWidthMeters ?? DEFAULT_CORRIDOR_WIDTH_METERS;
  const allowedWidths = limits.allowedCorridorWidthsMeters ?? ALLOWED_CORRIDOR_WIDTHS_METERS;
  if (!allowedWidths.includes(corridorWidthMeters)) {
    throw outdoorEvidenceError("invalid_request", {
      message: "corridorWidthMeters is not an allowlisted value."
    });
  }
  return {
    schemaVersion: OUTDOOR_EVIDENCE_SCHEMA_VERSION,
    routeFingerprint: input.routeFingerprint,
    geometry,
    routeGeoJSON: {
      type: "LineString",
      coordinates: geometry.map((point) => [point.longitude, point.latitude])
    },
    corridorWidthMeters,
    distanceMeters
  };
}

export function cumulativeDistance(points) {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    total += haversineDistance(points[index - 1], points[index]);
  }
  return total;
}

export function pointCountBucket(count) {
  if (count <= 25) return "2_to_25";
  if (count <= 100) return "26_to_100";
  if (count <= 500) return "101_to_500";
  return "501_or_more";
}

export function distanceBucket(distanceMeters) {
  if (distanceMeters < 10_000) return "under_10km";
  if (distanceMeters < 50_000) return "10_to_50km";
  if (distanceMeters < 100_000) return "50_to_100km";
  return "100km_or_more";
}

function haversineDistance(start, finish) {
  const radius = 6_371_000;
  const radians = Math.PI / 180;
  const latitudeDelta = (finish.latitude - start.latitude) * radians;
  const longitudeDelta = (finish.longitude - start.longitude) * radians;
  const startLatitude = start.latitude * radians;
  const finishLatitude = finish.latitude * radians;
  const value = Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(startLatitude) * Math.cos(finishLatitude) * Math.sin(longitudeDelta / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(Math.max(0, 1 - value)));
}

function assertObject(value, code = "invalid_request") {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw outdoorEvidenceError(code);
  }
}

function assertKnownFields(value, fields, code = "invalid_request") {
  if (Object.keys(value).some((key) => !fields.has(key))) {
    throw outdoorEvidenceError(code, { message: "The request contains an unknown property." });
  }
}
