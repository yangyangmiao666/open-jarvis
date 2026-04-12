import { createDeepAgent } from "deepagents";
import { getDefaultModel } from "../ipc/models";
import { getOpenAICompatibleProfileByModelId } from "../openai-compatible-profiles";
import { getApiKey, getThreadCheckpointPath } from "../storage";
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatOpenAI, ChatOpenAICompletions } from "@langchain/openai";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { SqlJsSaver } from "../checkpointer/sqljs-saver";
import { LocalSandbox } from "./local-sandbox";

import { BASE_SYSTEM_PROMPT } from "./system-prompt";
import { resolveSkillSourcesForWorkspace } from "../skill-config";

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

function normalizeOpenAICompatibleMessages(request: unknown): {
  request: unknown;
  normalizedCount: number;
} {
  if (!request || typeof request !== "object")
    return { request, normalizedCount: 0 };
  const messages = (request as { messages?: unknown }).messages;
  if (!Array.isArray(messages)) return { request, normalizedCount: 0 };

  let normalizedCount = 0;
  const normalizedMessages = messages.map((message) => {
    if (!message || typeof message !== "object") return message;
    const content = (message as { content?: unknown }).content;
    if (!Array.isArray(content)) return message;
    normalizedCount += 1;

    return {
      ...message,
      content: content
        .map(stringifyOpenAICompatibleContentPart)
        .filter((value) => value.length > 0)
        .join("\n"),
    };
  });

  return {
    request: {
      ...(request as Record<string, unknown>),
      messages: normalizedMessages,
    },
    normalizedCount,
  };
}

class OpenAICompatibleChatCompletions extends ChatOpenAICompletions {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  override async completionWithRetry(request: any, requestOptions?: any) {
    const { request: normalizedRequest, normalizedCount } =
      normalizeOpenAICompatibleMessages(request);
    if (normalizedCount > 0) {
      console.log(
        `[Runtime] Normalized ${normalizedCount} array-format message(s) for OpenAI-compatible API`,
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

// Get the appropriate model instance based on configuration
function getModelInstance(
  modelId?: string,
): ChatAnthropic | ChatOpenAI | ChatGoogleGenerativeAI | string {
  const model = modelId || getDefaultModel();
  console.log("[Runtime] Using model:", model);

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
    let baseURL = profile.baseUrl.trim().replace(/\/$/, "");
    if (!baseURL.includes("/v1")) {
      baseURL = `${baseURL}/v1`;
    }
    const key = profile.apiKey?.trim() ?? "";
    return new ChatOpenAI({
      model: profile.model,
      apiKey: key.length > 0 ? key : "sk-placeholder-no-key",
      configuration: { baseURL },
      useResponsesApi: false,
      completions: new OpenAICompatibleChatCompletions({
        model: profile.model,
        apiKey: key.length > 0 ? key : "sk-placeholder-no-key",
        configuration: { baseURL },
      }),
    });
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

  console.log("[Runtime] Creating agent runtime...");
  console.log("[Runtime] Thread ID:", threadId);
  console.log("[Runtime] Workspace path:", workspacePath);

  const model = getModelInstance(modelId);
  console.log("[Runtime] Model instance created:", typeof model);

  const checkpointer = await getCheckpointer(threadId);
  console.log("[Runtime] Checkpointer ready for thread:", threadId);

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

  const agent = createDeepAgent({
    model,
    checkpointer,
    backend,
    systemPrompt,
    // Custom filesystem prompt for absolute paths (requires deepagents update)
    filesystemSystemPrompt,
    // Require human approval for all shell commands
    interruptOn: { execute: true },
    ...(skills.length > 0 ? { skills } : {}),
  } as Parameters<typeof createDeepAgent>[0]);

  console.log(
    "[Runtime] Deep agent created with LocalSandbox at:",
    workspacePath,
  );
  return agent;
}
