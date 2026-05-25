import { getFileType, getFileIcon } from "@/lib/file-types";
import { normalizeLocalFilePath } from "@/lib/utils";
import { InlineImagePreview } from "./InlineImagePreview";
import { InlineMediaPreview } from "./InlineMediaPreview";
import { useTranslation } from "react-i18next";

interface MarkdownLinkRendererProps {
  href?: string;
  children?: React.ReactNode;
  threadId?: string;
  onOpenFile?: (path: string, name: string) => void;
}

export function MarkdownLinkRenderer({
  href,
  children,
  threadId,
  onOpenFile,
}: MarkdownLinkRendererProps): React.JSX.Element {
  const { t } = useTranslation('chat');
  if (!href) return <span>{children}</span>;

  const normalizedHref = normalizeLocalFilePath(href);

  const isLocalPath =
    !normalizedHref.startsWith("http://") &&
    !normalizedHref.startsWith("https://") &&
    !normalizedHref.startsWith("data:") &&
    !normalizedHref.startsWith("blob:") &&
    !normalizedHref.startsWith("mailto:") &&
    !normalizedHref.startsWith("#");

  if (!isLocalPath) {
    return (
      <a
        href={normalizedHref}
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary underline underline-offset-2 hover:text-primary/80"
      >
        {children}
      </a>
    );
  }

  const fileName = normalizedHref.split(/[/\\]/).pop() || normalizedHref;
  const fileTypeInfo = getFileType(fileName);
  const icon = getFileIcon(fileName);

  // For images, render inline preview
  if (fileTypeInfo.type === "image" && threadId) {
    return (
      <InlineImagePreview
        threadId={threadId}
        filePath={normalizedHref}
        mimeType={fileTypeInfo.mimeType || "image/png"}
        onClick={() => onOpenFile?.(normalizedHref, fileName)}
      />
    );
  }

  // For video/audio/PDF, render inline media preview
  if (
    (fileTypeInfo.type === "video" ||
      fileTypeInfo.type === "audio" ||
      fileTypeInfo.type === "pdf") &&
    threadId
  ) {
    return (
      <InlineMediaPreview
        threadId={threadId}
        filePath={normalizedHref}
        fileType={fileTypeInfo.type}
        mimeType={fileTypeInfo.mimeType}
        onClick={() => onOpenFile?.(normalizedHref, fileName)}
      />
    );
  }

  // For other local files, render as a styled file card
  return (
    <button
      onClick={() => onOpenFile?.(normalizedHref, fileName)}
      className="my-1 inline-flex items-center gap-2 rounded-lg border border-border bg-background-elevated px-3 py-2 text-sm transition-colors hover:bg-background-interactive/62 hover:border-primary/30"
    >
      <span className="text-base">{icon}</span>
      <span className="max-w-[200px] truncate text-foreground">{fileName}</span>
      <span className="text-[10px] text-muted-foreground">{t('workspacePicker.clickToOpen')}</span>
    </button>
  );
}
