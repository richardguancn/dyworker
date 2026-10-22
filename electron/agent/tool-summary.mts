// 工具操作的界面摘要。
import { computerUseAction,isComputerUseTool } from "../computer-use.mts";
import { isKimiFormulaToolName } from "../providers.mts";
import { clipped } from "./shared.mts";

export function mcpToolLabel(name) {
  if (isComputerUseTool(name)) return `本机应用 / ${computerUseAction(name)}`;
  const parts = name.slice(5).split("__");
  return parts.length >= 2 ? `${parts[0]} / ${parts.slice(1).join("__")}` : name;
}

const browserToolLabels = {
  browser__open: "打开网页",
  browser__observe: "观察网页",
  browser__act: "操作网页",
  browser__wait: "等待网页",
  browser__read: "读取网页内容",
  browser__handoff: "转交用户接管",
  browser__tabs: "管理标签页",
  browser__downloads: "查询下载记录",
  browser__snapshot: "查看网页可交互元素",
  browser__click: "点击网页元素",
  browser__type: "在网页中输入文字",
  browser__screenshot: "保存网页截图",
  browser__close: "关闭浏览器",
};

const computerUseToolLabels = {
  check_dependencies: "检查本机操控环境",
  check_permissions: "检查本机操作权限",
  prepare_dependency_install: "生成完整安装预览",
  install_dependencies: "安装缺失的本机操控组件",
  list_apps: "查看本机应用",
  launch_app: "启动本机应用",
  get_app_state: "查看应用界面",
  click: "点击应用界面",
  perform_secondary_action: "执行应用菜单操作",
  set_value: "填写应用控件",
  select_text: "选择应用内文字",
  scroll: "滚动应用界面",
  drag: "拖动应用界面",
  press_key: "在应用中按键",
  type_text: "在应用中输入文字",
};

