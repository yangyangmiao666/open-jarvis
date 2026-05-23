import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation("settings");
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
    void load();
    setEditing(null);
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
      toast.success(t("mcpConfig.saved"));
    } catch {
      toast.error(t("mcpConfig.saveFailed"));
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
      toast.success(t("mcpConfig.deleted"));
    } catch {
      toast.error(t("mcpConfig.deleteFailed"));
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
      const skippedSuffix = result.skipped.length > 0
        ? t("mcpConfig.importSkipped", { count: result.skipped.length })
        : "";
      toast.success(
        t("mcpConfig.imported", { imported: result.imported.length, skipped: skippedSuffix }),
      );
      setImportJson("");
    } catch {
      toast.error(t("mcpConfig.importFailed"));
    }
  };

  const handleCopyExport = async (): Promise<void> => {
    try {
      const exported = await window.api.mcp.exportServers();
      await navigator.clipboard.writeText(JSON.stringify(exported, null, 2));
      toast.success(t("mcpConfig.copyExportSuccess"));
    } catch {
      toast.error(t("mcpConfig.saveFailed"));
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex max-h-[min(92vh,54rem)] w-[min(96vw,72rem)] max-w-5xl flex-col overflow-hidden p-0">
        <DialogHeader className="shrink-0 rounded-t-4xl border-b border-border/60 px-6 py-5 pr-16 sm:px-7 sm:pr-20">
          <div className="flex items-center gap-3">
            <div className="badge-purple inline-flex shrink-0 items-center gap-2 rounded-full border border-status-accent/20 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em]">
              <Cable className="size-3.5" />
              {t('mcpConfig.workspaceLabel')}
            </div>
            <DialogTitle className="text-xl tracking-[-0.03em]">
              {t('mcpConfig.title')}
            </DialogTitle>
          </div>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5 sm:px-7">
        <div className="grid min-h-0 gap-4 lg:grid-cols-[1.05fr_1.2fr]">
          <div className="flex min-h-0 flex-col gap-3">
            <div className="app-flat-surface rounded-3xl p-4">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Cable className="size-4" />
                {t('mcpConfig.defaultEnabled')}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {t('mcpConfig.defaultEnabledDesc')}
              </p>

              <ScrollArea className="app-subtle-scroll mt-3 h-55 rounded-[20px] border border-border/75 bg-background/35">
                <div className="p-2 space-y-2">
                  {servers.length === 0 && (
                    <p className="px-2 py-4 text-xs text-muted-foreground">
                      {t('mcpConfig.noServers')}
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
                            ? server.command || t('mcpConfig.noCommand')
                            : server.url || t('mcpConfig.noUrl')}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              </ScrollArea>
            </div>

            <div className="app-flat-surface rounded-3xl p-4">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-medium">{t('mcpConfig.importExport')}</div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {t('mcpConfig.importExportDesc')}
                  </p>
                </div>
                <Button type="button" size="sm" variant="outline" onClick={() => void handleCopyExport()}>
                  <Copy className="size-3.5" />
                  {t('mcpConfig.copyExport')}
                </Button>
              </div>

              <textarea
                value={importJson}
                onChange={(event) => setImportJson(event.target.value)}
                placeholder={'{\n  "mcpServers": {\n    "my-server": {\n      "command": "npx",\n      "args": ["-y", "@scope/server"]\n    }\n  }\n}'}
                className={cn(textAreaClassName, "mt-3 min-h-40")}
              />
              <div className="mt-2 flex justify-end">
                <Button
                  type="button"
                  size="sm"
                  disabled={!importJson.trim()}
                  onClick={() => void handleImport()}
                >
                  {t('mcpConfig.importJson')}
                </Button>
              </div>
            </div>
          </div>

          <div className="flex min-h-0 flex-col gap-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-sm font-medium">{t('mcpConfig.serverList')}</div>
              </div>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={serverSearch}
                    onChange={(e) => setServerSearch(e.target.value)}
                    placeholder={t('common:search')}
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
                  {t('common:add')}
                </Button>
              </div>
            </div>

            {editing && (
              <div className="app-flat-surface space-y-3 rounded-3xl p-4 animate-slide-down-in">
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-1">
                    <label htmlFor="mcp-name" className="text-sm font-medium">
                      {t('mcpConfig.displayName')}
                    </label>
                    <Input
                      id="mcp-name"
                      value={editing.name}
                      onChange={(event) =>
                        setEditing({ ...editing, name: event.target.value })
                      }
                      placeholder={t('mcpConfig.namePlaceholder')}
                    />
                  </div>
                  <div className="space-y-1">
                    <label htmlFor="mcp-transport" className="text-sm font-medium">
                      {t('mcpConfig.transport')}
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
                        {t('mcpConfig.startCommand')}
                      </label>
                      <Input
                        id="mcp-command"
                        value={editing.command}
                        onChange={(event) =>
                          setEditing({ ...editing, command: event.target.value })
                        }
                        placeholder={t('mcpConfig.commandPlaceholder')}
                      />
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="space-y-1">
                        <label className="text-sm font-medium">{t('mcpConfig.argsList')}</label>
                        <textarea
                          value={argsText}
                          onChange={(event) => setArgsText(event.target.value)}
                          placeholder={t('mcpConfig.argsPlaceholder')}
                          className={textAreaClassName}
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-sm font-medium">{t('mcpConfig.envVars')}</label>
                        <textarea
                          value={envText}
                          onChange={(event) => setEnvText(event.target.value)}
                          placeholder={t('mcpConfig.envPlaceholder')}
                          className={textAreaClassName}
                        />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <label htmlFor="mcp-cwd" className="text-sm font-medium">
                        {t('mcpConfig.workingDir')}
                      </label>
                      <Input
                        id="mcp-cwd"
                        value={editing.cwd}
                        onChange={(event) =>
                          setEditing({ ...editing, cwd: event.target.value })
                        }
                        placeholder={t('mcpConfig.cwdPlaceholder')}
                      />
                    </div>
                  </>
                ) : (
                  <>
                    <div className="space-y-1">
                      <label htmlFor="mcp-url" className="text-sm font-medium">
                        {t('mcpConfig.serviceUrl')}
                      </label>
                      <Input
                        id="mcp-url"
                        value={editing.url}
                        onChange={(event) =>
                          setEditing({ ...editing, url: event.target.value })
                        }
                        placeholder={t('mcpConfig.urlPlaceholder')}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-sm font-medium">{t('mcpConfig.headers')}</label>
                      <textarea
                        value={headersText}
                        onChange={(event) => setHeadersText(event.target.value)}
                        placeholder={t('mcpConfig.headersPlaceholder')}
                        className={textAreaClassName}
                      />
                      <p className="text-xs text-muted-foreground">
                        {t('mcpConfig.headersExample')}
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
                    {t('mcpConfig.configAvailable')}
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(null)}>
                      {t('common:cancel')}
                    </Button>
                    <Button type="button" size="sm" onClick={() => void handleSave()}>
                      {t('common:save')}
                    </Button>
                  </div>
                </div>
              </div>
            )}

            <ScrollArea className="app-subtle-scroll min-h-60 flex-1 rounded-[20px] border border-border bg-background/35">
              <div className="p-2 space-y-1">
                {filteredServers.length === 0 && !editing && (
                  <p className="px-2 py-6 text-center text-xs text-muted-foreground">
                    {serverSearch.trim() ? t('mcpConfig.noSearchResults') : t('mcpConfig.noMcpConfigs')}
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
                            {t('mcpConfig.disabled')}
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
            <DialogTitle>{t('mcpConfig.confirmDeleteMcp')}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {t('mcpConfig.deleteMcpWarning', { name: deleteTarget?.name || t('mcpConfig.currentConfig') })}
          </p>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setDeleteTarget(null)}
            >
              {t('common:cancel')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void handleDelete()}
            >
              {t('common:delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}