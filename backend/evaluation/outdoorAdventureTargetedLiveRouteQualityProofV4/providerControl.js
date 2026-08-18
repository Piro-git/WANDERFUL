import { randomUUID } from "node:crypto";
import { open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { createGraphHopperProvider } from "../../src/routing/graphHopperProvider.js";
import { routeError } from "../../src/routing/routeErrors.js";
import {
  V4_AUTHORIZATION_REFERENCE,
  V4_CASE_BINDINGS,
  V4_MAXIMUM_CONCURRENCY,
  V4_MAXIMUM_RETRY_AFTER_MILLISECONDS,
  V4_MINIMUM_CALL_START_SPACING_MILLISECONDS,
  V4_PROVIDER_CALL_LIMIT,
  V4ProofContractError
} from "./contract.js";

const CASE_IDS = V4_CASE_BINDINGS.map((item) => item.caseId);
const OUTCOMES = new Set([
  "reserved", "success", "failed", "timed_out", "cancelled"
]);
const SETTLED_OUTCOMES = new Set([
  "success", "failed", "timed_out", "cancelled"
]);
const SAFE_FAILURE_CODES = new Set([
  "configuration_missing", "flexible_mode_unavailable", "invalid_request",
  "request_cancelled", "route_not_found", "route_timed_out",
  "routing_rate_limited", "routing_unavailable"
]);
const IMMEDIATE_CIRCUIT_CODES = new Set([
  "configuration_missing", "routing_rate_limited", "routing_unavailable"
]);

export class V4ProviderLedger {
  constructor(path, {
    nowMilliseconds = Date.now,
    authorizationReference = V4_AUTHORIZATION_REFERENCE,
    ledgerNamespace = null,
    proofRunIdentityDigest = null,
    proofRunIdentityArtifactDigest = null
  } = {}) {
    if (typeof path !== "string" || path.length < 1 ||
        typeof nowMilliseconds !== "function" ||
        typeof authorizationReference !== "string" ||
        !/^[A-Z0-9_-]{10,160}$/.test(authorizationReference) ||
        (ledgerNamespace !== null && (
          typeof ledgerNamespace !== "string" ||
          !/^[a-z0-9][a-z0-9-]{9,159}$/.test(ledgerNamespace)
        )) ||
        ((proofRunIdentityDigest === null) !==
          (proofRunIdentityArtifactDigest === null)) ||
        (proofRunIdentityDigest !== null &&
          !/^[a-f0-9]{64}$/.test(proofRunIdentityDigest)) ||
        (proofRunIdentityArtifactDigest !== null &&
          !/^[a-f0-9]{64}$/.test(proofRunIdentityArtifactDigest))) {
      invalidLedger();
    }
    this.path = path;
    this.lockPath = `${path}.lock`;
    this.nowMilliseconds = nowMilliseconds;
    this.authorizationReference = authorizationReference;
    this.ledgerNamespace = ledgerNamespace;
    this.proofRunIdentityDigest = proofRunIdentityDigest;
    this.proofRunIdentityArtifactDigest = proofRunIdentityArtifactDigest;
    this.lockHandle = null;
    this.queue = Promise.resolve();
  }

  async initialize() {
    if (this.lockHandle !== null) invalidLedger();
    try {
      this.lockHandle = await open(this.lockPath, "wx", 0o600);
    } catch {
      invalidLedger();
    }
    try {
      await this.#read();
    } catch (error) {
      if (error?.code !== "ENOENT") {
        await this.close().catch(() => {});
        throw error;
      }
      await this.#write(emptyLedger({
        authorizationReference: this.authorizationReference,
        ledgerNamespace: this.ledgerNamespace,
        proofRunIdentityDigest: this.proofRunIdentityDigest,
        proofRunIdentityArtifactDigest:
          this.proofRunIdentityArtifactDigest
      }));
    }
    return this.snapshot();
  }

  async reserve({ caseId, proposalOrdinal }) {
    return this.#mutate((ledger) => {
      if (!CASE_IDS.includes(caseId) ||
          !Number.isInteger(proposalOrdinal) ||
          proposalOrdinal < 1 || proposalOrdinal > 3) invalidLedger();
      if (ledger.calls.length >= V4_PROVIDER_CALL_LIMIT) {
        throw new V4ProofContractError("provider_call_limit_reached");
      }
      if (ledger.calls.some((call) => call.outcome === "reserved")) {
        throw new V4ProofContractError("provider_concurrency_exceeded");
      }
      const priorCaseIndex = ledger.calls.length === 0
        ? 0 : CASE_IDS.indexOf(ledger.calls.at(-1).caseId);
      const caseIndex = CASE_IDS.indexOf(caseId);
      if (caseIndex < priorCaseIndex ||
          ledger.calls.some((call) =>
            call.caseId === caseId && call.proposalOrdinal === proposalOrdinal
          )) invalidLedger();
      const sequence = ledger.calls.length + 1;
      ledger.calls.push({
        sequence,
        caseId,
        proposalOrdinal,
        reservationTimeBucket: coarseTimeBucket(this.nowMilliseconds()),
        outcome: "reserved",
        durationBucket: null,
        failureCode: null,
        controlledPostSuccessFailure: false
      });
      return sequence;
    });
  }

  async settle(sequence, { outcome, durationMilliseconds, failureCode = null }) {
    return this.#mutate((ledger) => {
      const call = ledger.calls.find((item) => item.sequence === sequence);
      if (!call || call.outcome !== "reserved" ||
          !SETTLED_OUTCOMES.has(outcome) ||
          !Number.isFinite(durationMilliseconds) || durationMilliseconds < 0 ||
          (outcome === "success" && failureCode !== null) ||
          (outcome !== "success" && !SAFE_FAILURE_CODES.has(failureCode))) {
        invalidLedger();
      }
      call.outcome = outcome;
      call.durationBucket = durationBucket(durationMilliseconds);
      call.failureCode = failureCode;
      return structuredClone(call);
    });
  }

  async markControlledPostSuccessFailure(sequence) {
    return this.#mutate((ledger) => {
      const call = ledger.calls.find((item) => item.sequence === sequence);
      if (!call || call.outcome !== "success" ||
          call.controlledPostSuccessFailure === true) {
        throw new V4ProofContractError("controlled_failure_before_success");
      }
      call.controlledPostSuccessFailure = true;
      return structuredClone(call);
    });
  }

  async snapshot() {
    await this.queue;
    return this.#read();
  }

  async close() {
    await this.queue;
    if (this.lockHandle === null) return;
    const handle = this.lockHandle;
    this.lockHandle = null;
    let failure = null;
    try { await handle.close(); } catch (error) { failure = error; }
    try { await unlink(this.lockPath); } catch (error) { failure ??= error; }
    if (failure) invalidLedger();
  }

  #mutate(operation) {
    const scheduled = this.queue.then(async () => {
      const ledger = await this.#read();
      const result = operation(ledger);
      validateV4ProviderLedger(ledger, {
        authorizationReference: this.authorizationReference,
        ledgerNamespace: this.ledgerNamespace,
        proofRunIdentityDigest: this.proofRunIdentityDigest,
        proofRunIdentityArtifactDigest:
          this.proofRunIdentityArtifactDigest
      });
      await this.#write(ledger);
      return result;
    });
    this.queue = scheduled.catch(() => {});
    return scheduled;
  }

  async #read() {
    let value;
    try {
      value = JSON.parse(await readFile(this.path, "utf8"));
    } catch (error) {
      if (error?.code === "ENOENT") throw error;
      invalidLedger();
    }
    validateV4ProviderLedger(value, {
      authorizationReference: this.authorizationReference,
      ledgerNamespace: this.ledgerNamespace,
      proofRunIdentityDigest: this.proofRunIdentityDigest,
      proofRunIdentityArtifactDigest:
        this.proofRunIdentityArtifactDigest
    });
    return value;
  }

  async #write(value) {
    const temporaryPath = `${this.path}.pending-${process.pid}-${randomUUID()}`;
    try {
      await writeFile(temporaryPath, `${JSON.stringify(value)}\n`, {
        encoding: "utf8", mode: 0o600, flag: "wx"
      });
      await rename(temporaryPath, this.path);
    } catch (error) {
      await unlink(temporaryPath).catch(() => {});
      throw new V4ProofContractError("invalid_provider_ledger", {
        cause: error
      });
    }
  }
}

