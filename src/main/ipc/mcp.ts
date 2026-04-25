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
import type {
  MCPEnabledServersParams,
  MCPImportInput,
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
      return upsertMCPServer(config);
    },
  );

  ipcMain.handle("mcp:deleteServer", async (_event, id: string) => {
    deleteMCPServer(id);
  });

  ipcMain.handle("mcp:importServers", async (_event, { json }: MCPImportInput) => {
    return importMCPServersFromJson(json);
  });

  ipcMain.handle("mcp:exportServers", async () => {
    return exportMCPServers();
  });

  ipcMain.handle("mcp:getEnabledForThread", async (_event, threadId?: string) => {
    if (!threadId) {
      return (store.get("enabledMcpServerIds", []) as string[]) ?? [];
    }

    return getThreadMetadata(threadId).enabledMcpServerIds ?? [];
  });

  ipcMain.handle(
    "mcp:setEnabledForThread",
    async (_event, { threadId, serverIds }: MCPEnabledServersParams) => {
      const nextIds = Array.from(
        new Set(serverIds.map((id) => id.trim()).filter((id) => id.length > 0)),
      );

      if (!threadId) {
        store.set("enabledMcpServerIds", nextIds);
        return nextIds;
      }

      const metadata = getThreadMetadata(threadId);
      updateThread(threadId, {
        metadata: JSON.stringify({
          ...metadata,
          enabledMcpServerIds: nextIds,
        }),
      });
      return nextIds;
    },
  );
}