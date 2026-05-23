import { createDeepAgent } from "deepagents";
import { AsyncLocalStorage } from "node:async_hooks";
import Store from "electron-store";
import { createMiddleware } from "langchain";
import { getThread } from "../db";
import { getDefaultModel } from "../ipc/models";
import { getMCPServerById } from "../mcp-config";
import { getOpenAICompatibleProfileByModelId } from "../openai-compatible-profiles";
import { getApiKey, getOpenworkDir, getThreadCheckpointPath } from "../storage";
import { AIMessage, ToolMessage } from "@langchain/core/messages";
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatOpenAI } from "@langchain/openai";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { SqlJsSaver } from "../checkpointer/sqljs-saver";
import { LocalSandbox } from "./local-sandbox";
import { closeAllMCPConnections, getMCPToolsForServers } from "./mcp-runtime";

import { BASE_SYSTEM_PROMPT } from "./system-prompt";
import { resolveSkillSourcesForWorkspace } from "../skill-config";
import type {
  CustomModelApiFormat,
  CustomModelReasoningContentMode,
  CustomModelThinkingType,
  OpenAICompatibleProfile,
  ThreadMetadata,
} from "../types";
import {
  getConfiguredContextWindow,
  getContextWindowForModel,
} from "../../model-context";
import { logInfo, logWarn } from "../logger";

const MODEL_REQUEST_TIMEOUT_MS = 30_000;

type OpenAICompatibleRequestBody = Record<string, unknown>;
type OpenAICompatibleReasoningReplay = unknown[];

const openAICompatibleReasoningReplayStorage =
  new AsyncLocalStorage<OpenAICompatibleReasoningReplay>();

interface ApprovalAliasTool {
  name?: string;
  __approvalAliases?: string[];
}

export interface PromptTokenEstimate {
  hiddenPromptTokens: number;
  systemPromptTokens: number;
  filesystemPromptTokens: number;
  referencedPathsTokens: number;
}

type TodoStatus = "pending" | "in_progress" | "completed";

function normalizeTodoStatus(status: unknown): TodoStatus {
  switch (status) {
    case "completed":
      return "completed";
    case "in_progress":
    case "in-progress":
      return "in_progress";
    case "pending":
    default:
      return "pending";
  }
}

function normalizeWriteTodosArgs(args: unknown): unknown {
  if (!args || typeof args !== "object") {
    return args;
  }

  const record = args as Record<string, unknown>;
  const rawTodos = record["todos"];

  let parsedTodos = rawTodos;
  if (typeof rawTodos === "string") {
    try {
      parsedTodos = JSON.parse(rawTodos) as unknown;
    } catch {
      return args;
    }
  }

  if (!Array.isArray(parsedTodos)) {
    return args;
  }

  const normalizedTodos = parsedTodos.flatMap((todo) => {
    if (typeof todo === "string") {
      const content = todo.trim();
      return content.length > 0
        ? [{ content, status: "pending" as const }]
        : [];
    }

    if (!todo || typeof todo !== "object") {
      return [];
    }

    const todoRecord = todo as Record<string, unknown>;
    const content =
      typeof todoRecord["content"] === "string"
        ? todoRecord["content"].trim()
        : "";

    if (content.length === 0) {
      return [];
    }

    return [
      {
        content,
        status: normalizeTodoStatus(todoRecord["status"]),
      },
    ];
  });

  return {
    ...record,
    todos: normalizedTodos,
  };
}

function normalizeToolCallRequestArgs<TRequest extends { toolCall: { name?: string; args?: unknown } }>(
  request: TRequest,
): TRequest {
  if (request.toolCall.name !== "write_todos") {
    return request;
  }

  const normalizedArgs = normalizeWriteTodosArgs(request.toolCall.args);
  if (normalizedArgs === request.toolCall.args) {
    return request;
  }

  logInfo("Runtime", "Normalized write_todos arguments", {
    originalType: typeof request.toolCall.args,
    normalizedTodoCount:
      Array.isArray((normalizedArgs as { todos?: unknown }).todos)
        ? ((normalizedArgs as { todos: unknown[] }).todos.length ?? 0)
        : 0,
  });

  return {
    ...request,
    toolCall: {
      ...request.toolCall,
      args: normalizedArgs,
    },
  };
}

