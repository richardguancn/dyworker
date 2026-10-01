// 覆盖前快照：整份覆盖型存储（settings.json / workspace-pins.json）的通用兜底
import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { snapshotFileBeforeOverwrite } from "../electron/host/state-snapshot.mts";

async function tempDir(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "dyworker-snap-"));
  t.after(async () => { await fs.rm(dir, { recursive: true, force: true }).catch(() => {}); });
  return dir;
}

test("覆盖前快照：文件不存在时跳过，存在时留 .bak", async (t) => {
  const dir = await tempDir(t);
  const file = path.join(dir, "workspace-pins.json");
  assert.equal((await snapshotFileBeforeOverwrite(file)).reason, "no-existing-file");

  await fs.writeFile(file, JSON.stringify(["/a", "/b"]), "utf8");
  const result = await snapshotFileBeforeOverwrite(file, { now: () => new Date("2026-10-01T10:00:00Z") });
  assert.equal(result.ok, true);
  const bak = path.join(dir, "workspace-pins.json.2026-10-01T10-00-00-000Z.bak");
  assert.deepEqual(JSON.parse(await fs.readFile(bak, "utf8")), ["/a", "/b"]);
});

test("覆盖前快照：只保留最近 5 份", async (t) => {
  const dir = await tempDir(t);
  const file = path.join(dir, "settings.json");
  await fs.writeFile(file, "{}", "utf8");
  for (const iso of ["2026-10-01T01:00:00Z", "2026-10-01T02:00:00Z", "2026-10-01T03:00:00Z", "2026-10-01T04:00:00Z", "2026-10-01T05:00:00Z", "2026-10-01T06:00:00Z"]) {
    await snapshotFileBeforeOverwrite(file, { now: () => new Date(iso) });
  }
  const baks = (await fs.readdir(dir)).filter((n) => n.endsWith(".bak"));
  assert.equal(baks.length, 5, `应只保留 5 份，实际 ${baks.length}`);
});
