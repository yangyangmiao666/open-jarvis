import { useRef, useEffect, useMemo, useCallback, useState } from "react";
import { Send, Square, Loader2, AlertCircle, X, Copy } from "lucide-react";
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
}

export function ChatContainer({
  threadId,
}: ChatContainerProps): React.JSX.Element {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);
  const mentionStartRef = useRef(0);
  const composingRef = useRef(false);

  const [referencedPaths, setReferencedPaths] = useState<string[]>([]);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionActiveIndex, setMentionActiveIndex] = useState(0);

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

  const handleInputChange = (
    e: React.ChangeEvent<HTMLTextAreaElement>,
  ): void => {
    const v = e.target.value;
    setInput(v);
    if (composingRef.current) return;
    const pos = e.target.selectionStart ?? v.length;
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
    } catch (e) {
      console.error("[ChatContainer] Copy failed:", e);
    }
  }, [displayMessages, toolResults]);

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
      textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
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
    <div className="flex flex-1 flex-col min-h-0 overflow-hidden">
      {/* Messages */}
      <ScrollArea className="flex-1 min-h-0" ref={scrollRef}>
        <div className="p-4">
          <div className="max-w-3xl mx-auto space-y-4">
            {displayMessages.length === 0 && !isLoading && (
              <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                <div className="text-section-header mb-2">新会话</div>
                {workspacePath ? (
                  <div className="text-sm">开始与智能体对话</div>
                ) : (
                  <div className="text-sm text-center space-y-3">
                    <div>
                      <span className="text-amber-500">请选择工作区文件夹</span>
                      <span className="block text-xs mt-1 opacity-75">
                        智能体需要工作区才能创建与修改文件
                      </span>
                    </div>
                    <button
                      type="button"
                      className="inline-flex items-center justify-center rounded-md border border-border bg-background px-2 h-7 text-xs gap-1.5 text-amber-500 hover:bg-accent/50 transition-color duration-100 disabled:opacity-50 disabled:cursor-not-allowed"
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
                toolResults={toolResults}
                pendingApproval={pendingApproval}
                onApprovalDecision={handleApprovalDecision}
              />
            ))}

            {/* Streaming indicator and inline TODOs */}
            {isLoading && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-muted-foreground text-sm">
                  <Loader2 className="size-4 animate-spin" />
                  智能体思考中…
                </div>
                {todos.length > 0 && <ChatTodos todos={todos} />}
              </div>
            )}

            {/* Error state */}
            {threadError && !isLoading && (
              <div className="flex items-start gap-3 rounded-md border border-destructive/50 bg-destructive/10 p-4">
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

      {/* Input */}
      <div className="border-t border-border p-4">
        <form onSubmit={handleSubmit} className="max-w-3xl mx-auto">
          <div className="flex flex-col gap-2">
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
                      "inline-flex items-center gap-1 rounded-md border border-border bg-muted/50 px-2 py-0.5 text-[11px] font-mono text-muted-foreground hover:bg-muted",
                    )}
                    title="点击移除"
                  >
                    {p}
                    <X className="size-3 shrink-0" />
                  </button>
                ))}
              </div>
            )}
            <div className="relative flex items-end gap-2">
              <textarea
                ref={inputRef}
                value={input}
                onChange={handleInputChange}
                onCompositionStart={() => {
                  composingRef.current = true;
                }}
                onCompositionEnd={() => {
                  composingRef.current = false;
                }}
                onKeyDown={handleKeyDown}
                placeholder="输入消息…（@ 可引用工作区文件或文件夹）"
                disabled={isLoading}
                className="flex-1 min-w-0 resize-none rounded-sm border border-border bg-background px-4 py-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
                rows={1}
                style={{ minHeight: "48px", maxHeight: "200px" }}
              />
              {mentionOpen && mentionCandidates.length > 0 && (
                <div className="absolute bottom-full left-0 right-14 mb-1 max-h-48 overflow-y-auto rounded-md border border-border bg-popover shadow-md z-50 py-1">
                  {mentionCandidates.map((f, idx) => (
                    <button
                      key={f.path}
                      type="button"
                      className={cn(
                        "w-full text-left px-2 py-1.5 text-xs font-mono truncate rounded-sm transition-colors",
                        idx === mentionActiveIndex
                          ? "bg-primary/18 text-foreground ring-1 ring-inset ring-primary/45"
                          : "hover:bg-muted dark:hover:bg-background-interactive",
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
              <div className="flex items-center justify-center shrink-0 h-12">
                {isLoading ? (
                  <Button
                    type="button"
                    variant="destructive"
                    size="icon"
                    className="rounded-md"
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
                    className="rounded-md"
                  >
                    <Send className="size-4" />
                  </Button>
                )}
              </div>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ModelSwitcher threadId={threadId} />
                <div className="w-px h-4 bg-border" />
                <WorkspacePicker threadId={threadId} />
                <div className="w-px h-4 bg-border" />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs gap-1 text-muted-foreground"
                  disabled={displayMessages.length === 0}
                  onClick={() => void copyConversationMarkdown()}
                  title="导出当前会话全部消息为 Markdown（含工具调用与结果）"
                >
                  <Copy className="size-3.5" />
                  导出会话 Markdown
                </Button>
              </div>
              {tokenUsage && (
                <ContextUsageIndicator
                  tokenUsage={tokenUsage}
                  modelId={currentModel}
                />
              )}
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
