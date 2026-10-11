// Dynamic research is deliberately a low-volume, durable release lane. The
// database-backed App Attest authorizer enforces the corresponding daily
// windows; this module makes an operator explicitly choose their cap before
// that authorizer is reachable. It is not a provider-currency meter.
import { DYNAMIC_LIMITS } from "../dynamicResearch/planner.js";

export const DYNAMIC_RESEARCH_REQUEST_COST = 12;
export const MAXIMUM_DAILY_DYNAMIC_RESEARCH_REQUESTS = 10;

export function dynamicResearchBudgetConfiguration(env) {
  if (env.DYNAMIC_RESEARCH_ENABLED !== "true") return undefined;

  const approvalId = env.DYNAMIC_RESEARCH_BUDGET_APPROVAL_ID;
  if (typeof approvalId !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{2,119}$/.test(approvalId)) {
    unavailable();
  }

  const dailyRequestLimit = boundedInteger(
    env.DYNAMIC_RESEARCH_DAILY_REQUEST_LIMIT,
    1,
    MAXIMUM_DAILY_DYNAMIC_RESEARCH_REQUESTS
  );
  const maximumCost = dailyRequestLimit * DYNAMIC_RESEARCH_REQUEST_COST;
  for (const key of ["ROUTE_GLOBAL_MAX_COST", "APP_ATTEST_INSTALLATION_MAX_COST"]) {
    const value = boundedInteger(env[key], DYNAMIC_RESEARCH_REQUEST_COST, maximumCost);
    // A partly chargeable request would make the advertised cap misleading.
    if (value % DYNAMIC_RESEARCH_REQUEST_COST !== 0) unavailable();
  }
  for (const key of ["ROUTE_GLOBAL_WINDOW_SECONDS", "APP_ATTEST_INSTALLATION_WINDOW_SECONDS"]) {
    if (env[key] !== "86400") unavailable();
  }

  return Object.freeze({
    approvalId,
    dailyRequestLimit,
    requestCost: DYNAMIC_RESEARCH_REQUEST_COST
  });
}

export function assertDynamicResearchBudget(env) {
  if (env.DYNAMIC_RESEARCH_ENABLED === "true") dynamicResearchExecutionLimits(env);
  return dynamicResearchBudgetConfiguration(env);
}

export function dynamicResearchExecutionLimits(env) {
  return Object.freeze({
    ...DYNAMIC_LIMITS,
    generations: boundedInteger(env.DYNAMIC_RESEARCH_MAX_GENERATIONS ?? DYNAMIC_LIMITS.generations,
      1, DYNAMIC_LIMITS.generations),
    currentInformationGenerations: boundedInteger(
      env.DYNAMIC_RESEARCH_MAX_CURRENT_INFORMATION_GENERATIONS ?? DYNAMIC_LIMITS.currentInformationGenerations,
      1, DYNAMIC_LIMITS.currentInformationGenerations)
  });
}

function boundedInteger(value, minimum, maximum) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) unavailable();
  return number;
}

function unavailable() {
  throw new TypeError("dynamic_research_budget_unavailable");
}
