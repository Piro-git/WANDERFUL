const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OPERATIONAL_REGION_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*-v[1-9]\d*$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;
const SUPPORTED_ACTIVITIES = Object.freeze(["hiking", "trail_running", "biking"]);
const BINDING_FIELDS = Object.freeze([
  "schemaVersion",
  "regionEntityId",
  "operationalRegionId",
  "displayName",
  "supportedActivities"
]);

export const OUTDOOR_RESEARCH_REGION_BINDING_SCHEMA_VERSION = 1;

const REVIEWED_REGION_BINDINGS = [
  {
    schemaVersion: 1,
    regionEntityId: "30000000-0000-4000-8000-000000000001",
    operationalRegionId: "innsbruck-alps-v1",
    displayName: "Innsbruck Alpine Pilot",
    supportedActivities: ["hiking", "trail_running", "biking"]
  },
  {
    schemaVersion: 1,
    regionEntityId: "30000000-0000-4000-8000-000000000002",
    operationalRegionId: "harz-v1",
    displayName: "Harz",
    supportedActivities: ["hiking", "trail_running", "biking"]
  }
];

export class OutdoorResearchRegionBindingError extends Error {
  constructor() {
    super("Outdoor research region bindings are invalid.");
    this.name = "OutdoorResearchRegionBindingError";
    this.code = "invalid_region_bindings";
  }
}

export function validateOutdoorResearchRegionBindingsV1(input) {
  try {
    if (!Array.isArray(input) || input.length < 1 || input.length > 16) invalid();
    const bindings = input.map((candidate) => validateBinding(candidate));
    assertUnique(bindings.map((binding) => binding.regionEntityId));
    assertUnique(bindings.map((binding) => binding.operationalRegionId));
    bindings.sort((left, right) =>
      left.regionEntityId.localeCompare(right.regionEntityId) ||
      left.operationalRegionId.localeCompare(right.operationalRegionId)
    );
    return deepFreeze(bindings);
  } catch (error) {
    if (error instanceof OutdoorResearchRegionBindingError) throw error;
    throw new OutdoorResearchRegionBindingError();
  }
}

export const OUTDOOR_RESEARCH_REGION_BINDINGS_V1 =
  validateOutdoorResearchRegionBindingsV1(REVIEWED_REGION_BINDINGS);

export function resolveOutdoorResearchRegionBindingV1(
  regionEntityId,
  activity,
  bindings = OUTDOOR_RESEARCH_REGION_BINDINGS_V1
) {
  const validatedBindings = bindings === OUTDOOR_RESEARCH_REGION_BINDINGS_V1
    ? bindings
    : validateOutdoorResearchRegionBindingsV1(bindings);
  if (typeof regionEntityId !== "string" || !UUID_PATTERN.test(regionEntityId) ||
      !SUPPORTED_ACTIVITIES.includes(activity)) {
    return undefined;
  }
  const normalizedRegionEntityId = regionEntityId.toLowerCase();
  return validatedBindings.find((binding) =>
    binding.regionEntityId === normalizedRegionEntityId &&
    binding.supportedActivities.includes(activity)
  );
}

function validateBinding(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) invalid();
  const keys = Object.keys(input);
  if (keys.length !== BINDING_FIELDS.length ||
      keys.some((key) => !BINDING_FIELDS.includes(key)) ||
      BINDING_FIELDS.some((key) => !Object.hasOwn(input, key))) {
    invalid();
  }
  if (input.schemaVersion !== OUTDOOR_RESEARCH_REGION_BINDING_SCHEMA_VERSION) invalid();
  if (typeof input.regionEntityId !== "string" ||
      !UUID_PATTERN.test(input.regionEntityId)) {
    invalid();
  }
  if (typeof input.operationalRegionId !== "string" ||
      !OPERATIONAL_REGION_ID_PATTERN.test(input.operationalRegionId) ||
      input.operationalRegionId.length > 80) {
    invalid();
  }
  if (typeof input.displayName !== "string" ||
      input.displayName !== input.displayName.trim() ||
      input.displayName.length < 1 ||
      input.displayName.length > 160 ||
      CONTROL_CHARACTER_PATTERN.test(input.displayName) ||
      input.displayName.includes("<") ||
      input.displayName.includes(">")) {
    invalid();
  }
  if (!Array.isArray(input.supportedActivities) ||
      input.supportedActivities.length < 1 ||
      input.supportedActivities.length > SUPPORTED_ACTIVITIES.length ||
      input.supportedActivities.some((activity) =>
        !SUPPORTED_ACTIVITIES.includes(activity)
      )) {
    invalid();
  }
  assertUnique(input.supportedActivities);
  return {
    schemaVersion: 1,
    regionEntityId: input.regionEntityId.toLowerCase(),
    operationalRegionId: input.operationalRegionId,
    displayName: input.displayName,
    supportedActivities: [...input.supportedActivities].sort((left, right) =>
      SUPPORTED_ACTIVITIES.indexOf(left) - SUPPORTED_ACTIVITIES.indexOf(right)
    )
  };
}

function assertUnique(values) {
  if (new Set(values).size !== values.length) invalid();
}

function invalid() {
  throw new OutdoorResearchRegionBindingError();
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}
