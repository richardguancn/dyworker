import { AlertTriangle, Check, ChevronRight, Download, FolderOpen, Globe, Landmark, LoaderCircle, RefreshCw, Sparkles, SquareTerminal, Trash2, UserRound, X } from "lucide-react";
import { useEffect, useState } from "react";
import { MarkdownSnippet } from "../../InteractiveMessage";
import { defaultSettings } from "../../lib/settings";
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
          <h2 id="full-access-dialog-title">要开启完整访问权限吗?</h2>
        </div>
        <p className="full-access-intro">
          DYWorker 将能够在未经您许可的情况下，在这台计算机上的任何位置运行命令、使用互联网，以及创建和编辑文件。这包括但不限于：
        </p>
        <div className="full-access-capabilities">
          <div className="full-access-capability">
            <FolderOpen size={31} strokeWidth={1.8} aria-hidden="true" />
            <span>
              <strong>文件和文件夹</strong>
              <small>读取、创建、修改、上传或删除此计算机上任意位置的文件</small>
            </span>
          </div>
          <div className="full-access-capability">
            <SquareTerminal size={31} strokeWidth={1.8} aria-hidden="true" />
            <span>
              <strong>终端命令</strong>
              <small>运行命令、安装软件和更改系统设置</small>
            </span>
          </div>
          <div className="full-access-capability">
            <Globe size={31} strokeWidth={1.8} aria-hidden="true" />
            <span>
              <strong>互联网和已连接的应用</strong>
              <small>访问网站、发送数据并使用已启用的插件</small>
            </span>
          </div>
        </div>
        <p className="full-access-warning">
          这会带来敏感数据丢失或泄露以及提示注入等风险。你可以关闭此功能。
          <button type="button" className="full-access-learn-more" onClick={() => setShowDetails((value) => !value)}>
            了解更多
          </button>
        </p>
        {showDetails && (
          <p className="full-access-details">
            开启后，任务会减少逐次确认，更适合你明确承担风险并希望连续执行的场景。你可以随时从输入框旁的审批模式菜单切回替我审批或请示批准。
          </p>
        )}
        <div className="full-access-actions">
          <button type="button" className="full-access-cancel" onClick={onClose} disabled={saving}>取消</button>
          <button type="button" className="full-access-confirm" onClick={() => void confirm()} disabled={saving}>
            <AlertTriangle size={17} aria-hidden="true" />
            {saving ? "开启中…" : "确认"}
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
      if (!saved) setError("身份没有保存成功，请重试。");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop identity-backdrop" role="presentation">
      <div className="identity-dialog" role="dialog" aria-modal="true" aria-labelledby="identity-dialog-title">
        <div className="identity-dialog-mark"><Sparkles size={21} aria-hidden="true" /></div>
        <span className="dialog-kicker">首次使用</span>
        <h2 id="identity-dialog-title">你准备怎样使用 DYWorker？</h2>
        <p className="identity-dialog-intro">选择后，助手会按对应场景组织回答和执行方式。这个选择会保存在当前设备上，之后也可以在设置中修改。</p>
        <div className="identity-options">
          <button type="button" className="identity-option" disabled={saving} onClick={() => void choose("general")}>
            <span className="identity-option-icon"><UserRound size={23} aria-hidden="true" /></span>
            <span className="identity-option-copy">
              <strong>通用身份</strong>
              <small>适合个人、企业、开发者和一般办公场景，使用更通用的工作助手设定。</small>
            </span>
            <ChevronRight size={18} aria-hidden="true" />
          </button>
          <button type="button" className="identity-option" disabled={saving} onClick={() => void choose("government")}>
            <span className="identity-option-icon"><Landmark size={23} aria-hidden="true" /></span>
            <span className="identity-option-copy">
              <strong>政府单位</strong>
              <small>适合党政机关、事业单位等场景，优先遵循公文、政策和保密相关工作规则。</small>
            </span>
            <ChevronRight size={18} aria-hidden="true" />
          </button>
        </div>
        {saving && <p className="identity-dialog-status">正在保存选择…</p>}
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
      await onSave({ ...value, identity }, "身份设置已更新");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="identity-settings-panel">
      <div className="dialog-section-title">助手身份</div>
      <p className="profile-section-hint">身份只影响助手默认的工作语境，不会限制你使用其他功能。</p>
      <div className="identity-settings-options">
        <button type="button" className={`identity-option compact ${value.identity === "general" ? "selected" : ""}`} disabled={saving} onClick={() => void select("general")}>
          <span className="identity-option-icon"><UserRound size={20} aria-hidden="true" /></span>
          <span className="identity-option-copy"><strong>通用身份</strong><small>个人、企业、开发者和一般办公场景</small></span>
          {value.identity === "general" && <Check size={17} aria-hidden="true" />}
        </button>
        <button type="button" className={`identity-option compact ${value.identity === "government" ? "selected" : ""}`} disabled={saving} onClick={() => void select("government")}>
          <span className="identity-option-icon"><Landmark size={20} aria-hidden="true" /></span>
          <span className="identity-option-copy"><strong>政府单位</strong><small>党政机关、事业单位和政务办公场景</small></span>
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
  const target = rule.path ? ` 路径 ${rule.path}` : rule.command ? ` 命令 ${rule.command}` : "";
  return { title: `${tools}${target}`, action: rule.action === "block" ? "阻止" : "强制审批", message: rule.message || "" };
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
      <div className="dialog-section-title">常驻允许规则（「始终允许」后同类操作不再询问）</div>
      {rules.length ? rules.map((rule) => (
        <div className="hook-rule-row" key={rule.id}>
          <span className="hook-rule-action allow">允许</span>
          <span className="hook-rule-title">{rule.label || rule.pattern}</span>
          <button className="icon-button subtle tiny" onClick={() => deleteRule(rule.id)} aria-label="删除这条规则">
            <Trash2 size={13} />
          </button>
        </div>
      )) : <p className="dialog-note">还没有常驻规则。在审批卡片上点「始终允许」后会出现在这里；受信只读命令、常用开发命令（npm/python3/git 提交等）、同类文件写入、同域名网页可以规则化，本机界面操作永远逐次确认。</p>}
      <div className="dialog-section-title">内置规则（始终生效，不可覆盖）</div>
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
      <div className="dialog-section-title">用户规则（对所有工作区生效）</div>
      {data?.user?.length ? data.user.map((rule, index) => {
        const text = hookRuleText(rule);
        return (
          <div className="hook-rule-row" key={index}>
            <span className={`hook-rule-action ${rule.action}`}>{text.action}</span>
            <span className="hook-rule-title">{text.title}</span>
            <small>{text.message}</small>
          </div>
        );
      }) : <p className="dialog-note">还没有用户规则。规则写在下方的 JSON 文件里，保存后下一个任务生效。</p>}
      <div className="dialog-actions" style={{ justifyContent: "flex-start" }}>
        <button type="button" className="button-secondary" onClick={() => void window.dyworker?.openUserHooks?.()}>
          打开用户规则文件
        </button>
        <button type="button" className="button-secondary" onClick={() => void window.dyworker?.openAuditLog?.()}>
          打开审计日志
        </button>
      </div>
      <p className="dialog-note">审计日志记录所有文件修改、命令执行、联网与外部工具调用的审批与执行结果，可用于操作追溯。</p>
      <p className="dialog-note">
        工作区级规则放在当前工作区的 .dyworker/hooks.json，只对该工作区生效。规则格式：{'{ "tool": "delete_file", "path": "*.docx", "action": "block", "message": "说明" }'}；action 支持 block（直接阻止）和 require_approval（任何模式下都强制人工确认）。
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
      <div className="dialog-section-title">运营服务</div>
      <label>
        服务地址
        <input
          type="url"
          value={telemetry.serviceUrl}
          placeholder="https://运营服务地址（由管理员提供；留空表示完全关闭）"
          onChange={(event) => patch({ serviceUrl: event.target.value })}
        />
      </label>
      <p className="dialog-note">使用统计与运营消息连接安全监管平台提供的受控接口。填写平台根地址，不需要附加接口路径。本机测试可填 http://localhost:8000；其他电脑请填可访问的 HTTPS 平台地址。修改后请点击“保存设置”；留空时两项功能都不联网。开启任一项后会用随机安装标识登记设备（不采集 MAC 地址、硬盘序列号、主机名和系统用户名）。</p>
      <div className="dialog-section-title">使用统计</div>
      <label className="dialog-check">
        <input
          type="checkbox"
          checked={telemetry.statsEnabled}
          onChange={(event) => patch({ statsEnabled: event.target.checked })}
        />
        上报使用统计（默认关闭）
      </label>
      <p className="dialog-note">开启后本机记录前台有效使用区间：只在窗口处于前台且近期有人工操作时计时，连续 120 秒无操作即停止；断网时先存本地（最多 7 天或 20MB），恢复后自动补传并去重。只上传使用元数据（日期、时长、应用版本、平台），不上传聊天内容、文件、提示词、模型地址与密钥。关闭后立即停止采集并清空待传队列。</p>
      <div className="dialog-section-title">运营消息</div>
      <label className="dialog-check">
        <input
          type="checkbox"
          checked={telemetry.messagesEnabled}
          onChange={(event) => patch({ messagesEnabled: event.target.checked })}
        />
        订阅公告、版本提醒与维护通知
      </label>
      <p className="dialog-note">与使用统计互不影响：关闭统计仍可接收消息。在线时每 5 分钟检查新消息，离线期间的消息在下次打开或恢复联网后补收；退出应用期间不承诺即时提醒。</p>
      <label className="dialog-check">
        <input
          type="checkbox"
          checked={telemetry.notifyNewMessages}
          onChange={(event) => patch({ notifyNewMessages: event.target.checked })}
        />
        收到新消息时显示系统通知
      </label>
      <label className="dialog-check">
        <input
          type="checkbox"
          checked={telemetry.notifyMarketing}
          onChange={(event) => patch({ notifyMarketing: event.target.checked })}
        />
        营销类消息也弹系统通知（默认只进消息中心）
      </label>
      <label>
        免打扰时段（可选）
        <input
          value={telemetry.quietHours}
          placeholder="例如 22:00-08:00；留空关闭。时段内新消息只进消息中心，不弹系统通知"
          onChange={(event) => patch({ quietHours: event.target.value })}
        />
      </label>
      <label>
        每日系统弹窗上限
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
          <div className="dialog-section-title">本机状态</div>
          <p className="dialog-note">
            设备登记：{status.registered ? "已完成" : "未登记"}
            {status.registered ? `（凭据${status.credentialMode === "safe-storage" ? "已加密保存" : status.credentialMode === "session" ? "仅本次会话保存（系统安全存储不可用）" : "已撤销"}）` : ""}
            {status.queue ? ` · 待上传 ${status.queue.pending} 条` : ""}
            {status.queue?.droppedOverflow ? ` · 队列超限丢弃 ${status.queue.droppedOverflow} 条（报表覆盖有缺口）` : ""}
            {status.lastSyncAt ? ` · 最近同步 ${new Date(status.lastSyncAt).toLocaleString("zh-CN")}` : ""}
            {status.clockOffsetMs ? ` · 本机时钟偏差约 ${Math.round(status.clockOffsetMs / 1000)} 秒（已标记待审）` : ""}
            {status.lastError ? ` · 最近错误：${status.lastError}` : ""}
            {status.nextRegistrationRetryAt ? ` · 将于 ${new Date(status.nextRegistrationRetryAt).toLocaleString("zh-CN")} 自动重试，待上传数据会保留` : ""}
          </p>
        </>
      )}
      <div className="dialog-actions" style={{ justifyContent: "flex-start" }}>
        <button type="button" className="button-secondary" disabled={deleting} onClick={deleteData}>
          {deleting ? "删除中…" : "删除此安装已上传数据"}
        </button>
      </div>
      {deleteResult && <p className="dialog-note">{deleteResult}</p>}
    </div>
  );
}

