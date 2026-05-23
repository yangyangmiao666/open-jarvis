import { getFileType } from "@/lib/file-types";
import { InlineImagePreview } from "./InlineImagePreview";
import { InlineMediaPreview } from "./InlineMediaPreview";
import { useTranslation } from "react-i18next";

interface MarkdownImageRendererProps {
  src?: string;
  alt?: string;
  threadId?: string;
  onOpenFile?: (path: string, name: string) => void;
}

export function MarkdownImageRenderer({
  src,
  alt,
  threadId,
  onOpenFile,
}: MarkdownImageRendererProps): React.JSX.Element {
  const { t } = useTranslation('chat');
  if (!src) return <img alt={alt} />;

  // Remote URLs and data: URLs render as standard images
  const isLocalPath =
    !src.startsWith("http://") &&
    !src.startsWith("https://") &&
    !src.startsWith("data:") &&
    !src.startsWith("blob:");

  if (!isLocalPath || !threadId) {
    return (
      <img
        src={src}
        alt={alt}
        className="max-h-[200px] rounded-lg object-contain"
        loading="lazy"
      />
    );
  }

  // Local file path — render inline preview
  const fileName = src.split(/[/\\]/).pop() || src;
  const fileTypeInfo = getFileType(fileName);

  if (fileTypeInfo.type === "image") {
    return (
      <InlineImagePreview
        threadId={threadId}
        filePath={src}
        mimeType={fileTypeInfo.mimeType || "image/png"}
        onClick={() => onOpenFile?.(src, fileName)}
      />
    );
  }

  // Non-image media files (video, audio, PDF) — render inline media preview
  if (
    fileTypeInfo.type === "video" ||
    fileTypeInfo.type === "audio" ||
    fileTypeInfo.type === "pdf"
  ) {
    return (
      <InlineMediaPreview
        threadId={threadId}
        filePath={src}
        fileType={fileTypeInfo.type}
        mimeType={fileTypeInfo.mimeType}
        onClick={() => onOpenFile?.(src, fileName)}
      />
    );
  }

  // Non-media local files — show as a clickable file link
  return (
    <button
      onClick={() => onOpenFile?.(src, fileName)}
      className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background-elevated px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-background-interactive/62"
    >
      <span className="truncate">{fileName}</span>
      <span className="text-[10px] opacity-60">{t('workspacePicker.clickToOpen')}</span>
    </button>
  );
}