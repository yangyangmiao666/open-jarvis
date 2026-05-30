import type { UseStreamTransport } from "@langchain/langgraph-sdk/react";
import type { ToolCall, ToolCallChunk } from "@langchain/core/messages";
import type {
  StreamPayload,
  StreamEvent,
  IPCEvent,
  IPCStreamEvent,
} from "../../../types";
import type { HITLRequest, Subagent } from "@/types";

/**
 * Usage metadata from LangChain model responses.
 * Contains token counts for tracking context window usage.
 */
interface UsageMetadata {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  input_token_details?: {
    cache_read?: number;
    cache_creation?: number;
    audio?: number;
  };
  output_token_details?: {
    audio?: number;
    reasoning?: number;
  };
}

interface NormalizedTokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
}

function hasMeaningfulTokenUsage(usage: NormalizedTokenUsage | null | undefined): boolean {
  return Boolean(
    usage &&
      (usage.inputTokens > 0 || usage.outputTokens > 0 || usage.totalTokens > 0),
  );
}

function estimateTextTokens(text: string): number {
  if (text.trim().length === 0) {
    return 0;
  }

  return Math.max(1, Math.ceil(text.length / 4) + 6);
}

/**
 * Serialized LangGraph message chunk.
 * LangChain uses a special serialization format:
 * { lc: 1, type: "constructor", id: ["langchain_core", "messages", "AIMessageChunk"], kwargs: { ... } }
 */
interface SerializedMessageChunk {
  /** LangChain serialization marker */
  lc?: number;
  type?: string;
  /** Class identifier array like ['langchain_core', 'messages', 'AIMessageChunk'] */
  id?: string[];
  /** Actual message data is in kwargs */
  kwargs?: {
    id?: string;
    content?:
      | string
      | Array<{
          type?: string;
          text?: string;
          content?: string;
          input_text?: string;
          output_text?: string;
          reasoning_content?: string;
          reasoning?: string;
          thinking?: string;
          think?: string;
        }>;
    tool_calls?: ToolCall[];
    tool_call_chunks?: ToolCallChunk[];
    tool_call_id?: string;
    name?: string;
    reasoning_content?: string;
    reasoning?: string;
    thinking?: string;
    think?: string;
    additional_kwargs?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
    usage_metadata?: UsageMetadata;
    response_metadata?: {
      usage?: UsageMetadata;
      [key: string]: unknown;
    };
  };
}

/**
 * Metadata accompanying streamed messages from LangGraph.
 * These fields are not exported from the SDK as they are internal runtime metadata.
 */
interface MessageMetadata {
  langgraph_node?: string;
  langgraph_checkpoint_ns?: string;
  checkpoint_ns?: string;
  name?: string;
}

// Accumulated tool call data (for streaming tool calls)
interface AccumulatedToolCall {
  id: string;
  name: string;
  args: string; // Accumulated JSON string
}

// Completed tool call with parsed args
interface CompletedToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

interface StreamingAssistantState {
  thinkOpened: boolean;
  thinkClosed: boolean;
}

interface HitlActionRequest {
  id?: string;
  action?: string;
  name?: string;
  args?: Record<string, unknown>;
}

/**
 * Custom transport for useStream that uses Electron IPC instead of HTTP.
 * This allows useStream to work seamlessly in an Electron app where the
 * LangGraph agent runs in the main process.
 */
export class ElectronIPCTransport implements UseStreamTransport {
  // Track current message ID for grouping tokens across chunks
  private currentMessageId: string | null = null;

  private normalizeTokenUsage(
    usage: Record<string, unknown> | UsageMetadata | undefined,
  ): NormalizedTokenUsage | null {
    if (!usage || typeof usage !== "object") {
      return null;
    }

    const raw = usage as Record<string, unknown>;
    const inputTokens =
      typeof raw.input_tokens === "number"
        ? raw.input_tokens
        : typeof raw.promptTokens === "number"
          ? raw.promptTokens
          : typeof raw.inputTokens === "number"
            ? raw.inputTokens
          : typeof raw.prompt_tokens === "number"
            ? raw.prompt_tokens
            : typeof raw.promptTokenCount === "number"
              ? raw.promptTokenCount
              : typeof raw.inputTokenCount === "number"
                ? raw.inputTokenCount
                : typeof raw.prompt_token_count === "number"
                  ? raw.prompt_token_count
                  : typeof raw.input_token_count === "number"
                    ? raw.input_token_count
            : 0;
    const outputTokens =
      typeof raw.output_tokens === "number"
        ? raw.output_tokens
        : typeof raw.completionTokens === "number"
          ? raw.completionTokens
          : typeof raw.outputTokens === "number"
            ? raw.outputTokens
          : typeof raw.completion_tokens === "number"
            ? raw.completion_tokens
            : typeof raw.candidatesTokenCount === "number"
              ? raw.candidatesTokenCount
              : typeof raw.outputTokenCount === "number"
                ? raw.outputTokenCount
                : typeof raw.completion_token_count === "number"
                  ? raw.completion_token_count
                  : typeof raw.candidates_token_count === "number"
                    ? raw.candidates_token_count
                    : typeof raw.output_token_count === "number"
                      ? raw.output_token_count
            : 0;
    const totalTokens =
      typeof raw.total_tokens === "number"
        ? raw.total_tokens
        : typeof raw.totalTokens === "number"
          ? raw.totalTokens
          : typeof raw.totalTokenCount === "number"
            ? raw.totalTokenCount
            : typeof raw.total_token_count === "number"
              ? raw.total_token_count
          : inputTokens + outputTokens;

    const inputTokenDetails =
      raw.input_token_details && typeof raw.input_token_details === "object"
        ? (raw.input_token_details as Record<string, unknown>)
        : undefined;

    const cacheReadTokens =
      typeof inputTokenDetails?.cache_read === "number"
        ? inputTokenDetails.cache_read
        : typeof raw.cache_read_input_tokens === "number"
          ? raw.cache_read_input_tokens
          : undefined;
    const cacheCreationTokens =
      typeof inputTokenDetails?.cache_creation === "number"
        ? inputTokenDetails.cache_creation
        : typeof raw.cache_creation_input_tokens === "number"
          ? raw.cache_creation_input_tokens
          : undefined;

    if (inputTokens <= 0 && outputTokens <= 0 && totalTokens <= 0) {
      return null;
    }

    return {
      inputTokens,
      outputTokens,
      totalTokens,
      cacheReadTokens,
      cacheCreationTokens,
    };
  }

