import {BrowserWindow, IpcMain} from "electron";
import Store from "electron-store";
import {HumanMessage} from "@langchain/core/messages";
import type {StreamMode} from "@langchain/langgraph";
import {Command} from "@langchain/langgraph";
import {
  buildReferencedPathsPrompt,
  createAgentRuntime,
  estimateHiddenPromptTokens,
  getBackgroundTaskModel,
} from "../agent/runtime";
import {rememberWorkspaceApproval} from "../approval-settings";
import {getThread} from "../db";
import {consolidateTaskMemory} from "../services/memory-service";
import {getOpenworkDir} from "../storage";
import {logError, logInfo, logWarn} from "../logger";
import type {AgentCancelParams, AgentInterruptParams, AgentInvokeParams, AgentResumeParams,} from "../types";

// Track active runs for cancellation
const activeRuns = new Map<string, AbortController>();
const conversationLogSignatures = new Map<string, Set<string>>();
const DEFAULT_STREAM_MODES: StreamMode[] = ["messages", "values"];
const store = new Store({
  name: "settings",
  cwd: getOpenworkDir(),
});

function getConversationLogCache(threadId: string): Set<string> {
  let cache = conversationLogSignatures.get(threadId);
  if (!cache) {
    cache = new Set<string>();
    conversationLogSignatures.set(threadId, cache);
  }
  return cache;
}

function stringifyConversationContent(content: unknown): string {
  if (typeof content === "string") {
    return content.trim();
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") {
          return part.trim();
        }
        if (!part || typeof part !== "object") {
          return "";
        }

        const record = part as Record<string, unknown>;
        if (typeof record.text === "string") {
          return record.text.trim();
        }
        if (typeof record.content === "string") {
          return record.content.trim();
        }
        if (typeof record.reasoning === "string") {
          return record.reasoning.trim();
        }
        if (typeof record.thinking === "string") {
          return record.thinking.trim();
        }
        return "";
      })
      .filter((value) => value.length > 0)
      .join("\n")
      .trim();
  }

  if (content && typeof content === "object") {
    const record = content as Record<string, unknown>;
    if (typeof record.text === "string") {
      return record.text.trim();
    }
    if (typeof record.content === "string") {
      return record.content.trim();
    }
    try {
      return JSON.stringify(content);
    } catch {
      return String(content);
    }
  }

  return "";
}

function extractConversationReasoning(record: Record<string, unknown>): string {
  const directCandidates: unknown[] = [
    record.reasoning_content,
    record.reasoning,
    record.thinking,
    record.think,
  ];

  for (const candidate of directCandidates) {
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }

  const nestedContainers: unknown[] = [
    record.additional_kwargs,
    record.kwargs,
    record.response_metadata,
    record.metadata,
  ];

  for (const container of nestedContainers) {
    if (!container || typeof container !== "object") {
      continue;
    }

    const nested = container as Record<string, unknown>;
    const nestedReasoning =
      nested.reasoning_content ?? nested.reasoning ?? nested.thinking ?? nested.think;

    if (typeof nestedReasoning === "string" && nestedReasoning.trim().length > 0) {
      return nestedReasoning.trim();
    }
  }

  return "";
}

function summarizeToolCalls(toolCalls: unknown): string {
  if (!Array.isArray(toolCalls) || toolCalls.length === 0) {
    return "";
  }

  return toolCalls
    .map((toolCall) => {
      if (!toolCall || typeof toolCall !== "object") {
        return "tool";
      }
      const record = toolCall as Record<string, unknown>;
      return typeof record.name === "string"
          ? record.name
          : typeof (record.function as { name?: unknown } | undefined)?.name ===
          "string"
              ? String((record.function as { name?: unknown }).name)
              : "tool";
    })
    .join(", ");
}

function logConversationMessage(threadId: string, role: string, content: string): void {
  const normalized = content.trim();
  if (normalized.length === 0) {
    return;
  }
  console.log(`[Chat][${threadId}][${role}] ${normalized}`);
}

