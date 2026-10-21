// 输入区 / 选区标注 / 右键菜单操作（模块级 actions）。
//
// 整组函数原样从 App.tsx 搬出，只是把「读写 state 的裸标识符」改成经 store 的
// getState() 解构拿到，并把跨模块共享的 ref 换成 sharedRefs 里的模块级单例，
// 派生值（activeSession / workspaceFiles / mentionItems / createTask）改由
// sessionStore 小工具或 sharedRefs 的渲染镜像读取；函数体、文案与行为均保持不变，
// 供 App 与 ConversationPane 等任意位置 import 调用。
import { Copy } from "lucide-react";
import type { ClipboardEvent, DragEvent, MouseEvent } from "react";
import { normalizeQuote } from "../annotations";
import { findQuoteRange, type ContextMenuItem } from "../features/annotations/SelectionOverlays";
import { WORKSPACE_FILE_DRAG_TYPE } from "../lib/files";
import { copyTextToClipboard, displayWorkspace } from "../lib/text";
import { clientHost } from "../pluginRuntime/clientHostSingleton.ts";
import type { Attachment, ChatMessage, MessageAnnotation, SessionRecord, WorkspaceEntry } from "../types";
import { useComposerStore } from "./composerStore";
import { useLayoutStore } from "./layoutStore";
import { previewWorkspace } from "./previewData";
import { updateSession } from "./sessionActions";
import { selectActiveSession, useSessionStore } from "./sessionStore";
import { activeIdRef, annotationQuotesRef, createTaskRef, dismissedPluginMention, mentionItemsRef, mentionTokenPathsRef, sessionDraftsRef, sessionTokenIdsRef, textareaRef, viewportRef, workspaceFilesRef } from "./sharedRefs";
import { openFilePreview, openToolPanelTab } from "./toolPanelActions";
import { useViewStore } from "./viewStore";

const COMPOSER_LONG_PASTE_THRESHOLD = 1000;

// 把文件解析成 @token 引用：优先用用户在候选菜单里点选的路径，同名文件退回按名字匹配
export const resolveTokenFile = (name: string): WorkspaceEntry | undefined => {
  const recorded = mentionTokenPathsRef.current.get(name);
  if (recorded) {
    const exact = workspaceFilesRef.current.find((file) => file.path === recorded);
    if (exact) return exact;
  }
  return workspaceFilesRef.current.find((file) => file.name === name);
};

// 把 @「标题」token 解析成会话：优先用候选菜单点选时记录的 id（同名会话不串），
// 退回按标题匹配（最新优先），并排除当前会话——引用自己没有意义
export const resolveTokenSession = (title: string): SessionRecord | undefined => {
  const { sessions } = useSessionStore.getState();
  const activeSession = selectActiveSession(useSessionStore.getState());
  const recorded = sessionTokenIdsRef.current.get(title);
  if (recorded) {
    const exact = sessions.find((session) => session.id === recorded);
    if (exact) return exact;
  }
  return sessions
    .filter((session) => session.title === title && session.id !== activeSession?.id && session.messages.length > 0)
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))[0];
};

// 打开气泡里被引用的文件（@token 点击）：优先用消息里记录的附件路径，桌面版调主进程，预览环境给提示
export const openReferencedFile = async (name: string, knownPath?: string) => {
  const { workspacePath } = useSessionStore.getState();
  const { setNotice } = useViewStore.getState();
  const filePath = knownPath || resolveTokenFile(name)?.path;
  if (!filePath) {
    setNotice(`没有找到文件 ${name}，可能已移动或删除`);
    return;
  }
  openFilePreview(filePath, workspacePath);
};

// 在光标处插入「@文件名 」内联 token：引用随正文按顺序展示（对齐 Codex 的 @ 引用体验）
export const insertFileToken = (file: WorkspaceEntry) => {
  const { composer, setComposer, setMentionMenu } = useComposerStore.getState();
  const { setNotice } = useViewStore.getState();
  const token = `@${file.name} `;
  const textarea = textareaRef.current;
  const start = textarea ? textarea.selectionStart : composer.length;
  const end = textarea ? textarea.selectionEnd : composer.length;
  mentionTokenPathsRef.current.set(file.name, file.path);
  setComposer(composer.slice(0, start) + token + composer.slice(end));
  setMentionMenu(null);
  setNotice(`已引用文件：${file.name}`);
  window.setTimeout(() => {
    const target = textareaRef.current;
    if (target) {
      const pos = start + token.length;
      target.focus();
      target.setSelectionRange(pos, pos);
    }
  }, 0);
};

