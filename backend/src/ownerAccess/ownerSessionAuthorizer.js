import { assertRequestId, decodeBase64Url, hashOpaqueValue } from "../appAttest/clientData.js";
import { appAttestError } from "../appAttest/appAttestErrors.js";

export function createOwnerSessionAuthorizer({ repository, scope, limits }) {
  if (!repository?.isDurable || !["route","intent"].includes(scope)) throw new Error("Owner authorizer unavailable");
  return {
    async authorize({ headers = {}, cost, signal }) {
      if (signal?.aborted) throw appAttestError("authorization_unavailable");
      const value = headers.authorization;
      if (typeof value !== "string" || !value.startsWith("TrailMindRouteSession ")) throw appAttestError("route_session_invalid");
      const token = value.slice("TrailMindRouteSession ".length);
      decodeBase64Url(token,{ expectedLength:32,maxLength:64 });
      const requestId = assertRequestId(headers["x-trailmind-request-id"]);
      const tokenHash = hashOpaqueValue(token);
      const access = await repository.authorizeSession({ tokenHash, requestId, cost, scope,
        maximumConcurrency:limits.maximumConcurrency });
      return {
        authorized:true, limitsConsumed:true, rateLimitKey:access.installationId,
        remainingCost:access.remainingCost,
        async reserveProviderAttempt() {
          if (signal?.aborted) throw appAttestError("authorization_unavailable");
          if (!await repository.consumeProviderAttempt({ tokenHash,leaseId:access.leaseId,scope,
            ownerDailyMaximum:limits.ownerDailyMaximum,globalDailyMaximum:limits.globalDailyMaximum })) {
            throw appAttestError("app_attest_rate_limited");
          }
        },
        async release() { await repository.releaseLease(access.leaseId); }
      };
    }
  };
}
