import { useEffect, useState } from 'react';
import { sendMessage } from '../../state/sendMessageActions';
import { useSessionStore } from '../../state/sessionStore';
import { t } from '../../i18n';
import type { BackgroundBrowserHandoff } from '../../types';

export function BackgroundBrowserHandoff({ sessionId, running, onContinue = sendMessage }: { sessionId: string; running: boolean; onContinue?: typeof sendMessage }) {
  const [entries, setEntries] = useState<BackgroundBrowserHandoff[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let mounted = true;
    let updates = 0;
    const unsubscribe = window.dyworker?.onBackgroundBrowserHandoffs?.(items => { updates++; setEntries(items); });
    void window.dyworker?.listBackgroundBrowserHandoffs?.().then(items => { if (mounted && !updates) setEntries(items); }).catch(() => {});
    return () => { mounted = false; unsubscribe?.(); };
  }, []);
  useEffect(() => { setError(''); }, [sessionId]);
  const entry = entries.find(item => item.ownerSessionId === sessionId);
  if (!entry) return null;
  const run = async (action: 'show' | 'ready' | 'discard' | 'choose') => {
    if (busy) return;
    setBusy(true); setError('');
    try {
      if (action === 'show') {
        const result = await window.dyworker?.showBackgroundBrowserHandoff?.(entry.id);
        if (!result?.ok) throw new Error(result?.result || t('handoff.openFailed', '无法打开页面'));
      } else if (action === 'choose') {
        const result = await window.dyworker?.chooseBackgroundBrowserFile?.(entry.id);
        if (!result?.ok) throw new Error(result?.result || t('handoff.chooseFailed', '无法选择文件'));
      } else if (action === 'discard') {
        const result = await window.dyworker?.discardBackgroundBrowserHandoff?.(entry.id);
        if (!result?.ok) throw new Error(result?.result || t('handoff.closeFailed', '无法关闭页面'));
      } else {
        const result = await window.dyworker?.readyBackgroundBrowserHandoff?.(entry.id);
        if (!result?.ok || !result.ownerSessionId || !result.runId) throw new Error(result?.result || t('handoff.resumeFailed', '无法继续任务'));
        const hasGoal = Boolean(useSessionStore.getState().sessions.find(session => session.id === result.ownerSessionId)?.goal);
        await onContinue(t('handoff.continuePrompt', '我已完成手动处理。请先重新观察当前后台网页，再继续完成原任务。'), result.ownerSessionId, result.runId, undefined, hasGoal);
      }
    } catch (error) { setError(error instanceof Error ? error.message : t('common.actionFailedRetry', '操作失败，请重试')); }
    finally { setBusy(false); }
  };
  return <section className="background-browser-handoff" aria-label={t("handoff.aria", "待处理网页")}>
    <div><strong>{t("handoff.waitingUser", "网页等待你处理")}</strong><span>：{entry.reason}</span></div>
    <div className="background-browser-handoff-note">{t("handoff.note", "这是原来的页面，关闭应用后不会保留。部分系统弹窗、新窗口和下载仍可能被拦截。")}</div>
    {(entry.state === 'waiting' || entry.state === 'human') && !entry.filePending && <div className="background-browser-handoff-note">{t("handoff.fileHint", "如果网页需要选择文件，请在网页中点击选择后回到这里继续。")}</div>}
    {entry.state === 'human' && entry.filePending && <div>{t("handoff.fileRequired", "网页需要选择文件，请点击下方“选择文件”。")}</div>}
    {error && <div role="alert">{error}</div>}
    <div className="background-browser-handoff-actions">
      {entry.state === 'human' && entry.filePending && <button type="button" disabled={busy || entry.selectingFile} onClick={() => void run('choose')}>{entry.selectingFile ? t("handoff.selectingFile", "正在选择…") : t("handoff.chooseFile", "选择文件")}</button>}
      {entry.state !== 'ready' && <button type="button" disabled={busy || entry.selectingFile || entry.state === 'opening' || entry.state === 'returning'} onClick={() => void run('show')}>{entry.state === 'opening' ? t("handoff.opening", "正在打开…") : t("handoff.openPendingPage", "打开待处理页面")}</button>}
      {(entry.state === 'human' || entry.state === 'ready' || entry.state === 'returning') && <button type="button" disabled={busy || running || entry.selectingFile || entry.state === 'returning'} onClick={() => void run('ready')}>{entry.state === 'returning' ? t("handoff.preparing", "正在准备…") : t("handoff.handBack", "继续交给助手")}</button>}
      <button type="button" disabled={busy || entry.selectingFile} onClick={() => void run('discard')}>{t("handoff.closePage", "关闭页面")}</button>
    </div>
  </section>;
}
