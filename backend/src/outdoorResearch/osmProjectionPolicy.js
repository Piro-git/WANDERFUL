import { createHash } from "node:crypto";

export const OSM_RESEARCH_SOURCE_KEY = "osm_foundational_data";
export const OSM_PROJECTION_ADAPTER_VERSION = "osm-evidence-graph-v1";
export const OSM_PROJECTION_POLICY_VERSION = "osm-foundational-mapped-v1";
export const OSM_PROJECTION_POLICY_REACTIVATION_VERSION =
  "osm-foundational-mapped-v2";
export const OSM_PROJECTION_POLICY_SCHEMA_VERSION = 1;
export const OSM_PROJECTION_OPERATOR_CONFIRMATION = "project-reviewed-osm-mapped-facts";
export const OSM_POLICY_ACTIVATION_CONFIRMATION = "activate-reviewed-osm-mapped-policy";
export const OSM_POLICY_REVOCATION_CONFIRMATION = "revoke-osm-mapped-policy";
export const OSM_PROJECTION_POLICY_VERSIONS = Object.freeze([
  OSM_PROJECTION_POLICY_VERSION,
  OSM_PROJECTION_POLICY_REACTIVATION_VERSION
]);
export const OSM_ACQUISITION_CHANNELS = Object.freeze([
  "geofabrik_regional_extract",
  "operator_supplied_local",
  "other_reviewed_bulk"
]);
export const OSM_PROJECTION_REGION_IDS = Object.freeze([
  "harz-v1",
  "innsbruck-alps-v1"
]);

const CANONICAL_CATEGORY_BY_EVIDENCE_CATEGORY = Object.freeze({
  viewpoint: "viewpoint",
  waterfall: "waterfall",
  peak: "peak",
  lake: "lake",
  alpineHut: "alpine_hut",
  wildernessHut: "wilderness_hut"
});

export const OSM_SOURCE_CONTRACT = Object.freeze({
  sourceKey: OSM_RESEARCH_SOURCE_KEY,
  sourceName: "OpenStreetMap foundational data",
  sourceCategory: "openstreetmap_open_mapping",
  authorityClass: "open_community",
  licenseIdentifier: "ODbL-1.0",
  attributionRequirements:
    "© OpenStreetMap contributors — https://www.openstreetmap.org/copyright",
  canonicalOrigin: "https://www.openstreetmap.org",
  geographicCoverage: "TrailMind Harz and Innsbruck bounded outdoor evidence regions",
  expectedRefreshIntervalSeconds: 86_400,
  normalizedFactsAllowed: true,
  derivedFeaturesAllowed: false,
  adapterSchemaVersion: OSM_PROJECTION_ADAPTER_VERSION
});

const ENTITY_CATEGORIES = Object.freeze([
  "viewpoint", "waterfall", "peak", "lake", "alpine_hut", "wilderness_hut",
  "trail_segment", "hiking_route"
]);
const NAME_CATEGORIES = Object.freeze([
  "viewpoint", "waterfall", "peak", "lake", "alpine_hut", "wilderness_hut",
  "hiking_route"
]);

export const OSM_ASSERTION_POLICY_SCOPES = Object.freeze([
  ...ENTITY_CATEGORIES.map((entityCategory) =>
    Object.freeze({ predicate: "entity_category", entityCategory })
  ),
  ...NAME_CATEGORIES.map((entityCategory) =>
    Object.freeze({ predicate: "name", entityCategory })
  ),
  Object.freeze({ predicate: "operator", entityCategory: "hiking_route" }),
  Object.freeze({ predicate: "trail_difficulty", entityCategory: "trail_segment" }),
  Object.freeze({ predicate: "trail_visibility", entityCategory: "trail_segment" }),
  Object.freeze({ predicate: "viewpoint_presence", entityCategory: "viewpoint" }),
  Object.freeze({ predicate: "waterfall_presence", entityCategory: "waterfall" }),
  Object.freeze({ predicate: "access_restriction", entityCategory: "trail_segment" })
].sort(compareScopes));

export const OSM_RELATIONSHIP_POLICY_SCOPES = Object.freeze([
  Object.freeze({
    relationshipType: "trail_segment_member_of_route",
    subjectEntityCategory: "trail_segment",
    objectEntityCategory: "hiking_route"
  })
]);

