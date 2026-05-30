import { useRef, useEffect, useMemo, useCallback, useState } from "react";
import {
  Send,
  Square,
  AlertCircle,
  X,
  Copy,
  PencilLine,
  ShieldAlert,
  Shield,
  ShieldCheck,
  BookOpen,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import i18n from "@/lib/locales";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAppStore } from "@/lib/store";
import { useCurrentThread, useThreadStream } from "@/lib/thread-context";
import { sendDesktopNotification } from "@/lib/notifications";
import { MessageBubble } from "./MessageBubble";
import { ModelSwitcher } from "./ModelSwitcher";
import { Folder } from "lucide-react";
import { WorkspacePicker } from "./WorkspacePicker";
import { selectWorkspaceFolder } from "@/lib/workspace-utils";
import { ChatTodos } from "./ChatTodos";
import { ContextUsageIndicator } from "./ContextUsageIndicator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ApprovalMode, Message, SettingsOpenRequest } from "@/types";
import { cn, truncate } from "@/lib/utils";
import { messagesToMarkdown } from "@/lib/chat-markdown";
import { toast } from "@/lib/toast";

const STREAMING_BASE_TIPS = [
  i18n.t("streaming.tip1", { ns: "chat" }),
  i18n.t("streaming.tip2", { ns: "chat" }),
  i18n.t("streaming.tip3", { ns: "chat" }),
  i18n.t("streaming.tip4", { ns: "chat" }),
  i18n.t("streaming.tip5", { ns: "chat" }),
  i18n.t("streaming.tip6", { ns: "chat" }),
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
      ? i18n.t("streaming.pushingTodo", {
          ns: "chat",
          content: truncate(activeTodo.content.replace(/\s+/g, " "), 46),
        })
      : null,
    completedCount > 0
      ? i18n.t("streaming.completedSteps", {
          ns: "chat",
          count: completedCount,
        })
      : null,
    queuedCount > 1
      ? i18n.t("streaming.remainingSteps", {
          ns: "chat",
          count: queuedCount - 1,
        })
      : null,
    workspaceName
      ? i18n.t("streaming.workspaceContext", {
          ns: "chat",
          name: workspaceName,
        })
      : null,
    workspaceName && workspaceFileCount > 0
      ? i18n.t("streaming.workspaceFiles", {
          ns: "chat",
          count: workspaceFileCount,
        })
      : null,
    referencedPaths.length > 0
      ? i18n.t("streaming.referencedPaths", {
          ns: "chat",
          count: referencedPaths.length,
        })
      : null,
    toolSummary.length > 0
      ? i18n.t("streaming.recentTools", {
          ns: "chat",
          tools: toolSummary.join("、"),
        })
      : null,
    currentModelLabel
      ? i18n.t("streaming.currentModel", {
          ns: "chat",
          label: currentModelLabel,
        })
      : null,
    messageCount > 3
      ? i18n.t("streaming.messageCount", { ns: "chat", count: messageCount })
      : null,
    approvalMode === "auto"
      ? i18n.t("streaming.autoApprovalMode", { ns: "chat" })
      : i18n.t("streaming.manualApprovalMode", { ns: "chat" }),
    pendingApprovalName
      ? i18n.t("streaming.pendingApproval", {
          ns: "chat",
          name: pendingApprovalName,
        })
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
  is_error?: boolean;
}

interface ExplicitSkillSelection {
  folderName: string;
  description: string;
}

interface ChatContainerProps {
  threadId: string;
  onOpenSettings: (request?: SettingsOpenRequest) => void;
}