function toToolErrorText(error: unknown): string {
  if (error instanceof Error) {
    const details = error.message.trim();
    return details.length > 0 ? details : "Tool execution failed";
  }
  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }
  return "Tool execution failed";
}

const runtimeToolErrorMiddleware = createMiddleware({
  name: "RuntimeToolErrorMiddleware",
  wrapToolCall: async (request, handler) => {
    try {
      return await handler(normalizeToolCallRequestArgs(request));
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw error;
      }

      const message = toToolErrorText(error);
      logWarn("Runtime", `Tool call failed (${request.toolCall.name})`, message);
      return new ToolMessage({
        content: message,
        tool_call_id: request.toolCall.id ?? "unknown_tool_call",
        name: request.toolCall.name ?? "unknown_tool",
        status: "error",
      });
    }
  },
});

/**
 * Generate the full system prompt for the agent.
 *
 * @param workspacePath - The workspace path the agent is operating in
 * @returns The complete system prompt
 */
function getSystemPrompt(workspacePath: string): string {
  const workingDirSection = `
### File System and Paths

**IMPORTANT - Path Handling:**
- All file paths use fully qualified absolute system paths
- The workspace root is: \`${workspacePath}\`
- Example: \`${workspacePath}/src/index.ts\`, \`${workspacePath}/README.md\`
- To list the workspace root, use \`ls("${workspacePath}")\`
- Always use full absolute paths for all file operations
`;

  return workingDirSection + BASE_SYSTEM_PROMPT;
}

function getFilesystemSystemPrompt(workspacePath: string): string {
  return `You have access to a filesystem. All file paths use fully qualified absolute system paths.

- ls: list files in a directory (e.g., ls("${workspacePath}"))
- read_file: read a file from the filesystem
- write_file: write to a file in the filesystem
- edit_file: edit a file in the filesystem
- glob: find files matching a pattern (e.g., "**/*.py")
- grep: search for text within files

The workspace root is: ${workspacePath}`;
}

export function buildReferencedPathsPrompt(referencedPaths?: string[]): string {
  if (!referencedPaths || referencedPaths.length === 0) {
    return "";
  }

  const lines = referencedPaths.map((filePath) => `- ${filePath}`).join("\n");
  return `The user referenced the following workspace paths (pay attention to these files/folders):\n${lines}\n\n---\n\n`;
}

function estimateTextTokens(text: string): number {
  if (text.trim().length === 0) {
    return 0;
  }

  return Math.max(1, Math.ceil(text.length / 4) + 6);
}

export function estimateHiddenPromptTokens(options: {
  workspacePath: string;
  referencedPaths?: string[];
}): PromptTokenEstimate {
  const { workspacePath, referencedPaths } = options;
  const systemPromptTokens = estimateTextTokens(getSystemPrompt(workspacePath));
  const filesystemPromptTokens = estimateTextTokens(
    getFilesystemSystemPrompt(workspacePath),
  );
  const referencedPathsTokens = estimateTextTokens(
    buildReferencedPathsPrompt(referencedPaths),
  );

  return {
    hiddenPromptTokens:
      systemPromptTokens + filesystemPromptTokens + referencedPathsTokens,
    systemPromptTokens,
    filesystemPromptTokens,
    referencedPathsTokens,
  };
}

// Per-thread checkpointer cache
const checkpointers = new Map<string, SqlJsSaver>();
const settingsStore = new Store({
  name: "settings",
  cwd: getOpenworkDir(),
});

function applyContextWindowProfile<T extends object>(
  model: T,
  contextWindow?: number,
): T {
  const configuredContextWindow = getConfiguredContextWindow(contextWindow);
  if (configuredContextWindow === undefined) {
    return model;
  }

  const maybeProfile = (model as { profile?: unknown }).profile;
  const currentProfile =
    typeof maybeProfile === "object" && maybeProfile !== null
      ? (maybeProfile as Record<string, unknown>)
      : {};

  Object.defineProperty(model, "profile", {
    value: {
      ...currentProfile,
      maxInputTokens: configuredContextWindow,
    },
    configurable: true,
  });

  return model;
}

