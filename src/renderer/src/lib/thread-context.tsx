import {
  createContext,
  useContext,
  useCallback,
  useMemo,
  useRef,
  useState,
  useEffect,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import i18n from "@/lib/locales";
import { sendDesktopNotification } from "@/lib/notifications";
import { useAppStore } from "@/lib/store";
import {
  appendPersistedTokenUsageStats,
  loadPersistedTokenUsage,
  loadPersistedPromptTokenEstimate,
  persistTokenUsage,
  persistPromptTokenEstimate,
  type TokenUsage,
} from "@/lib/token-usage";

/* eslint-disable react-refresh/only-export-components */
import { useStream } from "@langchain/langgraph-sdk/react";
import { ElectronIPCTransport } from "./electron-transport";
import type {
  ApprovalMode,
  Message,
  Todo,
  FileInfo,
  Subagent,
  HITLRequest,
  ThreadMetadata,
} from "@/types";
import type { DeepAgent } from "../../../main/agent/types";

// Open file tab type
export interface OpenFile {
  path: string;
  name: string;
}

export interface PromptTokenEstimate {
  hiddenPromptTokens: number;
  systemPromptTokens: number;
  filesystemPromptTokens: number;
  referencedPathsTokens: number;
  summarizationMessageTokens: number;
  lastUpdated: Date;
}

function extractMessageText(message: Message): string {
  const content = message.content;
  if (typeof content === "string") {
    return content;
  }

  const contentText = content
    .map((block) => block.text ?? block.content ?? "")
    .filter((value) => value.length > 0)
    .join("\n");
  const toolCallText = message.tool_calls?.length
    ? JSON.stringify(message.tool_calls)
    : "";

  return [contentText, toolCallText].filter((value) => value.length > 0).join("\n");
}

function estimateMessageTokens(message: Message): number {
  const text = extractMessageText(message);
  if (text.trim().length === 0) {
    return 0;
  }

  return Math.max(1, Math.ceil(text.length / 4) + 6);
}

function estimateInputTokensForState(state: ThreadState): number {
  const visibleMessageTokens = state.messages.reduce(
    (sum, message) => sum + estimateMessageTokens(message),
    0,
  );
  const hiddenPromptTokens = state.promptTokenEstimate?.hiddenPromptTokens ?? 0;
  const summarizationMessageTokens =
    state.promptTokenEstimate?.summarizationMessageTokens ?? 0;

  return visibleMessageTokens + hiddenPromptTokens + summarizationMessageTokens;
}

// Per-thread state (persisted/restored from checkpoints)
export interface ThreadState {
  messages: Message[];
  todos: Todo[];
  workspaceFiles: FileInfo[];
  workspacePath: string | null;
  enabledMcpServerIds: string[];
  subagents: Subagent[];
  pendingApprovals: HITLRequest[];
  pendingApproval: HITLRequest | null;
  error: string | null;
  currentModel: string;
  openFiles: OpenFile[];
  activeTab: "agent" | string;
  fileContents: Record<string, string>;
  tokenUsage: TokenUsage | null;
  promptTokenEstimate: PromptTokenEstimate | null;
  draftInput: string;
  approvalMode: ApprovalMode;
  interruptionQueue: Message[];
}

// Stream instance type
type StreamInstance = ReturnType<typeof useStream<DeepAgent>>;

// Stream data that we want to be reactive
interface StreamData {
  messages: StreamInstance["messages"];
  isLoading: boolean;
  stream: StreamInstance | null;
  suppressTaskCompleteNotification: boolean;
}

// Actions available on a thread
export interface ThreadActions {
  appendMessage: (message: Message) => void;
  setMessages: (messages: Message[]) => void;
  setTodos: (todos: Todo[]) => void;
  setWorkspaceFiles: (
    files: FileInfo[] | ((prev: FileInfo[]) => FileInfo[]),
  ) => void;
  setWorkspacePath: (path: string | null) => void;
  setEnabledMcpServerIds: (serverIds: string[]) => void;
  setSubagents: (subagents: Subagent[]) => void;
  setPendingApprovals: (requests: HITLRequest[]) => void;
  setPendingApproval: (request: HITLRequest | null) => void;
  setError: (error: string | null) => void;
  clearError: () => void;
  setCurrentModel: (modelId: string) => void;
  openFile: (path: string, name: string) => void;
  closeFile: (path: string) => void;
  closeOtherFiles: (keepPath: string) => void;
  closeAllFiles: () => void;
  setActiveTab: (tab: "agent" | string) => void;
  setFileContents: (path: string, content: string) => void;
  setDraftInput: (input: string) => void;
  setApprovalMode: (mode: ApprovalMode) => Promise<void>;
  enqueueInterruption: (message: Message) => void;
  clearInterruptionQueue: () => void;
}

// Context value
interface ThreadContextValue {
  getThreadState: (threadId: string) => ThreadState;
  getThreadActions: (threadId: string) => ThreadActions;
  initializeThread: (threadId: string) => void;
  cleanupThread: (threadId: string) => void;
  // Stream subscription
  subscribeToStream: (threadId: string, callback: () => void) => () => void;
  getStreamData: (threadId: string) => StreamData;
  // Get all initialized thread states (for kanban view)
  getAllThreadStates: () => Record<string, ThreadState>;
  // Get all stream loading states (for kanban view)
  getAllStreamLoadingStates: () => Record<string, boolean>;
  // Subscribe to all stream updates
  subscribeToAllStreams: (callback: () => void) => () => void;
}

// Default thread state
const createDefaultThreadState = (): ThreadState => ({
  messages: [],
  todos: [],
  workspaceFiles: [],
  workspacePath: null,
  enabledMcpServerIds: [],
  subagents: [],
  pendingApprovals: [],
  pendingApproval: null,
  error: null,
  currentModel: "",
  openFiles: [],
  activeTab: "agent",
  fileContents: {},
  tokenUsage: null,
  promptTokenEstimate: null,
  draftInput: "",
  approvalMode: "manual",
  interruptionQueue: [],
});

const defaultStreamData: StreamData = {
  messages: [],
  isLoading: false,
  stream: null,
  suppressTaskCompleteNotification: false,
};

const ThreadContext = createContext<ThreadContextValue | null>(null);

// Custom event types from the stream
interface CustomEventData {
  type?: string;
  request?: HITLRequest;
  requests?: HITLRequest[];
  files?: Array<{ path: string; is_dir?: boolean; size?: number }>;
  path?: string;
  subagents?: Array<{
    id?: string;
    name?: string;
    description?: string;
    status?: string;
    startedAt?: Date;
    completedAt?: Date;
  }>;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    cacheReadTokens?: number;
    cacheCreationTokens?: number;
  };
  usageKey?: string;
  estimate?: {
    hiddenPromptTokens?: number;
    systemPromptTokens?: number;
    filesystemPromptTokens?: number;
    referencedPathsTokens?: number;
  };
  summarizationTokens?: number;
}

