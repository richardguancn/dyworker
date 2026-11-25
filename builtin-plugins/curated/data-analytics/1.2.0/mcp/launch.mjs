import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

if (Number(process.versions.node.split(".")[0]) < 22) throw new Error("Data requires Node 22 or newer.");
const manifest = JSON.parse(await readFile(new URL("./dist/manifest.json", import.meta.url), "utf8"));
const names = ["THIRD_PARTY_NOTICES.txt", "home.html", "server.mjs", "sidebar-icon.svg"];
if (JSON.stringify(Object.keys(manifest.artifacts).sort()) !== JSON.stringify(names))
  throw new Error("Data is missing its complete prebuilt runtime. Reinstall the Data plugin.");
for (const name of names) {
  const expected = manifest.artifacts[name];
  const bytes = await readFile(new URL(`./dist/${name}`, import.meta.url));
  if (bytes.length !== expected.bytes || createHash("sha256").update(bytes).digest("hex") !== expected.sha256)
    throw new Error(`Data runtime integrity check failed: ${name}`);
}
const runtime = await import("./dist/server.mjs");
await runtime.main();
