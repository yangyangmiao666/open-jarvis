import { IpcMain } from "electron";
import Store from "electron-store";
import {
  deleteMCPServer,
  exportMCPServers,
  getMCPServers,
  importMCPServersFromJson,
  upsertMCPServer,
} from "../mcp-config";
import { getThread, updateThread } from "../db";
import { getOpenworkDir } from "../storage";
import {
  bootstrapMCPServers,
  getMCPRuntimeSnapshot,
  resetMCPConnection,
} from "../agent/mcp-runtime";
import type {
  MCPEnabledServersParams,
  MCPImportInput,
  MCPRuntimeSnapshot,
  MCPServerConfig,
  ThreadMetadata,
} from "../types";

const store = new Store({
  name: "settings",
  cwd: getOpenworkDir(),
});

function getThreadMetadata(threadId?: string): ThreadMetadata {
  if (!threadId) {
    return {};
  }

  const thread = getThread(threadId);
  if (!thread) {
    throw new Error("Thread not found");
  }

  if (!thread.metadata) return {};
  return JSON.parse(thread.metadata) as ThreadMetadata;
}

function getEnabledServerIds(threadId?: string): string[] {
  if (!threadId) {
    return (store.get("enabledMcpServerIds", []) as string[]) ?? [];
  }

  return getThreadMetadata(threadId).enabledMcpServerIds ?? [];
}

function getEnabledServerConfigs(threadId?: string): MCPServerConfig[] {
  const enabledIds = new Set(getEnabledServerIds(threadId));
  return getMCPServers().filter(
    (server) => server.enabled && enabledIds.has(server.id),
  );
}

function getAllLoadableServerConfigs(): MCPServerConfig[] {
  return getMCPServers().filter((server) => server.enabled);
}

export function registerMCPHandlers(ipcMain: IpcMain): void {
  ipcMain.handle("mcp:listServers", async () => {
    return getMCPServers();
  });

  ipcMain.handle(
    "mcp:upsertServer",
    async (
      _event,
      config: MCPServerConfig | (Omit<MCPServerConfig, "id"> & { id?: string }),
    ) => {
      const previousId = "id" in config && config.id ? config.id : null;
      if (previousId) {
        await resetMCPConnection(previousId);
      }
      const next = upsertMCPServer(config);
      await bootstrapMCPServers(getAllLoadableServerConfigs());
      return next;
    },
  );

  ipcMain.handle("mcp:deleteServer", async (_event, id: string) => {
    await resetMCPConnection(id);
    deleteMCPServer(id);
  });

  ipcMain.handle("mcp:importServers", async (_event, { json }: MCPImportInput) => {
    const result = importMCPServersFromJson(json);
    await Promise.all(result.imported.map((server) => resetMCPConnection(server.id)));
    await bootstrapMCPServers(getAllLoadableServerConfigs());
    return result;
  });

  ipcMain.handle("mcp:exportServers", async () => {
    return exportMCPServers();
  });

  ipcMain.handle("mcp:getEnabledForThread", async (_event, threadId?: string) => {
    return getEnabledServerIds(threadId);
  });

  ipcMain.handle(
    "mcp:setEnabledForThread",
    async (_event, { threadId, serverIds }: MCPEnabledServersParams) => {
      const nextIds = Array.from(
        new Set(serverIds.map((id) => id.trim()).filter((id) => id.length > 0)),
      );

      if (!threadId) {
        store.set("enabledMcpServerIds", nextIds);
        await bootstrapMCPServers(getAllLoadableServerConfigs());
        return nextIds;
      }

      const metadata = getThreadMetadata(threadId);
      updateThread(threadId, {
        metadata: JSON.stringify({
          ...metadata,
          enabledMcpServerIds: nextIds,
        }),
      });
      await bootstrapMCPServers(getEnabledServerConfigs(threadId));
      return nextIds;
    },
  );

  ipcMain.handle(
    "mcp:getRuntimeSnapshot",
    async (_event, threadId?: string): Promise<MCPRuntimeSnapshot> => {
      return getMCPRuntimeSnapshot(getEnabledServerConfigs(threadId));
    },
  );

  ipcMain.handle("mcp:bootstrap", async (_event, threadId?: string) => {
    const servers = threadId
      ? getEnabledServerConfigs(threadId)
      : getAllLoadableServerConfigs();
    await bootstrapMCPServers(servers);
    return getMCPRuntimeSnapshot(servers);
  });
}