export class V4ProviderScheduler {
  #admissions;
  #pendingAdmission;
  #activeAdmission;

  constructor({
    nowMilliseconds = Date.now,
    sleep = wait
  } = {}) {
    if (typeof nowMilliseconds !== "function" || typeof sleep !== "function") {
      throw new V4ProofContractError("invalid_provider_scheduler");
    }
    this.nowMilliseconds = nowMilliseconds;
    this.sleep = sleep;
    this.active = 0;
    this.maximumConcurrencyObserved = 0;
    this.lastCallStartMilliseconds = null;
    this.callStarts = [];
    this.nextEligibleAt = 0;
    this.stoppedCaseIds = new Set();
    this.circuitOpened = false;
    this.circuitStopHonored = true;
    this.probesAfterCircuitOpen = 0;
    this.invalidRetryAfterObserved = false;
    this.invalidRetryAfterStoppedCase = false;
    this.consecutiveImmediateFailureCode = null;
    this.consecutiveImmediateFailureCount = 0;
    this.#admissions = new WeakMap();
    this.#pendingAdmission = null;
    this.#activeAdmission = null;
  }

  async beforeCall(caseId, signal) {
    if (!CASE_IDS.includes(caseId)) {
      throw new V4ProofContractError("invalid_provider_scheduler");
    }
    if (this.circuitOpened) {
      throw new V4ProofContractError("provider_circuit_open");
    }
    if (this.stoppedCaseIds.has(caseId)) {
      throw new V4ProofContractError("provider_case_stopped");
    }
    if (this.active >= V4_MAXIMUM_CONCURRENCY ||
        this.#pendingAdmission !== null || this.#activeAdmission !== null) {
      throw new V4ProofContractError("provider_concurrency_exceeded");
    }
    const admission = Object.freeze({});
    this.#admissions.set(admission, { caseId, state: "pending" });
    this.#pendingAdmission = admission;
    try {
      const delay = Math.max(0, this.nextEligibleAt - this.nowMilliseconds());
      if (delay > 0) await this.sleep(delay);
      if (signal?.aborted) throw new V4ProofContractError("cancelled");
      if (this.circuitOpened || this.stoppedCaseIds.has(caseId)) {
        throw new V4ProofContractError("provider_batch_stopped");
      }
      const readyAt = this.nowMilliseconds();
      if (this.lastCallStartMilliseconds !== null &&
          readyAt - this.lastCallStartMilliseconds <
            V4_MINIMUM_CALL_START_SPACING_MILLISECONDS) {
        throw new V4ProofContractError("provider_spacing_violation");
      }
      return admission;
    } catch (error) {
      const record = this.#admissions.get(admission);
      record.state = "rejected";
      this.#pendingAdmission = null;
      throw error;
    }
  }

