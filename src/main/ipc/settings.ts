import type { IpcMain } from "electron";
import { BrowserWindow, Notification, clipboard, dialog, nativeImage } from "electron";
import * as fs from "fs/promises";
import { getThread } from "../db";
import { getWorkspaceMemoryDir } from "../memory-config";
import {
  applyGlobalProxyDispatcher,
  getProxyConfigFromEnv,
} from "../proxy-config";
import {
  clearProxyEnvFromProcess,
  getProxyConfig,
  setProxyConfig,
} from "../storage";
import { exportGlobalConfig, importGlobalConfig } from "../global-config";
import { getMemorySettings, setMemorySettings } from "../memory-settings";
import {
  deleteWorkspaceMemoryDocument,
  getWorkspaceMemoryDocument,
  listWorkspaceMemoryDocuments,
  updateWorkspaceMemoryDocument,
} from "../services/memory-service";
import type {
  GlobalConfigExport,
  GlobalConfigImportMode,
  MemoryDocument,
  MemoryDocumentSummary,
  MemorySettings,
  ProxyConfig,
  ResourceStatsSnapshot,
  ThreadMetadata,
} from "../types";
import { getEmbeddedToolingRuntime } from "../tooling";
import Store from "electron-store";
import { getGlobalSkillsRoot } from "../skill-config";
import { getMCPServers } from "../mcp-config";
import { getMCPRuntimeSnapshot } from "../agent/mcp-runtime";
import { getOpenworkDir } from "../storage";
import { decodeTextBuffer } from "../text-encoding";

const store = new Store({
  name: "settings",
  cwd: getOpenworkDir(),
});

function parseThreadMetadata(rawMetadata: unknown): ThreadMetadata {
  if (!rawMetadata) {
    return {};
  }

  if (typeof rawMetadata === "string") {
    try {
      const parsed = JSON.parse(rawMetadata) as unknown;
      return parsed && typeof parsed === "object"
        ? (parsed as ThreadMetadata)
        : {};
    } catch {
      return {};
    }
  }

  return typeof rawMetadata === "object" ? (rawMetadata as ThreadMetadata) : {};
}

async function resolveWorkspacePath(threadId?: string): Promise<string | null> {
  if (!threadId) {
    return null;
  }

  const thread = await getThread(threadId);
  const metadata = parseThreadMetadata(thread?.metadata);
  return typeof metadata.workspacePath === "string"
    ? metadata.workspacePath
    : (store.get("workspacePath", null) as string | null);
}

async function listSkillItems(rootDir: string): Promise<
  Array<{ folderName: string; description: string }>
> {
  try {
    const entries = await fs.readdir(rootDir, { withFileTypes: true });
    const directories = entries.filter((entry) => entry.isDirectory());
    const items = await Promise.all(
      directories.map(async (entry) => {
        const markdownPath = `${rootDir}/${entry.name}/SKILL.md`;
        try {
          const buf = await fs.readFile(markdownPath);
          const content = decodeTextBuffer(buf);
          const firstContentLine = content
            .split(/\r?\n/)
            .map((line) => line.trim())
            .find((line) => line.length > 0 && !line.startsWith("#") && line !== "---");
          return {
            folderName: entry.name,
            description: firstContentLine ?? "",
          };
        } catch {
          return {
            folderName: entry.name,
            description: "",
          };
        }
      }),
    );
    items.sort((left, right) => left.folderName.localeCompare(right.folderName));
    return items;
  } catch {
    return [];
  }
}

async function buildResourceStats(
  threadId?: string,
): Promise<ResourceStatsSnapshot> {
  const workspacePath = await resolveWorkspacePath(threadId);
  const skillsRoot = getGlobalSkillsRoot();
  const globalEnabledMcpServerIds =
    ((store.get("enabledMcpServerIds", []) as string[]) ?? []);
  const [skillItems, memoryDocuments] = await Promise.all([
    listSkillItems(skillsRoot),
    workspacePath
      ? listWorkspaceMemoryDocuments(workspacePath).catch(() => [])
      : Promise.resolve([]),
  ]);

  const threadEnabledMcpServerIds = threadId
    ? parseThreadMetadata(getThread(threadId)?.metadata).enabledMcpServerIds
    : undefined;
  const enabledIds = new Set(
    threadEnabledMcpServerIds ?? globalEnabledMcpServerIds,
  );
  const mcpServers = getMCPServers().filter(
    (server) => server.enabled && enabledIds.has(server.id),
  );
  const mcpSnapshot = getMCPRuntimeSnapshot(mcpServers);

  return {
    skills: {
      loaded: skillItems.length,
      failed: 0,
      items: skillItems,
    },
    memories: {
      loaded: memoryDocuments.length,
      failed: 0,
      items: memoryDocuments.map((document) => ({
        routePath: document.routePath,
        title: document.title,
        summary: document.summary,
      })),
    },
    mcp: {
      loaded: mcpSnapshot.toolCount,
      failed: mcpSnapshot.failedServerCount,
      loading: mcpSnapshot.loadingServerCount,
      enabledServers: mcpSnapshot.enabledServerCount,
      items: mcpSnapshot.servers.flatMap((server) =>
        (server.toolNames ?? []).map((toolName) => ({
          toolName,
          serverName: server.serverName,
        })),
      ),
    },
  };
}