// 子代理主题：过程流里那一行（「正在执行：X / X 已完成」）只显示主题，
// 优先用模型在 dispatch_agent 里给出的 title，缺失时再从任务描述里挑一句最像主题的话。
// 为什么不直接截任务描述开头：子代理的提示词常带同一套角色/工作区开头（多个子代理
// 前几十个字完全一样），截出来的行标题彼此无法分辨，等于把提示词摊在过程流里。
export function subAgentTopic(title, task) {
  const tidy = (value) => String(value ?? "")
    .replace(/\s+/g, " ")
    .replace(/^[\s"'「『【\[（(]+/, "")
    .replace(/[\s"'」』】\]）)。，、；;：:]+$/, "")
    .trim();
  const given = tidy(title);
  let candidate = given;
  if (!candidate) {
    const text = tidy(task);
    if (!text) return "子任务";
    // 先按句/行断句，模板句（「你是…」「工作区…」）整句丢掉；全是模板句时退回按逗号切分
    const sentences = text.split(/\n+|(?<=[。！？!?；;])/).map(tidy).filter(Boolean);
    const boilerplate = /^(你是|您好|工作区|背景|上下文|角色|以下是|本次)/;
    let pool = sentences.filter((sentence) => !boilerplate.test(sentence));
    if (!pool.length) pool = text.split(/[，,]/).map(tidy).filter((sentence) => sentence && !boilerplate.test(sentence));
    if (!pool.length) pool = sentences.length ? sentences : [text];
    const action = /(写|撰写|编写|整理|核查|核对|校对|调研|分析|收集|搜集|查找|搜索|汇总|生成|创作|排版|配图|修改|更新|检查|排查|翻译|计算|对比|提取|列出)/;
    candidate = pool.find((sentence) => action.test(sentence) && sentence.length <= 60)
      || pool.slice().sort((a, b) => a.length - b.length)[0];
  }
  const stripped = candidate.replace(/^(任务|子任务|目标|要求|要做的事|事项)\s*[：:]\s*/, "");
  // 超长时先在第一处停顿处收口，避免行标题停在半句话中间
  const brief = stripped.length > 24
    ? (stripped.split(/[，,、；;：:]/).map((part) => part.trim()).find(Boolean) || stripped)
    : stripped;
  return clipped(brief, 24);
}

export function toolSummary(name, args) {
  switch (name) {
    case "list_files": return `查看文件夹 ${args.path || "（工作区根目录）"}`;
    case "update_plan": return "更新工作计划";
    case "open_file": return `预览 ${args.path || ""}`;
    case "read_file": return `读取 ${args.path || ""}`;
    case "view_image": return "查看图片";
    case "ocr_file": return `文字识别 ${args.path || ""}`;
    case "write_file": return `写入 ${args.path || ""}`;
    case "edit_file": return `编辑 ${args.path || ""}`;
    case "make_directory": return `创建文件夹 ${args.path || ""}`;
    case "append_file": return `追加内容到 ${args.path || ""}`;
    case "copy_file": return `复制 ${args.source || ""} → ${args.target || ""}`;
    case "move_file": return `移动 ${args.source || ""} → ${args.target || ""}`;
    case "delete_file": return `删除 ${args.path || ""}`;
    case "find_files": return `查找文件：${String(args.pattern || "").slice(0, 40)}`;
    case "search_in_files": return `全文检索：${String(args.query || "").slice(0, 40)}`;
    case "get_datetime": return "获取当前日期时间";
    case "export_excel_workbook": return `导出 Excel ${args.path || ""}`;
    case "run_command": return `运行命令：${String(args.command || "").slice(0, 60)}`;
    case "save_memory": return "保存一条长期记忆";
    case "search_history": return `搜索历史任务：${String(args.query || "").slice(0, 40)}`;
    case "read_history_context": return "查看历史任务上下文";
    case "list_skills": return "查看工作模板列表";
    case "load_skill": return "读取工作模板";
    case "save_skill": return `保存工作模板：${args.name || ""}`;
    case "update_skill": return `改进工作模板：${args.skill_id || ""}`;
    case "web_search": return `搜索网页：${String(args.query || "").slice(0, 40)}`;
    case "gov_search": return `搜索政府官网：${String(args.query || "").slice(0, 40)}`;
    case "fetch_web_page": return `读取网页：${String(args.url || "").slice(0, 60)}`;
    case "scan_sensitive_info": return `保密检查 ${args.path || "（整个工作区）"}`;
    case "check_official_document": return `公文格式检查 ${args.path || ""}`;
    case "calculate_workdays": return "计算办事时限";
    case "export_word_document": return `导出 Word ${args.path || ""}`;
    case "dispatch_agent": return `派发子任务：${subAgentTopic(args.title, args.task)}`;
    case "finish_task": return "交付任务结果";
    case "ask_user": return "向用户提问";
    case "sleep_until": return `挂起到 ${args.wake_at || `${args.minutes || "?"} 分钟后`} 继续`;
    default:
      if (isComputerUseTool(name)) {
        const action = computerUseAction(name);
        const label = computerUseToolLabels[action] || "操作本机应用";
        const app = String(args.app || "").trim();
        const windowTitle = String(args.window_title || "").trim();
        const target = String(args.target_control || "").trim();
        return app
          ? `${label}：${app}${windowTitle ? ` / ${windowTitle}` : ""}${target ? ` / ${target}` : ""}`
          : label;
      }
      if (name.startsWith("browser__")) {
        const label = browserToolLabels[name] || "浏览器操作";
        const target = args.url || args.path || (args.ref != null ? `元素 ${args.ref}` : "");
        return target ? `${label}：${String(target).slice(0, 60)}` : label;
      }
      if (isKimiFormulaToolName(name)) {
        const kimiLabels = {
          convert: "Kimi 转换（单位/格式）",
          web_search: "Kimi 联网搜索",
          rethink: "Kimi 深度思考",
          random_choice: "Kimi 随机选择",
          mew: "Kimi 图像生成",
          memory: "Kimi 记忆",
          excel: "Kimi 表格分析",
          date: "Kimi 日期工具",
          base64: "Kimi Base64 编解码",
          fetch: "Kimi 抓取网页",
          quickjs: "Kimi 代码执行（QuickJS）",
          code_runner: "Kimi 代码运行",
        };
        const label = kimiLabels[name] || `Kimi 官方工具 ${name}`;
        const target = String(args.url || args.query || args.prompt || args.text || "");
        return target ? `${label}：${target.slice(0, 60)}` : label;
      }
      return name.startsWith("mcp__") ? `调用外部工具：${mcpToolLabel(name)}` : name;
  }
}

export function approvalDetails(name, args) {
  if (name === "run_command") return String(args.command || "");
  if (name === "write_file") return `${args.path || ""}\n\n${clipped(String(args.content ?? ""), 2000)}`;
  if (name === "edit_file") {
    return `${args.path || ""}\n\n- 原文：\n${clipped(String(args.find ?? ""), 1000)}\n\n+ 替换为：\n${clipped(String(args.replace ?? ""), 1000)}${args.replace_all ? "\n\n（替换所有出现位置）" : ""}`;
  }
  if (name === "export_word_document") {
    return `${args.path || ""}\n标题：${args.title || "（无）"}\n\n${clipped(String(args.content ?? ""), 2000)}`;
  }
  if (name === "copy_file" || name === "move_file") return `${args.source || ""} → ${args.target || ""}`;
  if (name === "save_skill") return `${args.name || ""}\n${args.description || ""}\n\n${clipped(String(args.instructions || ""), 2000)}`;
  if (name === "update_skill") {
    return `模板：${args.skill_id || ""}\n\n改进后的执行要求：\n${clipped(String(args.instructions || ""), 2000)}`;
  }
  if (name.startsWith("mcp__") || name.startsWith("browser__")) return clipped(JSON.stringify(args, null, 2), 2000);
  return String(args.path || "");
}