export const handleComposerDragOver = (event: DragEvent<HTMLDivElement>) => {
  const { setComposerDragActive } = useComposerStore.getState();
  if (!event.dataTransfer.types.includes(WORKSPACE_FILE_DRAG_TYPE)) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "copy";
  setComposerDragActive(true);
};

export const handleComposerDragLeave = (event: DragEvent<HTMLDivElement>) => {
  const { setComposerDragActive } = useComposerStore.getState();
  if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
  setComposerDragActive(false);
};

export const handleComposerDrop = (event: DragEvent<HTMLDivElement>) => {
  const { setComposerDragActive } = useComposerStore.getState();
  const filePath = event.dataTransfer.getData(WORKSPACE_FILE_DRAG_TYPE);
  if (!filePath) return;
  event.preventDefault();
  setComposerDragActive(false);
  const file = workspaceFilesRef.current.find((entry) => entry.path === filePath);
  if (file) insertFileToken(file);
};

// 超过阈值的大段粘贴文本折叠成块，避免撑爆输入框；发送时自动附在消息正文后
export const addLongPasteBlock = (text: string) => {
  const { setComposerPastes } = useComposerStore.getState();
  const { setNotice } = useViewStore.getState();
  setComposerPastes((current) => [...current, { id: crypto.randomUUID(), text }]);
  setNotice(`长文本已折叠（${text.length.toLocaleString()} 字），发送时会自动附带`);
};

export const handleComposerPaste = async (event: ClipboardEvent<HTMLElement>) => {
  const { setAttachments } = useComposerStore.getState();
  const { setError, setNotice } = useViewStore.getState();
  const imageItem = Array.from(event.clipboardData.items).find((item) => item.kind === "file" && item.type.startsWith("image/"));
  const image = imageItem?.getAsFile();
  if (!image) {
    const text = event.clipboardData.getData("text/plain");
    if (text.length >= COMPOSER_LONG_PASTE_THRESHOLD) {
      event.preventDefault();
      addLongPasteBlock(text);
    }
    return;
  }
  event.preventDefault();
  setError("");
  if (image.size > 12 * 1024 * 1024) {
    setError("剪贴板图片超过 12 MB，无法添加");
    return;
  }
  try {
    const owner = activeIdRef.current;
    const bytes = Array.from(new Uint8Array(await image.arrayBuffer()));
    let attachment: Attachment | undefined;
    if (window.dyworker?.saveClipboardImage) {
      const result = await window.dyworker.saveClipboardImage({ data: bytes, mimeType: image.type || "image/png", sessionId: owner });
      if (!result.ok || !result.attachment) throw new Error(result.error || "剪贴板图片保存失败");
      attachment = result.attachment;
    } else {
      const previewUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("剪贴板图片预览失败"));
        reader.readAsDataURL(image);
      });
      attachment = {
        name: "剪贴板图片.png",
        path: `clipboard-preview:${crypto.randomUUID()}`,
        size: image.size,
        mimeType: image.type || "image/png",
        isImage: true,
        previewUrl,
      };
    }
    if (activeIdRef.current !== owner) {
      const draft = sessionDraftsRef.current[owner];
      if (draft) draft.attachments = [...draft.attachments, attachment].slice(0, 12);
      return;
    }
    setAttachments((current) => current.some((entry) => entry.path === attachment!.path)
      ? current
      : [...current, attachment!].slice(0, 12));
    setNotice("已粘贴剪贴板图片");
  } catch (pasteError) {
    setError(`无法添加剪贴板图片：${pasteError instanceof Error ? pasteError.message : String(pasteError)}`);
  }
};

export const openContextMenu = (x: number, y: number, items: ContextMenuItem[]) => {
  const { setContextMenu } = useViewStore.getState();
  setContextMenu({ x, y, items });
};

export const closeContextMenu = () => useViewStore.getState().setContextMenu(null);

// 会话内容区松手：有选中文本时弹出「添加到对话 / 侧边聊天」浮动条，
// 定位在选区上方（fixed + 边缘钳制）；composer/输入框里的选区不响应
export const handleConversationMouseUp = () => {
  const { setSelectionQuote } = useComposerStore.getState();
  const selection = window.getSelection();
  const selected = selection?.toString() ?? "";
  const anchor = selection?.anchorNode;
  const collapsed = !selection || selection.isCollapsed || !selected.trim();
  const inside = Boolean(
    anchor?.nodeType === Node.TEXT_NODE
      ? anchor.parentElement?.closest(".conversation-column")
      : (anchor as Element | null)?.closest?.(".conversation-column"),
  );
  if (collapsed || !inside) {
    setSelectionQuote(null);
    return;
  }
  const range = selection.getRangeAt(0);
  const rect = range.getBoundingClientRect();
  const text = normalizeQuote(selected);
  if (!text) {
    setSelectionQuote(null);
    return;
  }
  setSelectionQuote({ text, x: rect.left + rect.width / 2, y: rect.top });
};

