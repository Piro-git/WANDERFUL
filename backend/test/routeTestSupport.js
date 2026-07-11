export function pointToPointRequest(overrides = {}) {
  return {
    profile: "foot",
    routeType: "pointToPoint",
    points: [
      { latitude: 51.866, longitude: 10.678 },
      { latitude: 51.765, longitude: 10.653 }
    ],
    locale: "de",
    includeElevation: true,
    includeInstructions: true,
    ...overrides
  };
}

export function alternativeRouteRequest(overrides = {}) {
  return pointToPointRequest({
    algorithm: "alternative_route",
    alternativeRoute: {
      maxPaths: 3,
      maxWeightFactor: 1.4,
      maxShareFactor: 0.65
    },
    ...overrides
  });
}

export function loopRequest(overrides = {}) {
  return {
    profile: "foot",
    routeType: "loop",
    points: [{ latitude: 51.866, longitude: 10.678 }],
    algorithm: "round_trip",
    roundTrip: { distanceMeters: 15_000, seed: 11 },
    locale: "de",
    includeElevation: true,
    includeInstructions: true,
    includePathDetails: ["surface", "road_class", "hike_rating"],
    ...overrides
  };
}

export function multiPointLoopRequest(overrides = {}) {
  return {
    profile: "foot",
    routeType: "loop",
    points: [
      { latitude: 51.866, longitude: 10.678 },
      { latitude: 51.89, longitude: 10.72 },
      { latitude: 51.84, longitude: 10.71 },
      { latitude: 51.866, longitude: 10.678 }
    ],
    locale: "de",
    includeElevation: true,
    includeInstructions: true,
    includePathDetails: ["surface", "road_class", "hike_rating"],
    ...overrides
  };
}

export function routePath(overrides = {}) {
  return {
    distance: 12_345.6,
    time: 7_200_000,
    ascend: 420.5,
    descend: 410.25,
    points: {
      type: "LineString",
      coordinates: [[10.678, 51.866, 250], [10.653, 51.765, 610]]
    },
    instructions: [{ text: "Geradeaus", distance: 100, time: 60_000, interval: [0, 1], sign: 0 }],
    details: {
      surface: [[0, 1, "unpaved"]],
      road_class: [[0, 1, "track"]],
      hike_rating: [[0, 1, "T1"]]
    },
    ...overrides
  };
}

export function graphHopperResponse(paths = [routePath()], extras = {}) {
  return { paths, ...extras };
}
