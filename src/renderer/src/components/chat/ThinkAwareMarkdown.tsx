import { memo, useMemo, useState } from "react";
import { Brain, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { StreamingMarkdown } from "./StreamingMarkdown";

interface ThinkAwareMarkdownProps {
  children: string;
  isStreaming?: boolean;
  threadId?: string;
  onOpenFile?: (path: string, name: string) => void;
}

interface Segment {
  kind: "markdown" | "think";
  content: string;
}

function summarizeThinkContent(content: string): string {
  const normalized = content
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/(^|\s)[#>*_~-]+/gm, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) {
    return "已完成思考，点击展开查看详情。";
  }

  const sentences = normalized
    .split(/(?<=[。！？.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  const selected =
    sentences.length > 0 ? sentences.slice(0, 2).join(" ") : normalized;
  const clipped =
    selected.length > 96 ? `${selected.slice(0, 96).trimEnd()}...` : selected;
  return clipped;
}

function parseThinkSegments(input: string, isStreaming: boolean): Segment[] {
  const segments: Segment[] = [];
  const openTag = "<think>";
  const closeTag = "</think>";
  let cursor = 0;

  while (cursor < input.length) {
    const start = input.indexOf(openTag, cursor);
    if (start === -1) {
      const tail = input.slice(cursor);
      if (tail) segments.push({ kind: "markdown", content: tail });
      break;
    }

    const before = input.slice(cursor, start);
    if (before) segments.push({ kind: "markdown", content: before });

    const contentStart = start + openTag.length;
    const end = input.indexOf(closeTag, contentStart);
    if (end === -1) {
      const thinkContent = input.slice(contentStart);
      if (thinkContent || isStreaming) {
        segments.push({ kind: "think", content: thinkContent });
      }
      break;
    }

    const thinkContent = input.slice(contentStart, end);
    segments.push({ kind: "think", content: thinkContent });
    cursor = end + closeTag.length;
  }

  return segments;
}

export const ThinkAwareMarkdown = memo(function ThinkAwareMarkdown({
  children,
  isStreaming = false,
  threadId,
  onOpenFile,
}: ThinkAwareMarkdownProps): React.JSX.Element {
  const segments = parseThinkSegments(children, isStreaming);

  return (
    <div className="space-y-3">
      {segments.map((segment, index) => {
        const isLast = index === segments.length - 1;

        if (segment.kind === "think") {
          return (
            <ThinkBlock
              key={`think-${index}-${isStreaming && isLast ? "streaming" : "settled"}`}
              content={segment.content}
              isStreaming={isStreaming && isLast}
              threadId={threadId}
              onOpenFile={onOpenFile}
            />
          );
        }

        return (
          <StreamingMarkdown
            key={`markdown-${index}`}
            isStreaming={isStreaming && isLast}
            threadId={threadId}
            onOpenFile={onOpenFile}
          >
            {segment.content}
          </StreamingMarkdown>
        );
      })}
    </div>
  );
});

interface ThinkBlockProps {
  content: string;
  isStreaming: boolean;
  threadId?: string;
  onOpenFile?: (path: string, name: string) => void;
}

function ThinkBlock({
  content,
  isStreaming,
  threadId,
  onOpenFile,
}: ThinkBlockProps): React.JSX.Element {
  const [expanded, setExpanded] = useState(isStreaming);
  const summary = useMemo(() => summarizeThinkContent(content), [content]);
  const showSummary = !isStreaming && !expanded;

  return (
    <div className={cn("think-block", expanded && "is-open")}>
      <button
        type="button"
        className="think-summary"
        onClick={() => setExpanded((value) => !value)}
      >
        <span className="flex min-w-0 flex-1 items-start gap-3">
          <span className="think-icon-shell">
            <Brain className="size-3.5 text-primary" strokeWidth={1.8} />
          </span>
          <span className="min-w-0 text-left">
            <span className="think-summary-title">
              {isStreaming ? "思考中" : "思考过程"}
            </span>
            {showSummary ? (
              <span className="think-summary-text">{summary}</span>
            ) : null}
          </span>
        </span>
        <ChevronDown className="think-chevron size-3.5" strokeWidth={1.8} />
      </button>
      {expanded && (
        <div className="think-content">
          <StreamingMarkdown
            isStreaming={false}
            threadId={threadId}
            onOpenFile={onOpenFile}
          >
            {content || "*思考内容为空*"}
          </StreamingMarkdown>
        </div>
      )}
    </div>
  );
}