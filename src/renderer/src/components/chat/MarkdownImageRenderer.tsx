import { getFileType } from "@/lib/file-types";
import { InlineImagePreview } from "./InlineImagePreview";

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
  const fileName = src.split("/").pop() || src;
  const fileTypeInfo = getFileType(fileName);

  if (fileTypeInfo.type !== "image") {
    // Non-image local files referenced as images — just show as standard img
    return (
      <img
        src={src}
        alt={alt}
        className="max-h-[200px] rounded-lg object-contain"
        loading="lazy"
      />
    );
  }

  return (
    <InlineImagePreview
      threadId={threadId}
      filePath={src}
      mimeType={fileTypeInfo.mimeType || "image/png"}
      onClick={() => onOpenFile?.(src, fileName)}
    />
  );
}