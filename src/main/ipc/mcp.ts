import { IpcMain } from "electron";
import {
  deleteMCPServer,
  exportMCPServers,
  getMCPServers,
  importMCPServersFromJson,
  upsertMCPServer,
} from "../mcp-config";
import { getThread, updateThread } from "../db";
import type {
  MCPEnabledServersParams,
  MCPImportInput,
  MCPServerConfig,
  ThreadMetadata,
} from "../types";

function getThreadMetadata(threadId: string): ThreadMetadata {
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

  ipcMain.handle("mcp:getEnabledForThread", async (_event, threadId: string) => {
    return getThreadMetadata(threadId).enabledMcpServerIds ?? [];
  });

  ipcMain.handle(
    "mcp:setEnabledForThread",
    async (_event, { threadId, serverIds }: MCPEnabledServersParams) => {
      const metadata = getThreadMetadata(threadId);
      const nextIds = Array.from(
        new Set(serverIds.map((id) => id.trim()).filter((id) => id.length > 0)),
      );
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