import Store from "electron-store";
import { randomUUID } from "crypto";
import { getOpenworkDir } from "./storage";
import type {
  MCPImportedServerInput,
  MCPImportResult,
  MCPServerConfig,
  MCPTransportType,
} from "./types";

const store = new Store({
  name: "settings",
  cwd: getOpenworkDir(),
});

const KEY = "mcpServers";

function isTransport(value: string): value is MCPTransportType {
  return value === "stdio" || value === "sse" || value === "streamable_http";
}

function normalizeArgs(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item));
}

function normalizeEnv(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
      key,
      String(entry ?? ""),
    ]),
  );
}

function normalizeHeaders(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
      key,
      String(entry ?? ""),
    ]),
  );
}

export function normalizeMCPServerConfig(
  config: Omit<MCPServerConfig, "id"> & { id?: string },
): MCPServerConfig {
  const transport = isTransport(config.transport) ? config.transport : "stdio";
  const name = config.name.trim() || "MCP Server";

  return {
    id: config.id ?? randomUUID(),
    name,
    transport,
    command: config.command.trim(),
    args: config.args.map((arg) => arg.trim()).filter((arg) => arg.length > 0),
    env: Object.fromEntries(
      Object.entries(config.env).filter(([key]) => key.trim().length > 0),
    ),
    headers: Object.fromEntries(
      Object.entries(config.headers).filter(([key]) => key.trim().length > 0),
    ),
    cwd: config.cwd.trim(),
    url: config.url.trim(),
    enabled: config.enabled !== false,
  };
}

export function validateMCPServerConfig(config: MCPServerConfig): void {
  if (!config.name.trim()) {
    throw new Error("MCP server name is required");
  }

  if (config.transport === "stdio" && !config.command.trim()) {
    throw new Error("Stdio MCP server requires a command");
  }

  if (config.transport !== "stdio" && !config.url.trim()) {
    throw new Error("Remote MCP server requires a URL");
  }
}

export function getMCPServers(): MCPServerConfig[] {
  const raw = store.get(KEY, []) as MCPServerConfig[];
  if (!Array.isArray(raw)) return [];

  return raw.map((item) =>
    normalizeMCPServerConfig({
      ...item,
      args: normalizeArgs(item.args),
      env: normalizeEnv(item.env),
      headers: normalizeHeaders(item.headers),
    }),
  );
}

export function getMCPServerById(id: string): MCPServerConfig | undefined {
  return getMCPServers().find((server) => server.id === id);
}

export function upsertMCPServer(
  config: Omit<MCPServerConfig, "id"> & { id?: string },
): MCPServerConfig {
  const next = normalizeMCPServerConfig(config);
  validateMCPServerConfig(next);

  const servers = getMCPServers();
  const index = servers.findIndex((server) => server.id === next.id);
  if (index >= 0) {
    servers[index] = next;
  } else {
    servers.push(next);
  }
  store.set(KEY, servers);
  return next;
}

export function deleteMCPServer(id: string): void {
  store.set(
    KEY,
    getMCPServers().filter((server) => server.id !== id),
  );
}

export function exportMCPServers(): { mcpServers: Record<string, unknown> } {
  const mcpServers = Object.fromEntries(
    getMCPServers().map((server) => {
      const entry: Record<string, unknown> = {
        transport: server.transport,
      };

      if (server.transport === "stdio") {
        entry.command = server.command;
        if (server.args.length > 0) entry.args = server.args;
        if (Object.keys(server.env).length > 0) entry.env = server.env;
        if (server.cwd) entry.cwd = server.cwd;
      } else {
        entry.url = server.url;
        if (Object.keys(server.headers).length > 0) entry.headers = server.headers;
      }

      return [server.name, entry];
    }),
  );

  return { mcpServers };
}

export function importMCPServersFromJson(json: string): MCPImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("Invalid MCP JSON");
  }

  const root = parsed as { mcpServers?: Record<string, MCPImportedServerInput> };
  const entries = Object.entries(root?.mcpServers ?? {});
  const imported: MCPServerConfig[] = [];
  const skipped: string[] = [];

  for (const [name, value] of entries) {
    const transport =
      typeof value?.transport === "string" && isTransport(value.transport)
        ? value.transport
        : typeof value?.url === "string"
          ? "streamable_http"
          : "stdio";

    try {
      const next = upsertMCPServer({
        name,
        transport,
        command: typeof value?.command === "string" ? value.command : "",
        args: normalizeArgs(value?.args),
        env: normalizeEnv(value?.env),
        headers: normalizeHeaders(value?.headers),
        cwd: typeof value?.cwd === "string" ? value.cwd : "",
        url: typeof value?.url === "string" ? value.url : "",
        enabled: true,
      });
      imported.push(next);
    } catch {
      skipped.push(name);
    }
  }

  return { imported, skipped };
}