function mergeTokenUsage(
  current: TokenUsage | null,
  incoming: NonNullable<CustomEventData["usage"]>,
  estimatedInputTokens = 0,
): TokenUsage {
  const inputTokens =
    typeof incoming.inputTokens === "number" && incoming.inputTokens > 0
      ? incoming.inputTokens
      : current?.inputTokens && current.inputTokens > 0
        ? current.inputTokens
        : estimatedInputTokens;
  const outputTokens =
    typeof incoming.outputTokens === "number" && incoming.outputTokens > 0
      ? incoming.outputTokens
      : current?.outputTokens ?? 0;
  const totalTokens = Math.max(
    typeof incoming.totalTokens === "number" ? incoming.totalTokens : 0,
    inputTokens + outputTokens,
    current?.totalTokens ?? 0,
  );

  return {
    inputTokens,
    outputTokens,
    totalTokens,
    cacheReadTokens: incoming.cacheReadTokens ?? current?.cacheReadTokens,
    cacheCreationTokens:
      incoming.cacheCreationTokens ?? current?.cacheCreationTokens,
    lastUpdated: new Date(),
  };
}

// Component that holds a stream and notifies subscribers
function ThreadStreamHolder({
  threadId,
  onStreamUpdate,
  onCustomEvent,
  onError,
}: {
  threadId: string;
  onStreamUpdate: (data: StreamData) => void;
  onCustomEvent: (data: CustomEventData) => void;
  onError: (error: Error) => void;
}): null {
  const transport = useMemo(() => new ElectronIPCTransport(), []);

  // Use refs to avoid stale closures
  const onCustomEventRef = useRef(onCustomEvent);
  useEffect(() => {
    onCustomEventRef.current = onCustomEvent;
  });

  const onErrorRef = useRef(onError);
  useEffect(() => {
    onErrorRef.current = onError;
  });

  const stream = useStream<DeepAgent>({
    transport,
    threadId,
    messagesKey: "messages",
    onCustomEvent: (data) => {
      onCustomEventRef.current(data as CustomEventData);
    },
    onError: (error: unknown) => {
      onErrorRef.current(
        error instanceof Error ? error : new Error(String(error)),
      );
    },
  });

  // Notify parent whenever stream data changes
  // Use refs to avoid stale closures and ensure we always have latest callback
  const onStreamUpdateRef = useRef(onStreamUpdate);
  useEffect(() => {
    onStreamUpdateRef.current = onStreamUpdate;
  });

  // Track previous values to detect actual changes
  const prevMessagesRef = useRef(stream.messages);
  const prevIsLoadingRef = useRef(stream.isLoading);

  // Always sync on mount and when values actually change
  useEffect(() => {
    const messagesChanged = prevMessagesRef.current !== stream.messages;
    const loadingChanged = prevIsLoadingRef.current !== stream.isLoading;

    if (messagesChanged || loadingChanged || !prevMessagesRef.current) {
      prevMessagesRef.current = stream.messages;
      prevIsLoadingRef.current = stream.isLoading;

      onStreamUpdateRef.current({
        messages: stream.messages,
        isLoading: stream.isLoading,
        stream,
        suppressTaskCompleteNotification: false,
      });
    }
  });

  // Also sync immediately when stream instance changes
  useEffect(() => {
    onStreamUpdateRef.current({
      messages: stream.messages,
      isLoading: stream.isLoading,
      stream,
      suppressTaskCompleteNotification: false,
    });
  }, [stream]);

  return null;
}

