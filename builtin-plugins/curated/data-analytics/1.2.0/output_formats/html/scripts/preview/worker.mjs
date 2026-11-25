// Copied into profile-local storage by data-app-preview.mjs. Keep this worker
// dependency-free so installed previews survive plugin cache replacement.
import { createServer } from "node:http";
import { constants } from "node:fs";
import { lstat, open, readFile, realpath } from "node:fs/promises";
import { extname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const HEALTH_PATH = "/__data_preview_health";
export const WORKER_VERSION = 2;
const TYPES = {
  ".html": "text/html; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
  ".gif": "image/gif", ".ico": "image/x-icon", ".woff2": "font/woff2",
  ".avif": "image/avif", ".bmp": "image/bmp", ".eot": "application/vnd.ms-fontobject",
  ".woff": "font/woff", ".ttf": "font/ttf", ".otf": "font/otf",
  ".csv": "text/csv; charset=utf-8", ".txt": "text/plain; charset=utf-8", ".pdf": "application/pdf",
  ".m4a": "audio/mp4", ".mp3": "audio/mpeg", ".mp4": "video/mp4",
  ".oga": "audio/ogg", ".ogg": "audio/ogg", ".ogv": "video/ogg",
  ".wav": "audio/wav", ".webm": "video/webm", ".pcss": "text/css", ".postcss": "text/css",
};

export function validateConfig(config) {
  if (config?.version !== 1 || !/^[a-f0-9]{64}$/u.test(config.id ?? "")
    || typeof config.projectRoot !== "string" || !isAbsolute(config.projectRoot)
    || !Number.isInteger(config.port) || config.port < 1024 || config.port > 65535) {
    throw new Error("Invalid Data preview configuration.");
  }
  return config;
}

async function openAsset(projectRoot, parts) {
  // Re-resolve on every request: builds replace dist, and deleted/moved projects
  // must fail closed rather than following a replacement symlink.
  if (await realpath(projectRoot) !== projectRoot) throw new Error("Project moved.");
  let path = projectRoot;
  const segments = ["dist", ...parts];
  for (const [index, part] of segments.entries()) {
    path = join(path, part);
    const entry = await lstat(path);
    if (entry.isSymbolicLink()) throw new Error("Symlinks are not preview assets.");
    if (index < segments.length - 1 && !entry.isDirectory()) throw new Error("Invalid asset directory.");
    if (index === segments.length - 1 && !entry.isFile()) throw new Error("Not a regular asset.");
  }
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  if (!(await file.stat()).isFile()) {
    await file.close();
    throw new Error("Not a regular asset.");
  }
  return file;
}

export async function assertPreviewBuild(projectRoot) {
  const file = await openAsset(projectRoot, ["index.html"]);
  await file.close();
}

export function createPreviewServer(input) {
  const config = validateConfig(input);
  const origin = `http://127.0.0.1:${config.port}`;
  return createServer(async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    response.setHeader("X-Frame-Options", "SAMEORIGIN");
    const reply = (status, body) => {
      response.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
      response.end(request.method === "HEAD" ? undefined : body);
    };
    // No API, CORS, directory listings, or network-facing listener. The exact
    // host and origin checks also prevent DNS rebinding to reviewed local data.
    if (request.headers.host !== `127.0.0.1:${config.port}`
      || (request.headers.origin && request.headers.origin !== origin)
      || (request.headers["sec-fetch-site"] === "cross-site"
        && !(request.headers["sec-fetch-mode"] === "navigate" && request.headers["sec-fetch-dest"] === "document"))) {
      return reply(403, "Forbidden");
    }
    if (!["GET", "HEAD"].includes(request.method)) {
      response.setHeader("Allow", "GET, HEAD");
      return reply(405, "Method not allowed");
    }
    let pathname;
    try {
      const raw = request.url.split("?")[0];
      if (!raw.startsWith("/") || raw.startsWith("//")) throw new Error("Invalid path");
      pathname = decodeURIComponent(raw);
      if (/[\\\u0000-\u001f\u007f]/u.test(pathname)
        || pathname.split("/").some(part => part === "." || part === ".." || part.startsWith("."))) {
        throw new Error("Invalid path");
      }
    } catch { return reply(400, "Invalid path"); }
    if (pathname === HEALTH_PATH) {
      let ready = true;
      try { await assertPreviewBuild(config.projectRoot); } catch { ready = false; }
      response.writeHead(200, { "Content-Type": "application/json" });
      return response.end(request.method === "HEAD" ? undefined : JSON.stringify({
        id: config.id, workerVersion: WORKER_VERSION, ready,
      }));
    }
    const document = pathname === "/" || pathname === "/index.html"
      || /^\/_data\/(?:charts|components)\/[^/]+\/?$/u.test(pathname);
    const parts = document ? ["index.html"] : pathname.slice(1).split("/");
    // Windows treats these as streams, device names, or aliases rather than
    // ordinary filenames. Check only asset paths so component IDs can use ':'.
    if ((process.platform === "win32" || config.platform === "win32")
      && parts.some(part => /[:<>"|?*]/u.test(part) || /[. ]$/u.test(part)
        || /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/iu.test(part))) {
      return reply(400, "Invalid asset path");
    }
    if (parts.some(part => !part) || !TYPES[extname(parts.at(-1))]) return reply(404, "Not found");
    let file;
    try {
      file = await openAsset(config.projectRoot, parts);
      response.writeHead(200, { "Content-Type": TYPES[extname(parts.at(-1))] });
      if (request.method === "HEAD") { await file.close(); return response.end(); }
      const stream = file.createReadStream();
      stream.on("error", () => response.destroy());
      response.on("close", () => stream.destroy());
      stream.pipe(response);
    } catch {
      await file?.close().catch(() => {});
      reply(document ? 503 : 404, document ? "Data preview build unavailable. Rebuild the project and reload." : "Not found");
    }
  });
}

export async function servePreview(config) {
  const server = createPreviewServer(config);
  await new Promise((done, reject) => {
    server.once("error", reject);
    server.listen(config.port, "127.0.0.1", done);
  });
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const config = validateConfig(JSON.parse(await readFile(process.argv[2], "utf8")));
    const server = await servePreview(config);
    const shutdown = () => {
      if (!server.listening) return;
      server.close();
      server.closeAllConnections();
    };
    for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, shutdown);
    // Windows Task Scheduler stops its hidden launcher, not descendant Node
    // processes. The launcher owns this pipe; its exit closes the listener too.
    if (process.argv[3] === "--parent-pipe") {
      process.stdin.once("end", shutdown);
      process.stdin.once("error", shutdown);
      process.stdin.resume();
    }
  } catch (error) {
    console.error(`Data preview: ${error.message}`);
    process.exitCode = 1;
  }
}
