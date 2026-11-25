import { createHash, randomUUID } from "node:crypto";
import { request } from "node:http";
import { createServer } from "node:net";
import { link, lstat, mkdir, readFile, readdir, realpath, rename, rmdir, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

import * as systemServices from "./service.mjs";
import { assertPreviewBuild, HEALTH_PATH, validateConfig, WORKER_VERSION } from "./worker.mjs";

const workerSource = fileURLToPath(new URL("./worker.mjs", import.meta.url));
const hash = value => createHash("sha256").update(value).digest("hex");
const previewId = (storage, projectRoot) => hash(`${storage}\n${projectRoot}`);

async function storagePath(stateRoot) {
  const path = resolve(stateRoot);
  if (process.platform !== "win32") return path;
  // Resolve Windows drive/directory casing before hashing the profile identity,
  // including when its final directories have not been created yet. Retain the
  // no-junction/symlink boundary instead of silently accepting redirected state.
  let existing = path;
  const missing = [];
  while (true) {
    try { await lstat(existing); break; }
    catch (error) {
      if (error.code !== "ENOENT" || dirname(existing) === existing) throw error;
      missing.unshift(basename(existing));
      existing = dirname(existing);
    }
  }
  for (let parent = existing; ; parent = dirname(parent)) {
    if ((await lstat(parent)).isSymbolicLink()) throw new Error("Preview storage must not contain a symlink or junction.");
    if (dirname(parent) === parent) break;
  }
  return join(await realpath(existing), ...missing);
}

async function readStoredConfig(storage, id, platform) {
  const directory = join(storage, id);
  try {
    const entry = await lstat(directory);
    if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error("Preview storage must be a real directory.");
    const config = validateConfig(JSON.parse(await regularFile(join(directory, "config.json"))));
    if (config.id !== id || previewId(storage, config.projectRoot) !== id || config.platform !== platform
      || typeof config.nodePath !== "string") throw new Error("Preview registration does not match this project and host.");
    return config;
  } catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

// Only these generated files belong to the preview. Never recursively delete a
// registry directory: unexpected files (including ones added concurrently) stay.
async function removalFiles(directory) {
  const files = [];
  let logs;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.name === "logs" && entry.isDirectory() && !entry.isSymbolicLink()) {
      logs = path;
      for (const log of await readdir(path, { withFileTypes: true })) {
        if (!["stdout.log", "stderr.log"].includes(log.name) || !log.isFile() || log.isSymbolicLink()) {
          throw new Error(`Refusing to remove unexpected preview file: ${join(path, log.name)}`);
        }
        files.push(join(path, log.name));
      }
    } else if ((["config.json", "worker.mjs"].includes(entry.name)
      || /^(?:config\.json|worker\.mjs)\.\d+\.tmp$/u.test(entry.name)) && entry.isFile() && !entry.isSymbolicLink()) {
      if (entry.name !== "config.json") files.push(path);
    } else throw new Error(`Refusing to remove unexpected preview file: ${path}`);
  }
  return { files, logs };
}

async function regularFile(path) {
  const entry = await lstat(path);
  if (!entry.isFile() || entry.isSymbolicLink()) throw new Error(`Expected a regular preview file: ${path}`);
  return readFile(path, "utf8");
}

async function writePrivate(path, text) {
  const temporary = `${path}.${process.pid}.tmp`;
  try {
    await writeFile(temporary, text, { mode: 0o600, flag: "wx" });
    await rename(temporary, path);
  } finally { await unlink(temporary).catch(error => { if (error.code !== "ENOENT") throw error; }); }
}

async function privateDirectory(path) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  if (!(await lstat(path)).isDirectory() || (await realpath(path)) !== path) {
    throw new Error(`Preview storage must be a real directory, not a symlink: ${path}`);
  }
}