function normalizeCustomModelApiFormat(
  profile: Pick<OpenAICompatibleProfile, "apiFormat">,
): CustomModelApiFormat {
  return profile.apiFormat === "anthropic" ? "anthropic" : "openai";
}

function normalizeCustomModelThinkingType(
  profile: Pick<OpenAICompatibleProfile, "thinkingType">,
): CustomModelThinkingType {
  return profile.thinkingType === "enabled" ? "enabled" : "disabled";
}

function normalizeCustomModelThinkingEffort(
  profile: Pick<OpenAICompatibleProfile, "thinkingEffort">,
): NonNullable<OpenAICompatibleProfile["thinkingEffort"]> {
  switch (profile.thinkingEffort) {
    case "low":
    case "medium":
    case "high":
    case "xhigh":
    case "max":
      return profile.thinkingEffort;
    default:
      return "high";
  }
}

function normalizeOpenAIReasoningEffort(
  profile: Pick<OpenAICompatibleProfile, "thinkingEffort">,
): "low" | "medium" | "high" {
  switch (profile.thinkingEffort) {
    case "low":
    case "medium":
    case "high":
      return profile.thinkingEffort;
    case "xhigh":
    case "max":
    default:
      return "high";
  }
}

function normalizeReasoningContentMode(
  profile: Pick<OpenAICompatibleProfile, "reasoningContent">,
): CustomModelReasoningContentMode {
  switch (profile.reasoningContent) {
    case "enabled":
    case "disabled":
      return profile.reasoningContent;
    case "auto":
    default:
      return "auto";
  }
}

function tryParseOpenAICompatibleBody(
  body: BodyInit | null | undefined,
): OpenAICompatibleRequestBody | null {
  if (typeof body !== "string") {
    return null;
  }

  try {
    const parsed = JSON.parse(body) as unknown;
    return parsed && typeof parsed === "object"
      ? (parsed as OpenAICompatibleRequestBody)
      : null;
  } catch {
    return null;
  }
}

function sanitizeOpenAICompatibleRequestBody(
  body: OpenAICompatibleRequestBody,
  mode: "default" | "fallback",
): OpenAICompatibleRequestBody {
  const sanitized: OpenAICompatibleRequestBody = { ...body };

  // Common OpenAI-compatible gateways reject these optional fields even though
  // the official API accepts them.
  delete sanitized["parallel_tool_calls"];

  if (sanitized["tool_choice"] === "auto") {
    delete sanitized["tool_choice"];
  }

  if (mode === "fallback") {
    delete sanitized["user"];
    delete sanitized["seed"];
    delete sanitized["response_format"];
    delete sanitized["stream_options"];
  }

  return sanitized;
}

function getAIMessageReasoningContent(message: AIMessage): unknown {
  const additionalKwargs =
    typeof message.additional_kwargs === "object" &&
    message.additional_kwargs !== null
      ? (message.additional_kwargs as Record<string, unknown>)
      : null;

  if (additionalKwargs?.["reasoning_content"] !== undefined) {
    return additionalKwargs["reasoning_content"];
  }

  const rawResponse = additionalKwargs?.["__raw_response"];
  if (typeof rawResponse !== "object" || rawResponse === null) {
    return undefined;
  }

  const choices = (rawResponse as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    return undefined;
  }

  const firstChoice = choices[0];
  if (typeof firstChoice !== "object" || firstChoice === null) {
    return undefined;
  }

  const rawMessage = (firstChoice as { message?: unknown }).message;
  if (typeof rawMessage !== "object" || rawMessage === null) {
    return undefined;
  }

  return (rawMessage as Record<string, unknown>)["reasoning_content"];
}

function hasOpenAICompatibleToolHistory(body: OpenAICompatibleRequestBody): boolean {
  const messages = body["messages"];
  if (!Array.isArray(messages)) {
    return false;
  }

  return messages.some((rawMessage) => {
    if (typeof rawMessage !== "object" || rawMessage === null) {
      return false;
    }

    const message = rawMessage as Record<string, unknown>;
    if (message["role"] === "tool") {
      return true;
    }

    return (
      message["role"] === "assistant" &&
      Array.isArray(message["tool_calls"]) &&
      message["tool_calls"].length > 0
    );
  });
}

