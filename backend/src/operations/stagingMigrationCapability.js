const CAPABILITY_LIFETIME_MILLISECONDS = 30_000;
const CAPABILITY_PURPOSES = new Set(["apply", "verify-noop"]);
const TARGET_PROJECT_REF = "mbvzwsrtqcrwhvykugcd";
const TARGET_POLICY_ID = "supabase-postgis-isolation-v2";
const capabilities = new WeakMap();

export function issueStagingPhase1V2MigrationCapability({
  projectRef,
  policyId,
  purpose,
  now = () => new Date()
}) {
  if (
    projectRef !== TARGET_PROJECT_REF ||
    policyId !== TARGET_POLICY_ID ||
    !CAPABILITY_PURPOSES.has(purpose)
  ) throw new Error("trailmind_supabase_v2_operator_context_issue_invalid");
  const issuedAt = exactTime(now());
  const capability = Object.freeze(Object.create(null));
  capabilities.set(capability, {
    projectRef,
    policyId,
    purpose,
    expiresAt: issuedAt + CAPABILITY_LIFETIME_MILLISECONDS,
    consumed: false
  });
  return capability;
}

export function consumeStagingPhase1V2MigrationCapability({
  capability,
  policyId,
  now = () => new Date()
}) {
  const state = capabilities.get(capability);
  const consumedAt = exactTime(now());
  if (
    !state ||
    state.consumed ||
    state.projectRef !== TARGET_PROJECT_REF ||
    state.policyId !== TARGET_POLICY_ID ||
    policyId !== TARGET_POLICY_ID ||
    consumedAt > state.expiresAt
  ) throw new Error("trailmind_supabase_v2_operator_context_invalid");
  state.consumed = true;
  return state.purpose;
}

function exactTime(value) {
  const date = value instanceof Date ? value : new Date(Number.NaN);
  if (Number.isNaN(date.getTime())) {
    throw new Error("trailmind_supabase_v2_operator_context_time_invalid");
  }
  return date.getTime();
}