async function withLock(path, operation) {
  // The kernel releases this lock even after a crash or PID reuse. A colliding
  // local listener causes a conservative failure; it is never stopped or moved.
  // Stay below the usual ephemeral-client ranges on supported platforms.
  const port = 16384 + (Number.parseInt(hash(path).slice(0, 8), 16) % 16384);
  const lock = createServer(socket => socket.destroy());
  try {
    await new Promise((done, reject) => {
      lock.once("error", reject);
      lock.listen({ host: "127.0.0.1", port, exclusive: true }, done);
    });
  } catch (error) {
    if (error.code !== "EADDRINUSE") throw error;
    throw new Error(`Another Data preview command is running, or a local service occupies command-lock port ${port}. Retry after the command finishes; if it persists, inspect that local listener.`);
  }
  try {
    // Keep the legacy pathname occupied so older CLI versions also refuse to
    // overlap. Only the kernel lock proves that a version-2 marker is stale.
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify({ version: 2, port, pid: process.pid }), { flag: "wx", mode: 0o600 });
      // Publish a complete marker without overwriting a legacy command's lock.
      // A crash during write must not leave a truncated permanent lock record.
      try { await link(temporary, path); }
      catch (error) {
        if (error.code !== "EEXIST") throw error;
        const contents = await regularFile(path);
        let previous;
        try { previous = JSON.parse(contents); } catch { /* Validate legacy PIDs below. */ }
        if (previous?.version !== 2 || previous.port !== port) {
          const pid = Number(contents);
          if (!Number.isInteger(pid) || pid <= 0) throw new Error(`Invalid preview lock: ${path}`);
          try {
            process.kill(pid, 0);
            throw new Error(`Another Data preview command is running under an older CLI. Inspect PID ${pid} and ${path} before recovering a legacy lock.`);
          } catch (signalError) {
            if (signalError.code !== "ESRCH") throw signalError;
          }
        }
        await unlink(path);
        await link(temporary, path);
      }
    } finally { await unlink(temporary).catch(error => { if (error.code !== "ENOENT") throw error; }); }
    try { return await operation(); } finally { await unlink(path); }
  } finally {
    await new Promise((done, reject) => lock.close(error => error ? reject(error) : done()));
  }
}

export function probePreview(config) {
  return new Promise(resolveProbe => {
    let settled = false;
    let deadline;
    const finish = result => {
      if (!settled) { settled = true; clearTimeout(deadline); resolveProbe(result); }
    };
    const req = request({ host: "127.0.0.1", port: config.port, path: HEALTH_PATH, timeout: 750 }, response => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", chunk => {
        body += chunk;
        if (body.length > 4096) { finish({ state: "occupied" }); req.destroy(); }
      });
      response.on("error", () => finish({ state: "occupied" }));
      response.on("end", () => {
        try {
          const health = JSON.parse(body);
          if (response.statusCode === 200 && health.id === config.id && Number.isInteger(health.workerVersion)) {
            if (health.workerVersion >= 1 && health.workerVersion < WORKER_VERSION) return finish({ state: "stale-worker" });
            if (health.workerVersion === WORKER_VERSION) {
              return finish({ state: health.ready === true ? "running" : "build-unavailable" });
            }
          }
        } catch { /* A foreign listener is not this app's preview. */ }
        finish({ state: "occupied" });
      });
    });
    req.on("timeout", () => { finish({ state: "occupied" }); req.destroy(); });
    req.on("error", error => finish({ state: error.code === "ECONNREFUSED" ? "stopped" : "occupied" }));
    deadline = setTimeout(() => { finish({ state: "occupied" }); req.destroy(); }, 1000);
    req.end();
  });
}