  private extractTokenUsage(
    kwargs: SerializedMessageChunk["kwargs"] | Record<string, unknown>,
  ): NormalizedTokenUsage | null {
    const messageRecord = kwargs as Record<string, unknown>;

    const usageCandidates: Array<Record<string, unknown> | UsageMetadata | undefined> = [
      messageRecord.usage_metadata as UsageMetadata | undefined,
      (messageRecord.response_metadata as { usage?: Record<string, unknown> } | undefined)
        ?.usage,
      (messageRecord.response_metadata as { tokenUsage?: Record<string, unknown> } | undefined)
        ?.tokenUsage,
      (messageRecord.additional_kwargs as { usage?: Record<string, unknown> } | undefined)
        ?.usage,
    ];

    for (const candidate of usageCandidates) {
      const normalized = this.normalizeTokenUsage(candidate);
      if (normalized) {
        return normalized;
      }
    }

    return null;
  }

  private buildTokenUsageEvent(
    usage: NormalizedTokenUsage,
    usageKey?: string,
  ): StreamEvent {
    return {
      event: "custom",
      data: {
        type: "token_usage",
        usage,
        usageKey,
      },
    };
  }

  private extractSerializedContentText(
    content: NonNullable<SerializedMessageChunk["kwargs"]>["content"],
  ): string {
    if (typeof content === "string") {
      return content;
    }

    if (!Array.isArray(content)) {
      return "";
    }

    return content
      .map((part) => {
        if (!part || typeof part !== "object") {
          return "";
        }

        return (
          part.text ??
          part.content ??
          part.input_text ??
          part.output_text ??
          part.reasoning_content ??
          part.reasoning ??
          part.thinking ??
          part.think ??
          ""
        );
      })
      .filter((value) => value.length > 0)
      .join("\n");
  }

  private extractSummarizationMessageTokens(
    messages: SerializedMessageChunk[] | undefined,
  ): number {
    if (!Array.isArray(messages) || messages.length === 0) {
      return 0;
    }

    for (const msg of messages) {
      const kwargs = msg.kwargs || {};
      const classId = Array.isArray(msg.id) ? msg.id : [];
      const className = classId[classId.length - 1] || "";
      const additionalKwargs =
        kwargs.additional_kwargs && typeof kwargs.additional_kwargs === "object"
          ? (kwargs.additional_kwargs as Record<string, unknown>)
          : undefined;

      if (
        className.includes("Human") &&
        additionalKwargs?.lc_source === "summarization"
      ) {
        return estimateTextTokens(this.extractSerializedContentText(kwargs.content));
      }
    }

    return 0;
  }

  // Track active subagents by their tool_call_id
  private activeSubagents: Map<string, Subagent> = new Map();

  // Track accumulated tool call chunks (for streaming tool calls)
  private accumulatedToolCalls: Map<string, AccumulatedToolCall> = new Map();

  // Track completed tool calls by name for HITL matching
  private completedToolCallsByName: Map<string, CompletedToolCall[]> =
    new Map();

  // Track assistant streaming state so reasoning is rendered as one continuous block
  private streamingAssistantStates: Map<string, StreamingAssistantState> =
    new Map();