export const OSM_ALLOWED_ASSERTION_PREDICATES = Object.freeze(
  [...new Set(OSM_ASSERTION_POLICY_SCOPES.map((scope) => scope.predicate))].sort()
);

export const OSM_FORBIDDEN_HIGH_STAKES_PREDICATES = Object.freeze([
  "public_access", "current_opening", "seasonal_opening", "overnight_permission",
  "bookability", "drinking_water_availability", "closure_status"
]);

export const OSM_SAC_SCALE_VALUES = Object.freeze([
  "strolling", "hiking", "mountain_hiking", "demanding_mountain_hiking",
  "alpine_hiking", "demanding_alpine_hiking", "difficult_alpine_hiking"
]);

export const OSM_TRAIL_VISIBILITY_VALUES = Object.freeze([
  "excellent", "good", "intermediate", "bad", "horrible", "no"
]);

const POSITIVE_ACCESS_VALUES = new Set([
  "yes", "permissive", "designated", "destination"
]);
const RESTRICTED_ACCESS_VALUES = new Set([
  "private", "customers", "delivery", "agricultural", "forestry", "use_sidepath"
]);

export class OsmProjectionError extends Error {
  constructor(code, options = {}) {
    super(code);
    this.name = "OsmProjectionError";
    this.code = boundedFailureCode(code);
    if (options.cause) this.cause = options.cause;
  }
}

export function canonicalCategoryForOutdoorEvidence(category) {
  return CANONICAL_CATEGORY_BY_EVIDENCE_CATEGORY[category];
}

export function isRecognizedSacScale(value) {
  return OSM_SAC_SCALE_VALUES.includes(normalized(value));
}

export function isRecognizedTrailVisibility(value) {
  return OSM_TRAIL_VISIBILITY_VALUES.includes(normalized(value));
}

export function boundedMappedText(value, maximumLength) {
  if (typeof value !== "string" || !Number.isInteger(maximumLength) || maximumLength < 1) {
    return undefined;
  }
  const candidate = value.trim();
  if (!candidate || candidate.length > maximumLength || hasControlCharacter(candidate)) {
    return undefined;
  }
  return candidate;
}

export function mappedAccessRestriction(segment = {}) {
  const footConditional = boundedMappedText(
    segment.footConditional ?? segment.foot_conditional, 256
  );
  const accessConditional = boundedMappedText(
    segment.accessConditional ?? segment.access_conditional, 256
  );
  const seasonal = normalized(segment.seasonal ?? segment.seasonalTag ?? segment.seasonal_tag);
  if (footConditional || accessConditional || seasonal === "yes") return "conditional";

  const foot = normalized(segment.foot ?? segment.footTag ?? segment.foot_tag);
  const access = normalized(segment.access ?? segment.accessTag ?? segment.access_tag);
  const applicable = foot || access;
  if (applicable === "no") return "prohibited";
  if (applicable === "permit") return "permit_required";
  if (RESTRICTED_ACCESS_VALUES.has(applicable)) return "restricted";

  const permit = normalized(segment.permit ?? segment.permitTag ?? segment.permit_tag);
  if (permit === "yes" || permit === "required") return "permit_required";
  if (POSITIVE_ACCESS_VALUES.has(applicable) || !applicable) return undefined;
  return undefined;
}

export function stableOsmIdentity(osmType, osmId) {
  if (!new Set(["node", "way", "relation"]).has(osmType)) {
    throw new OsmProjectionError("invalid_osm_identity");
  }
  const id = typeof osmId === "bigint" ? osmId.toString() : String(osmId ?? "");
  if (!/^[1-9]\d*$/.test(id)) throw new OsmProjectionError("invalid_osm_identity");
  return `${OSM_RESEARCH_SOURCE_KEY}:${osmType}:${id}`;
}

export function deterministicUuidV3(namespaceKey, identityKey) {
  if (typeof namespaceKey !== "string" || !namespaceKey ||
      typeof identityKey !== "string" || !identityKey) {
    throw new OsmProjectionError("invalid_deterministic_identity");
  }
  const digest = createHash("md5")
    .update(namespaceKey)
    .update("\u001f")
    .update(identityKey)
    .digest("hex");
  return [
    digest.slice(0, 8),
    digest.slice(8, 12),
    `3${digest.slice(13, 16)}`,
    `a${digest.slice(17, 20)}`,
    digest.slice(20, 32)
  ].join("-");
}

