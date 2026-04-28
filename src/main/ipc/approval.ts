import { IpcMain } from "electron";
import { getThread } from "../db";
import {
  getApprovalMode,
  setApprovalMode,
  shouldAutoApprove,
} from "../approval-settings";
import type { ApprovalMode, HITLRequest } from "../types";

function getWorkspacePath(threadId: string): string | undefined {
  const thread = getThread(threadId);
  if (!thread?.metadata) return undefined;
  try {
    const metadata = JSON.parse(thread.metadata) as { workspacePath?: string };
    return metadata.workspacePath;
  } catch {
    return undefined;
  }
}

export function registerApprovalHandlers(ipcMain: IpcMain): void {
  ipcMain.handle("approval:getMode", async (_event, threadId: string) => {
    return getApprovalMode(threadId);
  });

  ipcMain.handle(
    "approval:setMode",
    async (_event, params: { threadId: string; mode: ApprovalMode }) => {
      return setApprovalMode(params.threadId, params.mode);
    },
  );

  ipcMain.handle(
    "approval:shouldAutoApprove",
    async (_event, params: { threadId: string; request: HITLRequest }) => {
      return shouldAutoApprove(
        params.threadId,
        getWorkspacePath(params.threadId),
        params.request,
      );
    },
  );
}