  async stream(payload: StreamPayload): Promise<AsyncGenerator<StreamEvent>> {
    // Reset state for new stream
    this.currentMessageId = null;
    this.activeSubagents.clear();
    this.accumulatedToolCalls.clear();
    this.completedToolCallsByName.clear();
    this.streamingAssistantStates.clear();
    // Extract thread ID and model ID from config
    const threadId = payload.config?.configurable?.thread_id;
    const modelId = payload.config?.configurable?.model_id as
      | string
      | undefined;
    const referencedPaths = (
      payload.config?.configurable as Record<string, unknown> | undefined
    )?.referenced_paths as string[] | undefined;
    const selectedSkills = (
      payload.config?.configurable as Record<string, unknown> | undefined
    )?.selected_skills as
      | Array<{ folderName: string; description?: string }>
      | undefined;
    const displayContent = (
      payload.config?.configurable as Record<string, unknown> | undefined
    )?.display_content as string | undefined;
    if (!threadId) {
      return this.createErrorGenerator(
        "MISSING_THREAD_ID",
        "Thread ID is required",
      );
    }

    // Check if this is a resume command (no message needed)
    const hasResumeCommand = payload.command?.resume !== undefined;

    // Extract the message content from input
    const input = payload.input as
      | { messages?: Array<{ content: string; type: string }> }
      | null
      | undefined;
    const messages = input?.messages ?? [];
    const lastHumanMessage = messages.find((m) => m.type === "human");
    const messageContent = lastHumanMessage?.content ?? "";

    // Only require message content if not resuming
    if (!messageContent && !hasResumeCommand) {
      return this.createErrorGenerator(
        "MISSING_MESSAGE",
        "Message content is required",
      );
    }

    // Create an async generator that bridges IPC events
    return this.createStreamGenerator(
      threadId,
      messageContent,
      payload.command,
      payload.signal,
      modelId,
      referencedPaths,
      selectedSkills,
      displayContent,
    );
  }

  private async *createErrorGenerator(
    code: string,
    message: string,
  ): AsyncGenerator<StreamEvent> {
    yield {
      event: "error",
      data: { error: code, message },
    };
  }

  private async *createStreamGenerator(
    threadId: string,
    message: string,
    command: unknown,
    signal: AbortSignal,
    modelId?: string,
    referencedPaths?: string[],
    selectedSkills?: Array<{ folderName: string; description?: string }>,
    displayContent?: string,
  ): AsyncGenerator<StreamEvent> {
    // Create a queue to buffer events from IPC
    const eventQueue: StreamEvent[] = [];
    let resolveNext: ((value: StreamEvent | null) => void) | null = null;
    let isDone = false;
    let hasError = false;

    // Generate a run ID for this stream
    const runId = crypto.randomUUID();

    // Emit metadata event first to establish run context
    yield {
      event: "metadata",
      data: {
        run_id: runId,
        thread_id: threadId,
      },
    };

    // Start the stream via IPC (pass modelId to use the selected model)
    const cleanup = window.api.agent.streamAgent(
      threadId,
      message,
      command,
      (ipcEvent) => {
        // Convert IPC events to SDK format
        const sdkEvents = this.convertToSDKEvents(
          ipcEvent as IPCEvent,
          threadId,
        );

        for (const sdkEvent of sdkEvents) {
          if (sdkEvent.event === "done" || sdkEvent.event === "error") {
            isDone = true;
            hasError = sdkEvent.event === "error";
          }

          // If someone is waiting for the next event, resolve immediately
          if (resolveNext) {
            const resolve = resolveNext;
            resolveNext = null;
            resolve(sdkEvent);
          } else {
            // Otherwise queue the event
            eventQueue.push(sdkEvent);
          }
        }
      },
      modelId,
      referencedPaths,
      selectedSkills,
      displayContent,
    );

    // Handle abort signal
    if (signal) {
      signal.addEventListener("abort", () => {
        cleanup();
        isDone = true;
        if (resolveNext) {
          const resolve = resolveNext;
          resolveNext = null;
          resolve(null);
        }
      });
    }

    // Yield events as they come in
    while (!isDone || eventQueue.length > 0) {
      // Check for queued events first
      if (eventQueue.length > 0) {
        const event = eventQueue.shift();
        if (!event) {
          continue;
        }
        if (event.event === "done") {
          break;
        }
        if (event.event !== "error" || hasError) {
          yield event;
        }
        if (hasError) {
          break;
        }
        continue;
      }

      // Wait for the next event
      const event = await new Promise<StreamEvent | null>((resolve) => {
        resolveNext = resolve;
      });

      if (event === null) {
        break;
      }

      if (event.event === "done") {
        break;
      }

      yield event;

      if (event.event === "error") {
        break;
      }
    }
  }

