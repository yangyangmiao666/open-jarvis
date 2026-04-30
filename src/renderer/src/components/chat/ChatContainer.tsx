import { useRef, useEffect, useMemo, useCallback, useState } from "react";
import {
  Send,
  Square,
  AlertCircle,
  X,
  Copy,
  ShieldAlert,
  Check,
  Shield,
  ShieldCheck,
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
import type { ApprovalMode, Message } from "@/types";
import { cn, truncate } from "@/lib/utils";
import { messagesToMarkdown } from "@/lib/chat-markdown";

const STREAMING_BASE_TIPS = [
  "正在交叉阅读上下文、消息、工具结果和线程状态，尽量减少无效来回。",
  "会先压缩出最有价值的下一步，再决定是继续搜索、修改还是验证。",
  "如果发现问题已经收敛到局部切片，会优先做小改动并立即验证。",
  "处理过程中会持续整理线索、风险和已完成动作，而不是只输出中间碎片。",
  "如果本轮涉及工具链、文件改动和上下文窗口，会同步约束它们之间的影响范围。",
  "当前展示的是处理中状态提示，真实结果仍会按消息和工具调用继续流式输出。",
];

function buildStreamingTips(params: {
  todos: Array<{ content: string; status: string }>;
  workspacePath?: string | null;
  referencedPaths: string[];
  currentModelLabel?: string | null;
  workspaceFileCount: number;
  approvalMode: ApprovalMode;
  messageCount: number;
  recentToolNames: string[];
  pendingApprovalName?: string | null;
}): string[] {
  const {
    todos,
    workspacePath,
    referencedPaths,
    currentModelLabel,
    workspaceFileCount,
    approvalMode,
    messageCount,
    recentToolNames,
    pendingApprovalName,
  } = params;
  const activeTodo = todos.find((todo) => todo.status === "in_progress");
  const completedCount = todos.filter(
    (todo) => todo.status === "completed",
  ).length;
  const queuedCount = todos.filter(
    (todo) => todo.status === "pending" || todo.status === "in_progress",
  ).length;
  const workspaceName = workspacePath?.split("/").filter(Boolean).pop();
  const toolSummary = recentToolNames.slice(-3);

  const tips = [
    activeTodo
      ? `正在推进：${truncate(activeTodo.content.replace(/\s+/g, " "), 46)}`
      : null,
    completedCount > 0
      ? `已经完成 ${completedCount} 个处理步骤，接下来会优先收束剩余动作与验证闭环。`
      : null,
    queuedCount > 1
      ? `后面还有 ${queuedCount - 1} 个待推进步骤，当前按依赖顺序继续，不会无序扩散。`
      : null,
    workspaceName
      ? `正在结合工作区 ${workspaceName} 的文件关系与最近改动推进行为判断。`
      : null,
    workspaceName && workspaceFileCount > 0
      ? `当前工作区可见 ${workspaceFileCount} 个文件节点，会优先利用可证伪的局部线索。`
      : null,
    referencedPaths.length > 0
      ? `会优先使用你引用的 ${referencedPaths.length} 个文件路径，避免上下文偏移和重复搜索。`
      : null,
    toolSummary.length > 0
      ? `最近正在串联 ${toolSummary.join("、")} 等工具，把搜索、修改和验证压进同一轮处理。`
      : null,
    currentModelLabel
      ? `当前由 ${currentModelLabel} 负责本轮推理、工具调用和结果整理。`
      : null,
    messageCount > 3
      ? `当前线程已累计 ${messageCount} 条消息，状态会沿着现有上下文继续推进，不会从头重算。`
      : null,
    approvalMode === "auto"
      ? "当前是自动审批模式，低风险动作会直接继续，减少流程停顿。"
      : "当前是人工审批模式，高影响工具会停在确认点，保证执行边界清晰。",
    pendingApprovalName
      ? `流程当前停在 ${pendingApprovalName} 的确认点，批准或拒绝后会继续汇总后续结果。`
      : null,
    ...STREAMING_BASE_TIPS,
  ].filter((tip): tip is string => Boolean(tip));

  return Array.from(new Set(tips)).slice(0, 10);
}

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
  const [streamTipTick, setStreamTipTick] = useState(0);

  const { threads, models, loadThreads, generateTitleForFirstMessage } =
    useAppStore();

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
    setMessages,
    setTodos,
    setWorkspaceFiles,
    setWorkspacePath,
    setPendingApproval,
    appendMessage,
    setError,
    clearError,
    setDraftInput: setInput,
    approvalMode,
    setApprovalMode,
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
    async (
      decision: "approve" | "reject" | "edit",
      options?: { rememberForWorkspace?: boolean },
    ): Promise<void> => {
      if (!pendingApproval || !stream) return;

      setPendingApproval(null);

      try {
        await stream.submit(null, {
          command: {
            resume: {
              decision,
              rememberForWorkspace: options?.rememberForWorkspace,
              request: pendingApproval,
            },
          },
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

  const handleApprovalModeToggle = useCallback(async (): Promise<void> => {
    const nextMode: ApprovalMode = approvalMode === "auto" ? "manual" : "auto";
    try {
      await setApprovalMode(nextMode);
    } catch (error) {
      console.error("[ChatContainer] Failed to update approval mode:", error);
    }
  }, [approvalMode, setApprovalMode]);

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
    if (!isLoading) {
      return threadMessages;
    }

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
  }, [isLoading, threadMessages, streamData.messages]);

  const currentModelConfig = useMemo(
    () =>
      models.find(
        (model) => model.id === currentModel || model.model === currentModel,
      ),
    [currentModel, models],
  );

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

  const recentToolNames = useMemo(() => {
    const names = displayMessages.flatMap((message) => {
      const toolCallNames =
        message.tool_calls?.map((toolCall) => toolCall.name) || [];
      const toolResultName =
        message.role === "tool" && message.name ? [message.name] : [];
      return [...toolCallNames, ...toolResultName];
    });

    return Array.from(new Set(names.filter(Boolean))).slice(-3);
  }, [displayMessages]);

  const streamingTips = useMemo(
    () =>
      buildStreamingTips({
        todos,
        workspacePath,
        referencedPaths,
        currentModelLabel:
          currentModelConfig?.name || currentModelConfig?.model || currentModel,
        workspaceFileCount: workspaceFiles.length,
        approvalMode,
        messageCount: displayMessages.length,
        recentToolNames,
        pendingApprovalName: pendingApproval?.tool_call?.name,
      }),
    [
      approvalMode,
      currentModel,
      currentModelConfig?.model,
      currentModelConfig?.name,
      displayMessages.length,
      pendingApproval?.tool_call?.name,
      referencedPaths,
      recentToolNames,
      todos,
      workspaceFiles.length,
      workspacePath,
    ],
  );

  const currentStreamingTip =
    streamingTips[streamTipTick % Math.max(streamingTips.length, 1)] || "";

  useEffect(() => {
    if (!isLoading || streamingTips.length <= 1) return;

    const timer = window.setInterval(() => {
      setStreamTipTick((current) => current + 1);
    }, 2400);

    return () => window.clearInterval(timer);
  }, [isLoading, streamingTips.length]);

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

  const extractMessageText = useCallback((message: Message): string => {
    if (typeof message.content === "string") {
      return message.content.trim();
    }

    return message.content
      .filter((block) => block.type === "text" && block.text)
      .map((block) => block.text?.trim() ?? "")
      .filter(Boolean)
      .join("\n\n");
  }, []);

  const submitUserMessage = useCallback(
    async (messageText: string): Promise<void> => {
      if (!messageText.trim() || isLoading || !stream) return;

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

      setInput("");

      const isFirstMessage = threadMessages.length === 0;

      const userMessage: Message = {
        id: crypto.randomUUID(),
        role: "user",
        content: messageText,
        created_at: new Date(),
      };
      appendMessage(userMessage);

      if (isFirstMessage) {
        const currentThread = threads.find((t) => t.thread_id === threadId);
        const hasDefaultTitle =
          Boolean(currentThread?.title?.startsWith("Thread ")) ||
          Boolean(currentThread?.title?.startsWith("新会话 "));
        if (hasDefaultTitle) {
          generateTitleForFirstMessage(threadId, messageText);
        }
      }

      await stream.submit(
        {
          messages: [{ type: "human", content: messageText }],
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
    },
    [
      appendMessage,
      clearError,
      currentModel,
      generateTitleForFirstMessage,
      isLoading,
      pendingApproval,
      referencedPaths,
      setError,
      setInput,
      setPendingApproval,
      stream,
      threadError,
      threadId,
      threadMessages.length,
      threads,
      workspacePath,
    ],
  );

  const handleDismissError = (): void => {
    clearError();
  };

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    await submitUserMessage(input.trim());
  };

  const handleResendMessage = useCallback(
    async (message: Message): Promise<void> => {
      if (message.role !== "user" || isLoading) return;

      const messageText = extractMessageText(message);
      if (!messageText) return;

      const rewindIndex = threadMessages.findIndex(
        (item) => item.id === message.id,
      );
      if (rewindIndex === -1) {
        setError("未找到要重发的消息。请切换会话后重试。");
        return;
      }

      const userMessageOrdinal =
        threadMessages
          .slice(0, rewindIndex + 1)
          .filter((item) => item.role === "user").length - 1;

      if (userMessageOrdinal < 0) {
        setError("未找到可回滚的用户消息。请稍后重试。");
        return;
      }

      try {
        await window.api.threads.rewindToMessage(
          threadId,
          userMessageOrdinal,
          messageText,
        );
        setMessages(threadMessages.slice(0, rewindIndex));
        setReferencedPaths([]);
        setPendingApproval(null);
        clearError();
        await submitUserMessage(messageText);
      } catch (error) {
        console.error("[ChatContainer] Failed to resend message:", error);
        setError("重发消息失败，请稍后再试。");
      }
    },
    [
      clearError,
      extractMessageText,
      isLoading,
      setError,
      setMessages,
      setPendingApproval,
      submitUserMessage,
      threadId,
      threadMessages,
    ],
  );

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
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-transparent">
      {/* Messages */}
      <ScrollArea className="flex-1 min-h-0" ref={scrollRef}>
        <div className="px-4 py-5">
          <div className="mx-auto max-w-3xl space-y-4">
            {displayMessages.length === 0 && !isLoading && (
              <div className="app-flat-surface animate-scale-in relative mx-auto flex max-w-2xl flex-col items-center justify-center overflow-hidden rounded-[32px] px-8 py-14 text-center text-muted-foreground">
                <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,color-mix(in_srgb,var(--primary)_12%,transparent),transparent_40%),linear-gradient(180deg,color-mix(in_srgb,var(--card)_96%,transparent),color-mix(in_srgb,var(--background-elevated)_88%,transparent))]" />
                <div className="pointer-events-none absolute -right-16 top-8 h-40 w-40 rounded-full bg-primary/8 blur-3xl" />
                <div className="pointer-events-none absolute -left-12 bottom-2 h-28 w-28 rounded-full bg-foreground/4 blur-3xl" />
                <div className="relative flex flex-col items-center gap-4">
                  <div className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-background/70 px-3 py-1 text-[11px] font-medium tracking-[0.18em] text-muted-foreground uppercase backdrop-blur-sm">
                    <span className="size-1.5 rounded-full bg-primary" />
                    新会话
                  </div>
                  {workspacePath ? (
                    <>
                      <div className="space-y-3">
                        <div className="text-2xl font-semibold tracking-[-0.04em] text-foreground sm:text-[2rem]">
                          从这个工作区开始推进一个明确结果
                        </div>
                        <div className="mx-auto max-w-xl text-sm leading-6 text-muted-foreground sm:text-[15px]">
                          你已经连接了工作区，Jarvis
                          现在可以直接阅读代码、修改文件、执行命令，并把过程整理成可追踪的结果。
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center justify-center gap-2 text-xs text-muted-foreground">
                        <span className="rounded-full border border-border/70 bg-background/65 px-3 py-1.5 backdrop-blur-sm">
                          当前目录: {workspacePath.split("/").pop()}
                        </span>
                        <span className="rounded-full border border-border/70 bg-background/65 px-3 py-1.5 backdrop-blur-sm">
                          试试: “梳理这个模块”
                        </span>
                        <span className="rounded-full border border-border/70 bg-background/65 px-3 py-1.5 backdrop-blur-sm">
                          或者: “帮我改并验证”
                        </span>
                      </div>
                    </>
                  ) : (
                    <div className="space-y-4 text-center text-sm">
                      <div className="space-y-1">
                        <span className="text-base font-medium text-status-warning">
                          请选择工作区文件夹
                        </span>
                        <span className="mt-1 block text-xs opacity-80">
                          智能体需要工作区才能创建与修改文件
                        </span>
                      </div>
                      <button
                        type="button"
                        className="app-elevated-hover inline-flex h-9 items-center justify-center gap-1.5 rounded-full border border-primary/22 bg-primary/10 px-4 text-xs font-medium text-primary disabled:cursor-not-allowed disabled:opacity-50"
                        onClick={handleSelectWorkspaceFromEmptyState}
                      >
                        <Folder className="size-3.5" />
                        <span className="max-w-[120px] truncate">
                          选择工作区
                        </span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {displayMessages.map((message) => (
              <MessageBubble
                key={message.id}
                message={message}
                isStreaming={streamingAssistantIds.has(message.id)}
                canResend={!isLoading && message.role === "user"}
                toolResults={toolResults}
                pendingApproval={pendingApproval}
                onResend={handleResendMessage}
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
              <div className="animate-enter flex items-start gap-3 rounded-2xl border border-destructive/28 bg-destructive/8 px-4 py-4 backdrop-blur-sm">
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
        <div className="shrink-0 border-t border-status-warning/20 bg-status-warning/6 px-4 py-4 backdrop-blur-sm">
          <div className="app-flat-surface mx-auto flex max-w-3xl flex-col gap-3 rounded-[24px] border-status-warning/18 bg-status-warning/8 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-2 min-w-0 text-sm">
              <ShieldAlert className="mt-0.5 size-4 shrink-0 text-status-warning" />
              <div className="min-w-0">
                <div className="font-medium text-foreground">
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
                variant="outline"
                size="sm"
                onClick={() =>
                  void handleApprovalDecision("approve", {
                    rememberForWorkspace: true,
                  })
                }
              >
                允许此工作区后续类似命令
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => void handleApprovalDecision("approve")}
              >
                本次批准
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Input */}
      <div className="border-t border-border/60 bg-[linear-gradient(180deg,color-mix(in_srgb,var(--background)_62%,transparent),color-mix(in_srgb,var(--background-elevated)_84%,transparent))] px-4 py-4">
        <form onSubmit={handleSubmit} className="mx-auto max-w-3xl">
          <div className="relative app-flat-surface flex flex-col gap-3 overflow-visible rounded-[26px] px-4 py-4 transition-[box-shadow,border-color,background-color] duration-300 focus-within:shadow-[inset_0_1px_0_color-mix(in_srgb,#fff_8%,transparent),0_14px_36px_color-mix(in_srgb,var(--primary)_8%,transparent),0_0_0_1px_color-mix(in_srgb,var(--primary)_14%,transparent)]">
            {copyNoticeOpen && (
              <div className="animate-enter absolute -top-14 right-4 z-20 inline-flex items-center gap-2 rounded-full border border-status-nominal/25 bg-status-nominal/12 px-3 py-1.5 text-xs font-medium text-status-nominal shadow-[0_10px_28px_color-mix(in_srgb,var(--status-nominal)_12%,transparent)] backdrop-blur-sm">
                <Check className="size-3.5" />
                已复制到剪贴板
              </div>
            )}
            {isLoading && streamingTips.length > 0 && (
              <div className="animate-soft-fade flex items-center gap-3 overflow-hidden rounded-[18px] border border-border/70 bg-[linear-gradient(180deg,color-mix(in_srgb,var(--background-elevated)_94%,transparent),color-mix(in_srgb,var(--background)_86%,transparent))] px-3 py-2 shadow-[inset_0_1px_0_color-mix(in_srgb,#fff_8%,transparent),0_8px_18px_color-mix(in_srgb,#000_3%,transparent)]">
                <div
                  className="agent-activity-mark shrink-0"
                  aria-hidden="true"
                >
                  <span />
                  <span />
                  <span />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/90">
                    Jarvis is working
                  </div>
                  <div className="streaming-tip-viewport mt-1">
                    <div
                      key={`${streamTipTick}-${currentStreamingTip}`}
                      className="streaming-tip-line"
                    >
                      {currentStreamingTip}
                    </div>
                  </div>
                </div>
                <div className="hidden shrink-0 rounded-full border border-border/65 bg-background/65 px-2 py-1 text-[10px] font-medium text-muted-foreground shadow-[inset_0_1px_0_color-mix(in_srgb,#fff_10%,transparent)] sm:block">
                  {pendingApproval ? "已暂停" : "处理中"}
                </div>
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
                      "inline-flex items-center gap-1 rounded-full border border-border/70 bg-muted/55 px-2.5 py-1 text-[11px] font-mono text-muted-foreground hover:bg-background-interactive/82",
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
                  if (ta)
                    parseMentionAtCursor(
                      ta.value,
                      ta.selectionStart ?? ta.value.length,
                    );
                }}
                onKeyDown={handleKeyDown}
                placeholder="输入消息… Enter 发送，Shift+Enter 换行，@ 引用文件"
                disabled={isLoading}
                className="chat-input-scrollbar min-w-0 flex-1 resize-none rounded-[22px] border border-border/75 bg-[linear-gradient(180deg,color-mix(in_srgb,var(--background-elevated)_96%,transparent),color-mix(in_srgb,var(--background)_82%,transparent))] px-4 py-3.5 pr-3 text-sm leading-6 placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/55 disabled:opacity-50"
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
                  className="absolute bottom-full left-0 right-14 z-50 mb-3 max-h-56 overflow-y-auto rounded-2xl border border-border bg-popover py-2 shadow-[0_14px_34px_color-mix(in_srgb,#020617_12%,transparent)]"
                >
                  {mentionCandidates.map((f, idx) => (
                    <button
                      key={f.path}
                      data-mention-index={idx}
                      type="button"
                      className={cn(
                        "mx-1 block w-[calc(100%-0.5rem)] truncate rounded-xl px-3 py-2 text-left text-xs font-mono transition-colors",
                        idx === mentionActiveIndex
                          ? "bg-primary/12 text-foreground ring-1 ring-inset ring-primary/28"
                          : "hover:bg-background-interactive/78",
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
            <div className="-mx-1 -my-2 overflow-x-auto px-1 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <div className="flex min-w-max items-center gap-2 whitespace-nowrap pb-1">
                <ModelSwitcher
                  threadId={threadId}
                  onOpenSettings={onOpenSettings}
                />
                <div className="h-4 w-px shrink-0 bg-border" />
                <WorkspacePicker threadId={threadId} />
                <div className="h-4 w-px shrink-0 bg-border" />
                <Button
                  type="button"
                  variant={approvalMode === "auto" ? "nominal" : "outline"}
                  size="sm"
                  className="h-8 shrink-0 gap-1 rounded-full px-2.5 text-xs hover:translate-y-0"
                  onClick={() => void handleApprovalModeToggle()}
                  title={
                    approvalMode === "auto"
                      ? "当前为自动通过审批，点击切换为人工审批"
                      : "当前为人工审批，点击切换为自动通过"
                  }
                >
                  {approvalMode === "auto" ? (
                    <ShieldCheck className="size-3.5" />
                  ) : (
                    <Shield className="size-3.5" />
                  )}
                  {approvalMode === "auto" ? "自动审批" : "人工审批"}
                </Button>
                <div className="h-4 w-px shrink-0 bg-border" />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 shrink-0 gap-1 rounded-full px-2.5 text-xs text-muted-foreground hover:translate-y-0"
                  disabled={displayMessages.length === 0}
                  onClick={() => void copyConversationMarkdown()}
                  title="复制当前会话全部消息为 Markdown（含工具调用与结果）"
                >
                  <Copy className="size-3.5" />
                  复制 Markdown
                </Button>
                <div className="h-4 w-px shrink-0 bg-border" />
                <ContextUsageIndicator
                  tokenUsage={tokenUsage}
                  modelId={currentModel}
                  contextWindow={currentModelConfig?.contextWindow}
                  className="shrink-0 rounded-full border border-border/70 bg-card/70 px-3 py-1 backdrop-blur-sm"
                />
              </div>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-end gap-2 px-1">
            <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {pendingApproval && (
                <span className="inline-flex items-center gap-2 rounded-full border border-status-warning/28 bg-status-warning/10 px-3 py-1 text-status-warning">
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
