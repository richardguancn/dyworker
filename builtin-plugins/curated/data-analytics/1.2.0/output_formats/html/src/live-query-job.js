// Continuations identify work, never authorize it. Every check uses the new
// request's Sites context. No bindings, credentials or result rows are stored.
import { readSitesRuntimeSetting } from "./sites-runtime-setting.js";
const lifetimeMs = 15 * 60 * 1000;
const bytes = value => new TextEncoder().encode(value);
const encode = value => btoa(String.fromCharCode(...value)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
const decode = value => Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/")), c => c.charCodeAt(0));
const fingerprint = async value => encode(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes(value))));
const failure = (status, message) => ({ status, message });

export async function runLiveQuery({ adapter, revision, queryId, continuation, request, viewer, environment, context }) {
  const gateway = context?.props?.CONNECTORS;
  const connectors = typeof gateway?.invoke === "function"
    ? { invoke: (connectorId, actionName, args) => gateway.invoke(connectorId, actionName, args) }
    : undefined;
  const input = { queryId, context: { props: { CONNECTORS: connectors } } };
  if (typeof adapter === "function") {
    if (continuation !== undefined) return failure("invalid_request", "This source does not accept a continuation.");
    const value = await adapter(input);
    return value?.status === "pending"
      ? failure("invalid_request", "Asynchronous sources require a start/check adapter.") : value;
  }
  const secret = await readSitesRuntimeSetting(environment, "DATA_APP_CONTINUATION_SECRET");
  if (typeof adapter?.start !== "function" || typeof adapter?.check !== "function"
    || !/^[a-f0-9]{64}$/.test(revision ?? "") || !/^[a-f0-9]{64}$/.test(secret ?? "")) {
    return failure("binding_unavailable", "The Site owner needs to configure query continuation.");
  }
  const key = await crypto.subtle.importKey("raw", bytes(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
  const identity = await fingerprint(JSON.stringify([viewer, new URL(request.url).origin, queryId, revision]));
  let state, expiresAt = Date.now() + lifetimeMs;
  if (continuation !== undefined) {
    try {
      if (typeof continuation !== "string" || continuation.length > 6144 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(continuation)) throw new Error();
      const [payload, signature] = continuation.split(".");
      if (!await crypto.subtle.verify("HMAC", key, decode(signature), bytes(payload))) throw new Error();
      const job = JSON.parse(new TextDecoder().decode(decode(payload)));
      if (job.identity !== identity || !Number.isSafeInteger(job.expiresAt)
        || job.expiresAt <= Date.now() || job.expiresAt > Date.now() + lifetimeMs
        || typeof job.state !== "string" || !job.state || job.state.length > 1024) throw new Error();
      state = job.state;
      expiresAt = job.expiresAt;
    } catch {
      return failure("invalid_request", "This query continuation is invalid or expired.");
    }
  }
  const value = state === undefined ? await adapter.start(input) : await adapter.check({ ...input, continuation: state });
  if (value?.status !== "pending") return value;
  if (typeof value.continuation !== "string" || !value.continuation || value.continuation.length > 1024
    || ["pollAfterMs", "retryAfterMs"].some(key => value[key] !== undefined
      && (!Number.isSafeInteger(value[key]) || value[key] < 0 || value[key] > lifetimeMs))) {
    return failure("tool_error", "The source returned an invalid continuation.");
  }
  const payload = encode(bytes(JSON.stringify({ identity, expiresAt, state: value.continuation })));
  const signature = encode(new Uint8Array(await crypto.subtle.sign("HMAC", key, bytes(payload))));
  return { status: "pending", continuation: `${payload}.${signature}`, expiresAt,
    ...(value.pollAfterMs === undefined ? {} : { pollAfterMs: value.pollAfterMs }),
    ...(value.retryAfterMs === undefined ? {} : { retryAfterMs: value.retryAfterMs }) };
}
