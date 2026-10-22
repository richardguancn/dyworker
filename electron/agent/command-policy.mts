// 命令路径识别与风险判断。
import { realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { isContainerHeaderReadCommand } from "../container-read-check.mts";
import { workspaceWriteTools } from "../risk.mts";
import { shellCommandSegments,shellWords } from "../shell-syntax.mts";
import { isSafePublicUrl } from "./web-tools.mts";
import { isSkillPath } from "./workspace.mts";

export const pathArgumentTools = new Set([
  "list_files", "find_files", "search_in_files", "read_file", "view_image", "ocr_file", "write_file", "edit_file",
  "make_directory", "append_file", "delete_file", "scan_sensitive_info",
  "check_official_document", "export_word_document", "export_excel_workbook",
]);


// 这些 shell 词不是真实的文件访问，不应触发“工作区外路径”授权：
// - `2>/dev/null`（Windows 为 `2>NUL`）之类的设备文件/设备名
// - awk/sed/grep 正则片段（如 '/\.swipe-content \{/,/\}/'），特征是含花括号，
//   或 POSIX 下含反斜杠（shellWords 已消费路径里的合法转义，剩下的反斜杠基本只出现在正则里）
// 注意 Windows 盘符/UNC 路径常含 GUID 花括号（如 C:\Temp\{ABCD-…}），不能按正则片段误杀；
// `../{x}` 这类相对逃逸也保留候选，宁可多问一次。
const safeDeviceFiles = new Set([
  "/dev/null", "/dev/zero", "/dev/tty", "/dev/stdin", "/dev/stdout", "/dev/stderr", "/dev/random", "/dev/urandom",
]);
const windowsDeviceNamePattern = /^(?:nul|con|prn|aux|com[1-9]|lpt[1-9]):?$/i;

function isPseudoPathWord(word) {
  if (!word) return true;
  if (process.platform === "win32") {
    if (windowsDeviceNamePattern.test(word)) return true;
    // Git Bash / MSYS2 里同样存在 POSIX 设备路径，它指向空设备而不是工作区外的数据
    if (safeDeviceFiles.has(word)) return true;
    // cmd.exe 的程序开关不是路径：copy /Y、findstr /N、dir /S 里的 /Y /N /S
    // 按 Windows 路径解析会落到当前盘符根目录，被误判成工作区外访问。
    if (/^\/[A-Za-z]{1,2}$/.test(word)) return true;
    // 盘符、UNC、`..` 开头的按真实路径处理，不做正则片段猜测
    if (/^(?:[a-zA-Z]:[\\/]|[\\/]{2}|\.{1,2}[\\/])/.test(word)) return false;
    // Windows 不把反斜杠当转义符，POSIX 写法的转义序列会原样留下反斜杠，
    // 这种词按 Windows 路径解析等于“当前盘符根目录下的相对路径”，会被误判成工作区外路径。
    if (/^\\[$`()|&;<>*?]/.test(word)) return true;
    return /[{}]/.test(word) || (/^\//.test(word) && word.includes("\\"));
  }
  if (safeDeviceFiles.has(word)) return true;
  if (/^\.{1,2}\//.test(word)) return false;
  return /[{}]/.test(word) || word.includes("\\");
}

// 可执行文件所在根目录：系统 bin、PATH 里的目录、常见版本管理器。
// 命令里出现的解释器/工具路径（如 /opt/homebrew/bin/bun）是"正在运行的工具"，
// 不是"被访问的数据"，不应触发"工作区外路径"审批。
function collectExecutableRoots() {
  const roots = [];
  if (process.platform !== "win32") {
    roots.push("/usr/bin", "/bin", "/usr/sbin", "/sbin",
      "/usr/local/bin", "/usr/local/sbin",
      "/opt/homebrew/bin", "/opt/homebrew/sbin", "/opt/local/bin",
      "/snap/bin", "/usr/libexec");
    const home = os.homedir();
    for (const sub of [".nvm", ".pyenv", ".volta", ".bun", ".deno",
      ".local/bin", "Library/pnpm", ".cargo/bin", ".go/bin"]) {
      roots.push(path.join(home, sub));
    }
  } else {
    // Windows：系统目录、Program Files、包管理器与版本管理器的 shim 目录
    const home = os.homedir();
    roots.push("C:\\Windows\\System32", "C:\\Windows", "C:\\Windows\\System32\\WindowsPowerShell");
    for (const envName of ["ProgramFiles", "ProgramFiles(x86)", "ProgramW6432"]) {
      if (process.env[envName]) roots.push(process.env[envName]);
    }
    const localAppData = process.env.LOCALAPPDATA || path.join(home, "AppData", "Local");
    const roaming = process.env.APPDATA || path.join(home, "AppData", "Roaming");
    roots.push(path.join(localAppData, "Programs"), path.join(roaming, "npm"));
    // scoop / chocolatey / nvm-windows / pyenv-win
    roots.push(path.join(home, "scoop", "shims"), "C:\\ProgramData\\chocolatey\\bin");
    if (process.env.NVM_HOME) roots.push(process.env.NVM_HOME);
    if (process.env.PYENV) roots.push(process.env.PYENV);
    // Git Bash / MSYS2 与手动安装的版本管理器也常把工具链放在家目录下，
    // 与 POSIX 分支保持一致的豁免，避免把"正在运行的工具"误报成访问工作区外数据
    for (const sub of [".nvm", ".pyenv", ".volta", ".bun", ".deno",
      ".local/bin", ".cargo/bin", ".go/bin"]) {
      roots.push(path.join(home, sub));
    }
  }
  for (const dir of String(process.env.PATH || "").split(process.platform === "win32" ? ";" : ":")) {
    if (dir.trim()) roots.push(dir.trim());
  }
  return roots;
}
const executableRoots = collectExecutableRoots();

export function isExecutableRooted(word) {
  const normalized = path.resolve(String(word || ""));
  if (!normalized || normalized === path.parse(normalized).root) return false;
  if (process.platform === "linux" && /^\/home\/[^/]+\/\.local\/bin(?:\/|$)/.test(normalized)) {
    return true;
  }
  return executableRoots.some((root) => {
    const resolvedRoot = path.resolve(root);
    return normalized === resolvedRoot || normalized.startsWith(resolvedRoot + path.sep);
  });
}

// 每个复合段（&&/||/;/| 分隔）真正运行的程序词：跳过前导的包装命令
// （nohup/env/time 等）与环境赋值（FOO=bar），取剩下的第一个词作为该段的 argv[0]
const commandWrapperPrograms = new Set(["nohup", "setsid", "env", "time", "nice", "xargs", "command", "builtin"]);

export function basenameOf(word) {
  const text = String(word || "");
  return text.includes("/") ? text.slice(text.lastIndexOf("/") + 1) : text;
}

function commandPathCandidates(command, workspace) {
  const candidates = [];
  let directories = [workspace.root];
  let skippedDirectories = [];
  const segments = shellCommandSegments(command);
  // 动态执行片段的目录变化无法静态证明，沿用保守候选，不据此消除越界提示。
  let trackDirectories = !/[`()]/.test(String(command || ""))
    && !segments.some((segment, index) => segment.operator === "||" || segment.operator === "&"
      || (shellWords(segment.text)[0] === "cd" && (segment.operator === "|" || segments[index - 1]?.operator === "|")));
  // 逐段（&&/||/;/| 分隔）处理：每个词的上下文（所属段的 argv[0]、前一个词）都在段内判断
  for (const { text: segment, operator } of segments) {
    const words = shellWords(segment);
    // 段头：跳过前导的环境赋值（FOO=bar）与包装命令（nohup/env/time 等），取剩下的第一个词
    let headIndex = 0;
    while (headIndex < words.length) {
      const word = words[headIndex];
      if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(word)) { headIndex += 1; continue; }
      if (commandWrapperPrograms.has(basenameOf(word))) { headIndex += 1; continue; }
      break;
    }
    // 只读段（ls/cat/grep 等受信只读程序）查看可执行根目录不算访问数据——
    // 系统 bin 与版本管理器目录里没有隐私数据，查看它们是正常开发操作
    const readOnlySegment = headIndex < words.length && trustedReadOnlyPrograms.has(basenameOf(words[headIndex]));
    for (let index = 0; index < words.length; index += 1) {
      const word = words[index];
      // 环境赋值取等号右侧；PATH=a:b:c 这类值按分隔符拆开逐项判断，
      // 否则 `$HOME/.nvm/bin:$PATH` 会粘成一个候选被误判为工作区外路径
      // （Windows 路径分隔符是分号且盘符含冒号，不拆）
      // 嵌套命令中的 =、URL 与 awk/sed 表达式不是环境赋值，不能从中拆出假路径。
      const assignment = /^([A-Za-z_][A-Za-z0-9_]*|--[\w-]+)=([\s\S]*)$/.exec(word);
      const pieces = assignment
        ? (process.platform !== "win32" && /^(?:.*_)?PATH$/i.test(assignment[1]) ? assignment[2].split(":") : [assignment[2]])
        : [word];
      for (const piece of pieces) {
        let expanded = piece;
        if (/^~(?=[\\/]|$)/.test(expanded)) expanded = path.join(os.homedir(), expanded.slice(1));
        else if (/^\$HOME(?=[\\/]|$)/.test(expanded)) expanded = path.join(os.homedir(), expanded.slice("$HOME".length));
        else if (/^\$\{HOME\}(?=[\\/]|$)/.test(expanded)) expanded = path.join(os.homedir(), expanded.slice("${HOME}".length));
        else if (/^\$PWD(?=[\\/]|$)/.test(expanded)) expanded = `.${expanded.slice("$PWD".length)}`;
        else if (/^\$\{PWD\}(?=[\\/]|$)/.test(expanded)) expanded = `.${expanded.slice("${PWD}".length)}`;
        // 拆开后残留的 $PATH 等未展开变量不是真实路径
        if (!expanded || expanded.startsWith("$") || isPseudoPathWord(expanded)) continue;
        // 豁免 A：本段的 argv[0] 且位于可执行根目录下 —— 运行工具不是访问数据。
        // 只豁免已知根（如 /usr/bin、PATH、版本管理器、~/.local/bin）
        if (index === headIndex && isExecutableRooted(expanded)) continue;
        // 虚拟环境的 python 常链接到工作区外的系统解释器。只在程序位置核对
        // 真实落点；同一路径作为 cat/cp 等的数据参数时仍接受外部访问检查。
        if (index === headIndex && /[\\/]/.test(expanded) && !/[$`]/.test(expanded)
          && directories.every(directory => isKnownExecutableTarget(workspace.canonicalPath(path.resolve(directory, expanded))))) continue;
        // 豁免 B：解释器/脚本运行器直接执行的根目录脚本或技能脚本
        if (index > 0 && (scriptRunnerPrograms.has(basenameOf(words[index - 1])) || shellWrapperPrograms.has(basenameOf(words[index - 1])))) {
          if (isExecutableRooted(expanded)) continue;
          if (isSkillPath(expanded)) continue;
        }
        // 豁免 C：环境变量赋值（如 P=/usr/local/bin/python3、BUN=/opt/homebrew/bin/bun、API=~/.agents/skills/...）指向可执行根目录或技能目录。
        // PATH 搜索路径变量赋值不在此豁免（外部目录照常上报由审核流程判断）
        const varName = assignment?.[1] || "";
        if (assignment && !/^(?:.*_)?PATH$/i.test(varName) && (isExecutableRooted(expanded) || isSkillPath(expanded))) continue;
        // 豁免 D：只读段查看可执行根目录（如 ls -d ~/.nvm/versions/node/*​/bin/node、which 同类检查），
        // 纯 inspection，不涉及隐私数据；删除/移动/写入段不适用，仍照常上报
        if (readOnlySegment && isExecutableRooted(expanded)) continue;
        // 相对文件参数按该段可能的执行目录解析；未切目录时保留原表示，兼容现有授权记录。
        if (trackDirectories && !path.isAbsolute(expanded) && /[\\/]|^\./.test(expanded)
          && !/^[a-z][a-z0-9+.-]*:/i.test(expanded)) {
          for (const directory of directories) candidates.push(directory === workspace.root ? expanded : path.resolve(directory, expanded));
        } else candidates.push(expanded);
      }
    }
    if (trackDirectories && words[0] === "cd") {
      const target = words.length === 2 ? words[1] : "";
      if (target && !target.startsWith("-") && !/[$`<>]/.test(target)) {
        const expanded = /^~(?=[\\/]|$)/.test(target) ? path.join(os.homedir(), target.slice(1)) : target;
        const changed = directories.map(directory => workspace.canonicalPath(path.resolve(directory, expanded)));
        // && 的下一段仅在 cd 成功时执行；; / 换行还需考虑 cd 失败后沿用旧目录。
        // || 的下一段仅在 cd 失败时执行；管道、后台中的 cd 不改变下一段的目录。
        if (operator === "&&") { skippedDirectories = [...new Set([...skippedDirectories, ...directories])]; directories = [...new Set(changed)]; }
        else if (operator === ";" || operator === "\n") directories = [...new Set([...directories, ...changed])];
        if (directories.length > 32) { trackDirectories = false; directories = [workspace.root]; }
      }
    }
    if (operator === ";" || operator === "\n") {
      directories = [...new Set([...directories, ...skippedDirectories])]; skippedDirectories = [];
    }
  }
  return candidates;
}

export function externalPathsForTool(workspace, name, args = {} as any) {
  let candidates = [];
  const isWrite = workspaceWriteTools.has(name);
  if (pathArgumentTools.has(name) && args.path) candidates.push(args.path);
  if (name === "copy_file" || name === "move_file") candidates.push(args.source, args.target);
  if (name === "run_command") candidates.push(...commandPathCandidates(args.command, workspace));
  return [...new Set(candidates
    .map((value) => String(value || "").trim())
    .filter((value) => value && workspace.isOutside(value, { forWrite: isWrite }) && !workspace.isAuthorized(value, { forWrite: isWrite })))];
}

// 受信只读程序与复合命令拆分：
// 单一只读命令自不必说；`cd 子目录 && grep … ; git log … | head` 这种每一环都只读的
// 复合命令也自动放行——只读操作不会因为发生在工作区子目录就变成高风险。
// 判定前会剥离 `2>/dev/null`、`2>&1`（Windows 为 `2>NUL`）这类无害重定向；
// 出现文件重定向、命令替换、反引号、未识别的段，一律照常询问。
const trustedReadOnlyPrograms = new Set([
  "ls", "pwd", "cat", "head", "tail", "find", "grep", "rg", "echo", "printf",
  "wc", "file", "stat", "du", "df", "which", "date", "uname",
  "sort", "uniq", "diff", "comm", "tr", "basename", "dirname", "realpath",
]);
const trustedGitReadOnlySubcommands = new Set(["status", "diff", "log", "show", "branch", "ls-files", "remote"]);
// 这些子命令虽在白名单里，但带上特定参数就会变更数据，需要排除：
// branch 的删除/改名/复制标志（-d/-D/-m/-M/-c/-C，含 -df、-qD、-mnewname 这类
// 组合短选项与连写取值）和 remote 的变更子命令
const gitBranchMutationArg = (token) =>
  /^--(delete|move|copy|edit-description)(=|$)/.test(token) || /^-[^-]*[dDmMcC]/.test(token);
const gitRemoteMutationSubcommands = new Set(["add", "remove", "rm", "set-url", "set-head", "set-branches", "prune", "rename", "update"]);
const findMutationFlags = /^-(delete|exec|execdir|ok|okdir|fls|fprint|fprintf|fprint0|fprintf0)$/;
// uniq 的 -f/-s/-w 及长形式带独立取值，统计位置参数时需一并跳过其值
const uniqValueFlags = new Set(["-f", "-s", "-w", "--skip-fields", "--skip-chars", "--check-chars"]);

export const interpreterPrograms = new Set(["python3", "python", "node", "deno", "perl", "ruby", "php"]);
export const scriptRunnerPrograms = new Set([...interpreterPrograms, "bun", "bunx", "tsx", "ts-node"]);
let knownExecutableTargets: Set<string>;
function isKnownExecutableTarget(target: string) {
  if (isExecutableRooted(target)) return true;
  // macOS 的系统 Python 入口还可能链接到 Frameworks，Homebrew 则链接到 Cellar。
  // 只认可已知工具入口的真实目标，不把整个 Frameworks/Cellar 加入访问豁免目录。
  if (!knownExecutableTargets) {
    knownExecutableTargets = new Set();
    for (const root of executableRoots) for (const program of scriptRunnerPrograms) {
      try { knownExecutableTargets.add(realpathSync(path.join(root, program))); } catch {}
    }
  }
  return knownExecutableTargets.has(target);
}
const shellWrapperPrograms = new Set(["sh", "bash", "zsh", "dash", "ash"]);
const dangerousOnlyAsCommand = new Set(["eval", "exec", "source", "."]);

const curlUploadFlags = new Set([
  "-d", "--data", "--data-raw", "--data-ascii", "--data-binary", "--data-urlencode", "--json",
  "-F", "--form", "--form-string",
  "-T", "--upload-file",
  "-u", "--user", "--netrc", "--netrc-file", "--netrc-optional", "--oauth2-bearer",
]);
const curlMutatingMethods = new Set(["POST", "PUT", "DELETE", "PATCH"]);

export function isSafeCurlInvocation(words = [], downstreamWords = words) {
  // 禁止管道流向执行环境（curl ... | bash / sh / python 等任意解释器与脚本包装器）。
  // downstreamWords 只包含同管道的后续级——兄弟命令（&& python3 p.py）不是消费者
  const dangerousExecutors = new Set([...shellWrapperPrograms, ...interpreterPrograms, ...dangerousOnlyAsCommand]);
  if (downstreamWords.some((token) => dangerousExecutors.has(basenameOf(token)))) {
    return false;
  }
  let hasUrl = false;
  for (let i = 0; i < words.length; i += 1) {
    const token = words[i];
    if (curlUploadFlags.has(token)) return false;
    if (token === "-X" || token === "--request") {
      const method = String(words[i + 1] || "").toUpperCase();
      if (curlMutatingMethods.has(method)) return false;
    }
    if (token.startsWith("-X") && curlMutatingMethods.has(token.slice(2).toUpperCase())) return false;
    if (/^https?:\/\//i.test(token)) {
      const check = isSafePublicUrl(token);
      if (!check.ok) return false;
      hasUrl = true;
    }
  }
  return hasUrl;
}

const wgetUploadFlags = new Set([
  "--post-data", "--post-file", "--method=POST", "--method=PUT", "--method=DELETE", "--method=PATCH",
  "--http-user", "--http-password", "--user", "--password",
]);

export function isSafeWgetInvocation(words = [], downstreamWords = words) {
  const dangerousExecutors = new Set([...shellWrapperPrograms, ...interpreterPrograms, ...dangerousOnlyAsCommand]);
  if (downstreamWords.some((token) => dangerousExecutors.has(basenameOf(token)))) {
    return false;
  }
  let hasUrl = false;
  for (let i = 0; i < words.length; i += 1) {
    const token = words[i];
    if (wgetUploadFlags.has(token)) return false;
    if (token.startsWith("--method=") && curlMutatingMethods.has(token.slice(9).toUpperCase())) return false;
    if (/^https?:\/\//i.test(token)) {
      const check = isSafePublicUrl(token);
      if (!check.ok) return false;
      hasUrl = true;
    }
  }
  return hasUrl;
}

function isCdSegment(argv) {
  return argv[0] === "cd" && argv.length <= 2;
}

function isTrustedReadOnlySegment(argv) {
  const program = argv[0] || "";
  if (!program || ruleNeverAllowCommands.has(program)) return false;
  if (isCdSegment(argv)) return true;
  if (program === "find") return !argv.some((token) => findMutationFlags.test(token));
  // sort/diff 的 -o/--output 会直接写文件（含 -oFILE、-ro 连写形式），不得按程序名认定为只读
  if (program === "sort" || program === "diff") {
    return !argv.some((token) => token.startsWith("--output") || /^-[^-]*o/.test(token));
  }
  // uniq 的第二个位置参数是输出文件（uniq in.txt out.txt 直接覆盖写入），按位置参数判定
  if (program === "uniq") {
    const positional = [];
    for (let i = 1; i < argv.length; i += 1) {
      const token = argv[i];
      if (token === "--") { positional.push(...argv.slice(i + 1)); break; }
      if (uniqValueFlags.has(token)) { i += 1; continue; } // 标志带独立取值，连同值一起跳过
      // 单独的 - 表示标准输入，是合法的输入位置参数，不能当选项跳过
      if (token === "-") { positional.push(token); continue; }
      if (token.startsWith("-")) continue;
      positional.push(token);
    }
    return positional.length <= 1;
  }
  if (program === "git") {
    const subcommand = argv[1] || "";
    if (!trustedGitReadOnlySubcommands.has(subcommand)) return false;
    if (subcommand === "branch" && argv.some(gitBranchMutationArg)) return false;
    if (subcommand === "remote" && argv.some((token) => gitRemoteMutationSubcommands.has(token))) return false;
    return true;
  }
  if (program === "curl") {
    return isSafeCurlInvocation(argv) && !argv.some((t) => t === "-o" || t === "-O" || t === "--output");
  }
  if (program === "wget") {
    return isSafeWgetInvocation(argv) && !argv.some((t) => t === "-O" || t.startsWith("--output-document"));
  }
  return trustedReadOnlyPrograms.has(program);
}

// 无害重定向：写入空设备（POSIX /dev/null、Windows NUL）或文件描述符复制（2>&1）。
const nullDeviceTarget = process.platform === "win32"
  ? String.raw`(?:NUL:?|"NUL"|'NUL')`
  : String.raw`(?:/dev/null|"/dev/null"|'/dev/null')`;
const safeRedirectionPattern = new RegExp(String.raw`(?:\d*>>?|&>)\s*(?:${nullDeviceTarget}|&\s*\d+)(?=\s|$)`, "gi");
const commandSegmentSplit = /\s*(?:&&|\|\||[;|])\s*/;
// & 不在此列：&&/|| 是复合分隔符，拆分后段内残留的单个 &（后台运行）再单独拒绝
const unsafeCommandRemainder = /[<>`$\\()]/;

// 把命令拆成逐段 argv；只要存在无法确认安全的部分就返回 null（退回人工确认）。
function splitSafeCompoundCommand(command) {
  const text = String(command || "").trim();
  if (!text || /[\r\n]/.test(text)) return null;
  // 剥离安全重定向，以及只读状态变量 $?、$PWD、$HOME，避免误判为动态命令替换
  const stripped = text
    .replace(safeRedirectionPattern, " ")
    .replace(/\$(?:\?|(?:PWD|HOME)\b)/g, " ");
  if (unsafeCommandRemainder.test(stripped)) return null;
  const segments = stripped.split(commandSegmentSplit).map((segment) => segment.trim()).filter(Boolean);
  if (!segments.length) return null;
  const argvList = segments.map((segment) => shellWords(segment));
  // 独立作为命令词的单个 & 是后台执行，依然拒绝；但包含在 URL query 参数（?a=1&b=2）内的 & 不算
  if (argvList.some((argv) => argv.includes("&"))) return null;
  return argvList;
}

export function isAutoApprovableCommand(command) {
  const segments = splitSafeCompoundCommand(command);
  return Boolean(segments) && segments.every(isTrustedReadOnlySegment);
}

// 省心模式（allow-writes）下的常用开发命令自动放行（借鉴 openworker allowed_commands）：
// 包管理器/解释器/测试工具按程序放行；只读段与 cd 可以与其复合（如 `cd mobile && npm test`）；
// 文件重定向、发布/登录类子命令、全局安装、系统破坏性命令永不自动放行。
const devAutoAllowPrograms = new Set(["npm", "pnpm", "yarn", "bun", "python3", "python", "node", "deno", "pytest", "tsc"]);
const devAutoAllowGitCommands = new Set(["status", "diff", "log", "show", "branch", "ls-files", "remote", "add", "commit", "push", "pull", "fetch"]);
const devAutoAllowGlobalFlags = new Set(["-g", "--global", "-G"]);
// 包管理器的发布/账号类子命令会触达外部 registry，不属于工作区内操作
const devBlockedPublishSubcommands = new Set(["publish", "unpublish", "deprecate", "owner", "token", "login", "logout", "adduser", "dist-tag"]);

function isDevAutoApprovableSegment(argv) {
  const program = argv[0] || "";
  if (!program || ruleNeverAllowCommands.has(program)) return false;
  if (isCdSegment(argv) || isTrustedReadOnlySegment(argv)) return true;
  if (program === "git") {
    const subcommand = argv[1] || "";
    if (!devAutoAllowGitCommands.has(subcommand)) return false;
    // 复用只读判定的参数检查：branch -D、remote 变更等危险参数不得因子命令在白名单而放行
    if (subcommand === "branch" && argv.some(gitBranchMutationArg)) return false;
    if (subcommand === "remote" && argv.some((token) => gitRemoteMutationSubcommands.has(token))) return false;
    return true;
  }
  if (!devAutoAllowPrograms.has(program)) return false;
  // 包管理器:发布/登录类子命令、全局安装标志或 yarn global 时不自动放行
  if (devBlockedPublishSubcommands.has(argv[1] || "")) return false;
  if (argv.some((token) => devAutoAllowGlobalFlags.has(token))) return false;
  if (program === "yarn" && argv[1] === "global") return false;
  // 解释器:第一个参数必须是脚本路径,不是 -c/-m/-e 等内联代码或 stdin 标志
  if (["python3", "python", "node", "deno"].includes(program)) {
    const firstArg = argv[1] || "";
    if (!firstArg || firstArg === "-" || firstArg.startsWith("-")) return false;
  }
  return true;
}

export function isDevAutoApprovableCommand(command) {
  const segments = splitSafeCompoundCommand(command);
  return Boolean(segments) && segments.every(isDevAutoApprovableSegment);
}

// 自动审核模式下的低风险开发命令。这里比旧的宽松模式范围更窄：
// 只放行查看、测试、构建、检查这类工作区内操作，不把安装依赖、提交/推送代码、
// 任意脚本或带副作用的命令伪装成安全命令。
const reviewerSafeScripts = new Set([
  "build", "check", "compile", "coverage", "format", "format:check", "lint",
  "test", "test:agent", "test:desktop", "test:settings", "test:skills", "test:channels",
  "test:memory", "test:packaged-renderer", "typecheck", "validate", "verify",
]);
const reviewerSafeGitCommands = new Set(["status", "diff", "log", "show", "branch", "ls-files", "remote"]);

// env/nohup 这类包装命令本身不做事，只设置环境或忽略挂断，真正执行的程序在后面。
// 逐层剥掉包装后再按同一份清单判断：`env -u -u git status` 这样的只读查看继续免打扰，
// 包装下的变更（remote remove、branch -D、reset 等）剥掉包装后同样被清单拒绝，不会漏检。
// 遇到静态看不清写法（-S/--split-string、未知选项、缺取值）就原样返回，交审核助手判断。
const wrapperAssignment = /^[A-Za-z_][A-Za-z0-9_]*=/;
const wrapperValueFlags = new Set(["-u", "--unset", "-C", "--chdir"]);
function unwrapCommandWrappers(argv) {
  let current = argv;
  for (let depth = 0; depth < 4; depth += 1) {
    const program = current[0] || "";
    if (program === "nohup") {
      const start = current.findIndex((token, index) => index > 0 && !token.startsWith("-"));
      if (start < 0) return argv;
      current = current.slice(start);
      continue;
    }
    if (program !== "env") return current;
    let start = -1;
    for (let index = 1; index < current.length; index += 1) {
      const token = current[index];
      if (token === "--") { start = index + 1; break; }
      // -S/--split-string 把一整条命令当字符串再拆，静态解析看不出真实程序
      if (token === "-S" || token.startsWith("--split-string")) return argv;
      if (wrapperValueFlags.has(token)) {
        if (index + 1 >= current.length) return argv;
        index += 1;
        continue;
      }
      if (/^--(?:unset|chdir)=/.test(token) || /^-u.+/.test(token)) continue;
      if (token === "-i" || token === "--ignore-environment" || token === "-0" || token === "--null") continue;
      if (wrapperAssignment.test(token)) continue;
      if (token.startsWith("-")) return argv;
      start = index;
      break;
    }
    if (start < 0 || start >= current.length) return argv;
    current = current.slice(start);
  }
  return argv;
}

function isReviewerAutoApprovableSegment(argv) {
  const unwrapped = unwrapCommandWrappers(argv);
  if (unwrapped !== argv) {
    // Node 启动选项可预加载任意脚本，不能只看包装后那段版本表达式。
    if (basenameOf(unwrapped[0] || "") === "node" && argv.some(token => /^NODE_(?:OPTIONS|PATH)=/.test(token))) return false;
    return isReviewerAutoApprovableSegment(unwrapped);
  }
  const program = argv[0] || "";
  if (!program || ruleNeverAllowCommands.has(program)) return false;
  // 仅识别读取 JSON 版本字段这一种表达式；不放行任意解释器代码或预加载参数。
  const executable = program.startsWith("~/") ? path.join(os.homedir(), program.slice(2)) : program;
  if ((program === "node" || (basenameOf(program) === "node" && isExecutableRooted(executable)))
    && argv.length === 3 && argv[1] === "-p"
    && /^require\((['"])\.\/package\.json\1\)\.version$/.test(argv[2])) return true;
  if (isCdSegment(argv) || isTrustedReadOnlySegment(argv)) return true;
  if (program === "git") {
    const subcommand = argv[1] || "";
    if (!reviewerSafeGitCommands.has(subcommand)) return false;
    // 复用只读判定的参数检查：branch -D、remote 变更等危险参数不得因子命令在白名单而放行
    if (subcommand === "branch" && argv.some(gitBranchMutationArg)) return false;
    if (subcommand === "remote" && argv.some((token) => gitRemoteMutationSubcommands.has(token))) return false;
    return true;
  }
  if (["npm", "pnpm", "yarn", "bun"].includes(program)) {
    if (argv[1] === "test") return true;
    return argv[1] === "run" && reviewerSafeScripts.has(argv[2] || "");
  }
  if (program === "tsc") return argv.includes("--noEmit") && !argv.includes("--build");
  if (program === "eslint") return !argv.includes("--fix");
  if (program === "prettier") return argv.includes("--check") && !argv.includes("--write");
  if (program === "pytest") return true;
  return false;
}

export function isReviewerAutoApprovableCommand(command) {
  const text = String(command || "").trim();
  if (!text) return false;
  if (isContainerHeaderReadCommand(text)) return true;
  // 多行命令按行核对：每行都要通过同一份清单，任意一行不通过就整条交审核助手。
  // 续行符（行尾 \）让后续内容不可见，直接不认；行内 <>|& 与解释器内联代码由单行检查拦下。
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length !== 1) {
    return lines.length > 0 && lines.every((line) => !line.endsWith("\\") && isReviewerAutoApprovableCommand(line));
  }
  const segments = splitSafeCompoundCommand(text) || splitReviewerLiteralCommand(text);
  return Boolean(segments) && segments.every(isReviewerAutoApprovableSegment);
}

// 旧拆分器保守拒绝所有括号，也会拆开引号内的分号。补充识别字面量参数，
// 仍拒绝动态展开、转义、重定向、后台执行和未闭合引号，不猜测 shell 运行结果。
function splitReviewerLiteralCommand(text) {
  let quote = "";
  for (const char of text) {
    if (quote) {
      if (char === quote) quote = "";
      else if (quote === '"' && /[$`\\]/.test(char)) return null;
    } else if (char === "'" || char === '"') quote = char;
    else if (/[<>`$\\(){}#\r\n]/.test(char)) return null;
  }
  if (quote) return null;
  const segments = shellCommandSegments(text);
  if (segments.some(segment => segment.operator === "&" || !segment.text.trim())) return null;
  return segments.map(segment => shellWords(segment.text));
}

// 危险命令清单（供 isLowRiskCommand 使用，渠道「自动执行」模式按它放行低风险命令）。
// 替我审批（reviewer）模式不再用它直接放行：程序清单永远列不全，未知工具
// （npm 全局安装、第三方 CLI、任意二进制）会被它静默放行。reviewer 只对可证明只读
// 的命令走快速通道（isReviewerAutoApprovableCommand），其余交审核助手结合用户原话判断。
const dangerousCommandPrograms = new Set([
  "rm", "rmdir", "unlink", "shred", "dd", "mkfs", "fdisk", "parted",
  "mount", "umount", "sudo", "su", "doas", "pkexec",
  "kill", "killall", "pkill", "passwd", "crontab",
  "chown", "chgrp", "useradd", "usermod", "userdel", "groupadd", "groupmod", "groupdel",
  "iptables", "ip6tables", "firewall-cmd", "systemctl", "launchctl", "scutil", "diskutil",
  "shutdown", "reboot", "halt", "poweroff",
]);
// git 的对外与破坏性用法；提交、拉取、日常查看都自动放行
const riskyGitSubcommands = new Set([
  "push", "reset", "clean", "rebase", "checkout", "switch", "restore", "rm",
  "filter-branch", "update-ref", "stash", "apply",
]);
// 危险标志：--force/--hard/--delete 长选项，以及含 -d/-D/-f 的短选项簇（-df、-qD、-qf 连写）
const riskyGitFlags = /^(--force|--hard|--delete|-[^-]*[dDf])/;
const inlineCodeFlags = new Set(["-c", "-e", "--eval", "-m"]);

// 低风险判定里的 git 段级检查：先定位子命令（跳过 -C <path>、--git-dir <dir> 等带值全局选项），
// 拒绝危险子命令与 branch/remote 的变更参数——被只读/白名单判定拒绝的操作必须在此同样拒绝，
// 否则会经低风险分支重新放行（安全验收 2026-09-06 问题 2）
// 每段只扫描一次，检查所有 git 候选位置（包括 env/nohup 等包装后的程序）。
// 保守设计：不做「前一词像带值选项就跳过」的推测——env -u -u git … 中第二个 -u 是
// 第一个 -u 的取值（名为 -u 的变量），git 是真正的程序，推测跳过会造成漏检。
// 无法证明只是参数的候选也保守检查；不能因一个候选安全就放过后面的危险候选。
function isGitSegmentRisky(words) {
  const valueTakingGlobalFlags = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--exec-path", "--super-prefix"]);
  for (let gitIndex = 0; gitIndex < words.length; gitIndex += 1) {
    if (words[gitIndex] !== "git" && basenameOf(words[gitIndex]) !== "git") continue;
    // 跳过 git 的全局选项定位子命令
    let i = gitIndex + 1;
    while (i < words.length && words[i].startsWith("-")) {
      i += valueTakingGlobalFlags.has(words[i]) ? 2 : 1;
    }
    const subcommand = words[i] || "";
    if (riskyGitSubcommands.has(subcommand)) return true;
    if (subcommand === "branch" && words.slice(i + 1).some(gitBranchMutationArg)) return true;
    // remote 自身可带 -v 等选项，变更子命令未必紧邻其后：扫描其后全部 token
    if (subcommand === "remote" && words.slice(i + 1).some((token) => gitRemoteMutationSubcommands.has(token))) return true;
  }
  return false;
}

// 下载器（curl/wget）写出文件的落盘名：用于识别「下载后由兄弟段执行」的两步 RCE。
// curl：-o VALUE / -oVALUE / --output=VALUE / --output VALUE，-O 表示取远端名（本地不可知）；
// wget：-O VALUE / --output-document(=VALUE)，缺省时取远端名。
// 远端落盘名本地不可知返回 null（无法关联时不强拦，见下方判定注释）
function downloaderOutputFile(words, program) {
  for (let i = 0; i < words.length; i += 1) {
    const token = words[i];
    if (program === "curl" && token === "-O") return null;
    if (token === "-o" || token === "--output" || (program === "wget" && token === "-O") || token === "--output-document") {
      const value = words[i + 1];
      return value && !String(value).startsWith("-") ? String(value) : null;
    }
    if (token.startsWith("-o") && token.length > 2) return token.slice(2);
    if (token.startsWith("--output=")) return token.slice(9);
    if (token.startsWith("--output-document=")) return token.slice(18);
  }
  return program === "wget" ? null : undefined;
}

const normalizeRefToken = (token) => String(token).replace(/^\.\//, "");

function isSingleLineLowRiskCommand(line) {
  const text = String(line || "").trim();
  if (!text || text.includes("`")) return false;
  // 先按 &&/||/; 拆串行命令，再在命令内按 | 拆管道级：curl/wget 的输出只流向
  // 同管道的后续级。「curl -o f.json && python3 p.py」里兄弟段的解释器不消费
  // 其输出，不能因它出现就整行拒批；真正的管道消费者（curl … | python3 -）仍拦。
  // （2026-09-29 误伤修正：此前把整行所有词当下游，抓取+本地脚本处理的常见链路全部误判）
  const commands = text.split(/&&|\|\||;/);
  const allWords = [];
  const stages = [];
  for (const command of commands) {
    const pipeline = command.split("|");
    for (let stageIndex = 0; stageIndex < pipeline.length; stageIndex += 1) {
      const words = shellWords(pipeline[stageIndex]);
      if (!words.length) continue;
      allWords.push(...words);
      stages.push({ words, pipeline, stageIndex });
    }
  }
  for (const { words, pipeline, stageIndex } of stages) {
    if (isGitSegmentRisky(words)) return false;
    for (let index = 0; index < words.length; index += 1) {
      const word = words[index];
      // /bin/rm 这类带路径的调用也要识别
      const base = word.includes("/") ? word.slice(word.lastIndexOf("/") + 1) : word;
      if (dangerousCommandPrograms.has(word) || dangerousCommandPrograms.has(base)) return false;
      // 登录启动仅由专门规则放行；读令牌、增加权限、切换或撤销账户不能因 gh
      // 不在危险程序名单里而绕过审核。
      if (base === "gh" && words[index + 1] === "auth"
        && (words[index + 2] !== "status" || words.slice(index + 3).some(token => token === "--show-token" || /^-[^-]*t/.test(token)))) return false;
      if (index === 0 && (dangerousOnlyAsCommand.has(word) || dangerousOnlyAsCommand.has(base))) return false;
      // curl / wget：安全的公开只读请求（GET、无上传标志、不流向 shell）视为低风险，放行。
      // 下游只算同管道的后续级；下载文件再由兄弟段处理（python3 p.py）不属管道消费
      if (word === "curl" || base === "curl") {
        const downstream = pipeline.slice(stageIndex + 1).flatMap((stage) => shellWords(stage));
        if (!isSafeCurlInvocation(words, downstream)) return false;
      }
      if (word === "wget" || base === "wget") {
        const downstream = pipeline.slice(stageIndex + 1).flatMap((stage) => shellWords(stage));
        if (!isSafeWgetInvocation(words, downstream)) return false;
      }
      if (["npm", "pnpm", "yarn", "bun"].includes(word) && devBlockedPublishSubcommands.has(words[index + 1] || "")) return false;
      // 解释器内联代码（python3 -c / node -e）等同任意代码，脚本文件则放行
      if (interpreterPrograms.has(base) && words.slice(index + 1).some((token) => inlineCodeFlags.has(token))) return false;
      if (shellWrapperPrograms.has(base) && words[index + 1] === "-c") return false;
    }
  }
  if (!allWords.length) return false;
  if (allWords.includes("git") && allWords.some((token) => riskyGitFlags.test(token))) return false;
  // osascript 包一层 shell 等同任意命令；纯界面脚本交给本机界面操作的审批通道
  if (allWords.includes("osascript")) return false;
  // 两步 RCE 护栏：下载器写出的文件若被本行任何解释器/shell 段当作脚本执行
  // （curl -o i.sh URL && bash i.sh），视同「curl | bash」直接拒绝。
  // 仅按词面关联（去掉 ./ 前缀后全等）；-O/远端默认落盘名不可知，无法关联则不强拦，
  // 由直接管道拦截与审核助手兜底。
  const downloaderOutputs = stages
    .map(({ words }) => {
      const token = words.find((w) => ["curl", "wget"].includes(basenameOf(w)));
      return token ? downloaderOutputFile(words, basenameOf(token)) : undefined;
    })
    .filter((value) => value);
  if (downloaderOutputs.length) {
    const outputs = new Set(downloaderOutputs.map(normalizeRefToken));
    for (const { words } of stages) {
      const program = words[0] ? basenameOf(words[0]) : "";
      const runsScript = scriptRunnerPrograms.has(program) || shellWrapperPrograms.has(program);
      if (!runsScript) continue;
      for (let i = 1; i < words.length; i += 1) {
        const arg = words[i];
        if (arg && !arg.startsWith("-") && outputs.has(normalizeRefToken(arg))) return false;
      }
    }
  }
  return true;
}

export function isLowRiskCommand(command) {
  const text = String(command || "").trim();
  // 反引号无法界定内容边界，保守退回人工
  if (!text || text.includes("`")) return false;
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return false;
  return lines.every((line) => isSingleLineLowRiskCommand(line));
}

export function isLikelyBackgroundCommand(command) {
  const cmd = String(command || "").trim();
  if (/(?:python[3]?\s+-m\s+http\.server|npm\s+run\s+dev|yarn\s+dev|pnpm\s+dev|vite\s*$|vite\s+--|live-server|http-server|ssh\s+-|next\s+dev)/i.test(cmd)) {
    return true;
  }
  return false;
}

// ---- 常驻允许规则（借鉴 openworker standing rules：审批卡片上的"始终允许"）----
// 规则形如 { kind: "path-glob" | "domain" | "mcp-tool" | "command-prefix", tool, pattern, label }。
// 保守边界：本机界面操作、浏览器变更操作一律不可规则化；
// 命令只对受信只读程序（ls/cat/grep 等）开放,且按 argv 前缀匹配、拒绝管道与复合命令
// （对齐 openworker allowed_commands 语义,比放任任意命令的"shell asks forever"更可审计）。
export const ruleEligiblePathTools = new Set(["write_file", "edit_file", "append_file", "export_word_document", "export_excel_workbook"]);
export const ruleEligibleDomainTools = new Set(["fetch_web_page", "browser__open"]);
export const ruleTrustedPrograms = /^(ls|pwd|cat|head|tail|find|grep|rg|echo|printf|wc|file|stat|du|df|which|date|uname)$/;
// 常用开发命令(写操作/网络/构建类)允许按 argv 前缀形成常驻规则,避免同类命令反复确认;
// 宽度=2 表示取前两个词(npm install / npm run),解释器取前两个词贴近具体脚本。
// 未分类程序只记住完整命令本身(精确前缀)。系统级破坏性命令永远不可规则化。
export const ruleDevProgramWidths = {
  npm: 2, npx: 1, pnpm: 2, yarn: 1, bun: 2, corepack: 1, bunx: 1,
  pip: 2, pip3: 2, pipx: 1,
  cargo: 2, go: 2, make: 1, cmake: 1, meson: 2,
  python: 2, python3: 2, node: 2, deno: 2, tsx: 1, "ts-node": 2,
  tsc: 1, vite: 1, electron: 1, code: 1, rg: 1, fd: 1,
};
export const ruleNeverAllowCommands = new Set([
  "rm", "rmdir", "unlink", "dd", "shutdown", "reboot", "halt", "poweroff",
  "mkfs", "mkfs.ext4", "fdisk", "parted", "mount", "umount", "swapoff",
  "sudo", "su", "pkexec", "doas", "kill", "killall", "pkill", "passwd",
  "chown", "chgrp", "useradd", "usermod", "userdel", "groupadd", "groupmod",
  "groupdel", "iptables", "ip6tables", "firewall-cmd", "systemctl",
  "launchctl", "scutil", "diskutil",
]);
export const ruleGitCommands = new Set([
  "status", "diff", "log", "show", "branch", "ls-files", "remote",
  "add", "commit", "push", "pull", "fetch",
]);
export const commandChainingPattern = /[;|`$()]|&&|\|\||\|/;
