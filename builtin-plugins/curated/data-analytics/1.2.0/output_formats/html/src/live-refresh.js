// Both plugin and API adapters return the same complete batch. Validate before
// changing any chart so a partial refresh cannot mix source execution times.
// Keep provider diagnostics in the response for inspection, outside the UI.
export function refreshFailureMessage(error) {
  if (error?.pendingJob) return "The query may still be running. Check its status to continue.";
  switch (error?.status) {
    case "reauthentication_required": return "Sign in again to review this Site’s access to the source.";
    case "permission_denied": return "You don't have access to this data. Ask your data administrator for access.";
    case "connector_access_disabled": return "This source is disabled for this Site. Ask your workspace admin or the Site owner to enable it.";
    case "tool_not_found":
    case "tool_not_allowed":
    case "binding_unavailable": return "This source isn't set up correctly. Ask the Site owner to check the connection.";
    case "invalid_request": return "This request couldn't be completed. Reload the page, or ask the Site owner to check the connection.";
    case "rate_limited": return "This source is busy. Wait a moment before trying again.";
    case "request_context_expired": return "This request expired. Reload the page and try again.";
    default: return "The data couldn't be loaded. The request may have completed at the source. Check before trying again, or contact the Site owner.";
  }
}

export function refreshFailure(result) {
  const statuses = ["reauthentication_required", "request_context_expired", "connector_access_disabled",
    "tool_not_found", "tool_not_allowed", "invalid_request", "rate_limited", "tool_error",
    "upstream_error", "internal_error", "binding_unavailable", "permission_denied"];
  if (!statuses.includes(result?.status)) return null;
  return { status: result.status,
    ...(Object.hasOwn(result, "result") ? { result: result.result } : {}),
    message: typeof result.message === "string" && result.message.trim()
      ? result.message.slice(0, 500) : "The data source could not complete this refresh.",
    ...(typeof result.requestId === "string" ? { requestId: result.requestId.slice(0, 200) } : {}),
    ...(Number.isSafeInteger(result.retryAfterMs) && result.retryAfterMs >= 0
      ? { retryAfterMs: result.retryAfterMs } : {}) };
}

export function validateRefreshResult(result, queries, { complete = false } = {}) {
  const validTime = value => typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    && Number.isFinite(Date.parse(value));
  const updates = result?.updates;
  if (!validTime(result?.generatedAt) || !Array.isArray(updates) || !updates.length
    || (complete && updates.length !== Object.keys(queries).length)
    || updates.length > 100 || new Set(updates.map(update => update?.queryId)).size !== updates.length
    || updates.some(update => !update || typeof update.queryId !== "string" || !Object.hasOwn(queries, update.queryId)
      || !validTime(update.executedAt) || !Array.isArray(update.rows) || update.rows.length > 10_000
      || update.rows.some(row => row === null || typeof row !== "object" || Array.isArray(row)
        || (complete && Array.isArray(queries[update.queryId].columns)
          && (Object.keys(row).length !== queries[update.queryId].columns.length
            || queries[update.queryId].columns.some(column => !Object.hasOwn(row, column))))))) {
    throw new Error("Refresh returned incomplete or invalid data. The previous data is still displayed.");
  }
  return { generatedAt: result.generatedAt, updates: updates.map(({ queryId, rows, executedAt }) =>
    ({ queryId, rows, executedAt })) };
}

// Schedule from request start so network/provider waiting is not followed by
// another full interval. retryAfterMs is a minimum AFTER the response.
export function nextPollDelay(result, attempt, elapsedMs) {
  const target = result.pollAfterMs ?? Math.min(5000, 1000 * (1 + Math.floor(attempt / 5)));
  return Math.max(250, target - elapsedMs, result.retryAfterMs ?? 0);
}

export async function requestLiveRefresh(queries, request = fetch, {
  queryId, signal, pendingJob, wait = abortableDelay, now = () => performance.now(),
  timeoutMs = 15 * 60 * 1000, onTiming,
} = {}) {
  const started = now();
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  const deadline = setTimeout(() => controller.abort(new Error("The query is still running; its completion could not be confirmed.")), timeoutMs);
  let continuation = pendingJob?.continuation, requestCount = 0, requestMs = 0, pollWaitMs = 0;
  try {
    for (let attempt = 0; attempt < 180 && now() - started < timeoutMs; attempt++) {
      controller.signal.throwIfAborted();
      const requestStarted = now();
      requestCount++;
      const response = await request("/api/refresh", {
        method: "POST", signal: controller.signal, credentials: "same-origin", cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...(queryId === undefined ? {} : { queryId }),
          ...(continuation === undefined ? {} : { continuation }) }),
      });
      let result;
      try { result = await response.json(); }
      catch { throw Object.assign(new Error(`Data could not load (HTTP ${response.status}).`), { httpStatus: response.status }); }
      const elapsed = now() - requestStarted;
      requestMs += elapsed;
      const failure = refreshFailure(result);
      if (failure) throw Object.assign(new Error(failure.message), failure, { httpStatus: response.status });
      if (!response.ok) throw Object.assign(new Error(`Data could not load (HTTP ${response.status}).`), { httpStatus: response.status });
      if (result.status !== "pending") return validateRefreshResult(result, queries, { complete: queryId !== undefined });
      if (typeof queryId !== "string" || typeof result.continuation !== "string" || !result.continuation
        || result.continuation.length > 6144 || result.updates !== undefined
        || ["pollAfterMs", "retryAfterMs"].some(key => result[key] !== undefined
          && (!Number.isSafeInteger(result[key]) || result[key] < 0 || result[key] > timeoutMs))) {
        throw new Error("The source returned an invalid continuation.");
      }
      continuation = result.continuation;
      pendingJob = { continuation, expiresAt: result.expiresAt };
      // Keep the first checks quick, then spread the remaining requests across the deadline.
      const remaining = timeoutMs - (now() - started);
      const pacing = attempt < 2 ? 0 : Math.floor(remaining / (180 - attempt));
      const delay = Math.max(pacing, nextPollDelay(result, attempt, elapsed));
      if (now() - started + delay >= timeoutMs) break;
      await wait(delay, controller.signal);
      pollWaitMs += delay;
    }
    throw new Error("The query is still running; its completion could not be confirmed.");
  } catch (error) {
    if (!signal?.aborted && pendingJob?.expiresAt > Date.now()
      && (!error.status || ["rate_limited", "upstream_error", "internal_error"].includes(error.status))
      && ![401, 403].includes(error.httpStatus)) {
      error.pendingJob = pendingJob;
    }
    throw error;
  } finally {
    clearTimeout(deadline);
    signal?.removeEventListener("abort", abort);
    // DevTools-only timing. No rows, provider errors, identities or job tokens.
    const timing = { requestCount, requestMs, pollWaitMs, totalMs: now() - started };
    try {
      if (onTiming) onTiming(timing);
      else performance.measure("data-app:refresh", { start: started, duration: timing.totalMs, detail: timing });
    } catch { /* Observability must not change query behavior. */ }
  }
}

function abortableDelay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason); return; }
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
}
