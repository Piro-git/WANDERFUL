import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

// Evaluate the module-level production gate in a clean process. No developer
// secrets or local feature flags may make this fail-closed fixture ready.
function verifyRequests(cases) {
  const handlerURL = new URL("../api/index.js", import.meta.url).href;
  const script = `
    import assert from "node:assert/strict";
    import handler from ${JSON.stringify(handlerURL)};
    for (const { method, url, status, payload } of ${JSON.stringify(cases)}) {
      const request = { method, url };
      let actualStatus, headers, body;
      await handler(request, {
        writeHead(code, values) { actualStatus = code; headers = values; },
        end(value) { body = value; }
      });
      assert.equal(actualStatus, status, method + " " + url);
      assert.deepEqual(JSON.parse(body), payload, method + " " + url);
      assert.equal(headers["Cache-Control"], "no-store");
      assert.equal(headers["Content-Length"], Buffer.byteLength(body));
      assert.equal(request.url, url, "Health matching must not rewrite application URLs");
    }
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", script], {
    env: { NODE_ENV: "production" }, encoding: "utf8", timeout: 10_000
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
}

test("Vercel liveness accepts query strings on both exact health paths", () => {
  verifyRequests(["/healthz", "/health/live"].flatMap((path) =>
    ["", "?", "?probe=20260930&next=%2Fapi%2Froute"].map((query) => ({
      method: "GET", url: path + query, status: 200, payload: { status: "live" }
    }))));
});

test("Vercel readiness with queries still reports blocked production configuration", () => {
  verifyRequests(["/readyz", "/health/ready"].flatMap((path) =>
    ["", "?", "?probe=20260930"].map((query) => ({
      method: "GET", url: path + query, status: 503, payload: { status: "not_ready" }
    }))));
});

test("queries cannot bypass production admission on other paths or methods", () => {
  const denied = { error: { code: "service_unavailable", message: "The service is temporarily unavailable." } };
  const paths = ["/api/route?healthz", "/api/llm-plan-route?path=/healthz",
    "/api/app-attest/challenge?probe=1", "/healthz/", "/healthz-extra?probe=1",
    "/%68ealthz?probe=1", "/healthz#fragment", undefined];
  verifyRequests([
    ...paths.map((url) => ({ method: "GET", url, status: 503, payload: denied })),
    ...["POST", "HEAD"].map((method) => ({ method, url: "/healthz?probe=1", status: 503, payload: denied }))
  ]);
});
