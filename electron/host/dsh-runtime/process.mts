// 在插件 import 之前应用 Node 权限；环境不继承应用凭据。
// Node 权限用于限制文件写入、进程启动和扩展加载，不提供网络隔离。
import { fork } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";

const real = (value: string) => { try { return realpathSync(value); } catch { return path.resolve(value); } };
export function spawnPluginProcess(entry: string, { profileDir, packageDir, workspacePath, dataDir, readOnlyWorkspace = false }: any) {
  const applicationDir = real(fileURLToPath(new URL("../../../", import.meta.url)));
  const appRoot = path.basename(applicationDir) === "dist" ? path.dirname(applicationDir) : applicationDir;
  // 打包时进程入口及公开依赖必须在 app.asar.unpacked，原生 Node 无法读取 asar。
  const unpack = (value: string) => value.endsWith(`${path.sep}app.asar`) ? `${value}.unpacked`
    : value.replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`);
  const entryFile = unpack(fileURLToPath(new URL(`./${entry}.${import.meta.url.endsWith(".mts") ? "mts" : "mjs"}`, import.meta.url)));
  const reads = new Set([
    path.dirname(path.dirname(entryFile)),
    path.join(unpack(appRoot), "node_modules"), path.join(unpack(appRoot), "package.json"),
    path.join(real(profileDir), "node_modules"), path.join(real(profileDir), "package.json"),
    ...(packageDir ? [real(packageDir)] : []),
  ]);
  if (workspacePath) reads.add(real(workspacePath));
  if (dataDir) reads.add(real(dataDir));
  const execArgv = ["--permission", ...[...reads].map(dir => `--allow-fs-read=${dir}`)];
  // 此进程原本允许插件联网；新版 Node 需要显式保留该能力，旧版不能传此参数。
  if (process.allowedNodeEnvironmentFlags.has("--allow-net")) execArgv.push("--allow-net");
  if (process.platform === "win32") {
    // 官方运行时包的 Windows 路径依赖 koffi 原生插件：dsh-fs-local 覆盖已有文件时
    // 用 ReplaceFileW 保留 ACL，windows-acl 沙箱也经 koffi 调系统 API。Node 权限模型
    // 默认禁用原生插件，不放行则官方文件服务在 Windows 上无法覆盖任何已有文件。
    // 其余 fs/child 限制仍然生效；macOS/Linux 的 flock 绑定是可选懒加载，维持禁用。
    execArgv.push("--allow-addons");
  }
  if (workspacePath && !readOnlyWorkspace) execArgv.push(`--allow-fs-write=${real(workspacePath)}`);
  if (dataDir) execArgv.push(`--allow-fs-write=${real(dataDir)}`);
  return fork(entryFile, [], {
    execArgv, cwd: real(profileDir), stdio: ["ignore", "ignore", "pipe", "ipc"],
    env: {
      ELECTRON_RUN_AS_NODE: "1", NODE_NO_WARNINGS: "1", SystemRoot: process.env.SystemRoot || "",
      ...(process.mas ? { NARB_DISABLE_NATIVE_CACHE: '1' } : {}),
    },
  });
}
export async function terminatePluginProcess(child: any): Promise<void> {
  if (!child?.pid || child.exitCode != null || child.signalCode != null) return;
  await new Promise<void>(resolve => {
    child.once("exit", () => resolve());
    child.kill("SIGKILL");
  });
}