export function ThreadProvider({ children }: { children: ReactNode }) {
  const [threadStates, setThreadStates] = useState<Record<string, ThreadState>>(
    {},
  );
  const [activeThreadIds, setActiveThreadIds] = useState<Set<string>>(
    new Set(),
  );
  const [loadingStates, setLoadingStates] = useState<Record<string, boolean>>(
    {},
  );
  const initializedThreadsRef = useRef<Set<string>>(new Set());
  const actionsCache = useRef<Record<string, ThreadActions>>({});

  // Stream data store (not React state - we use subscriptions)
  const streamDataRef = useRef<Record<string, StreamData>>({});
  const streamSubscribersRef = useRef<Record<string, Set<() => void>>>({});

  useEffect(() => {
    for (const [threadId, state] of Object.entries(threadStates)) {
      if (state.tokenUsage) {
        persistTokenUsage(threadId, state.tokenUsage);
      }
      if (state.promptTokenEstimate) {
        persistPromptTokenEstimate(threadId, {
          hiddenPromptTokens: state.promptTokenEstimate.hiddenPromptTokens,
          systemPromptTokens: state.promptTokenEstimate.systemPromptTokens,
          filesystemPromptTokens: state.promptTokenEstimate.filesystemPromptTokens,
          referencedPathsTokens: state.promptTokenEstimate.referencedPathsTokens,
          summarizationMessageTokens: state.promptTokenEstimate.summarizationMessageTokens,
          estimatedInputTokens: estimateInputTokensForState(state),
          lastUpdated: state.promptTokenEstimate.lastUpdated.toISOString(),
        });
      }
    }
  }, [threadStates]);

  // Notify subscribers for a thread
  const notifyStreamSubscribers = useCallback((threadId: string) => {
    const subscribers = streamSubscribersRef.current[threadId];
    if (subscribers) {
      subscribers.forEach((callback) => callback());
    }
  }, []);

  // Handle stream updates from ThreadStreamHolder
  const handleStreamUpdate = useCallback(
    (threadId: string, data: StreamData) => {
      const previousData = streamDataRef.current[threadId] || defaultStreamData;
      streamDataRef.current[threadId] = {
        ...data,
        suppressTaskCompleteNotification: data.isLoading
          ? false
          : previousData.suppressTaskCompleteNotification,
      };
      notifyStreamSubscribers(threadId);
      // Update loading states for kanban view
      setLoadingStates((prev) => {
        if (prev[threadId] === data.isLoading) return prev;
        return { ...prev, [threadId]: data.isLoading };
      });
    },
    [notifyStreamSubscribers],
  );

  // Subscribe to stream updates for a thread
  const subscribeToStream = useCallback(
    (threadId: string, callback: () => void) => {
      if (!streamSubscribersRef.current[threadId]) {
        streamSubscribersRef.current[threadId] = new Set();
      }
      streamSubscribersRef.current[threadId].add(callback);

      return () => {
        streamSubscribersRef.current[threadId]?.delete(callback);
      };
    },
    [],
  );

  // Get current stream data for a thread
  const getStreamData = useCallback((threadId: string): StreamData => {
    return streamDataRef.current[threadId] || defaultStreamData;
  }, []);

  const getThreadState = useCallback(
    (threadId: string): ThreadState => {
      const state = threadStates[threadId] || createDefaultThreadState();
      if (state.pendingApproval) {
        console.log(
          "[ThreadContext] getThreadState returning pendingApproval for:",
          threadId,
          state.pendingApproval,
        );
      }
      return state;
    },
    [threadStates],
  );

  const getAllThreadStates = useCallback((): Record<string, ThreadState> => {
    return threadStates;
  }, [threadStates]);

  const getAllStreamLoadingStates = useCallback((): Record<string, boolean> => {
    return loadingStates;
  }, [loadingStates]);

  const subscribeToAllStreams = useCallback(() => {
    return () => {};
  }, []);

  const updateThreadState = useCallback(
    (
      threadId: string,
      updater: (prev: ThreadState) => Partial<ThreadState>,
    ) => {
      setThreadStates((prev) => {
        const currentState = prev[threadId] || createDefaultThreadState();
        const updates = updater(currentState);
        return {
          ...prev,
          [threadId]: { ...currentState, ...updates },
        };
      });
    },
    [],
  );

  // Parse error messages into user-friendly format
  const parseErrorMessage = useCallback((error: Error | string): string => {
    const errorMessage = typeof error === "string" ? error : error.message;

    // Check for context window exceeded errors
    const contextWindowMatch = errorMessage.match(
      /prompt is too long: (\d+) tokens > (\d+) maximum/i,
    );
    if (contextWindowMatch) {
      const [, usedTokens, maxTokens] = contextWindowMatch;
      const usedK = Math.round(parseInt(usedTokens) / 1000);
      const maxK = Math.round(parseInt(maxTokens) / 1000);
      return i18n.t("chat:error.contextWindowFull", { usedK, maxK });
    }

    // Check for rate limit errors
    if (errorMessage.includes("rate_limit") || errorMessage.includes("429")) {
      return i18n.t("chat:error.rateLimited");
    }

    // Check for authentication errors
    if (
      errorMessage.includes("401") ||
      errorMessage.includes("invalid_api_key") ||
      errorMessage.includes("authentication")
    ) {
      return i18n.t("chat:error.authFailed");
    }

    // Return the original message for other errors
    return errorMessage;
  }, []);

  // Handle errors from ThreadStreamHolder
  const handleError = useCallback(
    (threadId: string, error: Error) => {
      console.error("[ThreadContext] Stream error:", { threadId, error });
      const userFriendlyMessage = parseErrorMessage(error);
      updateThreadState(threadId, () => ({ error: userFriendlyMessage }));
    },
    [parseErrorMessage, updateThreadState],
  );

  // Handle custom events from ThreadStreamHolder (interrupts, workspace updates, etc.)
  const handleCustomEvent = useCallback(
    (threadId: string, data: CustomEventData) => {
      console.log("[ThreadContext] Custom event received:", {
        threadId,
        type: data.type,
        data,
      });
      switch (data.type) {
        case "interrupt":
          {
            const requests =
              data.requests && data.requests.length > 0
                ? data.requests
                : data.request
                  ? [data.request]
                  : [];

            if (requests.length === 0) {
              break;
            }

            const currentStreamData =
              streamDataRef.current[threadId] || defaultStreamData;
            streamDataRef.current[threadId] = {
              ...currentStreamData,
              suppressTaskCompleteNotification: true,
            };
            notifyStreamSubscribers(threadId);

            void Promise.all(
              requests.map((request) =>
                window.api.approval.shouldAutoApprove(threadId, request),
              ),
            )
              .then(async (results) => {
                if (!results.every((result) => result.approved)) {
                  console.log(
                    "[ThreadContext] Setting pendingApprovals for thread:",
                    threadId,
                    requests,
                  );
                  const s = useAppStore.getState();
                  sendDesktopNotification(
                    i18n.t("notification.permissionRequest", { ns: "chat" }),
                    i18n.t("notification.permissionRequestBody", { ns: "chat" }),
                    {
                      force: true,
                      playSound: true,
                      soundType: "permissionRequest",
                      sounds: s.notificationSounds,
                      soundEnabled: s.notificationSoundEnabled,
                      notificationsEnabled: s.notificationsEnabled,
                    },
                  );
                  updateThreadState(threadId, () => ({
                    pendingApprovals: requests,
                  pendingApproval: requests[0] ?? null,
                  }));
                  return;
                }

                const stream = streamDataRef.current[threadId]?.stream;
                if (!stream) {
                  updateThreadState(threadId, () => ({
                    pendingApprovals: requests,
                    pendingApproval: requests[0] ?? null,
                  }));
                  return;
                }

                await stream.submit(null, {
                  command: {
                    resume: {
                      decision: "approve",
                      request: requests[0],
                      requests,
                    },
                  },
                  config: { configurable: { thread_id: threadId } },
                });
              })
              .catch((error) => {
                console.error(
                  "[ThreadContext] Auto-approval check failed:",
                  error,
                );
                updateThreadState(threadId, () => ({
                  pendingApprovals: requests,
                  pendingApproval: requests[0] ?? null,
                }));
              });
          }
          break;
        case "workspace":
          if (Array.isArray(data.files)) {
            const files = data.files;
            updateThreadState(threadId, (state) => {
              const fileMap = new Map(
                state.workspaceFiles.map((f) => [f.path, f]),
              );
              for (const f of files) {
                fileMap.set(f.path, {
                  path: f.path,
                  is_dir: f.is_dir,
                  size: f.size,
                });
              }
              return { workspaceFiles: Array.from(fileMap.values()) };
            });
          }
          if (data.path) {
            updateThreadState(threadId, () => ({ workspacePath: data.path }));
          }
          break;
        case "subagents":
          if (Array.isArray(data.subagents)) {
            updateThreadState(threadId, () => ({
              subagents: data.subagents?.map((s) => ({
                id: s.id || crypto.randomUUID(),
                name: s.name || "Subagent",
                description: s.description || "",
                status: (s.status || "pending") as
                  | "pending"
                  | "running"
                  | "completed"
                  | "failed",
                startedAt: s.startedAt,
                completedAt: s.completedAt,
              })),
            }));
          }
          break;
        case "token_usage":
          {
            const usage = data.usage;
            if (
              !usage ||
              !((typeof usage.inputTokens === "number" && usage.inputTokens > 0) ||
                (typeof usage.outputTokens === "number" && usage.outputTokens > 0) ||
                (typeof usage.totalTokens === "number" && usage.totalTokens > 0))
            ) {
              break;
            }
            console.log("[ThreadContext] Token usage update:", {
              threadId,
              inputTokens: usage.inputTokens,
              outputTokens: usage.outputTokens,
              totalTokens: usage.totalTokens,
            });
            updateThreadState(threadId, (currentState) => {
              const nextUsage = mergeTokenUsage(
                currentState.tokenUsage,
                usage,
                estimateInputTokensForState(currentState),
              );
              appendPersistedTokenUsageStats(threadId, nextUsage, data.usageKey);
              return {
                tokenUsage: nextUsage,
              };
            });
          }
          break;
        case "prompt_token_estimate":
          if (typeof data.estimate?.hiddenPromptTokens === "number") {
            const estimate = data.estimate;
            const hiddenPromptTokens = data.estimate.hiddenPromptTokens;
            if (hiddenPromptTokens <= 0) {
              break;
            }
            updateThreadState(threadId, (currentState) => ({
              promptTokenEstimate: {
                hiddenPromptTokens,
                systemPromptTokens: estimate.systemPromptTokens ?? 0,
                filesystemPromptTokens:
                  estimate.filesystemPromptTokens ?? 0,
                referencedPathsTokens:
                  estimate.referencedPathsTokens ?? 0,
                summarizationMessageTokens:
                  currentState.promptTokenEstimate?.summarizationMessageTokens ??
                  0,
                lastUpdated: new Date(),
              },
            }));
          }
          break;
        case "summarization_token_estimate":
          if (typeof data.summarizationTokens === "number") {
            const summarizationTokens = data.summarizationTokens;
            updateThreadState(threadId, (currentState) => ({
              promptTokenEstimate: {
                hiddenPromptTokens:
                  currentState.promptTokenEstimate?.hiddenPromptTokens ?? 0,
                systemPromptTokens:
                  currentState.promptTokenEstimate?.systemPromptTokens ?? 0,
                filesystemPromptTokens:
                  currentState.promptTokenEstimate?.filesystemPromptTokens ?? 0,
                referencedPathsTokens:
                  currentState.promptTokenEstimate?.referencedPathsTokens ?? 0,
                summarizationMessageTokens: summarizationTokens,
                lastUpdated: new Date(),
              },
            }));
          }
          break;
      }
    },
    [notifyStreamSubscribers, updateThreadState],
  );

  const getThreadActions = useCallback(
    (threadId: string): ThreadActions => {
      if (actionsCache.current[threadId]) {
        return actionsCache.current[threadId];
      }

      const actions: ThreadActions = {
        appendMessage: (message: Message) => {
          updateThreadState(threadId, (state) => {
            const exists = state.messages.some((m) => m.id === message.id);
            if (exists) {
              return {
                messages: state.messages.map((m) =>
                  m.id === message.id ? message : m,
                ),
              };
            }
            return { messages: [...state.messages, message] };
          });
        },
        setMessages: (messages: Message[]) => {
          updateThreadState(threadId, () => ({ messages }));
        },
        setTodos: (todos: Todo[]) => {
          updateThreadState(threadId, () => ({ todos }));
        },
        setWorkspaceFiles: (
          files: FileInfo[] | ((prev: FileInfo[]) => FileInfo[]),
        ) => {
          updateThreadState(threadId, (state) => ({
            workspaceFiles:
              typeof files === "function" ? files(state.workspaceFiles) : files,
          }));
        },
        setWorkspacePath: (path: string | null) => {
          updateThreadState(threadId, () => ({ workspacePath: path }));
          void window.api.workspace.set(undefined, path);
        },
        setEnabledMcpServerIds: (serverIds: string[]) => {
          const nextIds = Array.from(
            new Set(
              serverIds.map((id) => id.trim()).filter((id) => id.length > 0),
            ),
          );
          updateThreadState(threadId, () => ({ enabledMcpServerIds: nextIds }));
          void window.api.mcp.setEnabledForThread(undefined, nextIds);
        },
        setSubagents: (subagents: Subagent[]) => {
          updateThreadState(threadId, () => ({ subagents }));
        },
        setPendingApprovals: (requests: HITLRequest[]) => {
          updateThreadState(threadId, () => ({
            pendingApprovals: requests,
            pendingApproval: requests[0] ?? null,
          }));
        },
        setPendingApproval: (request: HITLRequest | null) => {
          updateThreadState(threadId, () => ({
            pendingApprovals: request ? [request] : [],
            pendingApproval: request,
          }));
        },
        setError: (error: string | null) => {
          updateThreadState(threadId, () => ({ error }));
        },
        clearError: () => {
          updateThreadState(threadId, () => ({ error: null }));
        },
        setCurrentModel: (modelId: string) => {
          updateThreadState(threadId, () => ({ currentModel: modelId }));
          void window.api.models.setDefault(modelId);
          void (async () => {
            try {
              const thread = await window.api.threads.get(threadId);
              const metadata = (thread?.metadata ?? {}) as ThreadMetadata;
              await window.api.threads.update(threadId, {
                metadata: {
                  ...metadata,
                  model: modelId,
                },
              });
            } catch (error) {
              console.error(
                "[ThreadContext] Failed to persist current model:",
                error,
              );
            }
          })();
        },
        openFile: (path: string, name: string) => {
          updateThreadState(threadId, (state) => {
            if (state.openFiles.some((f) => f.path === path)) {
              return { activeTab: path };
            }
            return {
              openFiles: [...state.openFiles, { path, name }],
              activeTab: path,
            };
          });
        },
        closeFile: (path: string) => {
          updateThreadState(threadId, (state) => {
            const newOpenFiles = state.openFiles.filter((f) => f.path !== path);
            const newFileContents = { ...state.fileContents };
            delete newFileContents[path];
            let newActiveTab = state.activeTab;
            if (state.activeTab === path) {
              const closedIndex = state.openFiles.findIndex(
                (f) => f.path === path,
              );
              if (newOpenFiles.length === 0) newActiveTab = "agent";
              else if (closedIndex > 0)
                newActiveTab = newOpenFiles[closedIndex - 1].path;
              else newActiveTab = newOpenFiles[0].path;
            }
            return {
              openFiles: newOpenFiles,
              activeTab: newActiveTab,
              fileContents: newFileContents,
            };
          });
        },
        closeOtherFiles: (keepPath: string) => {
          updateThreadState(threadId, (state) => {
            const openFiles = state.openFiles.filter(
              (f) => f.path === keepPath,
            );
            const fileContents: Record<string, string> = {};
            if (state.fileContents[keepPath] !== undefined) {
              fileContents[keepPath] = state.fileContents[keepPath];
            }
            return {
              openFiles,
              activeTab: keepPath,
              fileContents,
            };
          });
        },
        closeAllFiles: () => {
          updateThreadState(threadId, () => ({
            openFiles: [],
            activeTab: "agent",
            fileContents: {},
          }));
        },
        setActiveTab: (tab: "agent" | string) => {
          updateThreadState(threadId, () => ({ activeTab: tab }));
        },
        setFileContents: (path: string, content: string) => {
          updateThreadState(threadId, (state) => ({
            fileContents: { ...state.fileContents, [path]: content },
          }));
        },
        setDraftInput: (input: string) => {
          updateThreadState(threadId, () => ({ draftInput: input }));
        },
        setApprovalMode: async (mode: ApprovalMode) => {
          updateThreadState(threadId, () => ({ approvalMode: mode }));
          await window.api.approval.setMode(threadId, mode);
        },
        enqueueInterruption: (message: Message) => {
          updateThreadState(threadId, (state) => ({
            interruptionQueue: [...state.interruptionQueue, message],
          }));
        },
        clearInterruptionQueue: () => {
          updateThreadState(threadId, () => ({ interruptionQueue: [] }));
        },
      };

      actionsCache.current[threadId] = actions;
      return actions;
    },
    [updateThreadState],
  );

  const loadThreadHistory = useCallback(
    async (threadId: string) => {
      const actions = getThreadActions(threadId);

      // Load global settings and mirror them into the current thread view.
      try {
        const [thread, workspacePath, defaultModel, enabledMcpServerIds, approvalMode] =
          await Promise.all([
            window.api.threads.get(threadId),
            window.api.workspace.get(threadId),
            window.api.models.getDefault(),
            window.api.mcp.getEnabledForThread(threadId),
            window.api.approval.getMode(threadId),
          ]);

        const metadata = (thread?.metadata ?? {}) as ThreadMetadata;
        const currentModel =
          typeof metadata.model === "string" && metadata.model.length > 0
            ? metadata.model
            : defaultModel;

        if (workspacePath) {
          updateThreadState(threadId, () => ({ workspacePath }));
          const diskResult = await window.api.workspace.loadFromDisk(threadId);
          if (diskResult.success) {
            actions.setWorkspaceFiles(diskResult.files);
          }
        }

        updateThreadState(threadId, () => ({
          currentModel,
          enabledMcpServerIds,
          approvalMode,
        }));
      } catch (error) {
        console.error("[ThreadContext] Failed to load thread details:", error);
      }

      // Load thread history from checkpoints
      try {
        const history = await window.api.threads.getHistory(threadId);
        if (history.length > 0) {
          const latestCheckpoint = history[0] as {
            checkpoint?: {
              channel_values?: {
                messages?: Array<{
                  id?: string;
                  _getType?: () => string;
                  type?: string;
                  content?: string | unknown[];
                  tool_calls?: unknown[];
                  tool_call_id?: string;
                  name?: string;
                  status?: string;
                  is_error?: boolean;
                }>;
                todos?: Array<{
                  id?: string;
                  content?: string;
                  status?: string;
                }>;
                __interrupt__?: Array<{
                  value?: {
                    actionRequests?: Array<{
                      id?: string;
                      action?: string;
                      name?: string;
                      args?: Record<string, unknown>;
                    }>;
                    reviewConfigs?: Array<{
                      actionName?: string;
                      allowedDecisions?: HITLRequest["allowed_decisions"];
                      toolName?: string;
                      toolArgs?: Record<string, unknown>;
                    }>;
                  };
                }>;
              };
            };
            pending_sends?: Array<unknown>;
          };

          const channelValues = latestCheckpoint.checkpoint?.channel_values;

          if (
            channelValues?.messages &&
            Array.isArray(channelValues.messages)
          ) {
            const messages: Message[] = channelValues.messages.map(
              (msg, index) => {
                let role: "user" | "assistant" | "system" | "tool" =
                  "assistant";
                if (typeof msg._getType === "function") {
                  const type = msg._getType();
                  if (type === "human") role = "user";
                  else if (type === "ai") role = "assistant";
                  else if (type === "system") role = "system";
                  else if (type === "tool") role = "tool";
                } else if (msg.type) {
                  if (msg.type === "human") role = "user";
                  else if (msg.type === "ai") role = "assistant";
                  else if (msg.type === "system") role = "system";
                  else if (msg.type === "tool") role = "tool";
                }

                let content: Message["content"] = "";
                if (typeof msg.content === "string") content = msg.content;
                else if (Array.isArray(msg.content))
                  content = msg.content as Message["content"];

                return {
                  id: msg.id || `msg-${index}`,
                  role,
                  content,
                  tool_calls: msg.tool_calls as Message["tool_calls"],
                  ...(role === "tool" &&
                    msg.tool_call_id && { tool_call_id: msg.tool_call_id }),
                  ...(role === "tool" && msg.name && { name: msg.name }),
                  ...(role === "tool" &&
                  (msg.is_error === true || msg.status === "error")
                    ? { is_error: true }
                    : {}),
                  created_at: new Date(),
                };
              },
            );
            actions.setMessages(messages);
          }

          if (channelValues?.todos && Array.isArray(channelValues.todos)) {
            const todos: Todo[] = channelValues.todos.map((todo, index) => ({
              id: todo.id || `todo-${index}`,
              content: todo.content || "",
              status: (todo.status as Todo["status"]) || "pending",
            }));
            actions.setTodos(todos);
          }

          // Restore interrupt state if present
          const interruptData = channelValues?.__interrupt__;
          if (
            interruptData &&
            Array.isArray(interruptData) &&
            interruptData.length > 0
          ) {
            const interruptValue = interruptData[0]?.value;
            const actionRequests = interruptValue?.actionRequests;
            const reviewConfigs = interruptValue?.reviewConfigs;

            if (actionRequests && actionRequests.length > 0) {
              // New langchain HITL format
              const hitlRequests: HITLRequest[] = actionRequests.map((req) => {
                const actionName =
                  typeof req.action === "string" && req.action.length > 0
                    ? req.action
                    : typeof req.name === "string" && req.name.length > 0
                      ? req.name
                      : "execute";
                const reviewConfig = reviewConfigs?.find(
                  (config) => config.actionName === actionName,
                );
                const toolCallId =
                  typeof req.id === "string" && req.id.length > 0
                    ? req.id
                    : crypto.randomUUID();

                return {
                  id: toolCallId,
                  tool_call: {
                    id: toolCallId,
                    name: actionName,
                    args: req.args || {},
                  },
                  allowed_decisions: reviewConfig?.allowedDecisions || [
                    "approve",
                    "reject",
                    "edit",
                  ],
                };
              });
              actions.setPendingApprovals(hitlRequests);
            } else if (reviewConfigs && reviewConfigs.length > 0) {
              // Alternative format
              const config = reviewConfigs[0];
              const hitlRequest: HITLRequest = {
                id: crypto.randomUUID(),
                tool_call: {
                  id: crypto.randomUUID(),
                  name: config.toolName || "execute",
                  args: config.toolArgs || {},
                },
                allowed_decisions:
                  config.allowedDecisions || ["approve", "reject", "edit"],
              };
              actions.setPendingApprovals([hitlRequest]);
            }
          }
        }
      } catch (error) {
        console.error("[ThreadContext] Failed to load thread history:", error);
      }
    },
    [getThreadActions, updateThreadState],
  );

  const initializeThread = useCallback(
    (threadId: string) => {
      if (initializedThreadsRef.current.has(threadId)) return;
      initializedThreadsRef.current.add(threadId);

      // Add to active threads (this will render a ThreadStreamHolder)
      setActiveThreadIds((prev) => new Set([...prev, threadId]));

      setThreadStates((prev) => {
        if (prev[threadId]) return prev;
        return {
          ...prev,
          [threadId]: {
            ...createDefaultThreadState(),
            tokenUsage: loadPersistedTokenUsage(threadId),
            promptTokenEstimate: (() => {
              const persisted = loadPersistedPromptTokenEstimate(threadId);
              return persisted
                ? {
                    hiddenPromptTokens: persisted.hiddenPromptTokens,
                    systemPromptTokens: persisted.systemPromptTokens,
                    filesystemPromptTokens: persisted.filesystemPromptTokens,
                    referencedPathsTokens: persisted.referencedPathsTokens,
                    summarizationMessageTokens:
                      persisted.summarizationMessageTokens,
                    lastUpdated: new Date(persisted.lastUpdated),
                  }
                : null;
            })(),
          },
        };
      });

      loadThreadHistory(threadId);
    },
    [loadThreadHistory],
  );

  const cleanupThread = useCallback((threadId: string) => {
    initializedThreadsRef.current.delete(threadId);
    delete actionsCache.current[threadId];
    delete streamDataRef.current[threadId];
    delete streamSubscribersRef.current[threadId];
    setActiveThreadIds((prev) => {
      const next = new Set(prev);
      next.delete(threadId);
      return next;
    });
    setThreadStates((prev) => {
      const { [threadId]: _removed, ...rest } = prev;
      void _removed; // Explicitly mark as intentionally unused
      return rest;
    });
  }, []);

  const contextValue = useMemo<ThreadContextValue>(
    () => ({
      getThreadState,
      getThreadActions,
      initializeThread,
      cleanupThread,
      subscribeToStream,
      getStreamData,
      getAllThreadStates,
      getAllStreamLoadingStates,
      subscribeToAllStreams,
    }),
    [
      getThreadState,
      getThreadActions,
      initializeThread,
      cleanupThread,
      subscribeToStream,
      getStreamData,
      getAllThreadStates,
      getAllStreamLoadingStates,
      subscribeToAllStreams,
    ],
  );

  return (
    <ThreadContext.Provider value={contextValue}>
      {/* Render stream holders for all active threads */}
      {Array.from(activeThreadIds).map((threadId) => (
        <ThreadStreamHolder
          key={threadId}
          threadId={threadId}
          onStreamUpdate={(data) => handleStreamUpdate(threadId, data)}
          onCustomEvent={(data) => handleCustomEvent(threadId, data)}
          onError={(error) => handleError(threadId, error)}
        />
      ))}
      {children}
    </ThreadContext.Provider>
  );
}