  commitAdmission(admission) {
    const record = this.#admissions.get(admission);
    if (!record || record.state !== "pending" ||
        this.#pendingAdmission !== admission ||
        this.#activeAdmission !== null || this.active !== 0) {
      invalidScheduler();
    }
    const startedAt = this.nowMilliseconds();
    if (this.lastCallStartMilliseconds !== null &&
        startedAt - this.lastCallStartMilliseconds <
          V4_MINIMUM_CALL_START_SPACING_MILLISECONDS) {
      invalidScheduler();
    }
    record.state = "active";
    this.#pendingAdmission = null;
    this.#activeAdmission = admission;
    this.active += 1;
    this.maximumConcurrencyObserved = Math.max(
      this.maximumConcurrencyObserved, this.active
    );
    this.lastCallStartMilliseconds = startedAt;
    this.callStarts.push(startedAt);
    this.nextEligibleAt = startedAt +
      V4_MINIMUM_CALL_START_SPACING_MILLISECONDS;
    return startedAt;
  }

  rollbackAdmission(admission) {
    const record = this.#admissions.get(admission);
    if (!record || record.state !== "pending" ||
        this.#pendingAdmission !== admission) {
      invalidScheduler();
    }
    record.state = "rolled_back";
    this.#pendingAdmission = null;
  }