  /**
   * Convert IPC events to LangGraph SDK format
   * Returns an array since a single IPC event may produce multiple SDK events
   */
  private convertToSDKEvents(event: IPCEvent, threadId: string): StreamEvent[] {
    const events: StreamEvent[] = [];

    switch (event.type) {
      // Raw stream events from LangGraph - parse and convert
      case "stream": {
        const streamEvents = this.processStreamEvent(event);
        events.push(...streamEvents);
        break;
      }

      // Legacy: Token streaming for real-time typing effect
      case "token":
        events.push({
          event: "messages",
          data: [
            { id: event.messageId, type: "ai", content: event.token },
            { langgraph_node: "agent" },
          ],
        });
        break;

      // Legacy: Tool call chunks
      case "tool_call":
        events.push({
          event: "custom",
          data: {
            type: "tool_call",
            messageId: event.messageId,
            tool_calls: event.tool_calls,
          },
        });
        break;

      case "custom":
        events.push({
          event: "custom",
          data: event.data,
        });
        break;

      // Legacy: Full state values
      case "values": {
        const { todos, files, workspacePath, subagents, interrupt } =
          event.data;

        // Only emit values event if todos is defined
        // Avoid emitting { todos: [] } when undefined, which would wipe out existing todos
        if (todos !== undefined) {
          events.push({
            event: "values",
            data: { todos },
          });
        }

        // Emit files/workspace
        if (files) {
          const filesList = Array.isArray(files)
            ? files
            : Object.entries(files).map(([path, data]) => ({
                path,
                is_dir: false,
                size:
                  typeof (data as { content?: string })?.content === "string"
                    ? (data as { content: string }).content.length
                    : undefined,
              }));

          if (filesList.length) {
            events.push({
              event: "custom",
              data: {
                type: "workspace",
                files: filesList,
                path: workspacePath || "/",
              },
            });
          }
        }

        // Emit subagents
        if (subagents?.length) {
          events.push({
            event: "custom",
            data: { type: "subagents", subagents },
          });
        }

        // Emit interrupt - handle both legacy format and new langchain HITL format
        if (interrupt) {
          // Check if this is the new array format from langchain HITL
          if (Array.isArray(interrupt) && interrupt.length > 0) {
            const interruptValue = interrupt[0]?.value;
            const actionRequests = interruptValue?.actionRequests;
            const reviewConfigs = interruptValue?.reviewConfigs;
            const requests = this.buildHitlRequests(
              actionRequests,
              reviewConfigs,
            );

            if (requests.length > 0) {
              events.push({
                event: "custom",
                data: {
                  type: "interrupt",
                  request: requests[0],
                  requests,
                },
              });
            }
          } else if (interrupt.tool_call) {
            // Legacy format with direct tool_call property
            events.push({
              event: "custom",
              data: {
                type: "interrupt",
                request: {
                  id: interrupt.id || crypto.randomUUID(),
                  tool_call: interrupt.tool_call,
                  allowed_decisions: ["approve", "reject", "edit"],
                },
              },
            });
          }
        }
        break;
      }

      case "error":
        events.push({
          event: "error",
          data: { error: "STREAM_ERROR", message: event.error },
        });
        break;

      case "done":
        events.push({
          event: "done",
          data: { thread_id: threadId },
        });
        break;
    }

    console.log(
      "[Transport] convertToSDKEvents total:",
      events.length,
      "events",
      events.map((e) => e.event),
    );
    return events;
  }

  /**
   * Resolve LangGraph tool_call id for HITL: prefer id on the interrupt payload
   * (subgraphs / parallel tools), then fall back to the last streamed tool call
   * with the same name.
   */
  private resolveHitlToolCallId(action: {
    name: string;
    id?: string;
    args?: Record<string, unknown>;
  }): string | undefined {
    const raw = action as Record<string, unknown>;
    const fromPayload =
      (typeof action.id === "string" && action.id) ||
      (typeof raw.tool_call_id === "string" && raw.tool_call_id) ||
      (typeof raw.toolCallId === "string" && raw.toolCallId);
    if (typeof fromPayload === "string" && fromPayload.length > 0) {
      return fromPayload;
    }
    const tracked = this.completedToolCallsByName.get(action.name);
    if (tracked && tracked.length > 0) {
      return tracked[tracked.length - 1]?.id;
    }
    return undefined;
  }

