const EVENT_SCHEMAS = Object.freeze({
  route_request_completed: Object.freeze([
    "routeType", "profile", "pointCount", "algorithm", "distanceCategory",
    "statusCode", "errorCode", "providerLatencyMs"
  ]),
  outdoor_evidence_request_completed: Object.freeze([
    "pointCountBucket", "distanceBucket", "corridorWidthMeters", "regions",
    "statusCode", "errorCode", "durationMs"
  ]),
  outdoor_adventure_planning_completed: Object.freeze([
    "resultState", "activity", "routeType", "regionId", "proposalCount",
    "attemptCount", "routeResultCount", "durationBucket", "errorCode"
  ]),
  intent_lease_release_failed: Object.freeze([]),
  service_started: Object.freeze(["releaseStage"]),
  service_start_failed: Object.freeze(["errorCode"]),
  service_draining: Object.freeze(["reason"]),
  service_stopped: Object.freeze(["outcome"]),
  readiness_changed: Object.freeze(["state"])
});

export function createOperationalLogger(options = {}) {
  const write = options.write ?? process.stdout.write.bind(process.stdout);
  const now = options.now ?? Date.now;
  const emit = (level, input) => {
    const event = operationalEvent(input, { level, now });
    if (!event) return false;
    try {
      write(`${JSON.stringify(event)}\n`);
      return true;
    } catch {
      return false;
    }
  };
  return Object.freeze({
    info(input) { return emit("info", input); },
    warn(input) { return emit("warn", input); },
    error(input) { return emit("error", input); }
  });
}

export function operationalEvent(input, options = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return undefined;
  const eventName = input.event;
  const fields = EVENT_SCHEMAS[eventName];
  if (!fields) return undefined;
  const timestamp = new Date((options.now ?? Date.now)()).toISOString();
  const event = {
    schemaVersion: 1,
    eventName,
    level: safeLevel(options.level),
    timestamp
  };
  for (const field of fields) {
    const value = safeField(field, input[field]);
    if (value !== undefined) event[field] = value;
  }
  return Object.freeze(event);
}

function safeField(name, value) {
  if (value === undefined || value === null) return undefined;
  if (name.endsWith("Ms")) return durationBucket(value);
  if (["proposalCount", "attemptCount", "routeResultCount", "pointCount"].includes(name)) {
    return countBucket(value);
  }
  if (name === "statusCode") {
    return Number.isInteger(value) && value >= 100 && value <= 599 ? value : undefined;
  }
  if (name === "regions") {
    const regions = String(value).split(",").map(region).filter(Boolean).slice(0, 4);
    return regions.length > 0 ? regions : undefined;
  }
  if (name === "regionId") return region(value);
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return undefined;
  return /^[a-z0-9][a-z0-9_.-]{0,63}$/i.test(value) ? value : undefined;
}

function region(value) {
  const text = typeof value === "string" ? value : "";
  return ["harz-v1", "innsbruck-alps-v1", "unsupported", "unknown"].includes(text)
    ? text
    : "unknown";
}

function durationBucket(value) {
  if (!Number.isFinite(value) || value < 0) return "unknown";
  if (value < 250) return "under_250ms";
  if (value < 1_000) return "250ms_to_1s";
  if (value < 5_000) return "1s_to_5s";
  if (value < 15_000) return "5s_to_15s";
  if (value < 30_000) return "15s_to_30s";
  return "30s_or_more";
}

function countBucket(value) {
  if (!Number.isInteger(value) || value < 0) return "unknown";
  if (value === 0) return "0";
  if (value === 1) return "1";
  if (value <= 3) return "2_to_3";
  if (value <= 10) return "4_to_10";
  return "11_or_more";
}

function safeLevel(value) {
  return ["info", "warn", "error"].includes(value) ? value : "info";
}
