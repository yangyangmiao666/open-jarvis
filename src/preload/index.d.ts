import type {
  ApprovalMode,
  Thread,
  ModelConfig,
  Provider,
  StreamEvent,
  HITLRequest,
  HITLDecision,
  MCPImportResult,
  MCPServerConfig,
  OpenAICompatibleProfile,
  ProxyConfig,
  GlobalConfigImportResult,
  MemoryDocument,
  MemoryDocumentSummary,
  MemoryPromotionCandidate,
  MemorySettings,
} from "../main/types";

interface ElectronAPI {
  ipcRenderer: {
    send: (channel: string, ...args: unknown[]) => void;
    on: (channel: string, listener: (...args: unknown[]) => void) => () => void;
    once: (channel: string, listener: (...args: unknown[]) => void) => void;
    invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
  };
  process: {
    platform: NodeJS.Platform;
    arch: string;
    versions: NodeJS.ProcessVersions;
  };
}

interface CustomAPI {
  agent: {
    invoke: (
      threadId: string,
      message: string,
      onEvent: (event: StreamEvent) => void,
      modelId?: string,
    ) => () => void;
    streamAgent: (
      threadId: string,
      message: string,
      command: unknown,
      onEvent: (event: StreamEvent) => void,
      modelId?: string,
      referencedPaths?: string[],
    ) => () => void;
    interrupt: (
      threadId: string,
      decision: HITLDecision,
      onEvent?: (event: StreamEvent) => void,
    ) => () => void;
    cancel: (threadId: string) => Promise<void>;
  };
  threads: {
    list: () => Promise<Thread[]>;
    get: (threadId: string) => Promise<Thread | null>;
    create: (metadata?: Record<string, unknown>) => Promise<Thread>;
    update: (threadId: string, updates: Partial<Thread>) => Promise<Thread>;
    delete: (threadId: string) => Promise<void>;
    deleteMany: (threadIds: string[]) => Promise<void>;
    getHistory: (threadId: string) => Promise<unknown[]>;
    rewindToMessage: (
      threadId: string,
      targetMessageId: string,
      targetMessageIndex: number,
      targetMessageRole: Message["role"],
      messageText: string,
      toolCallNames?: string[],
    ) => Promise<{ success: boolean; checkpointId: string | null }>;
    generateTitle: (message: string) => Promise<string>;
  };
  approval: {
    getMode: (threadId: string) => Promise<ApprovalMode>;
    setMode: (threadId: string, mode: ApprovalMode) => Promise<ApprovalMode>;
    shouldAutoApprove: (
      threadId: string,
      request: HITLRequest,
    ) => Promise<{
      approved: boolean;
      reason: "mode" | "workspace-rule" | null;
    }>;
  };
  models: {
    list: () => Promise<ModelConfig[]>;
    listProviders: () => Promise<Provider[]>;
    getDefault: () => Promise<string>;
    deleteApiKey: (provider: string) => Promise<void>;
    setDefault: (modelId: string) => Promise<void>;
    setApiKey: (provider: string, apiKey: string) => Promise<void>;
    getApiKey: (provider: string) => Promise<string | null>;
    openaiCompatibleList: () => Promise<OpenAICompatibleProfile[]>;
    openaiCompatibleUpsert: (
      profile:
        | OpenAICompatibleProfile
        | (Omit<OpenAICompatibleProfile, "id"> & { id?: string }),
    ) => Promise<OpenAICompatibleProfile>;
    openaiCompatibleDelete: (id: string) => Promise<void>;
  };
  mcp: {
    listServers: () => Promise<MCPServerConfig[]>;
    upsertServer: (
      config: MCPServerConfig | (Omit<MCPServerConfig, "id"> & { id?: string }),
    ) => Promise<MCPServerConfig>;
    deleteServer: (id: string) => Promise<void>;
    importServers: (json: string) => Promise<MCPImportResult>;
    exportServers: () => Promise<{ mcpServers: Record<string, unknown> }>;
    getEnabledForThread: (threadId?: string) => Promise<string[]>;
    setEnabledForThread: (
      threadId: string | undefined,
      serverIds: string[],
    ) => Promise<string[]>;
  };
  settings: {
    getProxyConfig: () => Promise<ProxyConfig>;
    setProxyConfig: (config: ProxyConfig) => Promise<ProxyConfig>;
    getMemorySettings: () => Promise<MemorySettings>;
    setMemorySettings: (
      config: Partial<MemorySettings>,
    ) => Promise<MemorySettings>;
    listWorkspaceMemories: (threadId?: string) => Promise<{
      success: boolean;
      workspacePath: string | null;
      memoryDir: string | null;
      memories: MemoryDocumentSummary[];
      error?: string;
    }>;
    getWorkspaceMemoryDocument: (
      threadId: string | undefined,
      routePath: string,
    ) => Promise<{
      success: boolean;
      document?: MemoryDocument;
      error?: string;
    }>;
    updateWorkspaceMemoryDocument: (
      threadId: string | undefined,
      routePath: string,
      updates: {
        title: string;
        summary: string;
        body: string;
        nextRoutePath?: string;
      },
    ) => Promise<{
      success: boolean;
      document?: MemoryDocumentSummary;
      error?: string;
    }>;
    deleteWorkspaceMemoryDocument: (
      threadId: string | undefined,
      routePath: string,
    ) => Promise<{ success: boolean; error?: string }>;
    exportGlobalConfigToFile: (options: {
      includeApiKeys: boolean;
    }) => Promise<{ success: boolean; filePath?: string; error?: string }>;
    importGlobalConfigFromFile: (
      mode: "merge" | "replace",
    ) => Promise<GlobalConfigImportResult>;
    getToolingVersions: () => Promise<{
      bun: string | null;
      uv: string | null;
      python: string | null;
    }>;
    showDesktopNotification: (payload: {
      title: string;
      body: string;
    }) => Promise<{ success: boolean; error?: string }>;
  };
  workspace: {
    get: (threadId?: string) => Promise<string | null>;
    set: (
      threadId: string | undefined,
      path: string | null,
    ) => Promise<string | null>;
    select: (threadId?: string) => Promise<string | null>;
    openCurrentFolder: (
      threadId?: string,
    ) => Promise<{ success: boolean; error?: string }>;
    loadFromDisk: (threadId: string) => Promise<{
      success: boolean;
      files: Array<{
        path: string;
        is_dir: boolean;
        size?: number;
        modified_at?: string;
      }>;
      workspacePath?: string;
      error?: string;
    }>;
    readFile: (
      threadId: string,
      filePath: string,
    ) => Promise<{
      success: boolean;
      content?: string;
      size?: number;
      modified_at?: string;
      error?: string;
    }>;
    readBinaryFile: (
      threadId: string,
      filePath: string,
    ) => Promise<{
      success: boolean;
      content?: string;
      size?: number;
      modified_at?: string;
      error?: string;
    }>;
    onFilesChanged: (
      callback: (data: { threadId: string; workspacePath: string }) => void,
    ) => () => void;
  };
  skills: {
    listSources: () => Promise<string[]>;
    setSources: (paths: string[]) => Promise<void>;
    listWorkspaceSkillFolders: (
      threadId?: string,
    ) => Promise<{ success: boolean; folders?: string[]; error?: string }>;
    importFolder: (
      threadId?: string,
    ) => Promise<{ success: boolean; importedName?: string; error?: string }>;
    createSkill: (
      threadId: string | undefined,
      name: string,
      markdown?: string,
    ) => Promise<{ success: boolean; folder?: string; error?: string }>;
    deleteSkillFolders: (
      threadId: string | undefined,
      folderNames: string[],
    ) => Promise<{ success: boolean; error?: string }>;
    readSkillMarkdown: (
      threadId: string | undefined,
      folderName: string,
    ) => Promise<{ success: boolean; content?: string; error?: string }>;
    writeSkillMarkdown: (
      threadId: string | undefined,
      folderName: string,
      content: string,
    ) => Promise<{ success: boolean; error?: string }>;
    renameSkillFolder: (
      threadId: string | undefined,
      oldName: string,
      newName: string,
    ) => Promise<{ success: boolean; folder?: string; error?: string }>;
    confirmPromotion: (
      candidate: MemoryPromotionCandidate,
    ) => Promise<{ success: boolean; folder?: string; error?: string }>;
    settleMemoryAsSkill: (
      workspacePath: string,
      routePath: string,
    ) => Promise<{ success: boolean; folder?: string; error?: string }>;
    undoMemorySettlement: (
      workspacePath: string,
      routePath: string,
    ) => Promise<{ success: boolean; folder?: string; error?: string }>;
    rejectPromotion: (
      candidate: MemoryPromotionCandidate,
    ) => Promise<{ success: boolean; error?: string }>;
  };
}

declare global {
  interface Window {
    electron: ElectronAPI;
    api: CustomAPI;
  }
}
