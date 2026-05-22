import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { memo, useMemo } from "react";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { MarkdownImageRenderer } from "./MarkdownImageRenderer";
import { MarkdownLinkRenderer } from "./MarkdownLinkRenderer";

interface StreamingMarkdownProps {
  children: string;
  isStreaming?: boolean;
  threadId?: string;
  onOpenFile?: (path: string, name: string) => void;
}

export const StreamingMarkdown = memo(function StreamingMarkdown({
  children,
  isStreaming = false,
  threadId,
  onOpenFile,
}: StreamingMarkdownProps): React.JSX.Element {
  const components = useMemo(
    () =>
      threadId
        ? {
            img: ({
              src,
              alt,
            }: React.ImgHTMLAttributes<HTMLImageElement> & { node?: unknown }) => (
              <MarkdownImageRenderer
                src={src}
                alt={alt}
                threadId={threadId}
                onOpenFile={onOpenFile}
              />
            ),
            a: ({
              href,
              children,
            }: React.AnchorHTMLAttributes<HTMLAnchorElement> & {
              node?: unknown;
              children?: React.ReactNode;
            }) => (
              <MarkdownLinkRenderer
                href={href}
                threadId={threadId}
                onOpenFile={onOpenFile}
              >
                {children}
              </MarkdownLinkRenderer>
            ),
          }
        : undefined,
    [threadId, onOpenFile],
  );

  return (
    <div className="streaming-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={components}
      >
        {children}
      </ReactMarkdown>
      {isStreaming && (
        <span className="inline-block w-2 h-4 ml-0.5 bg-foreground/70 animate-pulse" />
      )}
    </div>
  );
});