function logConversationMessagesFromValues(threadId: string, data: unknown): void {
  if (!data || typeof data !== "object") {
    return;
  }

  const state = data as {
    messages?: Array<{
      id?: unknown;
      kwargs?: Record<string, unknown>;
    }>;
  };

  if (!Array.isArray(state.messages) || state.messages.length === 0) {
    return;
  }

  const cache = getConversationLogCache(threadId);

  for (const message of state.messages) {
    const kwargs = message.kwargs ?? {};
    const classId = Array.isArray(message.id) ? message.id : [];
    const className = classId[classId.length - 1] || "";

    if (className.includes("Human")) {
      continue;
    }

    const role = className.includes("Tool") ? "tool" : "assistant";
    const reasoning = extractConversationReasoning(kwargs);
    const content = stringifyConversationContent(kwargs.content);
    const toolCallSummary = summarizeToolCalls(kwargs.tool_calls);
    const answerContent =
      content || (toolCallSummary.length > 0 ? `tool_calls: ${toolCallSummary}` : "");
    const printableContent = [
      reasoning.length > 0 ? `<think>\n${reasoning}\n</think>` : "",
      answerContent,
    ]
      .filter((value) => value.length > 0)
      .join("\n")
      .trim();

    if (printableContent.length === 0) {
      continue;
    }

    const signature = [
      role,
      typeof kwargs.id === "string" ? kwargs.id : "",
      typeof kwargs.tool_call_id === "string" ? kwargs.tool_call_id : "",
      typeof kwargs.name === "string" ? kwargs.name : "",
      printableContent,
    ].join("::");

    if (cache.has(signature)) {
      continue;
    }

    cache.add(signature);
    const prefix =
      role === "tool" && typeof kwargs.name === "string"
        ? `${kwargs.name}: ${printableContent}`
        : printableContent;
    logConversationMessage(threadId, role, prefix);
  }
}

