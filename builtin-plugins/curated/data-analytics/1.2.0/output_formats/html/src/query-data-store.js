import { requestLiveRefresh } from "./live-refresh.js";
import { clearsLiveData, liveQueryDefinitions } from "./live-data.js";
import { parseJsonResponse } from "./streaming-json.js";

/** Retain complete reviewed queries; only transport and parsing are deferred. */
export function createQueryDataStore(snapshot, { snapshotSha256, request = fetch, onChange } = {}) {
  const live = snapshot.dataMode === "live";
  let queries = live ? liveQueryDefinitions(snapshot) : snapshot.queries;
  let version = 0;
  let disposed = false;
  let active = 0;
  const listeners = new Set();
  const queue = [];
  const entries = new Map(Object.entries(queries).map(([id, query]) => {
    if (query.rows !== undefined && !Array.isArray(query.rows)) {
      throw new Error(`Reviewed rows for ${JSON.stringify(id)} must be an array.`);
    }
    return [id, { loaded: Array.isArray(query.rows), job: null, error: null, retryAt: 0 }];
  }));
  const ids = queryIds => {
    if (!Array.isArray(queryIds)) throw new Error("Provide an array of reviewed query IDs.");
    return [...new Set(queryIds)].map(id => {
      if (typeof id !== "string" || !entries.has(id)) {
        throw new Error(`Unknown reviewed query ${JSON.stringify(id)}.`);
      }
      return id;
    });
  };
  const notify = (changed = false) => {
    version += 1;
    if (changed) onChange?.(queries);
    for (const listener of listeners) listener();
  };
  const closedError = () => new Error("This reviewed query store is no longer active.");

  async function run(job) {
    const entry = entries.get(job.id);
    const current = () => !disposed && entry.job === job;
    try {
      if (live) {
        const result = await requestLiveRefresh({ [job.id]: queries[job.id] }, request, {
          queryId: job.id, signal: job.controller.signal, pendingJob: job.pendingJob,
        });
        if (!current()) return;
        const { rows, executedAt } = result.updates[0];
        queries = { ...queries, [job.id]: { ...queries[job.id], rows,
          source: { ...queries[job.id].source, executedAt } } };
        entry.loaded = true;
        entry.job = null;
        entry.error = null;
        job.resolve(result);
        notify(true);
        return;
      }
      const response = await request(`/api/query-rows?queryId=${encodeURIComponent(job.id)}&snapshot=${encodeURIComponent(snapshotSha256)}&revision=seed`, {
        credentials: "same-origin", signal: job.controller.signal,
      });
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        if (response.status === 409) {
          throw Object.assign(new Error("Dashboard data changed. Reload the page to load the current data."), { code: "SNAPSHOT_CHANGED" });
        }
        throw new Error(`Unable to load reviewed query ${JSON.stringify(job.id)} (HTTP ${response.status}).`);
      }
      const rows = await parseJsonResponse(response);
      const rowCount = snapshot._dataAppQueryLoading?.queries?.[job.id]?.rowCount;
      if (!Array.isArray(rows) || (Number.isSafeInteger(rowCount) && rows.length !== rowCount)) {
        throw new Error(`Incomplete reviewed rows for query ${JSON.stringify(job.id)}.`);
      }
      if (!current()) return;
      queries = { ...queries, [job.id]: { ...queries[job.id], rows } };
      entry.loaded = true;
      entry.job = null;
      entry.error = null;
      job.resolve();
      notify(true);
    } catch (error) {
      if (!current()) return;
      entry.job = null;
      entry.error = error;
      entry.retryAt = Date.now() + (error.retryAfterMs ?? 0);
      if (live && clearsLiveData(error)) {
        const { rows, source, ...definition } = queries[job.id];
        const { executedAt, ...provenance } = source ?? {};
        queries = { ...queries, [job.id]: { ...definition, source: provenance } };
        entry.loaded = false;
      }
      job.reject(error);
      notify(live);
    } finally {
      active -= 1;
      drain();
    }
  }
  function drain() {
    while (!disposed && active < 2 && queue.length) {
      const job = queue.shift();
      if (entries.get(job.id).job !== job) continue;
      active += 1;
      void run(job);
    }
  }

  async function ensure(queryIds, { force = false, userInitiated = false } = {}) {
    if (disposed) throw closedError();
    const requested = ids(queryIds);
    if (!live && requested.some(id => !entries.get(id).loaded) && !/^[a-f0-9]{64}$/u.test(snapshotSha256 ?? "")) {
      throw new Error("An immutable snapshot SHA256 is required to load reviewed queries.");
    }
    let changed = false;
    const promises = requested.map(id => {
      const entry = entries.get(id);
      if (entry.job) return entry.job.promise;
      if (live && !userInitiated && queries[id].load === "manual") return undefined;
      if (entry.loaded && !force) return undefined;
      if (live && entry.error && !userInitiated) return undefined;
      if (live && Date.now() < entry.retryAt) return Promise.reject(entry.error);
      const job = { id, controller: new AbortController(), pendingJob: entry.error?.pendingJob };
      job.promise = new Promise((resolve, reject) => { job.resolve = resolve; job.reject = reject; });
      entry.job = job;
      entry.error = null;
      queue.push(job);
      changed = true;
      return job.promise;
    });
    const done = Promise.allSettled(promises);
    if (changed) notify();
    drain();
    const results = await done;
    const failure = results.find(result => result.status === "rejected");
    if (failure) throw failure.reason;
    return results.map(result => result.value).filter(Boolean);
  }

  return {
    getQueries: () => queries,
    getVersion: () => version,
    subscribe(listener) {
      if (disposed) return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    ensure,
    live,
    refresh: (queryIds = [...entries.keys()]) => ensure(queryIds, { force: true, userInitiated: true }),
    needsAction: queryIds => live && ids(queryIds).some(id => !entries.get(id).loaded
      && !entries.get(id).job && !entries.get(id).error && queries[id].load === "manual"),
    retryAt: queryIds => Math.max(0, ...ids(queryIds).map(id => entries.get(id).retryAt)),
    isReady: queryIds => ids(queryIds).every(id => entries.get(id).loaded),
    pending: queryIds => ids(queryIds).some(id => entries.get(id).job !== null),
    error: queryIds => ids(queryIds).map(id => entries.get(id).error).find(Boolean) ?? null,
    replace(queryId, rows, executedAt) {
      if (disposed) throw closedError();
      ids([queryId]);
      if (!Array.isArray(rows)) throw new Error("Replacement reviewed rows must be an array.");
      const entry = entries.get(queryId);
      const previous = entry.job;
      entry.job = null;
      entry.loaded = true;
      entry.error = null;
      queries = { ...queries, [queryId]: { ...queries[queryId], rows,
        ...(executedAt === undefined ? {} : { source: { ...queries[queryId].source, executedAt } }) } };
      // Detach before aborting: a late response cannot overwrite an owner edit.
      previous?.controller.abort();
      previous?.resolve();
      notify(true);
      drain();
    },
    clear() {
      if (!live || disposed) return;
      for (const entry of entries.values()) {
        const job = entry.job;
        entry.job = null;
        job?.controller.abort();
        job?.resolve();
        entry.loaded = false;
        entry.error = null;
        entry.retryAt = 0;
      }
      queue.length = 0;
      queries = liveQueryDefinitions(snapshot);
      notify(true);
    },
    loadAll: () => ensure([...entries.keys()]),
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const entry of entries.values()) {
        entry.job?.controller.abort();
        entry.job?.reject(closedError());
        entry.job = null;
      }
      queue.length = 0;
      listeners.clear();
    },
  };
}
