import { SAC_SCALE_VALUES } from "./classification.js";
import { outdoorEvidenceError } from "./outdoorEvidenceErrors.js";

const POI_CATEGORIES = Object.freeze([
  "viewpoint", "peak", "lake", "waterfall", "alpineHut", "wildernessHut"
]);
const HIGHWAY_VALUES = new Set([
  "path", "footway", "track", "steps", "bridleway", "cycleway", "pedestrian",
  "service", "unclassified", "residential", "living_street", "tertiary",
  "secondary", "primary", "trunk", "motorway", "road", "other"
]);
const SURFACE_VALUES = new Set([
  "paved", "asphalt", "concrete", "concrete:lanes", "concrete:plates",
  "paving_stones", "sett", "cobblestone", "unhewn_cobblestone", "compacted",
  "fine_gravel", "gravel", "pebblestone", "rock", "dirt", "earth", "ground",
  "grass", "mud", "sand", "wood", "metal", "other"
]);
const VISIBILITY_VALUES = new Set(["excellent", "good", "intermediate", "bad", "horrible", "no"]);
const SAC_VALUES = new Set(SAC_SCALE_VALUES);
const RESTRICTIVE_ACCESS_VALUES = new Set([
  "no", "private", "customers", "delivery", "agricultural", "forestry", "permit", "use_sidepath"
]);
const OSM_ATTRIBUTION = Object.freeze({
  notice: "© OpenStreetMap contributors",
  license: "ODbL 1.0",
  url: "https://www.openstreetmap.org/copyright"
});

export function createOutdoorEvidenceService(options = {}) {
  const repository = options.repository;
  const now = options.now ?? (() => new Date());
  const maximumPois = boundedInteger(options.maximumPois, 40, 1, 100);
  const maximumResponseBytes = boundedInteger(
    options.maximumResponseBytes,
    512 * 1_024,
    8 * 1_024,
    2 * 1_024 * 1_024
  );

  return {
    async corridor(request, context = {}) {
      if (!repository?.queryCorridor) {
        return bounded(unavailableResponse(request), maximumResponseBytes);
      }
      const row = await repository.queryCorridor(request, { ...context, maximumPois });
      const response = normalizeCorridorRow(request, row, { now: now(), maximumPois });
      return bounded(response, maximumResponseBytes);
    }
  };
}