  observe(admission, {
    caseId,
    outcome,
    failureCode,
    durationMilliseconds,
    retryAfterHeader
  }) {
    const record = this.#admissions.get(admission);
    if (!record || record.state !== "active" ||
        record.caseId !== caseId || this.#activeAdmission !== admission ||
        this.active !== 1 || !SETTLED_OUTCOMES.has(outcome) ||
        !Number.isFinite(durationMilliseconds) || durationMilliseconds < 0) {
      throw new V4ProofContractError("invalid_provider_scheduler");
    }
    record.state = "observed";
    this.#activeAdmission = null;
    this.active -= 1;
    if (outcome === "success") {
      this.consecutiveImmediateFailureCode = null;
      this.consecutiveImmediateFailureCount = 0;
      return;
    }
    const retryAfter = parseRetryAfterMillisecondsV4(retryAfterHeader);
    if (retryAfterHeader !== null && retryAfter === null) {
      this.invalidRetryAfterObserved = true;
      this.invalidRetryAfterStoppedCase = true;
      this.stoppedCaseIds.add(caseId);
    } else if (retryAfter !== null) {
      this.nextEligibleAt = Math.max(
        this.nextEligibleAt,
        this.nowMilliseconds() + retryAfter
      );
    }
    const immediate = outcome === "failed" &&
      durationMilliseconds < 1_000 &&
      IMMEDIATE_CIRCUIT_CODES.has(failureCode);
    if (!immediate) {
      this.consecutiveImmediateFailureCode = null;
      this.consecutiveImmediateFailureCount = 0;
      return;
    }
    if (this.consecutiveImmediateFailureCode === failureCode) {
      this.consecutiveImmediateFailureCount += 1;
    } else {
      this.consecutiveImmediateFailureCode = failureCode;
      this.consecutiveImmediateFailureCount = 1;
    }
    if (this.consecutiveImmediateFailureCount >= 2) {
      this.circuitOpened = true;
    }
  }

  receipt() {
    const spacings = this.callStarts.slice(1).map((start, index) =>
      start - this.callStarts[index]
    );
    return Object.freeze({
      maximumConcurrencyObserved: this.maximumConcurrencyObserved,
      minimumObservedStartSpacingMilliseconds:
        spacings.length === 0 ? null : Math.min(...spacings),
      circuitOpened: this.circuitOpened,
      circuitStopHonored: this.circuitStopHonored,
      probesAfterCircuitOpen: this.probesAfterCircuitOpen,
      invalidRetryAfterObserved: this.invalidRetryAfterObserved,
      invalidRetryAfterStoppedCase: this.invalidRetryAfterStoppedCase
    });
  }
}