  /**
   * Process raw LangGraph stream events (mode + data tuples)
   */
  private processStreamEvent(event: IPCStreamEvent): StreamEvent[] {
    const events: StreamEvent[] = [];
    const { mode, data } = event;

    if (mode === "messages") {
      // Messages mode returns [message, metadata] tuples
      const [msgChunk, metadata] = data as [
        SerializedMessageChunk,
        MessageMetadata,
      ];

      // LangChain serialization: actual data is in kwargs
      const kwargs = msgChunk?.kwargs || {};
      const classId = Array.isArray(msgChunk?.id) ? msgChunk.id : [];
      const className = classId[classId.length - 1] || "";

      // Check if this is a ToolMessage (class name contains 'ToolMessage')
      const isToolMessage =
        className.includes("ToolMessage") && !!kwargs.tool_call_id;

      // Check if this is an AI message (class name contains 'AI')
      const isAIMessage =
        className.includes("AI") || className.includes("AIMessageChunk");

      if (isAIMessage) {
        const msgId = kwargs.id || this.currentMessageId || crypto.randomUUID();
        this.currentMessageId = msgId;
        const content = this.buildStreamingAssistantDelta(kwargs, msgId);

        if (content || kwargs.tool_calls?.length) {
          events.push({
            event: "messages",
            data: [
              {
                id: msgId,
                type: "ai",
                content: content || "",
                // Include tool_calls if present
                ...(kwargs.tool_calls?.length && {
                  tool_calls: kwargs.tool_calls,
                }),
              },
              { langgraph_node: metadata?.langgraph_node || "agent" },
            ],
          });
        }

        // Handle tool call chunks (streaming) - these have args as strings
        if (kwargs.tool_call_chunks?.length) {
          const subagentEvents = this.processToolCallChunks(
            kwargs.tool_call_chunks,
          );
          events.push(...subagentEvents);

          events.push({
            event: "custom",
            data: {
              type: "tool_call",
              messageId: this.currentMessageId,
              tool_calls: kwargs.tool_call_chunks,
            },
          });
        }

        // Handle complete tool calls (non-streaming) - these have args as objects
        if (kwargs.tool_calls?.length) {
          const subagentEvents = this.processCompletedToolCalls(
            kwargs.tool_calls,
          );
          events.push(...subagentEvents);

          // Track tool calls for HITL matching
          for (const tc of kwargs.tool_calls) {
            if (tc.id && tc.name) {
              const existing = this.completedToolCallsByName.get(tc.name) || [];
              existing.push({ id: tc.id, name: tc.name, args: tc.args || {} });
              this.completedToolCallsByName.set(tc.name, existing);
            }
          }
        }

        // Extract usage_metadata for context window tracking
        // Usage metadata is present on completed AI messages (not streaming chunks)
        const usage = this.extractTokenUsage(kwargs);
        if (usage) {
          console.log("[ElectronTransport] Found usage_metadata:", {
            input_tokens: usage.inputTokens,
            output_tokens: usage.outputTokens,
            total_tokens: usage.totalTokens,
            has_cache_details:
              usage.cacheReadTokens !== undefined ||
              usage.cacheCreationTokens !== undefined,
          });

          // Only emit if we have actual token counts (not on every chunk)
          if (hasMeaningfulTokenUsage(usage)) {
            events.push(this.buildTokenUsageEvent(usage, kwargs.id));
          }
        }
      }

      // Handle ToolMessage - emit as message event and handle subagent completion
      if (isToolMessage && kwargs.tool_call_id) {
        const content = this.extractContent(kwargs.content);
        const msgId = kwargs.id || crypto.randomUUID();
        const toolRecord = kwargs as Record<string, unknown>;
        const isError =
          toolRecord.is_error === true ||
          toolRecord.status === "error" ||
          (toolRecord.additional_kwargs as { is_error?: boolean } | undefined)
            ?.is_error === true;

        // Emit tool message to the stream
        events.push({
          event: "messages",
          data: [
            {
              id: msgId,
              type: "tool",
              content,
              tool_call_id: kwargs.tool_call_id,
              name: kwargs.name,
              is_error: isError,
            },
            { langgraph_node: metadata?.langgraph_node || "tools" },
          ],
        });

        // Handle subagent task completion
        if (kwargs.name === "task") {
          const completionEvents = this.processToolMessage(kwargs.tool_call_id);
          events.push(...completionEvents);
        }
      }
    } else if (mode === "values") {
      // Values mode returns full state with serialized LangChain messages
      const state = data as {
        messages?: SerializedMessageChunk[];
        todos?: { id?: string; content?: string; status?: string }[];
        files?:
          | Record<string, unknown>
          | Array<{ path: string; is_dir?: boolean; size?: number }>;
        workspacePath?: string;
        // __interrupt__ is an array of interrupt objects from langchain HITL middleware
        __interrupt__?: Array<{
          value?: {
            actionRequests?: Array<{
              action?: string;
              name: string;
              id?: string;
              args?: Record<string, unknown>;
            }>;
            reviewConfigs?: Array<{
              actionName: string;
              allowedDecisions: HITLRequest["allowed_decisions"];
            }>;
          };
        }>;
      };

      let latestUsage: NormalizedTokenUsage | null = null;
      let latestUsageKey: string | undefined;

      // Process messages in values mode to extract subagents
      if (state.messages) {
        for (const msg of state.messages) {
          const kwargs = msg.kwargs || {};
          const classId = Array.isArray(msg.id) ? msg.id : [];
          const className = classId[classId.length - 1] || "";

          if (className.includes("AI")) {
            const usage = this.extractTokenUsage(kwargs);
            if (usage) {
              latestUsage = usage;
              latestUsageKey = kwargs.id;
            }
          }

          // Check for task tool calls in AI messages
          if (kwargs.tool_calls?.length) {
            for (const toolCall of kwargs.tool_calls) {
              if (
                toolCall.name === "task" &&
                toolCall.id &&
                !this.activeSubagents.has(toolCall.id)
              ) {
                const args = toolCall.args || {};
                if (args.subagent_type || args.description) {
                  const subagent = this.createSubagentFromTask(
                    toolCall.id,
                    args,
                  );
                  this.activeSubagents.set(toolCall.id, subagent);
                }
              }
            }
          }

          // Check for ToolMessage (subagent completion)
          if (
            className.includes("ToolMessage") &&
            kwargs.tool_call_id &&
            kwargs.name === "task"
          ) {
            const subagent = this.activeSubagents.get(kwargs.tool_call_id);
            if (subagent && subagent.status === "running") {
              subagent.status = "completed";
              subagent.completedAt = new Date();
            }
          }
        }

        // Emit subagent update if we have any
        if (this.activeSubagents.size > 0) {
          events.push(this.createSubagentEvent());
        }
      }

      // Transform messages from LangChain serialization format
      // Filter out human messages since they're already shown from user input
      const transformedMessages = state.messages
        ?.filter((msg) => {
          const classId = Array.isArray(msg.id) ? msg.id : [];
          const className = classId[classId.length - 1] || "";
          // Filter out HumanMessage
          return !className.includes("Human");
        })
        .map((msg) => {
          const kwargs = msg.kwargs || {};
          const classId = Array.isArray(msg.id) ? msg.id : [];
          const className = classId[classId.length - 1] || "";

          // Determine message type from class name
          const type: "ai" | "tool" = className.includes("Tool")
            ? "tool"
            : "ai";
          const content =
            type === "ai"
              ? this.buildAssistantContent(kwargs)
              : this.extractContent(kwargs.content);

          return {
            id: kwargs.id || crypto.randomUUID(),
            type,
            content,
            // Include tool_calls for AI messages
            ...(type === "ai" &&
              kwargs.tool_calls && { tool_calls: kwargs.tool_calls }),
            // Include tool_call_id and name for tool messages
            ...(type === "tool" &&
              kwargs.tool_call_id && { tool_call_id: kwargs.tool_call_id }),
            ...(type === "tool" && kwargs.name && { name: kwargs.name }),
          };
        });

      // Only emit values event if we have actual data to update
      // Don't emit messages: undefined as it would clear the UI
      const valuesData: Record<string, unknown> = {};
      if (transformedMessages && transformedMessages.length > 0) {
        valuesData.messages = transformedMessages;
      }
      if (state.todos !== undefined) {
        valuesData.todos = state.todos;
      }
      if (state.workspacePath) {
        valuesData.workspacePath = state.workspacePath;
      }

      // Only emit if we have something to update
      if (Object.keys(valuesData).length > 0) {
        events.push({
          event: "values",
          data: valuesData,
        });
      }

      events.push({
        event: "custom",
        data: {
          type: "summarization_token_estimate",
          summarizationTokens: this.extractSummarizationMessageTokens(
            state.messages,
          ),
        },
      });

      if (latestUsage && hasMeaningfulTokenUsage(latestUsage)) {
        events.push(this.buildTokenUsageEvent(latestUsage, latestUsageKey));
      }

      // Emit files/workspace
      if (state.files) {
        const filesList = Array.isArray(state.files)
          ? state.files
          : Object.entries(state.files).map(([path, fileData]) => ({
              path,
              is_dir: false,
              size:
                typeof (fileData as { content?: string })?.content === "string"
                  ? (fileData as { content: string }).content.length
                  : undefined,
            }));

        if (filesList.length) {
          events.push({
            event: "custom",
            data: {
              type: "workspace",
              files: filesList,
              path: state.workspacePath || "/",
            },
          });
        }
      }

      // Emit interrupt - langchain HITL returns __interrupt__ as array of { value: HITLRequest }
      if (state.__interrupt__?.length) {
        const interruptValue = state.__interrupt__[0]?.value;
        const actionRequests = interruptValue?.actionRequests;
        const reviewConfigs = interruptValue?.reviewConfigs;
        const requests = this.buildHitlRequests(actionRequests, reviewConfigs);

        // For each action request (tool call) that needs approval
        if (requests.length > 0) {
          events.push({
            event: "custom",
            data: {
              type: "interrupt",
              request: requests[0],
              requests,
            },
          });
        }
      }
    }

    return events;
  }