export function normalizeCorridorRow(request, row, options = {}) {
  const currentTime = options.now instanceof Date ? options.now : new Date(options.now ?? Date.now());
  const routeLength = finitePositive(row?.route_length_meters);
  const regions = normalizeRegions(row?.regions, routeLength, currentTime);
  if (regions.length === 0) return outsideResponse(request);

  const coveredLength = finiteNonNegative(row.covered_length_meters);
  const overallRegionalCoverageRatio = ratio(coveredLength, routeLength);
  if (overallRegionalCoverageRatio === 0) return outsideResponse(request);

  const overlapping = regions.reduce((sum, region) => sum + region.coveredLengthMeters, 0) >
    coveredLength * 1.01 + 1;
  const publicRegions = regions.map(publicRegion);
  const warnings = regionalWarnings(publicRegions, overallRegionalCoverageRatio, overlapping);
  const evidenceStatus = regions.some((region) => region.evidenceStatus === "unavailable")
    ? "unavailable"
    : regions.some((region) => region.evidenceStatus === "stale") ? "stale" : "known";

  if (evidenceStatus === "unavailable") {
    return unavailableResponse(
      request,
      publicRegions,
      warnings,
      overallRegionalCoverageRatio
    );
  }

  const lengths = {
    highway: finiteNonNegative(row.highway_coverage_meters),
    surface: finiteNonNegative(row.surface_coverage_meters),
    trailVisibility: finiteNonNegative(row.trail_visibility_coverage_meters),
    sacScale: finiteNonNegative(row.sac_scale_coverage_meters),
    access: finiteNonNegative(row.access_coverage_meters),
    mappedHikingRoute: finiteNonNegative(row.mapped_hiking_relation_meters)
  };
  for (const value of Object.values(lengths)) validateCoveredLength(value, coveredLength, routeLength);

  const highwayBreakdown = normalizeBreakdown(row.highway_breakdown, HIGHWAY_VALUES, lengths.highway);
  const surfaceBreakdown = normalizeBreakdown(row.surface_breakdown, SURFACE_VALUES, lengths.surface);
  const trailVisibilityBreakdown = normalizeBreakdown(
    row.trail_visibility_breakdown,
    VISIBILITY_VALUES,
    lengths.trailVisibility
  );
  const sacScaleBreakdown = normalizeBreakdown(row.sac_scale_breakdown, SAC_VALUES, lengths.sacScale);
  const maximumKnownSacScale = maximumSacScale(row.maximum_sac_scale_rank);
  if (maximumKnownSacScale !== maximumSacScaleFromBreakdown(sacScaleBreakdown)) malformed();

  const explicitAccessRestrictions = normalizeRestrictions(row.explicit_access_restrictions);
  const mappedPoiCounts = normalizePoiCounts(row.mapped_poi_counts);
  const datasetsByImport = new Map(regions.map((region) => [region.dataset.importId, region]));
  const mappedPois = normalizePois(
    row.mapped_pois,
    datasetsByImport,
    options.maximumPois ?? 40,
    request.corridorWidthMeters
  );
  if (mappedPois.some((poi, index) => mappedPois.findIndex((candidate) =>
    candidate.sourceIdentity.osmType === poi.sourceIdentity.osmType &&
    candidate.sourceIdentity.osmId === poi.sourceIdentity.osmId
  ) !== index)) malformed();
  for (const category of POI_CATEGORIES) {
    if (mappedPois.filter((poi) => poi.category === category).length > mappedPoiCounts[category]) {
      malformed();
    }
  }

  warnings.push("osmMappedEvidenceOnly", "missingTagsRemainUnknown");
  return {
    schemaVersion: 2,
    routeFingerprint: request.routeFingerprint,
    evidenceStatus,
    regions: publicRegions,
    overallRegionalCoverageRatio,
    osmAttribution: OSM_ATTRIBUTION,
    attributeCoverage: {
      highway: ratio(lengths.highway, routeLength),
      surface: ratio(lengths.surface, routeLength),
      trailVisibility: ratio(lengths.trailVisibility, routeLength),
      sacScale: ratio(lengths.sacScale, routeLength),
      explicitAccess: ratio(lengths.access, routeLength)
    },
    mappedHikingRouteCoverageRatio: ratio(lengths.mappedHikingRoute, routeLength),
    highwayLengthBreakdown: highwayBreakdown,
    surfaceLengthBreakdown: surfaceBreakdown,
    trailVisibilityLengthBreakdown: trailVisibilityBreakdown,
    sacScaleLengthBreakdown: sacScaleBreakdown,
    maximumKnownSacScale,
    explicitAccessRestrictions,
    mappedPoiCounts,
    mappedPois,
    warnings
  };
}

function normalizeRegions(input, routeLength, now) {
  if (!Array.isArray(input) || input.length > 100) malformed();
  const ids = new Set();
  const imports = new Set();
  const result = input.map((entry) => {
    const id = boundedString(entry?.id, 80, true);
    if (ids.has(id)) malformed();
    ids.add(id);
    const coveredLengthMeters = finiteNonNegative(entry.coveredLengthMeters);
    const routeCoverageRatio = ratio(coveredLengthMeters, routeLength);
    if (routeCoverageRatio === 0) malformed();
    const coverage = {
      id,
      name: boundedString(entry.name, 160, true),
      coverageStatus: routeCoverageRatio >= 0.999999 ? "full" : "partial",
      routeCoverageRatio
    };
    if (!entry.importId || entry.importStatus !== "active") {
      return { ...coverage, coveredLengthMeters, evidenceStatus: "unavailable", dataset: null };
    }
    const dataset = datasetProvenance(entry);
    if (imports.has(dataset.importId)) malformed();
    imports.add(dataset.importId);
    const freshness = freshnessStatus(entry, now);
    return {
      ...coverage,
      coveredLengthMeters,
      evidenceStatus: freshness === "current" ? "known" :
        freshness === "stale" ? "stale" : "unavailable",
      dataset: { ...dataset, freshnessStatus: freshness }
    };
  });
  return result.sort((left, right) =>
    right.coveredLengthMeters - left.coveredLengthMeters || left.id.localeCompare(right.id)
  );
}

function publicRegion(region) {
  return {
    id: region.id,
    name: region.name,
    coverageStatus: region.coverageStatus,
    routeCoverageRatio: region.routeCoverageRatio,
    evidenceStatus: region.evidenceStatus,
    dataset: region.dataset
  };
}

function regionalWarnings(regions, overallCoverage, overlapping) {
  const warnings = [];
  if (overallCoverage < 0.999999) warnings.push("partialRegionalCoverage");
  if (overlapping) warnings.push("overlappingRegionalCoverage");
  if (regions.some((region) => region.evidenceStatus === "stale")) warnings.push("datasetStale");
  if (regions.some((region) => !region.dataset)) warnings.push("datasetUnavailable");
  if (regions.some((region) => region.dataset?.freshnessStatus === "sourceTimestampUnavailable")) {
    warnings.push("sourceTimestampUnavailable");
  }
  return warnings;
}

