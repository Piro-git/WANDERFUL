import applicationHandler from "../src/server.js";
import { evaluateProductionConfiguration } from "../src/operations/productionConfiguration.js";

// Vercel invokes this module directly rather than the standalone service
// lifecycle. Keep the production admission gate at this edge so a partially
// configured deployment cannot accidentally accept protected requests.
const productionConfiguration = evaluateProductionConfiguration(process.env);

export default function vercelHandler(request, response) {
  // Health probes may add query parameters. Match only the path without
  // decoding or rewriting the URL passed to the protected application.
  const healthPath = typeof request.url === "string" ? request.url.split("?", 1)[0] : undefined;
  if (request.method === "GET" && isLivenessPath(healthPath)) {
    return sendJson(response, 200, { status: "live" });
  }
  if (request.method === "GET" && isReadinessPath(healthPath)) {
    return sendJson(response, productionConfiguration.decision === "ready" ? 200 : 503, {
      status: productionConfiguration.decision === "ready" ? "ready" : "not_ready"
    });
  }
  if (productionConfiguration.decision !== "ready") {
    return sendJson(response, 503, {
      error: {
        code: "service_unavailable",
        message: "The service is temporarily unavailable."
      }
    });
  }
  return applicationHandler(request, response);
}

function isLivenessPath(url) {
  return url === "/healthz" || url === "/health/live";
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
