import { AlertTriangle, Check, ChevronRight, Download, FolderOpen, Globe, Landmark, LoaderCircle, RefreshCw, Sparkles, SquareTerminal, Trash2, UserRound, X } from "lucide-react";
import { useEffect, useState } from "react";
import { MarkdownSnippet } from "../../InteractiveMessage";
import { defaultSettings } from "../../lib/settings";
import { t } from "../../i18n";
import type { AppUpdateStatus, ChannelConnectionStatus, ChannelsConfig, ChannelsStatusMap, HookRule, ProviderSettings, StandingRule, TelemetrySettings, TelemetryStatus, UserIdentity } from "../../types";

export function FullAccessDialog({ onClose, onConfirm }: { onClose: () => void; onConfirm: () => Promise<boolean> }) {
  const [showDetails, setShowDetails] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape" && !saving) onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose, saving]);

  const confirm = async () => {
    setSaving(true);
    try {
      await onConfirm();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop full-access-backdrop" role="presentation" onMouseDown={() => !saving && onClose()}>
      <div
        className="full-access-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="full-access-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="full-access-title-row">
          <AlertTriangle size={29} strokeWidth={2.2} aria-hidden="true" />
          <h2 id="full-access-dialog-title">{t("fullAccess.title", "开启完全访问？")}</h2> {/* 要开启完整访问权限吗? */}
        </div>
        <p className="full-access-intro">
          {t("fullAccess.intro", "DYWorker 将可在未逐次确认的情况下访问文件、运行命令与网络请求。")}
        </p>
        <div className="full-access-capabilities">
          <div className="full-access-capability">
            <FolderOpen size={31} strokeWidth={1.8} aria-hidden="true" />
            <span>
              <strong>{t("fullAccess.files", "文件目录")}</strong> {/* 文件和文件夹 */}
              <small>{t("fullAccess.filesDesc", "读取、创建、修改和删除此计算机上的文件")}</small>
            </span>
          </div>
          <div className="full-access-capability">
            <SquareTerminal size={31} strokeWidth={1.8} aria-hidden="true" />
            <span>
              <strong>{t("fullAccess.terminal", "系统终端")}</strong> {/* 终端命令 */}
              <small>{t("fullAccess.terminalDesc", "运行命令、安装软件并配置环境")}</small>
            </span>
          </div>
          <div className="full-access-capability">
            <Globe size={31} strokeWidth={1.8} aria-hidden="true" />
            <span>
              <strong>{t("fullAccess.internet", "网络连接")}</strong> {/* 互联网和已连接的应用 */}
              <small>{t("fullAccess.internetDesc", "访问网页、收发数据并调用扩展插件")}</small>
            </span>
          </div>
        </div>
        <p className="full-access-warning">
          {t("fullAccess.warning", "请确保处于可信环境。你可随时切回审批模式。")}
          <button type="button" className="full-access-learn-more" onClick={() => setShowDetails((value) => !value)}>
            {t("common.learnMore", "了解更多")}
          </button>
        </p>
        {showDetails && (
          <p className="full-access-details">
            {t("fullAccess.details", "开启后将减少逐次确认，更适合连续执行任务。可随时从审批菜单切回。")}
          </p>
        )}
        <div className="full-access-actions">
          <button type="button" className="full-access-cancel" onClick={onClose} disabled={saving}>{t("common.cancel", "取消")}</button>
          <button type="button" className="full-access-confirm" onClick={() => void confirm()} disabled={saving}>
            <AlertTriangle size={17} aria-hidden="true" />
            {saving ? t("common.enabling", "开启中…") : t("common.confirm", "确认")}
          </button>
        </div>
      </div>
    </div>
  );
}

export function IdentitySetupDialog({ onChoose }: { onChoose: (identity: UserIdentity) => Promise<boolean> }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const choose = async (identity: UserIdentity) => {
    setSaving(true);
    setError("");
    try {
      const saved = await onChoose(identity);
      if (!saved) setError(t("identity.saveFailedRetry", "身份没有保存成功，请重试。"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop identity-backdrop" role="presentation">
      <div className="identity-dialog" role="dialog" aria-modal="true" aria-labelledby="identity-dialog-title">
        <div className="identity-dialog-mark"><Sparkles size={21} aria-hidden="true" /></div>
        <span className="dialog-kicker">{t("identity.firstTime", "首次使用")}</span> {/* 首次使用 */}
        <h2 id="identity-dialog-title">{t("identity.setupTitle", "你准备怎样使用 DYWorker？")}</h2>
        <p className="identity-dialog-intro">{t("identity.setupIntro", "选择后助手将适配对应场景，可在设置随时调整。")}</p>
        <div className="identity-options">
          <button type="button" className="identity-option" disabled={saving} onClick={() => void choose("general")}>
            <span className="identity-option-icon"><UserRound size={23} aria-hidden="true" /></span>
            <span className="identity-option-copy">
              <strong>{t("identity.generalTitle", "通用办公")}</strong> {/* 通用身份 */}
              <small>{t("identity.generalDesc", "适合日常办公、编程开发与通用工作。")}</small>
            </span>
            <ChevronRight size={18} aria-hidden="true" />
          </button>
          <button type="button" className="identity-option" disabled={saving} onClick={() => void choose("government")}>
            <span className="identity-option-icon"><Landmark size={23} aria-hidden="true" /></span>
            <span className="identity-option-copy">
              <strong>{t("identity.govTitle", "政务公文")}</strong> {/* 政府单位 */}
              <small>{t("identity.govDesc", "遵循公文格式 GB/T 9704 与保密规范。")}</small>
            </span>
            <ChevronRight size={18} aria-hidden="true" />
          </button>
        </div>
        {saving && <p className="identity-dialog-status">{t("identity.savingChoice", "正在保存选择…")}</p>}
        {error && <p className="identity-dialog-error">{error}</p>}
      </div>
    </div>
  );
}

export function IdentitySettingsPanel({ value, onSave }: {
  value: ProviderSettings;
  onSave: (value: ProviderSettings, successMessage?: string) => Promise<boolean>;
}) {
  const [saving, setSaving] = useState(false);
  const select = async (identity: UserIdentity) => {
    if (identity === value.identity) return;
    setSaving(true);
    try {
      await onSave({ ...value, identity }, t("identity.saved", "身份设置已更新"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="identity-settings-panel">
      <div className="dialog-section-title">{t("identity.title", "工作角色")}{/* 助手身份 */}</div>
      <p className="profile-section-hint">{t("identity.hint", "设定对话风格与倾向，随时可切换。")}</p>
      <div className="identity-settings-options">
        <button type="button" className={`identity-option compact ${value.identity === "general" ? "selected" : ""}`} disabled={saving} onClick={() => void select("general")}>
          <span className="identity-option-icon"><UserRound size={20} aria-hidden="true" /></span>
          <span className="identity-option-copy"><strong>{t("identity.generalTitle", "日常办公")}</strong><small>{t("identity.generalDesc", "适合个人、开发与日常通用事务。")}</small></span>
          {value.identity === "general" && <Check size={17} aria-hidden="true" />}
        </button>
        <button type="button" className={`identity-option compact ${value.identity === "government" ? "selected" : ""}`} disabled={saving} onClick={() => void select("government")}>
          <span className="identity-option-icon"><Landmark size={20} aria-hidden="true" /></span>
          <span className="identity-option-copy"><strong>{t("identity.governmentTitle", "机关公文")}</strong><small>{t("identity.governmentDesc", "依国家标准公文格式处理与导出。")}</small></span>
          {value.identity === "government" && <Check size={17} aria-hidden="true" />}
        </button>
      </div>
    </div>
  );
}

// 侧栏「设置」旁的更新按钮：有新版时出现；下载中把按钮本身变成圆环进度，
// 圆环内显示百分比，点击可打开更新对话框查看更新内容
export function AppUpdateAction({
  status,
  onOpen,
  onDownload,
  onInstall,
}: {
  status: AppUpdateStatus;
  onOpen: () => void;
  onDownload: () => void;
  onInstall: () => void;
}) {
  if (!["available", "downloading", "downloaded"].includes(status.state)) return null;
  const percent = Math.round(Math.max(0, Math.min(100, status.percent || 0)));
  const title = status.state === "available"
    ? `发现新版本 ${status.version || ""}，点击下载更新`
    : status.state === "downloading"
      ? `正在下载新版本 ${status.version || ""}（${percent}%），点击查看详情`
      : `新版本 ${status.version || ""} 已下载完成，点击安装更新`;

  if (status.state === "downloading") {
    const size = 30;
    const stroke = 3;
    const radius = (size - stroke) / 2;
    const circumference = 2 * Math.PI * radius;
    return (
      <button
        type="button"
        className="app-update-button downloading"
        title={title}
        aria-label={title}
        aria-valuenow={percent}
        onClick={onOpen}
      >
        <svg className="app-update-ring" width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
          <circle className="app-update-ring-track" cx={size / 2} cy={size / 2} r={radius} strokeWidth={stroke} fill="none" />
          <circle
            className="app-update-ring-bar"
            cx={size / 2}
            cy={size / 2}
            r={radius}
            strokeWidth={stroke}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - percent / 100)}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        </svg>
        <span className="app-update-ring-label">{percent}</span>
      </button>
    );
  }

  const ready = status.state === "downloaded";
  return (
    <button
      type="button"
      className={`icon-button subtle app-update-button${ready ? " ready" : ""}`}
      title={title}
      aria-label={title}
      onClick={ready ? onInstall : onDownload}
    >
      {ready ? <RefreshCw size={17} /> : <Download size={17} />}
    </button>
  );
}

export function AppUpdateDialog({
  status,
  onClose,
  onCheck,
  onDownload,
  onInstall,
}: {
  status: AppUpdateStatus;
  onClose: () => void;
  onCheck: () => void;
  onDownload: () => void;
  onInstall: () => void;
}) {
  const isChecking = status.state === "checking";
  const isDownloading = status.state === "downloading";
  const progress = Math.round(Math.max(0, Math.min(100, status.percent || 0)));
  const latestReleaseUrl = status.updateUrl ? `${status.updateUrl}/releases/latest` : "";
  const openLatestRelease = () => {
    if (latestReleaseUrl) void window.dyworker?.openBrowserExternal?.(latestReleaseUrl);
  };
  const title = status.state === "available"
    ? "发现新版本"
    : status.state === "downloaded"
      ? "更新已准备好"
      : status.state === "downloading"
        ? "正在下载更新"
        : status.state === "error"
          ? "更新检查失败"
          : "应用更新";

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div className="app-update-dialog" role="dialog" aria-modal="true" aria-labelledby="app-update-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="dialog-header">
          <div>
            <span className="dialog-kicker">DYWorker</span>
            <h2 id="app-update-title">{title}</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="关闭更新提示">
            <X size={18} />
          </button>
        </div>
        <p className="app-update-version">当前版本 {status.currentVersion || "未知"}{status.version ? ` · 新版本 ${status.version}` : ""}</p>
        {status.state === "available" && (
          <p className="app-update-copy">DYWorker 已发布新版本，下载完成后重启应用即可完成更新。</p>
        )}
        {(status.state === "available" || status.state === "downloading" || status.state === "downloaded") && status.releaseNotes && (
          <div className="app-update-notes">
            <div className="app-update-notes-title">更新内容</div>
            <div className="app-update-notes-body"><MarkdownSnippet content={status.releaseNotes} /></div>
          </div>
        )}
        {(status.state === "available" || status.state === "downloading" || status.state === "downloaded") && !status.releaseNotes && (
          <p className="app-update-copy">该版本未提供更新说明。</p>
        )}
        {isChecking && <p className="app-update-copy">正在检查 GitHub 标签对应的最新版本，请稍候。</p>}
        {isDownloading && (
          <div className="app-update-progress" aria-label={`下载进度 ${progress}%`}>
            <div className="app-update-progress-track"><span style={{ width: `${progress}%` }} /></div>
            <span>{progress}%</span>
          </div>
        )}
        {status.state === "downloaded" && <p className="app-update-copy">更新文件已下载完成，现在重启应用即可安装。</p>}
        {status.state === "not-available" && <p className="app-update-copy">当前已经是最新版本。</p>}
        {status.state === "unavailable" && <p className="app-update-copy">开发环境或当前安装方式暂不检查更新。</p>}
        {status.state === "error" && <p className="app-update-copy error-text">{status.error || "暂时无法连接 GitHub，请稍后重试。"}</p>}
        <div className="dialog-actions app-update-actions">
          {latestReleaseUrl && (
            <button type="button" className="app-update-latest-link" onClick={openLatestRelease}>
              下载最新版
            </button>
          )}
          <button type="button" className="button-secondary" onClick={onClose}>稍后</button>
          {status.state === "available" && <button type="button" className="button-primary" onClick={onDownload}>下载并安装更新</button>}
          {status.state === "downloaded" && <button type="button" className="button-primary" onClick={onInstall}>重启并安装</button>}
          {(status.state === "not-available" || status.state === "error" || status.state === "unavailable") && (
            <button type="button" className="button-primary" onClick={onCheck} disabled={isChecking}>重新检查</button>
          )}
          {(isChecking || isDownloading) && <button type="button" className="button-primary" disabled><LoaderCircle size={14} className="spin" />处理中</button>}
        </div>
      </div>
    </div>
  );
}

function hookRuleText(rule: HookRule) {
  const tools = Array.isArray(rule.tool) ? rule.tool.join("、") : rule.tool;
  const target = rule.path ? `${t("hooks.pathPrefix", " 路径 ")}${rule.path}` : rule.command ? `${t("hooks.commandPrefix", " 命令 ")}${rule.command}` : "";
  let message = rule.message || "";
  if (rule.message === "修改钩子规则属于高危操作，必须人工确认") {
    message = t("hooks.msg.modifyHooks", rule.message);
  } else if (rule.message === "禁止提权运行命令") {
    message = t("hooks.msg.sudo", rule.message);
  } else if (rule.message === "禁止格式化磁盘") {
    message = t("hooks.msg.mkfs", rule.message);
  } else if (rule.message === "禁止关机类命令") {
    message = t("hooks.msg.shutdown", rule.message);
  }
  return { title: `${tools}${target}`, action: rule.action === "block" ? t("hooks.actionBlock", "阻止") : t("hooks.actionApproval", "强制审批"), message };
}

function formatStandingRuleTitle(rule: StandingRule) {
  if (rule.kind === "domain") {
    return t("hooks.ruleDomain", `以后访问 ${rule.pattern} 不再询问`, { host: rule.pattern });
  }
  if (rule.kind === "command-prefix") {
    return t("hooks.ruleCommandPrefix", `以后以「${rule.pattern}」开头的命令不再询问`, { pattern: rule.pattern });
  }
  if (rule.kind === "path-glob") {
    return t("hooks.rulePathGlob", `以后所有 ${rule.pattern} 文件不再询问`, { ext: rule.pattern });
  }
  if (rule.kind === "mcp-tool") {
    return t("hooks.ruleMcp", `以后使用「${rule.pattern}」不再询问`, { tool: rule.pattern });
  }
  return rule.label || rule.pattern;
}

export function HooksPanel() {
  const [data, setData] = useState<{ builtin: HookRule[]; user: HookRule[]; userPath: string } | null>(null);
  const [rules, setRules] = useState<StandingRule[]>([]);
  useEffect(() => {
    if (window.dyworker?.listHooks) void window.dyworker.listHooks().then(setData);
    if (window.dyworker?.listRules) void window.dyworker.listRules().then(setRules);
  }, []);
  const deleteRule = (id: string) => {
    void window.dyworker?.deleteRule(id).then(() => window.dyworker?.listRules().then(setRules));
  };
  return (
    <div className="hooks-panel">
      <div className="dialog-section-title">{t("hooks.standingRules", "免问授权（常用操作不再重复提示）")}</div>
      {rules.length ? rules.map((rule) => (
        <div className="hook-rule-row" key={rule.id}>
          <span className="hook-rule-action allow">{t("hooks.actionAllow", "允许")}</span>
          <span className="hook-rule-title">{formatStandingRuleTitle(rule)}</span>
          <button className="icon-button subtle tiny" onClick={() => deleteRule(rule.id)} aria-label={t("hooks.deleteRule", "删除这条规则")}>
            <Trash2 size={13} />
          </button>
        </div>
      )) : <p className="dialog-note">{t("hooks.emptyHint", "还没有免问规则。在确认卡片上勾选「始终允许」后会记录在此。")}</p>}
      <div className="dialog-section-title">{t("hooks.builtinRules", "内置规则（始终生效）")}</div>
      {(data?.builtin || []).map((rule, index) => {
        const text = hookRuleText(rule);
        return (
          <div className="hook-rule-row" key={index}>
            <span className={`hook-rule-action ${rule.action}`}>{text.action}</span>
            <span className="hook-rule-title">{text.title}</span>
            <small>{text.message}</small>
          </div>
        );
      })}
      <div className="dialog-section-title">{t("hooks.userRules", "用户规则（全局生效）")}</div>
      {data?.user?.length ? data.user.map((rule, index) => {
        const text = hookRuleText(rule);
        return (
          <div className="hook-rule-row" key={index}>
            <span className={`hook-rule-action ${rule.action}`}>{text.action}</span>
            <span className="hook-rule-title">{text.title}</span>
            <small>{text.message}</small>
          </div>
        );
      }) : <p className="dialog-note">{t("hooks.noUserRules", "还没有用户规则。规则写在下方的 JSON 文件里，保存后下一个任务生效。")}</p>}
      <div className="dialog-actions" style={{ justifyContent: "flex-start" }}>
        <button type="button" className="button-secondary" onClick={() => void window.dyworker?.openUserHooks?.()}>
          {t("hooks.openUserHooks", "打开用户规则文件")}
        </button>
        <button type="button" className="button-secondary" onClick={() => void window.dyworker?.openAuditLog?.()}>
          {t("hooks.openAuditLog", "打开审计日志")}
        </button>
      </div>
      <p className="dialog-note">{t("hooks.auditLogNote", "审计日志记录所有文件修改、命令执行、联网与外部工具调用的审批与执行结果，可用于操作追溯。")}</p>
      <p className="dialog-note">
        {t("hooks.workspaceRuleNote", '工作区级规则放在当前工作区的 .dyworker/hooks.json，只对该工作区生效。规则格式：{ "tool": "delete_file", "path": "*.docx", "action": "block", "message": "说明" }；action 支持 block（直接阻止）和 require_approval（任何模式下都强制人工确认）。')}
      </p>
    </div>
  );
}

// 使用统计与运营消息设置：统计默认关闭，开启需先配置受控服务地址；
// 状态与覆盖缺口就地自动展示（打开本栏目时拉取一次，保存后重新打开可刷新）
export function TelemetrySettingsSection({ draft, setDraft }: {
  draft: ProviderSettings;
  setDraft: (next: ProviderSettings) => void;
}) {
  const telemetry = draft.telemetry || defaultSettings.telemetry;
  const [status, setStatus] = useState<TelemetryStatus | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteResult, setDeleteResult] = useState("");

  useEffect(() => {
    let disposed = false;
    const refresh = () => void window.dyworker?.getTelemetryStatus?.()
      .then((next) => { if (!disposed) setStatus(next || null); }).catch(() => {});
    refresh();
    const timer = window.setInterval(refresh, 5_000);
    return () => { disposed = true; window.clearInterval(timer); };
  }, []);

  const patch = (partial: Partial<TelemetrySettings>) => {
    setDraft({ ...draft, telemetry: { ...telemetry, ...partial } });
  };

  const deleteData = () => {
    if (!window.confirm("将删除此安装已上传的使用统计数据、消息回执与联网观察记录，并撤销设备凭据。确定继续吗？")) return;
    setDeleting(true);
    setDeleteResult("");
    void window.dyworker?.deleteTelemetryData?.()
      .then((result) => {
        setDeleteResult(result?.ok ? "删除请求已受理，本地队列与凭据已清除。" : `删除失败：${result?.error || "未知错误"}`);
        void window.dyworker?.getTelemetryStatus?.().then((next) => setStatus(next || null));
      })
      .catch(() => setDeleteResult("删除失败：网络异常"))
      .finally(() => setDeleting(false));
  };

  return (
    <div className="telemetry-settings">
      <div className="dialog-section-title">{t("telemetry.cloudService", "云端服务")}</div>
      <label>
        {t("telemetry.serviceUrl", "服务地址")}
        <input
          type="url"
          value={telemetry.serviceUrl}
          placeholder={t("telemetry.serviceUrlPlaceholder", "https://服务地址（留空表示完全关闭）")}
          onChange={(event) => patch({ serviceUrl: event.target.value })}
        />
      </label>
      <p className="dialog-note">{t("telemetry.serviceNote", "连接受控接口，不采集私密信息，留空时不联网。")}</p>
      <div className="dialog-section-title">{t("telemetry.statsTitle", "用量统计")}</div>
      <label className="dialog-check">
        <input
          type="checkbox"
          checked={telemetry.statsEnabled}
          onChange={(event) => patch({ statsEnabled: event.target.checked })}
        />
        {t("telemetry.statsReport", "上报使用统计（默认关闭）")}
      </label>
      <p className="dialog-note">{t("telemetry.statsNote", "仅统计软件活跃时长等基础指标，不上传聊天与文件。")}</p>
      <div className="dialog-section-title">{t("telemetry.messagesTitle", "维护通知")}</div>
      <label className="dialog-check">
        <input
          type="checkbox"
          checked={telemetry.messagesEnabled}
          onChange={(event) => patch({ messagesEnabled: event.target.checked })}
        />
        {t("telemetry.subscribeMessages", "订阅公告、版本提醒与维护通知")}
      </label>
      <p className="dialog-note">{t("telemetry.messagesNote", "与使用统计互不影响：关闭统计仍可接收消息。在线时每 5 分钟检查新消息，离线期间的消息在下次打开或恢复联网后补收；退出应用期间不承诺即时提醒。")}</p>
      <label className="dialog-check">
        <input
          type="checkbox"
          checked={telemetry.notifyNewMessages}
          onChange={(event) => patch({ notifyNewMessages: event.target.checked })}
        />
        {t("telemetry.notifyNewMessages", "收到新消息时显示系统通知")}
      </label>
      <label className="dialog-check">
        <input
          type="checkbox"
          checked={telemetry.notifyMarketing}
          onChange={(event) => patch({ notifyMarketing: event.target.checked })}
        />
        {t("telemetry.notifyMarketing", "营销类消息也弹系统通知（默认只进消息中心）")}
      </label>
      <label>
        {t("telemetry.quietHours", "免打扰时段（可选）")}
        <input
          value={telemetry.quietHours}
          placeholder={t("telemetry.quietHoursPlaceholder", "例如 22:00-08:00；留空关闭。时段内新消息只进消息中心，不弹系统通知")}
          onChange={(event) => patch({ quietHours: event.target.value })}
        />
      </label>
      <label>
        {t("telemetry.dailyPopupLimit", "每日系统弹窗上限")}
        <input
          type="number"
          min={0}
          max={50}
          value={telemetry.dailyPopupLimit}
          onChange={(event) => patch({ dailyPopupLimit: Number(event.target.value) })}
        />
      </label>
      {status && (
        <>
          <div className="dialog-section-title">{t("telemetry.localStatusTitle", "本机状态")}</div>
          <p className="dialog-note">
            {t("telemetry.registration", "设备登记")}：{status.registered ? t("telemetry.registered", "已完成") : t("telemetry.notRegistered", "未登记")}
            {status.registered ? `（${status.credentialMode === "safe-storage" ? t("telemetry.credSafeStorage", "已加密保存") : status.credentialMode === "session" ? t("telemetry.credSession", "仅本次会话保存（系统安全存储不可用）") : t("telemetry.credRevoked", "已撤销")}）` : ""}
            {status.queue ? ` · ${t("telemetry.queuePending", "待上传 {count} 条", { count: status.queue.pending })}` : ""}
            {status.queue?.droppedOverflow ? ` · 队列超限丢弃 ${status.queue.droppedOverflow} 条` : ""}
            {status.lastSyncAt ? ` · ${t("telemetry.lastSync", "最近同步 {time}", { time: new Date(status.lastSyncAt).toLocaleString() })}` : ""}
            {status.lastError ? ` · 最近错误：${status.lastError}` : ""}
          </p>
        </>
      )}
      <div className="dialog-actions" style={{ justifyContent: "flex-start" }}>
        <button type="button" className="button-secondary" disabled={deleting} onClick={deleteData}>
          {deleting ? t("telemetry.deleting", "删除中…") : t("telemetry.deleteData", "删除此安装已上传数据")}
        </button>
      </div>
      {deleteResult && <p className="dialog-note">{deleteResult}</p>}
    </div>
  );
}

// 消息渠道面板:QQ 官方机器人 + 微信 ClawBot。配置改动即存(走 settings:save,主进程热生效);
// 连接状态由主进程 channels:status 推送,微信扫码登录二维码也经此下发。
function getChannelStatusText(status: ChannelConnectionStatus) {
  switch (status) {
    case "disabled": return t("channels.status.disabled", "未启用");
    case "connecting": return t("channels.status.connecting", "连接中…");
    case "awaiting-scan": return t("channels.status.awaitingScan", "等待扫码");
    case "online": return t("channels.status.online", "已连接");
    case "error": return t("channels.status.error", "错误");
    default: return status;
  }
}

function ChannelStatusLine({ status }: { status?: { status: ChannelConnectionStatus; detail: string; qrUrl?: string } }) {
  const current = status?.status ?? "disabled";
  return (
    <div className={`channel-status ${current}`}>
      <span className="channel-status-dot" />
      <span>{getChannelStatusText(current)}{status?.detail ? `：${status.detail}` : ""}</span>
    </div>
  );
}

export function ChannelsPanel({ value, onSave }: {
  value: ProviderSettings;
  onSave: (value: ProviderSettings, successMessage?: string) => Promise<boolean>;
}) {
  const channels = value.channels ?? defaultSettings.channels;
  const feishu = channels.feishu ?? { enabled: false, appId: "", appSecret: "" };
  const [statusMap, setStatusMap] = useState<ChannelsStatusMap | null>(null);
  const [qqAppId, setQqAppId] = useState(channels.qq.appId);
  const [qqSecret, setQqSecret] = useState(channels.qq.appSecret);
  const [feishuAppId, setFeishuAppId] = useState(feishu.appId);
  const [feishuSecret, setFeishuSecret] = useState(feishu.appSecret);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let disposed = false;
    void window.dyworker?.getChannelsStatus?.().then((map) => {
      if (!disposed) setStatusMap(map);
    }).catch(() => { });
    const unsubscribe = window.dyworker?.onChannelsStatus?.((map) => setStatusMap(map));
    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, []);

  const saveChannels = async (next: ChannelsConfig, message: string) => {
    setSaving(true);
    try {
      await onSave({ ...value, channels: next }, message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="dialog-section-title">{t("channels.runtimeSection", "协作方式")}</div>
      <label>{t("channels.runtimeLabel", "执行模式")}
        <select aria-label={t("channels.runtimeLabel", "执行模式")} value={channels.runtime || ''} disabled={saving}
          onChange={event=>void saveChannels({...channels,runtime:event.target.value==='dsh' ? 'dsh' : event.target.value==='dyworker' ? 'dyworker' : undefined},t("channels.runtimeSaved", "协作方式已更新"))}>
          <option value="">{t("channels.runtimeDefault", "沿用会话设置")}</option><option value="dyworker">{t("channels.runtimeWorker", "办公助手")}</option><option value="dsh">{t("channels.runtimeDsh", "插件会话")}</option>
        </select>
      </label>
      <div className="dialog-section-title">{t("channels.modelSection", "协作模型")}</div>
      <div className="mcp-server-row">
        <span className="mcp-server-name">
          <strong>{t("channels.modelLabel", "专属模型")}{/* 渠道任务模型 */}</strong>
          <small>{t("channels.modelHint", "默认跟随当前模型，也可固定专属模型。")}</small>
        </span>
        <select
          className="channel-model-select"
          value={channels.modelProfileId}
          disabled={saving}
          onChange={(event) => void saveChannels({ ...channels, modelProfileId: event.target.value }, t("channels.modelSaved", "渠道模型已更新"))}
        >
          <option value="">{t("channels.followCurrentModel", "跟随当前模型")}（{value.model || t("common.unconfigured", "未配置")}）</option>
          {(value.profiles || []).map((profile) => (
            <option key={profile.id} value={profile.id}>{profile.name}（{profile.model}）</option>
          ))}
        </select>
      </div>

      <div className="dialog-section-title">{t("channels.qqTitle", "QQ 机器人（官方）")}</div>
      <ChannelStatusLine status={statusMap?.qq} />
      <p className="dialog-note">
        {t("channels.qqGuide", "在 QQ 开放平台 创建机器人（个人主体即可，支持单聊与群聊），把 AppID 和 AppSecret 填到这里。群里需要 @机器人 才会响应，私聊直接对话。")}
      </p>
      <div className="mcp-add-form">
        <input
          value={qqAppId}
          placeholder="AppID"
          onChange={(event) => setQqAppId(event.target.value)}
        />
        <input
          value={qqSecret}
          type="password"
          placeholder="AppSecret(加密保存)"
          onChange={(event) => setQqSecret(event.target.value)}
        />
        <button
          type="button"
          className="button-secondary"
          disabled={saving}
          onClick={() => void saveChannels({ ...channels, qq: { ...channels.qq, appId: qqAppId.trim(), appSecret: qqSecret.trim() } }, "QQ 凭据已保存")}
        >保存凭据</button>
      </div>
      <div className="mcp-server-row">
        <label className="skill-switch" title={channels.qq.enabled ? "点击停用" : "点击启用"}>
          <input
            type="checkbox"
            checked={channels.qq.enabled}
            disabled={saving || !channels.qq.appId || !channels.qq.appSecret}
            onChange={(event) => void saveChannels({ ...channels, qq: { ...channels.qq, enabled: event.target.checked } }, event.target.checked ? "QQ 渠道已启用" : "QQ 渠道已停用")}
          />
        </label>
        <span className="mcp-server-name">
          <strong>{channels.qq.enabled ? "QQ 渠道运行中" : "启用 QQ 渠道"}</strong>
          <small>{channels.qq.appId ? "开关即时生效,无需重启" : "先在上方保存 AppID 和 AppSecret"}</small>
        </span>
      </div>

      <div className="dialog-section-title">微信（ClawBot 官方通道）</div>
      <ChannelStatusLine status={statusMap?.wechat} />
      {statusMap?.wechat?.status === "awaiting-scan" && statusMap.wechat.qrUrl ? (
        <div className="channel-qr">
          <img src={statusMap.wechat.qrUrl} alt="微信登录二维码" />
          <p className="dialog-note">用微信扫码并在手机上确认,登录后凭据加密保存在本机。</p>
        </div>
      ) : null}
      <p className="dialog-note">
        启用后用手机微信扫码登录,他人给你的微信发消息即可让 DYWorker 处理并回复。群聊与文件/图片消息暂不支持。
      </p>
      <div className="mcp-server-row">
        <label className="skill-switch" title={channels.wechat.enabled ? "点击停用" : "点击启用"}>
          <input
            type="checkbox"
            checked={channels.wechat.enabled}
            disabled={saving}
            onChange={(event) => void saveChannels({ ...channels, wechat: { enabled: event.target.checked } }, event.target.checked ? "微信渠道已启用,请扫码登录" : "微信渠道已停用")}
          />
        </label>
        <span className="mcp-server-name">
          <strong>{channels.wechat.enabled ? "微信渠道运行中" : "启用微信渠道"}</strong>
          <small>{channels.wechat.enabled ? "凭据加密保存在本机,下次启动自动登录" : "开启后用手机微信扫码登录"}</small>
        </span>
      </div>

      <div className="dialog-section-title">飞书（官方长连接 + 云文档 / 电子表格 / 多维表格）</div>
      <ChannelStatusLine status={statusMap?.feishu} />
      <p className="dialog-note">
        在 <a href="https://open.feishu.cn/app" target="_blank" rel="noreferrer">飞书开放平台</a> 创建企业自建应用，开启「机器人」能力；在「事件与回调」选择「使用长连接接收事件」并订阅 <code>im.message.receive_v1</code>；在「权限管理」开通消息收发及云文档/电子表格/多维表格权限（<code>docx:document</code>、<code>sheets:spreadsheet</code>、<code>bitable:app</code>、<code>wiki:wiki:readonly</code>、<code>drive:drive</code>），发布版本后将 App ID 和 App Secret 填到这里。保存凭据后，桌面对话与所有渠道均可直接读写飞书云文档（Docx）、电子表格（Sheet）、多维表格（Bitable）与知识库（Wiki）。
      </p>
      <div className="mcp-add-form">
        <input
          value={feishuAppId}
          placeholder="App ID (如 cli_xxx)"
          onChange={(event) => setFeishuAppId(event.target.value)}
        />
        <input
          value={feishuSecret}
          type="password"
          placeholder="App Secret(加密保存)"
          onChange={(event) => setFeishuSecret(event.target.value)}
        />
        <button
          type="button"
          className="button-secondary"
          disabled={saving}
          onClick={() => void saveChannels({ ...channels, feishu: { ...feishu, appId: feishuAppId.trim(), appSecret: feishuSecret.trim() } }, "飞书凭据已保存")}
        >保存凭据</button>
      </div>
      <div className="mcp-server-row">
        <label className="skill-switch" title={feishu.enabled ? "点击停用" : "点击启用"}>
          <input
            type="checkbox"
            checked={feishu.enabled}
            disabled={saving || !feishu.appId || !feishu.appSecret}
            onChange={(event) => void saveChannels({ ...channels, feishu: { ...feishu, enabled: event.target.checked } }, event.target.checked ? "飞书渠道已启用" : "飞书渠道已停用")}
          />
        </label>
        <span className="mcp-server-name">
          <strong>{feishu.enabled ? "飞书渠道运行中" : "启用飞书消息渠道"}</strong>
          <small>{feishu.appId ? "开关即时生效；即使不开启消息监听，已保存的凭据也可用于飞书云文档工具" : "先在上方保存 App ID 和 App Secret"}</small>
        </span>
      </div>

      <div className="dialog-section-title">说明</div>
      <p className="dialog-note">
        渠道消息会在左侧生成独立会话并完整留痕;需要确认的操作会同时发到 IM 和审批收件箱,回复「允许/拒绝」或在收件箱处理都可以。同一时间只执行一个任务,其余消息排队处理。
      </p>
      <p className="dialog-note">
        在 IM 里发送「更换工作目录至 /某个/路径」或「切换到 xxx 目录」可切换这个聊天的操作目录,相对路径基于当前目录;发送「停止」可中止正在执行或排队的任务。
      </p>
    </>
  );
}