  private getHitlActionName(action: unknown): string {
    if (!action || typeof action !== "object") {
      return "execute";
    }

    const record = action as HitlActionRequest;
    return record.action || record.name || "execute";
  }

  private buildHitlRequests(
    actionRequests: unknown[] | undefined,
    reviewConfigs:
      | Array<{
          actionName?: string;
          allowedDecisions?: HITLRequest["allowed_decisions"];
        }>
      | undefined,
  ): HITLRequest[] {
    if (!actionRequests?.length) {
      return [];
    }

    return actionRequests.map((action) => {
      const actionName = this.getHitlActionName(action);
      const reviewConfig = reviewConfigs?.find(
        (rc) => rc.actionName === actionName,
      );
      const toolCallId = this.resolveHitlToolCallId(
        action as {
          name: string;
          id?: string;
          args?: Record<string, unknown>;
        },
      );
      const stableId = toolCallId ?? crypto.randomUUID();
      const actionRecord = action as HitlActionRequest;
      const allowedDecisions: HITLRequest["allowed_decisions"] =
        reviewConfig?.allowedDecisions || ["approve", "reject", "edit"];

      return {
        id: stableId,
        tool_call: {
          id: stableId,
          name: actionName,
          args: actionRecord.args || {},
        },
        allowed_decisions: allowedDecisions,
      };
    });
  }

  /**
   * Extract text content from message content (string or content blocks)
   */
  private extractContent(
    content:
      | string
      | Array<{
          type?: string;
          text?: string;
          content?: string;
          input_text?: string;
          output_text?: string;
        }>
      | undefined,
  ): string {
    if (typeof content === "string") {
      return content;
    }
    if (Array.isArray(content)) {
      return content
        .map((block) => {
          if (!block || typeof block !== "object") {
            return "";
          }

          const type = typeof block.type === "string" ? block.type : "";
          if (type.includes("reasoning") || type.includes("thinking")) {
            return "";
          }

          if (typeof block.text === "string") {
            return block.text;
          }
          if (typeof block.content === "string") {
            return block.content;
          }
          if (typeof block.input_text === "string") {
            return block.input_text;
          }
          if (typeof block.output_text === "string") {
            return block.output_text;
          }
          return "";
        })
        .filter((value) => value.length > 0)
        .join("");
    }
    return "";
  }

