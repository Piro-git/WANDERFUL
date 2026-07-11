import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { RouteError } from "../src/routing/routeErrors.js";
import { validateRouteRequest } from "../src/routing/routeValidation.js";
import {
  alternativeRouteRequest,
  loopRequest,
  multiPointLoopRequest,
  pointToPointRequest
} from "./routeTestSupport.js";

function assertRouteError(input, code) {
  assert.throws(
    () => validateRouteRequest(input),
    (error) => error instanceof RouteError && error.code === code
  );
}

describe("route request validation", () => {
  it("accepts a valid foot point-to-point request", () => {
    const request = validateRouteRequest(pointToPointRequest());
    assert.equal(request.profile, "foot");
    assert.equal(request.algorithm, undefined);
    assert.deepEqual(request.includePathDetails, ["surface", "road_class", "hike_rating"]);
  });

  it("accepts a valid bike point-to-point request", () => {
    const request = validateRouteRequest(pointToPointRequest({ profile: "bike" }));
    assert.equal(request.profile, "bike");
  });

  it("accepts a valid foot round-trip request", () => {
    const request = validateRouteRequest(loopRequest());
    assert.equal(request.roundTrip.distanceMeters, 15_000);
    assert.equal(request.roundTrip.seed, 11);
  });

  it("accepts a closed standard multi-point loop for fallback routing", () => {
    const request = validateRouteRequest(multiPointLoopRequest());
    assert.equal(request.routeType, "loop");
    assert.equal(request.algorithm, undefined);
    assert.equal(request.points.length, 4);
  });

  it("requires exactly one loop point", () => {
    assertRouteError(loopRequest({ points: pointToPointRequest().points }), "invalid_request");
  });

  it("rejects standard loops that are too short or do not close", () => {
    assertRouteError(
      multiPointLoopRequest({ points: multiPointLoopRequest().points.slice(0, 2) }),
      "invalid_request"
    );
    assertRouteError(
      multiPointLoopRequest({
        points: [
          { latitude: 51.866, longitude: 10.678 },
          { latitude: 51.89, longitude: 10.72 },
          { latitude: 51.84, longitude: 10.71 }
        ]
      }),
      "invalid_request"
    );
  });

  it("rejects flexible settings on a standard multi-point loop", () => {
    assertRouteError(
      multiPointLoopRequest({
        roundTrip: { distanceMeters: 15_000, seed: 11 }
      }),
      "invalid_request"
    );
    assertRouteError(
      multiPointLoopRequest({
        algorithm: "alternative_route",
        alternativeRoute: { maxPaths: 3, maxWeightFactor: 1.4, maxShareFactor: 0.65 }
      }),
      "invalid_request"
    );
  });

  it("requires at least two point-to-point points", () => {
    assertRouteError(pointToPointRequest({ points: [{ latitude: 51, longitude: 10 }] }), "invalid_coordinates");
  });

  it("validates latitude bounds", () => {
    const points = pointToPointRequest().points;
    assertRouteError(pointToPointRequest({ points: [{ ...points[0], latitude: 90.1 }, points[1]] }), "invalid_coordinates");
  });

  it("validates longitude bounds", () => {
    const points = pointToPointRequest().points;
    assertRouteError(pointToPointRequest({ points: [{ ...points[0], longitude: -180.1 }, points[1]] }), "invalid_coordinates");
  });

  it("rejects non-finite coordinates", () => {
    const points = pointToPointRequest().points;
    for (const value of [NaN, Infinity, -Infinity]) {
      assertRouteError(pointToPointRequest({ points: [{ ...points[0], latitude: value }, points[1]] }), "invalid_coordinates");
    }
  });

  it("enforces the profile allowlist", () => {
    assertRouteError(pointToPointRequest({ profile: "car" }), "unsupported_profile");
  });

  it("enforces the algorithm allowlist", () => {
    assertRouteError(pointToPointRequest({ algorithm: "dijkstra" }), "unsupported_algorithm");
  });

  it("enforces round-trip distance bounds", () => {
    assertRouteError(loopRequest({ roundTrip: { distanceMeters: 999, seed: 11 } }), "invalid_request");
    assertRouteError(loopRequest({ roundTrip: { distanceMeters: 200_001, seed: 11 } }), "invalid_request");
  });

  it("enforces configured round-trip distance bounds", () => {
    assert.throws(
      () => validateRouteRequest(loopRequest(), { maxDistanceMeters: 10_000 }),
      (error) => error.code === "invalid_request"
    );
  });

  it("validates round-trip seeds", () => {
    for (const seed of [-1, 1.5, 2_147_483_648]) {
      assertRouteError(loopRequest({ roundTrip: { distanceMeters: 15_000, seed } }), "invalid_request");
    }
  });

  it("enforces alternative-route option bounds", () => {
    assertRouteError(alternativeRouteRequest({ alternativeRoute: { maxPaths: 4, maxWeightFactor: 1.4, maxShareFactor: 0.6 } }), "invalid_request");
    assertRouteError(alternativeRouteRequest({ alternativeRoute: { maxPaths: 3, maxWeightFactor: 2.1, maxShareFactor: 0.6 } }), "invalid_request");
    assertRouteError(alternativeRouteRequest({ alternativeRoute: { maxPaths: 3, maxWeightFactor: 1.4, maxShareFactor: 0.91 } }), "invalid_request");
  });

  it("enforces the path-detail allowlist", () => {
    assertRouteError(pointToPointRequest({ includePathDetails: ["surface", "private_detail"] }), "invalid_request");
  });

  it("rejects unknown properties including provider URL overrides", () => {
    assertRouteError(pointToPointRequest({ providerUrl: "https://attacker.example" }), "invalid_request");
    assertRouteError(pointToPointRequest({ key: "client-key" }), "invalid_request");
  });

  it("rejects mismatched route mode settings", () => {
    assertRouteError(pointToPointRequest({ algorithm: "round_trip", roundTrip: { distanceMeters: 10_000, seed: 1 } }), "invalid_request");
    assertRouteError(loopRequest({ algorithm: undefined }), "invalid_request");
  });

  it("accepts only narrow typed custom-model preferences", () => {
    const request = validateRouteRequest(pointToPointRequest({
      preferences: {
        activityType: "trailRunning",
        avoid: ["majorRoads", "steepClimbs"],
        difficulty: "easy"
      }
    }));
    assert.equal(request.preferences.activityType, "trailRunning");
    assertRouteError(pointToPointRequest({ preferences: { activityType: "hiking", customModel: {} } }), "invalid_request");
  });

  it("enforces maximum point count", () => {
    const points = Array.from({ length: 26 }, (_, index) => ({ latitude: 51, longitude: 10 + index / 100 }));
    assertRouteError(pointToPointRequest({ points }), "invalid_coordinates");
  });

  it("bounds cumulative point-to-point request distance", () => {
    assertRouteError(
      pointToPointRequest({
        points: [
          { latitude: 51, longitude: 10 },
          { latitude: 54, longitude: 10 }
        ]
      }),
      "invalid_request"
    );
  });

  it("forces elevation and instructions on", () => {
    assertRouteError(pointToPointRequest({ includeElevation: false }), "invalid_request");
    assertRouteError(pointToPointRequest({ includeInstructions: false }), "invalid_request");
  });
});
