import { routeError } from "./routeErrors.js";

export const ROUTE_PROFILES = Object.freeze(["foot", "bike"]);
export const ROUTE_TYPES = Object.freeze(["loop", "pointToPoint"]);
export const ROUTE_ALGORITHMS = Object.freeze(["alternative_route", "round_trip"]);
export const ROUTE_PATH_DETAILS = Object.freeze(["surface", "road_class", "hike_rating"]);
export const ROUTE_LOCALES = Object.freeze(["de"]);

const TOP_LEVEL_FIELDS = new Set([
  "profile", "routeType", "points", "algorithm", "roundTrip", "alternativeRoute",
  "locale", "includeElevation", "includeInstructions", "includePathDetails", "preferences"
]);
const POINT_FIELDS = new Set(["latitude", "longitude"]);
const ROUND_TRIP_FIELDS = new Set(["distanceMeters", "seed"]);
const ALTERNATIVE_ROUTE_FIELDS = new Set(["maxPaths", "maxWeightFactor", "maxShareFactor"]);
const PREFERENCE_FIELDS = new Set(["activityType", "avoid", "difficulty"]);
const ACTIVITY_TYPES = new Set(["hiking", "trailRunning", "biking"]);
const AVOID_PREFERENCES = new Set(["majorRoads", "steepClimbs"]);

const DEFAULT_MAX_POINTS = 25;
const DEFAULT_MIN_DISTANCE_METERS = 1_000;
const DEFAULT_MAX_DISTANCE_METERS = 200_000;
const MAX_SEED = 2_147_483_647;

export function validateRouteRequest(input, limits = {}) {
  assertObject(input, "request");
  assertKnownFields(input, TOP_LEVEL_FIELDS);

  const profile = input.profile;
  if (!ROUTE_PROFILES.includes(profile)) throw routeError("unsupported_profile");

  const routeType = input.routeType;
  if (!ROUTE_TYPES.includes(routeType)) {
    throw routeError("invalid_request", { message: "routeType must be loop or pointToPoint." });
  }

  const algorithm = validateAlgorithm(input.algorithm);
  const points = validatePoints(input.points, limits.maxPoints ?? DEFAULT_MAX_POINTS);
  validateCumulativeDistance(points, limits.maxDistanceMeters ?? DEFAULT_MAX_DISTANCE_METERS);
  const roundTrip = validateRoundTrip(input.roundTrip, limits);
  const alternativeRoute = validateAlternativeRoute(input.alternativeRoute);
  validateModeFields({ routeType, points, algorithm, roundTrip, alternativeRoute });

  const locale = input.locale ?? "de";
  if (!ROUTE_LOCALES.includes(locale)) {
    throw routeError("invalid_request", { message: "The requested locale is not supported." });
  }

  validateForcedBoolean(input, "includeElevation");
  validateForcedBoolean(input, "includeInstructions");
  const includePathDetails = validatePathDetails(input.includePathDetails);
  const preferences = validatePreferences(input.preferences, profile, routeType);

  return {
    profile,
    routeType,
    points,
    algorithm,
    roundTrip,
    alternativeRoute,
    locale,
    includeElevation: true,
    includeInstructions: true,
    includePathDetails,
    preferences
  };
}

function validatePoints(points, maxPoints) {
  if (!Array.isArray(points) || points.length === 0 || points.length > maxPoints) {
    throw routeError("invalid_coordinates");
  }

  return points.map((point) => {
    assertObject(point, "point", "invalid_coordinates");
    assertKnownFields(point, POINT_FIELDS, "invalid_coordinates");
    if (
      !Number.isFinite(point.latitude) || point.latitude < -90 || point.latitude > 90 ||
      !Number.isFinite(point.longitude) || point.longitude < -180 || point.longitude > 180
    ) {
      throw routeError("invalid_coordinates");
    }
    return { latitude: point.latitude, longitude: point.longitude };
  });
}

