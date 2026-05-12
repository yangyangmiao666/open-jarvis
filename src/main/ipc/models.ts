import { IpcMain, dialog, app, shell } from "electron";
import Store from "electron-store";
import * as fs from "fs/promises";
import * as path from "path";
import { decodeTextBuffer } from "../text-encoding";
import type {
  ModelConfig,
  Provider,
  SetApiKeyParams,
  WorkspaceSetParams,
  WorkspaceLoadParams,
  WorkspaceOpenFolderParams,
  WorkspaceFileParams,
  OpenAICompatibleProfile,
} from "../types";
import { startWatching, stopWatching } from "../services/workspace-watcher";
import {
  getOpenworkDir,
  getApiKey,
  setApiKey,
  deleteApiKey,
  hasApiKey,
} from "../storage";
import {
  getOpenAICompatibleProfiles,
  getOpenAICompatibleProfileByModelId,
  upsertOpenAICompatibleProfile,
  deleteOpenAICompatibleProfile,
} from "../openai-compatible-profiles";
import { getThread, updateThread } from "../db";
import { getContextWindowForModel } from "../../model-context";

// Store for non-sensitive settings only (no encryption needed)
const store = new Store({
  name: "settings",
  cwd: getOpenworkDir(),
});

// Provider configurations
const PROVIDERS: Omit<Provider, "hasApiKey">[] = [
  { id: "openai_compatible", name: "自定义模型" },
];

function profileToModelConfig(p: OpenAICompatibleProfile): ModelConfig {
  return {
    id: `oac:${p.id}`,
    name: p.name || `自定义 (${p.model})`,
    provider: "openai_compatible",
    model: p.model,
    contextWindow: getContextWindowForModel(p.model, p.contextWindow),
    description: "",
    available: p.baseUrl.trim().length > 0 && p.model.trim().length > 0,
  };
}

const AVAILABLE_MODELS: ModelConfig[] = [];

function resolveDefaultModelId(): string {
  const stored = store.get("defaultModel", "") as string;
  if (stored.startsWith("oac:") && getOpenAICompatibleProfileByModelId(stored)) {
    return stored;
  }

  const firstProfile = getOpenAICompatibleProfiles()[0];
  return firstProfile ? `oac:${firstProfile.id}` : "";
}

