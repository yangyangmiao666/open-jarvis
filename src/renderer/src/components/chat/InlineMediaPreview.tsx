import { FileText } from "lucide-react";
import type { FileType } from "@/lib/file-types";
import { useInlineMedia } from "@/lib/inline-media";
import { InlineImagePreview } from "./InlineImagePreview";

interface InlineMediaPreviewProps {
  threadId: string;
  filePath: string;
  fileType: FileType;
  mimeType?: string;
  onClick?: () => void;
  maxHeight?: number;
  className?: string;
}

export function InlineMediaPreview({
  threadId,
  filePath,
  fileType,
  mimeType,
  onClick,
  maxHeight = 200,
  className,
}: InlineMediaPreviewProps) {
  switch (fileType) {
    case "image":
      return (
        <InlineImagePreview
          threadId={threadId}
          filePath={filePath}
          mimeType={mimeType || "image/png"}
          onClick={onClick}
          maxHeight={maxHeight}
          className={className}
        />
      );

    case "video": {
      return (
        <InlineVideoPreview
          threadId={threadId}
          filePath={filePath}
          mimeType={mimeType || "video/mp4"}
          onClick={onClick}
        />
      );
    }

    case "audio": {
      return (
        <InlineAudioPreview
          threadId={threadId}
          filePath={filePath}
          mimeType={mimeType || "audio/mpeg"}
        />
      );
    }

    case "pdf":
      return (
        <InlinePdfPlaceholder filePath={filePath} onClick={onClick} />
      );

    default:
      return null;
  }
}

function InlineVideoPreview({
  threadId,
  filePath,
  mimeType,
  onClick,
}: {
  threadId: string;
  filePath: string;
  mimeType: string;
  onClick?: () => void;
}) {
  const { url, isLoading, error, ref } = useInlineMedia(
    threadId,
    filePath,
    mimeType,
  );

  return (
    <div ref={ref} className="inline-block max-w-full">
      {isLoading && (
        <div className="animate-pulse rounded-lg bg-foreground/10" style={{ width: 280, height: 160 }} />
      )}
      {error && (
        <div className="rounded-lg border border-border bg-background-elevated px-3 py-2 text-xs text-muted-foreground">
          无法预览: {error}
        </div>
      )}
      {url && (
        <video
          src={url}
          controls
          preload="metadata"
          className="cursor-pointer rounded-lg border border-border/50"
          style={{ maxHeight: 200, maxWidth: "100%" }}
          onClick={onClick}
        />
      )}
    </div>
  );
}

function InlineAudioPreview({
  threadId,
  filePath,
  mimeType,
}: {
  threadId: string;
  filePath: string;
  mimeType: string;
}) {
  const { url, isLoading, error, ref } = useInlineMedia(
    threadId,
    filePath,
    mimeType,
  );

  return (
    <div ref={ref}>
      {isLoading && (
        <div className="animate-pulse rounded-lg bg-foreground/10" style={{ width: 280, height: 40 }} />
      )}
      {error && (
        <div className="rounded-lg border border-border bg-background-elevated px-3 py-2 text-xs text-muted-foreground">
          无法预览: {error}
        </div>
      )}
      {url && (
        <audio src={url} controls className="h-8 max-w-full" />
      )}
    </div>
  );
}

function InlinePdfPlaceholder({
  filePath,
  onClick,
}: {
  filePath: string;
  onClick?: () => void;
}) {
  const fileName = filePath.split(/[/\\]/).pop() || filePath;
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2 rounded-lg border border-border bg-background-elevated px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-background-interactive/62"
    >
      <FileText className="size-4" />
      <span className="truncate">{fileName}</span>
      <span className="text-[10px]">点击查看</span>
    </button>
  );
}
