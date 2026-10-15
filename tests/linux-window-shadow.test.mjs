import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import fpmModule from "app-builder-lib/out/targets/FpmTarget.js";
import { attachLinuxWindowShadow } from "../electron/linux-window-shadow.mts";

test("圆角仅裁去四角，阴影柔和下移，多种缩放下渐变和四角衔接连续", (t) => {
  const script = fileURLToPath(new URL("../electron/scripts/linux_window_shadow.py", import.meta.url));
  const result = spawnSync("python3", ["-c", `
from pathlib import Path
scope = {"__name__": "shadow_test"}
exec(compile(Path(${JSON.stringify(script)}).read_text(), "shadow_test", "exec"), scope)
for width, height, radius in [(1184,736,scope["CORNER_RADIUS"]), (2,2,14), (1,1,14), (100,30,100), (980,660,0)]:
    rects = scope["rounded_rectangles"](width, height, radius)
    assert all(w > 0 and h > 0 and x >= 0 and y >= 0 and x+w <= width and y+h <= height for x,y,w,h in rects)
    def contains(x,y): return any(a <= x < a+w and b <= y < b+h for a,b,w,h in rects)
    assert contains(width//2, height//2)
    if width > 16 and height > 16 and radius > 0:
        assert not any(contains(x,y) for x,y in [(0,0), (width-1,0), (0,height-1), (width-1,height-1)])
    if radius == 0: assert rects == [(0,0,width,height)]
# The native mask must affect input only; bounding masks are binary and jagged.
import ctypes as C
calls = []
class FakeLib:
    def XShapeCombineRectangles(self, *args): calls.append(("apply", args[2]))
    def XShapeCombineMask(self, *args): calls.append(("reset", args[2]))
class FakeX:
    display = 1
    def sync(self): pass
class Rectangle(C.Structure):
    _fields_ = [("x", C.c_short), ("y", C.c_short), ("w", C.c_ushort), ("h", C.c_ushort)]
shape = scope["RoundedShape"].__new__(scope["RoundedShape"])
shape.x, shape.lib, shape.Rectangle, shape.last_geometry = FakeX(), FakeLib(), Rectangle, None
shape.apply(1, 1184, 736, 14)
shape.apply(1, 1184, 736, 14)
shape.apply(1, 1184, 736, 0)
assert calls == [("apply", 2), ("reset", 2)], calls
for scale in [1, 1.25, 1.5, 2, 4]:
    margins, tiles = scope["shadow_tiles"](scale)
    top, right, bottom, left = margins
    assert len(tiles) == 8
    assert top < left == right < bottom
    # The wider shadow remains visible 40 logical pixels from the edge,
    # rather than becoming effectively transparent around 20 pixels.
    outer_index = tiles[2][0] - right + round(40 * scale)
    assert 2 <= tiles[2][2][0][outer_index] <= 10
    assert all(0 <= pixel <= 64 for _,_,rows in tiles for row in rows for pixel in row)
    # Opacity at the actual window edge: light above, moderate beside,
    # stronger below, without the former 76/255 dark outline.
    upper = tiles[0][2][top-1][0]
    lateral = tiles[2][2][0][tiles[2][0]-right]
    lower = tiles[4][2][tiles[4][1]-bottom][0]
    assert 0 < upper < lateral < lower < 50
    for index, margin in [(0,top), (4,bottom)]:
        rows = tiles[index][2]
        profile = [row[0] for row in rows]
        if index == 4: profile.reverse()
        assert profile[0] == 0
        assert all(a <= b for a,b in zip(profile,profile[1:]))
        assert len(set(profile[:margin])) > 12
    assert tiles[2][2][0][-1] == tiles[6][2][0][0] == 0
    # Every corner joins both adjacent edge tiles with at most rounding
    # error, including the larger bottom margin and fractional scaling.
    for corner, vertical, horizontal, side_sign, down in [
        (1,0,2,1,False), (3,4,2,1,True),
        (5,4,6,-1,True), (7,0,6,-1,False)]:
        rows = tiles[corner][2]
        inner_x = 0 if side_sign > 0 else -1
        inner_y = 0 if down else -1
        assert all(abs(row[inner_x]-edge[0]) <= 1 for row,edge in zip(rows,tiles[vertical][2]))
        assert all(abs(a-b) <= 1 for a,b in zip(rows[inner_y],tiles[horizontal][2][0]))
`], { encoding: "utf8" });
  if (result.error?.code === "ENOENT") return t.skip("本机未安装 Python3");
  assert.equal(result.status, 0, result.stderr || String(result.error));
});

