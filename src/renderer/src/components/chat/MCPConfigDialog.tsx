import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2, Pencil, Cable, Copy, Search } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { toast } from "@/components/ui/toast";
import type { MCPServerConfig, MCPTransportType } from "@/types";

interface MCPConfigDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
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
  headers: {},
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
}: MCPConfigDialogProps): React.JSX.Element {
  const [enabledMcpServerIds, setEnabledMcpServerIds] = useState<string[]>([]);
  const [servers, setServers] = useState<MCPServerConfig[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<MCPServerConfig | null>(null);
  const [editing, setEditing] = useState<
    (Omit<MCPServerConfig, "id"> & { id?: string }) | null
  >(null);
  const [envText, setEnvText] = useState("");
  const [headersText, setHeadersText] = useState("");
  const [argsText, setArgsText] = useState("");
  const [importJson, setImportJson] = useState("");
  const [serverSearch, setServerSearch] = useState("");

  const filteredServers = useMemo(
    () =>
      serverSearch.trim()
        ? servers.filter((s) =>
            s.name.toLowerCase().includes(serverSearch.toLowerCase()),
          )
        : servers,
    [servers, serverSearch],
  );

  const enabledIdSet = useMemo(
    () => new Set(enabledMcpServerIds),
    [enabledMcpServerIds],
  );

  const beginEditing = (
    next: Omit<MCPServerConfig, "id"> & { id?: string },
  ): void => {
    setEditing(next);
    setEnvText(stringifyEnv(next.env));
    setHeadersText(stringifyEnv(next.headers));
    setArgsText(next.args.join("\n"));
  };

  const load = async (): Promise<void> => {
    const [nextServers, nextEnabledIds] = await Promise.all([
      window.api.mcp.listServers(),
      window.api.mcp.getEnabledForThread(),
    ]);
    setServers(nextServers);
    setEnabledMcpServerIds(nextEnabledIds);
  };

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEditing(null);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setImportJson("");
  }, [open]);

  const handleSave = async (): Promise<void> => {
    if (!editing) return;

    const payload = {
      ...editing,
      env: parseEnv(envText),
      headers: parseEnv(headersText),
      args: argsText
        .split("\n")
        .map((arg) => arg.trim())
        .filter(Boolean),
    };

    try {
      await window.api.mcp.upsertServer(payload);
      await load();
      setEditing(null);
      toast.success("MCP 配置已保存");
    } catch {
      toast.error("保存失败");
    }
  };

  const handleDelete = async (): Promise<void> => {
    if (!deleteTarget) return;
    const id = deleteTarget.id;
    try {
      await window.api.mcp.deleteServer(id);
      await load();
      if (enabledIdSet.has(id)) {
        const nextIds = enabledMcpServerIds.filter(
          (serverId) => serverId !== id,
        );
        setEnabledMcpServerIds(nextIds);
        await window.api.mcp.setEnabledForThread(undefined, nextIds);
      }
      setDeleteTarget(null);
      toast.success("MCP 配置已删除");
    } catch {
      toast.error("删除失败");
    }
  };

  const handleToggleEnabled = (serverId: string, checked: boolean): void => {
    const nextIds = checked
      ? [...enabledMcpServerIds, serverId]
      : enabledMcpServerIds.filter((currentId) => currentId !== serverId);
    setEnabledMcpServerIds(nextIds);
    void window.api.mcp.setEnabledForThread(undefined, nextIds);
  };

  const handleImport = async (): Promise<void> => {
    try {
      const result = await window.api.mcp.importServers(importJson);
      await load();
      toast.success(
        `已导入 ${result.imported.length} 项${
          result.skipped.length > 0 ? `，跳过 ${result.skipped.length} 项` : ""
        }`,
      );
      setImportJson("");
    } catch {
      toast.error("导入失败");
    }
  };

  const handleCopyExport = async (): Promise<void> => {
    try {
      const exported = await window.api.mcp.exportServers();
      await navigator.clipboard.writeText(JSON.stringify(exported, null, 2));
      toast.success("已复制导出 JSON");
    } catch {
      toast.error("复制失败");
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex max-h-[min(92vh,54rem)] w-[min(96vw,72rem)] max-w-5xl flex-col overflow-hidden p-0">
        <DialogHeader className="shrink-0 rounded-t-[32px] border-b border-border/60 px-6 py-5 pr-16 sm:px-7 sm:pr-20">
          <div className="flex items-center gap-3">
            <div className="badge-purple inline-flex shrink-0 items-center gap-2 rounded-full border border-status-accent/20 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em]">
              <Cable className="size-3.5" />
              MCP Workspace
            </div>
            <DialogTitle className="text-xl tracking-[-0.03em]">
              MCP 配置
            </DialogTitle>
          </div>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5 sm:px-7">
        <div className="grid min-h-0 gap-4 lg:grid-cols-[1.05fr_1.2fr]">
          <div className="flex min-h-0 flex-col gap-3">
            <div className="app-flat-surface rounded-[24px] p-4">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Cable className="size-4" />
                全局默认启用
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                勾选后，后续会话在调用 agent 时会默认装配对应的 MCP 工具。
              </p>

              <ScrollArea className="app-subtle-scroll mt-3 h-[220px] rounded-[20px] border border-border/75 bg-background/35">
                <div className="p-2 space-y-2">
                  {servers.length === 0 && (
                    <p className="px-2 py-4 text-xs text-muted-foreground">
                      还没有可启用的 MCP server。
                    </p>
                  )}
                  {servers.map((server) => (
                    <label
                      key={server.id}
                      className="flex items-start gap-2 rounded-2xl border border-transparent px-3 py-2 text-xs hover:border-primary/18 hover:bg-background-interactive/58"
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
              </div>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={serverSearch}
                    onChange={(e) => setServerSearch(e.target.value)}
                    placeholder="搜索..."
                    className="h-8 w-36 rounded-xl pl-8 text-xs"
                  />
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
            </div>

            {editing && (
              <div className="app-flat-surface space-y-3 rounded-[24px] p-4 animate-slide-down-in">
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
                      className="flex h-9 w-full rounded-2xl border border-input bg-background px-3 py-2 text-sm shadow-sm"
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
                  <>
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
                    <div className="space-y-1">
                      <label className="text-sm font-medium">请求头</label>
                      <textarea
                        value={headersText}
                        onChange={(event) => setHeadersText(event.target.value)}
                        placeholder="每行一个 Header=Value"
                        className={textAreaClassName}
                      />
                      <p className="text-xs text-muted-foreground">
                        例如：x-browser-use-api-key=bu_xxx
                      </p>
                    </div>
                  </>
                )}

                <div className="flex flex-wrap items-center justify-between gap-2">
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
                  <div className="flex flex-wrap gap-2">
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

            <ScrollArea className="app-subtle-scroll min-h-[240px] flex-1 rounded-[20px] border border-border bg-background/35">
              <div className="p-2 space-y-1">
                {filteredServers.length === 0 && !editing && (
                  <p className="px-2 py-6 text-center text-xs text-muted-foreground">
                    {serverSearch.trim() ? "无匹配结果" : "暂无 MCP server 配置"}
                  </p>
                )}
                {filteredServers.map((server) => (
                  <div
                    key={server.id}
                    className="flex items-center gap-2 rounded-2xl border border-transparent px-3 py-2 text-xs hover:border-primary/18 hover:bg-background-interactive/58"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-medium">{server.name}</span>
                        <span className="rounded-full border border-border/60 bg-background-elevated/72 px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">
                          {server.transport}
                        </span>
                        {!server.enabled && (
                          <span className="rounded-full border border-border/60 bg-background-elevated/72 px-1.5 py-0.5 text-[10px] text-muted-foreground">
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
                      onClick={() => setDeleteTarget(server)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>
        </div>
        </div>

        </DialogContent>
      </Dialog>

      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(nextOpen) => !nextOpen && setDeleteTarget(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>确认删除 MCP 配置？</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            将删除 MCP server “{deleteTarget?.name || "当前配置"}”，此操作不可恢复。
          </p>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setDeleteTarget(null)}
            >
              取消
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void handleDelete()}
            >
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}