function shouldReplayOpenAICompatibleReasoningContent(
  profile: OpenAICompatibleProfile,
  body: OpenAICompatibleRequestBody,
): boolean {
  if (normalizeCustomModelThinkingType(profile) !== "enabled") {
    return false;
  }

  switch (normalizeReasoningContentMode(profile)) {
    case "enabled":
      return true;
    case "disabled":
      return false;
    case "auto":
    default:
      return hasOpenAICompatibleToolHistory(body);
  }
}

function extractOpenAICompatibleReasoningReplay(
  messages: unknown[],
): OpenAICompatibleReasoningReplay {
  return messages.flatMap((message) => {
    if (!AIMessage.isInstance(message)) {
      return [];
    }

    return [getAIMessageReasoningContent(message)];
  });
}

function applyOpenAICompatibleReasoningReplay(
  body: OpenAICompatibleRequestBody,
  reasoningReplay: OpenAICompatibleReasoningReplay | undefined,
): {
  body: OpenAICompatibleRequestBody;
  replayedAssistantMessages: number;
  assistantMessages: number;
} {
  const messages = body["messages"];
  if (!Array.isArray(messages) || !Array.isArray(reasoningReplay)) {
    return {
      body,
      replayedAssistantMessages: 0,
      assistantMessages: 0,
    };
  }

  let assistantIndex = 0;
  let replayedAssistantMessages = 0;
  const nextMessages = messages.map((rawMessage) => {
    if (typeof rawMessage !== "object" || rawMessage === null) {
      return rawMessage;
    }

    const message = { ...(rawMessage as Record<string, unknown>) };
    if (message["role"] !== "assistant") {
      return message;
    }

    const reasoningContent = reasoningReplay[assistantIndex];
    assistantIndex += 1;

    if (
      reasoningContent !== undefined &&
      message["reasoning_content"] === undefined
    ) {
      message["reasoning_content"] = reasoningContent;
      replayedAssistantMessages += 1;
    }

    return message;
  });

  if (replayedAssistantMessages === 0) {
    return {
      body,
      replayedAssistantMessages,
      assistantMessages: assistantIndex,
    };
  }

  return {
    body: {
      ...body,
      messages: nextMessages,
    },
    replayedAssistantMessages,
    assistantMessages: assistantIndex,
  };
}

function summarizeOpenAICompatibleRequestBody(
  body: OpenAICompatibleRequestBody,
): Record<string, unknown> {
  return {
    keys: Object.keys(body).sort(),
    stream: body["stream"] === true,
    toolCount: Array.isArray(body["tools"]) ? body["tools"].length : 0,
    hasToolChoice: body["tool_choice"] !== undefined,
    hasParallelToolCalls: body["parallel_tool_calls"] !== undefined,
    hasResponseFormat: body["response_format"] !== undefined,
    hasUser: body["user"] !== undefined,
    hasSeed: body["seed"] !== undefined,
    model: typeof body["model"] === "string" ? body["model"] : null,
  };
}

function summarizeOpenAICompatibleMessages(
  body: OpenAICompatibleRequestBody,
): Record<string, number> {
  const messages = body["messages"];
  if (!Array.isArray(messages)) {
    return {
      totalMessages: 0,
      assistantMessages: 0,
      assistantMessagesWithReasoning: 0,
      toolMessages: 0,
      assistantMessagesWithToolCalls: 0,
    };
  }

  let assistantMessages = 0;
  let assistantMessagesWithReasoning = 0;
  let toolMessages = 0;
  let assistantMessagesWithToolCalls = 0;
  let assistantMessagesWithArrayContent = 0;

  for (const rawMessage of messages) {
    if (typeof rawMessage !== "object" || rawMessage === null) {
      continue;
    }

    const message = rawMessage as Record<string, unknown>;
    if (message["role"] === "assistant") {
      assistantMessages += 1;
      if (typeof message["reasoning_content"] === "string") {
        assistantMessagesWithReasoning += 1;
      }
      if (Array.isArray(message["content"])) {
        assistantMessagesWithArrayContent += 1;
      }
      if (
        Array.isArray(message["tool_calls"]) &&
        message["tool_calls"].length > 0
      ) {
        assistantMessagesWithToolCalls += 1;
      }
      continue;
    }

    if (message["role"] === "tool") {
      toolMessages += 1;
    }
  }

  return {
    totalMessages: messages.length,
    assistantMessages,
    assistantMessagesWithReasoning,
    toolMessages,
    assistantMessagesWithToolCalls,
    assistantMessagesWithArrayContent,
  };
}

