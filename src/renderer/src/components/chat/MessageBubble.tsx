import { useCallback } from "react";
import { User, Copy, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Message, HITLRequest } from "@/types";
import { singleMessageToMarkdown } from "@/lib/chat-markdown";
import { Button } from "@/components/ui/button";
import { JarvisMark } from "@/components/branding/JarvisMark";
import { ToolCallRenderer } from "./ToolCallRenderer";
import { ThinkAwareMarkdown } from "./ThinkAwareMarkdown";

interface ToolResultInfo {
  content: string | unknown;
  is_error?: boolean;
}

interface MessageBubbleProps {
  message: Message;
  isStreaming?: boolean;
  canResend?: boolean;
  toolResults?: Map<string, ToolResultInfo>;
  pendingApproval?: HITLRequest | null;
  onResend?: (message: Message) => void | Promise<void>;
  onApprovalDecision?: (
    decision: "approve" | "reject" | "edit",
    options?: { rememberForWorkspace?: boolean },
  ) => void;
}

export function MessageBubble({
  message,
  isStreaming,
  canResend,
  toolResults,
  pendingApproval,
  onResend,
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
    <div
      className={cn(
        "group/msg animate-enter flex overflow-visible",
        isUser ? "justify-end" : "justify-start",
      )}
    >
      <div
        className={cn(
          "flex w-full max-w-[86%] gap-3",
          isUser
            ? "ml-auto mr-4 flex-row-reverse sm:mr-8"
            : "ml-4 mr-auto flex-row sm:ml-8",
        )}
      >
        <div className="w-10 shrink-0 pt-0.5">
          {isUser ? (
            <div
              className="flex size-9 items-center justify-center rounded-2xl border border-border bg-background-elevated text-foreground"
              title="你"
            >
              <User className="size-4" />
            </div>
          ) : (
            <div
              className="flex size-9 items-center justify-center rounded-2xl border border-border bg-background-elevated text-foreground"
              title="Jarvis"
            >
              <JarvisMark className="size-[16px]" />
            </div>
          )}
        </div>

        <div className="flex-1 min-w-0 space-y-2 overflow-visible">
          <div
            className={cn(
              "flex items-center gap-2",
              isUser ? "justify-end" : "justify-between",
            )}
          >
            {isUser ? (
              <>
                <div className="flex w-0 items-center justify-end gap-1 overflow-hidden opacity-0 transition-all duration-200 group-hover/msg:w-[3.75rem] group-hover/msg:opacity-100">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0 rounded-full text-muted-foreground hover:translate-y-0 hover:text-foreground"
                    title="重发此条消息"
                    disabled={!canResend}
                    onClick={() => void onResend?.(message)}
                  >
                    <RotateCcw className="size-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0 rounded-full text-muted-foreground hover:translate-y-0 hover:text-foreground"
                    title="复制此条为 Markdown"
                    onClick={() => void copyAsMarkdown()}
                  >
                    <Copy className="size-3.5" />
                  </Button>
                </div>
                <span className="text-section-header">{getLabel()}</span>
              </>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <span className="text-section-header">{getLabel()}</span>
                  {isStreaming && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.14em] text-primary">
                      <span className="animate-tactical-pulse size-1.5 rounded-full bg-primary" />
                      Live
                    </span>
                  )}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0 rounded-full text-muted-foreground opacity-0 transition-all group-hover/msg:opacity-100 hover:translate-y-0 hover:text-foreground"
                  title="复制此条为 Markdown"
                  onClick={() => void copyAsMarkdown()}
                >
                  <Copy className="size-3.5" />
                </Button>
              </>
            )}
          </div>

          {content && (
            <div className="space-y-2">
              <div
                className={cn(
                  isUser
                    ? "ml-auto w-fit max-w-full rounded-2xl bg-foreground px-4 py-3.5 text-background"
                    : "w-fit max-w-full",
                )}
              >
                {content}
              </div>
              {!isUser && isStreaming && (
                <div className="inline-flex items-center gap-1.5 pl-1 text-muted-foreground">
                  <span className="message-loading-dot" />
                  <span className="message-loading-dot [animation-delay:120ms]" />
                  <span className="message-loading-dot [animation-delay:240ms]" />
                </div>
              )}
            </div>
          )}

          {/* Tool calls */}
          {hasToolCalls && (
            <div className="space-y-3 overflow-visible px-1 py-1">
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
      </div>
    </div>
  );
}