// 浮动条「添加到对话」：注释进 composer，评论编辑卡锚到选区上方
export const addSelectionToComposer = () => {
  const { selectionQuote, setAnnotations, setAnnotationEditor, setSelectionQuote } = useComposerStore.getState();
  if (!selectionQuote) return;
  const annotation: MessageAnnotation = { id: crypto.randomUUID(), quote: selectionQuote.text, comment: "" };
  setAnnotations((current) => [...current, annotation]);
  setAnnotationEditor({ id: annotation.id, x: selectionQuote.x, y: selectionQuote.y });
  setSelectionQuote(null);
  window.getSelection()?.removeAllRanges();
};

// 浮动条「侧边聊天」：打开右栏聊天页并把选中文本预填进草稿
export const sendSelectionToSideChat = () => {
  const { selectionQuote, setSideChatSeed, setSelectionQuote } = useComposerStore.getState();
  const { setRightPanelOpen } = useLayoutStore.getState();
  if (!selectionQuote) return;
  const text = selectionQuote.text;
  setRightPanelOpen(true);
  openToolPanelTab("chat");
  setSideChatSeed({ text, nonce: Date.now() });
  setSelectionQuote(null);
  window.getSelection()?.removeAllRanges();
};

// 从当前正文定位引用，不保留可能因文本节点替换而失效的 Range。
export const updateAnnotationMarkers = () => {
  const { setAnnotationMarkers } = useComposerStore.getState();
  const viewport = viewportRef.current;
  if (!viewport) return;
  const viewportRect = viewport.getBoundingClientRect();
  const column = viewport.querySelector(".conversation-column");
  const nextMarkers = annotationQuotesRef.current.flatMap(({ id, n, quote, comment }) => {
    // React 可能替换文本节点，旧 Range 会退化到父元素；每次从当前正文重新找引用。
    const range = findQuoteRange(column, quote);
    if (!range) return [];
    const element = range.startContainer.parentElement;
    const row = element?.closest(".message-row");
    const rowRect = row?.getBoundingClientRect();
    if (rowRect && (rowRect.bottom <= viewportRect.top || rowRect.top >= viewportRect.bottom)) return [];
    // content-visibility:auto 跳过的正文没有可靠文字坐标，不能把它画到视口左边。
    if (element && !element.checkVisibility({ contentVisibilityAuto: true })) return [];
    const rect = range.getBoundingClientRect();
    if (!rect || (!rect.width && !rect.height)) return [];
    return [{
      id,
      n,
      quote,
      comment,
      top: Math.max(2, rect.top - viewportRect.top - viewport.clientTop + viewport.scrollTop - 24),
      left: rect.left - viewportRect.left - viewport.clientLeft + viewport.scrollLeft,
    }];
  });
  setAnnotationMarkers(previous => previous.length === nextMarkers.length && previous.every((entry, index) => {
    const next = nextMarkers[index];
    return entry.id === next.id && entry.n === next.n && entry.quote === next.quote && entry.comment === next.comment
      && entry.top === next.top && entry.left === next.left;
  }) ? previous : nextMarkers);
};

// 消息文本上右键：始终提供「复制」。有选中文本时复制选中内容，
// 未选中时复制整条消息正文（跳过操作按钮、时间等非正文区域）。
export const handleMessageContextMenu = (event: MouseEvent<HTMLElement>, message?: ChatMessage) => {
  const { setNotice } = useViewStore.getState();
  event.preventDefault();
  const selection = window.getSelection();
  const selected = selection?.toString().trim() ?? "";
  const anchor = selection?.anchorNode;
  const inside = Boolean(anchor && event.currentTarget.contains(anchor));
  const hasSelected = inside && selected.length > 0;
  const bodyEl = event.currentTarget.querySelector(".message-content, .user-message-text");
  const text = hasSelected ? selected : (bodyEl?.textContent ?? event.currentTarget.textContent ?? "").trim();
  if (!text) return;
  openContextMenu(event.clientX, event.clientY, [
    {
      key: "copy-selection",
      label: hasSelected ? "复制" : "复制消息",
      icon: <Copy size={15} />,
      onSelect: () => {
        // 复制一律为纯文本（图片由缩略图上的复制按钮单独复制）
        void copyTextToClipboard(text).then((copied) => setNotice(copied ? "已复制" : "复制失败，请检查剪贴板权限"));
      },
    },
  ]);
};