  private extractReasoning(
    message: Record<string, unknown>,
  ): string {
    const directCandidates: unknown[] = [
      message.reasoning_content,
      message.reasoning,
      message.thinking,
      message.think,
    ];

    for (const candidate of directCandidates) {
      if (typeof candidate === "string" && candidate.trim().length > 0) {
        return candidate.trim();
      }
    }

    const content = message.content;
    if (Array.isArray(content)) {
      const reasoningParts = content
        .map((part) => {
          if (!part || typeof part !== "object") {
            return "";
          }

          const record = part as Record<string, unknown>;
          const type = typeof record.type === "string" ? record.type : "";

          const directPartReasoning =
            record.reasoning_content ??
            record.reasoning ??
            record.thinking ??
            record.think;
          if (
            typeof directPartReasoning === "string" &&
            directPartReasoning.trim().length > 0
          ) {
            return directPartReasoning.trim();
          }

          if (type.includes("reasoning") || type.includes("thinking")) {
            if (typeof record.text === "string" && record.text.trim().length > 0) {
              return record.text.trim();
            }
            if (
              typeof record.content === "string" &&
              record.content.trim().length > 0
            ) {
              return record.content.trim();
            }
          }

          return "";
        })
        .filter((value) => value.length > 0);

      if (reasoningParts.length > 0) {
        return reasoningParts.join("\n");
      }
    }

    const nestedContainers: unknown[] = [
      message.additional_kwargs,
      message.response_metadata,
      message.metadata,
    ];

    for (const container of nestedContainers) {
      if (!container || typeof container !== "object") {
        continue;
      }

      const nested = container as Record<string, unknown>;
      const nestedReasoning =
        nested.reasoning_content ?? nested.reasoning ?? nested.thinking ?? nested.think;
      if (
        typeof nestedReasoning === "string" &&
        nestedReasoning.trim().length > 0
      ) {
        return nestedReasoning.trim();
      }
    }

    return "";
  }

  private extractStreamingReasoning(
    message: Record<string, unknown>,
  ): string {
    const directCandidates: unknown[] = [
      message.reasoning_content,
      message.reasoning,
      message.thinking,
      message.think,
    ];

    for (const candidate of directCandidates) {
      if (typeof candidate === "string" && candidate.length > 0) {
        return candidate;
      }
    }

    const content = message.content;
    if (Array.isArray(content)) {
      const reasoningParts = content
        .map((part) => {
          if (!part || typeof part !== "object") {
            return "";
          }

          const record = part as Record<string, unknown>;
          const type = typeof record.type === "string" ? record.type : "";
          const directPartReasoning =
            record.reasoning_content ??
            record.reasoning ??
            record.thinking ??
            record.think;

          if (typeof directPartReasoning === "string" && directPartReasoning.length > 0) {
            return directPartReasoning;
          }

          if (type.includes("reasoning") || type.includes("thinking")) {
            if (typeof record.text === "string" && record.text.length > 0) {
              return record.text;
            }
            if (typeof record.content === "string" && record.content.length > 0) {
              return record.content;
            }
          }

          return "";
        })
        .filter((value) => value.length > 0);

      if (reasoningParts.length > 0) {
        return reasoningParts.join("");
      }
    }

    const nestedContainers: unknown[] = [
      message.additional_kwargs,
      message.response_metadata,
      message.metadata,
    ];

    for (const container of nestedContainers) {
      if (!container || typeof container !== "object") {
        continue;
      }

      const nested = container as Record<string, unknown>;
      const nestedReasoning =
        nested.reasoning_content ?? nested.reasoning ?? nested.thinking ?? nested.think;
      if (typeof nestedReasoning === "string" && nestedReasoning.length > 0) {
        return nestedReasoning;
      }
    }

    return "";
  }

  private getStreamingAssistantState(messageId: string): StreamingAssistantState {
    let state = this.streamingAssistantStates.get(messageId);
    if (!state) {
      state = { thinkOpened: false, thinkClosed: false };
      this.streamingAssistantStates.set(messageId, state);
    }
    return state;
  }

  private buildStreamingAssistantDelta(
    kwargs: SerializedMessageChunk["kwargs"] | Record<string, unknown>,
    messageId: string,
  ): string {
    const record = kwargs as Record<string, unknown>;
    const state = this.getStreamingAssistantState(messageId);
    const reasoning = this.extractStreamingReasoning(record);
    const content = this.extractContent(
      record.content as
        | string
        | Array<{
            type?: string;
            text?: string;
            content?: string;
            input_text?: string;
            output_text?: string;
          }>
        | undefined,
    );
    const hasToolCalls =
      Array.isArray(record.tool_calls) && record.tool_calls.length > 0;
    const parts: string[] = [];

    if (reasoning.length > 0) {
      if (!state.thinkOpened) {
        parts.push("<think>\n");
        state.thinkOpened = true;
      }
      parts.push(reasoning);
    }

    const shouldCloseThink =
      state.thinkOpened && !state.thinkClosed && (content.length > 0 || hasToolCalls);

    if (shouldCloseThink) {
      parts.push("\n</think>");
      state.thinkClosed = true;
      if (content.length > 0) {
        parts.push("\n");
      }
    }

    if (content.length > 0) {
      parts.push(content);
    }

    return parts.join("");
  }

