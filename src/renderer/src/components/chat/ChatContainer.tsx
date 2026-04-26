import { useRef, useEffect, useMemo, useCallback, useState } from "react";
import {
  Send,
  Square,
  AlertCircle,
  X,
  Copy,
  ShieldAlert,
  Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAppStore } from "@/lib/store";
import { useCurrentThread, useThreadStream } from "@/lib/thread-context";
import { MessageBubble } from "./MessageBubble";
import { ModelSwitcher } from "./ModelSwitcher";
import { Folder } from "lucide-react";
import { WorkspacePicker } from "./WorkspacePicker";
import { selectWorkspaceFolder } from "@/lib/workspace-utils";
import { ChatTodos } from "./ChatTodos";
import { ContextUsageIndicator } from "./ContextUsageIndicator";
import type { Message } from "@/types";
import { cn } from "@/lib/utils";
import { messagesToMarkdown } from "@/lib/chat-markdown";

interface AgentStreamValues {
  todos?: Array<{ id?: string; content?: string; status?: string }>;
}

interface StreamMessage {
  id?: string;
  type?: string;
  content?: string | unknown[];
  tool_calls?: Message["tool_calls"];
  tool_call_id?: string;
  name?: string;
}

interface ChatContainerProps {
  threadId: string;
  onOpenSettings: () => void;
}