export function ChatContainer({
  threadId,
  onOpenSettings,
}: ChatContainerProps): React.JSX.Element {
  const TASK_COMPLETE_NOTIFICATION_DELAY_MS = 100;
  const { t } = useTranslation("chat");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const mentionListRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);
  const mentionStartRef = useRef(0);
  const composingRef = useRef(false);

  const [referencedPaths, setReferencedPaths] = useState<string[]>([]);
  const [selectedSkills, setSelectedSkills] = useState<ExplicitSkillSelection[]>(
    [],
  );
  const [availableSkills, setAvailableSkills] = useState<ExplicitSkillSelection[]>(
    [],
  );
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionActiveIndex, setMentionActiveIndex] = useState(0);
  const [mentionMode, setMentionMode] = useState<"file" | "skill">("file");
  const [streamTipTick, setStreamTipTick] = useState(0);
  const [overlayInset, setOverlayInset] = useState(176);
  const [isCancelling, setIsCancelling] = useState(false);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState("");
  const [isSubmittingEdit, setIsSubmittingEdit] = useState(false);
  const [deleteConfirmMessage, setDeleteConfirmMessage] =
    useState<Message | null>(null);
  const taskCompleteNotificationTimeoutRef = useRef<number | null>(null);

  const { threads, models, loadThreads, generateTitleForFirstMessage } =
    useAppStore();

  // Get persisted thread state and actions from context
  const {
    messages: threadMessages,
    pendingApprovals,
    pendingApproval,
    isMemoryConsolidating,
    memoryConsolidationEnabled,
    pendingMemoryPromotions,
    memoryRecall,
    skillUsage,
    todos,
    error: threadError,
    workspacePath,
    tokenUsage,
    promptTokenEstimate,
    currentModel,
    draftInput: input,
    workspaceFiles,
    openFile,
    setFileContents,
    setMessages,
    setTodos,
    setWorkspaceFiles,
    setWorkspacePath,
    setPendingApprovals,
    setPendingApproval,
    setPendingMemoryPromotions,
    setMemoryRecall,
    setSkillUsage,
    appendMessage,
    setError,
    clearError,
    setDraftInput: setInput,
    approvalMode,
    setApprovalMode,
    interruptionQueue,
    enqueueInterruption,
    clearInterruptionQueue,
  } = useCurrentThread(threadId);

  // Get the stream data via subscription - reactive updates without re-rendering provider
  const streamData = useThreadStream(threadId);
  const stream = streamData.stream;
  const isLoading = streamData.isLoading;
  const suppressTaskCompleteNotification =
    streamData.suppressTaskCompleteNotification;

  const mentionCandidates = useMemo(() => {
    const q = mentionQuery.toLowerCase();
    if (mentionMode === "skill") {
      return availableSkills
        .filter(
          (skill) =>
            skill.folderName.toLowerCase().includes(q) ||
            skill.description.toLowerCase().includes(q),
        )
        .slice(0, 40);
    }
    return workspaceFiles
      .filter((f) => f.path.toLowerCase().includes(q))
      .slice(0, 40);
  }, [availableSkills, mentionMode, workspaceFiles, mentionQuery]);

  useEffect(() => {
    let cancelled = false;

    async function loadSkills(): Promise<void> {
      try {
        const result =
          await window.api.skills.listWorkspaceSkillFolders(threadId);
        if (!cancelled && result.success && result.folders) {
          setAvailableSkills(
            result.folders.map((folder) => ({
              folderName: folder.folderName,
              description: folder.description,
            })),
          );
        }
      } catch (error) {
        console.error("[ChatContainer] Failed to load skills:", error);
      }
    }

    void loadSkills();

    return () => {
      cancelled = true;
    };
  }, [threadId]);

  useEffect(() => {
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
    while (i >= 0 && v[i] !== "@" && v[i] !== "/" && v[i] !== "\n") {
      i--;
    }
    if (i < 0 || (v[i] !== "@" && v[i] !== "/")) {
      setMentionOpen(false);
      return;
    }
    const trigger = v[i];
    const query = v.slice(i + 1, pos);
    if (query.includes(" ") || query.includes("\n")) {
      setMentionOpen(false);
      return;
    }
    mentionStartRef.current = i;
    setMentionMode(trigger === "@" ? "file" : "skill");
    setMentionQuery(query);
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

  const pickMention = (value: string): void => {
    const ta = inputRef.current;
    if (!ta) return;
    const v = ta.value;
    const pos = ta.selectionStart ?? v.length;
    const start = mentionStartRef.current;
    const before = v.slice(0, start);
    const after = v.slice(pos);
    setInput(before + after);
    if (mentionMode === "skill") {
      const pickedSkill = availableSkills.find(
        (skill) => skill.folderName === value,
      );
      if (pickedSkill) {
        setSelectedSkills((prev) =>
          prev.some((skill) => skill.folderName === pickedSkill.folderName)
            ? prev
            : [...prev, pickedSkill],
        );
      }
    } else {
      setReferencedPaths((prev) => [...new Set([...prev, value])]);
    }
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
      const requests =
        pendingApprovals.length > 0
          ? pendingApprovals
          : pendingApproval
            ? [pendingApproval]
            : [];
      if (requests.length === 0 || !stream) return;

      setPendingApprovals([]);

      try {
        await stream.submit(null, {
          command: {
            resume: {
              decision,
              rememberForWorkspace: options?.rememberForWorkspace,
              request: requests[0],
              requests,
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
    [
      currentModel,
      pendingApproval,
      pendingApprovals,
      setPendingApprovals,
      stream,
      threadId,
    ],
  );

  const handleApprovalModeToggle = useCallback(async (): Promise<void> => {
    const nextMode: ApprovalMode = approvalMode === "auto" ? "manual" : "auto";
    try {
      await setApprovalMode(nextMode);
    } catch (error) {
      console.error("[ChatContainer] Failed to update approval mode:", error);
    }
  }, [approvalMode, setApprovalMode]);

  const handleConfirmPromotion = useCallback(async (): Promise<void> => {
    if (pendingMemoryPromotions.length === 0) {
      return;
    }

    try {
      const results = await Promise.all(
        pendingMemoryPromotions.map((candidate) =>
          window.api.skills.confirmPromotion(candidate),
        ),
      );
      const failedResult = results.find((result) => !result.success);
      if (failedResult) {
        console.error(
          "[ChatContainer] Failed to confirm promotion:",
          failedResult.error,
        );
        toast.error("记忆沉淀为技能失败");
        return;
      }
      setPendingMemoryPromotions([]);
      toast.success(
        pendingMemoryPromotions.length > 1
          ? `已将 ${pendingMemoryPromotions.length} 条记忆沉淀为全局技能`
          : "记忆已沉淀为全局技能",
      );
    } catch (error) {
      console.error("[ChatContainer] Failed to confirm promotion:", error);
      toast.error("记忆沉淀为技能失败");
    }
  }, [pendingMemoryPromotions, setPendingMemoryPromotions]);

  const handleDismissContextAssist = useCallback((): void => {
    setMemoryRecall(null);
    setSkillUsage(null);
  }, [setMemoryRecall, setSkillUsage]);

  const handleRejectPromotion = useCallback(async (): Promise<void> => {
    if (pendingMemoryPromotions.length === 0) {
      return;
    }

    try {
      const results = await Promise.all(
        pendingMemoryPromotions.map((candidate) =>
          window.api.skills.rejectPromotion(candidate),
        ),
      );
      const failedResult = results.find((result) => !result.success);
      if (failedResult) {
        console.error(
          "[ChatContainer] Failed to reject promotion:",
          failedResult.error,
        );
        toast.error("暂不沉淀记忆失败");
        return;
      }
      setPendingMemoryPromotions([]);
    } catch (error) {
      console.error("[ChatContainer] Failed to reject promotion:", error);
      toast.error("暂不沉淀记忆失败");
    }
  }, [pendingMemoryPromotions, setPendingMemoryPromotions]);

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
  const latestTaskCompleteStateRef = useRef({
    suppressTaskCompleteNotification,
    pendingApprovalCount: pendingApprovals.length,
    hasPendingApproval: Boolean(pendingApproval),
    threadError,
    isCancelling,
  });

  const clearPendingTaskCompleteNotification = useCallback(() => {
    if (taskCompleteNotificationTimeoutRef.current !== null) {
      window.clearTimeout(taskCompleteNotificationTimeoutRef.current);
      taskCompleteNotificationTimeoutRef.current = null;
    }
  }, []);

  useEffect(() => {
    latestTaskCompleteStateRef.current = {
      suppressTaskCompleteNotification,
      pendingApprovalCount: pendingApprovals.length,
      hasPendingApproval: Boolean(pendingApproval),
      threadError,
      isCancelling,
    };
  }, [
    suppressTaskCompleteNotification,
    pendingApprovals.length,
    pendingApproval,
    threadError,
    isCancelling,
  ]);

  useEffect(() => {
    if (
      isLoading ||
      suppressTaskCompleteNotification ||
      pendingApproval ||
      pendingApprovals.length > 0 ||
      threadError ||
      isCancelling
    ) {
      clearPendingTaskCompleteNotification();
    }
  }, [
    clearPendingTaskCompleteNotification,
    isLoading,
    suppressTaskCompleteNotification,
    pendingApproval,
    pendingApprovals.length,
    threadError,
    isCancelling,
  ]);

  useEffect(
    () => clearPendingTaskCompleteNotification,
    [clearPendingTaskCompleteNotification],
  );

  useEffect(() => {
    if (prevLoadingRef.current && !isLoading) {
      clearPendingTaskCompleteNotification();
      taskCompleteNotificationTimeoutRef.current = window.setTimeout(() => {
        taskCompleteNotificationTimeoutRef.current = null;

        const latest = latestTaskCompleteStateRef.current;
        if (
          latest.suppressTaskCompleteNotification ||
          latest.hasPendingApproval ||
          latest.pendingApprovalCount > 0 ||
          latest.threadError ||
          latest.isCancelling
        ) {
          return;
        }

        const currentNotificationState = useAppStore.getState();
        sendDesktopNotification(
          t("notification.taskComplete"),
          t("notification.taskCompleteBody"),
          {
            force: true,
            soundType: "taskComplete",
            playSound: true,
            sounds: currentNotificationState.notificationSounds,
            soundEnabled: currentNotificationState.notificationSoundEnabled,
            notificationsEnabled: currentNotificationState.notificationsEnabled,
          },
        );
      }, TASK_COMPLETE_NOTIFICATION_DELAY_MS);

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
            ...(role === "tool" && streamMsg.is_error !== undefined
              ? { is_error: streamMsg.is_error }
              : {}),
            created_at: new Date(),
          };
          appendMessage(storeMsg);
        }
      }
      loadThreads();

      // Handle interruption queue: merge queued messages and auto-submit
      if (interruptionQueue.length > 0 && stream) {
        const queuedContent = interruptionQueue
          .map((m) => (typeof m.content === "string" ? m.content : ""))
          .filter(Boolean)
          .join("\n\n");

        const mergedPaths = [
          ...new Set(
            interruptionQueue.flatMap((message) => message.referenced_paths ?? []),
          ),
        ];
        const mergedSkillsByFolder = new Map<
          string,
          { folderName: string; description?: string }
        >();
        for (const queuedMessage of interruptionQueue) {
          for (const skill of queuedMessage.selected_skills ?? []) {
            mergedSkillsByFolder.set(skill.folderName, skill);
          }
        }
        const mergedSkills = [...mergedSkillsByFolder.values()];
        const explicitSkillsPrompt =
          mergedSkills.length > 0
            ? `请优先使用以下指定技能，不要忽略它们：\n${mergedSkills
                .map(
                  (skill) =>
                    `- ${skill.folderName}${skill.description ? `：${skill.description}` : ""}`,
                )
                .join("\n")}\n\n`
            : "";

        // Promote queued messages to normal messages
        for (const qm of interruptionQueue) {
          appendMessage({ ...qm, _queued: false });
        }
        clearInterruptionQueue();

        // Submit merged content as a single message
        stream.submit(
          {
            messages: [
              { type: "human", content: `${explicitSkillsPrompt}${queuedContent}` },
            ],
          },
          {
            config: {
              configurable: {
                thread_id: threadId,
                model_id: currentModel,
                ...(mergedPaths.length > 0 ? { referenced_paths: mergedPaths } : {}),
                ...(mergedSkills.length > 0
                  ? { selected_skills: mergedSkills }
                  : {}),
                display_content: queuedContent,
              },
            },
          },
        );
      }
    }
    prevLoadingRef.current = isLoading;
  }, [
    isLoading,
    streamData.messages,
    loadThreads,
    appendMessage,
    interruptionQueue,
    stream,
    threadId,
    currentModel,
    clearInterruptionQueue,
    clearPendingTaskCompleteNotification,
    t,
  ]);

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
          ...(role === "tool" && streamMsg.is_error !== undefined
            ? { is_error: streamMsg.is_error }
            : {}),
          created_at: new Date(),
        };
      });

    return [...threadMessages, ...streamingMsgs, ...interruptionQueue];
  }, [isLoading, threadMessages, streamData.messages, interruptionQueue]);

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

  const pendingApprovalCount =
    pendingApprovals.length > 0
      ? pendingApprovals.length
      : pendingApproval
        ? 1
        : 0;
  const pendingApprovalLabel =
    pendingApprovalCount > 1 && pendingApproval
      ? t("approval.multipleToolCalls", {
          name: pendingApproval.tool_call.name,
          count: pendingApprovalCount,
        })
      : pendingApproval?.tool_call?.name;

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
        pendingApprovalName: pendingApprovalLabel,
      }),
    [
      approvalMode,
      currentModel,
      currentModelConfig?.model,
      currentModelConfig?.name,
      displayMessages.length,
      pendingApprovalLabel,
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

  useEffect(() => {
    if (!isLoading) {
      setIsCancelling(false);
    }
  }, [isLoading]);

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
          is_error: msg.is_error,
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
      toast.success(t("toast.copiedToClipboard", { ns: "common" }));
    } catch {
      toast.error(t("toast.copyFailed", { ns: "common" }));
    }
  }, [displayMessages, t, toolResults]);

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

  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;

    const updateOverlayInset = (): void => {
      const nextInset = Math.ceil(overlay.getBoundingClientRect().height + 16);
      setOverlayInset((current) =>
        Math.abs(current - nextInset) > 1 ? nextInset : current,
      );
    };

    updateOverlayInset();

    const observer = new ResizeObserver(() => {
      updateOverlayInset();
    });
    observer.observe(overlay);

    window.addEventListener("resize", updateOverlayInset);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateOverlayInset);
    };
  }, [
    skillUsage,
    memoryRecall,
    pendingApproval,
      pendingMemoryPromotions,
    input,
    isLoading,
    streamTipTick,
  ]);

  useEffect(() => {
    const viewport = getViewport();
    if (viewport && isAtBottomRef.current) {
      viewport.scrollTop = viewport.scrollHeight;
    }
  }, [overlayInset, getViewport]);

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

  const extractToolCallNames = useCallback((message: Message): string[] => {
    return (message.tool_calls ?? [])
      .map((toolCall) => toolCall.name)
      .filter((name): name is string => Boolean(name));
  }, []);

  const submitUserMessage = useCallback(
    async (messageText: string): Promise<void> => {
      if (!messageText.trim() || !stream) return;

      if (!workspacePath) {
        setError(t("selectWorkspaceFirst"));
        return;
      }

      if (threadError) {
        clearError();
      }

      if (pendingApproval) {
        setPendingApproval(null);
      }

      if (memoryRecall) {
        setMemoryRecall(null);
      }

      if (skillUsage) {
        setSkillUsage(null);
      }

      const userMessage: Message = {
        id: crypto.randomUUID(),
        role: "user",
        content: messageText,
        created_at: new Date(),
        ...(referencedPaths.length > 0
          ? { referenced_paths: [...referencedPaths] }
          : {}),
        ...(selectedSkills.length > 0
          ? {
              selected_skills: selectedSkills.map((skill) => ({
                folderName: skill.folderName,
                description: skill.description,
              })),
            }
          : {}),
      };

      if (isLoading) {
        // Interruption mode: queue message, don't call stream.submit
        userMessage._queued = true;
        enqueueInterruption(userMessage);
        setInput("");
        setReferencedPaths([]);
        setSelectedSkills([]);
        return;
      }

      setIsCancelling(false);
      setInput("");

      const isFirstMessage = threadMessages.length === 0;
      const explicitSkillsPrompt =
        selectedSkills.length > 0
          ? `请优先使用以下指定技能，不要忽略它们：\n${selectedSkills
              .map((skill) => `- ${skill.folderName}${skill.description ? `：${skill.description}` : ""}`)
              .join("\n")}\n\n`
          : "";
      const finalMessageText = `${explicitSkillsPrompt}${messageText}`;

      appendMessage(userMessage);

      if (isFirstMessage) {
        const currentThread = threads.find((th) => th.thread_id === threadId);
        const hasDefaultTitle =
          Boolean(currentThread?.title?.startsWith("Thread ")) ||
          Boolean(currentThread?.title?.startsWith(t("emptyState.newSession")));
        if (hasDefaultTitle) {
          generateTitleForFirstMessage(threadId, messageText);
        }
      }

      await stream.submit(
        {
          messages: [{ type: "human", content: finalMessageText }],
        },
        {
          config: {
            configurable: {
              thread_id: threadId,
              model_id: currentModel,
              ...(referencedPaths.length > 0
                ? { referenced_paths: referencedPaths }
                : {}),
              ...(selectedSkills.length > 0
                ? {
                    selected_skills: selectedSkills.map((skill) => ({
                      folderName: skill.folderName,
                      description: skill.description,
                    })),
                  }
                : {}),
              display_content: messageText,
            },
          },
        },
      );
      setReferencedPaths([]);
      setSelectedSkills([]);
    },
    [
      appendMessage,
      clearError,
      currentModel,
      enqueueInterruption,
      generateTitleForFirstMessage,
      isLoading,
      pendingApproval,
      referencedPaths,
      selectedSkills,
      setError,
      setInput,
      setPendingApproval,
      setMemoryRecall,
      setSkillUsage,
      stream,
      t,
      threadError,
      threadId,
      threadMessages.length,
      threads,
      memoryRecall,
      skillUsage,
      workspacePath,
    ],
  );

  const handleDismissError = (): void => {
    clearError();
  };

  const rewindThreadToMessage = useCallback(
    async (message: Message): Promise<number> => {
      const rewindIndex = threadMessages.findIndex(
        (item) => item.id === message.id,
      );
      if (rewindIndex === -1) {
        throw new Error("MESSAGE_NOT_FOUND");
      }

      const messageText = extractMessageText(message);
      const hasToolCalls = Boolean(
        message.tool_calls && message.tool_calls.length > 0,
      );
      if (!messageText && !hasToolCalls) {
        throw new Error("MESSAGE_EMPTY");
      }

      await window.api.threads.rewindToMessage(
        threadId,
        message.id,
        rewindIndex,
        message.role,
        messageText,
        extractToolCallNames(message),
      );

      return rewindIndex;
    },
    [extractMessageText, extractToolCallNames, threadId, threadMessages],
  );

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    await submitUserMessage(input.trim());
  };

  const handleResendMessage = useCallback(
    async (message: Message): Promise<void> => {
      if (message.role !== "user" || isLoading) return;

      const messageText = extractMessageText(message);
      if (!messageText) return;

      try {
        const rewindIndex = await rewindThreadToMessage(message);
        setMessages(threadMessages.slice(0, rewindIndex));
        setReferencedPaths([]);
        setPendingApprovals([]);
        setPendingApproval(null);
        setTodos([]);
        clearError();
        await submitUserMessage(messageText);
      } catch (error) {
        console.error("[ChatContainer] Failed to resend message:", error);
        if (error instanceof Error && error.message === "MESSAGE_NOT_FOUND") {
          setError(t("toast.resendNotFound"));
          return;
        }
        setError(t("toast.resendFailed"));
      }
    },
    [
      isLoading,
      extractMessageText,
      rewindThreadToMessage,
      setMessages,
      threadMessages,
      setPendingApprovals,
      setPendingApproval,
      setTodos,
      clearError,
      submitUserMessage,
      setError,
      t,
    ],
  );

  const handleEditMessage = useCallback(
    async (message: Message): Promise<void> => {
      if (message.role !== "user" || isLoading) return;

      const messageText = extractMessageText(message);
      if (!messageText) return;

      clearError();
      setEditingMessageId(message.id);
      setEditingDraft(messageText);
    },
    [clearError, extractMessageText, isLoading],
  );

  const handleEditDraftChange = useCallback(
    (_message: Message, value: string): void => {
      setEditingDraft(value);
    },
    [],
  );

  const handleCancelEditing = useCallback((): void => {
    setEditingMessageId(null);
    setEditingDraft("");
    setIsSubmittingEdit(false);
  }, []);

  const handleSubmitEditedMessage = useCallback(
    async (message: Message): Promise<void> => {
      if (message.role !== "user" || isLoading || isSubmittingEdit) return;

      const nextMessageText = editingDraft.trim();
      if (!nextMessageText) {
        return;
      }

      try {
        setIsSubmittingEdit(true);
        const rewindIndex = await rewindThreadToMessage(message);
        setMessages(threadMessages.slice(0, rewindIndex));
        setReferencedPaths([]);
        setPendingApprovals([]);
        setPendingApproval(null);
        setTodos([]);
        clearError();
        setEditingMessageId(null);
        setEditingDraft("");
        await submitUserMessage(nextMessageText);
      } catch (error) {
        console.error(
          "[ChatContainer] Failed to submit edited message:",
          error,
        );
        if (error instanceof Error && error.message === "MESSAGE_NOT_FOUND") {
          setError(t("toast.editNotFound"));
        } else {
          setError(t("toast.editSendFailed"));
        }
      } finally {
        setIsSubmittingEdit(false);
      }
    },
    [
      clearError,
      editingDraft,
      isLoading,
      isSubmittingEdit,
      rewindThreadToMessage,
      setError,
      setMessages,
      setPendingApproval,
      setPendingApprovals,
      setTodos,
      submitUserMessage,
      t,
      threadMessages,
    ],
  );

  const handleDeleteMessage = useCallback(
    async (message: Message): Promise<void> => {
      if (
        (message.role !== "user" && message.role !== "assistant") ||
        isLoading
      )
        return;

      setDeleteConfirmMessage(message);
    },
    [isLoading],
  );

  const executeConfirmedDelete = useCallback(async (): Promise<void> => {
    const message = deleteConfirmMessage;
    if (!message) return;

    try {
      const rewindIndex = await rewindThreadToMessage(message);
      setMessages(threadMessages.slice(0, rewindIndex));
      setTodos([]);
      setPendingApprovals([]);
      setPendingApproval(null);
      setReferencedPaths([]);
      clearError();
      setDeleteConfirmMessage(null);
      toast.success(t("toast.messageDeleted"));
    } catch (error) {
      console.error("[ChatContainer] Failed to delete message:", error);
      setDeleteConfirmMessage(null);
      if (error instanceof Error && error.message === "MESSAGE_NOT_FOUND") {
        setError(t("toast.deleteNotFound"));
        return;
      }
      setError(t("toast.deleteFailed"));
    }
  }, [
    clearError,
    deleteConfirmMessage,
    rewindThreadToMessage,
    setError,
    setMessages,
    setPendingApproval,
    setPendingApprovals,
    setTodos,
    t,
    threadMessages,
  ]);

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
      if (e.key === "Enter" && !e.shiftKey && !composingRef.current) {
        e.preventDefault();
        const f = mentionCandidates[mentionActiveIndex];
        if (f) {
          if (mentionMode === "skill") {
            pickMention((f as ExplicitSkillSelection).folderName);
          } else {
            pickMention(
              (f as { path: string }).path,
            );
          }
        }
        return;
      }
    } else if (mentionOpen && e.key === "Escape") {
      e.preventDefault();
      setMentionOpen(false);
      return;
    }
    if (e.key === "Enter" && !e.shiftKey && !composingRef.current) {
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
    setIsCancelling(true);
    clearInterruptionQueue();
    try {
      await Promise.all([window.api.agent.cancel(threadId), stream?.stop()]);
    } catch (error) {
      setIsCancelling(false);
      console.error("[ChatContainer] Failed to cancel active run:", error);
    }
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

  const handleOpenFile = useCallback(
    (path: string, name: string): void => {
      openFile(path, name);

      if (/\.html?$/i.test(name) || /\.html?$/i.test(path)) {
        void window.api.workspace.openInBrowser(threadId, path);
      }
    },
    [openFile, threadId],
  );

  const handleOpenMemoryRecall = useCallback(
    (workspaceFilePath: string, title: string): void => {
      handleOpenFile(workspaceFilePath, `${title}.md`);
    },
    [handleOpenFile],
  );

  const handleOpenUsedSkill = useCallback(
    async (folderName: string, skillFilePath: string, title: string) => {
      const result = await window.api.skills.readSkillMarkdown(
        threadId,
        folderName,
      );

      if (!result.success || result.content === undefined) {
        toast.error(result.error || "打开技能文件失败");
        return;
      }

      setFileContents(skillFilePath, result.content);
      openFile(skillFilePath, `${title}.md`);
    },
    [openFile, setFileContents, threadId],
  );

  const handleOpenSkillRef = useCallback(
    (skill: { folderName: string; description?: string }) => {
      void handleOpenUsedSkill(
        skill.folderName,
        `/skills/${skill.folderName}/SKILL.md`,
        skill.folderName,
      );
    },
    [handleOpenUsedSkill],
  );

  const hasMemoryRecall = Boolean(memoryRecall && memoryRecall.items.length > 0);
  const hasSkillUsage = Boolean(skillUsage && skillUsage.items.length > 0);
  const hasContextAssist = hasMemoryRecall || hasSkillUsage;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
      <ScrollArea
        className="app-subtle-scroll flex-1 min-h-0"
        ref={scrollRef}
        style={{ marginBottom: `${overlayInset}px` }}
      >
        <div className="px-4 pt-5">
          <div className="mx-auto max-w-4xl space-y-4 pb-6">
            {displayMessages.length === 0 && !isLoading && (
              <div className="animate-scale-in relative mx-auto flex max-w-2xl flex-col items-center justify-center overflow-hidden rounded-4xl border border-border bg-background-elevated px-8 py-14 text-center text-muted-foreground">
                <div className="relative flex flex-col items-center gap-4">
                  <div className="inline-flex items-center gap-2 rounded-full border border-border bg-background-elevated px-3 py-1 text-[11px] font-medium tracking-[0.18em] text-muted-foreground uppercase">
                    <span className="size-1.5 rounded-full bg-foreground" />
                    {t("emptyState.newSession")}
                  </div>
                  {workspacePath ? (
                    <>
                      <div className="space-y-3">
                        <div className="text-2xl font-semibold tracking-[-0.04em] text-foreground sm:text-[2rem]">
                          {t("emptyState.startFromWorkspace")}
                        </div>
                        <div className="mx-auto max-w-xl text-sm leading-6 text-muted-foreground sm:text-[15px]">
                          {t("emptyState.connectedWorkspace")}
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center justify-center gap-2 text-xs text-muted-foreground">
                        <span className="rounded-full border border-border bg-background-elevated px-3 py-1.5">
                          {t("emptyState.currentDir", {
                            folder: workspacePath.split("/").pop(),
                          })}
                        </span>
                        <span className="rounded-full border border-border bg-background-elevated px-3 py-1.5">
                          {t("emptyState.trySuggestion")}
                        </span>
                        <span className="rounded-full border border-border bg-background-elevated px-3 py-1.5">
                          {t("emptyState.orSuggestion")}
                        </span>
                      </div>
                    </>
                  ) : (
                    <div className="space-y-4 text-center text-sm">
                      <div className="space-y-1">
                        <span className="text-base font-medium text-status-warning">
                          {t("emptyState.selectWorkspace")}
                        </span>
                        <span className="mt-1 block text-xs opacity-80">
                          {t("emptyState.agentNeedsWorkspace")}
                        </span>
                      </div>
                      <button
                        type="button"
                        className="inline-flex h-9 items-center justify-center gap-1.5 rounded-full border border-border bg-background-elevated px-4 text-xs font-medium text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                        onClick={handleSelectWorkspaceFromEmptyState}
                      >
                        <Folder className="size-3.5" />
                        <span className="max-w-30 truncate">
                          {t("emptyState.chooseWorkspace")}
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
                threadId={threadId}
                onOpenFile={handleOpenFile}
                onOpenSkill={handleOpenSkillRef}
                isStreaming={streamingAssistantIds.has(message.id)}
                canResend={!isLoading && message.role === "user"}
                canEdit={!isLoading && message.role === "user"}
                canDelete={
                  !isLoading &&
                  (message.role === "user" || message.role === "assistant")
                }
                isEditing={editingMessageId === message.id}
                editDraft={
                  editingMessageId === message.id ? editingDraft : undefined
                }
                isSubmittingEdit={
                  isSubmittingEdit && editingMessageId === message.id
                }
                toolResults={toolResults}
                pendingApprovals={pendingApprovals}
                pendingApproval={pendingApproval}
                onResend={handleResendMessage}
                onEdit={handleEditMessage}
                onEditDraftChange={handleEditDraftChange}
                onEditCancel={handleCancelEditing}
                onEditSubmit={handleSubmitEditedMessage}
                onDelete={handleDeleteMessage}
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
              <div className="animate-enter flex items-start gap-3 rounded-2xl border border-border bg-background-elevated px-4 py-4">
                <AlertCircle className="size-5 text-destructive shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-destructive text-sm">
                    {t("error.agentError")}
                  </div>
                  <div className="text-sm text-muted-foreground mt-1 wrap-break-word">
                    {threadError}
                  </div>
                  <div className="text-xs text-muted-foreground mt-2">
                    {t("error.tryResend")}
                  </div>
                </div>
                <button
                  onClick={handleDismissError}
                  className="shrink-0 rounded p-1 hover:bg-destructive/20 transition-colors"
                  aria-label={t("error.closeError")}
                >
                  <X className="size-4 text-muted-foreground" />
                </button>
              </div>
            )}
          </div>
        </div>
      </ScrollArea>

      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-background"
        style={{ height: `${overlayInset}px` }}
      />

      <div
        ref={overlayRef}
        className="pointer-events-none absolute inset-x-4 bottom-4 z-20 flex flex-col items-center gap-3"
      >
        {isMemoryConsolidating && (
          <div className="pointer-events-auto w-full max-w-4xl rounded-3xl border border-border/70 bg-background-elevated/95 px-4 py-3 shadow-[0_20px_45px_color-mix(in_srgb,#000_12%,transparent)] backdrop-blur">
            <div className="flex items-center gap-3 text-sm">
              <div className="size-2 shrink-0 rounded-full bg-status-nominal animate-pulse" />
              <div className="min-w-0">
                <div className="font-medium text-foreground">
                  正在进行记忆沉淀
                </div>
                <div className="text-xs text-muted-foreground">
                  正在整理本轮较有复用价值的经验，简单问答会自动跳过。
                </div>
              </div>
            </div>
          </div>
        )}

        {pendingMemoryPromotions.length > 0 && (
          <div className="pointer-events-auto w-full max-w-4xl rounded-3xl border border-status-nominal/40 bg-background-elevated px-4 py-4 shadow-[0_20px_45px_color-mix(in_srgb,#000_18%,transparent)]">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 text-sm">
                <div className="flex items-start gap-2">
                  <ShieldCheck className="mt-0.5 size-4 shrink-0 text-status-nominal" />
                  <div className="min-w-0">
                    <div className="font-medium text-foreground">
                      {pendingMemoryPromotions.length > 1
                        ? `${pendingMemoryPromotions.length} 条记忆已达到技能沉淀阈值`
                        : `记忆已达到技能沉淀阈值：${pendingMemoryPromotions[0]?.title ?? ""}`}
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground break-all">
                      {pendingMemoryPromotions.length > 1
                        ? "这些记忆都已达到沉淀条件，确认后会一次性沉淀到全局 skills 目录。"
                        : `已召回 ${pendingMemoryPromotions[0]?.recallCount ?? 0} 次，阈值 ${pendingMemoryPromotions[0]?.threshold ?? 0} 次。确认后会沉淀到全局 skills 目录。`}
                    </div>
                    {pendingMemoryPromotions.length > 1 && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {pendingMemoryPromotions.slice(0, 4).map((candidate) => (
                          <span
                            key={candidate.memoryPath}
                            className="rounded-full border border-status-nominal/20 bg-status-nominal/10 px-2.5 py-1 text-[11px] text-status-nominal"
                          >
                            {candidate.title}
                          </span>
                        ))}
                        {pendingMemoryPromotions.length > 4 && (
                          <span className="rounded-full border border-border bg-background px-2.5 py-1 text-[11px] text-muted-foreground">
                            另有 {pendingMemoryPromotions.length - 4} 条
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex shrink-0 justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void handleRejectPromotion()}
                >
                  暂不沉淀
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => void handleConfirmPromotion()}
                >
                  {pendingMemoryPromotions.length > 1
                    ? "全部沉淀为全局技能"
                    : "沉淀为全局技能"}
                </Button>
              </div>
            </div>
          </div>
        )}

        {hasContextAssist && (
          <div className="pointer-events-auto w-full max-w-4xl overflow-hidden rounded-3xl border border-primary/20 bg-[linear-gradient(135deg,color-mix(in_srgb,var(--background-elevated)_92%,var(--primary)_8%),color-mix(in_srgb,var(--background)_94%,var(--primary)_6%))] shadow-[0_20px_45px_color-mix(in_srgb,#000_14%,transparent)]">
            <div className="flex items-start justify-between gap-3 px-4 py-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-start gap-3">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-2xl border border-primary/15 bg-primary/10 text-primary">
                    <BookOpen className="size-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      {hasMemoryRecall && (
                        <span className="rounded-full border border-primary/15 bg-background/70 px-2.5 py-1 text-[11px] font-medium tracking-[0.16em] text-primary uppercase">
                          记忆召回
                        </span>
                      )}
                      {hasSkillUsage && (
                        <span className="rounded-full border border-primary/15 bg-background/70 px-2.5 py-1 text-[11px] font-medium tracking-[0.16em] text-primary uppercase">
                          技能使用
                        </span>
                      )}
                      <span className="text-xs text-muted-foreground">
                        {hasMemoryRecall && hasSkillUsage
                          ? `本轮回答补充了 ${(memoryRecall?.totalCount ?? 0) + (skillUsage?.totalCount ?? 0)} 条上下文线索`
                          : hasMemoryRecall
                            ? `已为本轮回答补充 ${memoryRecall?.totalCount ?? 0} 条相关经验`
                            : `本轮回答命中了 ${skillUsage?.totalCount ?? 0} 个技能`}
                      </span>
                    </div>
                    <div className="mt-2 text-sm font-medium text-foreground">
                      {hasMemoryRecall && hasSkillUsage
                        ? "本次回答参考了这些记忆和技能"
                        : hasMemoryRecall
                          ? "本次回答参考了这些历史记忆"
                          : "本次回答使用了这些技能"}
                    </div>
                    {memoryConsolidationEnabled === false && (
                      <div className="mt-1 text-xs text-muted-foreground">
                        当前已关闭记忆沉淀，本次仅展示命中的记忆与技能，不会自动写入新记忆。
                      </div>
                    )}
                  </div>
                </div>

                {hasMemoryRecall && (
                  <div className="mt-4">
                    <div className="mb-2 text-xs font-medium tracking-[0.12em] text-muted-foreground uppercase">
                      召回记忆
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {memoryRecall?.items.slice(0, 2).map((item) => (
                        <button
                          key={item.routePath}
                          type="button"
                          onClick={() =>
                            handleOpenMemoryRecall(
                              item.workspaceFilePath,
                              item.title,
                            )
                          }
                          className="group rounded-2xl border border-border/60 bg-background/80 px-3 py-3 text-left transition-colors hover:border-primary/30 hover:bg-background"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="truncate text-sm font-medium text-foreground">
                              {item.title}
                            </div>
                            <div className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] text-primary">
                              第 {item.recallCount} 次
                            </div>
                          </div>
                          <div className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
                            {item.summary || item.routePath}
                          </div>
                        </button>
                      ))}
                    </div>

                    {(memoryRecall?.totalCount ?? 0) > 2 && (
                      <div className="mt-3 text-xs text-muted-foreground">
                        另有 {(memoryRecall?.totalCount ?? 0) - 2} 条相关记忆已在后台参与召回。
                      </div>
                    )}
                  </div>
                )}

                {hasSkillUsage && (
                  <div className={cn("mt-4", hasMemoryRecall ? "border-t border-border/50 pt-4" : "") }>
                    <div className="mb-2 text-xs font-medium tracking-[0.12em] text-muted-foreground uppercase">
                      使用技能
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {skillUsage?.items.slice(0, 4).map((item) => (
                        <button
                          key={item.skillFilePath}
                          type="button"
                          onClick={() =>
                            void handleOpenUsedSkill(
                              item.folderName,
                              item.skillFilePath,
                              item.title,
                            )
                          }
                          className="group rounded-2xl border border-border/60 bg-background/80 px-3 py-3 text-left transition-colors hover:border-primary/30 hover:bg-background"
                        >
                          <div className="flex items-center gap-2">
                            <div className="truncate text-sm font-medium text-foreground">
                              {item.title}
                            </div>
                            <div className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] text-primary">
                              {item.folderName}
                            </div>
                          </div>
                          <div className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
                            {item.description || "已命中该技能"}
                          </div>
                        </button>
                      ))}
                    </div>

                    {(skillUsage?.totalCount ?? 0) > 4 && (
                      <div className="mt-3 text-xs text-muted-foreground">
                        另有 {(skillUsage?.totalCount ?? 0) - 4} 个技能在本轮回答中被引用。
                      </div>
                    )}
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={handleDismissContextAssist}
                className="rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-background/80 hover:text-foreground"
                aria-label="关闭上下文提示"
              >
                <X className="size-4" />
              </button>
            </div>
          </div>
        )}

        {pendingApproval && (
          <div className="pointer-events-auto w-full max-w-4xl rounded-3xl border border-border bg-background-elevated px-4 py-4 shadow-[0_20px_45px_color-mix(in_srgb,#000_18%,transparent)]">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 text-sm">
                <div className="flex items-start gap-2">
                  <ShieldAlert className="mt-0.5 size-4 shrink-0 text-status-warning" />
                  <div className="min-w-0">
                    <div className="font-medium text-foreground">
                      {t("approval.waitingForConfirmation")}
                      {pendingApprovalCount > 1
                        ? t("approval.multipleToolCalls", {
                            name: pendingApproval.tool_call.name,
                            count: pendingApprovalCount,
                          })
                        : pendingApproval.tool_call.name}
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground break-all">
                      {t("approval.approvalPaused")}
                    </div>
                  </div>
                </div>
              </div>
              <div className="flex shrink-0 justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void handleApprovalDecision("reject")}
                >
                  {t("approval.reject")}
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
                  {t("approval.allowWorkspaceSimilar")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => void handleApprovalDecision("approve")}
                >
                  {t("approval.approveThisTime")}
                </Button>
              </div>
            </div>
          </div>
        )}

        <form
          onSubmit={handleSubmit}
          className="pointer-events-auto relative w-full max-w-4xl"
        >
          {isLoading && <div className="agent-glow-halo" />}
          <div
            className={cn(
              "relative z-0 flex flex-col gap-3 overflow-visible rounded-[26px] border border-border bg-background-elevated px-4 py-4 shadow-[0_20px_45px_color-mix(in_srgb,#000_18%,transparent)] transition-[border-color] duration-300",
              isLoading && "agent-border-glow",
            )}
          >
            {isLoading && <div className="agent-glow-inner-mask" />}
            {isLoading && streamingTips.length > 0 && (
              <div className="animate-soft-fade flex items-center gap-3 overflow-hidden rounded-[18px] border border-border bg-background-elevated px-3 py-2 shadow-none">
                <div className="min-w-0 flex-1">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/90">
                    {t("streaming.jarvisWorking")}
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
                <div className="hidden shrink-0 rounded-full border border-border bg-background-elevated px-2 py-1 text-[10px] font-medium text-muted-foreground sm:block">
                  {pendingApproval
                    ? t("streaming.paused")
                    : isCancelling
                      ? t("streaming.cancelling")
                      : t("streaming.processing")}
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
                      "inline-flex items-center gap-1 rounded-full border border-border bg-background-elevated px-2.5 py-1 text-[11px] font-mono text-muted-foreground hover:bg-background-interactive",
                    )}
                    title={t("clickToRemove")}
                  >
                    {p}
                    <X className="size-3 shrink-0" />
                  </button>
                ))}
              </div>
            )}
            {selectedSkills.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {selectedSkills.map((skill) => (
                  <button
                    key={skill.folderName}
                    type="button"
                    onClick={() =>
                      setSelectedSkills((prev) =>
                        prev.filter((item) => item.folderName !== skill.folderName),
                      )
                    }
                    className="inline-flex items-center gap-1 rounded-full border border-primary/20 bg-primary/10 px-2.5 py-1 text-[11px] text-primary hover:bg-primary/14"
                    title={t("clickToRemove")}
                  >
                    /{skill.folderName}
                    <X className="size-3 shrink-0" />
                  </button>
                ))}
              </div>
            )}
            <div className="relative flex items-end gap-3">
              <div className="min-w-0 flex-1 overflow-hidden rounded-[22px] border border-border bg-background-elevated focus-within:ring-2 focus-within:ring-ring/55">
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
                    if (ta) {
                      parseMentionAtCursor(
                        ta.value,
                        ta.selectionStart ?? ta.value.length,
                      );
                    }
                  }}
                  onKeyDown={handleKeyDown}
                  placeholder={
                    isLoading
                      ? t("inputPlaceholder.loading")
                      : t("inputPlaceholder.idle")
                  }
                  className="chat-input-scrollbar block min-w-0 w-full resize-none border-0 bg-transparent px-4 py-3.5 pr-2 text-sm leading-6 placeholder:text-muted-foreground focus:outline-none"
                  rows={1}
                  style={{
                    minHeight: "48px",
                    maxHeight: "200px",
                    overflowY: "auto",
                  }}
                />
              </div>
              {mentionOpen && mentionCandidates.length > 0 && (
                <div
                  ref={mentionListRef}
                  className="absolute bottom-full left-0 right-14 z-50 mb-3 max-h-56 overflow-y-auto rounded-2xl border border-border bg-popover py-2 shadow-none"
                >
                  {mentionCandidates.map((f, idx) => (
                    <button
                      key={
                        mentionMode === "skill"
                          ? (f as ExplicitSkillSelection).folderName
                          : (f as { path: string }).path
                      }
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
                        if (mentionMode === "skill") {
                          pickMention(
                            (f as ExplicitSkillSelection).folderName,
                          );
                        } else {
                          pickMention((f as { path: string }).path);
                        }
                      }}
                    >
                      {mentionMode === "skill" ? (
                        <>
                          <span className="font-medium">
                            /{(f as ExplicitSkillSelection).folderName}
                          </span>
                          {(f as ExplicitSkillSelection).description ? (
                            <span className="ml-2 text-muted-foreground">
                              {(f as ExplicitSkillSelection).description}
                            </span>
                          ) : null}
                        </>
                      ) : (
                        <>
                          {(f as { is_dir?: boolean }).is_dir ? "📁 " : ""}
                          {(f as { path: string }).path}
                        </>
                      )}
                    </button>
                  ))}
                </div>
              )}
              <div className="flex h-12 shrink-0 items-center justify-center gap-2">
                {isLoading && (
                  <Button
                    type="button"
                    variant="destructive"
                    size="icon"
                    className="rounded-full"
                    onClick={() => void handleCancel()}
                    title={t("streaming.stopGeneration")}
                  >
                    <Square className="size-4" />
                  </Button>
                )}
                {isLoading ? (
                  <Button
                    type="submit"
                    variant="outline"
                    size="icon"
                    disabled={!input.trim()}
                    className="rounded-full"
                    title={t("streaming.interruptSend")}
                  >
                    <Send className="size-4" />
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
            <div className="app-subtle-scroll -mx-1 -my-2 overflow-x-auto overflow-y-hidden px-1 py-2">
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
                      ? t("approval.autoApprovalTitle")
                      : t("approval.manualApprovalTitle")
                  }
                >
                  {approvalMode === "auto" ? (
                    <ShieldCheck className="size-3.5" />
                  ) : (
                    <Shield className="size-3.5" />
                  )}
                  {approvalMode === "auto"
                    ? t("approval.autoApproval")
                    : t("approval.manualApproval")}
                </Button>
                <div className="h-4 w-px shrink-0 bg-border" />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 shrink-0 gap-1 rounded-full px-2.5 text-xs text-muted-foreground hover:translate-y-0"
                  disabled={displayMessages.length === 0}
                  onClick={() => void copyConversationMarkdown()}
                  title={t("copyMarkdownTitle")}
                >
                  <Copy className="size-3.5" />
                  {t("copyMarkdown")}
                </Button>
                <div className="h-4 w-px shrink-0 bg-border" />
                <ContextUsageIndicator
                  tokenUsage={tokenUsage}
                  promptTokenEstimate={promptTokenEstimate}
                  messages={displayMessages}
                  provider={currentModelConfig?.provider}
                  apiFormat={currentModelConfig?.apiFormat}
                  modelId={currentModel}
                  contextWindow={currentModelConfig?.contextWindow}
                  className="shrink-0 rounded-full border border-border bg-background-elevated px-3 py-1"
                />
              </div>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-end gap-2 px-1">
            <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {pendingApproval && (
                <span className="inline-flex items-center gap-2 rounded-full border border-status-warning/30 bg-status-warning/10 px-3 py-1 text-status-warning">
                  <ShieldAlert className="size-3.5" />
                  {t("approval.waitingApproval")}
                </span>
              )}
            </div>
          </div>
        </form>
      </div>

      <Dialog
        open={deleteConfirmMessage !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteConfirmMessage(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("deleteConfirm.title")}</DialogTitle>
            <DialogDescription>
              {t("deleteConfirm.description", {
                role:
                  deleteConfirmMessage?.role === "user"
                    ? t("deleteConfirm.user")
                    : t("deleteConfirm.assistant"),
              })}
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-2xl border border-border/60 bg-background-elevated px-4 py-3 text-sm text-muted-foreground">
            <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.12em] text-foreground/70">
              <PencilLine className="size-3.5" />
              {t("deleteConfirm.targetMessage")}
            </div>
            <p className="whitespace-pre-wrap wrap-break-word text-foreground/85">
              {truncate(
                extractMessageText(
                  deleteConfirmMessage ?? {
                    id: "",
                    role: "assistant",
                    content: "",
                    created_at: new Date(),
                  },
                ) ||
                  (deleteConfirmMessage?.tool_calls?.length
                    ? t("deleteConfirm.hasToolCalls")
                    : t("deleteConfirm.noTextContent")),
                160,
              )}
            </p>
          </div>
          <DialogFooter className="gap-3 sm:gap-3">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setDeleteConfirmMessage(null)}
            >
              {t("cancel", { ns: "common" })}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void executeConfirmedDelete()}
            >
              {t("delete", { ns: "common" })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