function normalizeOpenAICompatibleMessageContent(
  body: OpenAICompatibleRequestBody,
): {
  body: OpenAICompatibleRequestBody;
  normalizedAssistantToolCallMessages: number;
} {
  const messages = body["messages"];
  if (!Array.isArray(messages)) {
    return {
      body,
      normalizedAssistantToolCallMessages: 0,
    };
  }

  let normalizedAssistantToolCallMessages = 0;
  const nextMessages = messages.map((rawMessage) => {
    if (typeof rawMessage !== "object" || rawMessage === null) {
      return rawMessage;
    }

    const message = rawMessage as Record<string, unknown>;
    const isAssistantToolCallMessage =
      message["role"] === "assistant" &&
      Array.isArray(message["tool_calls"]) &&
      message["tool_calls"].length > 0;

    if (!isAssistantToolCallMessage || !Array.isArray(message["content"])) {
      return rawMessage;
    }

    if (message["content"].length > 0) {
      return rawMessage;
    }

    normalizedAssistantToolCallMessages += 1;
    return {
      ...message,
      content: "",
    };
  });

  if (normalizedAssistantToolCallMessages === 0) {
    return {
      body,
      normalizedAssistantToolCallMessages,
    };
  }

  return {
    body: {
      ...body,
      messages: nextMessages,
    },
    normalizedAssistantToolCallMessages,
  };
}

function createOpenAICompatibleFetch(
  modelId: string,
  profile: OpenAICompatibleProfile,
): typeof fetch {
  const baseFetch = globalThis.fetch.bind(globalThis);

  return async (input: string | URL | Request, init: RequestInit | undefined) => {
    const parsedBody = tryParseOpenAICompatibleBody(init?.body);
    if (!parsedBody) {
      return baseFetch(input, init);
    }

    const shouldReplayReasoningContent =
      shouldReplayOpenAICompatibleReasoningContent(profile, parsedBody);
    const reasoningReplay = shouldReplayReasoningContent
      ? openAICompatibleReasoningReplayStorage.getStore()
      : undefined;
    const replayedBody = applyOpenAICompatibleReasoningReplay(
      parsedBody,
      reasoningReplay,
    );

    const normalizedBody = normalizeOpenAICompatibleMessageContent(
      replayedBody.body,
    );

    const sanitizedBody = sanitizeOpenAICompatibleRequestBody(
      normalizedBody.body,
      "default",
    );
    logInfo("Runtime", "OpenAI-compatible request summary", {
      modelId,
      profileModel: profile.model,
      baseUrl: profile.baseUrl,
      reasoningContentMode: normalizeReasoningContentMode(profile),
      reasoningReplay: {
        shouldReplayReasoningContent,
        assistantMessages: replayedBody.assistantMessages,
        replayedAssistantMessages: replayedBody.replayedAssistantMessages,
      },
      normalizedAssistantToolCallMessages:
        normalizedBody.normalizedAssistantToolCallMessages,
      messageSummary: summarizeOpenAICompatibleMessages(sanitizedBody),
      request: summarizeOpenAICompatibleRequestBody(sanitizedBody),
    });

    const firstResponse = await baseFetch(input, {
      ...init,
      body: JSON.stringify(sanitizedBody),
    });

    if (firstResponse.status !== 400) {
      return firstResponse;
    }

    const firstBodyText = await firstResponse.clone().text();
    logWarn("Runtime", "OpenAI-compatible request rejected", {
      modelId,
      status: firstResponse.status,
      body: firstBodyText.slice(0, 500),
      reasoningContentMode: normalizeReasoningContentMode(profile),
      reasoningReplay: {
        shouldReplayReasoningContent,
        assistantMessages: replayedBody.assistantMessages,
        replayedAssistantMessages: replayedBody.replayedAssistantMessages,
      },
      normalizedAssistantToolCallMessages:
        normalizedBody.normalizedAssistantToolCallMessages,
      messageSummary: summarizeOpenAICompatibleMessages(sanitizedBody),
      request: summarizeOpenAICompatibleRequestBody(sanitizedBody),
    });

    const fallbackBody = sanitizeOpenAICompatibleRequestBody(
      normalizedBody.body,
      "fallback",
    );
    if (JSON.stringify(fallbackBody) === JSON.stringify(sanitizedBody)) {
      return firstResponse;
    }

    logWarn("Runtime", "Retrying OpenAI-compatible request with stricter body", {
      modelId,
      request: summarizeOpenAICompatibleRequestBody(fallbackBody),
    });

    return baseFetch(input, {
      ...init,
      body: JSON.stringify(fallbackBody),
    });
  };
}

