import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { tool, type StructuredToolInterface } from "@langchain/core/tools";
import process from "node:process";
import type { MCPRuntimeSnapshot, MCPServerConfig, MCPServerRuntimeStatus } from "../types";
import { getEmbeddedToolingRuntime } from "../tooling";

type SupportedMCPTransport =
  | StdioClientTransport
  | StreamableHTTPClientTransport
  | SSEClientTransport;

interface MCPConnection {
  client: Client;
  transport: SupportedMCPTransport;
  tools: StructuredToolInterface[];
}

interface CachedConnection {
  signature: string;
  promise: Promise<MCPConnection>;
}

interface MCPApprovalTaggedTool extends StructuredToolInterface {
  __approvalAliases?: string[];
}

const connections = new Map<string, CachedConnection>();
const readyConnections = new Map<string, MCPConnection>();
const runtimeStatuses = new Map<string, MCPServerRuntimeStatus>();
const MCP_CONNECTION_TIMEOUT_MS = 20_000;
const MCP_STDERR_MAX_CHARS = 4000;

function setRuntimeStatus(
  server: MCPServerConfig,
  patch: Partial<MCPServerRuntimeStatus>,
): void {
  const current = runtimeStatuses.get(server.id);
  runtimeStatuses.set(server.id, {
    serverId: server.id,
    serverName: server.name,
    state: "idle",
    toolCount: 0,
    ...current,
    ...patch,
    updatedAt: new Date().toISOString(),
  });
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function appendStderrChunk(current: string, chunk: string): string {
  const next = current ? `${current}${chunk}` : chunk;
  return next.length > MCP_STDERR_MAX_CHARS
    ? next.slice(-MCP_STDERR_MAX_CHARS)
    : next;
}

function normalizeWindowsEnv(
  env: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (process.platform !== "win32") {
    return env;
  }

  const merged = { ...(env ?? {}) };
  const inheritedKeys = [
    "PATH",
    "PATHEXT",
    "ComSpec",
    "SystemRoot",
    "SYSTEMROOT",
    "APPDATA",
    "LOCALAPPDATA",
    "USERPROFILE",
    "TEMP",
    "TMP",
    "PROGRAMFILES",
    "ProgramFiles(x86)",
    "ProgramW6432",
  ] as const;

  for (const key of inheritedKeys) {
    if (!merged[key] && process.env[key]) {
      merged[key] = process.env[key] as string;
    }
  }

  return merged;
}

function prependPathEntry(
  env: Record<string, string>,
  entry: string,
): Record<string, string> {
  if (!entry) {
    return env;
  }

  const delimiter = process.platform === "win32" ? ";" : ":";
  const keys = process.platform === "win32" ? ["Path", "PATH"] : ["PATH"];
  const currentValue =
    keys
      .map((key) => env[key])
      .find((value) => typeof value === "string" && value.length > 0) ??
    process.env.PATH ??
    "";
  const parts = currentValue
    .split(delimiter)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  if (!parts.includes(entry)) {
    parts.unshift(entry);
  }

  const nextValue = parts.join(delimiter);
  for (const key of keys) {
    env[key] = nextValue;
  }

  return env;
}

function shouldWrapWindowsShellCommand(command: string): boolean {
  const normalized = command.trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  if (/[\\/]/.test(normalized)) {
    return normalized.endsWith(".cmd") || normalized.endsWith(".bat");
  }

  return [
    "npm",
    "npx",
    "pnpm",
    "yarn",
    "bunx",
    "cmd",
    "cmd.exe",
  ].includes(normalized);
}

function escapeWindowsCmdArg(value: string): string {
  if (value.length === 0) {
    return '""';
  }

  const escaped = value
    .replace(/\^/g, "^^")
    .replace(/"/g, '\\"')
    .replace(/%/g, "%%");

  return /[\s&|<>()!]/.test(escaped) ? `"${escaped}"` : escaped;
}

function normalizeStdioServerConfig(server: MCPServerConfig): {
  command: string;
  args: string[];
  env: Record<string, string> | undefined;
  cwd: string | undefined;
} {
  const embeddedTooling = getEmbeddedToolingRuntime();
  const env = normalizeWindowsEnv(
    Object.keys(server.env).length > 0 ? server.env : undefined,
  ) ?? {};
  const cwd = server.cwd || undefined;
  const commandName = server.command.trim().toLowerCase();

  if (embeddedTooling) {
    env.OPEN_JARVIS_UV = embeddedTooling.uvPath;
    env.OPEN_JARVIS_BUN = embeddedTooling.bunPath;
    if (embeddedTooling.pythonPath) {
      env.OPEN_JARVIS_PYTHON = embeddedTooling.pythonPath;
      env.UV_PYTHON = embeddedTooling.pythonPath;
    }
    env.UV_NO_MANAGED_PYTHON = "true";
    env.UV_PYTHON_DOWNLOADS = "false";
    prependPathEntry(env, embeddedTooling.binDir);
    prependPathEntry(env, embeddedTooling.rootDir);
  }

  if (embeddedTooling) {
    if (commandName === "uvx" && embeddedTooling.uvPath) {
      const toolArgs = ["tool", "run"];
      if (embeddedTooling.pythonPath) {
        toolArgs.push(
          "--python",
          embeddedTooling.pythonPath,
          "--no-managed-python",
          "--no-python-downloads",
        );
      }
      return {
        command: embeddedTooling.uvPath,
        args: [...toolArgs, ...server.args],
        env,
        cwd,
      };
    }

    if (commandName === "uv" && embeddedTooling.uvPath) {
      return {
        command: embeddedTooling.uvPath,
        args: embeddedTooling.pythonPath
          ? [
              "--python",
              embeddedTooling.pythonPath,
              "--no-managed-python",
              "--no-python-downloads",
              ...server.args,
            ]
          : server.args,
        env,
        cwd,
      };
    }

    if (commandName === "bunx" && embeddedTooling.bunPath) {
      return {
        command: embeddedTooling.bunPath,
        args: ["x", ...server.args],
        env,
        cwd,
      };
    }

    if (commandName === "bun" && embeddedTooling.bunPath) {
      return {
        command: embeddedTooling.bunPath,
        args: server.args,
        env,
        cwd,
      };
    }
  }

  if (
    process.platform === "win32" &&
    shouldWrapWindowsShellCommand(server.command)
  ) {
    const comSpec = env?.ComSpec || process.env.ComSpec || "cmd.exe";
    const commandLine = [server.command, ...server.args]
      .map(escapeWindowsCmdArg)
      .join(" ");

    return {
      command: comSpec,
      args: ["/d", "/s", "/c", commandLine],
      env,
      cwd,
    };
  }

  return {
    command: server.command,
    args: server.args,
    env,
    cwd,
  };
}

function serializeContentItem(item: unknown): string {
  if (!item || typeof item !== "object") {
    return String(item ?? "");
  }

  const record = item as Record<string, unknown>;
  if (record.type === "text" && typeof record.text === "string") {
    return record.text;
  }

  if (record.type === "resource" && record.resource) {
    return JSON.stringify(record.resource, null, 2);
  }

  return JSON.stringify(record, null, 2);
}

function normalizeToolName(server: MCPServerConfig, toolName: string): string {
  const prefix = server.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const suffix = toolName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `${prefix}_${suffix}`;
}

function getConnectionSignature(server: MCPServerConfig): string {
  return JSON.stringify({
    transport: server.transport,
    command: server.command,
    args: server.args,
    env: server.env,
    headers: server.headers,
    cwd: server.cwd,
    url: server.url,
    enabled: server.enabled,
  });
}

function getRemoteRequestInit(server: MCPServerConfig): RequestInit | undefined {
  return Object.keys(server.headers).length > 0
    ? { headers: server.headers }
    : undefined;
}

async function createConnection(server: MCPServerConfig): Promise<MCPConnection> {
  setRuntimeStatus(server, {
    state: "loading",
    error: undefined,
    toolCount: 0,
  });
  const client = new Client(
    { name: "open-jarvis", version: "0.1.0" },
    { capabilities: {} },
  );
  let transport: SupportedMCPTransport;
  let stderrBuffer = "";

  if (server.transport === "stdio") {
    const stdioConfig = normalizeStdioServerConfig(server);
    transport = new StdioClientTransport({
      command: stdioConfig.command,
      args: stdioConfig.args,
      env: stdioConfig.env,
      cwd: stdioConfig.cwd,
      stderr: "pipe",
    });
    transport.stderr?.on("data", (chunk) => {
      stderrBuffer = appendStderrChunk(stderrBuffer, String(chunk));
    });
  } else if (server.transport === "streamable_http") {
    transport = new StreamableHTTPClientTransport(new URL(server.url), {
      requestInit: getRemoteRequestInit(server),
    });
  } else if (server.transport === "sse") {
    transport = new SSEClientTransport(new URL(server.url), {
      requestInit: getRemoteRequestInit(server),
    });
  } else {
    throw new Error(
      `MCP transport ${server.transport} is not supported for ${server.name}`,
    );
  }

  try {
    await withTimeout(
      client.connect(transport),
      MCP_CONNECTION_TIMEOUT_MS,
      `MCP server ${server.name} connection`,
    );
    const listed = await withTimeout(
      client.listTools(),
      MCP_CONNECTION_TIMEOUT_MS,
      `MCP server ${server.name} tool discovery`,
    );
    const tools = listed.tools.map((mcpTool) => {
      const normalizedName = normalizeToolName(server, mcpTool.name);
      const wrappedTool = tool(
        async (input) => {
          const result = await client.callTool({
            name: mcpTool.name,
            arguments:
              input && typeof input === "object"
                ? (input as Record<string, unknown>)
                : {},
          });
          const contentItems = Array.isArray(result.content)
            ? result.content
            : [];

          const serialized = result.structuredContent
            ? JSON.stringify(result.structuredContent, null, 2)
            : contentItems.map(serializeContentItem).join("\n\n");

          if (result.isError) {
            throw new Error(serialized || `MCP tool ${mcpTool.name} failed`);
          }

          return serialized || `${mcpTool.name} completed successfully.`;
        },
        {
          name: normalizedName,
          description:
            mcpTool.description ||
            `${mcpTool.name} from MCP server ${server.name}`,
          schema: mcpTool.inputSchema,
        },
      ) as MCPApprovalTaggedTool;

      wrappedTool.__approvalAliases = [normalizedName, mcpTool.name];
      return wrappedTool;
    });

    setRuntimeStatus(server, {
      state: "ready",
      error: undefined,
      toolCount: tools.length,
      toolNames: tools.map((nextTool) => nextTool.name).filter((name) => typeof name === "string"),
    });

    return { client, transport, tools };
  } catch (error) {
    await transport.close().catch(() => undefined);
    const suffix = stderrBuffer.trim()
      ? `\n\nstderr:\n${stderrBuffer.trim()}`
      : "";
    const message =
      error instanceof Error ? error.message : String(error || "Unknown error");
    setRuntimeStatus(server, {
      state: "error",
      error: `${message}${suffix}`,
      toolCount: 0,
      toolNames: [],
    });
    throw new Error(`${message}${suffix}`);
  }
}

function ensureConnection(server: MCPServerConfig): Promise<MCPConnection> {
  const signature = getConnectionSignature(server);
  const cached = connections.get(server.id);

  if (cached && cached.signature === signature) {
    return cached.promise;
  }

  readyConnections.delete(server.id);

  const promise = createConnection(server)
    .then((connection) => {
      readyConnections.set(server.id, connection);
      setRuntimeStatus(server, {
        state: "ready",
        error: undefined,
        toolCount: connection.tools.length,
        toolNames: connection.tools
          .map((tool) => tool.name)
          .filter((name): name is string => typeof name === "string"),
      });
      return connection;
    })
    .catch((error) => {
      connections.delete(server.id);
      readyConnections.delete(server.id);
      throw error;
    });

  connections.set(server.id, { signature, promise });
  return promise;
}

export async function resetMCPConnection(serverId: string): Promise<void> {
  const cached = connections.get(serverId);
  connections.delete(serverId);
  readyConnections.delete(serverId);
  runtimeStatuses.delete(serverId);

  if (!cached) {
    return;
  }

  try {
    const connection = await cached.promise;
    await connection.transport.close();
  } catch {
    // Ignore teardown errors for stale connections.
  }
}

export async function bootstrapMCPServers(
  servers: MCPServerConfig[],
): Promise<void> {
  const activeServers = servers.filter((server) => server.enabled);
  await Promise.all(
    activeServers.map(async (server) => {
      try {
        await ensureConnection(server);
      } catch (error) {
        console.warn(
          `[MCP] Failed to initialize server ${server.name}:`,
          error,
        );
      }
    }),
  );
}

export async function getMCPToolsForServers(
  servers: MCPServerConfig[],
): Promise<StructuredToolInterface[]> {
  const activeServers = servers.filter((server) => server.enabled);
  return activeServers.flatMap((server) => {
    const signature = getConnectionSignature(server);
    const cached = connections.get(server.id);
    const ready = readyConnections.get(server.id);

    if (
      cached &&
      cached.signature === signature &&
      ready
    ) {
      return ready.tools;
    }

    void ensureConnection(server).catch((error) => {
      console.warn(
        `[MCP] Failed to initialize server ${server.name}:`,
        error,
      );
    });
    return [];
  });
}

export function getMCPRuntimeSnapshot(
  servers: MCPServerConfig[],
): MCPRuntimeSnapshot {
  const selectedIds = new Set(
    servers.filter((server) => server.enabled).map((server) => server.id),
  );
  const statuses = servers
    .filter((server) => server.enabled)
    .map((server) => {
      const status = runtimeStatuses.get(server.id);
      return {
        serverId: server.id,
        serverName: server.name,
        state: status?.state ?? "idle",
        toolCount: status?.toolCount ?? 0,
        toolNames: status?.toolNames ?? [],
        error: status?.error,
        updatedAt: status?.updatedAt ?? null,
      } satisfies MCPServerRuntimeStatus;
    });

  return {
    servers: statuses,
    enabledServerCount: selectedIds.size,
    readyServerCount: statuses.filter((status) => status.state === "ready")
      .length,
    loadingServerCount: statuses.filter((status) => status.state === "loading")
      .length,
    failedServerCount: statuses.filter((status) => status.state === "error")
      .length,
    toolCount: statuses.reduce((sum, status) => sum + status.toolCount, 0),
  };
}

export async function closeAllMCPConnections(): Promise<void> {
  const current = Array.from(connections.values(), (entry) => entry.promise);
  connections.clear();
  readyConnections.clear();
  runtimeStatuses.clear();
  await Promise.all(
    current.map(async (pending) => {
      try {
        const connection = await pending;
        await connection.transport.close();
      } catch (error) {
        console.warn("[MCP] Failed to close connection:", error);
      }
    }),
  );
}
