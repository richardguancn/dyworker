// Live documents publish definitions only. Rows and completion times belong to
// one visitor's page memory and are never a publication seed.
export function validateLiveDocument(snapshot) {
  if (snapshot.dataMode !== "live") return;
  if (snapshot.refresh !== "live" || snapshot.generatedAt != null || snapshot._dataAppQueryLoading) {
    throw new Error("Live documents require live refresh and no published result timestamps or snapshot metadata.");
  }
  const queries = Object.entries(snapshot.queries ?? {});
  if (!queries.length || queries.length > 100) throw new Error("Live documents need 1–100 query definitions.");
  for (const [id, query] of queries) {
    if (!query || !["automatic", "manual"].includes(query.load)
      || !Array.isArray(query.columns) || !query.columns.length
      || query.columns.some(column => typeof column !== "string" || !column.trim())
      || new Set(query.columns).size !== query.columns.length
      || (query.rows !== undefined && (!Array.isArray(query.rows) || query.rows.length))
      || query.source?.executedAt != null) {
      throw new Error(`Live query ${JSON.stringify(id)} needs columns, an automatic/manual load policy, and no published rows or execution time.`);
    }
  }
}

export function liveQueryDefinitions(snapshot) {
  validateLiveDocument(snapshot);
  return Object.fromEntries(Object.entries(snapshot.queries).map(([id, query]) => {
    const { rows, ...definition } = query;
    return [id, definition];
  }));
}

export function clearsLiveData(error) {
  return ["reauthentication_required", "connector_access_disabled", "tool_not_allowed", "permission_denied"].includes(error?.status)
    || error?.httpStatus === 401 || error?.httpStatus === 403;
}