// 向输入框光标处粘贴剪贴板文本；优先用异步剪贴板 API，被拦截时回退到 execCommand
export const pasteComposerText = async (start: number, end: number) => {
  const { composer, setComposer, setMentionMenu } = useComposerStore.getState();
  const { setNotice } = useViewStore.getState();
  const textarea = textareaRef.current;
  let text = "";
  // 主进程剪贴板读取不依赖渲染端权限，最可靠，优先使用
  try {
    if (window.dyworker?.readClipboardText) {
      text = await window.dyworker.readClipboardText();
    }
  } catch {
    text = "";
  }
  if (!text) {
    try {
      if (navigator.clipboard?.readText) {
        text = await navigator.clipboard.readText();
      }
    } catch {
      text = "";
    }
  }
  if (!text) {
    textarea?.focus();
    if (document.execCommand("paste")) {
      window.setTimeout(() => {
        const target = textareaRef.current;
        if (target && target.value !== composer) setComposer(target.value);
        setMentionMenu(null);
      }, 0);
    } else {
      setNotice("粘贴失败，请检查剪贴板权限");
    }
    return;
  }
  if (text.length >= COMPOSER_LONG_PASTE_THRESHOLD) {
    addLongPasteBlock(text);
    textarea?.focus();
    return;
  }
  setComposer(composer.slice(0, start) + text + composer.slice(end));
  setMentionMenu(null);
  window.setTimeout(() => {
    const target = textareaRef.current;
    if (target) {
      target.focus();
      target.setSelectionRange(start + text.length, start + text.length);
    }
  }, 0);
};

export const applyMention = (index: number, action: 'pick' | 'drill' = 'pick') => {
  const { composer, mentionMenu, setComposer, setAttachments, setActiveSkills, setComposerPastes, setAnnotations, setMentionMenu } = useComposerStore.getState();
  const { setError, setNotice } = useViewStore.getState();
  const activeSession = selectActiveSession(useSessionStore.getState());
  const item = mentionItemsRef.current[index];
  if (!item || !mentionMenu) return;
  if (item.pluginInput && activeSession?.runtime === 'dsh') {
    try {
      dismissedPluginMention.current = { sessionId: activeSession.id, text: composer,
        start: mentionMenu.start, query: mentionMenu.query };
      const draftRev = clientHost().setInputDraft(activeSession.id, composer);
      clientHost().pickInputCandidate(activeSession.id, item.pluginInput, { start: mentionMenu.start,
        end: mentionMenu.end ?? mentionMenu.start + mentionMenu.query.length + 1, draftRev }, action);
      if (action === 'pick') setMentionMenu(null);
    } catch (error) { dismissedPluginMention.current = null; setError(String((error as any)?.message || error)); }
    return;
  }
  const nativeSpan = activeSession?.runtime === 'dsh' ? clientHost().inputEditor(activeSession.id)?.clipboardSpan({
    start: mentionMenu.start, end: mentionMenu.end ?? mentionMenu.start + mentionMenu.query.length + 1,
  }) : undefined;
  const nativeStart = nativeSpan?.start ?? mentionMenu.start;
  const nativeEnd = nativeSpan?.end ?? mentionMenu.start + mentionMenu.query.length + 1;
  if (mentionMenu.kind === "slash" && item.id === "builtin:new") {
    setMentionMenu(null);
    setComposer("");
    setAttachments([]);
    setActiveSkills([]);
    setComposerPastes([]);
    setAnnotations([]);
    if (activeSession && activeSession.messages.length === 0) {
      setNotice("当前已是新会话");
      window.setTimeout(() => textareaRef.current?.focus(), 0);
    } else {
      createTaskRef.current();
      setNotice("已开启新会话");
    }
    return;
  }
  if (mentionMenu.kind === "slash" && item.prompt) {
    // 内置命令（如 /init）：把预设指令填入输入框，由用户确认后发送
    setComposer(item.prompt);
  } else if (mentionMenu.kind === "at" && item.file) {
    // 文件引用：在 @ 位置原地插入内联 token，引用按输入顺序留在正文里
    const token = `@${item.file.name} `;
    const start = nativeStart;
    const end = nativeEnd;
    mentionTokenPathsRef.current.set(item.file.name, item.file.path);
    setComposer(composer.slice(0, start) + token + composer.slice(end));
    window.setTimeout(() => {
      const target = textareaRef.current;
      if (target) {
        const pos = start + token.length;
        target.focus();
        target.setSelectionRange(pos, pos);
      }
    }, 0);
  } else if (mentionMenu.kind === "at" && item.session) {
    // 会话引用：在 @ 位置原地插入「@「标题」」内联 token，标题用全角括号定界（可含空格）
    const session = item.session;
    const token = `@「${session.title}」 `;
    const start = nativeStart;
    const end = nativeEnd;
    sessionTokenIdsRef.current.set(session.title, session.id);
    setComposer(composer.slice(0, start) + token + composer.slice(end));
    setNotice(`已引用会话：${session.title}`);
    window.setTimeout(() => {
      const target = textareaRef.current;
      if (target) {
        const pos = start + token.length;
        target.focus();
        target.setSelectionRange(pos, pos);
      }
    }, 0);
  } else if (mentionMenu.kind === "slash" && item.skill) {
    // 技能引用：在 / 触发位置原地插入 /技能名 内联 token，前后正文保留（与 @文件 同一融合呈现）
    const skill = item.skill;
    const token = `/${skill.name} `;
    const start = nativeStart;
    const end = nativeEnd;
    setActiveSkills((current) => current.some((entry) => entry.id === skill.id) ? current : [...current, skill]);
    setComposer(composer.slice(0, start) + token + composer.slice(end));
    window.setTimeout(() => {
      const target = textareaRef.current;
      if (target) {
        const pos = start + token.length;
        target.focus();
        target.setSelectionRange(pos, pos);
      }
    }, 0);
  } else {
    // 防御：仅清掉触发文本
    setComposer(composer.slice(0, mentionMenu.start));
  }
  setMentionMenu(null);
  if (mentionMenu.kind === "slash") window.setTimeout(() => textareaRef.current?.focus(), 0);
};

