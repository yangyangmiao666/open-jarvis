import type {
  Thread,
  ModelConfig,
  Provider,
  StreamEvent,
  HITLDecision,
  MCPImportResult,
  MCPServerConfig,
  OpenAICompatibleProfile,
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
    generateTitle: (message: string) => Promise<string>;
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
  };
}

declare global {
  interface Window {
    electron: ElectronAPI;
    api: CustomAPI;
  }
}
