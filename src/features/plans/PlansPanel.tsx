import { Bot, Check, Hand, LoaderCircle, Plus, ShieldAlert, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { defaultNextRun, formatScheduleTime } from "../../lib/format";
import { t } from "../../i18n";
import type { ApprovalMode, ScheduleRecord } from "../../types";

export const composerApprovalModes = [
  {
    value: "interactive" as ApprovalMode,
    label: "请示批准", /* 请示批准 */
    description: "遇到需要授权的操作时先征求你的同意",
    icon: Hand,
  },
  {
    value: "reviewer" as ApprovalMode,
    label: "替我审批", /* 替我审批 */
    description: "低风险操作自动继续，只在越界、外发、破坏性或不明确时请示",
    icon: Bot,
  },
  {
    value: "full-access" as ApprovalMode,
    label: "完全访问权限", /* 完全访问权限 */
    description: "不受限制地访问互联网和您电脑上的任何文件",
    icon: ShieldAlert,
    warning: true,
  },
];

export function getApprovalModeDetails(mode: ApprovalMode) {
  switch (mode) {
    case "interactive":
      return {
        label: t("composer.approval.interactive", "请示批准"),
        description: t("composer.approval.interactiveDesc", "遇到需授权操作时先征求同意"),
      };
    case "full-access":
      return {
        label: t("composer.approval.fullAccess", "完全访问"),
        description: t("composer.approval.fullAccessDesc", "直接执行所有操作，不再确认"),
      };
    case "reviewer":
    default:
      return {
        label: t("composer.approval.reviewer", "替我审批"),
        description: t("composer.approval.reviewerDesc", "低风险自动继续，关键操作请示"),
      };
  }
}

// 计划表单里的审批口径说明：计划任务与到点续跑都按设置里的审批模式运行
// （生效规则见 electron/settings.mts 的 unattendedApprovalMode / wakeApprovalMode：
//  全局完全访问对计划/续跑同样生效；续跑保持"替我审批"由审核助手把关，不降级成 auto）。
// 文案与输入框上的模式说明同源，避免两处口径漂移。
const planApprovalModeNotes: Record<string, string> = {
  interactive: "每次需要授权的操作都会进审批收件箱，等你确认后才继续",
  reviewer: "工作区内的低风险操作由审核助手放行，越界、外发、破坏性操作才进审批收件箱等你确认",
  "full-access": "不再逐条向你确认（仍会拦截系统级安装等少数操作）",
  auto: "工作区内的读写自动放行，其余需要确认的操作进审批收件箱",
  "deny-changes": "只读运行，不会修改文件或运行命令",
};

// 计划表单里那句审批口径说明（整段拼好，避免 JSX 换行在中文里塞进空格）
function planApprovalHint(mode: ApprovalMode, allowWorkspaceWrites: boolean) {
  const label = composerApprovalModes.find((option) => option.value === mode)?.label || "替我审批";
  const note = planApprovalModeNotes[mode] || planApprovalModeNotes.reviewer;
  const suffix = allowWorkspaceWrites
    ? "。"
    : "；未开启「允许修改工作区文件」时整轮只读，不会改动任何文件。";
  return `计划执行与到点续跑都按设置里的审批模式运行：当前「${label}」——${note}${suffix}`;
}

const getRecurrenceLabels = (): Record<string, string> => ({
  once: t("plans.recurrence.once", "单次"),
  hourly: t("plans.recurrence.hourly", "每小时"),
  daily: t("plans.recurrence.daily", "每天"),
  weekly: t("plans.recurrence.weekly", "每周"),
});

export interface ScheduleDraft {
  runtime?: "dyworker" | "dsh";
  name: string;
  prompt: string;
  recurrence: ScheduleRecord["recurrence"];
  nextRun: string;
  allowWorkspaceWrites: boolean;
  workspacePath?: string;
}

const scheduleHistoryStatusLabels: Record<string, string> = {
  cancelled: "已停止",
  success: "完成",
  failed: "失败",
  sleeping: "挂起",
  running: "运行中",
};

export function PlansPanel({
  items,
  workspaceReady,
  currentWorkspacePath,
  approvalMode,
  onSave,
  onToggle,
  onDelete,
  onTrigger,
  onOpenSession,
  seed,
}: {
  items: ScheduleRecord[];
  workspaceReady: boolean;
  currentWorkspacePath?: string;
  approvalMode: ApprovalMode;
  onSave: (draft: ScheduleDraft) => Promise<boolean>;
  onToggle: (id: string, enabled: boolean) => void;
  onDelete: (id: string) => void;
  onTrigger: (id: string) => void;
  onOpenSession?: (sessionId: string) => void;
  seed?: { name: string; prompt: string } | null;
}) {
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<ScheduleDraft>({ name: "", prompt: "", recurrence: "daily", nextRun: defaultNextRun(), allowWorkspaceWrites: false, workspacePath: "", runtime:"dyworker" });

  useEffect(() => {
    if (!seed) return;
    setDraft((current) => ({ ...current, name: seed.name || current.name, prompt: seed.prompt || current.prompt }));
    setFormOpen(true);
  }, [seed]);

  const submit = async () => {
    setSaving(true);
    const ok = await onSave(draft);
    setSaving(false);
    if (ok) {
      setFormOpen(false);
      setDraft({ name: "", prompt: "", recurrence: "daily", nextRun: defaultNextRun(), allowWorkspaceWrites: false, workspacePath: "", runtime:"dyworker" });
    }
  };

  const recurrenceLabels = getRecurrenceLabels();

  return (
    <div className="plans-panel">
      <button className="new-task-button plan-new-button" onClick={() => setFormOpen((value) => !value)}>
        <Plus size={16} />
        {t("plans.newPlan", "新建定时计划")}
      </button>
      {formOpen && (
        <div className="plan-form">
          <input value={draft.name} placeholder={t("plans.namePlaceholder", "计划名称，例如：每周五周报提醒")} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
          <textarea value={draft.prompt} rows={3} placeholder={t("plans.promptPlaceholder", "到时间要助手做什么，例如：汇总工作区本周的文档改动，整理成周报草稿")} onChange={(event) => setDraft({ ...draft, prompt: event.target.value })} />
          <label>{t("plans.runtime", "任务运行方式")}
            <select aria-label={t("plans.runtime", "计划任务运行方式")} value={draft.runtime || 'dyworker'} onChange={event=>setDraft({...draft,runtime:event.target.value==='dsh' ? 'dsh' : 'dyworker'})}>
              <option value="dyworker">{t("plans.runtimeDyworker", "办公助手")}</option><option value="dsh">{t("plans.runtimeDsh", "DSH 插件会话")}</option>
            </select>
          </label>
          <div className="plan-form-row">
            <select value={draft.recurrence} onChange={(event) => setDraft({ ...draft, recurrence: event.target.value as ScheduleRecord["recurrence"] })}>
              <option value="once">{t("plans.recurrence.once", "单次")}</option>
              <option value="hourly">{t("plans.recurrence.hourly", "每小时")}</option>
              <option value="daily">{t("plans.recurrence.daily", "每天")}</option>
              <option value="weekly">{t("plans.recurrence.weekly", "每周")}</option>
            </select>
            <input type="datetime-local" value={draft.nextRun} onChange={(event) => setDraft({ ...draft, nextRun: event.target.value })} />
          </div>
          <div className="plan-form-row plan-form-workspace">
            <input
              value={draft.workspacePath || ""}
              placeholder={currentWorkspacePath ? `${t("plans.folderPrefix", "工作文件夹（留空使用：")}${currentWorkspacePath}）` : t("plans.folderChoose", "工作文件夹（请选择工作文件夹）")}
              onChange={(event) => setDraft({ ...draft, workspacePath: event.target.value })}
              title={t("plans.folderTitle", "计划执行时使用的工作文件夹；留空则使用当前工作区")}
            />
          </div>
          <label className={`plan-form-check ${draft.allowWorkspaceWrites ? "checked" : ""}`}>
            <input type="checkbox" checked={draft.allowWorkspaceWrites} onChange={(event) => setDraft({ ...draft, allowWorkspaceWrites: event.target.checked })} />
            <span className="plan-form-check-copy">
              <strong>{t("plans.allowWrites", "允许修改工作区文件")}</strong>
              <small>{t("plans.allowWritesDesc", "开启后助手可以创建和修改文件；关闭时只查看内容")}</small>
            </span>
          </label>
          <p className="plan-form-hint">{planApprovalHint(approvalMode, draft.allowWorkspaceWrites)}</p>
          <button className="button-primary plan-save" disabled={saving || !workspaceReady} onClick={() => void submit()}>
            {saving ? <LoaderCircle className="spin" size={15} /> : <Check size={15} />}
            {workspaceReady ? t("plans.savePlan", "保存计划") : t("plans.selectFolderFirst", "请先选择工作文件夹")}
          </button>
        </div>
      )}
      {!items.length && !formOpen && (
        <p className="panel-empty">{t("plans.emptyHint", "定时计划会让助手在指定时间自动执行任务，结果保存到最近任务里。")}</p>
      )}
      <div className="panel-list">
        {items.map((plan) => (
          <div className={`plan-item ${plan.enabled ? "" : "disabled"}`} key={plan.id}>
            <div className="skill-item-head">
              <strong title={plan.prompt}>{plan.name}</strong>
              <label className="skill-switch" title={plan.enabled ? t("plans.clickDisable", "点击停用") : t("plans.clickEnable", "点击启用")}>
                <input type="checkbox" checked={plan.enabled} onChange={(event) => onToggle(plan.id, event.target.checked)} />
              </label>
              <button className="icon-button subtle tiny" onClick={() => onDelete(plan.id)} aria-label={t("plans.deletePlan", "删除这个计划")}>
                <Trash2 size={13} />
              </button>
            </div>
            <p>{plan.runtime === "dsh" ? `${t("plans.runtimeDsh", "DSH 插件会话")} · ` : ""}{recurrenceLabels[plan.recurrence] || plan.recurrence} · {t("plans.nextRunPrefix", "下次 ")}{formatScheduleTime(plan.nextRun)}</p>
            {plan.lastStatus && (
              <p className={`plan-status ${plan.lastStatus}`}>
                {plan.lastStatus === "running" ? t("plans.statusRunning", "正在执行…") : plan.lastStatus === "sleeping" ? plan.lastSummary || t("plans.statusSleeping", "已挂起等待唤醒") : plan.lastStatus === "cancelled" ? t("plans.statusCancelled", "上次已停止") : plan.lastStatus === "success" ? `${t("plans.statusSuccess", "上次完成：")}${plan.lastSummary || t("plans.statusNormal", "正常")}` : `${t("plans.statusFailed", "上次失败：")}${plan.lastSummary || t("plans.statusUnknown", "未知原因")}`}
              </p>
            )}
            {plan.history?.length ? (
              <details className="plan-history">
                <summary>{t("plans.historyCount", "运行记录（{count}）").replace("{count}", String(plan.history.length))}</summary>
                {plan.history.map((entry, index) => (
                  <div className={`plan-history-entry ${entry.status}`} key={`${entry.at}:${index}`}>
                    <div className="plan-history-head">
                      <span className="plan-history-status">{scheduleHistoryStatusLabels[entry.status] || entry.status || t("plans.statusExecuted", "执行")}</span>
                      <span className="plan-history-time">{formatScheduleTime(entry.at)}</span>
                      {entry.sessionId && onOpenSession ? (
                        <button type="button" className="bare-button plan-history-open" onClick={() => onOpenSession(entry.sessionId)}>{t("plans.viewTranscript", "查看转录")}</button>
                      ) : null}
                    </div>
                    {entry.summary ? <p>{entry.summary}</p> : null}
                  </div>
                ))}
              </details>
            ) : null}
            <button className="bare-button plan-run-now" onClick={() => onTrigger(plan.id)} disabled={plan.lastStatus === "running"}>
              {t("plans.runNow", "立即执行")}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