// 消息渠道面板:QQ 官方机器人 + 微信 ClawBot。配置改动即存(走 settings:save,主进程热生效);
// 连接状态由主进程 channels:status 推送,微信扫码登录二维码也经此下发。
const channelStatusText: Record<ChannelConnectionStatus, string> = {
  disabled: "未启用",
  connecting: "连接中…",
  "awaiting-scan": "等待扫码",
  online: "已连接",
  error: "错误",
};

function ChannelStatusLine({ status }: { status?: { status: ChannelConnectionStatus; detail: string; qrUrl?: string } }) {
  const current = status?.status ?? "disabled";
  return (
    <div className={`channel-status ${current}`}>
      <span className="channel-status-dot" />
      <span>{channelStatusText[current]}{status?.detail ? `：${status.detail}` : ""}</span>
    </div>
  );
}

export function ChannelsPanel({ value, onSave }: {
  value: ProviderSettings;
  onSave: (value: ProviderSettings, successMessage?: string) => Promise<boolean>;
}) {
  const channels = value.channels ?? defaultSettings.channels;
  const [statusMap, setStatusMap] = useState<ChannelsStatusMap | null>(null);
  const [qqAppId, setQqAppId] = useState(channels.qq.appId);
  const [qqSecret, setQqSecret] = useState(channels.qq.appSecret);
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
      <div className="dialog-section-title">渠道任务运行方式</div>
      <label>任务运行方式
        <select aria-label="渠道任务运行方式" value={channels.runtime || ''} disabled={saving}
          onChange={event=>void saveChannels({...channels,runtime:event.target.value==='dsh' ? 'dsh' : event.target.value==='dyworker' ? 'dyworker' : undefined},'渠道任务运行方式已更新')}>
          <option value="">沿用会话设置</option><option value="dyworker">办公助手</option><option value="dsh">DSH 插件会话</option>
        </select>
      </label>
      <div className="dialog-section-title">渠道任务模型</div>
      <div className="mcp-server-row">
        <span className="mcp-server-name">
          <strong>渠道对话使用的模型</strong>
          <small>默认跟随桌面端当前模型;也可固定为一个已保存的模型档案</small>
        </span>
        <select
          className="channel-model-select"
          value={channels.modelProfileId}
          disabled={saving}
          onChange={(event) => void saveChannels({ ...channels, modelProfileId: event.target.value }, "渠道模型已更新")}
        >
          <option value="">跟随当前模型（{value.model || "未配置"}）</option>
          {(value.profiles || []).map((profile) => (
            <option key={profile.id} value={profile.id}>{profile.name}（{profile.model}）</option>
          ))}
        </select>
      </div>

      <div className="dialog-section-title">QQ 机器人（官方）</div>
      <ChannelStatusLine status={statusMap?.qq} />
      <p className="dialog-note">
        在 <a href="https://q.qq.com" target="_blank" rel="noreferrer">QQ 开放平台</a> 创建机器人（个人主体即可，支持单聊与群聊），把 AppID 和 AppSecret 填到这里。群里需要 @机器人 才会响应，私聊直接对话。
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
