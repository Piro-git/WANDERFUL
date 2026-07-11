import { randomUUID } from "node:crypto";
import { appAttestError } from "./appAttestErrors.js";
import { hashOpaqueValue } from "./clientData.js";

/**
 * Production adapters must implement every method below with shared, durable,
 * transactional storage. The compare-and-set operations are security boundaries,
 * not best-effort cache operations.
 */
export class AppAttestRepository {
  isDurable = false;

  async createChallenge(_record) { unavailable(); }
  async consumeChallenge(_input) { unavailable(); }
  async consumeRegistrationAttempt(_input) { unavailable(); }
  async consumeRouteSessionAttempt(_input) { unavailable(); }
  async registerKey(_record) { unavailable(); }
  async findRegisteredKey(_input) { unavailable(); }
  async updateAssertionCounter(_input) { unavailable(); }
  async createRouteSession(_record) { unavailable(); }
  async consumeRouteAccess(_input) { unavailable(); }
  async releaseRouteLease(_leaseId) { unavailable(); }
}

/**
 * Unit-test and explicitly opted-in local-development adapter only.
 * JavaScript executes each mutation below without awaiting, so each compare and
 * mutation is one event-loop turn. This is not shared across processes or hosts.
 */
export class InMemoryAppAttestRepository extends AppAttestRepository {
  constructor(options = {}) {
    super();
    this.isDurable = false;
    this.now = options.now ?? Date.now;
    this.maximumEntries = positiveInteger(options.maximumEntries, 10_000);
    this.challenges = new Map();
    this.keys = new Map();
    this.sessions = new Map();
    this.rateWindows = new Map();
    this.routeLeases = new Map();
    this.globalActiveByScope = new Map();
  }

  async createChallenge(record) {
    const now = this.now();
    this.prune(now);
    this.consumeWindow({
      key: `challenge:${hashOpaqueValue(record.edgeIdentity)}`,
      cost: 1,
      maximumCost: record.edgeMaximum,
      windowMs: record.edgeWindowMs,
      now
    });
    if (this.challenges.has(record.id)) unavailable();
    this.challenges.set(record.id, {
      id: record.id,
      purpose: record.purpose,
      challenge: Buffer.from(record.challenge),
      keyIdHash: record.keyIdHash,
      expiresAt: record.expiresAt,
      consumedAt: undefined
    });
    this.evictOverflow(this.challenges);
  }

  async consumeChallenge({ id, purpose, keyIdHash }) {
    const now = this.now();
    const challenge = this.challenges.get(id);
    if (!challenge || challenge.purpose !== purpose) {
      throw appAttestError("app_attest_invalid");
    }
    if (challenge.consumedAt !== undefined) {
      throw appAttestError("app_attest_challenge_reused");
    }
    if (challenge.expiresAt <= now) {
      challenge.consumedAt = now;
      throw appAttestError("app_attest_challenge_expired");
    }
    if (challenge.keyIdHash !== undefined && challenge.keyIdHash !== keyIdHash) {
      challenge.consumedAt = now;
      throw appAttestError("app_attest_invalid");
    }
    challenge.consumedAt = now;
    return Buffer.from(challenge.challenge);
  }

  async consumeRegistrationAttempt(input) {
    this.consumeOperationAttempt("registration", input);
  }

  async consumeRouteSessionAttempt(input) {
    this.consumeOperationAttempt("route-session", input);
  }

  async registerKey(record) {
    const key = registeredKeyMapKey(record.environment, record.keyIdHash);
    if (this.keys.has(key)) throw appAttestError("app_attest_invalid");
    const now = this.now();
    this.keys.set(key, {
      ...record,
      receipt: Buffer.from(record.receipt),
      createdAt: now,
      updatedAt: now
    });
    this.evictOverflow(this.keys);
  }

  async findRegisteredKey({ environment, keyIdHash }) {
    const value = this.keys.get(registeredKeyMapKey(environment, keyIdHash));
    if (!value) throw appAttestError("app_attest_not_registered");
    return { ...value, receipt: Buffer.from(value.receipt) };
  }

  async updateAssertionCounter({ environment, keyIdHash, previousCounter, newCounter, metadata }) {
    const key = registeredKeyMapKey(environment, keyIdHash);
    const value = this.keys.get(key);
    if (!value) throw appAttestError("app_attest_not_registered");
    if (
      value.counter !== previousCounter || !Number.isInteger(newCounter) ||
      newCounter <= value.counter
    ) {
      throw appAttestError("app_attest_counter_replayed");
    }
    value.counter = newCounter;
    value.validationCategory = metadata.validationCategory;
    value.bundleVersion = metadata.bundleVersion;
    value.updatedAt = this.now();
  }

