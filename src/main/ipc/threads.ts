import { IpcMain } from "electron";
import { v4 as uuid } from "uuid";
import {
  getAllThreads,
  getThread,
  createThread as dbCreateThread,
  updateThread as dbUpdateThread,
  deleteThread as dbDeleteThread,
} from "../db";
import { getCheckpointer, closeCheckpointer } from "../agent/runtime";
import { deleteThreadCheckpoint } from "../storage";
import { generateTitle } from "../services/title-generator";
import type { Message, Thread, ThreadRewindParams, ThreadUpdateParams } from "../types";

function extractMessageText(message: Message): string {
  if (typeof message.content === "string") {
    return message.content.trim();
  }

  return message.content
    .filter((block) => block.type === "text" && block.text)
    .map((block) => block.text?.trim() ?? "")
    .filter(Boolean)
    .join("\n\n");
}

function extractCheckpointMessages(checkpoint: unknown): Message[] {
  const channelValues = (checkpoint as {
    checkpoint?: {
      channel_values?: {
        messages?: Array<{
          id?: string;
          _getType?: () => string;
          type?: string;
          content?: string | unknown[];
          tool_calls?: unknown[];
          tool_call_id?: string;
          name?: string;
        }>;
      };
    };
  }).checkpoint?.channel_values;

  if (!Array.isArray(channelValues?.messages)) {
    return [];
  }

  return channelValues.messages.map((msg, index) => {
    let role: Message["role"] = "assistant";
    const resolvedType =
      typeof msg._getType === "function" ? msg._getType() : msg.type;

    if (resolvedType === "human") role = "user";
    else if (resolvedType === "tool") role = "tool";
    else if (resolvedType === "system") role = "system";

    return {
      id: msg.id || `msg-${index}`,
      role,
      content:
        typeof msg.content === "string"
          ? msg.content
          : Array.isArray(msg.content)
            ? (msg.content as Message["content"])
            : "",
      tool_calls: msg.tool_calls as Message["tool_calls"],
      ...(role === "tool" &&
        msg.tool_call_id && { tool_call_id: msg.tool_call_id }),
      ...(role === "tool" && msg.name && { name: msg.name }),
      created_at: new Date(),
    };
  });
}

