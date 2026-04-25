import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { tool, type StructuredToolInterface } from "@langchain/core/tools";
import type { MCPServerConfig } from "../types";

interface MCPConnection {
  client: Client;
  transport: StdioClientTransport;
  tools: StructuredToolInterface[];
}

const connections = new Map<string, Promise<MCPConnection>>();

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

async function createConnection(server: MCPServerConfig): Promise<MCPConnection> {
  if (server.transport !== "stdio") {
    throw new Error(
      `MCP transport ${server.transport} is not supported yet for ${server.name}`,
    );
  }

  const client = new Client(
    { name: "open-jarvis", version: "0.1.0" },
    { capabilities: {} },
  );
  const transport = new StdioClientTransport({
    command: server.command,
    args: server.args,
    env: Object.keys(server.env).length > 0 ? server.env : undefined,
    cwd: server.cwd || undefined,
    stderr: "pipe",
  });

  await client.connect(transport);
  const listed = await client.listTools();
  const tools = listed.tools.map((mcpTool) =>
    tool(
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
        name: normalizeToolName(server, mcpTool.name),
        description:
          mcpTool.description ||
          `${mcpTool.name} from MCP server ${server.name}`,
        schema: mcpTool.inputSchema,
      },
    ),
  );

  return { client, transport, tools };
}

export async function getMCPToolsForServers(
  servers: MCPServerConfig[],
): Promise<StructuredToolInterface[]> {
  const activeServers = servers.filter((server) => server.enabled !== false);
  const resolved = await Promise.all(
    activeServers.map(async (server) => {
      let connectionPromise = connections.get(server.id);
      if (!connectionPromise) {
        connectionPromise = createConnection(server).catch((error) => {
          connections.delete(server.id);
          throw error;
        });
        connections.set(server.id, connectionPromise);
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
  const current = Array.from(connections.values());
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