function attachOpenAICompatibleReasoningReplay(chatModel: ChatOpenAI): void {
  const modelWithInternals = chatModel as ChatOpenAI & {
    _generate: (
      messages: unknown[],
      options: unknown,
      runManager?: unknown,
    ) => Promise<unknown>;
    _streamResponseChunks: (
      messages: unknown[],
      options: unknown,
      runManager?: unknown,
    ) => AsyncGenerator<unknown>;
  };

  const originalGenerate = modelWithInternals._generate.bind(chatModel);
  modelWithInternals._generate = (messages, options, runManager) => {
    const reasoningReplay = extractOpenAICompatibleReasoningReplay(messages);
    return openAICompatibleReasoningReplayStorage.run(reasoningReplay, () =>
      originalGenerate(messages, options, runManager),
    );
  };

  const originalStreamResponseChunks =
    modelWithInternals._streamResponseChunks.bind(chatModel);
  modelWithInternals._streamResponseChunks = (messages, options, runManager) => {
    const reasoningReplay = extractOpenAICompatibleReasoningReplay(messages);
    return openAICompatibleReasoningReplayStorage.run(reasoningReplay, () =>
      originalStreamResponseChunks(messages, options, runManager),
    );
  };
}

function createCustomOpenAIChatModel(
  modelId: string,
  profile: OpenAICompatibleProfile,
): ChatOpenAI {
  let baseURL = profile.baseUrl.trim().replace(/\/$/, "");
  if (!baseURL.includes("/v1")) {
    baseURL = `${baseURL}/v1`;
  }

  const key = profile.apiKey?.trim() ?? "";
  const thinkingType = normalizeCustomModelThinkingType(profile);
  const thinkingEffort = normalizeOpenAIReasoningEffort(profile);
  const reasoningContentMode = normalizeReasoningContentMode(profile);
  const modelKwargs = {
    thinking: {
      type: thinkingType,
    },
  } as const;

  logInfo("Runtime", "Configuring OpenAI-format custom model", {
    modelId,
    baseURL,
    profileModel: profile.model,
    thinkingType,
    thinkingEffort: thinkingType === "enabled" ? thinkingEffort : null,
    reasoningContentMode,
    modelKwargs,
    timeoutMs: MODEL_REQUEST_TIMEOUT_MS,
    proxyEnv: {
      NODE_USE_ENV_PROXY: process.env["NODE_USE_ENV_PROXY"] ?? null,
      HTTP_PROXY: process.env["HTTP_PROXY"] ? "<set>" : null,
      HTTPS_PROXY: process.env["HTTPS_PROXY"] ? "<set>" : null,
      ALL_PROXY: process.env["ALL_PROXY"] ? "<set>" : null,
    },
  });

  const chatModel = new ChatOpenAI({
    model: profile.model,
    apiKey: key.length > 0 ? key : "sk-placeholder-no-key",
    configuration: {
      baseURL,
      fetch: createOpenAICompatibleFetch(modelId, profile),
    },
    modelKwargs,
    useResponsesApi: false,
    streamUsage: true,
    timeout: MODEL_REQUEST_TIMEOUT_MS,
    maxRetries: 1,
  });

  attachOpenAICompatibleReasoningReplay(chatModel);

  return applyContextWindowProfile(
    chatModel,
    getContextWindowForModel(profile.model, profile.contextWindow),
  );
}

