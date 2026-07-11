const ERROR_DEFINITIONS = Object.freeze({
  invalid_request: [400, "The route request is invalid."],
  invalid_coordinates: [400, "One or more coordinates are invalid."],
  unsupported_profile: [400, "The requested routing profile is not supported."],
  unsupported_algorithm: [400, "The requested routing algorithm is not supported."],
  flexible_mode_unavailable: [422, "Flexible routing is unavailable for this request."],
  route_not_found: [422, "No suitable route was found for this request."],
  route_timed_out: [504, "Route calculation timed out. Please try again."],
  routing_unavailable: [503, "Routing is temporarily unavailable. Please try again."],
  routing_rate_limited: [503, "Routing is temporarily busy. Please try again later."],
  configuration_missing: [503, "Routing is not configured on this server."],
  request_too_large: [413, "The route request is too large."],
  unauthorized: [401, "This route request is not authorized."],
  request_cancelled: [499, "The route request was cancelled."]
});

export class RouteError extends Error {
  constructor(code, options = {}) {
    const definition = ERROR_DEFINITIONS[code] ?? ERROR_DEFINITIONS.routing_unavailable;
    super(options.message ?? definition[1], { cause: options.cause });
    this.name = "RouteError";
    this.code = ERROR_DEFINITIONS[code] ? code : "routing_unavailable";
    this.statusCode = options.statusCode ?? definition[0];
  }
}

export function routeError(code, options) {
  return new RouteError(code, options);
}

export function routeErrorResult(error) {
  const safeError =
    error instanceof RouteError ? error : routeError("routing_unavailable", { cause: error });
  return {
    statusCode: safeError.statusCode,
    payload: {
      error: {
        code: safeError.code,
        message: safeError.message
      }
    }
  };
}