async function availablePort() {
  const server = createServer();
  await new Promise((done, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", done); });
  const { port } = server.address();
  await new Promise((done, reject) => server.close(error => error ? reject(error) : done()));
  return port;
}

export async function previewCommand(command, {
  projectDir, port,
  stateRoot = join(process.env.CODEX_HOME || join(homedir(), ".codex"), "plugin-data/data-analytics/previews"),
  homeDir = homedir(), platform = process.platform, nodePath = process.execPath,
  services = systemServices,
} = {}) {
  if (!["start", "status", "stop", "list", "remove"].includes(command)) {
    throw new Error("Specify start, status, stop, list, or remove.");
  }
  if (command === "list" ? projectDir !== undefined : typeof projectDir !== "string" || !projectDir.trim()) {
    throw new Error("list takes no --project-dir; other commands require --project-dir <absolute-app-project>.");
  }
  if (port !== undefined && (command !== "start" || !Number.isInteger(port) || port < 1024 || port > 65535)) {
    throw new Error("--port must be 1024–65535 and is accepted only by start.");
  }
  const storage = await storagePath(stateRoot);
  if (command === "list") {
    let entries;
    try { entries = await readdir(storage); }
    catch (error) { if (error.code === "ENOENT") return { previews: [] }; throw error; }
    const previews = await Promise.all(entries.filter(id => /^[a-f0-9]{64}$/u.test(id)).sort().map(async id => {
      const configPath = join(storage, id, "config.json");
      try {
        const config = await readStoredConfig(storage, id, platform);
        if (!config) throw new Error("Preview configuration is missing.");
        return await previewCommand("status", { projectDir: config.projectRoot, stateRoot: storage, homeDir, platform, services });
      } catch (error) {
        return { state: "invalid", registered: null, configPath, error: error.message };
      }
    }));
    return { previews };
  }
  // Cleanup uses only the recorded path, even after removal: following a new
  // symlink could otherwise stop or remove a different app on a repeated call.
  let projectRoot = resolve(projectDir);
  if (command === "start" || (command === "status"
    && !await readStoredConfig(storage, previewId(storage, projectRoot), platform))) {
    try { projectRoot = await realpath(projectDir); }
    catch (error) { if (command === "start" || error.code !== "ENOENT") throw error; }
  }
  const id = previewId(storage, projectRoot);
  const directory = join(storage, id);
  const configPath = join(directory, "config.json");
  const workerPath = join(directory, "worker.mjs");
  const readConfig = () => readStoredConfig(storage, id, platform);
  const definition = config => services.serviceDefinition({
    platform, homeDir, id, directory, nodePath: config.nodePath, workerPath, configPath,
  });
  const result = (config, state, registered) => ({
    projectRoot, state, registered, url: `http://127.0.0.1:${config.port}/`,
    port: config.port, configPath, logs: join(directory, "logs"),
    restart: registered ? "user-login" : null,
  });
  if (command === "status") {
    const config = await readConfig();
    if (!config) return { projectRoot, state: "not-configured", registered: false };
    return result(config, (await probePreview(config)).state, await services.serviceEnabled(definition(config)));
  }
  if (command === "start") {
    // Reject unsupported hosts and incomplete builds before persisting anything.
    definition({ nodePath });
    try { await assertPreviewBuild(projectRoot); }
    catch { throw new Error("Build this Data app first: preview requires a regular dist/index.html."); }
  } else if (!await readConfig()) return { projectRoot, state: "not-configured", registered: false };
  await privateDirectory(storage);
  // Keep the lock outside the removable entry, so start cannot recreate an app
  // registration while remove is deleting its worker or configuration.
  return withLock(join(storage, `${id}.lock`), async () => {
    let config = await readConfig();
    if (command === "stop" || command === "remove") {
      if (!config) return { projectRoot, state: "not-configured", registered: false };
      const cleanup = command === "remove" ? await removalFiles(directory) : null;
      const service = definition(config);
      await services.stopService(service);
      if (await services.serviceInstalled(service)) throw new Error("The preview service is still registered; its saved state was preserved.");
      let state = (await probePreview(config)).state;
      const deadline = Date.now() + 2000;
      while (["running", "build-unavailable", "stale-worker"].includes(state) && Date.now() < deadline) {
        await delay(100);
        state = (await probePreview(config)).state;
      }
      if (["running", "build-unavailable", "stale-worker"].includes(state)) throw new Error("The preview is still running; its user service could not be stopped.");
      if (cleanup) {
        for (const path of cleanup.files) await unlink(path);
        if (cleanup.logs) await rmdir(cleanup.logs);
        await unlink(configPath);
        await rmdir(directory);
        return { projectRoot, state: "removed", registered: false };
      }
      return result(config, state, false);
    }
    await privateDirectory(directory);
    if (config && port !== undefined && port !== config.port) {
      throw new Error(`This app keeps port ${config.port} to preserve links and browser edits. Do not change its origin.`);
    }
    config ??= { version: 1, id, projectRoot, port: port ?? await availablePort(), platform, nodePath };
    const previous = await probePreview(config);
    if (previous.state === "occupied") throw new Error(`Port ${config.port} is occupied by another listener. Free that port and retry; no process was stopped or port changed.`);
    const registered = await services.serviceInstalled(definition(config));
    if (previous.state === "running" && registered && config.nodePath === nodePath
      && await services.serviceEnabled(definition(config))) {
      return result(config, "running", true);
    }
    if (["running", "build-unavailable", "stale-worker"].includes(previous.state) && !registered) {
      throw new Error("This preview is running without its owned service definition. Restore the definition before managing it.");
    }
    // Stop our old registration before updating the Node path or copied worker.
    if (registered) await services.stopService(definition(config));
    config.nodePath = nodePath;
    await writePrivate(workerPath, await readFile(workerSource, "utf8"));
    await writePrivate(configPath, `${JSON.stringify(config, null, 2)}\n`);
    const service = definition(config);
    try {
      await services.installService(service);
      const deadline = Date.now() + 8000;
      do {
        const health = await probePreview(config);
        if (health.state === "running") return result(config, "running", true);
        if (health.state === "occupied") throw new Error(`Port ${config.port} was taken before the preview could start.`);
        await delay(100);
      } while (Date.now() < deadline);
      throw new Error(`Preview did not become ready. Inspect ${join(directory, "logs")}.`);
    } catch (error) {
      // A failed start must not leave a new restart loop or an enabled login job.
      try { await services.stopService(service); }
      catch (cleanupError) { throw new Error(`${error.message} Cleanup also failed: ${cleanupError.message}`); }
      throw error;
    }
  });
}
