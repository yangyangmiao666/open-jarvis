import { File, Folder, Film, Music, FileText } from "lucide-react";
import type { FileType } from "@/lib/file-types";
import { useInlineMedia } from "@/lib/inline-media";

interface InlineFileThumbnailProps {
  threadId: string;
  filePath: string;
  fileType: FileType;
  mimeType?: string;
  isDir?: boolean;
  onClick?: () => void;
}

export function InlineFileThumbnail({
  threadId,
  filePath,
  fileType,
  mimeType,
  isDir,
  onClick,
}: InlineFileThumbnailProps) {
  if (isDir) {
    return (
      <button
        onClick={onClick}
        className="flex size-10 shrink-0 items-center justify-center rounded-md bg-background-interactive/50"
      >
        <Folder className="size-5 text-muted-foreground" />
      </button>
    );
  }

  if (fileType === "image") {
    return (
      <ImageThumbnail
        threadId={threadId}
        filePath={filePath}
        mimeType={mimeType || "image/png"}
        onClick={onClick}
      />
    );
  }

  const Icon = fileType === "video" || fileType === "audio"
    ? fileType === "video" ? Film : Music
    : fileType === "pdf" ? FileText : File;

  return (
    <button
      onClick={onClick}
      className="flex size-10 shrink-0 items-center justify-center rounded-md bg-background-interactive/50"
    >
      <Icon className="size-5 text-muted-foreground" />
    </button>
  );
}

function ImageThumbnail({
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
  const { url, isLoading, ref } = useInlineMedia(
    threadId,
    filePath,
    mimeType,
    { lazy: true },
  );

  return (
    <button
      ref={ref as React.Ref<HTMLButtonElement>}
      onClick={onClick}
      className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-background-interactive/50"
    >
      {isLoading && (
        <div className="size-10 animate-pulse bg-foreground/10" />
      )}
      {url && (
        <img
          src={url}
          alt=""
          className="size-10 object-cover"
          loading="lazy"
        />
      )}
      {!isLoading && !url && (
        <File className="size-5 text-muted-foreground" />
      )}
    </button>
  );
}