export function createV4MeteredGraphHopperProvider({
  caseId,
  controlledFailureAfterFirstSuccess,
  env,
  ledger,
  scheduler,
  fetchImpl = globalThis.fetch
}) {
  if (!CASE_IDS.includes(caseId) || typeof controlledFailureAfterFirstSuccess !==
      "boolean" || !env || typeof ledger?.reserve !== "function" ||
      typeof scheduler?.beforeCall !== "function" ||
      typeof scheduler?.commitAdmission !== "function" ||
      typeof scheduler?.rollbackAdmission !== "function" ||
      typeof scheduler?.observe !== "function" ||
      typeof fetchImpl !== "function") {
    throw new V4ProofContractError("invalid_provider_dependencies");
  }
  let proposalOrdinal = 0;
  let controlledFailureInjected = false;
  return Object.freeze({
    async route(request, context = {}) {
      const ordinal = proposalOrdinal + 1;
      const admission = await scheduler.beforeCall(caseId, context.signal);
      let sequence;
      try {
        sequence = await ledger.reserve({
          caseId,
          proposalOrdinal: ordinal
        });
      } catch (error) {
        scheduler.rollbackAdmission(admission);
        throw error;
      }
      scheduler.commitAdmission(admission);
      proposalOrdinal = ordinal;
      const startedAt = performance.now();
      let retryAfterHeader = null;
      const provider = createGraphHopperProvider({
        env,
        fetchImpl: async (url, init) => {
          const response = await fetchImpl(url, init);
          const header = response?.headers?.get?.("retry-after");
          retryAfterHeader = typeof header === "string" ? header : null;
          return response;
        }
      });
      try {
        const result = await provider.route(request, context);
        const durationMilliseconds = performance.now() - startedAt;
        await ledger.settle(sequence, {
          outcome: "success", durationMilliseconds, failureCode: null
        });
        scheduler.observe(admission, {
          caseId, outcome: "success", failureCode: null,
          durationMilliseconds, retryAfterHeader
        });
        if (controlledFailureAfterFirstSuccess &&
            controlledFailureInjected === false) {
          await ledger.markControlledPostSuccessFailure(sequence);
          controlledFailureInjected = true;
          throw routeError("routing_unavailable");
        }
        return result;
      } catch (error) {
        const snapshot = await ledger.snapshot();
        const active = snapshot.calls.find((item) =>
          item.sequence === sequence && item.outcome === "reserved"
        );
        if (active) {
          const durationMilliseconds = performance.now() - startedAt;
          const outcome = providerOutcome(error, context.signal);
          const failureCode = safeFailureCode(error);
          await ledger.settle(sequence, {
            outcome, durationMilliseconds, failureCode
          });
          scheduler.observe(admission, {
            caseId, outcome, failureCode,
            durationMilliseconds, retryAfterHeader
          });
        }
        throw error;
      }
    }
  });
}

export function validateV4ProviderLedger(value, {
  authorizationReference = V4_AUTHORIZATION_REFERENCE,
  ledgerNamespace = null,
  proofRunIdentityDigest = null,
  proofRunIdentityArtifactDigest = null
} = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      value.schemaVersion !== 1 ||
      value.authorizationReference !== authorizationReference ||
      (ledgerNamespace === null
        ? value.ledgerNamespace !== undefined
        : value.ledgerNamespace !== ledgerNamespace) ||
      (proofRunIdentityDigest === null
        ? value.proofRunIdentityDigest !== undefined
        : value.proofRunIdentityDigest !== proofRunIdentityDigest) ||
      (proofRunIdentityArtifactDigest === null
        ? value.proofRunIdentityArtifactDigest !== undefined
        : value.proofRunIdentityArtifactDigest !==
          proofRunIdentityArtifactDigest) ||
      value.hardLimit !== V4_PROVIDER_CALL_LIMIT ||
      !Array.isArray(value.calls) ||
      value.calls.length > V4_PROVIDER_CALL_LIMIT) invalidLedger();
  let priorCaseIndex = 0;
  const proposalOrdinals = new Map();
  value.calls.forEach((call, index) => {
    const caseIndex = CASE_IDS.indexOf(call?.caseId);
    const expectedOrdinal = (proposalOrdinals.get(call?.caseId) ?? 0) + 1;
    if (!call || typeof call !== "object" || Array.isArray(call) ||
        call.sequence !== index + 1 || caseIndex < priorCaseIndex ||
        call.proposalOrdinal !== expectedOrdinal ||
        typeof call.reservationTimeBucket !== "string" ||
        !/^minute_[0-9]+$/.test(call.reservationTimeBucket) ||
        !OUTCOMES.has(call.outcome) ||
        ![null, "under_1s", "1s_to_4s", "5s_to_14s", "15s_to_29s",
          "30s_or_more"].includes(call.durationBucket) ||
        ![null, ...SAFE_FAILURE_CODES].includes(call.failureCode) ||
        typeof call.controlledPostSuccessFailure !== "boolean" ||
        (call.controlledPostSuccessFailure && call.outcome !== "success") ||
        (call.outcome === "reserved" &&
          (call.durationBucket !== null || call.failureCode !== null)) ||
        (call.outcome === "success" && call.failureCode !== null) ||
        (call.outcome !== "success" && call.outcome !== "reserved" &&
          call.failureCode === null)) invalidLedger();
    priorCaseIndex = caseIndex;
    proposalOrdinals.set(call.caseId, call.proposalOrdinal);
  });
  if (value.calls.filter((call) => call.outcome === "reserved").length > 1) {
    throw new V4ProofContractError("provider_concurrency_exceeded");
  }
  return true;
}