export function registerAgentHandlers(ipcMain: IpcMain): void {
  logInfo("Agent", "Registering agent handlers");

  // Handle agent invocation with streaming
  ipcMain.on(
    "agent:invoke",
    async (
      event,
      { threadId, message, modelId, referencedPaths }: AgentInvokeParams,
    ) => {
      const requestStartedAt = Date.now();
      const channel = `agent:stream:${threadId}`;
      const window = BrowserWindow.fromWebContents(event.sender);

      logInfo("Agent", "Received invoke request", {
        threadId,
        message: message.substring(0, 50),
        modelId,
        referencedPathsCount: referencedPaths?.length ?? 0,
      });
      logConversationMessage(threadId, "user", message);

      if (!window) {
        logError("Agent", "No window found for invoke", { threadId });
        return;
      }

      // Abort any existing stream for this thread before starting a new one
      // This prevents concurrent streams which can cause checkpoint corruption
      const existingController = activeRuns.get(threadId);
      if (existingController) {
        logWarn("Agent", "Aborting existing stream before invoke", { threadId });
        existingController.abort();
        activeRuns.delete(threadId);
      }

      const abortController = new AbortController();
      activeRuns.set(threadId, abortController);

      // Abort the stream if the window is closed/destroyed
      const onWindowClosed = (): void => {
        logWarn("Agent", "Window closed, aborting stream", { threadId });
        abortController.abort();
      };
      window.once("closed", onWindowClosed);

      try {
        // Get workspace path from thread metadata - REQUIRED
        const thread = getThread(threadId);
        const metadata = thread?.metadata ? JSON.parse(thread.metadata) : {};
        logInfo("Agent", "Resolved thread metadata", { threadId, metadata });

        const workspacePath =
          (metadata.workspacePath as string | undefined) ||
          (store.get("workspacePath", null) as string | null) ||
          undefined;

        if (!workspacePath) {
          window.webContents.send(channel, {
            type: "error",
            error: "WORKSPACE_REQUIRED",
            message:
              "Please select a workspace folder before sending messages.",
          });
          return;
        }

        window.webContents.send(channel, {
          type: "custom",
          data: {
            type: "prompt_token_estimate",
            estimate: estimateHiddenPromptTokens({
              workspacePath,
              referencedPaths,
            }),
          },
        });

        const agent = await createAgentRuntime({
          threadId,
          workspacePath,
          modelId,
        });
        logInfo("Agent", "Runtime ready, creating stream", {
          threadId,
          elapsedMs: Date.now() - requestStartedAt,
        });
        let text = message;
        const referencedPathsPrompt = buildReferencedPathsPrompt(referencedPaths);
        if (referencedPathsPrompt.length > 0) {
          text = `${referencedPathsPrompt}${message}`;
        }
        const humanMessage = new HumanMessage(text);

        // Stream with both modes:
        // - 'messages' for real-time token streaming
        // - 'values' for full state (todos, files, etc.)
        const stream = await agent.stream(
          { messages: [humanMessage] },
          {
            configurable: { thread_id: threadId },
            signal: abortController.signal,
            streamMode: ["messages", "values"],
            recursionLimit: 1000,
          },
        );
        logInfo("Agent", "Stream created", {
          threadId,
          elapsedMs: Date.now() - requestStartedAt,
        });

        let chunkCount = 0;
        let lastValuesState: unknown = null;

        for await (const chunk of stream) {
          if (abortController.signal.aborted) break;

          chunkCount += 1;

          // With multiple stream modes, chunks are tuples: [mode, data]
          const [mode, data] = chunk as [string, unknown];

          if (chunkCount <= 5 || chunkCount % 25 === 0) {
            logInfo("Agent", "Forwarding stream chunk", {
              threadId,
              chunkCount,
              mode,
              elapsedMs: Date.now() - requestStartedAt,
            });
          }

          if (mode === "values") {
            lastValuesState = JSON.parse(JSON.stringify(data));
            logConversationMessagesFromValues(threadId, data);
          }

          // Forward raw stream events - transport layer handles parsing
          // Serialize to plain objects for IPC (class instances don't transfer)
          window.webContents.send(channel, {
            type: "stream",
            mode,
            data: JSON.parse(JSON.stringify(data)),
          });
        }

        // Send done event (only if not aborted)
        if (!abortController.signal.aborted) {
          if (lastValuesState) {
            try {
              const consolidation = await consolidateTaskMemory({
                threadId,
                workspacePath,
                model: getBackgroundTaskModel(modelId),
                state: lastValuesState,
                trigger: "invoke",
              });
              if (consolidation.recallSnapshot) {
                event.sender.send(channel, {
                  type: "custom",
                  data: {
                    type: "memory_recall",
                    memoryRecall: consolidation.recallSnapshot,
                  },
                });
              }
              if (consolidation.promotionCandidate) {
                event.sender.send(channel, {
                  type: "custom",
                  data: {
                    type: "memory_promotion_candidate",
                    candidate: consolidation.promotionCandidate,
                  },
                });
              }
            } catch (memoryError) {
              logWarn("Agent", "Task memory consolidation failed after invoke", {
                threadId,
                error:
                  memoryError instanceof Error
                    ? memoryError.message
                    : String(memoryError),
              });
            }
          }

          logInfo("Agent", "Invoke stream completed", {
            threadId,
            chunkCount,
            elapsedMs: Date.now() - requestStartedAt,
          });
          window.webContents.send(channel, { type: "done" });
        }
      } catch (error) {
        // Ignore abort-related errors (expected when stream is cancelled)
        const isAbortError =
          error instanceof Error &&
          (error.name === "AbortError" ||
            error.message.includes("aborted") ||
            error.message.includes("Controller is already closed"));

        if (!isAbortError) {
          logError("Agent", "Invoke error", {
            threadId,
            elapsedMs: Date.now() - requestStartedAt,
            error,
          });
          window.webContents.send(channel, {
            type: "error",
            error: error instanceof Error ? error.message : "Unknown error",
          });
        } else {
          logWarn("Agent", "Invoke aborted", {
            threadId,
            elapsedMs: Date.now() - requestStartedAt,
          });
        }
      } finally {
        window.removeListener("closed", onWindowClosed);
        activeRuns.delete(threadId);
        logInfo("Agent", "Invoke cleanup complete", { threadId });
      }
    },
  );

  // Handle agent resume (after interrupt approval/rejection via useStream)
  ipcMain.on(
    "agent:resume",
    async (event, { threadId, command, modelId }: AgentResumeParams) => {
      const requestStartedAt = Date.now();
      const channel = `agent:stream:${threadId}`;
      const window = BrowserWindow.fromWebContents(event.sender);

      logInfo("Agent", "Received resume request", {
        threadId,
        command,
        modelId,
      });
      if (command?.resume?.decision) {
        logConversationMessage(
          threadId,
          "resume",
          `decision=${command.resume.decision}`,
        );
      }

      if (!window) {
        logError("Agent", "No window found for resume", { threadId });
        return;
      }

      // Get workspace path from thread metadata
      const thread = getThread(threadId);
      const metadata = thread?.metadata ? JSON.parse(thread.metadata) : {};
      const workspacePath =
        (metadata.workspacePath as string | undefined) ||
        (store.get("workspacePath", null) as string | null) ||
        undefined;

      if (!workspacePath) {
        window.webContents.send(channel, {
          type: "error",
          error: "Workspace path is required",
        });
        return;
      }

      window.webContents.send(channel, {
        type: "custom",
        data: {
          type: "prompt_token_estimate",
          estimate: estimateHiddenPromptTokens({ workspacePath }),
        },
      });

      // Abort any existing stream before resuming
      const existingController = activeRuns.get(threadId);
      if (existingController) {
        existingController.abort();
        activeRuns.delete(threadId);
      }

      const abortController = new AbortController();
      activeRuns.set(threadId, abortController);

      try {
        const agent = await createAgentRuntime({
          threadId,
          workspacePath,
          modelId,
        });
        logInfo("Agent", "Resume runtime ready", {
          threadId,
          elapsedMs: Date.now() - requestStartedAt,
        });
        const config = {
          configurable: { thread_id: threadId },
          signal: abortController.signal,
          streamMode: DEFAULT_STREAM_MODES,
          recursionLimit: 1000,
        };

        // Resume from checkpoint by streaming with Command containing the decision
        // The HITL middleware expects { decisions: [{ type: 'approve' | 'reject' | 'edit' }] }
        const decisionType = command?.resume?.decision || "approve";
        const requests =
          command?.resume?.requests && command.resume.requests.length > 0
            ? command.resume.requests
            : command?.resume?.request
              ? [command.resume.request]
              : [];
        if (
          decisionType === "approve" &&
          command?.resume?.rememberForWorkspace &&
          workspacePath
        ) {
          for (const request of requests) {
            rememberWorkspaceApproval(workspacePath, request);
          }
        }
        const resumeValue = {
          decisions:
            requests.length > 0
              ? requests.map(() => ({ type: decisionType }))
              : [{ type: decisionType }],
        };
        const stream = await agent.stream(
          new Command({ resume: resumeValue }),
          config,
        );

        let chunkCount = 0;
        let lastValuesState: unknown = null;

        for await (const chunk of stream) {
          if (abortController.signal.aborted) break;

          const [mode, data] = chunk as unknown as [string, unknown];
          chunkCount += 1;
          if (chunkCount <= 5 || chunkCount % 25 === 0) {
            logInfo("Agent", "Forwarding resume chunk", {
              threadId,
              chunkCount,
              mode,
              elapsedMs: Date.now() - requestStartedAt,
            });
          }

          if (mode === "values") {
            lastValuesState = JSON.parse(JSON.stringify(data));
            logConversationMessagesFromValues(threadId, data);
          }

          window.webContents.send(channel, {
            type: "stream",
            mode,
            data: JSON.parse(JSON.stringify(data)),
          });
        }

        if (!abortController.signal.aborted) {
          if (lastValuesState) {
            try {
              const consolidation = await consolidateTaskMemory({
                threadId,
                workspacePath,
                model: getBackgroundTaskModel(modelId),
                state: lastValuesState,
                trigger: "resume",
              });
              if (consolidation.recallSnapshot) {
                event.sender.send(channel, {
                  type: "custom",
                  data: {
                    type: "memory_recall",
                    memoryRecall: consolidation.recallSnapshot,
                  },
                });
              }
              if (consolidation.promotionCandidate) {
                event.sender.send(channel, {
                  type: "custom",
                  data: {
                    type: "memory_promotion_candidate",
                    candidate: consolidation.promotionCandidate,
                  },
                });
              }
            } catch (memoryError) {
              logWarn("Agent", "Task memory consolidation failed after resume", {
                threadId,
                error:
                  memoryError instanceof Error
                    ? memoryError.message
                    : String(memoryError),
              });
            }
          }

          logInfo("Agent", "Resume stream completed", {
            threadId,
            chunkCount,
            elapsedMs: Date.now() - requestStartedAt,
          });
          window.webContents.send(channel, { type: "done" });
        }
      } catch (error) {
        const isAbortError =
          error instanceof Error &&
          (error.name === "AbortError" ||
            error.message.includes("aborted") ||
            error.message.includes("Controller is already closed"));

        if (!isAbortError) {
          logError("Agent", "Resume error", {
            threadId,
            elapsedMs: Date.now() - requestStartedAt,
            error,
          });
          window.webContents.send(channel, {
            type: "error",
            error: error instanceof Error ? error.message : "Unknown error",
          });
        } else {
          logWarn("Agent", "Resume aborted", {
            threadId,
            elapsedMs: Date.now() - requestStartedAt,
          });
        }
      } finally {
        activeRuns.delete(threadId);
        logInfo("Agent", "Resume cleanup complete", { threadId });
      }
    },
  );

  // Handle HITL interrupt response
  ipcMain.on(
    "agent:interrupt",
    async (event, { threadId, decision }: AgentInterruptParams) => {
      const channel = `agent:stream:${threadId}`;
      const window = BrowserWindow.fromWebContents(event.sender);

      if (!window) {
        console.error("[Agent] No window found for interrupt response");
        return;
      }

      // Get workspace path from thread metadata - REQUIRED
      const thread = getThread(threadId);
      const metadata = thread?.metadata ? JSON.parse(thread.metadata) : {};
      const workspacePath = metadata.workspacePath as string | undefined;
      const modelId = metadata.model as string | undefined;

      if (!workspacePath) {
        window.webContents.send(channel, {
          type: "error",
          error: "Workspace path is required",
        });
        return;
      }

      // Abort any existing stream before continuing
      const existingController = activeRuns.get(threadId);
      if (existingController) {
        existingController.abort();
        activeRuns.delete(threadId);
      }

      const abortController = new AbortController();
      activeRuns.set(threadId, abortController);

      try {
        const agent = await createAgentRuntime({
          threadId,
          workspacePath,
          modelId,
        });
        const config = {
          configurable: { thread_id: threadId },
          signal: abortController.signal,
          streamMode: DEFAULT_STREAM_MODES,
          recursionLimit: 1000,
        };

        if (decision.type === "approve") {
          // Resume execution by invoking with null (continues from checkpoint)
          const stream = await agent.stream(null, config);

          for await (const chunk of stream) {
            if (abortController.signal.aborted) break;

            const [mode, data] = chunk as unknown as [string, unknown];
            window.webContents.send(channel, {
              type: "stream",
              mode,
              data: JSON.parse(JSON.stringify(data)),
            });
          }

          if (!abortController.signal.aborted) {
            window.webContents.send(channel, { type: "done" });
          }
        } else if (decision.type === "reject") {
          // For reject, we need to send a Command with reject decision
          // For now, just send done - the agent will see no resumption happened
          window.webContents.send(channel, { type: "done" });
        }
        // edit case handled similarly to approve with modified args
      } catch (error) {
        const isAbortError =
          error instanceof Error &&
          (error.name === "AbortError" ||
            error.message.includes("aborted") ||
            error.message.includes("Controller is already closed"));

        if (!isAbortError) {
          console.error("[Agent] Interrupt error:", error);
          window.webContents.send(channel, {
            type: "error",
            error: error instanceof Error ? error.message : "Unknown error",
          });
        }
      } finally {
        activeRuns.delete(threadId);
      }
    },
  );

  // Handle cancellation
  ipcMain.handle(
    "agent:cancel",
    async (_event, { threadId }: AgentCancelParams) => {
      const controller = activeRuns.get(threadId);
      if (controller) {
        controller.abort();
        activeRuns.delete(threadId);
      }
    },
  );
}
