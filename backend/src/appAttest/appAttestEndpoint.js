import { randomBytes } from "node:crypto";
import { appAttestError, appAttestErrorResult } from "./appAttestErrors.js";
import {
  canonicalRouteSessionClientData,
  decodeBase64Url,
  encodeBase64Url,
  hashOpaqueValue,
  installationIdentity,
  requiredOpaqueString,
  sha256
} from "./clientData.js";

const PURPOSES = new Set(["registration", "routeSession"]);

export function createAppAttestEndpoint(options) {
  const repository = options?.repository;
  const verifier = options?.verifier;
  const env = options?.env ?? process.env;
  const now = options?.now ?? Date.now;
  const random = options?.randomBytes ?? randomBytes;
  const configuration = endpointConfiguration(env);
  if (!repository || !verifier) return unavailableEndpoint;
  if (env.NODE_ENV === "production" && repository.isDurable !== true) return unavailableEndpoint;

  return async function appAttestEndpoint(path, body, context = {}) {
    try {
      switch (path) {
      case "/api/app-attest/challenge":
        return await createChallenge(body, context);
      case "/api/app-attest/register":
        return await register(body, context);
      case "/api/app-attest/route-session":
        return await createRouteSession(body, context);
      default:
        return { statusCode: 404, payload: { error: "Not found" } };
      }
    } catch (error) {
      return appAttestErrorResult(error);
    }
  };

  async function createChallenge(body, context) {
    const expectedFields = body?.purpose === "routeSession" ? ["purpose", "keyId"] : ["purpose"];
    assertBody(body, expectedFields);
    if (!PURPOSES.has(body.purpose)) invalid();
    const edgeIdentity = requiredEdgeIdentity(context.edgeIdentity);
    let keyIdHash;
    if (body.purpose === "routeSession") {
      const keyId = requiredOpaqueString(body.keyId, "keyId", 512);
      keyIdHash = hashOpaqueValue(keyId);
      await repository.consumeRouteSessionAttempt({
        edgeIdentity,
        keyIdHash,
        edgeMaximum: configuration.routeSessionEdgeMaximum,
        keyMaximum: configuration.routeSessionKeyMaximum,
        windowMs: configuration.routeSessionWindowMs
      });
      await repository.findRegisteredKey({
        environment: verifier.configuration.environment,
        keyIdHash
      });
    }

    const id = encodeBase64Url(random(24));
    const challenge = random(32);
    const expiresAt = now() + configuration.challengeTtlMs;
    await repository.createChallenge({
      id,
      purpose: body.purpose,
      challenge,
      keyIdHash,
      expiresAt,
      edgeIdentity,
      edgeMaximum: configuration.challengeEdgeMaximum,
      edgeWindowMs: configuration.challengeEdgeWindowMs
    });
    return {
      statusCode: 200,
      payload: { challengeId: id, challenge: encodeBase64Url(challenge), expiresAt: new Date(expiresAt).toISOString() }
    };
  }

  async function register(body, context) {
    assertBody(body, ["challengeId", "keyId", "attestationObject"]);
    const challengeId = requiredOpaqueString(body.challengeId, "challengeId", 128);
    const keyId = requiredOpaqueString(body.keyId, "keyId", 512);
    const keyIdHash = hashOpaqueValue(keyId);
    const edgeIdentity = requiredEdgeIdentity(context.edgeIdentity);
    await repository.consumeRegistrationAttempt({
      edgeIdentity,
      keyIdHash,
      edgeMaximum: configuration.registrationEdgeMaximum,
      keyMaximum: configuration.registrationKeyMaximum,
      windowMs: configuration.registrationWindowMs
    });
    const challenge = await repository.consumeChallenge({
      id: challengeId,
      purpose: "registration",
      keyIdHash
    });
    const verified = await verifier.verifyAttestation({
      attestationObject: decodeBase64Url(body.attestationObject, { maxLength: 192 * 1_024 }),
      keyId,
      clientDataHash: sha256(challenge),
      now: new Date(now())
    });
    await repository.registerKey({
      keyIdHash,
      installationId: installationIdentity(verified.environment, keyId),
      publicKeyPem: verified.publicKeyPem,
      receipt: verified.receipt,
      environment: verified.environment,
      counter: verified.counter,
      validationCategory: verified.validationCategory,
      bundleVersion: verified.bundleVersion
    });
    return { statusCode: 200, payload: { registered: true } };
  }

  async function createRouteSession(body, context) {
    assertBody(body, ["challengeId", "keyId", "sessionNonce", "assertionObject"]);
    const challengeId = requiredOpaqueString(body.challengeId, "challengeId", 128);
    const keyId = requiredOpaqueString(body.keyId, "keyId", 512);
    const keyIdHash = hashOpaqueValue(keyId);
    const sessionNonce = decodeBase64Url(body.sessionNonce, { expectedLength: 32, maxLength: 64 });
    const edgeIdentity = requiredEdgeIdentity(context.edgeIdentity);
    await repository.consumeRouteSessionAttempt({
      edgeIdentity,
      keyIdHash,
      edgeMaximum: configuration.routeSessionEdgeMaximum,
      keyMaximum: configuration.routeSessionKeyMaximum,
      windowMs: configuration.routeSessionWindowMs
    });
    const challenge = await repository.consumeChallenge({
      id: challengeId,
      purpose: "routeSession",
      keyIdHash
    });
    const key = await repository.findRegisteredKey({
      environment: verifier.configuration.environment,
      keyIdHash
    });
    const clientData = canonicalRouteSessionClientData({ challenge, keyId, sessionNonce });
    const verified = await verifier.verifyAssertion({
      assertionObject: decodeBase64Url(body.assertionObject, { maxLength: 16 * 1_024 }),
      publicKeyPem: key.publicKeyPem,
      clientData,
      previousCounter: key.counter
    });
    await repository.updateAssertionCounter({
      environment: key.environment,
      keyIdHash,
      previousCounter: key.counter,
      newCounter: verified.counter,
      metadata: verified
    });

    const token = encodeBase64Url(random(32));
    const expiresAt = now() + configuration.routeSessionTtlMs;
    await repository.createRouteSession({
      tokenHash: hashOpaqueValue(token),
      installationId: key.installationId,
      expiresAt,
      maximumCost: configuration.routeSessionMaximumCost
    });
    return {
      statusCode: 200,
      payload: {
        routeSessionToken: token,
        expiresAt: new Date(expiresAt).toISOString(),
        remainingCost: configuration.routeSessionMaximumCost
      }
    };
  }
}