export function registerThreadHandlers(ipcMain: IpcMain): void {
  // List all threads
  ipcMain.handle("threads:list", async () => {
    const threads = getAllThreads();
    return threads.map((row) => ({
      thread_id: row.thread_id,
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at),
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      status: row.status as Thread["status"],
      thread_values: row.thread_values
        ? JSON.parse(row.thread_values)
        : undefined,
      title: row.title,
    }));
  });

  // Get a single thread
  ipcMain.handle("threads:get", async (_event, threadId: string) => {
    const row = getThread(threadId);
    if (!row) return null;
    return {
      thread_id: row.thread_id,
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at),
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      status: row.status as Thread["status"],
      thread_values: row.thread_values
        ? JSON.parse(row.thread_values)
        : undefined,
      title: row.title,
    };
  });

  // Create a new thread
  ipcMain.handle(
    "threads:create",
    async (_event, metadata?: Record<string, unknown>) => {
      const threadId = uuid();
      const title =
        (metadata?.title as string) ||
        `Thread ${new Date().toLocaleDateString()}`;

      const thread = dbCreateThread(threadId, { ...metadata, title });

      return {
        thread_id: thread.thread_id,
        created_at: new Date(thread.created_at),
        updated_at: new Date(thread.updated_at),
        metadata: thread.metadata ? JSON.parse(thread.metadata) : undefined,
        status: thread.status as Thread["status"],
        thread_values: thread.thread_values
          ? JSON.parse(thread.thread_values)
          : undefined,
        title,
      } as Thread;
    },
  );

  // Update a thread
  ipcMain.handle(
    "threads:update",
    async (_event, { threadId, updates }: ThreadUpdateParams) => {
      const updateData: Parameters<typeof dbUpdateThread>[1] = {};

      if (updates.title !== undefined) updateData.title = updates.title;
      if (updates.status !== undefined) updateData.status = updates.status;
      if (updates.metadata !== undefined)
        updateData.metadata = JSON.stringify(updates.metadata);
      if (updates.thread_values !== undefined)
        updateData.thread_values = JSON.stringify(updates.thread_values);

      const row = dbUpdateThread(threadId, updateData);
      if (!row) throw new Error("Thread not found");

      return {
        thread_id: row.thread_id,
        created_at: new Date(row.created_at),
        updated_at: new Date(row.updated_at),
        metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
        status: row.status as Thread["status"],
        thread_values: row.thread_values
          ? JSON.parse(row.thread_values)
          : undefined,
        title: row.title,
      };
    },
  );

  async function deleteThreadById(threadId: string): Promise<void> {
    dbDeleteThread(threadId);
    try {
      await closeCheckpointer(threadId);
    } catch (e) {
      console.warn("[Threads] Failed to close checkpointer:", e);
    }
    try {
      deleteThreadCheckpoint(threadId);
    } catch (e) {
      console.warn("[Threads] Failed to delete checkpoint file:", e);
    }
  }

  // Delete a thread
  ipcMain.handle("threads:delete", async (_event, threadId: string) => {
    console.log("[Threads] Deleting thread:", threadId);
    await deleteThreadById(threadId);
    console.log("[Threads] Deleted thread:", threadId);
  });

  ipcMain.handle("threads:deleteMany", async (_event, threadIds: string[]) => {
    const ids = Array.isArray(threadIds) ? threadIds : [];
    console.log("[Threads] Deleting threads:", ids.length);
    for (const id of ids) {
      await deleteThreadById(id);
    }
  });

  // Get thread history (checkpoints)
  ipcMain.handle("threads:history", async (_event, threadId: string) => {
    try {
      const checkpointer = await getCheckpointer(threadId);

      const history: unknown[] = [];
      const config = { configurable: { thread_id: threadId } };

      for await (const checkpoint of checkpointer.list(config, { limit: 50 })) {
        history.push(checkpoint);
      }

      return history;
    } catch (e) {
      console.warn("Failed to get thread history:", e);
      return [];
    }
  });

  ipcMain.handle(
    "threads:rewindToMessage",
    async (_event, { threadId, userMessageOrdinal, messageText }: ThreadRewindParams) => {
      const checkpointer = await getCheckpointer(threadId);

      const checkpoints: Array<{
        config?: { configurable?: { checkpoint_id?: string } };
        checkpoint?: unknown;
      }> = [];
      for await (const checkpoint of checkpointer.list(
        { configurable: { thread_id: threadId } },
        { limit: 200 },
      )) {
        checkpoints.push(checkpoint as typeof checkpoints[number]);
      }

      if (checkpoints.length === 0) {
        throw new Error("Thread history is empty");
      }

      let keepCheckpointId: string | null = null;
      let foundTarget = false;
      const normalizedTargetText = messageText.trim();

      for (const checkpoint of checkpoints.reverse()) {
        const messages = extractCheckpointMessages(checkpoint);
        const userMessages = messages.filter((message) => message.role === "user");
        const candidate = userMessages[userMessageOrdinal];

        if (
          candidate &&
          extractMessageText(candidate) === normalizedTargetText
        ) {
          foundTarget = true;
          break;
        }
        keepCheckpointId = checkpoint.config?.configurable?.checkpoint_id ?? null;
      }

      if (!foundTarget) {
        throw new Error("Target message not found in thread history");
      }

      await checkpointer.truncateThread(threadId, keepCheckpointId);
      await checkpointer.flush();

      return { success: true, checkpointId: keepCheckpointId };
    },
  );

  // Generate a title from a message
  ipcMain.handle("threads:generateTitle", async (_event, message: string) => {
    return generateTitle(message);
  });
}
