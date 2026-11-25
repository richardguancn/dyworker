import { spawn } from "node:child_process";
import { lstat, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { dataNodeEnvironment } from "./data-app-runtime.mjs";

/** One bounded child per check; new writes cancel and suppress stale results. */
export function watchDataApp({ projectDir, cliPath, onResult, signal, debounceMs = 250, timeoutMs = 30_000, pollMs = 500 }) {
  const root = resolve(projectDir);
  return new Promise((resolveDone, reject) => {
    let generation = 0, pending, child, timer, poll, stopped = false;
    const cancelled = new WeakSet();
    const finish = (error) => {
      if (stopped) return;
      stopped = true;
      clearTimeout(pending); clearTimeout(timer); clearTimeout(poll);
      if (child) { cancelled.add(child); child.kill("SIGKILL"); }
      signal?.removeEventListener("abort", abort);
      error ? reject(error) : resolveDone();
    };
    const abort = () => finish();
    const failed = (message) => ({ schemaVersion: 1, status: "failed", projectRoot: root,
      diagnostics: [{ severity: "error", code: "DATA_WATCH_CHECK_FAILED", message }], errors: 1, warnings: 0,
      checks: [], files: 0, rows: 0, durationMs: 0 });
    function run() {
      if (stopped) return;
      if (child) { pending = setTimeout(run, 25); return; }
      const sequence = generation, inputSignature = previous;
      const running = spawn(process.execPath, ["--max-old-space-size=512", cliPath, "check", "--project-dir", root, "--json"], {
        env: dataNodeEnvironment(), stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
      });
      child = running;
      let output = "", errors = "", problem;
      function retain(chunk, stderr = false) {
        if (stderr) errors += chunk; else output += chunk;
        if (output.length + errors.length > 2 * 1024 * 1024) {
          problem = "Checker output exceeded 2 MiB.";
          running.kill("SIGKILL");
        }
      }
      running.stdout.on("data", chunk => retain(chunk));
      running.stderr.on("data", chunk => retain(chunk, true));
      timer = setTimeout(() => { problem = `Checker exceeded ${timeoutMs}ms; validation is incomplete.`; running.kill("SIGKILL"); }, timeoutMs);
      running.on("error", error => { problem = error.message; });
      running.on("close", async () => {
        clearTimeout(timer);
        if (child === running) child = undefined;
        if (stopped || cancelled.has(running) || sequence !== generation) return;
        try {
          const current = await inspectInputs();
          if (stopped || sequence !== generation) return;
          if (current !== inputSignature) { schedule(current); return; }
        } catch (error) { finish(error); return; }
        let result;
        try {
          if (problem) throw new Error(problem);
          result = JSON.parse(output);
          if (result.schemaVersion !== 1 || !["passed", "failed"].includes(result.status) || !Array.isArray(result.diagnostics))
            throw new Error("Checker returned invalid diagnostics.");
        } catch (error) { result = failed(problem || errors.trim().slice(0, 2000) || error.message); }
        onResult({ event: "check", sequence, ...result });
      });
    }
    let previous;
    async function inspectInputs() {
      const entries = [];
      async function visit(path) {
        let info;
        try { info = await lstat(join(root, "src", path), { bigint: true }); }
        catch (error) { if (error.code === "ENOENT") { entries.push([path, "missing"]); return; } throw error; }
        if (entries.length >= 4096) throw new Error("Watch supports at most 4096 authored input files/directories.");
        entries.push([path, String(info.ino), String(info.size), String(info.mtimeNs), String(info.ctimeNs)]);
        if (info.isDirectory() && !info.isSymbolicLink())
          for (const name of (await readdir(join(root, "src", path))).sort()) await visit(`${path}/${name}`);
      }
      await visit("content"); await visit("data.json"); await visit("theme.css");
      return JSON.stringify(entries);
    }
    function schedule(current) {
      const initial = previous === undefined;
      previous = current;
      generation++;
      clearTimeout(pending);
      if (child) { cancelled.add(child); child.kill("SIGKILL"); }
      pending = setTimeout(run, initial ? 0 : debounceMs);
    }
    // Poll only authored inputs. This also handles atomic saves and works on
    // hosts without recursive filesystem events; generated output is excluded.
    async function scan() {
      try {
        const current = await inspectInputs();
        if (stopped) return;
        if (current !== previous) schedule(current);
        poll = setTimeout(scan, pollMs);
      } catch (error) { finish(error); }
    }
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) finish(); else void scan();
  });
}
