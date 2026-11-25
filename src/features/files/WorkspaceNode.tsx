import { AtSign, ChevronDown, ChevronRight, File, Folder, FolderOpen } from "lucide-react";
import { memo, useEffect, useRef, useState } from "react";
import { WORKSPACE_FILE_DRAG_TYPE } from "../../lib/files";
import type { WorkspaceEntry } from "../../types";

export const WorkspaceNode = memo(function WorkspaceTreeNode({ entry, depth = 0, onOpenFile, onInsertFile, forceExpand = false, revealedPath = null }: {
  entry: WorkspaceEntry;
  depth?: number;
  onOpenFile: (entry: WorkspaceEntry) => void;
  /** 工作台：文件/目录行尾「@引用」按钮，把文件或文件夹引用到输入框（补齐拖拽之外的显式入口） */
  onInsertFile?: (entry: WorkspaceEntry) => void;
  forceExpand?: boolean;
  revealedPath?: { path: string; nonce: number } | null;
}) {
  // 目录默认全部收缩（含顶层），点击展开；筛选时由 forceExpand 强制展开匹配路径
  const [expandedState, setExpanded] = useState(false);
  const rowRef = useRef<HTMLButtonElement | null>(null);
  const isDirectory = entry.kind === "directory";
  const isTarget = Boolean(revealedPath && revealedPath.path === entry.path);
  const isAncestor = Boolean(
    isDirectory && revealedPath && !isTarget && (
      revealedPath.path.startsWith(`${entry.path}/`) || revealedPath.path.startsWith(`${entry.path}\\`)
    )
  );
  useEffect(() => {
    if (isAncestor || isTarget) setExpanded(true);
    if (isTarget) {
      const timer = window.setTimeout(() => {
        rowRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }, 30);
      return () => window.clearTimeout(timer);
    }
  }, [isAncestor, isTarget, revealedPath?.nonce]);
  const expanded = forceExpand || expandedState;
  const hasChildren = Boolean(entry.children?.length);

  const activate = () => {
    if (isDirectory) setExpanded((value) => !value);
    else onOpenFile(entry);
  };

  return (
    <div className="tree-node">
      <button
        ref={rowRef}
        className={`tree-row${isTarget ? " revealed" : ""}`}
        style={{ paddingLeft: 8 + depth * 16 }}
        draggable={!isDirectory}
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = "copy";
          event.dataTransfer.setData(WORKSPACE_FILE_DRAG_TYPE, entry.path);
        }}
        onDoubleClick={activate}
        onClick={activate}
      >
        <span className="tree-chevron">
          {isDirectory && hasChildren ? expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} /> : null}
        </span>
        {isDirectory ? expanded ? <FolderOpen size={15} /> : <Folder size={15} /> : <File size={14} />}
        <span title={entry.path}>{entry.name}</span>
      </button>
      {onInsertFile && (
        <button
          type="button"
          className="tree-ref-button"
          title={isDirectory ? "引用文件夹到输入框" : "引用到输入框"}
          aria-label={`引用 ${entry.name} 到输入框`}
          onClick={(event) => {
            event.stopPropagation();
            onInsertFile(entry);
          }}
        >
          <AtSign size={12} />
        </button>
      )}
      {expanded && entry.children?.map((child) => (
        <WorkspaceNode entry={child} depth={depth + 1} key={child.path} onOpenFile={onOpenFile} onInsertFile={onInsertFile} forceExpand={forceExpand} revealedPath={revealedPath} />
      ))}
    </div>
  );
});
