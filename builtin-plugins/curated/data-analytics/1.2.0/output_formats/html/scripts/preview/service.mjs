import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, win32 } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function absolutePath(value, field, platform) {
  const absolute = typeof value === "string" && (platform === "win32"
    ? win32.isAbsolute(value) && /^(?:[a-z]:[\\/]|\\\\[^\\]+\\[^\\]+)/iu.test(value)
    : isAbsolute(value));
  if (!absolute || /[\x00-\x1f\x7f]/.test(value)) {
    throw new Error(`${field} must be an absolute path without control characters.`);
  }
  if (platform === "win32" && value.includes("%")) {
    throw new Error(`${field} cannot contain % because Windows Task Scheduler expands environment variables in paths.`);
  }
  return value;
}

function xml(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

// ExecStart has both C-style argument quoting and systemd's own expansions.
function systemdArgument(value) {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')
    .replaceAll("%", "%%").replaceAll("$", () => "$$")}"`;
}

// File-output directives take the entire path literally, except %-specifiers.
function systemdPath(value) {
  return value.replaceAll("%", "%%");
}

// Task Scheduler supplies a Windows command line directly to the executable.
function windowsArgument(value) {
  return `"${value.replace(/(\\*)"/gu, '$1$1\\"').replace(/(\\+)$/u, "$1$1")}"`;
}

function windowsRunnerArguments(data) {
  const payload = Buffer.from(JSON.stringify(data), "utf8").toString("base64");
  // The serialized runner is part of persisted task ownership. Future runner
  // versions must retain recognition of this format when stopping old tasks.
  const script = `
$ErrorActionPreference = 'Stop'
$data = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}')) | ConvertFrom-Json
$env:NODE_OPTIONS = $null
$env:NODE_PATH = $null
$child = [System.Diagnostics.Process]::new()
$info = $child.StartInfo
$info.FileName = $data.nodePath
$info.Arguments = $data.workerArguments
$info.UseShellExecute = $false
$info.CreateNoWindow = $true
$info.RedirectStandardInput = $true
$info.RedirectStandardOutput = $true
$info.RedirectStandardError = $true
$stdout = $null
$stderr = $null
try {
  $stdout = [System.IO.File]::Open($data.stdoutPath, [System.IO.FileMode]::Append, [System.IO.FileAccess]::Write, [System.IO.FileShare]::Read)
  $stderr = [System.IO.File]::Open($data.stderrPath, [System.IO.FileMode]::Append, [System.IO.FileAccess]::Write, [System.IO.FileShare]::Read)
  $null = $child.Start()
  $outputCopy = $child.StandardOutput.BaseStream.CopyToAsync($stdout)
  $errorCopy = $child.StandardError.BaseStream.CopyToAsync($stderr)
  $child.WaitForExit()
  $outputCopy.GetAwaiter().GetResult()
  $errorCopy.GetAwaiter().GetResult()
  $exitCode = $child.ExitCode
} catch {
  if ($null -ne $stderr) { $stderr.Dispose(); $stderr = $null }
  [System.IO.File]::AppendAllText($data.stderrPath, ($_ | Out-String))
  $exitCode = 1
} finally {
  try { $child.StandardInput.Close() } catch {}
  $child.Dispose()
  if ($null -ne $stdout) { $stdout.Dispose() }
  if ($null -ne $stderr) { $stderr.Dispose() }
}
exit $exitCode
`;
  return `-NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -EncodedCommand ${Buffer.from(script, "utf16le").toString("base64")}`;
}