export function registerModelHandlers(ipcMain: IpcMain): void {
  // List available models
  ipcMain.handle("models:list", async () => {
    const compat = getOpenAICompatibleProfiles().map(profileToModelConfig);
    return [...AVAILABLE_MODELS, ...compat];
  });

  // Get default model
  ipcMain.handle("models:getDefault", async () => {
    return resolveDefaultModelId();
  });

  // Set default model
  ipcMain.handle("models:setDefault", async (_event, modelId: string) => {
    store.set("defaultModel", modelId);
  });

  // Set API key for a provider (stored in ~/.openwork/.env)
  ipcMain.handle(
    "models:setApiKey",
    async (_event, { provider, apiKey }: SetApiKeyParams) => {
      setApiKey(provider, apiKey);
    },
  );

  // Get API key for a provider (from ~/.openwork/.env or process.env)
  ipcMain.handle("models:getApiKey", async (_event, provider: string) => {
    return getApiKey(provider) ?? null;
  });

  // Delete API key for a provider
  ipcMain.handle("models:deleteApiKey", async (_event, provider: string) => {
    deleteApiKey(provider);
  });

  // List providers with their API key status
  ipcMain.handle("models:listProviders", async () => {
    const compatOk = getOpenAICompatibleProfiles().some(
      (p) => p.baseUrl.trim() && p.model.trim(),
    );
    return PROVIDERS.map((provider) => ({
      ...provider,
      hasApiKey:
        provider.id === "openai_compatible" ? compatOk : hasApiKey(provider.id),
    }));
  });

  ipcMain.handle("models:openaiCompatibleList", async () => {
    return getOpenAICompatibleProfiles();
  });

  ipcMain.handle(
    "models:openaiCompatibleUpsert",
    async (
      _event,
      profile:
        | OpenAICompatibleProfile
        | (Omit<OpenAICompatibleProfile, "id"> & { id?: string }),
    ) => {
      return upsertOpenAICompatibleProfile(profile);
    },
  );

  ipcMain.handle(
    "models:openaiCompatibleDelete",
    async (_event, id: string) => {
      deleteOpenAICompatibleProfile(id);
    },
  );

  // Sync version info
  ipcMain.on("app:version", (event) => {
    event.returnValue = app.getVersion();
  });

  // Get workspace path for a thread (from thread metadata)
  ipcMain.handle("workspace:get", async (_event, threadId?: string) => {
    if (!threadId) {
      return store.get("workspacePath", null) as string | null;
    }

    // Get from thread metadata via threads:get
    const thread = getThread(threadId);
    if (!thread?.metadata) {
      return store.get("workspacePath", null) as string | null;
    }

    const metadata = JSON.parse(thread.metadata);
    return (
      metadata.workspacePath ||
      (store.get("workspacePath", null) as string | null)
    );
  });

  // Set workspace path globally, optionally mirroring it into the thread metadata for compatibility
  ipcMain.handle(
    "workspace:set",
    async (_event, { threadId, path: newPath }: WorkspaceSetParams) => {
      if (newPath) {
        store.set("workspacePath", newPath);
      } else {
        store.delete("workspacePath");
      }

      if (!threadId) {
        return newPath;
      }

      const thread = getThread(threadId);
      if (!thread) return null;

      const metadata = thread.metadata ? JSON.parse(thread.metadata) : {};
      metadata.workspacePath = newPath;
      updateThread(threadId, { metadata: JSON.stringify(metadata) });

      // Update file watcher
      if (newPath) {
        startWatching(threadId, newPath);
      } else {
        stopWatching(threadId);
      }

      return newPath;
    },
  );

  // Select workspace folder via dialog (for a specific thread)
  ipcMain.handle("workspace:select", async (_event, threadId?: string) => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory", "createDirectory"],
      title: "Select Workspace Folder",
      message: "Choose a folder for the agent to work in",
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    const selectedPath = result.filePaths[0];

    if (threadId) {
      const thread = getThread(threadId);
      if (thread) {
        const metadata = thread.metadata ? JSON.parse(thread.metadata) : {};
        metadata.workspacePath = selectedPath;
        updateThread(threadId, { metadata: JSON.stringify(metadata) });

        // Start watching the new workspace
        startWatching(threadId, selectedPath);
      }
    } else {
      // Fallback to global
      store.set("workspacePath", selectedPath);
    }

    return selectedPath;
  });

  ipcMain.handle(
    "workspace:openCurrentFolder",
    async (_event, { threadId }: WorkspaceOpenFolderParams = {}) => {
      const workspacePath = threadId
        ? await ipcRendererWorkspaceGet(threadId)
        : (store.get("workspacePath", null) as string | null);

      if (!workspacePath) {
        return {
          success: false,
          error: "No workspace configured",
        };
      }

      const errorMessage = await shell.openPath(workspacePath);
      if (errorMessage) {
        return {
          success: false,
          error: errorMessage,
        };
      }

      return { success: true };
    },
  );

  // Load files from disk into the workspace view
  ipcMain.handle(
    "workspace:loadFromDisk",
    async (_event, { threadId }: WorkspaceLoadParams) => {
      const thread = getThread(threadId);
      const metadata = thread?.metadata ? JSON.parse(thread.metadata) : {};
      const workspacePath =
        (metadata.workspacePath as string | null) ||
        (store.get("workspacePath", null) as string | null);

      if (!workspacePath) {
        return {
          success: false,
          error: "No workspace configured",
          files: [],
        };
      }

      try {
        const files: Array<{
          path: string;
          is_dir: boolean;
          size?: number;
          modified_at?: string;
          created_at?: string;
        }> = [];

        function createdFromStat(s: { birthtime: Date; ctime: Date }): string {
          const b = s.birthtime;
          if (b && b.getTime() > 0) return b.toISOString();
          return s.ctime.toISOString();
        }

        // Recursively read directory
        async function readDir(
          dirPath: string,
          relativePath: string = "",
        ): Promise<void> {
          const entries = await fs.readdir(dirPath, { withFileTypes: true });

          for (const entry of entries) {
            // Skip hidden files and common non-project files
            if (entry.name.startsWith(".") || entry.name === "node_modules") {
              continue;
            }

            const fullPath = path.join(dirPath, entry.name);
            const relPath = relativePath
              ? `${relativePath}/${entry.name}`
              : entry.name;

            if (entry.isDirectory()) {
              const stat = await fs.stat(fullPath);
              files.push({
                path: "/" + relPath,
                is_dir: true,
                modified_at: stat.mtime.toISOString(),
                created_at: createdFromStat(stat),
              });
              await readDir(fullPath, relPath);
            } else {
              const stat = await fs.stat(fullPath);
              files.push({
                path: "/" + relPath,
                is_dir: false,
                size: stat.size,
                modified_at: stat.mtime.toISOString(),
                created_at: createdFromStat(stat),
              });
            }
          }
        }

        await readDir(workspacePath);

        // Start watching for file changes
        startWatching(threadId, workspacePath);

        return {
          success: true,
          files,
          workspacePath,
        };
      } catch (e) {
        return {
          success: false,
          error: e instanceof Error ? e.message : "Unknown error",
          files: [],
        };
      }
    },
  );

  // Read a single file's contents from disk
  ipcMain.handle(
    "workspace:readFile",
    async (_event, { threadId, filePath }: WorkspaceFileParams) => {
      const thread = getThread(threadId);
      const metadata = thread?.metadata ? JSON.parse(thread.metadata) : {};
      const workspacePath =
        (metadata.workspacePath as string | null) ||
        (store.get("workspacePath", null) as string | null);

      if (!workspacePath) {
        return {
          success: false,
          error: "No workspace configured",
        };
      }

      try {
        // Convert virtual path to full disk path
        const relativePath = filePath.startsWith("/")
          ? filePath.slice(1)
          : filePath;
        const fullPath = path.join(workspacePath, relativePath);

        // Security check: ensure the resolved path is within the workspace
        const resolvedPath = path.resolve(fullPath);
        const resolvedWorkspace = path.resolve(workspacePath);
        if (!resolvedPath.startsWith(resolvedWorkspace)) {
          return {
            success: false,
            error: "Access denied: path outside workspace",
          };
        }

        // Check if file exists
        const stat = await fs.stat(fullPath);
        if (stat.isDirectory()) {
          return { success: false, error: "Cannot read directory as file" };
        }

        // Read file as bytes, then decode (UTF-8 with GB18030 fallback for legacy encodings)
        const raw = await fs.readFile(fullPath);
        const content = decodeTextBuffer(raw);

        return {
          success: true,
          content,
          size: stat.size,
          modified_at: stat.mtime.toISOString(),
        };
      } catch (e) {
        return {
          success: false,
          error: e instanceof Error ? e.message : "Unknown error",
        };
      }
    },
  );

  // Read a binary file (images, PDFs, etc.) and return as base64
  ipcMain.handle(
    "workspace:readBinaryFile",
    async (_event, { threadId, filePath }: WorkspaceFileParams) => {
      // Get workspace path from thread metadata
      const thread = getThread(threadId);
      const metadata = thread?.metadata ? JSON.parse(thread.metadata) : {};
      const workspacePath = metadata.workspacePath as string | null;

      if (!workspacePath) {
        return {
          success: false,
          error: "No workspace folder linked",
        };
      }

      try {
        // Convert virtual path to full disk path
        const relativePath = filePath.startsWith("/")
          ? filePath.slice(1)
          : filePath;
        const fullPath = path.join(workspacePath, relativePath);

        // Security check: ensure the resolved path is within the workspace
        const resolvedPath = path.resolve(fullPath);
        const resolvedWorkspace = path.resolve(workspacePath);
        if (!resolvedPath.startsWith(resolvedWorkspace)) {
          return {
            success: false,
            error: "Access denied: path outside workspace",
          };
        }

        // Check if file exists
        const stat = await fs.stat(fullPath);
        if (stat.isDirectory()) {
          return { success: false, error: "Cannot read directory as file" };
        }

        // Read file as binary and convert to base64
        const buffer = await fs.readFile(fullPath);
        const base64 = buffer.toString("base64");

        return {
          success: true,
          content: base64,
          size: stat.size,
          modified_at: stat.mtime.toISOString(),
        };
      } catch (e) {
        return {
          success: false,
          error: e instanceof Error ? e.message : "Unknown error",
        };
      }
    },
  );
}

// Re-export getApiKey from storage for use in agent runtime
export { getApiKey } from "../storage";

export function getDefaultModel(): string {
  return resolveDefaultModelId();
}

async function ipcRendererWorkspaceGet(
  threadId?: string,
): Promise<string | null> {
  if (!threadId) {
    return store.get("workspacePath", null) as string | null;
  }

  const thread = getThread(threadId);
  if (!thread?.metadata) {
    return store.get("workspacePath", null) as string | null;
  }

  const metadata = JSON.parse(thread.metadata);
  return (
    metadata.workspacePath ||
    (store.get("workspacePath", null) as string | null)
  );
}
