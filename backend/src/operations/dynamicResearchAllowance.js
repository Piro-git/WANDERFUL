// A rollout allowance expires independently of process lifetime and daily buckets.
// This is an admission bound, not a provider currency meter.
export const MAXIMUM_ALLOWANCE_DURATION_MS = 24 * 60 * 60 * 1000;

export function dynamicResearchAllowanceExpiry(env, now = Date.now()) {
  if (env.DYNAMIC_RESEARCH_ENABLED !== "true") return undefined;
  const value = env.DYNAMIC_RESEARCH_BUDGET_EXPIRES_AT;
  const expiry = typeof value === "string" ? Date.parse(value) : NaN;
  if (!Number.isFinite(now) || !Number.isFinite(expiry) ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) ||
      new Date(expiry).toISOString() !== value ||
      expiry <= now || expiry - now > MAXIMUM_ALLOWANCE_DURATION_MS) {
    throw new TypeError("dynamic_research_allowance_unavailable");
  }
  return expiry;
}

export function assertDynamicResearchAllowance(env, { now = Date.now(), leaseTtlMs = 0 } = {}) {
  const expiry = dynamicResearchAllowanceExpiry(env, now);
  if (expiry !== undefined && (!Number.isFinite(leaseTtlMs) || leaseTtlMs < 0 ||
      now + leaseTtlMs >= expiry)) {
    throw new TypeError("dynamic_research_allowance_unavailable");
  }
}
