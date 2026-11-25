import {
  File,
  FileArchive,
  FileCode2,
  FileSpreadsheet,
  FileText,
  Film,
  Folder,
  Presentation,
} from "lucide-react";
import { describeFileCardKind, type FileCardKind, type ResolvedFileAttachment } from "../../lib/channelMessage";
import { formatFileSize } from "../../lib/format";
import type { Attachment } from "../../types";

function FileKindIcon({ kind }: { kind: FileCardKind }) {
  switch (kind) {
    case "excel":
      return <FileSpreadsheet size={19} />;
    case "ppt":
      return <Presentation size={19} />;
    case "code":
      return <FileCode2 size={19} />;
    case "archive":
      return <FileArchive size={19} />;
    case "video":
      return <Film size={19} />;
    case "word":
    case "pdf":
    case "text":
      return <FileText size={19} />;
    default:
      return <File size={19} />;
  }
}

export function FileAttachmentCards({
  files,
  onOpen,
}: {
  files: ResolvedFileAttachment[];
  onOpen: (attachment: Attachment, displayName: string) => void;
}) {
  if (!files.length) return null;

  return (
    <div className="message-file-cards" aria-label="文件附件">
      {files.map(({ attachment, displayName }, index) => {
        const isDir = Boolean(attachment.isDirectory || attachment.mimeType === "inode/directory");
        const { kind, extLabel } = describeFileCardKind(displayName || attachment.path);
        const sizeText = isDir ? "" : formatFileSize(attachment.size);
        const metaText = isDir ? "文件夹" : sizeText ? `${extLabel} · ${sizeText}` : extLabel;
        const canOpen = Boolean(attachment.path);
        const key = `${attachment.path || displayName}-${index}`;
        const body = (
          <>
            <span className={`message-file-card-icon kind-${kind}`} aria-hidden="true">
              {isDir ? <Folder size={19} /> : <FileKindIcon kind={kind} />}
            </span>
            <span className="message-file-card-body">
              <span className="message-file-card-name">{displayName}</span>
              <span className="message-file-card-meta">{metaText}</span>
            </span>
          </>
        );

        return canOpen ? (
          <button
            key={key}
            type="button"
            className="message-file-card clickable"
            title={`${displayName}（点击打开）`}
            aria-label={`打开文件 ${displayName}`}
            onClick={() => onOpen(attachment, displayName)}
          >
            {body}
          </button>
        ) : (
          <div key={key} className="message-file-card" title={displayName}>
            {body}
          </div>
        );
      })}
    </div>
  );
}
