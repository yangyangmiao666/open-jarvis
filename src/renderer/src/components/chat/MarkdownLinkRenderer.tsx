import { getFileType, getFileIcon } from "@/lib/file-types";
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

  const isLocalPath =
    !href.startsWith("http://") &&
    !href.startsWith("https://") &&
    !href.startsWith("data:") &&
    !href.startsWith("blob:") &&
    !href.startsWith("mailto:") &&
    !href.startsWith("#");

  if (!isLocalPath) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary underline underline-offset-2 hover:text-primary/80"
      >
        {children}
      </a>
    );
  }

  const fileName = href.split(/[/\\]/).pop() || href;
  const fileTypeInfo = getFileType(fileName);
  const icon = getFileIcon(fileName);

  // For images, render inline preview
  if (fileTypeInfo.type === "image" && threadId) {
    return (
      <InlineImagePreview
        threadId={threadId}
        filePath={href}
        mimeType={fileTypeInfo.mimeType || "image/png"}
        onClick={() => onOpenFile?.(href, fileName)}
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
        filePath={href}
        fileType={fileTypeInfo.type}
        mimeType={fileTypeInfo.mimeType}
        onClick={() => onOpenFile?.(href, fileName)}
      />
    );
  }

  // For other local files, render as a styled file card
  return (
    <button
      onClick={() => onOpenFile?.(href, fileName)}
      className="my-1 inline-flex items-center gap-2 rounded-lg border border-border bg-background-elevated px-3 py-2 text-sm transition-colors hover:bg-background-interactive/62 hover:border-primary/30"
    >
      <span className="text-base">{icon}</span>
      <span className="max-w-[200px] truncate text-foreground">{fileName}</span>
      <span className="text-[10px] text-muted-foreground">{t('workspacePicker.clickToOpen')}</span>
    </button>
  );
}