export function ChatContainer({
  threadId,
  onOpenSettings,
}: ChatContainerProps): React.JSX.Element {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const mentionListRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);
  const mentionStartRef = useRef(0);
  const composingRef = useRef(false);

  const [referencedPaths, setReferencedPaths] = useState<string[]>([]);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionActiveIndex, setMentionActiveIndex] = useState(0);
  const [copyNoticeOpen, setCopyNoticeOpen] = useState(false);

  const { threads, loadThreads, generateTitleForFirstMessage } = useAppStore();

  // Get persisted thread state and actions from context
  const {
    messages: threadMessages,
    pendingApproval,
    todos,
    error: threadError,
    workspacePath,
    tokenUsage,
    currentModel,
    draftInput: input,
    workspaceFiles,
    setTodos,
    setWorkspaceFiles,
    setWorkspacePath,
    setPendingApproval,
    appendMessage,
    setError,
    clearError,
    setDraftInput: setInput,
  } = useCurrentThread(threadId);

  // Get the stream data via subscription - reactive updates without re-rendering provider
  const streamData = useThreadStream(threadId);
  const stream = streamData.stream;
  const isLoading = streamData.isLoading;

  const mentionCandidates = useMemo(() => {
    const q = mentionQuery.toLowerCase();
    return workspaceFiles
      .filter((f) => f.path.toLowerCase().includes(q))
      .slice(0, 40);
  }, [workspaceFiles, mentionQuery]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMentionActiveIndex(0);
  }, [mentionQuery, mentionOpen, mentionCandidates.length]);

  useEffect(() => {
    if (!mentionOpen) return;
    const list = mentionListRef.current;
    const activeItem = list?.querySelector<HTMLButtonElement>(
      `[data-mention-index="${mentionActiveIndex}"]`,
    );
    activeItem?.scrollIntoView({ block: "nearest" });
  }, [mentionActiveIndex, mentionOpen]);

  const parseMentionAtCursor = (v: string, pos: number): void => {
    let i = pos - 1;
    while (i >= 0 && v[i] !== "@" && v[i] !== "\n") {
      i--;
    }
    if (i < 0 || v[i] !== "@") {
      setMentionOpen(false);
      return;
    }
    if (i > 0 && v[i - 1] !== " " && v[i - 1] !== "\n") {
      setMentionOpen(false);
      return;
    }
    const afterAt = v.slice(i + 1, pos);
    if (afterAt.includes(" ") || afterAt.includes("\n")) {
      setMentionOpen(false);
      return;
    }
    mentionStartRef.current = i;
    setMentionQuery(afterAt);
    setMentionOpen(true);
  };

  const handleInputChange = (
    e: React.ChangeEvent<HTMLTextAreaElement>,
  ): void => {
    const v = e.target.value;
    setInput(v);
    if (composingRef.current) return;
    const pos = e.target.selectionStart ?? v.length;
    parseMentionAtCursor(v, pos);
  };

  const pickMention = (path: string): void => {
    const ta = inputRef.current;
    if (!ta) return;
    const v = ta.value;
    const pos = ta.selectionStart ?? v.length;
    const start = mentionStartRef.current;
    const before = v.slice(0, start);
    const after = v.slice(pos);
    setInput(before + after);
    setReferencedPaths((prev) => [...new Set([...prev, path])]);
    setMentionOpen(false);
    requestAnimationFrame(() => {
      ta.focus();
      const newPos = before.length;
      ta.setSelectionRange(newPos, newPos);
    });
  };

  const handleApprovalDecision = useCallback(
    async (decision: "approve" | "reject" | "edit"): Promise<void> => {
      if (!pendingApproval || !stream) return;

      setPendingApproval(null);

      try {
        await stream.submit(null, {
          command: { resume: { decision } },
          config: {
            configurable: { thread_id: threadId, model_id: currentModel },
          },
        });
      } catch (err) {
        console.error("[ChatContainer] Resume command failed:", err);
      }
    },
    [pendingApproval, setPendingApproval, stream, threadId, currentModel],
  );

  const agentValues = stream?.values as AgentStreamValues | undefined;
  const streamTodos = agentValues?.todos;
  useEffect(() => {
    if (Array.isArray(streamTodos)) {
      setTodos(
        streamTodos.map((t) => ({
          id: t.id || crypto.randomUUID(),
          content: t.content || "",
          status: (t.status || "pending") as
            | "pending"
            | "in_progress"
            | "completed"
            | "cancelled",
        })),
      );
    }
  }, [streamTodos, setTodos]);

  const prevLoadingRef = useRef(false);
  useEffect(() => {
    if (prevLoadingRef.current && !isLoading) {
      for (const rawMsg of streamData.messages) {
        const msg = rawMsg as StreamMessage;
        if (msg.id) {
          const streamMsg = msg as StreamMessage & { id: string };

          let role: Message["role"] = "assistant";
          if (streamMsg.type === "human") role = "user";
          else if (streamMsg.type === "tool") role = "tool";
          else if (streamMsg.type === "ai") role = "assistant";

          const storeMsg: Message = {
            id: streamMsg.id,
            role,
            content:
              typeof streamMsg.content === "string" ? streamMsg.content : "",
            tool_calls: streamMsg.tool_calls,
            ...(role === "tool" &&
              streamMsg.tool_call_id && {
                tool_call_id: streamMsg.tool_call_id,
              }),
            ...(role === "tool" && streamMsg.name && { name: streamMsg.name }),
            created_at: new Date(),
          };
          appendMessage(storeMsg);
        }
      }
      loadThreads();
    }
    prevLoadingRef.current = isLoading;
  }, [isLoading, streamData.messages, loadThreads, appendMessage]);

  const displayMessages = useMemo(() => {
    const threadMessageIds = new Set(threadMessages.map((m) => m.id));

    const streamingMsgs: Message[] = (
      (streamData.messages || []) as StreamMessage[]
    )
      .filter(
        (m): m is StreamMessage & { id: string } =>
          !!m.id && !threadMessageIds.has(m.id),
      )
      .map((streamMsg) => {
        let role: Message["role"] = "assistant";
        if (streamMsg.type === "human") role = "user";
        else if (streamMsg.type === "tool") role = "tool";
        else if (streamMsg.type === "ai") role = "assistant";

        return {
          id: streamMsg.id,
          role,
          content:
            typeof streamMsg.content === "string" ? streamMsg.content : "",
          tool_calls: streamMsg.tool_calls,
          ...(role === "tool" &&
            streamMsg.tool_call_id && { tool_call_id: streamMsg.tool_call_id }),
          ...(role === "tool" && streamMsg.name && { name: streamMsg.name }),
          created_at: new Date(),
        };
      });

    return [...threadMessages, ...streamingMsgs];
  }, [threadMessages, streamData.messages]);

  const streamingAssistantIds = useMemo(() => {
    if (!isLoading) return new Set<string>();

    const persistedIds = new Set(threadMessages.map((message) => message.id));
    const ids = ((streamData.messages || []) as StreamMessage[]).flatMap(
      (message) => {
        if (message.type !== "ai" || typeof message.id !== "string") {
          return [];
        }
        return persistedIds.has(message.id) ? [] : [message.id];
      },
    );
    return new Set(ids);
  }, [isLoading, threadMessages, streamData.messages]);

  // Build tool results map from tool messages
  const toolResults = useMemo(() => {
    const results = new Map<
      string,
      { content: string | unknown; is_error?: boolean }
    >();
    for (const msg of displayMessages) {
      if (msg.role === "tool" && msg.tool_call_id) {
        results.set(msg.tool_call_id, {
          content: msg.content,
          is_error: false, // Could be enhanced to track errors
        });
      }
    }
    return results;
  }, [displayMessages]);

  const copyConversationMarkdown = useCallback(async (): Promise<void> => {
    const md = messagesToMarkdown(displayMessages, toolResults);
    if (!md) return;
    try {
      await navigator.clipboard.writeText(md);
      setCopyNoticeOpen(true);
    } catch (e) {
      console.error("[ChatContainer] Copy failed:", e);
    }
  }, [displayMessages, toolResults]);

  useEffect(() => {
    if (!copyNoticeOpen) return;
    const timer = window.setTimeout(() => {
      setCopyNoticeOpen(false);
    }, 1800);
    return () => window.clearTimeout(timer);
  }, [copyNoticeOpen]);

  // Get the actual scrollable viewport element from Radix ScrollArea
  const getViewport = useCallback((): HTMLDivElement | null => {
    return scrollRef.current?.querySelector(
      "[data-radix-scroll-area-viewport]",
    ) as HTMLDivElement | null;
  }, []);

  // Track scroll position to determine if user is at bottom
  const handleScroll = useCallback((): void => {
    const viewport = getViewport();
    if (!viewport) return;

    const { scrollTop, scrollHeight, clientHeight } = viewport;
    // Consider "at bottom" if within 50px of the bottom
    const threshold = 50;
    isAtBottomRef.current = scrollHeight - scrollTop - clientHeight < threshold;
  }, [getViewport]);

  // Attach scroll listener to viewport
  useEffect(() => {
    const viewport = getViewport();
    if (!viewport) return;

    viewport.addEventListener("scroll", handleScroll);
    return () => viewport.removeEventListener("scroll", handleScroll);
  }, [getViewport, handleScroll]);

  // Auto-scroll on new messages only if already at bottom
  useEffect(() => {
    const viewport = getViewport();
    if (viewport && isAtBottomRef.current) {
      viewport.scrollTop = viewport.scrollHeight;
    }
  }, [displayMessages, isLoading, getViewport]);

  // Always scroll to bottom when switching threads
  useEffect(() => {
    const viewport = getViewport();
    if (viewport) {
      viewport.scrollTop = viewport.scrollHeight;
      isAtBottomRef.current = true;
    }
  }, [threadId, getViewport]);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, [threadId]);

  const handleDismissError = (): void => {
    clearError();
  };

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!input.trim() || isLoading || !stream) return;

    if (!workspacePath) {
      setError("发送消息前请先选择工作区文件夹。");
      return;
    }

    if (threadError) {
      clearError();
    }

    if (pendingApproval) {
      setPendingApproval(null);
    }

    const message = input.trim();
    setInput("");

    const isFirstMessage = threadMessages.length === 0;

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: message,
      created_at: new Date(),
    };
    appendMessage(userMessage);

    if (isFirstMessage) {
      const currentThread = threads.find((t) => t.thread_id === threadId);
      const hasDefaultTitle =
        Boolean(currentThread?.title?.startsWith("Thread ")) ||
        Boolean(currentThread?.title?.startsWith("新会话 "));
      if (hasDefaultTitle) {
        generateTitleForFirstMessage(threadId, message);
      }
    }

    await stream.submit(
      {
        messages: [{ type: "human", content: message }],
      },
      {
        config: {
          configurable: {
            thread_id: threadId,
            model_id: currentModel,
            ...(referencedPaths.length > 0
              ? { referenced_paths: referencedPaths }
              : {}),
          },
        },
      },
    );
    setReferencedPaths([]);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (mentionOpen && mentionCandidates.length > 0) {
      if (e.key === "Escape") {
        e.preventDefault();
        setMentionOpen(false);
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionActiveIndex((i) => (i + 1) % mentionCandidates.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionActiveIndex(
          (i) => (i - 1 + mentionCandidates.length) % mentionCandidates.length,
        );
        return;
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        const f = mentionCandidates[mentionActiveIndex];
        if (f) pickMention(f.path);
        return;
      }
    } else if (mentionOpen && e.key === "Escape") {
      e.preventDefault();
      setMentionOpen(false);
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSubmit(e);
    }
  };

  // Auto-resize textarea based on content
  const adjustTextareaHeight = (): void => {
    const textarea = inputRef.current;
    if (textarea) {
      textarea.style.height = "auto";
      const nextHeight = Math.min(textarea.scrollHeight, 200);
      textarea.style.height = `${nextHeight}px`;
      textarea.style.overflowY =
        textarea.scrollHeight > 200 ? "auto" : "hidden";
    }
  };

  useEffect(() => {
    adjustTextareaHeight();
  }, [input]);

  const handleCancel = async (): Promise<void> => {
    await stream?.stop();
  };

  const handleSelectWorkspaceFromEmptyState = async (): Promise<void> => {
    await selectWorkspaceFolder(
      threadId,
      setWorkspacePath,
      setWorkspaceFiles,
      () => {},
      undefined,
    );
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background/20">
      {/* Messages */}
      <ScrollArea className="flex-1 min-h-0" ref={scrollRef}>
        <div className="px-4 py-5">
          <div className="mx-auto max-w-3xl space-y-4">
            {displayMessages.length === 0 && !isLoading && (
              <div className="app-flat-surface animate-scale-in mx-auto flex max-w-xl flex-col items-center justify-center gap-4 rounded-[28px] px-8 py-14 text-center text-muted-foreground">
                <div className="text-section-header">新会话</div>
                {workspacePath ? (
                  <>
                    <div className="text-xl font-semibold tracking-[-0.03em] text-foreground">
                      开始与 Jarvis 协作
                    </div>
                    <div className="text-sm leading-6 text-muted-foreground">
                      当前会话已经绑定工作区，可以直接提问、要求修改文件，或让智能体执行操作。
                    </div>
                  </>
                ) : (
                  <div className="space-y-4 text-center text-sm">
                    <div className="space-y-1">
                      <span className="text-base font-medium text-amber-600 dark:text-amber-300">
                        请选择工作区文件夹
                      </span>
                      <span className="mt-1 block text-xs opacity-80">
                        智能体需要工作区才能创建与修改文件
                      </span>
                    </div>
                    <button
                      type="button"
                      className="app-elevated-hover inline-flex h-9 items-center justify-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-4 text-xs font-medium text-amber-700 dark:text-amber-200 disabled:cursor-not-allowed disabled:opacity-50"
                      onClick={handleSelectWorkspaceFromEmptyState}
                    >
                      <Folder className="size-3.5" />
                      <span className="max-w-[120px] truncate">选择工作区</span>
                    </button>
                  </div>
                )}
              </div>
            )}

            {displayMessages.map((message) => (
              <MessageBubble
                key={message.id}
                message={message}
                isStreaming={streamingAssistantIds.has(message.id)}
                toolResults={toolResults}
                pendingApproval={pendingApproval}
                onApprovalDecision={handleApprovalDecision}
              />
            ))}

            {todos.length > 0 && isLoading && (
              <div className="pl-1">
                <ChatTodos todos={todos} />
              </div>
            )}

            {/* Error state */}
            {threadError && !isLoading && (
              <div className="animate-enter flex items-start gap-3 rounded-2xl border border-destructive/35 bg-destructive/10 px-4 py-4">
                <AlertCircle className="size-5 text-destructive shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-destructive text-sm">
                    智能体错误
                  </div>
                  <div className="text-sm text-muted-foreground mt-1 break-words">
                    {threadError}
                  </div>
                  <div className="text-xs text-muted-foreground mt-2">
                    可尝试发送新消息以继续对话。
                  </div>
                </div>
                <button
                  onClick={handleDismissError}
                  className="shrink-0 rounded p-1 hover:bg-destructive/20 transition-colors"
                  aria-label="关闭错误"
                >
                  <X className="size-4 text-muted-foreground" />
                </button>
              </div>
            )}
          </div>
        </div>
      </ScrollArea>

      {/* HITL：流结束后 isLoading 为 false，但子图可能仍在等待审批；避免「无按钮可点」 */}
      {pendingApproval && (
        <div className="shrink-0 border-t border-amber-500/25 bg-amber-500/[0.06] px-4 py-4 backdrop-blur-sm">
          <div className="app-flat-surface mx-auto flex max-w-3xl flex-col gap-3 rounded-[24px] border-amber-500/20 bg-amber-500/[0.08] px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-2 min-w-0 text-sm">
              <ShieldAlert className="size-4 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
              <div className="min-w-0">
                <div className="font-medium text-amber-800 dark:text-amber-200">
                  等待你确认：{pendingApproval.tool_call.name}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5 break-all">
                  主进程或子智能体已暂停；批准或拒绝后才会继续并汇总结果。
                </div>
              </div>
            </div>
            <div className="flex shrink-0 gap-2 justify-end">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void handleApprovalDecision("reject")}
              >
                拒绝
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => void handleApprovalDecision("approve")}
              >
                批准
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Input */}
      <div className="border-t border-border/60 px-4 py-4">
        <form onSubmit={handleSubmit} className="mx-auto max-w-3xl">
          <div className="relative app-flat-surface flex flex-col gap-3 overflow-visible rounded-[26px] px-4 py-4">
            {copyNoticeOpen && (
              <div className="animate-enter absolute -top-14 right-4 z-20 inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/12 px-3 py-1.5 text-xs font-medium text-emerald-700 shadow-[0_12px_32px_color-mix(in_srgb,#10b981_15%,transparent)] backdrop-blur-sm dark:text-emerald-300">
                <Check className="size-3.5" />
                已复制到剪贴板
              </div>
            )}
            {referencedPaths.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {referencedPaths.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() =>
                      setReferencedPaths((prev) => prev.filter((x) => x !== p))
                    }
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full border border-border/70 bg-muted/55 px-2.5 py-1 text-[11px] font-mono text-muted-foreground hover:bg-muted",
                    )}
                    title="点击移除"
                  >
                    {p}
                    <X className="size-3 shrink-0" />
                  </button>
                ))}
              </div>
            )}
            <div className="relative flex items-end gap-3">
              <textarea
                ref={inputRef}
                value={input}
                onChange={handleInputChange}
                onCompositionStart={() => {
                  composingRef.current = true;
                }}
                onCompositionEnd={() => {
                  composingRef.current = false;
                  const ta = inputRef.current;
                  if (ta) parseMentionAtCursor(ta.value, ta.selectionStart ?? ta.value.length);
                }}
                onKeyDown={handleKeyDown}
                placeholder="输入消息… Enter 发送，Shift+Enter 换行，@ 引用文件"
                disabled={isLoading}
                className="chat-input-scrollbar min-w-0 flex-1 resize-none rounded-[22px] border border-border/75 bg-background/75 px-4 py-3.5 pr-3 text-sm leading-6 placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/70 disabled:opacity-50"
                rows={1}
                style={{
                  minHeight: "48px",
                  maxHeight: "200px",
                  overflowY: "auto",
                }}
              />
              {mentionOpen && mentionCandidates.length > 0 && (
                <div
                  ref={mentionListRef}
                  className="absolute bottom-full left-0 right-14 z-50 mb-3 max-h-56 overflow-y-auto rounded-2xl border border-border bg-popover py-2 shadow-[0_18px_48px_color-mix(in_srgb,#020617_22%,transparent)]"
                >
                  {mentionCandidates.map((f, idx) => (
                    <button
                      key={f.path}
                      data-mention-index={idx}
                      type="button"
                      className={cn(
                        "mx-1 block w-[calc(100%-0.5rem)] truncate rounded-xl px-3 py-2 text-left text-xs font-mono transition-colors",
                        idx === mentionActiveIndex
                          ? "bg-primary/18 text-foreground ring-1 ring-inset ring-primary/45"
                          : "hover:bg-muted",
                      )}
                      onMouseEnter={() => setMentionActiveIndex(idx)}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        pickMention(f.path);
                      }}
                    >
                      {f.is_dir ? "📁 " : ""}
                      {f.path}
                    </button>
                  ))}
                </div>
              )}
              <div className="flex h-12 shrink-0 items-center justify-center">
                {isLoading ? (
                  <Button
                    type="button"
                    variant="destructive"
                    size="icon"
                    className="rounded-full"
                    onClick={handleCancel}
                    title="停止生成"
                  >
                    <Square className="size-4" />
                  </Button>
                ) : (
                  <Button
                    type="submit"
                    variant="default"
                    size="icon"
                    disabled={!input.trim()}
                    className="rounded-full"
                  >
                    <Send className="size-4" />
                  </Button>
                )}
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <ModelSwitcher
                  threadId={threadId}
                  onOpenSettings={onOpenSettings}
                />
                <div className="w-px h-4 bg-border" />
                <WorkspacePicker threadId={threadId} />
                <div className="w-px h-4 bg-border" />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 gap-1 rounded-full px-3 text-xs text-muted-foreground"
                  disabled={displayMessages.length === 0}
                  onClick={() => void copyConversationMarkdown()}
                  title="复制当前会话全部消息为 Markdown（含工具调用与结果）"
                >
                  <Copy className="size-3.5" />
                  复制会话到Markdown
                </Button>
              </div>
              <ContextUsageIndicator
                tokenUsage={tokenUsage}
                modelId={currentModel}
                className="rounded-full border border-border/70 bg-card/70 px-3 py-1 backdrop-blur-sm"
              />
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-end gap-2 px-1">
            <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {pendingApproval && (
                <span className="inline-flex items-center gap-2 rounded-full border border-amber-500/35 bg-amber-500/10 px-3 py-1 text-amber-700 dark:text-amber-300">
                  <ShieldAlert className="size-3.5" />
                  等待审批
                </span>
              )}
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
