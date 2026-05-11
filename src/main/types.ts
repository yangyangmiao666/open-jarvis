// Thread types matching langgraph-api
export type ThreadStatus = "idle" | "busy" | "interrupted" | "error";

// =============================================================================
// IPC Handler Parameter Types
// =============================================================================

// Agent IPC
export interface AgentInvokeParams {
  threadId: string;
  message: string;
  modelId?: string;
  /** Workspace-relative paths (e.g. /src/foo.ts) the user @-referenced */
  referencedPaths?: string[];
}

export interface AgentResumeParams {
  threadId: string;
  command: {
    resume?: {
      decision?: string;
      rememberForWorkspace?: boolean;
      request?: HITLRequest;
      requests?: HITLRequest[];
    };
  };
  modelId?: string;
}

export interface AgentInterruptParams {
  threadId: string;
  decision: HITLDecision;
}

export interface AgentCancelParams {
  threadId: string;
}

// Thread IPC
export interface ThreadUpdateParams {
  threadId: string;
  updates: Partial<Thread>;
}

export interface ThreadRewindParams {
  threadId: string;
  userMessageOrdinal: number;
  messageText: string;
}

// Workspace IPC
export interface WorkspaceSetParams {
  threadId?: string;
  path: string | null;
}

export interface WorkspaceLoadParams {
  threadId: string;
}

export interface WorkspaceOpenFolderParams {
  threadId?: string;
}

export interface WorkspaceFileParams {
  threadId: string;
  filePath: string;
}

export interface MCPEnabledServersParams {
  threadId?: string;
  serverIds: string[];
}

export interface MCPImportInput {
  json: string;
}

// Model IPC
export interface SetApiKeyParams {
  provider: string;
  apiKey: string;
}

export interface ProxyConfig {
  httpProxy: string;
  httpsProxy: string;
  allProxy: string;
}

// =============================================================================

export interface Thread {
  thread_id: string;
  created_at: Date;
  updated_at: Date;
  metadata?: Record<string, unknown>;
  status: ThreadStatus;
  thread_values?: Record<string, unknown>;
  title?: string;
}

// Run types
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

export interface MCPImportedServerInput {
  name: string;
  command?: string;
  args?: unknown;
  env?: unknown;
  headers?: unknown;
  cwd?: string;
  url?: string;
  transport?: string;
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

export interface Provider {
  id: ProviderId;
  name: string;
  hasApiKey: boolean;
}

/** User-defined OpenAI-compatible API endpoint (custom base URL + model id). */
export interface OpenAICompatibleProfile {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  contextWindow?: number;
}

// Model configuration
export interface ModelConfig {
  id: string;
  name: string;
  provider: ProviderId;
  model: string;
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
}

// Stream events from agent
export type StreamEvent =
  | { type: "message"; message: Message }
  | { type: "tool_call"; toolCall: ToolCall }
  | { type: "tool_result"; toolResult: ToolResult }
  | { type: "interrupt"; request: HITLRequest }
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
  created_at: Date;
}

export interface ContentBlock {
  type: "text" | "image" | "tool_use" | "tool_result";
  text?: string;
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

// Human-in-the-loop
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

// Todo types (from deepagentsjs)
export interface Todo {
  id: string;
  content: string;
  status: "pending" | "in_progress" | "completed" | "cancelled";
}

// File types (from deepagentsjs backends)
export interface FileInfo {
  path: string;
  is_dir?: boolean;
  size?: number;
  modified_at?: string;
  /** ISO timestamp; from stat.birthtime when available else ctime */
  created_at?: string;
}

export interface GrepMatch {
  path: string;
  line: number;
  text: string;
}