function outsideResponse(request) {
  return emptyResponse(request, {
    evidenceStatus: "unsupported",
    regions: [],
    overallRegionalCoverageRatio: 0,
    warnings: ["routeOutsideSupportedRegion"]
  });
}

function unavailableResponse(
  request,
  regions = [],
  warnings = ["serviceUnavailable"],
  overallRegionalCoverageRatio = null
) {
  return emptyResponse(request, {
    evidenceStatus: "unavailable",
    regions,
    overallRegionalCoverageRatio,
    warnings
  });
}

function emptyResponse(request, state) {
  return {
    schemaVersion: 2,
    routeFingerprint: request.routeFingerprint,
    evidenceStatus: state.evidenceStatus,
    regions: state.regions,
    overallRegionalCoverageRatio: state.overallRegionalCoverageRatio,
    osmAttribution: OSM_ATTRIBUTION,
    attributeCoverage: unavailableCoverage(),
    mappedHikingRouteCoverageRatio: null,
    highwayLengthBreakdown: [],
    surfaceLengthBreakdown: [],
    trailVisibilityLengthBreakdown: [],
    sacScaleLengthBreakdown: [],
    maximumKnownSacScale: null,
    explicitAccessRestrictions: [],
    mappedPoiCounts: null,
    mappedPois: [],
    warnings: state.warnings
  };
}

function unavailableCoverage() {
  return { highway: null, surface: null, trailVisibility: null, sacScale: null, explicitAccess: null };
}

function datasetProvenance(row) {
  return {
    importId: boundedString(String(row.importId), 80, true),
    sourceDataset: boundedString(row.sourceDataset, 160, true),
    sourceIdentifier: boundedString(row.sourceIdentifier, 500, true),
    sourceDataTimestamp: optionalDate(row.sourceDataTimestamp),
    importedTimestamp: requiredDate(row.importedTimestamp)
  };
}

function freshnessStatus(row, now) {
  const source = optionalDateObject(row.sourceDataTimestamp);
  if (!source) return "sourceTimestampUnavailable";
  const thresholdDays = boundedInteger(row.freshnessThresholdDays, undefined, 1, 365);
  if (!thresholdDays || !Number.isFinite(now.getTime())) malformed();
  return now.getTime() - source.getTime() > thresholdDays * 86_400_000 ? "stale" : "current";
}

function normalizeBreakdown(input, allowlist, expectedTotal) {
  if (!Array.isArray(input)) malformed();
  const seen = new Set();
  const result = input.map((entry) => {
    const value = boundedString(entry?.value, 80, true);
    if (!allowlist.has(value) || seen.has(value)) malformed();
    seen.add(value);
    return { value, lengthMeters: finiteNonNegative(entry.lengthMeters) };
  });
  const total = result.reduce((sum, entry) => sum + entry.lengthMeters, 0);
  if (Math.abs(total - expectedTotal) > Math.max(1, expectedTotal * 0.01)) malformed();
  return result;
}

function normalizeRestrictions(input) {
  if (!Array.isArray(input) || input.length > 25) malformed();
  const seen = new Set();
  return input.map((entry) => {
    const osmType = entry?.osmType;
    const osmId = boundedString(entry?.osmId, 32, true);
    if (osmType !== "way" || !/^\d+$/.test(osmId) || seen.has(osmId)) malformed();
    seen.add(osmId);
    const normalized = {
      sourceIdentity: { osmType, osmId },
      access: optionalAllowlistedAccess(entry.access),
      foot: optionalAllowlistedAccess(entry.foot),
      conditional: requiredBoolean(entry.conditional),
      seasonal: requiredBoolean(entry.seasonal),
      permitRequired: requiredBoolean(entry.permitRequired)
    };
    if (!RESTRICTIVE_ACCESS_VALUES.has(normalized.access) &&
        !RESTRICTIVE_ACCESS_VALUES.has(normalized.foot) &&
        !normalized.conditional && !normalized.seasonal && !normalized.permitRequired) malformed();
    return normalized;
  });
}

function normalizePoiCounts(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) malformed();
  const result = Object.fromEntries(POI_CATEGORIES.map((category) => [category, 0]));
  for (const [category, count] of Object.entries(input)) {
    if (!POI_CATEGORIES.includes(category) || !Number.isInteger(count) || count < 0 || count > 1_000_000) {
      malformed();
    }
    result[category] = count;
  }
  return result;
}