export function deterministicOsmEntityId(osmType, osmId) {
  return deterministicUuidV3("outdoor-research-entity", stableOsmIdentity(osmType, osmId));
}

export function projectionKey(input) {
  const fields = [
    OSM_RESEARCH_SOURCE_KEY,
    input?.regionId,
    input?.importId,
    input?.policyVersion,
    OSM_PROJECTION_ADAPTER_VERSION
  ];
  if (fields.some((value) => typeof value !== "string" || !value)) {
    throw new OsmProjectionError("invalid_projection_request");
  }
  return createHash("sha256").update(fields.join("\u001f")).digest("hex");
}

export function recognizedOsmProjectionPolicy(version) {
  if (!OSM_PROJECTION_POLICY_VERSIONS.includes(version)) return undefined;
  return Object.freeze({
    policyVersion: version,
    policySchemaVersion: OSM_PROJECTION_POLICY_SCHEMA_VERSION,
    adapterSchemaVersion: OSM_PROJECTION_ADAPTER_VERSION,
    maximumInputAgeDays: 14,
    normalizedFactsAllowed: true,
    derivedFeaturesAllowed: false,
    assertionScopes: OSM_ASSERTION_POLICY_SCOPES,
    relationshipScopes: OSM_RELATIONSHIP_POLICY_SCOPES
  });
}

export function strictUtcPolicyTimestamp(value, clock = () => new Date()) {
  const match = typeof value === "string"
    ? value.match(
      /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{3}))?Z$/
    )
    : null;
  if (!match) throw new OsmProjectionError("invalid_review_timestamp");
  const fields = match.slice(1, 7).map(Number);
  const milliseconds = match[7] === undefined ? 0 : Number(match[7]);
  const [year, month, day, hour, minute, second] = fields;
  const candidate = new Date(value);
  if (year < 1 || !Number.isFinite(candidate.getTime()) ||
      candidate.getUTCFullYear() !== year ||
      candidate.getUTCMonth() + 1 !== month ||
      candidate.getUTCDate() !== day ||
      candidate.getUTCHours() !== hour ||
      candidate.getUTCMinutes() !== minute ||
      candidate.getUTCSeconds() !== second ||
      candidate.getUTCMilliseconds() !== milliseconds) {
    throw new OsmProjectionError("invalid_review_timestamp");
  }
  let clockValue;
  try {
    clockValue = typeof clock === "function" ? clock() : clock;
  } catch {
    throw new OsmProjectionError("invalid_clock");
  }
  const now = clockValue instanceof Date
    ? new Date(clockValue.getTime())
    : new Date(clockValue);
  if (!Number.isFinite(now.getTime())) throw new OsmProjectionError("invalid_clock");
  if (candidate.getTime() > now.getTime()) {
    throw new OsmProjectionError("future_review_timestamp");
  }
  return candidate.toISOString();
}