function validateCumulativeDistance(points, maxDistanceMeters) {
  let distanceMeters = 0;
  for (let index = 1; index < points.length; index += 1) {
    distanceMeters += haversineDistance(points[index - 1], points[index]);
    if (distanceMeters > maxDistanceMeters) {
      throw routeError("invalid_request", {
        message: `The route points exceed the ${maxDistanceMeters} metre request limit.`
      });
    }
  }
}

function haversineDistance(start, finish) {
  const earthRadiusMeters = 6_371_000;
  const degreesToRadians = Math.PI / 180;
  const latitudeDelta = (finish.latitude - start.latitude) * degreesToRadians;
  const longitudeDelta = (finish.longitude - start.longitude) * degreesToRadians;
  const startLatitude = start.latitude * degreesToRadians;
  const finishLatitude = finish.latitude * degreesToRadians;
  const haversine = (
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(startLatitude) * Math.cos(finishLatitude) * Math.sin(longitudeDelta / 2) ** 2
  );
  return earthRadiusMeters * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(Math.max(0, 1 - haversine)));
}

function validateAlgorithm(algorithm) {
  if (algorithm === undefined) return undefined;
  if (!ROUTE_ALGORITHMS.includes(algorithm)) throw routeError("unsupported_algorithm");
  return algorithm;
}

function validateRoundTrip(roundTrip, limits) {
  if (roundTrip === undefined) return undefined;
  assertObject(roundTrip, "roundTrip");
  assertKnownFields(roundTrip, ROUND_TRIP_FIELDS);

  const minDistance = limits.minDistanceMeters ?? DEFAULT_MIN_DISTANCE_METERS;
  const maxDistance = limits.maxDistanceMeters ?? DEFAULT_MAX_DISTANCE_METERS;
  if (
    !Number.isFinite(roundTrip.distanceMeters) || roundTrip.distanceMeters < minDistance ||
    roundTrip.distanceMeters > maxDistance
  ) {
    throw routeError("invalid_request", {
      message: `roundTrip.distanceMeters must be between ${minDistance} and ${maxDistance}.`
    });
  }
  if (!Number.isInteger(roundTrip.seed) || roundTrip.seed < 0 || roundTrip.seed > MAX_SEED) {
    throw routeError("invalid_request", {
      message: `roundTrip.seed must be an integer between 0 and ${MAX_SEED}.`
    });
  }
  return { distanceMeters: roundTrip.distanceMeters, seed: roundTrip.seed };
}

function validateAlternativeRoute(alternativeRoute) {
  if (alternativeRoute === undefined) return undefined;
  assertObject(alternativeRoute, "alternativeRoute");
  assertKnownFields(alternativeRoute, ALTERNATIVE_ROUTE_FIELDS);

  if (!Number.isInteger(alternativeRoute.maxPaths) || alternativeRoute.maxPaths < 2 || alternativeRoute.maxPaths > 3) {
    throw routeError("invalid_request", {
      message: "alternativeRoute.maxPaths must be an integer between 2 and 3."
    });
  }
  if (!Number.isFinite(alternativeRoute.maxWeightFactor) || alternativeRoute.maxWeightFactor < 1 || alternativeRoute.maxWeightFactor > 2) {
    throw routeError("invalid_request", {
      message: "alternativeRoute.maxWeightFactor must be between 1 and 2."
    });
  }
  if (!Number.isFinite(alternativeRoute.maxShareFactor) || alternativeRoute.maxShareFactor < 0 || alternativeRoute.maxShareFactor > 0.9) {
    throw routeError("invalid_request", {
      message: "alternativeRoute.maxShareFactor must be between 0 and 0.9."
    });
  }
  return {
    maxPaths: alternativeRoute.maxPaths,
    maxWeightFactor: alternativeRoute.maxWeightFactor,
    maxShareFactor: alternativeRoute.maxShareFactor
  };
}

