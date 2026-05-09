import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { tool, type StructuredToolInterface } from "@langchain/core/tools";
import type { MCPServerConfig } from "../types";

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
  const client = new Client(
    { name: "open-jarvis", version: "0.1.0" },
    { capabilities: {} },
  );
  let transport: SupportedMCPTransport;

  if (server.transport === "stdio") {
    transport = new StdioClientTransport({
      command: server.command,
      args: server.args,
      env: Object.keys(server.env).length > 0 ? server.env : undefined,
      cwd: server.cwd || undefined,
      stderr: "pipe",
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

  await client.connect(transport);
  const listed = await client.listTools();
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
        const contentItems = Array.isArray(result.content) ? result.content : [];

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

  return { client, transport, tools };
}

export async function getMCPToolsForServers(
  servers: MCPServerConfig[],
): Promise<StructuredToolInterface[]> {
  const activeServers = servers.filter((server) => server.enabled !== false);
  const resolved = await Promise.all(
    activeServers.map(async (server) => {
      const signature = getConnectionSignature(server);
      const cached = connections.get(server.id);

      const connectionPromise =
        cached && cached.signature === signature
          ? cached.promise
          : createConnection(server).catch((error) => {
              connections.delete(server.id);
              throw error;
            });

      if (!cached || cached.signature !== signature) {
        connections.set(server.id, { signature, promise: connectionPromise });
      }

      try {
        const connection = await connectionPromise;
        return connection.tools;
      } catch (error) {
        console.warn(
          `[MCP] Failed to initialize server ${server.name}:`,
          error,
        );
        return [];
      }
    }),
  );

  return resolved.flat();
}

export async function closeAllMCPConnections(): Promise<void> {
  const current = Array.from(connections.values(), (entry) => entry.promise);
  connections.clear();
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