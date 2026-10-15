import { AtSign, ChevronDown, ChevronRight, File, Folder, FolderOpen } from "lucide-react";
import { useState } from "react";
import { WORKSPACE_FILE_DRAG_TYPE } from "../../lib/files";
import type { WorkspaceEntry } from "../../types";

export function WorkspaceNode({ entry, depth = 0, onOpenFile, onInsertFile, forceExpand = false }: {
  entry: WorkspaceEntry;
  depth?: number;
  onOpenFile: (entry: WorkspaceEntry) => void;
  /** 工作台：文件行尾「@引用」按钮，把文件引用到输入框（补齐拖拽之外的显式入口） */
  onInsertFile?: (entry: WorkspaceEntry) => void;
  forceExpand?: boolean;
}) {
  // 目录默认全部收缩（含顶层），点击展开；筛选时由 forceExpand 强制展开匹配路径
  const [expandedState, setExpanded] = useState(false);
  const expanded = forceExpand || expandedState;
  const isDirectory = entry.kind === "directory";
  const hasChildren = Boolean(entry.children?.length);

  const activate = () => {
    if (isDirectory) setExpanded((value) => !value);
    else onOpenFile(entry);
  };

  return (
    <div className="tree-node">
      <button
        className="tree-row"
        style={{ paddingLeft: 8 + depth * 16 }}
        draggable={!isDirectory}
        onDragStart={(event) => {
          if (isDirectory) return;
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
      {!isDirectory && onInsertFile && (
        <button
          type="button"
          className="tree-ref-button"
          title="引用到输入框"
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
        <WorkspaceNode entry={child} depth={depth + 1} key={child.path} onOpenFile={onOpenFile} onInsertFile={onInsertFile} forceExpand={forceExpand} />
      ))}
    </div>
  );
}
