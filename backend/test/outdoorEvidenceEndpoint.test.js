import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createOutdoorEvidenceEndpoint } from "../src/outdoorEvidence/outdoorEvidenceEndpoint.js";
import { outdoorEvidenceError } from "../src/outdoorEvidence/outdoorEvidenceErrors.js";
import { outdoorEvidenceRequest } from "./outdoorEvidenceTestSupport.js";

describe("outdoor evidence endpoint", () => {
  it("uses weighted route-session authorization and releases its lease", async () => {
    let authorizationContext;
    let releases = 0;
    const endpoint = createOutdoorEvidenceEndpoint({
      env: {
        NODE_ENV: "production",
        OUTDOOR_EVIDENCE_PROVIDER_ENABLED: "true",
        OUTDOOR_EVIDENCE_REQUEST_COST: "4"
      },
      authorizer: { async authorize(context) {
        authorizationContext = context;
        return {
          authorized: true,
          rateLimitKey: "installation",
          limitsConsumed: true,
          async release() { releases += 1; }
        };
      } },
      service: { async corridor(request) {
        return {
          evidenceStatus: "known",
          regions: [{ id: "harz-v1" }],
          routeFingerprint: request.routeFingerprint
        };
      } }
    });
    const result = await endpoint(outdoorEvidenceRequest(), { headers: { authorization: "private" } });
    assert.equal(result.statusCode, 200);
    assert.equal(authorizationContext.cost, 4);
    assert.equal("body" in authorizationContext, false);
    assert.equal("geometry" in authorizationContext, false);
    assert.equal(releases, 1);
  });

  it("releases authorization on query failure and cancellation", async () => {
    for (const error of [
      outdoorEvidenceError("evidence_timed_out"),
      outdoorEvidenceError("request_cancelled")
    ]) {
      let releases = 0;
      const endpoint = createOutdoorEvidenceEndpoint({
        env: { NODE_ENV: "test", OUTDOOR_EVIDENCE_PROVIDER_ENABLED: "true" },
        authorizer: { async authorize() {
          return {
            authorized: true, rateLimitKey: "test", limitsConsumed: true,
            async release() { releases += 1; }
          };
        } },
        service: { async corridor() { throw error; } }
      });
      const result = await endpoint(outdoorEvidenceRequest());
      assert.equal(result.payload.error.code, error.code);
      assert.equal(releases, 1);
    }
  });

  it("fails closed in production without durable authorization", async () => {
    const endpoint = createOutdoorEvidenceEndpoint({
      env: { NODE_ENV: "production", OUTDOOR_EVIDENCE_PROVIDER_ENABLED: "true" },
      service: { async corridor() { assert.fail("service called"); } }
    });
    const result = await endpoint(outdoorEvidenceRequest());
    assert.notEqual(result.statusCode, 200);
  });

  it("logs safe aggregate metadata only", async () => {
    const logs = [];
    const request = outdoorEvidenceRequest({ routeFingerprint: "sensitive-fingerprint" });
    const endpoint = createOutdoorEvidenceEndpoint({
      env: { NODE_ENV: "test", OUTDOOR_EVIDENCE_PROVIDER_ENABLED: "true" },
      authorizer: { async authorize() {
        return { authorized: true, rateLimitKey: "test", limitsConsumed: true };
      } },
      service: { async corridor() {
        return {
          evidenceStatus: "known",
          regions: [{ id: "harz-v1" }, { id: "innsbruck-alps-v1" }]
        };
      } },
      logger: { info(entry) { logs.push(entry); } },
      now: (() => { let time = 100; return () => time++; })()
    });
    await endpoint(request);
    const serialized = JSON.stringify(logs);
    assert.equal(serialized.includes("51.8"), false);
    assert.equal(serialized.includes("10.61"), false);
    assert.equal(serialized.includes("sensitive-fingerprint"), false);
    assert.equal(serialized.includes("authorization"), false);
    assert.equal(logs[0].regions, "harz-v1,innsbruck-alps-v1");
    assert.equal(logs[0].pointCountBucket, "2_to_25");
  });

  it("returns allowlisted errors without upstream details", async () => {
    const secret = "postgresql://secret@example.invalid/private";
    const endpoint = createOutdoorEvidenceEndpoint({
      env: { NODE_ENV: "test", OUTDOOR_EVIDENCE_PROVIDER_ENABLED: "true" },
      authorizer: { async authorize() {
        return { authorized: true, rateLimitKey: "test", limitsConsumed: true };
      } },
      service: { async corridor() { throw new Error(secret); } }
    });
    const result = await endpoint(outdoorEvidenceRequest());
    assert.equal(result.statusCode, 503);
    assert.equal(result.payload.error.code, "evidence_unavailable");
    assert.equal(JSON.stringify(result).includes(secret), false);
  });

  it("keeps the provider disabled unless the environment flag is explicitly true", async () => {
    for (const value of [undefined, "", "false", "0", "enabled", "2"]) {
      const endpoint = createOutdoorEvidenceEndpoint({
        env: { NODE_ENV: "test", OUTDOOR_EVIDENCE_PROVIDER_ENABLED: value },
        authorizer: { async authorize() { assert.fail("authorization must remain disabled"); } },
        service: { async corridor() { assert.fail("service must remain disabled"); } }
      });
      const result = await endpoint(outdoorEvidenceRequest());
      assert.equal(result.statusCode, 503);
      assert.equal(result.payload.error.code, "evidence_unavailable");
    }
  });
});
