// Re-export types from electron for use in renderer
export type ThreadStatus = "idle" | "busy" | "interrupted" | "error";

export interface Thread {
  thread_id: string;
  created_at: Date;
  updated_at: Date;
  metadata?: Record<string, unknown>;
  status: ThreadStatus;
  thread_values?: Record<string, unknown>;
  title?: string;
}

export type RunStatus =
  | "pending"
  | "running"
  | "error"
  | "success"
  | "interrupted";

export interface Run {
  run_id: string;
  thread_id: string;
  assistant_id?: string;
  created_at: Date;
  updated_at: Date;
  status: RunStatus;
  metadata?: Record<string, unknown>;
}

export type MCPTransportType = "stdio" | "sse" | "streamable_http";

export interface MCPServerConfig {
  id: string;
  name: string;
  transport: MCPTransportType;
  command: string;
  args: string[];
  env: Record<string, string>;
  headers: Record<string, string>;
  cwd: string;
  url: string;
  enabled: boolean;
}

export interface MCPImportResult {
  imported: MCPServerConfig[];
  skipped: string[];
}

export interface ThreadMetadata {
  model?: string;
  workspacePath?: string;
  enabledMcpServerIds?: string[];
  approvalMode?: ApprovalMode;
  [key: string]: unknown;
}

export type ApprovalMode = "manual" | "auto";

export interface WorkspaceApprovalRule {
  toolName: string;
  signature: string;
  createdAt: string;
}

// Provider configuration
export type ProviderId =
  | "anthropic"
  | "openai"
  | "google"
  | "ollama"
  | "openai_compatible";

export type CustomModelApiFormat = "openai" | "anthropic";

export type CustomModelThinkingType = "enabled" | "disabled";

export type CustomModelThinkingEffort =
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max";

export type CustomModelReasoningContentMode =
  | "auto"
  | "enabled"
  | "disabled";

export interface SettingsOpenRequest {
  panel?: "models";
  profileId?: string;
}

/** User-defined OpenAI-compatible API endpoint (custom base URL + model id). */
export type GlobalConfigImportMode = "merge" | "replace";

export interface GlobalConfigExport {
  meta: {
    version: 1;
    exportedAt: string;
    appVersion: string;
    includeApiKeys: boolean;
  };
  openaiCompatibleProfiles: OpenAICompatibleProfile[];
  defaultModel: string;
  mcpServers: MCPServerConfig[];
  enabledMcpServerIds: string[];
  proxyConfig: ProxyConfig;
  skills: { name: string; markdown: string }[];
}

export interface GlobalConfigImportResult {
  success: boolean;
  error?: string;
  profilesImported: number;
  serversImported: number;
  skillsImported: number;
  proxyUpdated: boolean;
}

export interface OpenAICompatibleProfile {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  apiFormat?: CustomModelApiFormat;
  thinkingType?: CustomModelThinkingType;
  thinkingEffort?: CustomModelThinkingEffort;
  reasoningContent?: CustomModelReasoningContentMode;
  contextWindow?: number;
}

export interface ProxyConfig {
  httpProxy: string;
  httpsProxy: string;
  allProxy: string;
}

export interface Provider {
  id: ProviderId;
  name: string;
  hasApiKey: boolean;
}

export interface ModelConfig {
  id: string;
  name: string;
  provider: ProviderId;
  model: string;
  apiFormat?: CustomModelApiFormat;
  contextWindow?: number;
  description?: string;
  available: boolean;
}

// Subagent types (from deepagentsjs)
export interface Subagent {
  id: string;
  name: string;
  description: string;
  status: "pending" | "running" | "completed" | "failed";
  startedAt?: Date;
  completedAt?: Date;
  // Used to correlate task tool calls with their responses
  toolCallId?: string;
  // Type of subagent (e.g., 'general-purpose', 'correctness-checker', 'final-reviewer')
  subagentType?: string;
}

export type StreamEvent =
  | { type: "message"; message: Message }
  | { type: "tool_call"; toolCall: ToolCall }
  | { type: "tool_result"; toolResult: ToolResult }
  | { type: "interrupt"; request: HITLRequest; requests?: HITLRequest[] }
  | { type: "token"; token: string }
  | { type: "todos"; todos: Todo[] }
  | { type: "workspace"; files: FileInfo[]; path: string }
  | { type: "subagents"; subagents: Subagent[] }
  | { type: "done"; result: unknown }
  | { type: "error"; error: string };

export interface Message {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string | ContentBlock[];
  tool_calls?: ToolCall[];
  // For tool messages - links result to its tool call
  tool_call_id?: string;
  // For tool messages - the name of the tool
  name?: string;
  // For tool messages - whether the tool execution failed
  is_error?: boolean;
  created_at: Date;
}

export interface ContentBlock {
  type: "text" | "image" | "tool_use" | "tool_result";
  text?: string;
  mimeType?: string;
  tool_use_id?: string;
  name?: string;
  input?: unknown;
  content?: string;
}

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ToolResult {
  tool_call_id: string;
  content: string | unknown;
  is_error?: boolean;
}

export interface HITLRequest {
  id: string;
  tool_call: ToolCall;
  allowed_decisions: HITLDecision["type"][];
}

export interface HITLDecision {
  type: "approve" | "reject" | "edit";
  tool_call_id: string;
  edited_args?: Record<string, unknown>;
  feedback?: string;
}

export interface Todo {
  id: string;
  content: string;
  status: "pending" | "in_progress" | "completed" | "cancelled";
}

export interface FileInfo {
  path: string;
  is_dir?: boolean;
  size?: number;
  modified_at?: string;
  created_at?: string;
}

export interface GrepMatch {
  path: string;
  line: number;
  text: string;
}
