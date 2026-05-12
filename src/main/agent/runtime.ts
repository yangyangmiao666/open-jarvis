import { createDeepAgent } from "deepagents";
import Store from "electron-store";
import { createMiddleware } from "langchain";
import { getThread } from "../db";
import { getDefaultModel } from "../ipc/models";
import { getMCPServerById } from "../mcp-config";
import { getOpenAICompatibleProfileByModelId } from "../openai-compatible-profiles";
import { getApiKey, getOpenworkDir, getThreadCheckpointPath } from "../storage";
import { ToolMessage } from "@langchain/core/messages";
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatOpenAI, ChatOpenAICompletions } from "@langchain/openai";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { SqlJsSaver } from "../checkpointer/sqljs-saver";
import { LocalSandbox } from "./local-sandbox";
import { closeAllMCPConnections, getMCPToolsForServers } from "./mcp-runtime";

import { BASE_SYSTEM_PROMPT } from "./system-prompt";
import { resolveSkillSourcesForWorkspace } from "../skill-config";
import type {
  CustomModelApiFormat,
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

interface ApprovalAliasTool {
  name?: string;
  __approvalAliases?: string[];
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
      return await handler(request);
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

// Per-thread checkpointer cache
const checkpointers = new Map<string, SqlJsSaver>();
const settingsStore = new Store({
  name: "settings",
  cwd: getOpenworkDir(),
});

function sanitizeModelText(value: string): string {
  if (typeof value.toWellFormed === "function") {
    return value.toWellFormed();
  }
  return value.replace(
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g,
    "\uFFFD",
  );
}

function stringifyOpenAICompatibleContentPart(part: unknown): string {
  if (typeof part === "string") return sanitizeModelText(part);
  if (part == null) return "";
  if (typeof part !== "object") return String(part);

  const record = part as Record<string, unknown>;
  if (typeof record.text === "string") return sanitizeModelText(record.text);
  if (typeof record.input_text === "string")
    return sanitizeModelText(record.input_text);
  if (typeof record.output_text === "string")
    return sanitizeModelText(record.output_text);
  if (typeof record.refusal === "string")
    return sanitizeModelText(record.refusal);
  if (typeof record.content === "string")
    return sanitizeModelText(record.content);

  const type = typeof record.type === "string" ? record.type : "";
  const mimeType =
    typeof record.mimeType === "string"
      ? record.mimeType
      : "application/octet-stream";
  if (type.includes("image")) return `[image content omitted: ${mimeType}]`;
  if (type.includes("audio")) return `[audio content omitted: ${mimeType}]`;
  if (type.includes("video")) return `[video content omitted: ${mimeType}]`;
  if (type.includes("file")) return `[file content omitted: ${mimeType}]`;

  return `[unsupported content block${type ? `: ${type}` : ""}]`;
}

function extractOpenAICompatibleReasoningPart(part: unknown): string {
  if (!part || typeof part !== "object") return "";
  const record = part as Record<string, unknown>;
  const type = typeof record.type === "string" ? record.type : "";

  if (typeof record.reasoning_content === "string") {
    return sanitizeModelText(record.reasoning_content);
  }
  if (typeof record.reasoning === "string") {
    return sanitizeModelText(record.reasoning);
  }
  if (typeof record.thinking === "string") {
    return sanitizeModelText(record.thinking);
  }
  if (typeof record.think === "string") {
    return sanitizeModelText(record.think);
  }

  if (type.includes("reasoning") || type.includes("thinking")) {
    if (typeof record.text === "string") {
      return sanitizeModelText(record.text);
    }
    if (typeof record.content === "string") {
      return sanitizeModelText(record.content);
    }
  }

  return "";
}

function extractReasoningFromRecord(record: Record<string, unknown>): string {
  const directCandidates: unknown[] = [
    record.reasoning_content,
    record.reasoning,
    record.thinking,
    record.think,
  ];

  for (const candidate of directCandidates) {
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return sanitizeModelText(candidate);
    }
  }

  const nestedContainers: unknown[] = [
    record.additional_kwargs,
    record.kwargs,
    record.response_metadata,
    record.metadata,
  ];

  for (const container of nestedContainers) {
    if (!container || typeof container !== "object") continue;
    const nested = container as Record<string, unknown>;
    const nestedCandidate =
      nested.reasoning_content ?? nested.reasoning ?? nested.thinking;
    if (
      typeof nestedCandidate === "string" &&
      nestedCandidate.trim().length > 0
    ) {
      return sanitizeModelText(nestedCandidate);
    }
  }

  return "";
}

function fallbackReasoningForAssistantMessage(
  message: Record<string, unknown>,
  textParts: string[],
): string {
  if (textParts.length > 0) {
    return textParts.join("\n");
  }

  const content = message.content;
  if (typeof content === "string" && content.trim().length > 0) {
    return sanitizeModelText(content);
  }

  const toolCalls =
    (Array.isArray(message.tool_calls) ? message.tool_calls : null) ??
    (Array.isArray((message.additional_kwargs as { tool_calls?: unknown })?.tool_calls)
      ? ((message.additional_kwargs as { tool_calls?: unknown }).tool_calls as unknown[])
      : null);

  if (toolCalls && toolCalls.length > 0) {
    const names = toolCalls
      .map((call) => {
        if (!call || typeof call !== "object") return "tool";
        const record = call as Record<string, unknown>;
        const fn = record.function;
        if (fn && typeof fn === "object") {
          const name = (fn as { name?: unknown }).name;
          if (typeof name === "string" && name.trim().length > 0) {
            return name;
          }
        }
        const name = record.name;
        if (typeof name === "string" && name.trim().length > 0) {
          return name;
        }
        return "tool";
      })
      .join(", ");
    return `tool-calls: ${names}`;
  }

  // DeepSeek thinking mode requires reasoning_content on assistant turns.
  return "assistant-response";
}

function normalizeOpenAICompatibleMessage(
  message: unknown,
): { message: unknown; normalized: boolean } {
  if (!message || typeof message !== "object") {
    return { message, normalized: false };
  }

  const role =
    typeof (message as { role?: unknown }).role === "string"
      ? ((message as { role?: string }).role ?? "")
      : "";
  const content = (message as { content?: unknown }).content;
  const messageRecord = message as Record<string, unknown>;
  const existingReasoning = extractReasoningFromRecord(messageRecord);

  // Compatibility path for already-stringified assistant history messages.
  if (!Array.isArray(content)) {
    if (
      role === "assistant" &&
      (typeof content === "string" || content == null || typeof content === "object")
    ) {
      const fallbackReasoning =
        existingReasoning || fallbackReasoningForAssistantMessage(messageRecord, []);
      return {
        message: {
          ...messageRecord,
          reasoning_content: fallbackReasoning,
        },
        normalized: true,
      };
    }

    return { message, normalized: false };
  }

  const textParts = content
    .map(stringifyOpenAICompatibleContentPart)
    .filter((value) => value.length > 0);
  const normalizedMessage: Record<string, unknown> = {
    ...messageRecord,
    content: textParts.join("\n"),
  };

  if (role === "assistant") {
    const reasoningParts = content
      .map(extractOpenAICompatibleReasoningPart)
      .filter((value) => value.length > 0);
    if (reasoningParts.length > 0) {
      normalizedMessage.reasoning_content = reasoningParts.join("\n");
    } else {
      normalizedMessage.reasoning_content =
        existingReasoning ||
        fallbackReasoningForAssistantMessage(messageRecord, textParts);
    }
  }

  return { message: normalizedMessage, normalized: true };
}

function normalizeOpenAICompatibleMessages(request: unknown): {
  request: unknown;
  normalizedCount: number;
  retainedReasoningCount: number;
  prunedReasoningCount: number;
} {
  if (!request || typeof request !== "object")
    return {
      request,
      normalizedCount: 0,
      retainedReasoningCount: 0,
      prunedReasoningCount: 0,
    };
  const messages = (request as { messages?: unknown }).messages;
  if (!Array.isArray(messages)) {
    return {
      request,
      normalizedCount: 0,
      retainedReasoningCount: 0,
      prunedReasoningCount: 0,
    };
  }

  let normalizedCount = 0;
  const normalizedMessages = messages.map((message) => {
    const normalized = normalizeOpenAICompatibleMessage(message);
    if (normalized.normalized) normalizedCount += 1;
    return normalized.message;
  });

  let latestAssistantReasoningIndex = -1;
  for (let index = normalizedMessages.length - 1; index >= 0; index -= 1) {
    const message = normalizedMessages[index];
    if (!message || typeof message !== "object") {
      continue;
    }

    const record = message as Record<string, unknown>;
    if (record.role !== "assistant") {
      continue;
    }

    const reasoning = extractReasoningFromRecord(record);
    if (reasoning.length > 0) {
      latestAssistantReasoningIndex = index;
      break;
    }
  }

  let retainedReasoningCount = 0;
  let prunedReasoningCount = 0;
  const historyPrunedMessages = normalizedMessages.map((message, index) => {
    if (!message || typeof message !== "object") {
      return message;
    }

    const record = message as Record<string, unknown>;
    if (record.role !== "assistant") {
      return message;
    }

    const reasoning = extractReasoningFromRecord(record);
    if (reasoning.length === 0) {
      return message;
    }

    if (index === latestAssistantReasoningIndex) {
      retainedReasoningCount += 1;
      return {
        ...record,
        reasoning_content: reasoning,
      };
    }

    prunedReasoningCount += 1;
    const nextMessage = { ...record };
    delete nextMessage.reasoning_content;
    delete nextMessage.reasoning;
    delete nextMessage.thinking;
    delete nextMessage.think;

    for (const containerKey of [
      "additional_kwargs",
      "kwargs",
      "response_metadata",
      "metadata",
    ] as const) {
      const container = nextMessage[containerKey];
      if (!container || typeof container !== "object") {
        continue;
      }

      const nextContainer = { ...(container as Record<string, unknown>) };
      delete nextContainer.reasoning_content;
      delete nextContainer.reasoning;
      delete nextContainer.thinking;
      delete nextContainer.think;
      nextMessage[containerKey] = nextContainer;
    }

    return nextMessage;
  });

  return {
    request: {
      ...(request as Record<string, unknown>),
      messages: historyPrunedMessages,
    },
    normalizedCount,
    retainedReasoningCount,
    prunedReasoningCount,
  };
}

class OpenAICompatibleChatCompletions extends ChatOpenAICompletions {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  override async completionWithRetry(request: any, requestOptions?: any) {
    const {
      request: normalizedRequest,
      normalizedCount,
      retainedReasoningCount,
      prunedReasoningCount,
    } =
      normalizeOpenAICompatibleMessages(request);
    if (normalizedCount > 0 || prunedReasoningCount > 0) {
      console.log(
        `[Runtime] Normalized ${normalizedCount} array-format message(s) and retained ${retainedReasoningCount} latest reasoning block(s) while pruning ${prunedReasoningCount} historical reasoning block(s) for OpenAI-compatible API`,
      );
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (ChatOpenAICompletions.prototype.completionWithRetry as any).call(
      this,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      normalizedRequest as any,
      requestOptions,
    );
  }
}

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
): "high" | "max" {
  return profile.thinkingEffort === "xhigh" || profile.thinkingEffort === "max"
    ? "max"
    : "high";
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
  const thinkingEffort = normalizeCustomModelThinkingEffort(profile);
  const modelKwargs: Record<string, unknown> = {
    thinking: { type: thinkingType },
  };
  if (thinkingType === "enabled") {
    modelKwargs.reasoning_effort = thinkingEffort;
  }

  logInfo("Runtime", "Configuring OpenAI-format custom model", {
    modelId,
    baseURL,
    profileModel: profile.model,
    thinkingType,
    thinkingEffort: thinkingType === "enabled" ? thinkingEffort : null,
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
    configuration: { baseURL },
    useResponsesApi: false,
    timeout: MODEL_REQUEST_TIMEOUT_MS,
    maxRetries: 1,
    modelKwargs,
    completions: new OpenAICompatibleChatCompletions({
      model: profile.model,
      apiKey: key.length > 0 ? key : "sk-placeholder-no-key",
      configuration: { baseURL },
      timeout: MODEL_REQUEST_TIMEOUT_MS,
      maxRetries: 1,
      modelKwargs,
    }),
  });

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
    thinking: { type: "disabled" } as const,
    invocationKwargs,
    outputConfig,
    maxRetries: 1,
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
      "No custom model configured. Please add a model in 设置中枢 > 自定义模型配置.",
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
  const filesystemSystemPrompt = `You have access to a filesystem. All file paths use fully qualified absolute system paths.

- ls: list files in a directory (e.g., ls("${workspacePath}"))
- read_file: read a file from the filesystem
- write_file: write to a file in the filesystem
- edit_file: edit a file in the filesystem
- glob: find files matching a pattern (e.g., "**/*.py")
- grep: search for text within files

The workspace root is: ${workspacePath}`;

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