function validateModeFields({ routeType, points, algorithm, roundTrip, alternativeRoute }) {
  if (routeType === "loop") {
    if (algorithm === "round_trip") {
      if (points.length !== 1 || !roundTrip || alternativeRoute) {
        throw routeError("invalid_request", {
          message: "Round-trip loop requests require one start point and roundTrip settings only."
        });
      }
      return;
    }

    if (algorithm === undefined) {
      if (roundTrip || alternativeRoute || points.length < 3 || !isClosedLoop(points)) {
        throw routeError("invalid_request", {
          message: "Standard loop requests require at least three points and must finish at their start."
        });
      }
      return;
    }

    throw routeError("invalid_request", {
      message: "Loop requests support standard via-point routing or round_trip only."
    });
  }

  if (points.length < 2) {
    throw routeError("invalid_coordinates", {
      message: "Point-to-point requests require at least two points."
    });
  }

  if (algorithm === "round_trip" || roundTrip) {
    throw routeError("invalid_request", {
      message: "Point-to-point requests cannot use round-trip settings."
    });
  }
  if (algorithm === "alternative_route" && !alternativeRoute) {
    throw routeError("invalid_request", {
      message: "alternative_route requires alternativeRoute settings."
    });
  }
  if (algorithm !== "alternative_route" && alternativeRoute) {
    throw routeError("invalid_request", {
      message: "alternativeRoute settings require the alternative_route algorithm."
    });
  }
}

function isClosedLoop(points) {
  const start = points[0];
  const finish = points[points.length - 1];
  const tolerance = 1e-6;
  return (
    Math.abs(start.latitude - finish.latitude) <= tolerance &&
    Math.abs(start.longitude - finish.longitude) <= tolerance
  );
}

function validatePathDetails(details) {
  if (details === undefined) return [...ROUTE_PATH_DETAILS];
  if (!Array.isArray(details) || details.length > ROUTE_PATH_DETAILS.length) {
    throw routeError("invalid_request", { message: "includePathDetails is invalid." });
  }
  if (new Set(details).size !== details.length || details.some((detail) => !ROUTE_PATH_DETAILS.includes(detail))) {
    throw routeError("invalid_request", { message: "One or more path details are not supported." });
  }
  return [...details];
}

function validatePreferences(preferences, profile, routeType) {
  if (preferences === undefined) return undefined;
  if (routeType !== "pointToPoint") {
    throw routeError("invalid_request", {
      message: "Typed route preferences are supported only for point-to-point requests."
    });
  }
  assertObject(preferences, "preferences");
  assertKnownFields(preferences, PREFERENCE_FIELDS);
  if (!ACTIVITY_TYPES.has(preferences.activityType)) {
    throw routeError("invalid_request", { message: "preferences.activityType is invalid." });
  }
  const expectedProfile = preferences.activityType === "biking" ? "bike" : "foot";
  if (profile !== expectedProfile) {
    throw routeError("invalid_request", {
      message: "preferences.activityType does not match the routing profile."
    });
  }
  const avoid = preferences.avoid ?? [];
  if (!Array.isArray(avoid) || new Set(avoid).size !== avoid.length || avoid.some((item) => !AVOID_PREFERENCES.has(item))) {
    throw routeError("invalid_request", { message: "preferences.avoid is invalid." });
  }
  if (preferences.difficulty !== undefined && preferences.difficulty !== "easy") {
    throw routeError("invalid_request", {
      message: "Only the easy route-engine difficulty preference is supported."
    });
  }
  return {
    activityType: preferences.activityType,
    avoid: [...avoid],
    difficulty: preferences.difficulty
  };
}

function validateForcedBoolean(input, field) {
  if (input[field] !== undefined && input[field] !== true) {
    throw routeError("invalid_request", { message: `${field} must be true when provided.` });
  }
}

function assertObject(value, field, code = "invalid_request") {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw routeError(code, { message: `${field} must be a JSON object.` });
  }
}

function assertKnownFields(object, allowedFields, code = "invalid_request") {
  const unknownField = Object.keys(object).find((field) => !allowedFields.has(field));
  if (unknownField) {
    throw routeError(code, { message: `Unknown request property: ${unknownField}.` });
  }
}