export function validatedOsmProjectionAcquisition(input = {}) {
  const acquisitionChannel = input.acquisitionChannel ?? input.acquisition_channel;
  if (acquisitionChannel === null || acquisitionChannel === undefined) {
    throw new OsmProjectionError("acquisition_channel_missing");
  }
  if (!OSM_ACQUISITION_CHANNELS.includes(acquisitionChannel)) {
    throw new OsmProjectionError("unrecognized_acquisition_channel");
  }
  const inputFileSha256 = input.inputFileSha256 ?? input.input_file_sha256;
  if (inputFileSha256 === null || inputFileSha256 === undefined) {
    throw new OsmProjectionError("input_file_sha256_missing");
  }
  if (typeof inputFileSha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(inputFileSha256)) {
    throw new OsmProjectionError("input_file_sha256_invalid");
  }
  const sourceDatasetName =
    input.sourceDatasetName ?? input.source_dataset_name;
  const sourceIdentifier = input.sourceIdentifier ?? input.source_identifier;
  if (!strictProvenanceText(sourceDatasetName, 160) ||
      !strictProvenanceText(sourceIdentifier, 500)) {
    throw new OsmProjectionError("source_dataset_provenance_missing");
  }
  for (const timestamp of [
    input.sourceDataAt ?? input.source_data_at,
    input.retrievedAt ?? input.retrieved_at,
    input.importedAt ?? input.imported_at
  ]) {
    if (timestamp === null || timestamp === undefined) {
      throw new OsmProjectionError("source_timing_unavailable");
    }
  }

  const sourceChecksumAlgorithm =
    input.sourceChecksumAlgorithm ?? input.source_checksum_algorithm;
  const sourceChecksum = input.sourceChecksum ?? input.source_checksum;
  const sourceChecksumVerifiedAt =
    input.sourceChecksumVerifiedAt ?? input.source_checksum_verified_at;
  if (acquisitionChannel === "geofabrik_regional_extract" &&
      (sourceChecksumAlgorithm === null || sourceChecksumAlgorithm === undefined ||
       sourceChecksum === null || sourceChecksum === undefined)) {
    throw new OsmProjectionError("geofabrik_checksum_missing");
  }
  const checksumParts = [
    sourceChecksumAlgorithm, sourceChecksum, sourceChecksumVerifiedAt
  ];
  const checksumPartCount = checksumParts.filter(
    (value) => value !== null && value !== undefined
  ).length;
  if (checksumPartCount !== 0 && checksumPartCount !== checksumParts.length) {
    if (sourceChecksumVerifiedAt === null || sourceChecksumVerifiedAt === undefined) {
      throw new OsmProjectionError("checksum_verification_missing");
    }
    throw new OsmProjectionError("source_checksum_invalid");
  }
  if (checksumPartCount === checksumParts.length) {
    const checksumPattern = sourceChecksumAlgorithm === "md5"
      ? /^[a-f0-9]{32}$/
      : sourceChecksumAlgorithm === "sha256"
        ? /^[a-f0-9]{64}$/
        : undefined;
    if (!checksumPattern?.test(sourceChecksum)) {
      throw new OsmProjectionError("source_checksum_invalid");
    }
    const verifiedAt = sourceChecksumVerifiedAt instanceof Date
      ? new Date(sourceChecksumVerifiedAt.getTime())
      : new Date(sourceChecksumVerifiedAt);
    if (!Number.isFinite(verifiedAt.getTime())) {
      throw new OsmProjectionError("checksum_verification_invalid");
    }
  }
  if (acquisitionChannel === "geofabrik_regional_extract" &&
      checksumPartCount !== checksumParts.length) {
    throw new OsmProjectionError("checksum_verification_missing");
  }
  return Object.freeze({
    acquisitionChannel,
    sourceDatasetName,
    sourceIdentifier,
    sourceChecksumAlgorithm: sourceChecksumAlgorithm ?? null,
    sourceChecksum: sourceChecksum ?? null,
    sourceChecksumVerifiedAt: sourceChecksumVerifiedAt ?? null,
    inputFileSha256
  });
}

export function canonicalScopeKey(scope) {
  return `${scope.predicate}\u001f${scope.entityCategory}`;
}

export function canonicalRelationshipScopeKey(scope) {
  return [
    scope.relationshipType,
    scope.subjectEntityCategory,
    scope.objectEntityCategory
  ].join("\u001f");
}

export function exactScopeSetMatches(actualScopes, expectedScopes = OSM_ASSERTION_POLICY_SCOPES) {
  if (!Array.isArray(actualScopes)) return false;
  const actual = actualScopes.map(canonicalScopeKey).sort();
  const expected = expectedScopes.map(canonicalScopeKey).sort();
  return actual.length === expected.length &&
    actual.every((value, index) => value === expected[index]);
}

export function exactRelationshipScopeSetMatches(
  actualScopes,
  expectedScopes = OSM_RELATIONSHIP_POLICY_SCOPES
) {
  if (!Array.isArray(actualScopes)) return false;
  const actual = actualScopes.map(canonicalRelationshipScopeKey).sort();
  const expected = expectedScopes.map(canonicalRelationshipScopeKey).sort();
  return actual.length === expected.length &&
    actual.every((value, index) => value === expected[index]);
}

function compareScopes(left, right) {
  return canonicalScopeKey(left).localeCompare(canonicalScopeKey(right));
}

function normalized(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function hasControlCharacter(value) {
  return /[\u0000-\u001f\u007f]/.test(value);
}

function strictProvenanceText(value, maximumLength) {
  return typeof value === "string" &&
    boundedMappedText(value, maximumLength) === value;
}

function boundedFailureCode(code) {
  if (typeof code !== "string" || !/^[a-z0-9_]{1,80}$/.test(code)) {
    return "projection_failed";
  }
  return code;
}
