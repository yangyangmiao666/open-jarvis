import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2, Pencil, Cable, Copy } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { useCurrentThread } from "@/lib/thread-context";
import type { MCPServerConfig, MCPTransportType } from "@/types";

interface MCPConfigDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  threadId: string;
}

const textAreaClassName = cn(
  "flex min-h-[96px] w-full rounded-2xl border border-input bg-background px-3 py-2 text-xs font-mono",
  "placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
  "disabled:cursor-not-allowed disabled:opacity-50",
);

const emptyForm = (): Omit<MCPServerConfig, "id"> & { id?: string } => ({
  name: "",
  transport: "stdio",
  command: "",
  args: [],
  env: {},
  cwd: "",
  url: "",
  enabled: true,
});

function stringifyEnv(env: Record<string, string>): string {
  return Object.entries(env)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
}

function parseEnv(text: string): Record<string, string> {
  return Object.fromEntries(
    text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const separator = line.indexOf("=");
        if (separator < 0) return [line, ""];
        return [line.slice(0, separator).trim(), line.slice(separator + 1)];
      })
      .filter(([key]) => key.length > 0),
  );
}

export function MCPConfigDialog({
  open,
  onOpenChange,
  threadId,
}: MCPConfigDialogProps): React.JSX.Element {
  const { enabledMcpServerIds, setEnabledMcpServerIds } = useCurrentThread(threadId);
  const [servers, setServers] = useState<MCPServerConfig[]>([]);
  const [editing, setEditing] = useState<
    (Omit<MCPServerConfig, "id"> & { id?: string }) | null
  >(null);
  const [envText, setEnvText] = useState("");
  const [argsText, setArgsText] = useState("");
  const [importJson, setImportJson] = useState("");
  const [status, setStatus] = useState<string | null>(null);

  const enabledIdSet = useMemo(
    () => new Set(enabledMcpServerIds),
    [enabledMcpServerIds],
  );

  const beginEditing = (
    next: Omit<MCPServerConfig, "id"> & { id?: string },
  ): void => {
    setEditing(next);
    setEnvText(stringifyEnv(next.env));
    setArgsText(next.args.join("\n"));
  };

  const load = async (): Promise<void> => {
    const next = await window.api.mcp.listServers();
    setServers(next);
  };

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEditing(null);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setImportJson("");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStatus(null);
  }, [open]);

  const handleSave = async (): Promise<void> => {
    if (!editing) return;

    const payload = {
      ...editing,
      env: parseEnv(envText),
      args: argsText
        .split("\n")
        .map((arg) => arg.trim())
        .filter(Boolean),
    };

    await window.api.mcp.upsertServer(payload);
    await load();
    setEditing(null);
    setStatus("MCP 配置已保存");
  };

  const handleDelete = async (id: string): Promise<void> => {
    await window.api.mcp.deleteServer(id);
    await load();
    if (enabledIdSet.has(id)) {
      setEnabledMcpServerIds(enabledMcpServerIds.filter((serverId) => serverId !== id));
    }
    setStatus("MCP 配置已删除");
  };

  const handleToggleEnabled = (serverId: string, checked: boolean): void => {
    if (checked) {
      setEnabledMcpServerIds([...enabledMcpServerIds, serverId]);
    } else {
      setEnabledMcpServerIds(
        enabledMcpServerIds.filter((currentId) => currentId !== serverId),
      );
    }
  };

  const handleImport = async (): Promise<void> => {
    const result = await window.api.mcp.importServers(importJson);
    await load();
    setStatus(
      `已导入 ${result.imported.length} 项${
        result.skipped.length > 0 ? `，跳过 ${result.skipped.length} 项` : ""
      }`,
    );
    setImportJson("");
  };

  const handleCopyExport = async (): Promise<void> => {
    const exported = await window.api.mcp.exportServers();
    await navigator.clipboard.writeText(JSON.stringify(exported, null, 2));
    setStatus("已复制导出 JSON");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-5xl flex flex-col">
        <DialogHeader>
          <DialogTitle>MCP 配置</DialogTitle>
          <DialogDescription>
            为当前会话启用 MCP 工具，并管理全局 MCP server 列表。
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 md:grid-cols-[1.05fr_1.2fr] flex-1 min-h-0">
          <div className="flex min-h-0 flex-col gap-3">
            <div className="app-flat-surface rounded-[24px] p-4">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Cable className="size-4" />
                当前会话已启用
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                勾选后，当前线程在下一次调用 agent 时会装配对应的 MCP 工具。
              </p>

              <ScrollArea className="mt-3 h-[220px] rounded-[20px] border border-border/75">
                <div className="p-2 space-y-2">
                  {servers.length === 0 && (
                    <p className="px-2 py-4 text-xs text-muted-foreground">
                      还没有可启用的 MCP server。
                    </p>
                  )}
                  {servers.map((server) => (
                    <label
                      key={server.id}
                      className="flex items-start gap-2 rounded-2xl px-3 py-2 text-xs hover:bg-muted/40"
                    >
                      <input
                        type="checkbox"
                        className="mt-0.5"
                        checked={enabledIdSet.has(server.id)}
                        onChange={(event) =>
                          handleToggleEnabled(server.id, event.target.checked)
                        }
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium text-foreground">
                          {server.name}
                        </span>
                        <span className="block truncate text-muted-foreground font-mono mt-0.5">
                          {server.transport === "stdio"
                            ? server.command || "未配置命令"
                            : server.url || "未配置 URL"}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              </ScrollArea>
            </div>

            <div className="app-flat-surface rounded-[24px] p-4">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-medium">导入 / 导出</div>
                  <p className="text-xs text-muted-foreground mt-1">
                    支持粘贴 Claude Desktop 风格的 mcpServers JSON。
                  </p>
                </div>
                <Button type="button" size="sm" variant="outline" onClick={() => void handleCopyExport()}>
                  <Copy className="size-3.5" />
                  复制导出
                </Button>
              </div>

              <textarea
                value={importJson}
                onChange={(event) => setImportJson(event.target.value)}
                placeholder={'{\n  "mcpServers": {\n    "my-server": {\n      "command": "npx",\n      "args": ["-y", "@scope/server"]\n    }\n  }\n}'}
                className={cn(textAreaClassName, "mt-3 min-h-[160px]")}
              />
              <div className="mt-2 flex justify-end">
                <Button
                  type="button"
                  size="sm"
                  disabled={!importJson.trim()}
                  onClick={() => void handleImport()}
                >
                  导入 JSON
                </Button>
              </div>
            </div>
          </div>

          <div className="flex min-h-0 flex-col gap-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-sm font-medium">全局 Server 列表</div>
                <p className="text-xs text-muted-foreground mt-1">
                  首版运行时优先支持 stdio；远程 transport 先保存配置，暂不连接。
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1"
                onClick={() => beginEditing(emptyForm())}
              >
                <Plus className="size-4" />
                添加
              </Button>
            </div>

            {editing && (
              <div className="app-flat-surface space-y-3 rounded-[24px] p-4">
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-1">
                    <label htmlFor="mcp-name" className="text-sm font-medium">
                      显示名称
                    </label>
                    <Input
                      id="mcp-name"
                      value={editing.name}
                      onChange={(event) =>
                        setEditing({ ...editing, name: event.target.value })
                      }
                      placeholder="例如：Context7"
                    />
                  </div>
                  <div className="space-y-1">
                    <label htmlFor="mcp-transport" className="text-sm font-medium">
                      传输方式
                    </label>
                    <select
                      id="mcp-transport"
                      value={editing.transport}
                      onChange={(event) =>
                        setEditing({
                          ...editing,
                          transport: event.target.value as MCPTransportType,
                        })
                      }
                      className="flex h-9 w-full rounded-sm border border-input bg-background px-3 py-2 text-sm shadow-sm"
                    >
                      <option value="stdio">stdio</option>
                      <option value="streamable_http">streamable_http</option>
                      <option value="sse">sse</option>
                    </select>
                  </div>
                </div>

                {editing.transport === "stdio" ? (
                  <>
                    <div className="space-y-1">
                      <label htmlFor="mcp-command" className="text-sm font-medium">
                        启动命令
                      </label>
                      <Input
                        id="mcp-command"
                        value={editing.command}
                        onChange={(event) =>
                          setEditing({ ...editing, command: event.target.value })
                        }
                        placeholder="例如：npx"
                      />
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="space-y-1">
                        <label className="text-sm font-medium">参数列表</label>
                        <textarea
                          value={argsText}
                          onChange={(event) => setArgsText(event.target.value)}
                          placeholder="每行一个参数"
                          className={textAreaClassName}
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-sm font-medium">环境变量</label>
                        <textarea
                          value={envText}
                          onChange={(event) => setEnvText(event.target.value)}
                          placeholder="每行一个 KEY=VALUE"
                          className={textAreaClassName}
                        />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <label htmlFor="mcp-cwd" className="text-sm font-medium">
                        工作目录（可选）
                      </label>
                      <Input
                        id="mcp-cwd"
                        value={editing.cwd}
                        onChange={(event) =>
                          setEditing({ ...editing, cwd: event.target.value })
                        }
                        placeholder="例如：/absolute/path/to/workdir"
                      />
                    </div>
                  </>
                ) : (
                  <div className="space-y-1">
                    <label htmlFor="mcp-url" className="text-sm font-medium">
                      服务地址
                    </label>
                    <Input
                      id="mcp-url"
                      value={editing.url}
                      onChange={(event) =>
                        setEditing({ ...editing, url: event.target.value })
                      }
                      placeholder="例如：https://mcp.example.com"
                    />
                  </div>
                )}

                <div className="flex items-center justify-between gap-2">
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={editing.enabled}
                      onChange={(event) =>
                        setEditing({ ...editing, enabled: event.target.checked })
                      }
                    />
                    配置可用
                  </label>
                  <div className="flex gap-2">
                    <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(null)}>
                      取消
                    </Button>
                    <Button type="button" size="sm" onClick={() => void handleSave()}>
                      保存
                    </Button>
                  </div>
                </div>
              </div>
            )}

            <ScrollArea className="flex-1 rounded-md border border-border min-h-[240px]">
              <div className="p-2 space-y-1">
                {servers.length === 0 && !editing && (
                  <p className="px-2 py-6 text-center text-xs text-muted-foreground">
                    暂无 MCP server 配置
                  </p>
                )}
                {servers.map((server) => (
                  <div
                    key={server.id}
                    className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-xs hover:bg-muted/40"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-medium">{server.name}</span>
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">
                          {server.transport}
                        </span>
                        {!server.enabled && (
                          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                            disabled
                          </span>
                        )}
                      </div>
                      <div className="truncate font-mono text-muted-foreground mt-0.5">
                        {server.transport === "stdio"
                          ? [server.command, ...server.args].filter(Boolean).join(" ")
                          : server.url}
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-7 shrink-0"
                      onClick={() => beginEditing({ ...server })}
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-7 shrink-0 text-destructive"
                      onClick={() => void handleDelete(server.id)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>
        </div>

        <DialogFooter className="items-center justify-between sm:justify-between">
          <div className="text-xs text-muted-foreground min-h-4">{status ?? ""}</div>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}