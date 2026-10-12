import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { posix, win32 } from "node:path";
import test from "node:test";
import { Script } from "node:vm";

const packagerUrl = new URL(
  "../skills/publish-artifact-to-sites/scripts/package-data-app-for-sites-source.mjs",
  import.meta.url,
);
const packagerSource = readFileSync(packagerUrl, "utf8");
// Exercise the CLI's actual guards without running packaging or requiring two drives.
const guardSource = packagerSource.match(
  /function projectPath\(path\) \{[\s\S]*?\nfunction projectOutput\(path\) \{[\s\S]*?(?=\nconst sensitiveMetadataKey)/u,
)?.[0];
assert.ok(guardSource, "Sites packaging path guard declarations must be available for testing.");
const guardScript = new Script(`${guardSource}\n({ projectPath, projectOutput });`, {
  filename: packagerUrl.pathname,
});

function guards(projectRoot, pathApi, { realPaths = new Map(), existingPaths = null } = {}) {
  return guardScript.runInNewContext(
    {
      projectRoot,
      ...pathApi,
      realpathSync: (path) => realPaths.get(path) ?? path,
      existsSync: (path) => existingPaths === null || existingPaths.has(path),
    },
    { timeout: 1000 },
  );
}

for (const { name, pathApi, projectRoot, outside } of [
  {
    name: "POSIX",
    pathApi: posix,
    projectRoot: "/reviewed-app",
    outside: ["/outside/presentation.json", "/reviewed-app-sibling/presentation.json"],
  },
  {
    name: "Windows drive",
    pathApi: win32,
    projectRoot: "C:\\reviewed-app",
    outside: [
      "C:\\outside\\presentation.json",
      "C:\\reviewed-app-sibling\\presentation.json",
      "D:\\outside\\presentation.json",
      "\\\\server\\share\\presentation.json",
    ],
  },
  {
    name: "Windows UNC",
    pathApi: win32,
    projectRoot: "\\\\server\\share\\reviewed-app",
    outside: [
      "\\\\server\\share\\outside\\presentation.json",
      "\\\\server\\other-share\\presentation.json",
      "\\\\other-server\\share\\presentation.json",
    ],
  },
]) {
  test(`${name} packaging guards allow project descendants and reject other roots`, () => {
    for (const guard of Object.values(guards(projectRoot, pathApi))) {
      for (const target of [projectRoot, pathApi.join(projectRoot, "nested/presentation.json")]) {
        assert.equal(guard(target), target);
      }
      for (const target of [pathApi.dirname(projectRoot), ...outside]) {
        assert.throws(() => guard(target), /inside the Data app project/u);
      }
    }
  });

  test(`${name} packaging guards reject symlink-resolved inputs and output ancestors`, () => {
    const input = pathApi.join(projectRoot, "presentation.json");
    const outputDirectory = pathApi.join(projectRoot, "dist");
    const output = pathApi.join(outputDirectory, "nested/index.js");
    for (const target of outside) {
      const { projectPath, projectOutput } = guards(projectRoot, pathApi, {
        realPaths: new Map([
          [input, target],
          [outputDirectory, pathApi.dirname(target)],
        ]),
        existingPaths: new Set([projectRoot, outputDirectory]),
      });
      assert.throws(() => projectPath(input), /inside the Data app project/u);
      assert.throws(() => projectOutput(output), /inside the Data app project/u);
    }
  });
}
