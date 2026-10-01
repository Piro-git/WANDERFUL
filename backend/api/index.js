import pg from "pg";
import { createIntentRequestHandler } from "../src/server.js";
import { createAppAttestRuntime } from "../src/appAttest/appAttestRuntime.js";
import { PostgresAppAttestRepository } from "../src/appAttest/postgresAppAttestRepository.js";
import {
  evaluateProductionConfiguration,
  httpServerConfiguration
} from "../src/operations/productionConfiguration.js";
import {
  createOperationalState,
  createRuntimePools,
  probeRequiredPools
} from "../src/operations/serviceLifecycle.js";

// Vercel invokes this module directly rather than the standalone service
// lifecycle. Keep the production admission gate at this edge so a partially
// configured deployment cannot accidentally accept protected requests.
export function createVercelHandler(options = {}) {
  const env = options.env ?? process.env;
  const productionConfiguration = evaluateProductionConfiguration(env);
  const operationalState = createOperationalState();
  let runtime;
  let admission;

  async function admit() {
    if (productionConfiguration.decision !== "ready") return false;
    // Vercel can run concurrent requests in one instance. Share an in-flight
    // probe, but never cache a successful result across subsequent requests.
    if (admission) return admission;
    admission = (async () => {
      try {
        if (!runtime) {
          requireVerifiedDatabaseTLS(env);
          const owned = [];
          try {
            const pools = createRuntimePools(env, options.PoolClass ?? pg.Pool, owned,
              () => operationalState.setDependencyReady(false));
            const appAttestRepository = new PostgresAppAttestRepository({ pool: pools.appSecurity });
            const appAttestRuntime = createAppAttestRuntime({ env, appAttestRepository });
            if (!appAttestRuntime.verifier || appAttestRuntime.repository?.isDurable !== true) {
              throw new Error("production_runtime_unavailable");
            }
            const handler = (options.createApplicationHandler ?? createIntentRequestHandler)({
              env, operationalState, appAttestRuntime, appAttestRepository,
              accountPostgresPool: pools.appSecurity,
              postgresPool: pools.outdoorEvidence,
              outdoorResearchPool: pools.outdoorResearch,
              outdoorResearchCancellationPool: pools.outdoorResearchCancellation
            });
            runtime = { pools, handler };
          } catch (error) {
            await Promise.allSettled(owned.map((pool) => pool.end()));
            throw error;
          }
        }
        await probeRequiredPools(runtime.pools.required,
          httpServerConfiguration(env).headersTimeoutMs, options);
        operationalState.setDependencyReady(true);
        operationalState.markStarted();
        return true;
      } catch {
        operationalState.setDependencyReady(false);
        return false;
      }
    })();
    try {
      return await admission;
    } finally {
      admission = undefined;
    }
  }

  return async function vercelHandler(request, response) {
    // Health probes may add query parameters. Match only the path without
    // decoding or rewriting the URL passed to the protected application.
    const healthPath = typeof request.url === "string" ? request.url.split("?", 1)[0] : undefined;
    if (request.method === "GET" && isLivenessPath(healthPath)) {
      return sendJson(response, 200, { status: "live" });
    }
    const admitted = await admit();
    if (request.method === "GET" && isReadinessPath(healthPath)) {
      const ready = admitted && operationalState.isReady();
      return sendJson(response, ready ? 200 : 503, {
        status: ready ? "ready" : "not_ready"
      });
    }
    if (!admitted || !operationalState.isAccepting()) {
      return sendJson(response, 503, {
        error: {
          code: "service_unavailable",
          message: "The service is temporarily unavailable."
        }
      });
    }
    return runtime.handler(request, response);
  };
}

export default createVercelHandler();

function isLivenessPath(url) {
  return url === "/healthz" || url === "/health/live";
}

function requireVerifiedDatabaseTLS(env) {
  const url = new URL(env.APP_ATTEST_DATABASE_URL);
  const allowed = new Set(["sslmode", "sslrootcert"]);
  if (
    env.NODE_TLS_REJECT_UNAUTHORIZED === "0" ||
    url.searchParams.getAll("sslmode").length !== 1 ||
    url.searchParams.get("sslmode") !== "verify-full" ||
    url.searchParams.getAll("sslrootcert").length !== 1 ||
    !url.searchParams.get("sslrootcert")?.startsWith("/") ||
    [...url.searchParams.keys()].some((key) => !allowed.has(key))
  ) throw new Error("database_tls_configuration_invalid");
}

function isReadinessPath(url) {
  return url === "/readyz" || url === "/health/ready";
}

function sendJson(response, statusCode, payload) {
  const serialized = JSON.stringify(payload);
  response.writeHead(statusCode, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(serialized, "utf8"),
    "X-Content-Type-Options": "nosniff"
  });
  response.end(serialized);
}
