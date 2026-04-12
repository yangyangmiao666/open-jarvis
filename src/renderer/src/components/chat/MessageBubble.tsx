import { useCallback } from "react";
import { User, Cpu, Copy } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Message, HITLRequest } from "@/types";
import { singleMessageToMarkdown } from "@/lib/chat-markdown";
import { Button } from "@/components/ui/button";
import { ToolCallRenderer } from "./ToolCallRenderer";
import { ThinkAwareMarkdown } from "./ThinkAwareMarkdown";

interface ToolResultInfo {
  content: string | unknown;
  is_error?: boolean;
}

interface MessageBubbleProps {
  message: Message;
  isStreaming?: boolean;
  toolResults?: Map<string, ToolResultInfo>;
  pendingApproval?: HITLRequest | null;
  onApprovalDecision?: (decision: "approve" | "reject" | "edit") => void;
}

export function MessageBubble({
  message,
  isStreaming,
  toolResults,
  pendingApproval,
  onApprovalDecision,
}: MessageBubbleProps): React.JSX.Element | null {
  const isUser = message.role === "user";
  const isTool = message.role === "tool";

  const copyAsMarkdown = useCallback(async (): Promise<void> => {
    const md = singleMessageToMarkdown(message, toolResults);
    if (!md) return;
    try {
      await navigator.clipboard.writeText(md);
    } catch (e) {
      console.error("[MessageBubble] Copy failed:", e);
    }
  }, [message, toolResults]);

  // Hide tool result messages - they're shown inline with tool calls
  if (isTool) {
    return null;
  }

  const getLabel = (): string => {
    if (isUser) return "你";
    return "Jarvis";
  };

  const renderContent = (): React.ReactNode => {
    if (typeof message.content === "string") {
      // Empty content
      if (!message.content.trim()) {
        return null;
      }

      // Use streaming markdown for assistant messages, plain text for user messages
      if (isUser) {
        return (
          <div className="whitespace-pre-wrap text-sm">{message.content}</div>
        );
      }
      return (
        <ThinkAwareMarkdown isStreaming={isStreaming}>
          {message.content}
        </ThinkAwareMarkdown>
      );
    }

    // Handle content blocks
    const renderedBlocks = message.content
      .map((block, index) => {
        if (block.type === "text" && block.text) {
          // Use streaming markdown for assistant text blocks
          if (isUser) {
            return (
              <div key={index} className="whitespace-pre-wrap text-sm">
                {block.text}
              </div>
            );
          }
          return (
            <ThinkAwareMarkdown key={index} isStreaming={isStreaming}>
              {block.text}
            </ThinkAwareMarkdown>
          );
        }
        return null;
      })
      .filter(Boolean);

    return renderedBlocks.length > 0 ? renderedBlocks : null;
  };

  const content = renderContent();
  const hasToolCalls = message.tool_calls && message.tool_calls.length > 0;

  // Don't render if there's no content and no tool calls
  if (!content && !hasToolCalls) {
    return null;
  }

  return (
    <div className="group/msg flex gap-3 overflow-hidden">
      {/* Left avatar column - shows for agent/tool */}
      <div className="w-8 shrink-0">
        {!isUser && (
          <div
            className="flex size-8 items-center justify-center rounded-sm border border-cyan-500/35 bg-cyan-500/[0.08] text-cyan-600 dark:text-cyan-400"
            title="Jarvis"
          >
            <Cpu className="size-[15px]" strokeWidth={1.75} />
          </div>
        )}
      </div>

      {/* Content column - always same width */}
      <div className="flex-1 min-w-0 space-y-2 overflow-hidden">
        <div
          className={cn(
            "flex items-center gap-1",
            isUser ? "justify-end" : "justify-between",
          )}
        >
          {isUser ? (
            <>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-6 w-6 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/msg:opacity-100 hover:text-foreground"
                title="复制此条为 Markdown"
                onClick={() => void copyAsMarkdown()}
              >
                <Copy className="size-3.5" />
              </Button>
              <span className="text-section-header">{getLabel()}</span>
            </>
          ) : (
            <>
              <span className="text-section-header">{getLabel()}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-6 w-6 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/msg:opacity-100 hover:text-foreground"
                title="复制此条为 Markdown"
                onClick={() => void copyAsMarkdown()}
              >
                <Copy className="size-3.5" />
              </Button>
            </>
          )}
        </div>

        {content && (
          <div
            className={cn(
              "rounded-sm p-3 overflow-hidden",
              isUser ? "bg-primary/10" : "bg-card",
            )}
          >
            {content}
          </div>
        )}

        {/* Tool calls */}
        {hasToolCalls && (
          <div className="space-y-2 overflow-hidden">
            {message.tool_calls!.map((toolCall, index) => {
              const result = toolResults?.get(toolCall.id);
              const pendingId = pendingApproval?.tool_call?.id;
              const needsApproval = Boolean(
                pendingId && pendingId === toolCall.id,
              );
              return (
                <ToolCallRenderer
                  key={`${toolCall.id || `tc-${index}`}-${needsApproval ? "pending" : "done"}`}
                  toolCall={toolCall}
                  result={result?.content}
                  isError={result?.is_error}
                  needsApproval={needsApproval}
                  showInlineApprovalActions={!pendingApproval}
                  onApprovalDecision={
                    needsApproval ? onApprovalDecision : undefined
                  }
                />
              );
            })}
          </div>
        )}
      </div>

      {/* Right avatar column - shows for user */}
      <div className="w-8 shrink-0">
        {isUser && (
          <div
            className="flex size-8 items-center justify-center rounded-sm bg-primary/10 text-primary"
            title="你"
          >
            <User className="size-4" />
          </div>
        )}
      </div>
    </div>
  );
}
