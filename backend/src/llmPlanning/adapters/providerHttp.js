import {
  LLMPlanningAdapterError,
  llmPlanningAdapterError
} from "./adapterErrors.js";

const JSON_MEDIA_TYPE = /^application\/(?:[a-z0-9!#$&^_.+-]+\+)?json(?:\s*;|\s*$)/i;

export async function fetchBoundedJson(options) {
  const settings = validateOptions(options);
  const controller = new AbortController();
  let timedOut = false;
  let timer;
  const abortFromCaller = () => controller.abort();
  settings.signal?.addEventListener("abort", abortFromCaller, { once: true });
  if (settings.signal?.aborted) controller.abort();

  try {
    timer = settings.setTimeoutImpl(() => {
      timedOut = true;
      controller.abort();
    }, settings.deadlineMs);

    assertActive(settings.signal, controller.signal, timedOut);
    return await raceWithAbort((async () => {
      const response = await settings.fetchImpl(settings.url, {
        ...settings.init,
        redirect: "manual",
        signal: controller.signal
      });
      assertActive(settings.signal, controller.signal, timedOut);
      return parseResponse(response, settings, controller.signal);
    })(), controller.signal);
  } catch (error) {
    throw normalizeError(error, { callerSignal: settings.signal, timedOut });
  } finally {
    if (timer !== undefined) settings.clearTimeoutImpl(timer);
    settings.signal?.removeEventListener("abort", abortFromCaller);
    controller.abort();
  }
}

async function parseResponse(response, settings, signal) {
  if (!response || typeof response.status !== "number" || typeof response.ok !== "boolean") {
    throw llmPlanningAdapterError("invalid_response");
  }
  if (response.redirected === true || (response.status >= 300 && response.status < 400)) {
    await cancelResponseBody(response);
    throw llmPlanningAdapterError("redirect_rejected");
  }
  if (!response.ok) {
    await discardBoundedBody(response, settings.maximumErrorResponseBytes, signal);
    if (response.status === 401 || response.status === 403) {
      throw llmPlanningAdapterError("configuration_missing");
    }
    if (response.status === 429) throw llmPlanningAdapterError("rate_limited");
    if (response.status >= 500) throw llmPlanningAdapterError("provider_unavailable");
    throw llmPlanningAdapterError("provider_rejected");
  }
  const contentType = response.headers?.get?.("content-type");
  if (typeof contentType !== "string" || !JSON_MEDIA_TYPE.test(contentType)) {
    await cancelResponseBody(response);
    throw llmPlanningAdapterError("invalid_content_type");
  }
  const bytes = await readBoundedBody(response, settings.maximumResponseBytes, signal);
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw llmPlanningAdapterError("invalid_response");
  }
  try {
    return JSON.parse(text);
  } catch {
    throw llmPlanningAdapterError("invalid_response");
  }
}

async function discardBoundedBody(response, maximumBytes, signal) {
  try {
    await readBoundedBody(response, maximumBytes, signal);
  } catch (error) {
    if (error?.code === "cancelled" || error?.code === "timed_out") throw error;
    // Provider error bodies are never parsed, logged, or reflected.
  }
}

async function readBoundedBody(response, maximumBytes, signal) {
  const declaredLength = response.headers?.get?.("content-length");
  if (declaredLength !== null && declaredLength !== undefined && declaredLength !== "") {
    const length = Number(declaredLength);
    if (!Number.isSafeInteger(length) || length < 0 || length > maximumBytes) {
      throw llmPlanningAdapterError("response_too_large");
    }
  }

  if (!response.body?.getReader) throw llmPlanningAdapterError("invalid_response");

  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      if (signal.aborted) throw llmPlanningAdapterError("cancelled");
      const { done, value } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) throw llmPlanningAdapterError("invalid_response");
      length += value.byteLength;
      if (length > maximumBytes) throw llmPlanningAdapterError("response_too_large");
      chunks.push(value);
    }
  } finally {
    if (length > maximumBytes || signal.aborted) {
      try { await reader.cancel(); } catch { /* Best-effort stream cancellation. */ }
    }
    reader.releaseLock?.();
  }
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

async function cancelResponseBody(response) {
  try { await response.body?.cancel?.(); } catch { /* Best-effort body cancellation. */ }
}

function validateOptions(input) {
  if (!input || typeof input !== "object" || Array.isArray(input) ||
      typeof input.fetchImpl !== "function" || !(input.url instanceof URL) ||
      !input.init || typeof input.init !== "object" || Array.isArray(input.init) ||
      !Number.isInteger(input.deadlineMs) || input.deadlineMs < 50 || input.deadlineMs > (input.maximumDeadlineMs ?? 30_000) ||
      !Number.isInteger(input.maximumDeadlineMs ?? 30_000) || (input.maximumDeadlineMs ?? 30_000) > 60_000 ||
      (input.maximumDeadlineMs ?? 30_000) < 50 ||
      !Number.isInteger(input.maximumResponseBytes) || input.maximumResponseBytes < 1_024 ||
      input.maximumResponseBytes > 262_144 ||
      !Number.isInteger(input.maximumErrorResponseBytes) || input.maximumErrorResponseBytes < 256 ||
      input.maximumErrorResponseBytes >= input.maximumResponseBytes ||
      input.maximumAttempts !== 1 ||
      typeof input.setTimeoutImpl !== "function" || typeof input.clearTimeoutImpl !== "function") {
    throw llmPlanningAdapterError("configuration_missing");
  }
  return input;
}

function normalizeError(error, context) {
  if (context.callerSignal?.aborted) return llmPlanningAdapterError("cancelled");
  if (context.timedOut) return llmPlanningAdapterError("timed_out");
  if (error instanceof LLMPlanningAdapterError) return error;
  return llmPlanningAdapterError("provider_unavailable");
}

function assertActive(callerSignal, internalSignal, timedOut) {
  if (callerSignal?.aborted) throw llmPlanningAdapterError("cancelled");
  if (timedOut) throw llmPlanningAdapterError("timed_out");
  if (internalSignal.aborted) throw llmPlanningAdapterError("cancelled");
}

function raceWithAbort(operation, signal) {
  operation.catch(() => {});
  let abort;
  const cancellation = new Promise((_, reject) => {
    abort = () => reject(llmPlanningAdapterError("cancelled"));
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
  });
  return Promise.race([operation, cancellation]).finally(() => {
    signal.removeEventListener("abort", abort);
  });
}
