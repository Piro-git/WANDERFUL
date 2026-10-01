/** Validates shape only; callers must never log the returned credential-bearing URL. */
export function ownerDatabaseURL(env) {
  const url=new URL(env.OWNER_ACCESS_DATABASE_URL);
  const username=decodeURIComponent(url.username);
  const direct=username==="wanderful_owner_runtime";
  const project=env.OWNER_ACCESS_SUPABASE_PROJECT_REF;
  const pooler=typeof project==="string" && /^[a-z]{20}$/.test(project) &&
    username===`wanderful_owner_runtime.${project}` &&
    /^[a-z0-9-]+\.pooler\.supabase\.com$/.test(url.hostname) && url.port==="5432";
  if(!["postgres:","postgresql:"].includes(url.protocol) || !url.hostname || url.search || url.hash ||
      (!direct&&!pooler) || !url.password) throw new Error("Owner database configuration unavailable");
  return url;
}