export function useThreadContext(): ThreadContextValue {
  const context = useContext(ThreadContext);
  if (!context)
    throw new Error("useThreadContext must be used within a ThreadProvider");
  return context;
}

// Hook to subscribe to stream data for a thread using useSyncExternalStore
export function useThreadStream(threadId: string): StreamData {
  const context = useThreadContext();

  const subscribe = useCallback(
    (callback: () => void) => context.subscribeToStream(threadId, callback),
    [context, threadId],
  );

  const getSnapshot = useCallback(
    () => context.getStreamData(threadId),
    [context, threadId],
  );

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

// Hook to access current thread's state and actions
export function useCurrentThread(
  threadId: string,
): ThreadState & ThreadActions {
  const context = useThreadContext();

  useEffect(() => {
    context.initializeThread(threadId);
  }, [threadId, context]);

  const state = context.getThreadState(threadId);
  const actions = context.getThreadActions(threadId);

  return { ...state, ...actions };
}

// Hook for nullable threadId
export function useThreadState(
  threadId: string | null,
): (ThreadState & ThreadActions) | null {
  const context = useThreadContext();

  useEffect(() => {
    if (threadId) context.initializeThread(threadId);
  }, [threadId, context]);

  if (!threadId) return null;

  const state = context.getThreadState(threadId);
  const actions = context.getThreadActions(threadId);

  return { ...state, ...actions };
}

// Hook to get all initialized thread states (for kanban view)
export function useAllThreadStates(): Record<string, ThreadState> {
  const context = useThreadContext();
  return context.getAllThreadStates();
}

// Hook to get all stream loading states with reactivity
export function useAllStreamLoadingStates(): Record<string, boolean> {
  const context = useThreadContext();
  return context.getAllStreamLoadingStates();
}