function createCustomAnthropicChatModel(
  modelId: string,
  profile: OpenAICompatibleProfile,
): ChatAnthropic {
  const apiUrl = profile.baseUrl.trim().replace(/\/$/, "");
  const key = profile.apiKey?.trim() ?? "";
  const thinkingType = normalizeCustomModelThinkingType(profile);
  const thinkingEffort = normalizeCustomModelThinkingEffort(profile);
  const outputConfig =
    thinkingType === "enabled"
      ? ({ effort: thinkingEffort } as const)
      : undefined;
  const invocationKwargs =
    thinkingType === "enabled"
      ? ({ thinking: { type: "enabled" } } as const)
      : undefined;

  logInfo("Runtime", "Configuring Anthropic-format custom model", {
    modelId,
    apiUrl,
    profileModel: profile.model,
    thinkingType,
    thinkingEffort: outputConfig?.effort ?? null,
  });

  const chatModel = new ChatAnthropic({
    model: profile.model,
    anthropicApiKey: key.length > 0 ? key : "sk-placeholder-no-key",
    anthropicApiUrl: apiUrl,
    maxRetries: 1,
    ...(outputConfig ? { outputConfig } : {}),
    ...(invocationKwargs ? { invocationKwargs } : {}),
  });

  return applyContextWindowProfile(
    chatModel,
    getContextWindowForModel(profile.model, profile.contextWindow),
  );
}

export async function getCheckpointer(threadId: string): Promise<SqlJsSaver> {
  let checkpointer = checkpointers.get(threadId);
  if (!checkpointer) {
    const dbPath = getThreadCheckpointPath(threadId);
    checkpointer = new SqlJsSaver(dbPath);
    await checkpointer.initialize();
    checkpointers.set(threadId, checkpointer);
  }
  return checkpointer;
}

export async function closeCheckpointer(threadId: string): Promise<void> {
  const checkpointer = checkpointers.get(threadId);
  if (checkpointer) {
    await checkpointer.close();
    checkpointers.delete(threadId);
  }
}

export async function closeAllRuntimeResources(): Promise<void> {
  await Promise.all(
    Array.from(checkpointers.keys()).map((threadId) => closeCheckpointer(threadId)),
  );
  await closeAllMCPConnections();
}

// Get the appropriate model instance based on configuration
function getModelInstance(
  modelId?: string,
): ChatAnthropic | ChatOpenAI | ChatGoogleGenerativeAI | string {
  const model = modelId || getDefaultModel();
  console.log("[Runtime] Using model:", model);

  if (typeof model !== "string" || model.trim().length === 0) {
    throw new Error(
      "No custom model configured. Please add a model in Settings > Custom Model Config.",
    );
  }

  // Determine provider from model ID
  if (model.startsWith("claude")) {
    const apiKey = getApiKey("anthropic");
    console.log("[Runtime] Anthropic API key present:", !!apiKey);
    if (!apiKey) {
      throw new Error("Anthropic API key not configured");
    }
    return new ChatAnthropic({
      model,
      anthropicApiKey: apiKey,
    });
  } else if (
    model.startsWith("gpt") ||
    model.startsWith("o1") ||
    model.startsWith("o3") ||
    model.startsWith("o4")
  ) {
    const apiKey = getApiKey("openai");
    console.log("[Runtime] OpenAI API key present:", !!apiKey);
    if (!apiKey) {
      throw new Error("OpenAI API key not configured");
    }
    return new ChatOpenAI({
      model,
      apiKey,
      timeout: MODEL_REQUEST_TIMEOUT_MS,
      maxRetries: 1,
    });
  } else if (model.startsWith("gemini")) {
    const apiKey = getApiKey("google");
    console.log("[Runtime] Google API key present:", !!apiKey);
    if (!apiKey) {
      throw new Error("Google API key not configured");
    }
    return new ChatGoogleGenerativeAI({
      model,
      apiKey: apiKey,
    });
  } else if (model.startsWith("oac:")) {
    const profile = getOpenAICompatibleProfileByModelId(model);
    console.log("[Runtime] OpenAI-compatible profile present:", !!profile);
    if (!profile) {
      throw new Error("OpenAI-compatible endpoint not found");
    }
    const apiFormat = normalizeCustomModelApiFormat(profile);
    return apiFormat === "anthropic"
      ? createCustomAnthropicChatModel(model, profile)
      : createCustomOpenAIChatModel(model, profile);
  }

  // Default to model string (let deepagents handle it)
  return model;
}