function normalizePois(input, datasetsByImport, maximumPois, maximumDistanceMeters) {
  if (!Array.isArray(input) || input.length > maximumPois) malformed();
  return input.map((poi) => {
    const osmType = poi?.osmType;
    const osmId = boundedString(poi?.osmId, 32, true);
    const category = poi?.category;
    if (!new Set(["node", "way", "relation"]).has(osmType) || !/^\d+$/.test(osmId)) malformed();
    if (!POI_CATEGORIES.includes(category)) malformed();
    const distanceFromRouteMeters = finiteNonNegative(poi.distanceFromRouteMeters);
    if (!Number.isFinite(maximumDistanceMeters) || distanceFromRouteMeters > maximumDistanceMeters + 1) {
      malformed();
    }
    const importId = boundedString(String(poi.importId), 80, true);
    const region = datasetsByImport.get(importId);
    if (!region || poi.regionId !== region.id || poi.sourceDataset !== region.dataset.sourceDataset) malformed();
    return {
      sourceIdentity: { osmType, osmId },
      category,
      name: optionalString(poi.name, 160),
      coordinate: {
        latitude: finiteRange(poi.latitude, -90, 90),
        longitude: finiteRange(poi.longitude, -180, 180)
      },
      distanceFromRouteMeters,
      provenance: {
        regionId: region.id,
        importId,
        sourceDataset: region.dataset.sourceDataset,
        sourceVersion: optionalPositiveInteger(poi.sourceVersion),
        sourceTimestamp: optionalDate(poi.sourceTimestamp)
      }
    };
  });
}

function maximumSacScale(value) {
  if (value === null || value === undefined) return null;
  const rank = Number(value);
  if (!Number.isInteger(rank) || rank < 1 || rank > SAC_SCALE_VALUES.length) malformed();
  return SAC_SCALE_VALUES[rank - 1];
}

function maximumSacScaleFromBreakdown(breakdown) {
  let maximumRank = 0;
  for (const entry of breakdown) {
    if (entry.lengthMeters > 0) {
      maximumRank = Math.max(maximumRank, SAC_SCALE_VALUES.indexOf(entry.value) + 1);
    }
  }
  return maximumRank > 0 ? SAC_SCALE_VALUES[maximumRank - 1] : null;
}

function validateCoveredLength(value, coveredLength, routeLength) {
  if (value > coveredLength * 1.01 + 1 || value > routeLength * 1.01 + 1) malformed();
}

function ratio(numerator, denominator) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || numerator < 0 || denominator <= 0) {
    malformed();
  }
  if (numerator > denominator * 1.01 + 1) malformed();
  return Math.min(numerator / denominator, 1);
}

function bounded(response, maximumBytes) {
  if (Buffer.byteLength(JSON.stringify(response), "utf8") > maximumBytes) {
    throw outdoorEvidenceError("response_too_large");
  }
  return response;
}

function optionalAllowlistedAccess(value) {
  if (value === null || value === undefined) return null;
  const candidate = boundedString(value, 40, true);
  const allowed = new Set([
    "yes", "no", "private", "permissive", "designated", "destination", "customers",
    "delivery", "agricultural", "forestry", "permit", "use_sidepath"
  ]);
  if (!allowed.has(candidate)) malformed();
  return candidate;
}

function requiredBoolean(value) {
  if (typeof value !== "boolean") malformed();
  return value;
}

function optionalDate(value) {
  const date = optionalDateObject(value);
  return date?.toISOString() ?? null;
}

function requiredDate(value) {
  const date = optionalDateObject(value);
  if (!date) malformed();
  return date.toISOString();
}

function optionalDateObject(value) {
  if (value === null || value === undefined) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) malformed();
  return date;
}

function optionalPositiveInteger(value) {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) malformed();
  return number;
}

function optionalString(value, maximumLength) {
  if (value === null || value === undefined) return null;
  return boundedString(value, maximumLength, false);
}

function boundedString(value, maximumLength, required) {
  if (typeof value !== "string") malformed();
  const candidate = value.trim();
  if ((required && !candidate) || candidate.length > maximumLength) malformed();
  return candidate || null;
}

function finitePositive(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) malformed();
  return number;
}

function finiteNonNegative(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) malformed();
  return number;
}

function finiteRange(value, minimum, maximum) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < minimum || number > maximum) malformed();
  return number;
}

function boundedInteger(value, fallback, minimum, maximum) {
  const number = Number(value);
  return Number.isInteger(number) && number >= minimum && number <= maximum ? number : fallback;
}

function malformed() {
  throw outdoorEvidenceError("evidence_unavailable");
}