  private buildAssistantContent(
    kwargs: SerializedMessageChunk["kwargs"] | Record<string, unknown>,
  ): string {
    const messageRecord = kwargs as Record<string, unknown>;
    const reasoning = this.extractReasoning(messageRecord);
    const content = this.extractContent(
      messageRecord.content as
        | string
        | Array<{
            type?: string;
            text?: string;
            content?: string;
            input_text?: string;
            output_text?: string;
          }>
        | undefined,
    ).trim();

    return [
      reasoning.length > 0 ? `<think>\n${reasoning}\n</think>` : "",
      content,
    ]
      .filter((value) => value.length > 0)
      .join("\n")
      .trim();
  }

  /**
   * Process streaming tool call chunks and detect task subagent invocations
   * Tool calls are streamed incrementally, so we accumulate args until we have enough
   */
  private processToolCallChunks(
    chunks: Array<{ id?: string; name?: string; args?: string }>,
  ): StreamEvent[] {
    const events: StreamEvent[] = [];

    for (const chunk of chunks) {
      if (!chunk.id) continue;

      // Get or create accumulated tool call
      let accumulated = this.accumulatedToolCalls.get(chunk.id);
      if (!accumulated) {
        accumulated = { id: chunk.id, name: chunk.name || "", args: "" };
        this.accumulatedToolCalls.set(chunk.id, accumulated);
      }

      // Update name if provided
      if (chunk.name) {
        accumulated.name = chunk.name;
      }

      // Accumulate args
      if (chunk.args) {
        accumulated.args += chunk.args;
      }

      // Check if this is a "task" tool call and try to parse args
      if (accumulated.name === "task") {
        try {
          const args = JSON.parse(accumulated.args);
          // Only process if we haven't already created a subagent for this tool call
          if (!this.activeSubagents.has(chunk.id) && args.subagent_type) {
            const subagent = this.createSubagentFromTask(chunk.id, args);
            this.activeSubagents.set(chunk.id, subagent);
            events.push(this.createSubagentEvent());
          }
        } catch {
          // Args not complete yet, continue accumulating
        }
      }
    }

    return events;
  }

  /**
   * Process completed tool calls (non-streaming) and detect task subagent invocations
   */
  private processCompletedToolCalls(
    toolCalls: Array<{
      id?: string;
      name?: string;
      args?: Record<string, unknown>;
    }>,
  ): StreamEvent[] {
    const events: StreamEvent[] = [];

    for (const toolCall of toolCalls) {
      if (!toolCall.id || !toolCall.name) continue;

      // Check if this is a "task" tool call
      if (toolCall.name === "task" && !this.activeSubagents.has(toolCall.id)) {
        const args = toolCall.args || {};
        if (args.subagent_type || args.description) {
          const subagent = this.createSubagentFromTask(toolCall.id, args);
          this.activeSubagents.set(toolCall.id, subagent);
          events.push(this.createSubagentEvent());
        }
      }
    }

    return events;
  }

  /**
   * Process a ToolMessage which signals subagent completion
   */
  private processToolMessage(toolCallId: string): StreamEvent[] {
    const events: StreamEvent[] = [];

    // Check if this tool_call_id corresponds to an active subagent
    const subagent = this.activeSubagents.get(toolCallId);
    if (subagent) {
      subagent.status = "completed";
      subagent.completedAt = new Date();
      events.push(this.createSubagentEvent());
    }

    return events;
  }

  /**
   * Create a Subagent object from task tool call args
   */
  private createSubagentFromTask(
    toolCallId: string,
    args: Record<string, unknown>,
  ): Subagent {
    const subagentType = (args.subagent_type as string) || "general-purpose";
    const description = (args.description as string) || "Executing task...";

    // Generate a friendly name from the subagent type
    const nameMap: Record<string, string> = {
      "general-purpose": "General Purpose Agent",
      "correctness-checker": "Correctness Checker",
      "final-reviewer": "Final Reviewer",
      "code-reviewer": "Code Reviewer",
      research: "Research Agent",
    };

    return {
      id: toolCallId,
      toolCallId,
      name: nameMap[subagentType] || this.formatSubagentName(subagentType),
      description,
      status: "running",
      startedAt: new Date(),
      subagentType,
    };
  }

  /**
   * Format a subagent type string into a display name
   */
  private formatSubagentName(subagentType: string): string {
    return subagentType
      .split("-")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  }

  /**
   * Create a custom event with current subagent state
   */
  private createSubagentEvent(): StreamEvent {
    return {
      event: "custom",
      data: {
        type: "subagents",
        subagents: Array.from(this.activeSubagents.values()),
      },
    };
  }
}