export function registerSettingsHandlers(ipcMain: IpcMain): void {
  ipcMain.handle("settings:getProxyConfig", (): ProxyConfig => {
    return getProxyConfig();
  });

  ipcMain.handle(
    "settings:setProxyConfig",
    async (_event, config: ProxyConfig): Promise<ProxyConfig> => {
      const nextConfig = setProxyConfig(config);
      if (nextConfig.proxyMode !== "custom") {
        clearProxyEnvFromProcess();
      }
      await applyGlobalProxyDispatcher(
        nextConfig.proxyMode === "custom" ? nextConfig : getProxyConfigFromEnv(),
      );
      return nextConfig;
    },
  );

  ipcMain.handle("settings:getMemorySettings", (): MemorySettings => {
    return getMemorySettings();
  });

  ipcMain.handle(
    "settings:setMemorySettings",
    (_event, config: Partial<MemorySettings>): MemorySettings => {
      return setMemorySettings(config);
    },
  );

  ipcMain.handle(
    "settings:listWorkspaceMemories",
    async (
      _event,
      threadId?: string,
    ): Promise<{
      success: boolean;
      workspacePath: string | null;
      memoryDir: string | null;
      memories: MemoryDocumentSummary[];
      error?: string;
    }> => {
      if (!threadId) {
        return {
          success: true,
          workspacePath: null,
          memoryDir: null,
          memories: [],
        };
      }

      try {
        const workspacePath = await resolveWorkspacePath(threadId);

        if (!workspacePath) {
          return {
            success: true,
            workspacePath: null,
            memoryDir: null,
            memories: [],
          };
        }

        return {
          success: true,
          workspacePath,
          memoryDir: getWorkspaceMemoryDir(workspacePath),
          memories: await listWorkspaceMemoryDocuments(workspacePath),
        };
      } catch (error) {
        return {
          success: false,
          workspacePath: null,
          memoryDir: null,
          memories: [],
          error:
            error instanceof Error ? error.message : "list memories failed",
        };
      }
    },
  );

  ipcMain.handle(
    "settings:getResourceStats",
    async (_event, threadId?: string): Promise<ResourceStatsSnapshot> => {
      return buildResourceStats(threadId);
    },
  );

  ipcMain.handle(
    "settings:getWorkspaceMemoryDocument",
    async (
      _event,
      payload: { threadId?: string; routePath: string },
    ): Promise<{
      success: boolean;
      document?: MemoryDocument;
      error?: string;
    }> => {
      try {
        const workspacePath = await resolveWorkspacePath(payload.threadId);
        if (!workspacePath) {
          return { success: false, error: "No workspace" };
        }

        const document = await getWorkspaceMemoryDocument(
          workspacePath,
          payload.routePath,
        );
        if (!document) {
          return { success: false, error: "Memory not found" };
        }

        return { success: true, document };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "read memory failed",
        };
      }
    },
  );

  ipcMain.handle(
    "settings:updateWorkspaceMemoryDocument",
    async (
      _event,
      payload: {
        threadId?: string;
        routePath: string;
        updates: {
          title: string;
          summary: string;
          body: string;
          nextRoutePath?: string;
        };
      },
    ): Promise<{
      success: boolean;
      document?: MemoryDocumentSummary;
      error?: string;
    }> => {
      try {
        const workspacePath = await resolveWorkspacePath(payload.threadId);
        if (!workspacePath) {
          return { success: false, error: "No workspace" };
        }

        const document = await updateWorkspaceMemoryDocument(
          workspacePath,
          payload.routePath,
          payload.updates,
        );
        if (!document) {
          return { success: false, error: "Memory not found" };
        }

        return { success: true, document };
      } catch (error) {
        return {
          success: false,
          error:
            error instanceof Error ? error.message : "update memory failed",
        };
      }
    },
  );

  ipcMain.handle(
    "settings:deleteWorkspaceMemoryDocument",
    async (
      _event,
      payload: { threadId?: string; routePath: string },
    ): Promise<{ success: boolean; error?: string }> => {
      try {
        const workspacePath = await resolveWorkspacePath(payload.threadId);
        if (!workspacePath) {
          return { success: false, error: "No workspace" };
        }

        const deleted = await deleteWorkspaceMemoryDocument(
          workspacePath,
          payload.routePath,
        );
        return deleted
          ? { success: true }
          : { success: false, error: "Memory not found" };
      } catch (error) {
        return {
          success: false,
          error:
            error instanceof Error ? error.message : "delete memory failed",
        };
      }
    },
  );

  ipcMain.handle(
    "settings:exportGlobalConfigToFile",
    async (
      event,
      options: { includeApiKeys: boolean },
    ): Promise<{
      success: boolean;
      filePath?: string;
      error?: string;
    }> => {
      const window = BrowserWindow.fromWebContents(event.sender);
      if (!window) {
        return { success: false, error: "No window" };
      }

      const result = await dialog.showSaveDialog(window, {
        title: "Export Configuration",
        defaultPath: `open-jarvis-config-${new Date().toISOString().slice(0, 10)}.json`,
        filters: [{ name: "JSON", extensions: ["json"] }],
      });

      if (result.canceled || !result.filePath) {
        return { success: false, error: "cancelled" };
      }

      try {
        const config = await exportGlobalConfig(options.includeApiKeys);
        await fs.writeFile(
          result.filePath,
          JSON.stringify(config, null, 2),
          "utf-8",
        );
        return { success: true, filePath: result.filePath };
      } catch (e) {
        return {
          success: false,
          error: e instanceof Error ? e.message : "Export failed",
        };
      }
    },
  );

  ipcMain.handle(
    "settings:importGlobalConfigFromFile",
    async (
      event,
      mode: GlobalConfigImportMode,
    ): Promise<{
      success: boolean;
      error?: string;
      profilesImported?: number;
      serversImported?: number;
      skillsImported?: number;
      proxyUpdated?: boolean;
    }> => {
      const window = BrowserWindow.fromWebContents(event.sender);
      if (!window) {
        return { success: false, error: "No window" };
      }

      const result = await dialog.showOpenDialog(window, {
        title: "Import Configuration",
        filters: [{ name: "JSON", extensions: ["json"] }],
        properties: ["openFile"],
      });

      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, error: "cancelled" };
      }

      try {
        const raw = await fs.readFile(result.filePaths[0], "utf-8");
        const data = JSON.parse(raw);
        return await importGlobalConfig(data as GlobalConfigExport, mode);
      } catch (e) {
        return {
          success: false,
          error: e instanceof Error ? e.message : "Import failed",
        };
      }
    },
  );

  ipcMain.handle(
    "settings:getToolingVersions",
    (): { bun: string | null; uv: string | null; python: string | null } => {
      const runtime = getEmbeddedToolingRuntime();
      if (!runtime) {
        return { bun: null, uv: null, python: null };
      }
      return {
        bun: runtime.manifest.bun.version,
        uv: runtime.manifest.uv.version,
        python: runtime.manifest.python.version,
      };
    },
  );

  ipcMain.handle(
    "settings:showDesktopNotification",
    async (
      event,
      payload: { title: string; body: string },
    ): Promise<{ success: boolean; error?: string }> => {
      if (!Notification.isSupported()) {
        return {
          success: false,
          error: "Desktop notifications are not supported",
        };
      }

      try {
        const parentWindow = BrowserWindow.fromWebContents(event.sender);
        const notification = new Notification({
          title: payload.title,
          body: payload.body,
          silent: true,
        });

        notification.on("click", () => {
          if (!parentWindow || parentWindow.isDestroyed()) {
            return;
          }

          if (parentWindow.isMinimized()) {
            parentWindow.restore();
          }
          parentWindow.show();
          parentWindow.focus();
        });

        notification.show();
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error:
            error instanceof Error
              ? error.message
              : "Failed to show notification",
        };
      }
    },
  );

  ipcMain.handle(
    "settings:writeImageToClipboard",
    async (
      _event,
      payload: { dataUrl: string },
    ): Promise<{ success: boolean; error?: string }> => {
      try {
        const dataUrl = payload.dataUrl?.trim();
        if (!dataUrl) {
          return { success: false, error: "Image data is required" };
        }

        const image = nativeImage.createFromDataURL(dataUrl);
        if (image.isEmpty()) {
          return { success: false, error: "Invalid image data" };
        }

        clipboard.writeImage(image);
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error:
            error instanceof Error
              ? error.message
              : "Failed to write image to clipboard",
        };
      }
    },
  );
}