export function providerAccountingFromLedgerV4(
  ledger,
  schedulerReceipt,
  ledgerValidation = {}
) {
  validateV4ProviderLedger(ledger, ledgerValidation);
  const count = (outcome) => ledger.calls.filter((call) =>
    call.outcome === outcome
  ).length;
  const attempted = ledger.calls.length;
  return Object.freeze({
    hardLimit: V4_PROVIDER_CALL_LIMIT,
    maximumConcurrencyAllowed: V4_MAXIMUM_CONCURRENCY,
    minimumCallStartSpacingMilliseconds:
      V4_MINIMUM_CALL_START_SPACING_MILLISECONDS,
    attempted,
    successful: count("success"),
    failed: count("failed"),
    timedOut: count("timed_out"),
    cancelled: count("cancelled"),
    controlledPostSuccessFailures: ledger.calls.filter((call) =>
      call.controlledPostSuccessFailure
    ).length,
    unused: V4_PROVIDER_CALL_LIMIT - attempted,
    reconciled: ledger.calls.every((call) => call.outcome !== "reserved"),
    maximumConcurrencyObserved: schedulerReceipt.maximumConcurrencyObserved,
    minimumObservedStartSpacingMilliseconds:
      schedulerReceipt.minimumObservedStartSpacingMilliseconds,
    retriesAttempted: 0,
    probesAfterCircuitOpen: schedulerReceipt.probesAfterCircuitOpen,
    attempt16Prevented: true,
    circuitOpened: schedulerReceipt.circuitOpened,
    circuitStopHonored: schedulerReceipt.circuitStopHonored,
    invalidRetryAfterObserved: schedulerReceipt.invalidRetryAfterObserved,
    invalidRetryAfterStoppedCase:
      schedulerReceipt.invalidRetryAfterStoppedCase
  });
}

export function parseRetryAfterMillisecondsV4(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || value.length < 1 || value.length > 32) {
    return null;
  }
  const trimmed = value.trim();
  if (!/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(trimmed)) return null;
  const milliseconds = Math.ceil(Number(trimmed) * 1_000);
  return Number.isFinite(milliseconds) && milliseconds > 0 &&
    milliseconds <= V4_MAXIMUM_RETRY_AFTER_MILLISECONDS
    ? milliseconds : null;
}

function emptyLedger({
  authorizationReference,
  ledgerNamespace,
  proofRunIdentityDigest,
  proofRunIdentityArtifactDigest
}) {
  return {
    schemaVersion: 1,
    authorizationReference,
    ...(ledgerNamespace === null ? {} : { ledgerNamespace }),
    ...(proofRunIdentityDigest === null ? {} : {
      proofRunIdentityDigest,
      proofRunIdentityArtifactDigest
    }),
    hardLimit: V4_PROVIDER_CALL_LIMIT,
    calls: []
  };
}

function providerOutcome(error, signal) {
  if (signal?.aborted || error?.code === "request_cancelled" ||
      error?.code === "cancelled") return "cancelled";
  if (error?.code === "route_timed_out") return "timed_out";
  return "failed";
}

function safeFailureCode(error) {
  return SAFE_FAILURE_CODES.has(error?.code)
    ? error.code : "routing_unavailable";
}

function durationBucket(milliseconds) {
  if (milliseconds < 1_000) return "under_1s";
  if (milliseconds < 5_000) return "1s_to_4s";
  if (milliseconds < 15_000) return "5s_to_14s";
  if (milliseconds < 30_000) return "15s_to_29s";
  return "30s_or_more";
}

function coarseTimeBucket(milliseconds) {
  return `minute_${Math.floor(milliseconds / 60_000)}`;
}

function invalidLedger() {
  throw new V4ProofContractError("invalid_provider_ledger");
}

function invalidScheduler() {
  throw new V4ProofContractError("invalid_provider_scheduler");
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
