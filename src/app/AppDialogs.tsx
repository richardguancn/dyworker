import { ExtensionCreationDialog } from "../ExtensionCreationDialog";
import { AnnotationEditorCard,ContextMenuPopup,SelectionQuoteBar } from "../features/annotations/SelectionOverlays";
import { BrowserImportDialog,BrowserPasswordsDialog,BrowserSectionDialog } from "../features/browser/BrowserDialogs";
import { MemoryEditDialog } from "../features/memory/MemoryPanels";
import { SettingsDialog } from "../features/settings/SettingsDialog";
import { AppUpdateDialog,FullAccessDialog,IdentitySetupDialog } from "../features/settings/SettingsSubPanels";
import { SkillDraftDialog,SkillEditDialog } from "../features/skills/SkillPanels";
import { clearBrowserData,clearBrowserSessionHistory,fillSavedPassword,openBrowserUrl } from "../state/browserActions";
import { useBrowserStore } from "../state/browserStore";
import { addSelectionToComposer,closeContextMenu,sendSelectionToSideChat } from "../state/composerActions";
import { useComposerStore } from "../state/composerStore";
import { useInboxStore } from "../state/inboxStore";
import type { ToolPanelTab } from "../state/layoutStore";
import { useLayoutStore } from "../state/layoutStore";
import { toggleVoiceInput } from "../state/messageActions";
import { refreshImportedHistory,refreshMemories,refreshSkills } from "../state/panelActions";
import { usePanelStore } from "../state/panelStore";
import { deleteSchedule,saveSchedule,toggleSchedule,triggerSchedule } from "../state/scheduleActions";
import { useSessionStore } from "../state/sessionStore";
import { checkAppUpdate,chooseIdentity,confirmFullAccess,downloadAppUpdate,installAppUpdate,openAppUpdateDialog,saveProviderSettings } from "../state/settingsActions";
import { useSettingsStore } from "../state/settingsStore";
import { browserWebviewsRef,settingsSaveErrorRef,voiceTargetRef } from "../state/sharedRefs";
import { prepareExtensionCreation } from "../state/taskActions";
import { useViewStore } from "../state/viewStore";
import type { SessionRecord } from "../types";
export function AppDialogs({ browserActiveDownloadCount, activeToolPanelTab, composerWorkspacePath, activeSession, appliedSidebarWidth, identitySetupOpen }: { browserActiveDownloadCount: number; activeToolPanelTab: ToolPanelTab | undefined; composerWorkspacePath: string; activeSession: SessionRecord | undefined; appliedSidebarWidth: number; identitySetupOpen: boolean }) {
  const { browserSection, browserClearing, setBrowserSection, browserDownloads, browserSessionHistory, browserClearKinds, setBrowserClearKinds, importDialogOpen, setImportDialogOpen, browserPasswordsOpen, setBrowserPasswordsOpen } = useBrowserStore();
  const { setNotice, setError, contextMenu } = useViewStore();
  const { skillDraft, setSkillDraft, creationKind, setCreationKind, skillEdit, setSkillEdit, memoryEdit, setMemoryEdit, memories, setMemories, setMemoriesLinting, setMemoriesLintMessage, memoriesLinting, memoriesLintMessage, skills, setSkills, schedules, usageStats, setUsageStats, planSeed } = usePanelStore();
  const { settingsOpen, setSettingsOpen, appUpdateDialogOpen, setAppUpdateDialogOpen } = useLayoutStore();
  const { settings, approvalMode, settingsTab, setSettingsTab, appUpdate } = useSettingsStore();
  const { setMentionSkills, selectionQuote, setSelectionQuote, annotationEditor, annotations, voiceState, setAnnotations, setAnnotationEditor } = useComposerStore();
  const { workspacePath, sessions, setActiveId } = useSessionStore();
  const { fullAccessDialogOpen, setFullAccessDialogOpen } = useInboxStore();
  return <>{browserSection && (
        <BrowserSectionDialog title={{ history: "历史记录", downloads: "下载记录", clear: "清除浏览数据" }[browserSection]} onClose={() => { if (!browserClearing) setBrowserSection(null); }}>
{browserSection === "downloads" && (<div className="browser-more-downloads" role="group" aria-label="下载">
                        <div className="browser-more-history-head">
                          <span className="browser-more-label">下载</span>
                          {browserActiveDownloadCount > 0 && <span className="browser-more-history-url">{browserActiveDownloadCount} 个进行中</span>}
                        </div>
                        {browserDownloads.length ? (
                          <div className="browser-more-history-list">
                            {browserDownloads.map((entry) => {
                              const percent = entry.total > 0 ? Math.min(100, Math.round((entry.received / entry.total) * 100)) : 0;
                              return (
                                <div className="browser-download-row" key={entry.id}>
                                  <span className="browser-more-history-title" title={entry.path || entry.filename}>{entry.filename}</span>
                                  <span className="browser-more-history-url">
                                    {entry.state === "completed" ? "已完成"
                                      : entry.state === "cancelled" ? "已取消"
                                      : entry.state === "interrupted" ? "已中断"
                                      : entry.total > 0 ? `${percent}%` : "下载中…"}
                                  </span>
                                  <span className="browser-download-actions">
                                    {entry.state === "completed" && entry.path && (
                                      <>
                                        <button  onClick={() => void window.dyworker?.openPath?.(entry.path)}>打开</button>
                                        <button  onClick={() => void window.dyworker?.revealInFolder?.(entry.path)}>所在文件夹</button>
                                      </>
                                    )}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <p className="browser-more-history-empty">本次运行还没有下载</p>
                        )}
                      </div>)}
{browserSection === "history" && (<div className="browser-more-history" role="group" aria-label="本次浏览历史">
                        <div className="browser-more-history-head">
                          <span className="browser-more-label">本次浏览历史</span>
                          {browserSessionHistory.length > 0 && (
                            <button  aria-label="清空历史" title="清空历史" onClick={clearBrowserSessionHistory}>清空</button>
                          )}
                        </div>
                        {browserSessionHistory.length ? (
                          <div className="browser-more-history-list">
                            {browserSessionHistory.map((entry) => (
                              <button
                                key={`${entry.at}-${entry.url}`}

                                title={entry.url}
                                onClick={() => { setBrowserSection(null); void openBrowserUrl(entry.url); }}
                              >
                                <span className="browser-more-history-title">{entry.title || entry.url}</span>
                                <span className="browser-more-history-url">{entry.url}</span>
                              </button>
                            ))}
                          </div>
                        ) : (
                          <p className="browser-more-history-empty">还没有浏览记录</p>
                        )}
                      </div>)}
{browserSection === "clear" && (<div className="browser-more-clear" role="group" aria-label="清除浏览数据">
                        <span className="browser-more-label">清除浏览数据（内置浏览器）</span>
                        {([["cookies", "Cookie 和登录状态"], ["cache", "缓存的图片和文件"], ["siteData", "站点数据和网站设置"]] as const).map(([kind, label]) => (
                          <label className="browser-clear-kind" key={kind}>
                            <input
                              type="checkbox"
                              checked={browserClearKinds[kind]}
                              onChange={(event) => setBrowserClearKinds((current) => ({ ...current, [kind]: event.target.checked }))}
                            />
                            {label}
                          </label>
                        ))}
                        <button  className="browser-clear-button" disabled={browserClearing || !Object.values(browserClearKinds).some(Boolean)} onClick={() => void clearBrowserData()}>清除所选数据</button>
                      </div>)}
        </BrowserSectionDialog>
      )}{importDialogOpen && (
        <BrowserImportDialog
          onClose={() => setImportDialogOpen(false)}
          onDone={(message) => {
            setNotice(message);
            refreshImportedHistory();
            // 已打开的页面仍带着旧（未登录）状态，导入后刷新一次让新 Cookie 生效
            for (const webview of browserWebviewsRef.current.values()) webview.reload?.();
          }}
          onError={(message) => setError(message)}
        />
      )}{browserPasswordsOpen && (
        <BrowserPasswordsDialog
          activeOrigin={(() => {
            try {
              return new URL(activeToolPanelTab?.kind === "browser" ? activeToolPanelTab.url || "" : "").origin;
            } catch {
              return "";
            }
          })()}
          onFill={() => void fillSavedPassword()}
          onClose={() => setBrowserPasswordsOpen(false)}
        />
      )}{skillDraft && (
        <SkillDraftDialog
          initial={skillDraft}
          onClose={() => setSkillDraft(null)}
          onSaved={(item) => {
            setSkillDraft(null);
            void refreshSkills();
            setNotice(`工作模板「${item?.name || ""}」已保存`);
          }}
        />
      )}{creationKind && <ExtensionCreationDialog kind={creationKind} workspacePath={composerWorkspacePath}
        onClose={() => setCreationKind(null)} onPrepare={prepareExtensionCreation} />}{skillEdit && (
        <SkillEditDialog
          skill={skillEdit}
          onClose={() => setSkillEdit(null)}
          onSaved={() => {
            setSkillEdit(null);
            void refreshSkills();
            setNotice("工作模板已更新");
          }}
        />
      )}{memoryEdit && (
        <MemoryEditDialog
          row={memoryEdit}
          onClose={() => setMemoryEdit(null)}
          onSaved={() => {
            setMemoryEdit(null);
            void refreshMemories();
            setNotice("记忆已更新");
          }}
        />
      )}{settingsOpen && (
        <SettingsDialog
          onCreatePlugin={() => setCreationKind("plugin")}
          sessionId={activeSession?.id}
          sidebarWidth={appliedSidebarWidth}
          value={settings}
          onClose={() => setSettingsOpen(false)}
          onSave={saveProviderSettings}
          saveErrorRef={settingsSaveErrorRef}
          memories={memories}
          onDeleteMemory={(id) => {
            setMemories((current) => current.map((page) => ({ ...page, rows: page.rows.filter((row) => row.id !== id) })));
            void window.dyworker?.deleteMemory(id);
          }}
          onEditMemory={(row) => setMemoryEdit(row)}
          onLintMemories={() => {
            if (!window.dyworker?.lintMemories) return;
            setMemoriesLinting(true);
            setMemoriesLintMessage("");
            void window.dyworker.lintMemories()
              .then(async (result) => {
                setMemoriesLintMessage(result?.ok ? "整理完成：重复与矛盾的记忆已合并修订。" : `整理失败：${result?.error || "未知原因"}`);
                if (window.dyworker?.listMemories) setMemories(await window.dyworker.listMemories());
              })
              .catch((error) => setMemoriesLintMessage(`整理失败：${String(error)}`))
              .finally(() => setMemoriesLinting(false));
          }}
          memoriesLinting={memoriesLinting}
          memoriesLintMessage={memoriesLintMessage}
          skills={skills}
          onToggleSkill={(id, enabled) => {
            setSkills((current) => current.map((item) => item.id === id ? { ...item, enabled } : item));
            setMentionSkills((current) => current.map((item) => item.id === id ? { ...item, enabled } : item));
            void window.dyworker?.setSkillEnabled(id, enabled, workspacePath);
          }}
          onDeleteSkill={(id) => {
            setSkills((current) => current.filter((item) => item.id !== id));
            setMentionSkills((current) => current.filter((item) => item.id !== id));
            void window.dyworker?.deleteSkill(id);
          }}
          onEditSkill={(skill) => setSkillEdit(skill)}
          onRefreshSkills={() => void refreshSkills(true)}
          onOpenSkill={(skill) => {
            if (skill.path) void window.dyworker?.openPath(skill.path);
          }}
          onCreateSkill={() => setCreationKind('skill')}
          schedules={schedules}
          workspaceReady={Boolean(workspacePath)}
          currentWorkspacePath={workspacePath}
          approvalMode={approvalMode}
          onSaveSchedule={saveSchedule}
          onToggleSchedule={toggleSchedule}
          onDeleteSchedule={deleteSchedule}
          onTriggerSchedule={triggerSchedule}
          onOpenScheduleSession={(sessionId) => {
            const target = sessions.find((session) => session.id === sessionId);
            if (!target) {
              setNotice("找不到该运行记录关联的会话，可能已被删除。");
              return;
            }
            setActiveId(sessionId);
            setSettingsOpen(false);
          }}
          usageRecords={usageStats}
          onClearUsage={() => {
            setUsageStats([]);
            void window.dyworker?.clearUsageStats();
          }}
          tab={settingsTab}
          onTabChange={setSettingsTab}
          planSeed={planSeed}
          appUpdate={appUpdate}
          onCheckUpdate={openAppUpdateDialog}
        />
      )}{appUpdateDialogOpen && (
        <AppUpdateDialog
          status={appUpdate}
          onClose={() => setAppUpdateDialogOpen(false)}
          onCheck={() => void checkAppUpdate()}
          onDownload={downloadAppUpdate}
          onInstall={installAppUpdate}
        />
      )}{fullAccessDialogOpen && (
        <FullAccessDialog
          onClose={() => setFullAccessDialogOpen(false)}
          onConfirm={confirmFullAccess}
        />
      )}{identitySetupOpen && <IdentitySetupDialog onChoose={chooseIdentity} />}{contextMenu && <ContextMenuPopup menu={contextMenu} onClose={closeContextMenu} />}{selectionQuote && (
        <SelectionQuoteBar
          quote={selectionQuote}
          onAddToComposer={addSelectionToComposer}
          onSendToSideChat={sendSelectionToSideChat}
          onClose={() => setSelectionQuote(null)}
        />
      )}{annotationEditor && (
        <AnnotationEditorCard
          editor={annotationEditor}
          annotation={annotations.find((item) => item.id === annotationEditor.id) ?? null}
          voiceState={voiceState}
          onVoiceStart={() => {
            voiceTargetRef.current = (text: string) => {
              setAnnotations((current) => current.map((item) => item.id === annotationEditor.id ? { ...item, comment: item.comment ? `${item.comment}\n${text}` : text } : item));
            };
            void toggleVoiceInput();
          }}
          onClose={() => setAnnotationEditor(null)}
          onSave={(comment) => {
            setAnnotations((current) => current.map((item) => item.id === annotationEditor.id ? { ...item, comment } : item));
            setAnnotationEditor(null);
          }}
          onDelete={() => {
            setAnnotations((current) => current.filter((item) => item.id !== annotationEditor.id));
            setAnnotationEditor(null);
          }}
        />
      )}</>;
}
