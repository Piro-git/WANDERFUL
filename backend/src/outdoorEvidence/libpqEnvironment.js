import { isAbsolute } from "node:path";

// Keep node-postgres and osm2pgsql on the same endpoint, including Unix sockets.
export function libpqEnvironment(url) {
  const host = url.searchParams.get("host") ?? url.hostname;
  if (url.searchParams.has("host") && (!isAbsolute(host) || host.includes(",") || host.includes("\0"))) {
    throw new Error("PostgreSQL host override must be one absolute Unix socket directory.");
  }
  return {
    PGHOST: host,
    PGPORT: url.port || "5432",
    PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGSSLMODE: url.searchParams.get("sslmode") || "prefer"
  };
}