export const chooseWorkspace = async () => {
  const { setWorkspacePath, setWorkspaceEntries } = useSessionStore.getState();
  const { setAddMenuOpen, setWorkspaceOpen } = useLayoutStore.getState();
  const { setError, setNotice } = useViewStore.getState();
  const activeSession = selectActiveSession(useSessionStore.getState());
  setAddMenuOpen(false);
  setError("");
  try {
    const result = window.dyworker
      ? await window.dyworker.chooseWorkspace()
      : { canceled: false, path: "/workspace/dyworker", entries: previewWorkspace };
    if (result.canceled || !result.path) {
      setNotice("已取消选择工作文件夹");
      return;
    }
    setWorkspacePath(result.path);
    setWorkspaceEntries(result.entries || []);
    setWorkspaceOpen(true);
    setNotice(`工作文件夹已选择：${displayWorkspace(result.path)}`);
    if (activeSession) updateSession(activeSession.id, (session) => ({ ...session, workspacePath: result.path! }));
  } catch (workspaceError) {
    setError(`无法打开工作文件夹：${workspaceError instanceof Error ? workspaceError.message : String(workspaceError)}`);
  }
};

export const chooseAttachments = async () => {
  const { setAttachments } = useComposerStore.getState();
  const { setAddMenuOpen } = useLayoutStore.getState();
  const { setError, setNotice } = useViewStore.getState();
  const owner = activeIdRef.current;
  setAddMenuOpen(false);
  setError("");
  try {
    const result = window.dyworker
      ? await window.dyworker.chooseAttachments(owner)
      : {
          canceled: false,
          attachments: [{
            name: "界面需求说明.md",
            path: "/preview/界面需求说明.md",
            size: 1840,
            mimeType: "text/markdown",
            isImage: false,
          }],
        };
    if (result.canceled || !result.attachments.length) {
      setNotice("未添加附件");
      return;
    }
    if (activeIdRef.current !== owner) {
      const draft = sessionDraftsRef.current[owner];
      if (draft) draft.attachments = [...draft.attachments, ...result.attachments].slice(0, 12);
      return;
    }
    setAttachments((current) => {
      const known = new Set(current.map((attachment) => attachment.path));
      return [...current, ...result.attachments.filter((attachment) => !known.has(attachment.path))].slice(0, 12);
    });
    setNotice(`已添加 ${result.attachments.length} 个附件`);
    textareaRef.current?.focus();
  } catch (attachmentError) {
    setError(`无法添加附件：${attachmentError instanceof Error ? attachmentError.message : String(attachmentError)}`);
  }
};