export interface CreateAgentRuntimeOptions {
  /** Thread ID - REQUIRED for per-thread checkpointing */
  threadId: string;
  /** Model ID to use (defaults to configured default model) */
  modelId?: string;
  /** Workspace path - REQUIRED for agent to operate on files */
  workspacePath: string;
}

// Create agent runtime with configured model and checkpointer

export async function createAgentRuntime(
  options: CreateAgentRuntimeOptions,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  const { threadId, modelId, workspacePath } = options;

  if (!threadId) {
    throw new Error("Thread ID is required for checkpointing.");
  }

  if (!workspacePath) {
    throw new Error(
      "Workspace path is required. Please select a workspace folder before running the agent.",
    );
  }

  logInfo("Runtime", "Creating agent runtime", {
    threadId,
    workspacePath,
    modelId,
    packaged: !process.env["ELECTRON_RENDERER_URL"],
  });

  const model = getModelInstance(modelId);
  logInfo("Runtime", "Model instance created", { modelType: typeof model });

  const checkpointer = await getCheckpointer(threadId);
  logInfo("Runtime", "Checkpointer ready", { threadId });

  const backend = new LocalSandbox({
    rootDir: workspacePath,
    virtualMode: false, // Use absolute system paths for consistency with shell commands
    timeout: 120_000, // 2 minutes
    maxOutputBytes: 100_000, // ~100KB
  });

  const systemPrompt = getSystemPrompt(workspacePath);

  // Custom filesystem prompt for absolute paths (matches virtualMode: false)
  const filesystemSystemPrompt = getFilesystemSystemPrompt(workspacePath);

  const skills = resolveSkillSourcesForWorkspace(workspacePath);
  const thread = getThread(threadId);
  const metadata = thread?.metadata
    ? (JSON.parse(thread.metadata) as ThreadMetadata)
    : {};
  const enabledMcpServerIds =
    metadata.enabledMcpServerIds ??
    ((settingsStore.get("enabledMcpServerIds", []) as string[]) ?? []);
  const enabledMcpServers = enabledMcpServerIds
    .map((id) => getMCPServerById(id))
    .filter((server): server is NonNullable<typeof server> => Boolean(server));
  const mcpTools = await getMCPToolsForServers(enabledMcpServers);
  logInfo("Runtime", "Resolved runtime dependencies", {
    skills: skills.length,
    enabledMcpServers: enabledMcpServers.length,
    mcpTools: mcpTools.length,
  });
  const interruptOnEntries = new Set<string>(["execute"]);
  for (const tool of mcpTools as ApprovalAliasTool[]) {
    if (typeof tool.name === "string" && tool.name.length > 0) {
      interruptOnEntries.add(tool.name);
    }
    for (const alias of tool.__approvalAliases ?? []) {
      if (typeof alias === "string" && alias.length > 0) {
        interruptOnEntries.add(alias);
      }
    }
  }
  const interruptOn = Object.fromEntries(
    Array.from(interruptOnEntries, (toolName) => [toolName, true] as const),
  );

  const agent = createDeepAgent({
    model,
    checkpointer,
    backend,
    systemPrompt,
    // Custom filesystem prompt for absolute paths (requires deepagents update)
    filesystemSystemPrompt,
    // Require human approval for shell commands and enabled MCP tools.
    interruptOn,
    middleware: [runtimeToolErrorMiddleware],
    ...(mcpTools.length > 0 ? { tools: mcpTools } : {}),
    ...(skills.length > 0 ? { skills } : {}),
  } as Parameters<typeof createDeepAgent>[0]);

  logInfo("Runtime", "Deep agent created", { workspacePath, threadId });
  return agent;
}
