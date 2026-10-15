import { FolderOpen, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { FileBrowserToolbar } from "../../FileBrowserToolbar";
import { FileTextEditor } from "../../FileTextEditor";
import { filterWorkspaceEntries, isMarkdownFile, isTextPreviewFile } from "../../lib/files";
import type { WorkspaceEntry } from "../../types";
import { MarkdownLiveEditorPane } from "./MarkdownLiveEditorPane";
import { WorkspaceNode } from "./WorkspaceNode";

// ===== Codex 风格文件浏览:左预览右目录树 =====

type FilePanelSelection = {
  path: string;
  name: string;
  kind: "markdown" | "code";
  content: string;
  loading: boolean;
  error?: string;
};

// 未保存草稿（工作台「编辑与保存」）：切文件、切面板、重启应用都不丢，保存后清除
const FILE_DRAFTS_KEY = "dyworker:file-drafts";
const MAX_FILE_DRAFTS = 50;

function loadFileDrafts(): Record<string, { content: string; savedAt: string }> {
  try {
    const parsed = JSON.parse(localStorage.getItem(FILE_DRAFTS_KEY) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function persistFileDrafts(drafts: Record<string, { content: string; savedAt: string }>) {
  try {
    localStorage.setItem(FILE_DRAFTS_KEY, JSON.stringify(drafts));
  } catch {
    // 容量不足时放弃持久化，不阻塞编辑
  }
}

export function FilesSplitPanel({
  workspacePath,
  workspaceEntries,
  workspaceOpen,
  onRefresh,
  onError,
  onInsertFile,
  onPreviewFile,
  onChoosePreviewFile,
}: {
  onPreviewFile: (path: string) => void;
  onChoosePreviewFile: () => void;
  workspacePath: string;
  workspaceEntries: WorkspaceEntry[];
  workspaceOpen: boolean;
  onRefresh: () => void;
  onError: (message: string) => void;
  onInsertFile?: (entry: WorkspaceEntry) => void;
}) {
  const [fileFilter, setFileFilter] = useState("");
  const [selection, setSelection] = useState<FilePanelSelection | null>(null);
  // markdown 默认即时渲染编辑（Codex 式：行首显示源码、其余渲染态），可切换为纯源码编辑
  const [showSource, setShowSource] = useState(false);
  const [wrap, setWrap] = useState(true);
  const previewRequest = useRef(0);
  // 右侧文件树开关（默认开启）与拖拽调宽（null = 跟随默认弹性宽度）
  const [treeVisible, setTreeVisible] = useState(true);
  const [treeWidth, setTreeWidth] = useState<number | null>(null);
  const treeRef = useRef<HTMLDivElement | null>(null);
  const treeResizeRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const [editContent, setEditContent] = useState("");
  const [saveError, setSaveError] = useState("");
  const [saveState, setSaveState] = useState<"idle" | "pending" | "saving" | "saved">("idle");
  // 草稿是崩溃备份：自动保存成功后清除
  const draftsRef = useRef<Record<string, { content: string; savedAt: string }>>(loadFileDrafts());
  const draftPersistTimerRef = useRef<number | null>(null);
  // 待落盘队列：path → { workspacePath, content }。切换工作区后仍按原工作区写盘
  const pendingSavesRef = useRef<Map<string, { workspacePath: string; content: string }>>(new Map());
  const saveTimerRef = useRef<number | null>(null);
  const savingRef = useRef(false);
  // 每个文件最近一次编辑内容：写盘完成后判断是否仍有更新内容，避免旧结果回写基准
  const latestEditRef = useRef<{ path: string; content: string } | null>(null);
  const fileFilterActive = Boolean(fileFilter.trim());
  const visibleEntries = useMemo(
    () => filterWorkspaceEntries(workspaceEntries, fileFilter),
    [workspaceEntries, fileFilter],
  );

  const draftKeyFor = (workspace: string, path: string) => `${workspace}|${path}`;

  // 自动保存：防抖落盘；切文件、切工作区、面板卸载前都会先冲刷队列
  const flushSaves = async () => {
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    if (savingRef.current) {
      // 上一次写入未结束，稍后再试，避免并发写同一文件
      if (pendingSavesRef.current.size) {
        saveTimerRef.current = window.setTimeout(() => {
          saveTimerRef.current = null;
          void flushSaves();
        }, 300);
      }
      return;
    }
    const next = pendingSavesRef.current.entries().next().value as [string, { workspacePath: string; content: string }] | undefined;
    if (!next) return;
    const [path, pending] = next;
    pendingSavesRef.current.delete(path);
    if (!window.dyworker?.writeWorkspaceFile) {
      setSaveError("当前预览环境没有写入文件的通道");
      return;
    }
    savingRef.current = true;
    setSaveState("saving");
    setSaveError("");
    try {
      const result = await window.dyworker.writeWorkspaceFile(pending.workspacePath, path, pending.content);
      if (!result.ok) {
        // 写失败：内容回到队列（除非已有更新版本在排队），等下一次编辑再触发；
        // 内容同时留在 localStorage 草稿里，不会丢
        if (!pendingSavesRef.current.has(path)) pendingSavesRef.current.set(path, pending);
        setSaveState("pending");
        setSaveError(result.error || "保存失败");
        return;
      }
      // 队列里没有该文件的更新内容时才能清草稿、推进显示基准
      if (!pendingSavesRef.current.has(path)) {
        delete draftsRef.current[draftKeyFor(pending.workspacePath, path)];
        persistFileDrafts(draftsRef.current);
      }
      const latest = latestEditRef.current;
      if (latest && latest.path === path && latest.content === pending.content) {
        setSelection((current) => current && current.path === path ? { ...current, content: pending.content } : current);
      }
      setSaveState((state) => (state === "saving" ? "saved" : state));
    } catch (saveError) {
      if (!pendingSavesRef.current.has(path)) pendingSavesRef.current.set(path, pending);
      setSaveState("pending");
      setSaveError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      savingRef.current = false;
    }
    // 队列里还有别的文件/更新内容，继续落盘
    if (pendingSavesRef.current.size) void flushSaves();
  };

  const scheduleSave = (path: string, content: string) => {
    pendingSavesRef.current.set(path, { workspacePath, content });
    setSaveState("pending");
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null;
      void flushSaves();
    }, 800);
  };

  // 崩溃备份草稿：每次编辑都记，自动保存成功后由 flushSaves 清除；超上限淘汰最旧。
  // 落盘做 800ms 尾沿防抖：此前每个击键都 JSON.stringify 全部草稿并同步写 localStorage
  const updateDraftFor = (path: string, content: string) => {
    draftsRef.current[draftKeyFor(workspacePath, path)] = { content, savedAt: new Date().toISOString() };
    const keys = Object.keys(draftsRef.current);
    if (keys.length > MAX_FILE_DRAFTS) {
      const stale = keys
        .map((item) => ({ key: item, savedAt: draftsRef.current[item].savedAt }))
        .sort((a, b) => a.savedAt.localeCompare(b.savedAt))
        .slice(0, keys.length - MAX_FILE_DRAFTS);
      for (const entry of stale) delete draftsRef.current[entry.key];
    }
    if (draftPersistTimerRef.current) window.clearTimeout(draftPersistTimerRef.current);
    draftPersistTimerRef.current = window.setTimeout(() => {
      draftPersistTimerRef.current = null;
      persistFileDrafts(draftsRef.current);
    }, 800);
  };

  const handleEditChange = (path: string, value: string) => {
    latestEditRef.current = { path, content: value };
    updateDraftFor(path, value);
    scheduleSave(path, value);
    // 卸载提交（Typora 块失焦）可能来自上一个文件的渲染闭包：只对当前选中文件更新编辑区
    if (selection && selection.path === path) setEditContent(value);
  };

  useEffect(() => {
    previewRequest.current += 1;
    void flushSaves();
    setSelection(null);
    setFileFilter("");
    setSaveError("");
    setSaveState("idle");
    setShowSource(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspacePath]);

  // 面板卸载前冲刷一次（setState 在卸载后是 no-op，写盘照常完成）
  const flushSavesRef = useRef(flushSaves);
  flushSavesRef.current = flushSaves;
  useEffect(() => () => {
    void flushSavesRef.current();
  }, []);

  // 文件树拖拽调宽：在预览区与目录树之间的分隔条上按下后，跟随指针调整右侧树宽度
  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      const resize = treeResizeRef.current;
      if (!resize) return;
      const maxWidth = Math.max(320, Math.round(window.innerWidth * 0.5));
      setTreeWidth(Math.min(Math.max(resize.startWidth + (resize.startX - event.clientX), 200), maxWidth));
    };
    const onPointerUp = () => {
      treeResizeRef.current = null;
      document.body.classList.remove("resizing-panels");
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, []);

  const previewFile = async (entry: WorkspaceEntry) => {
    const request = ++previewRequest.current;
    const previewKind: "markdown" | "code" | "" = isMarkdownFile(entry.path) ? "markdown" : isTextPreviewFile(entry.path) ? "code" : "";
    // 切走前把上一个文件的待保存内容落盘
    void flushSaves();
    setShowSource(false);
    setSaveError("");
    setSaveState("idle");
    if (!previewKind) {
      onPreviewFile(entry.path);
      return;
    }
    setSelection({ path: entry.path, name: entry.name, kind: previewKind, content: "", loading: true });
    const readFile = previewKind === "markdown" ? window.dyworker?.readWorkspaceMarkdown : window.dyworker?.readWorkspaceFile;
    if (!readFile) {
      setSelection({ path: entry.path, name: entry.name, kind: previewKind, content: "", loading: false, error: "当前预览环境无法读取文件" });
      return;
    }
    try {
      const result = await readFile.call(window.dyworker, workspacePath, entry.path);
      if (request !== previewRequest.current) return;
      if (!result.ok) {
        if ("binary" in result && result.binary) {
          // 后缀像文本但内容是二进制：交给系统打开
          setSelection(null);
          onPreviewFile(entry.path);
          return;
        }
        setSelection({ path: entry.path, name: entry.name, kind: previewKind, content: "", loading: false, error: result.error || "文件读取失败" });
        return;
      }
      const diskContent = result.content || "";
      // 有崩溃备份草稿（自动保存没来得及落盘）时恢复草稿并立即补一次自动保存
      const draft = draftsRef.current[draftKeyFor(workspacePath, entry.path)];
      const initial = draft ? draft.content : diskContent;
      setSelection({ path: entry.path, name: entry.name, kind: previewKind, content: diskContent, loading: false });
      setEditContent(initial);
      latestEditRef.current = { path: entry.path, content: initial };
      if (draft && draft.content !== diskContent) scheduleSave(entry.path, draft.content);
    } catch (previewError) {
      if (request !== previewRequest.current) return;
      setSelection({ path: entry.path, name: entry.name, kind: previewKind, content: "", loading: false, error: `文件读取失败：${previewError instanceof Error ? previewError.message : String(previewError)}` });
    }
  };

  return (
    <div className={`file-split ${treeVisible ? "" : "tree-hidden"}`}>
      <FileBrowserToolbar
        path={selection?.path} workspacePath={workspacePath} content={editContent}
        textReady={Boolean(selection && !selection.loading && !selection.error)}
        wrap={wrap} onToggleWrap={() => setWrap(value => !value)}
        treeVisible={treeVisible} onToggleTree={() => setTreeVisible(value => !value)}
        onChooseFile={onChoosePreviewFile} onRefresh={onRefresh}
        onToggleSource={selection?.kind === "markdown" ? () => setShowSource(value => !value) : undefined}
        showSource={showSource}
        beforeOpen={async () => { await flushSaves(); if (pendingSavesRef.current.size || savingRef.current) throw new Error("文件尚未保存，请保存完成后再打开"); }}
        status={selection && saveState !== "idle" && !selection.loading && !selection.error ? <span className={`file-save-state ${saveState}`}>{saveState === "pending" ? "待保存" : saveState === "saving" ? "保存中…" : "已保存"}</span> : undefined}
      />
      <div className="file-split-body">
        <div className="file-split-preview">
          <div className="file-split-preview-inner">
            {!selection ? (
              <div className="browser-empty-state">
                <FolderOpen size={46} />
                <strong>打开文件</strong>
                <span>从工作区目录树中选择文件</span>
              </div>
            ) : (
              <>
              {saveError && <p className="panel-empty error-text">{saveError}</p>}
              {selection.loading ? (
                <p className="panel-empty">正在读取文件…</p>
              ) : selection.error ? (
                <p className="panel-empty error-text">{selection.error}</p>
              ) : selection.kind === "markdown" ? (
                // Codex 式即时渲染编辑：光标在行首显示该行源码，其余位置渲染态直接编辑；
                // showSource 切换为纯源码模式
                <MarkdownLiveEditorPane
                  key={selection.path}
                  path={selection.path}
                  name={selection.name}
                  value={editContent}
                  plainSource={showSource}
                  wrap={wrap}
                  onChange={(value) => handleEditChange(selection.path, value)}
                  onSaveRequest={() => void flushSaves()}
                />
              ) : (
                // 文本文件打开即编辑状态，自动保存
                <FileTextEditor key={selection.path} name={selection.name} value={editContent} wrap={wrap}
                  onChange={(value) => handleEditChange(selection.path, value)} onSave={() => void flushSaves()} />
              )}
              </>
            )}
          </div>
        </div>
        {treeVisible && (
          <div
            className="file-split-resizer"
            role="separator"
            aria-orientation="vertical"
            aria-label="调整文件树宽度"
            onPointerDown={(event) => {
              event.preventDefault();
              treeResizeRef.current = {
                startX: event.clientX,
                startWidth: treeRef.current?.getBoundingClientRect().width || 280,
              };
              document.body.classList.add("resizing-panels");
            }}
          />
        )}
        {treeVisible && (
        <div
          className={`file-split-tree ${treeWidth ? "pinned" : ""}`}
          ref={treeRef}
          style={treeWidth ? { flex: `0 0 ${treeWidth}px`, width: treeWidth } : undefined}
        >
          {workspacePath && (
            <div className="tool-file-filter">
              <Search size={14} />
              <input
                placeholder="筛选文件…"
                aria-label="筛选文件"
                value={fileFilter}
                onChange={(event) => setFileFilter(event.target.value)}
              />
              {fileFilterActive && (
                <button className="icon-button subtle tiny" aria-label="清除筛选" title="清除筛选" onClick={() => setFileFilter("")}>
                  <X size={13} />
                </button>
              )}
            </div>
          )}
          {workspaceOpen && (workspaceEntries.length ? (visibleEntries.length ? (
            <div className="workspace-tree">
              {visibleEntries.map((entry) => (
                <WorkspaceNode entry={entry} key={entry.path} onOpenFile={(item) => void previewFile(item)} onInsertFile={onInsertFile} forceExpand={fileFilterActive} />
              ))}
            </div>
          ) : (
            <p className="panel-empty">没有匹配「{fileFilter.trim()}」的文件。</p>
          )) : (
            workspacePath ? <p className="panel-empty">这个文件夹是空的。</p> : null
          ))}
          {!workspacePath && <p className="panel-empty">选择工作文件夹后，可以在这里浏览和引用文件。</p>}
        </div>
        )}
      </div>
    </div>
  );
}