export function endpointConfiguration(env = process.env) {
  return {
    challengeTtlMs: seconds(env.APP_ATTEST_CHALLENGE_TTL_SECONDS, 300, 30, 600) * 1_000,
    routeSessionTtlMs: seconds(env.APP_ATTEST_ROUTE_SESSION_TTL_SECONDS, 120, 30, 300) * 1_000,
    routeSessionMaximumCost: integer(env.APP_ATTEST_ROUTE_SESSION_MAX_COST, 12, 1, 100),
    challengeEdgeMaximum: integer(env.APP_ATTEST_CHALLENGE_EDGE_MAXIMUM, 20, 1, 1_000),
    challengeEdgeWindowMs: seconds(env.APP_ATTEST_CHALLENGE_EDGE_WINDOW_SECONDS, 300, 10, 3_600) * 1_000,
    registrationEdgeMaximum: integer(env.APP_ATTEST_REGISTRATION_EDGE_MAXIMUM, 10, 1, 1_000),
    registrationKeyMaximum: integer(env.APP_ATTEST_REGISTRATION_KEY_MAXIMUM, 5, 1, 100),
    registrationWindowMs: seconds(env.APP_ATTEST_REGISTRATION_WINDOW_SECONDS, 600, 10, 86_400) * 1_000,
    routeSessionEdgeMaximum: integer(env.APP_ATTEST_ROUTE_SESSION_EDGE_MAXIMUM, 30, 1, 1_000),
    routeSessionKeyMaximum: integer(env.APP_ATTEST_ROUTE_SESSION_KEY_MAXIMUM, 10, 1, 100),
    routeSessionWindowMs: seconds(env.APP_ATTEST_ROUTE_SESSION_WINDOW_SECONDS, 600, 10, 86_400) * 1_000
  };
}

async function unavailableEndpoint() {
  return appAttestErrorResult(appAttestError("authorization_unavailable"));
}

function assertBody(body, expectedFields) {
  if (!body || typeof body !== "object" || Array.isArray(body)) invalid();
  const fields = Object.keys(body);
  if (fields.length !== expectedFields.length || expectedFields.some((field) => !fields.includes(field))) invalid();
}

function requiredEdgeIdentity(value) {
  return requiredOpaqueString(value, "edge identity", 512);
}

function seconds(value, fallback, minimum, maximum) {
  return integer(value, fallback, minimum, maximum);
}

function integer(value, fallback, minimum, maximum) {
  if (value === undefined || value === "") return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) {
    throw appAttestError("authorization_unavailable");
  }
  return number;
}

function invalid() {
  throw appAttestError("app_attest_invalid");
}
