import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const entryPath = path.resolve("dist/client/index.html");

if (!fs.existsSync(entryPath)) {
  try {
    const viteBin = path.resolve("node_modules/vite/bin/vite.js");
    execSync(`node "${viteBin}" build`, { stdio: "ignore" });
  } catch (e) {
    // 忽略错误，让后面的 readFileSync 抛出具体错误
  }
}

test("packaged renderer assets resolve beside the local HTML entry", () => {
  const html = fs.readFileSync(entryPath, "utf8");
  const references = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
    .map((match) => match[1])
    .filter((reference) => !reference.startsWith("data:"));

  assert.ok(references.length > 0, "the built page should reference renderer assets");

  for (const reference of references) {
    const resolvedUrl = new URL(reference, pathToFileURL(entryPath));
    assert.equal(resolvedUrl.protocol, "file:", `${reference} should stay on the local file protocol`);
    assert.ok(
      fs.existsSync(fileURLToPath(resolvedUrl)),
      `${reference} resolves to a missing packaged file: ${fileURLToPath(resolvedUrl)}`,
    );
  }
});
