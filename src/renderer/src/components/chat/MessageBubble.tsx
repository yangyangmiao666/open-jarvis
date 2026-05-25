import { useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { User, Copy, RotateCcw, Trash2, PencilLine, Send, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Message, HITLRequest } from "@/types";
import { singleMessageToMarkdown } from "@/lib/chat-markdown";
import { Button } from "@/components/ui/button";
import { toast } from "@/lib/toast";
import { JarvisMark } from "@/components/branding/JarvisMark";
import { ToolCallRenderer } from "./ToolCallRenderer";
import { ThinkAwareMarkdown } from "./ThinkAwareMarkdown";
import { InlineImagePreview } from "./InlineImagePreview";

interface ToolResultInfo {
  content: string | unknown;
  is_error?: boolean;
}

const RICH_PREVIEW_FENCE_PATTERN = /```(?:html|htm|echarts|echart|chart|mermaid)\b|<(?:echarts|echart|chart|mermaid|html-preview|html_preview|html-render|html_render)\b|<!doctype\s+html\b|<html[\s>]/i;

function hasRichPreviewContent(content: Message["content"]): boolean {
  if (typeof content === "string") {
    return RICH_PREVIEW_FENCE_PATTERN.test(content);
  }

  return content.some(
    (block) =>
      typeof block.text === "string" && RICH_PREVIEW_FENCE_PATTERN.test(block.text),
  );
}

interface MessageBubbleProps {
  message: Message;
  threadId: string;
  onOpenFile?: (path: string, name: string) => void;
  isStreaming?: boolean;
  canResend?: boolean;
  canEdit?: boolean;
  canDelete?: boolean;
  isEditing?: boolean;
  editDraft?: string;
  isSubmittingEdit?: boolean;
  toolResults?: Map<string, ToolResultInfo>;
  pendingApprovals?: HITLRequest[];
  pendingApproval?: HITLRequest | null;
  onResend?: (message: Message) => void | Promise<void>;
  onEdit?: (message: Message) => void | Promise<void>;
  onEditDraftChange?: (message: Message, value: string) => void;
  onEditCancel?: (message: Message) => void;
  onEditSubmit?: (message: Message) => void | Promise<void>;
  onDelete?: (message: Message) => void | Promise<void>;
  onApprovalDecision?: (
    decision: "approve" | "reject" | "edit",
    options?: { rememberForWorkspace?: boolean },
  ) => void;
}

export function MessageBubble({
  message,
  threadId,
  onOpenFile,
  isStreaming,
  canResend,
  canEdit,
  canDelete,
  isEditing,
  editDraft,
  isSubmittingEdit,
  toolResults,
  pendingApprovals,
  pendingApproval,
  onResend,
  onEdit,
  onEditDraftChange,
  onEditCancel,
  onEditSubmit,
  onDelete,
  onApprovalDecision,
}: MessageBubbleProps): React.JSX.Element | null {
  const { t } = useTranslation('chat');
  const isUser = message.role === "user";
  const isTool = message.role === "tool";
  const editTextareaRef = useRef<HTMLTextAreaElement>(null);

  const copyAsMarkdown = useCallback(async (): Promise<void> => {
    const md = singleMessageToMarkdown(message, toolResults);
    if (!md) return;
    try {
      await navigator.clipboard.writeText(md);
      toast.success(t('common:toast.copiedToClipboard'));
    } catch {
      toast.error(t('common:toast.copyFailed'));
    }
  }, [message, t, toolResults]);

  useEffect(() => {
    if (!isEditing) {
      return;
    }

    const textarea = editTextareaRef.current;
    if (!textarea) {
      return;
    }

    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 220)}px`;
    textarea.style.overflowY = textarea.scrollHeight > 220 ? "auto" : "hidden";
  }, [isEditing]);

  // Hide tool result messages - they're shown inline with tool calls
  if (isTool) {
    return null;
  }

  const getLabel = (): string => {
    if (isUser) return t('you');
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
        <ThinkAwareMarkdown isStreaming={isStreaming} threadId={threadId} onOpenFile={onOpenFile}>
          {message.content}
        </ThinkAwareMarkdown>
      );
    }

    // Handle content blocks
    const renderedBlocks = message.content
      .map((block, index) => {
        if (block.type === "text" && block.text) {
          if (isUser) {
            return (
              <div key={index} className="whitespace-pre-wrap text-sm">
                {block.text}
              </div>
            );
          }
          return (
            <ThinkAwareMarkdown
              key={index}
              isStreaming={isStreaming}
              threadId={threadId}
              onOpenFile={onOpenFile}
            >
              {block.text}
            </ThinkAwareMarkdown>
          );
        }
        if (block.type === "image" && block.content) {
          const fileName = block.name || "image";
          const mimeType = block.mimeType || "image/png";
          return (
            <InlineImagePreview
              key={index}
              threadId={threadId}
              filePath={fileName}
              mimeType={mimeType}
              onClick={() => onOpenFile?.(fileName, fileName)}
            />
          );
        }
        return null;
      })
      .filter(Boolean);

    return renderedBlocks.length > 0 ? renderedBlocks : null;
  };

  const content = renderContent();
  const hasToolCalls = message.tool_calls && message.tool_calls.length > 0;
  const hasRichPreview = !isUser && hasRichPreviewContent(message.content);
  const pendingApprovalIds = new Set(
    (pendingApprovals && pendingApprovals.length > 0
      ? pendingApprovals
      : pendingApproval
        ? [pendingApproval]
        : [])
      .map((request) => request.tool_call.id)
      .filter(Boolean),
  );

  // Don't render if there's no content and no tool calls
  if (!content && !hasToolCalls) {
    return null;
  }

  const renderEditableComposer = (): React.ReactNode => {
    if (!isUser || !isEditing) {
      return null;
    }

    return (
      <div className="ml-auto w-full max-w-full rounded-2xl border border-status-info/25 bg-slate-100 p-3 dark:bg-slate-800">
        <textarea
          ref={editTextareaRef}
          value={editDraft ?? ""}
          rows={3}
          className="min-h-22 w-full resize-none rounded-2xl border border-border/70 bg-background px-3.5 py-3 text-sm text-foreground outline-none transition focus:border-status-info/45 focus:ring-2 focus:ring-status-info/20"
          placeholder={t('editPlaceholder')}
          onChange={(event) => {
            const textarea = event.currentTarget;
            textarea.style.height = "auto";
            textarea.style.height = `${Math.min(textarea.scrollHeight, 220)}px`;
            textarea.style.overflowY = textarea.scrollHeight > 220 ? "auto" : "hidden";
            onEditDraftChange?.(message, textarea.value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              onEditCancel?.(message);
              return;
            }

            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              void onEditSubmit?.(message);
            }
          }}
        />
        <div className="mt-3 flex items-center justify-between gap-3">
          <span className="text-xs text-muted-foreground">
            {t('editHint')}
          </span>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="rounded-full"
              onClick={() => onEditCancel?.(message)}
              disabled={isSubmittingEdit}
            >
              <X className="size-3.5" />
              {t('common:cancel')}
            </Button>
            <Button
              type="button"
              variant="default"
              size="sm"
              className="rounded-full"
              disabled={!editDraft?.trim() || isSubmittingEdit}
              onClick={() => void onEditSubmit?.(message)}
            >
              <Send className="size-3.5" />
              {t('common:send')}
            </Button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div
      className={cn(
        "group/msg animate-enter flex overflow-visible",
        isUser ? "justify-end" : "justify-start",
        message._queued && "opacity-60",
      )}
    >
      <div
        className={cn(
          "flex w-full max-w-[90%] gap-3",
          isUser
            ? "ml-auto mr-4 flex-row-reverse sm:mr-8"
            : "ml-4 mr-auto flex-row sm:ml-8",
        )}
      >
        <div className="w-10 shrink-0 pt-0.5">
          {isUser ? (
            <div
              className="icon-blue flex size-9 items-center justify-center rounded-2xl border border-status-info/20"
              title={t('you')}
            >
              <User className="size-4" />
            </div>
          ) : (
            <div
              className="icon-purple flex size-9 items-center justify-center rounded-2xl border border-status-accent/20"
              title="Jarvis"
            >
              <JarvisMark className="size-4" />
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
                <div className="flex w-0 items-center justify-end gap-1 overflow-hidden opacity-0 transition-all duration-200 group-hover/msg:w-31 group-hover/msg:opacity-100">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0 rounded-full text-muted-foreground hover:translate-y-0 hover:text-foreground"
                    title={t('editAndResend')}
                    disabled={!canEdit}
                    onClick={() => void onEdit?.(message)}
                  >
                    <PencilLine className="size-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0 rounded-full text-muted-foreground hover:translate-y-0 hover:text-destructive"
                    title={t('deleteMessage')}
                    disabled={!canDelete}
                    onClick={() => void onDelete?.(message)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0 rounded-full text-muted-foreground hover:translate-y-0 hover:text-foreground"
                    title={t('resendMessage')}
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
                    title={t('copyAsMarkdown')}
                    onClick={() => void copyAsMarkdown()}
                  >
                    <Copy className="size-3.5" />
                  </Button>
                </div>
                <span className="text-section-header">{getLabel()}</span>
                {message._queued && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-muted-foreground/20 bg-muted-foreground/10 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                    {t('queued')}
                  </span>
                )}
              </>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <span className="text-section-header">{getLabel()}</span>
                  {isStreaming && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.14em] text-primary">
                      <span className="animate-tactical-pulse size-1.5 rounded-full bg-primary" />
                      {t('streaming.live')}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1 opacity-0 transition-all group-hover/msg:opacity-100">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0 rounded-full text-muted-foreground hover:translate-y-0 hover:text-destructive"
                    title={t('deleteMessage')}
                    disabled={!canDelete}
                    onClick={() => void onDelete?.(message)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0 rounded-full text-muted-foreground hover:translate-y-0 hover:text-foreground"
                    title={t('copyAsMarkdown')}
                    onClick={() => void copyAsMarkdown()}
                  >
                    <Copy className="size-3.5" />
                  </Button>
                </div>
              </>
            )}
          </div>

          {isEditing && isUser ? (
            renderEditableComposer()
          ) : content && (
            <div className="space-y-2">
              <div
                className={cn(
                  isUser
                    ? "ml-auto w-fit max-w-full rounded-2xl border-l-2 border-l-status-info/25 border border-border/60 bg-slate-100 px-4 py-3.5 text-foreground dark:border-border/70 dark:bg-slate-800"
                    : hasRichPreview
                      ? "w-full max-w-full"
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
              {message.tool_calls?.map((toolCall, index) => {
                const result = toolResults?.get(toolCall.id);
                const needsApproval = pendingApprovalIds.has(toolCall.id);
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
                    threadId={threadId}
                    onOpenFile={onOpenFile}
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
