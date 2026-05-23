import { Maximize2 } from "lucide-react";
import { useInlineMedia } from "@/lib/inline-media";
import { useTranslation } from "react-i18next";

interface InlineImagePreviewProps {
  threadId: string;
  filePath: string;
  mimeType: string;
  onClick?: () => void;
  maxHeight?: number;
  className?: string;
}

export function InlineImagePreview({
  threadId,
  filePath,
  mimeType,
  onClick,
  maxHeight = 200,
  className,
}: InlineImagePreviewProps) {
  const { t } = useTranslation('chat');
  const { url, isLoading, error, ref } = useInlineMedia(
    threadId,
    filePath,
    mimeType,
  );

  return (
    <div
      ref={ref}
      className={`group relative inline-block max-w-full ${className ?? ""}`}
    >
      {isLoading && (
        <div
          className="animate-pulse rounded-lg bg-foreground/10"
          style={{ width: 200, height: Math.min(maxHeight, 150) }}
        />
      )}
      {error && (
        <div className="rounded-lg border border-border bg-background-elevated px-3 py-2 text-xs text-muted-foreground">
          {t('inlineMedia.cannotPreview')}: {error}
        </div>
      )}
      {url && (
        <div className="relative">
          <img
            src={url}
            alt={filePath.split(/[/\\]/).pop() || "image"}
            className="cursor-pointer rounded-lg border border-border/50 object-contain transition-opacity hover:opacity-90"
            style={{ maxHeight, maxWidth: "100%" }}
            onClick={onClick}
            loading="lazy"
          />
          {onClick && (
            <button
              className="absolute right-2 top-2 rounded-md bg-background/80 p-1 opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100"
              onClick={onClick}
            >
              <Maximize2 className="size-3.5 text-foreground" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