test("Linux 安装包包含阴影助手，并保留打包器要求的原有系统依赖", () => {
  const { build } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  for (const dependency of [...fpmModule.default.prototype.getDefaultDepends("deb"), "python3", "libx11-6", "libxext6"]) {
    assert.ok(build.deb.depends.includes(dependency), `安装包缺少 ${dependency}`);
  }
  assert.ok(build.asarUnpack.includes("dist/electron/scripts/linux_window_shadow.py"));
});

function fixture(options = {}) {
  const window = new EventEmitter();
  let maximized = false;
  let fullscreen = false;
  window.getNativeWindowHandle = () => Buffer.from([42, 0, 0, 0, 0, 0, 0, 0]);
  window.isDestroyed = () => false;
  window.isMaximized = () => maximized;
  window.isFullScreen = () => fullscreen;
  const writes = [], launches = [], logs = [];
  const child = new EventEmitter();
  child.stdin = new EventEmitter();
  child.stdin.writable = true;
  let ended = 0;
  child.stdin.write = value => writes.push(value);
  child.stdin.end = () => { ended++; child.stdin.writable = false; };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  const stop = attachLinuxWindowShadow(window, {
    platform: "linux", env: { DISPLAY: ":99" }, argv: [], scaleFactor: 1.5,
    launch: (...args) => { launches.push(args); return child; },
    log: value => logs.push(value), ...options,
  });
  return { window, child, writes, launches, logs, stop, ended: () => ended,
    setMaximized: value => { maximized = value; },
    setFullscreen: value => { fullscreen = value; } };
}

test("Linux 普通窗口提交阴影，最大化/全屏撤去，还原重新提交", () => {
  const f = fixture();
  assert.equal(f.launches.length, 1);
  const [command, args] = f.launches[0];
  assert.equal(command, "/usr/bin/python3");
  assert.ok(args[0].replaceAll("\\", "/").endsWith("/scripts/linux_window_shadow.py"));
  assert.deepEqual(args.slice(1), ["42", "1.5"]);
  f.setMaximized(true); f.window.emit("maximize");
  f.setMaximized(false); f.window.emit("unmaximize");
  f.setFullscreen(true); f.window.emit("enter-full-screen");
  f.setFullscreen(false); f.window.emit("leave-full-screen");
  assert.deepEqual(f.writes, ["show\n", "hide\n", "show\n", "hide\n", "show\n"]);
  assert.equal(f.ended(), 0, "窗口存在期间保持连接，防止阴影资源提前释放");
  f.window.emit("closed"); f.stop();
  assert.equal(f.ended(), 1);
  assert.deepEqual(f.window.eventNames(), []);
});

test("其他平台、无 X11 和显式原生 Wayland 不启动阴影助手", () => {
  for (const options of [{ platform: "darwin" }, { platform: "win32" },
    { env: {} }, { argv: ["--ozone-platform=wayland"] }]) {
    const f = fixture(options);
    assert.equal(f.launches.length, 0);
    assert.equal(f.window.eventNames().length, 0);
    f.stop();
  }
});

test("助手缺失、退出或管道断开时解除监听，窗口继续正常运行", () => {
  for (const event of ["error", "exit", "pipe-error"]) {
    const f = fixture();
    if (event === "pipe-error") f.child.stdin.emit("error", new Error("EPIPE"));
    else f.child.emit(event, new Error("测试故障"));
    assert.equal(f.ended(), 1);
    assert.deepEqual(f.window.eventNames(), []);
    f.window.emit("show");
    assert.deepEqual(f.writes, ["show\n"]);
  }
});
