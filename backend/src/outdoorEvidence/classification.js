const NON_CURRENT_PREFIXES = [
  "proposed:", "planned:", "construction:", "disused:", "abandoned:",
  "demolished:", "destroyed:", "removed:", "razed:"
];
const NON_CURRENT_VALUES = new Set(["proposed", "planned", "construction", "disused", "abandoned"]);
const HIGHWAY_VALUES = new Set([
  "path", "footway", "track", "steps", "bridleway", "cycleway", "pedestrian",
  "service", "unclassified", "residential", "living_street", "tertiary",
  "secondary", "primary", "trunk", "motorway", "road"
]);
const SURFACE_VALUES = new Set([
  "paved", "asphalt", "concrete", "concrete:lanes", "concrete:plates",
  "paving_stones", "sett", "cobblestone", "unhewn_cobblestone", "compacted",
  "fine_gravel", "gravel", "pebblestone", "rock", "dirt", "earth", "ground",
  "grass", "mud", "sand", "wood", "metal"
]);
const TRAIL_VISIBILITY_VALUES = new Set([
  "excellent", "good", "intermediate", "bad", "horrible", "no"
]);
export const SAC_SCALE_VALUES = Object.freeze([
  "strolling", "hiking", "mountain_hiking", "demanding_mountain_hiking",
  "alpine_hiking", "demanding_alpine_hiking", "difficult_alpine_hiking"
]);
const SAC_SCALE_SET = new Set(SAC_SCALE_VALUES);
const HIKING_NETWORK_VALUES = new Set(["iwn", "nwn", "rwn", "lwn"]);
const ACCESS_VALUES = new Set([
  "yes", "no", "private", "permissive", "designated", "destination", "customers",
  "delivery", "agricultural", "forestry", "permit", "use_sidepath"
]);
const RESTRICTIVE_ACCESS_VALUES = new Set([
  "no", "private", "customers", "delivery", "agricultural", "forestry", "permit",
  "use_sidepath"
]);

export function hasNonCurrentLifecycle(tags = {}) {
  if (Object.keys(tags).some((key) => NON_CURRENT_PREFIXES.some((prefix) => key.startsWith(prefix)))) {
    return true;
  }
  if (["yes", "true", "1"].includes(normalized(tags.disused)) ||
      ["yes", "true", "1"].includes(normalized(tags.abandoned)) ||
      ["yes", "true", "1"].includes(normalized(tags.proposed))) return true;
  return [tags.highway, tags.route, tags.tourism, tags.natural, tags.waterway]
    .some((value) => NON_CURRENT_VALUES.has(normalized(value)));
}

export function classifyOutdoorPoi(tags = {}) {
  if (hasNonCurrentLifecycle(tags)) return undefined;
  if (normalized(tags.tourism) === "viewpoint") return "viewpoint";
  if (normalized(tags.natural) === "peak") return "peak";
  if (normalized(tags.natural) === "water" && normalized(tags.water) === "lake") return "lake";
  if (normalized(tags.waterway) === "waterfall") return "waterfall";
  if (normalized(tags.tourism) === "alpine_hut") return "alpineHut";
  if (normalized(tags.tourism) === "wilderness_hut") return "wildernessHut";
  return undefined;
}

export function normalizeTrailSegment(tags = {}) {
  if (hasNonCurrentLifecycle(tags)) return undefined;
  const highway = normalized(tags.highway);
  if (!highway) return undefined;
  return {
    highwayClass: HIGHWAY_VALUES.has(highway) ? highway : "other",
    surface: allowlisted(tags.surface, SURFACE_VALUES),
    trailVisibility: allowlisted(tags.trail_visibility, TRAIL_VISIBILITY_VALUES),
    sacScale: allowlisted(tags.sac_scale, SAC_SCALE_SET),
    access: allowlisted(tags.access, ACCESS_VALUES),
    foot: allowlisted(tags.foot, ACCESS_VALUES),
    accessConditional: bounded(tags["access:conditional"], 256),
    footConditional: bounded(tags["foot:conditional"], 256),
    seasonal: bounded(tags.seasonal, 40),
    permit: bounded(tags.permit, 40)
  };
}

export function classifyHikingRelation(tags = {}) {
  if (hasNonCurrentLifecycle(tags)) return undefined;
  if (normalized(tags.type) !== "route") return undefined;
  const routeType = normalized(tags.route);
  if (routeType !== "hiking" && routeType !== "foot") return undefined;
  if (normalized(tags.state) === "proposed") return undefined;
  const networkValue = normalized(tags.network);
  return {
    routeType,
    network: HIKING_NETWORK_VALUES.has(networkValue) ? networkValue : undefined,
    state: relationState(tags.state)
  };
}

export function explicitAccessRestriction(segment = {}) {
  const access = normalized(segment.access ?? segment.accessTag);
  const foot = normalized(segment.foot ?? segment.footTag);
  const conditional = bounded(segment.accessConditional, 256) || bounded(segment.footConditional, 256);
  const seasonal = normalized(segment.seasonal ?? segment.seasonalTag);
  const permit = normalized(segment.permit ?? segment.permitTag);
  const hasEvidence = Boolean(access || foot || conditional || seasonal || permit);
  if (!hasEvidence) return undefined;
  return RESTRICTIVE_ACCESS_VALUES.has(access) || RESTRICTIVE_ACCESS_VALUES.has(foot) ||
    Boolean(conditional) || seasonal === "yes" || permit === "yes" || permit === "required";
}

function relationState(value) {
  const state = normalized(value);
  return new Set(["alternate", "temporary", "connection"]).has(state) ? state : "current";
}

function allowlisted(value, values) {
  const candidate = normalized(value);
  return values.has(candidate) ? candidate : undefined;
}

function normalized(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function bounded(value, maximumLength) {
  if (typeof value !== "string") return undefined;
  const candidate = value.trim();
  return candidate ? candidate.slice(0, maximumLength) : undefined;
}