  async createRouteSession(record) {
    if (this.sessions.has(record.tokenHash)) unavailable();
    this.sessions.set(record.tokenHash, {
      tokenHash: record.tokenHash,
      installationId: record.installationId,
      expiresAt: record.expiresAt,
      remainingCost: record.maximumCost,
      revokedAt: undefined,
      requestIds: new Set()
    });
    this.evictOverflow(this.sessions);
  }

  async consumeRouteAccess(input) {
    const now = this.now();
    const scope = input.scope === "intent" ? "intent" : "route";
    this.prune(now);
    const session = this.sessions.get(input.tokenHash);
    if (!session) throw appAttestError("route_session_invalid");
    if (session.expiresAt <= now) throw appAttestError("route_session_expired");
    if (session.revokedAt !== undefined) throw appAttestError("route_session_exhausted");
    if (session.requestIds.has(input.requestId)) throw appAttestError("request_replayed");
    if (!Number.isInteger(input.cost) || input.cost < 1 || session.remainingCost < input.cost) {
      session.revokedAt = now;
      throw appAttestError("route_session_exhausted");
    }
    if (!input.providerEnabled) throw appAttestError("authorization_unavailable");
    const activeCount = this.globalActiveByScope.get(scope) ?? 0;
    if (activeCount >= input.globalMaximumConcurrency) {
      throw appAttestError("app_attest_rate_limited", { retryAfterSeconds: 1 });
    }

    const installationWindow = this.previewWindow({
      key: `${scope}-installation:${session.installationId}`,
      cost: input.cost,
      maximumCost: input.installationMaximumCost,
      windowMs: input.installationWindowMs,
      now
    });
    const globalWindow = this.previewWindow({
      key: `${scope}-provider:global`,
      cost: input.cost,
      maximumCost: input.globalMaximumCost,
      windowMs: input.globalWindowMs,
      now
    });
    const limited = [installationWindow, globalWindow].find((window) => !window.allowed);
    if (limited) {
      throw appAttestError("app_attest_rate_limited", {
        retryAfterSeconds: (limited.resetAt - now) / 1_000
      });
    }

    session.requestIds.add(input.requestId);
    session.remainingCost -= input.cost;
    if (session.remainingCost === 0) session.revokedAt = now;
    this.commitWindow(installationWindow);
    this.commitWindow(globalWindow);
    this.globalActiveByScope.set(scope, activeCount + 1);
    const leaseId = randomUUID();
    this.routeLeases.set(leaseId, scope);
    return {
      installationId: session.installationId,
      remainingCost: session.remainingCost,
      leaseId
    };
  }

  async releaseRouteLease(leaseId) {
    const scope = this.routeLeases.get(leaseId);
    if (!scope || !this.routeLeases.delete(leaseId)) return;
    const activeCount = this.globalActiveByScope.get(scope) ?? 0;
    this.globalActiveByScope.set(scope, Math.max(0, activeCount - 1));
  }

  consumeOperationAttempt(operation, input) {
    const now = this.now();
    this.consumeWindow({
      key: `${operation}:edge:${hashOpaqueValue(input.edgeIdentity)}`,
      cost: 1,
      maximumCost: input.edgeMaximum,
      windowMs: input.windowMs,
      now
    });
    this.consumeWindow({
      key: `${operation}:key:${input.keyIdHash}`,
      cost: 1,
      maximumCost: input.keyMaximum,
      windowMs: input.windowMs,
      now
    });
  }

  consumeWindow(input) {
    const preview = this.previewWindow(input);
    if (!preview.allowed) {
      throw appAttestError("app_attest_rate_limited", {
        retryAfterSeconds: (preview.resetAt - input.now) / 1_000
      });
    }
    this.commitWindow(preview);
  }

  previewWindow({ key, cost, maximumCost, windowMs, now }) {
    const existing = this.rateWindows.get(key);
    const current = !existing || existing.resetAt <= now
      ? { cost: 0, resetAt: now + windowMs }
      : existing;
    return {
      key,
      cost: current.cost + cost,
      resetAt: current.resetAt,
      allowed: current.cost + cost <= maximumCost
    };
  }

  commitWindow(window) {
    this.rateWindows.set(window.key, { cost: window.cost, resetAt: window.resetAt });
    this.evictOverflow(this.rateWindows);
  }

  prune(now) {
    for (const [key, challenge] of this.challenges) {
      if (challenge.expiresAt + 10 * 60_000 <= now) this.challenges.delete(key);
    }
    for (const [key, session] of this.sessions) {
      if (session.expiresAt + 10 * 60_000 <= now) this.sessions.delete(key);
    }
    for (const [key, window] of this.rateWindows) {
      if (window.resetAt <= now) this.rateWindows.delete(key);
    }
  }

  evictOverflow(map) {
    while (map.size > this.maximumEntries) map.delete(map.keys().next().value);
  }
}

function registeredKeyMapKey(environment, keyIdHash) {
  return `${environment}:${keyIdHash}`;
}

function positiveInteger(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function unavailable() {
  throw appAttestError("authorization_unavailable");
}
