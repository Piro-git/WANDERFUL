import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ownerDatabaseURL } from "../src/ownerAccess/ownerDatabaseConfiguration.js";
import { canonicalOwnerOrigin } from "../src/ownerAccess/ownerAccessEndpoint.js";

// Presence/shape preflight only: does not connect, read file contents, or call providers.
// The owner startup remains responsible for exact limits, TLS and database admission.
export async function inspectOwnerDeployment(env = process.env, options = {}) {
  const issues = [];
  const readable = options.access ?? ((path) => access(path, constants.R_OK));
  if (env.NODE_ENV !== "production") issues.push("production_environment_required");
  if (env.OWNER_ACCESS_ENABLED !== "true") issues.push("owner_access_not_enabled");
  try { canonicalOwnerOrigin(env.OWNER_ACCESS_ORIGIN); }
  catch { issues.push("stable_https_origin_required"); }
  try { ownerDatabaseURL(env); }
  catch { issues.push("database_connection_required"); }
  const ca = env.OWNER_ACCESS_DATABASE_CA_FILE;
  if (typeof ca !== "string" || !ca.startsWith("/etc/secrets/") || !ca.endsWith(".crt") || ca.includes("..")) {
    issues.push("database_ca_file_required");
  } else {
    try { await readable(ca); } catch { issues.push("database_ca_file_unreadable"); }
  }
  for (const key of ["OWNER_ACCESS_ROUTE_DAILY_LIMIT", "OWNER_ACCESS_INTENT_DAILY_LIMIT",
    "OWNER_ACCESS_GLOBAL_ROUTE_DAILY_LIMIT", "OWNER_ACCESS_GLOBAL_INTENT_DAILY_LIMIT"]) {
    if (!/^[1-9][0-9]*$/.test(env[key] ?? "") || Number(env[key]) > 100) issues.push(`${key.toLowerCase()}_required`);
  }
  if (!["1", "2"].includes(env.OWNER_ACCESS_MAX_CONCURRENCY)) issues.push("bounded_concurrency_required");
  if (env.AI_PROVIDER !== "google") issues.push("google_provider_required");
  if (!/^gemini-[a-z0-9.-]+$/.test(env.GOOGLE_MODEL ?? "")) issues.push("google_model_required");
  for (const key of ["GOOGLE_API_KEY", "GRAPHHOPPER_API_KEY"]) {
    if (typeof env[key] !== "string" || !env[key].trim()) issues.push(`${key.toLowerCase()}_required`);
  }
  return { readyForRuntimeAdmission: issues.length === 0, issues,
    liveDatabaseVerified: false, providersCalled: false };
}

if (typeof process.argv[1] === "string" && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await inspectOwnerDeployment();
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = result.readyForRuntimeAdmission ? 0 : 1;
}