export function serviceDefinition({
  platform = process.platform,
  homeDir = homedir(),
  id,
  directory,
  nodePath,
  workerPath,
  configPath,
  configHome = process.platform === "linux" ? process.env.XDG_CONFIG_HOME : undefined,
  systemRoot = process.platform === "win32" ? process.env.SystemRoot : "C:\\Windows",
  uid = process.getuid?.(),
}) {
  if (!["darwin", "linux", "win32"].includes(platform)) {
    throw new Error(`Persistent Data previews are unsupported on ${platform}; use macOS, Linux, or Windows with a user service manager.`);
  }
  if (typeof id !== "string" || !/^[a-f0-9]{64}$/.test(id)) {
    throw new Error("The Data preview service ID must be a lowercase SHA-256 hex digest.");
  }
  for (const [field, value] of Object.entries({ homeDir, directory, nodePath, workerPath, configPath })) {
    absolutePath(value, field, platform);
  }
  const paths = platform === "win32" ? win32 : { join };
  const name = `com.openai.data-preview.${id}`;
  const logDirectory = paths.join(directory, "logs");
  const stdoutPath = paths.join(logDirectory, "stdout.log");
  const stderrPath = paths.join(logDirectory, "stderr.log");
  const ownership = `Data preview ${id} ${createHash("sha256").update(configPath).digest("hex")}`;
  const args = [nodePath, workerPath, configPath];
  if (platform === "win32") {
    absolutePath(systemRoot, "SystemRoot", platform);
    const taskExecutable = win32.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    const workerArguments = [workerPath, configPath, "--parent-pipe"].map(windowsArgument).join(" ");
    const taskArguments = windowsRunnerArguments({ nodePath, workerArguments, stdoutPath, stderrPath });
    if (taskExecutable.length + taskArguments.length > 32_000) {
      throw new Error("Windows Data preview paths are too long for a Task Scheduler command line.");
    }
    return {
      platform, name, directory, logDirectory, stdoutPath, stderrPath, ownership, nodePath, workerPath, configPath,
      path: `\\${name}`, taskExecutable, taskArguments, workerArguments,
    };
  }
  if (platform === "darwin") {
    if (!Number.isInteger(uid) || uid < 0) throw new Error("A macOS user ID is required to register a Data preview LaunchAgent.");
    const domain = `gui/${uid}`;
    const contents = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<!-- ${ownership} -->
<plist version="1.0"><dict>
  <key>Label</key><string>${name}</string>
  <key>ProgramArguments</key><array>${args.map((arg) => `<string>${xml(arg)}</string>`).join("")}</array>
  <key>EnvironmentVariables</key><dict><key>NODE_OPTIONS</key><string></string><key>NODE_PATH</key><string></string></dict>
  <key>WorkingDirectory</key><string>${xml(directory)}</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>5</integer>
  <key>StandardOutPath</key><string>${xml(stdoutPath)}</string>
  <key>StandardErrorPath</key><string>${xml(stderrPath)}</string>
</dict></plist>
`;
    return {
      platform, name, directory, logDirectory, stdoutPath, stderrPath, ownership,
      path: join(homeDir, "Library", "LaunchAgents", `${name}.plist`),
      domain, target: `${domain}/${name}`, contents,
    };
  }
  const unit = `${name}.service`;
  // XDG paths must be absolute; relative environment values are ignored.
  const userConfig = typeof configHome === "string" && isAbsolute(configHome)
    ? absolutePath(configHome, "XDG_CONFIG_HOME")
    : join(homeDir, ".config");
  return {
    platform, name: unit, directory, logDirectory, stdoutPath, stderrPath, ownership,
    path: join(userConfig, "systemd", "user", unit),
    contents: `# ${ownership}
[Unit]
Description=Data preview ${id}
StartLimitIntervalSec=0

[Service]
Type=exec
UnsetEnvironment=NODE_OPTIONS NODE_PATH
ExecStart=${args.map(systemdArgument).join(" ")}
Restart=always
RestartSec=5
StandardOutput=append:${systemdPath(stdoutPath)}
StandardError=append:${systemdPath(stderrPath)}

[Install]
WantedBy=default.target
`,
  };
}

// Definition files are evidence of ownership, not proof that the HTTP server is healthy.
export async function serviceInstalled(definition, { run = defaultRun } = {}) {
  if (definition.platform === "win32") return Boolean((await windowsTask(definition, run, "query")).task);
  let info;
  try {
    info = await lstat(definition.path);
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new Error(`Refusing to modify a non-file Data preview service definition: ${definition.path}`);
  }
  const contents = await readFile(definition.path, "utf8");
  const marker = definition.platform === "darwin"
    ? `<!-- ${definition.ownership} -->`
    : `# ${definition.ownership}`;
  if (!contents.split("\n").includes(marker)) {
    throw new Error(`Refusing to modify a service definition not owned by this Data preview: ${definition.path}`);
  }
  return true;
}

// Ownership and login enablement are distinct: disabled owned units still need
// to be stopped/removed, but their presence does not promise a login restart.
export async function serviceEnabled(definition, { run = defaultRun } = {}) {
  if (!await serviceInstalled(definition, { run })) return false;
  if (definition.platform !== "linux") return true;
  try {
    const result = await invoke(definition, run, "systemctl", ["--user", "is-enabled", definition.name]);
    return result.stdout.trim() === "enabled";
  } catch (error) {
    if (error.cause?.code === 1
      && /^(?:disabled|masked|masked-runtime|linked|linked-runtime|not-found)$/u.test(String(error.cause.stdout).trim())) return false;
    throw error;
  }
}

async function defaultRun(command, args, { input } = {}) {
  const pending = execFileAsync(command, args, { timeout: 30_000, maxBuffer: 1024 * 1024, windowsHide: true });
  // execFile's promise exposes its child; send JSON without command-line limits
  // or PowerShell interpolation. Process launch errors reject the promise.
  pending.child.stdin.on("error", () => {});
  pending.child.stdin.end(input);
  return pending;
}

async function invoke(definition, run, command, args, options) {
  try {
    return await run(command, args, options);
  } catch (error) {
    const detail = String(error.stderr || error.message || error).trim();
    const hint = definition.platform === "darwin"
      ? "A logged-in macOS GUI session is required."
      : definition.platform === "win32"
        ? "Windows Task Scheduler and the current user's interactive session are required; administrator access is not used."
        : "A running systemd user session is required; system services and sudo are not used.";
    const action = definition.platform === "win32" ? command : `${command} ${args.join(" ")}`;
    throw new Error(`Could not manage Data preview ${definition.name}: ${action} failed. ${hint} ${detail}`, { cause: error });
  }
}

// All path values are JSON on stdin, never PowerShell syntax.
// InteractiveToken tasks for the current SID are supported without credentials
// or elevation.
const windowsTaskScript = `
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$data = [Console]::In.ReadToEnd() | ConvertFrom-Json
$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$scheduler = New-Object -ComObject 'Schedule.Service'
$scheduler.Connect()
$folder = $scheduler.GetFolder('\\')
$task = $null
try { $task = $folder.GetTask($data.name) }
catch {
  $exception = $_.Exception
  $missing = $false
  while ($null -ne $exception) {
    if ($exception.HResult -eq -2147024894) { $missing = $true }
    $exception = $exception.InnerException
  }
  if (-not $missing) { throw }
}
if ($null -ne $task) {
  $existing = $task.Definition
  $principalSid = $existing.Principal.UserId
  if ($principalSid -notmatch '^S-\\d-\\d+(-\\d+)+$') {
    $principalSid = [System.Security.Principal.NTAccount]::new($principalSid).Translate([System.Security.Principal.SecurityIdentifier]).Value
  }
  if ($existing.RegistrationInfo.Description -cne $data.ownership -or
      $principalSid -ne $sid -or $existing.Principal.LogonType -ne 3 -or
      $existing.Principal.RunLevel -ne 0 -or $existing.Actions.Count -ne 1 -or
      $existing.Actions.Item(1).Type -ne 0 -or
      $existing.Actions.Item(1).Path -ine $data.taskExecutable -or
      $existing.Actions.Item(1).Arguments -cne $data.taskArguments) {
    throw 'Refusing to modify a scheduled task not owned by this Data preview and user.'
  }
}
if ($data.operation -eq 'query') {
  $snapshot = $null
  if ($null -ne $task) {
    $snapshot = @{ description = $existing.RegistrationInfo.Description; userId = $principalSid;
      logonType = $existing.Principal.LogonType; runLevel = $existing.Principal.RunLevel;
      actionCount = $existing.Actions.Count; execute = $existing.Actions.Item(1).Path;
      arguments = $existing.Actions.Item(1).Arguments }
  }
  @{ userId = $sid; task = $snapshot } | ConvertTo-Json -Compress
  exit 0
}
if ($data.operation -eq 'start') {
  if ($null -eq $task) { throw 'The Data preview task was not registered.' }
  $null = $task.Run($null)
  exit 0
}
if ($null -ne $task) {
  $task.Enabled = $false
  if ($task.GetInstances(0).Count -gt 0) { $task.Stop(0) }
  $deadline = [DateTime]::UtcNow.AddSeconds(5)
  while ($task.GetInstances(0).Count -gt 0) {
    if ([DateTime]::UtcNow -gt $deadline) { throw 'The Data preview task is still running; its registration was preserved.' }
    Start-Sleep -Milliseconds 50
  }
}
if ($data.operation -eq 'stop') {
  if ($null -ne $task) { $folder.DeleteTask($data.name, 0) }
  exit 0
}
if ($data.operation -ne 'install') { throw 'Unknown Data preview task operation.' }
$definition = $scheduler.NewTask(0)
$definition.RegistrationInfo.Description = $data.ownership
$definition.Principal.UserId = $sid
$definition.Principal.LogonType = 3
$definition.Principal.RunLevel = 0
$definition.Settings.Enabled = $true
$definition.Settings.AllowDemandStart = $true
$definition.Settings.AllowHardTerminate = $true
$definition.Settings.DisallowStartIfOnBatteries = $false
$definition.Settings.StopIfGoingOnBatteries = $false
$definition.Settings.RunOnlyIfIdle = $false
$definition.Settings.RunOnlyIfNetworkAvailable = $false
$definition.Settings.StartWhenAvailable = $true
$definition.Settings.ExecutionTimeLimit = 'PT0S'
$definition.Settings.MultipleInstances = 2
$timer = $definition.Triggers.Create(1)
$timer.StartBoundary = [DateTime]::Now.AddSeconds(1).ToString("yyyy-MM-dd'T'HH:mm:ss")
$timer.Repetition.Interval = 'PT1M'
$timer.Repetition.StopAtDurationEnd = $false
$logon = $definition.Triggers.Create(9)
$logon.UserId = $sid
$action = $definition.Actions.Create(0)
$action.Path = $data.taskExecutable
$action.Arguments = $data.taskArguments
$action.WorkingDirectory = $data.directory
$null = $folder.RegisterTaskDefinition($data.name, $definition, 6, $sid, $null, 3, $null)
`;

async function windowsTask(definition, run, operation) {
  const input = JSON.stringify({
    operation, name: definition.name, ownership: definition.ownership, directory: definition.directory,
    nodePath: definition.nodePath, workerPath: definition.workerPath, configPath: definition.configPath,
    taskExecutable: definition.taskExecutable, taskArguments: definition.taskArguments,
    workerArguments: definition.workerArguments,
  });
  const result = await invoke(definition, run, definition.taskExecutable, [
    "-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(windowsTaskScript, "utf16le").toString("base64"),
  ], { input });
  if (operation !== "query") return;
  let snapshot;
  try { snapshot = JSON.parse(result.stdout.trim()); }
  catch { throw new Error("Windows Task Scheduler returned an invalid Data preview registration response."); }
  if (typeof snapshot.userId !== "string" || !Object.hasOwn(snapshot, "task")) {
    throw new Error("Windows Task Scheduler returned an incomplete Data preview registration response.");
  }
  const task = snapshot.task;
  if (task !== null && (task.description !== definition.ownership || task.userId !== snapshot.userId
    || task.logonType !== 3 || task.runLevel !== 0 || task.actionCount !== 1
    || typeof task.execute !== "string" || task.execute.toLowerCase() !== definition.taskExecutable.toLowerCase()
    || task.arguments !== definition.taskArguments)) {
    throw new Error("Refusing to modify a scheduled task not owned by this Data preview and user.");
  }
  return snapshot;
}

async function unloadLaunchAgent(definition, run) {
  try {
    await invoke(definition, run, "launchctl", ["bootout", definition.target]);
  } catch (error) {
    // bootout is idempotent only for launchd's explicit missing-service response.
    // Permission, GUI-session and I/O errors must still be reported to the caller.
    if (!/could not find (?:specified )?service|no such process/i.test(String(error.cause?.stderr || ""))) throw error;
  }
}

async function writeDefinition(definition) {
  await mkdir(dirname(definition.path), { recursive: true, mode: 0o700 });
  await mkdir(definition.logDirectory, { recursive: true, mode: 0o700 });
  const temporary = `${definition.path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, definition.contents, { mode: 0o600, flag: "wx" });
    await rename(temporary, definition.path);
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function installService(definition, { run = defaultRun } = {}) {
  if (definition.platform === "win32") {
    await windowsTask(definition, run, "query");
    await mkdir(definition.logDirectory, { recursive: true, mode: 0o700 });
    await windowsTask(definition, run, "install");
    await windowsTask(definition, run, "start");
    return;
  }
  const installed = await serviceInstalled(definition, { run });
  if (installed && definition.platform === "darwin") await unloadLaunchAgent(definition, run);
  await writeDefinition(definition);
  if (definition.platform === "darwin") {
    await invoke(definition, run, "launchctl", ["bootstrap", definition.domain, definition.path]);
    await invoke(definition, run, "launchctl", ["kickstart", definition.target]);
  } else {
    await invoke(definition, run, "systemctl", ["--user", "daemon-reload"]);
    await invoke(definition, run, "systemctl", ["--user", "enable", "--now", definition.name]);
    if (installed) await invoke(definition, run, "systemctl", ["--user", "restart", definition.name]);
  }
}

export async function stopService(definition, { run = defaultRun } = {}) {
  if (!await serviceInstalled(definition, { run })) return;
  if (definition.platform === "win32") {
    await windowsTask(definition, run, "stop");
    return;
  }
  if (definition.platform === "darwin") {
    await unloadLaunchAgent(definition, run);
  } else {
    await invoke(definition, run, "systemctl", ["--user", "disable", "--now", definition.name]);
  }
  await rm(definition.path);
  if (definition.platform === "linux") await invoke(definition, run, "systemctl", ["--user", "daemon-reload"]);
}
