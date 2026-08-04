import {
  OUTDOOR_ADVENTURE_ORCHESTRATION_POLICY_V1,
  outdoorAdventurePlanningEnabled
} from "./orchestrationPolicy.js";

export const OUTDOOR_ADVENTURE_ORCHESTRATION_POLICY_V2 = deepFreeze({
  schemaVersion: 2,
  policyVersion: "outdoor-adventure-orchestration-v2",
  sourceIntentSchemaVersion: 1,
  limits: { ...OUTDOOR_ADVENTURE_ORCHESTRATION_POLICY_V1.limits }
});

export function routableHighlightAccessEnabled(env = process.env) {
  const value = env?.OUTDOOR_ROUTABLE_HIGHLIGHT_ACCESS_ENABLED;
  return outdoorAdventurePlanningEnabled(env) &&
    typeof value === "string" &&
    ["true", "yes", "1"].includes(value.trim().toLowerCase());
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}
