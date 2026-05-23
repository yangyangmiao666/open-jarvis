import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Trash2, Pencil, Copy, Search } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import {
  SettingsSection,
  SettingsCard,
  SettingsRow,
  SettingsToggle,
} from "./primitives";
import type { MCPServerConfig, MCPTransportType } from "@/types";

const textAreaClassName =
  "flex min-h-[96px] w-full rounded-lg border border-input bg-background px-3 py-2 text-xs font-mono " +
  "placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring " +
  "disabled:cursor-not-allowed disabled:opacity-50 resize-y";

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
  return Object.entries(env).map(([k, v]) => `${k}=${v}`).join("\n");
}

function parseEnv(text: string): Record<string, string> {
  return Object.fromEntries(
    text.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
      const sep = l.indexOf("=");
      if (sep < 0) return [l, ""];
      return [l.slice(0, sep).trim(), l.slice(sep + 1)];
    }).filter(([k]) => k.length > 0),
  );
}

export function MCPConfigPanel(): React.JSX.Element {
  const { t } = useTranslation("settings");
  const [enabledMcpServerIds, setEnabledMcpServerIds] = useState<string[]>([]);
  const [servers, setServers] = useState<MCPServerConfig[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<MCPServerConfig | null>(null);
  const [editing, setEditing] = useState<(Omit<MCPServerConfig, "id"> & { id?: string }) | null>(null);
  const [envText, setEnvText] = useState("");
  const [headersText, setHeadersText] = useState("");
  const [argsText, setArgsText] = useState("");
  const [importJson, setImportJson] = useState("");
  const [serverSearch, setServerSearch] = useState("");

  const filteredServers = useMemo(
    () =>
      serverSearch.trim()
        ? servers.filter((s) => s.name.toLowerCase().includes(serverSearch.toLowerCase()))
        : servers,
    [servers, serverSearch],
  );

  const enabledIdSet = useMemo(() => new Set(enabledMcpServerIds), [enabledMcpServerIds]);

  const beginEditing = (next: Omit<MCPServerConfig, "id"> & { id?: string }): void => {
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
    void load();
    setEditing(null);
    setImportJson("");
  }, []);

  const handleSave = async (): Promise<void> => {
    if (!editing) return;
    const payload = {
      ...editing,
      env: parseEnv(envText),
      headers: parseEnv(headersText),
      args: argsText.split("\n").map((a) => a.trim()).filter(Boolean),
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
        const nextIds = enabledMcpServerIds.filter((sid) => sid !== id);
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
      : enabledMcpServerIds.filter((sid) => sid !== serverId);
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
      toast.success(t("mcpConfig.imported", { imported: result.imported.length, skipped: skippedSuffix }));
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
      <div className="space-y-6">
        <SettingsSection title={t("mcpConfig.defaultEnabled")} description={t("mcpConfig.defaultEnabledDesc")}>
          <SettingsCard>
            {servers.length === 0 ? (
              <div className="px-4 py-6 text-sm text-muted-foreground">{t("mcpConfig.noServers")}</div>
            ) : (
              servers.map((server) => (
                <SettingsToggle
                  key={server.id}
                  label={server.name}
                  description={server.transport === "stdio" ? (server.command || t("mcpConfig.noCommand")) : (server.url || t("mcpConfig.noUrl"))}
                  checked={enabledIdSet.has(server.id)}
                  onCheckedChange={(checked) => handleToggleEnabled(server.id, checked)}
                />
              ))
            )}
          </SettingsCard>
        </SettingsSection>

        <SettingsSection title={t("mcpConfig.importExport")} description={t("mcpConfig.importExportDesc")}>
          <SettingsCard divided={false}>
            <div className="px-4 pt-3">
              <textarea
                value={importJson}
                onChange={(e) => setImportJson(e.target.value)}
                placeholder={'{\n  "mcpServers": {\n    "my-server": {\n      "command": "npx",\n      "args": ["-y", "@scope/server"]\n    }\n  }\n}'}
                className={textAreaClassName}
              />
            </div>
            <div className="flex justify-end gap-2 px-4 py-3">
              <Button variant="outline" size="sm" onClick={() => void handleCopyExport()}>
                <Copy className="h-3.5 w-3.5 mr-1" />
                {t("mcpConfig.copyExport")}
              </Button>
              <Button size="sm" disabled={!importJson.trim()} onClick={() => void handleImport()}>
                {t("mcpConfig.importJson")}
              </Button>
            </div>
          </SettingsCard>
        </SettingsSection>

        <SettingsSection
          title={t("mcpConfig.serverList")}
          action={
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={serverSearch}
                  onChange={(e) => setServerSearch(e.target.value)}
                  placeholder={t("common:search")}
                  className="h-8 w-36 rounded-lg pl-8 text-xs"
                />
              </div>
              <Button variant="outline" size="sm" onClick={() => beginEditing(emptyForm())}>
                <Plus className="h-4 w-4 mr-1" />
                {t("common:add")}
              </Button>
            </div>
          }
        >
          {editing && (
            <div className="rounded-xl border border-border/50 bg-card mb-3 overflow-hidden">
              <div className="grid gap-3 p-4 md:grid-cols-2">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">{t("mcpConfig.displayName")}</label>
                  <Input
                    value={editing.name}
                    onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                    placeholder={t("mcpConfig.namePlaceholder")}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">{t("mcpConfig.transport")}</label>
                  <select
                    value={editing.transport}
                    onChange={(e) => setEditing({ ...editing, transport: e.target.value as MCPTransportType })}
                    className="flex h-9 w-full rounded-lg border border-input bg-background px-3 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <option value="stdio">stdio</option>
                    <option value="streamable_http">streamable_http</option>
                    <option value="sse">sse</option>
                  </select>
                </div>
              </div>

              {editing.transport === "stdio" ? (
                <div className="space-y-3 px-4 pb-4">
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">{t("mcpConfig.startCommand")}</label>
                    <Input
                      value={editing.command}
                      onChange={(e) => setEditing({ ...editing, command: e.target.value })}
                      placeholder={t("mcpConfig.commandPlaceholder")}
                    />
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium">{t("mcpConfig.argsList")}</label>
                      <textarea
                        value={argsText}
                        onChange={(e) => setArgsText(e.target.value)}
                        placeholder={t("mcpConfig.argsPlaceholder")}
                        className={textAreaClassName}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium">{t("mcpConfig.envVars")}</label>
                      <textarea
                        value={envText}
                        onChange={(e) => setEnvText(e.target.value)}
                        placeholder={t("mcpConfig.envPlaceholder")}
                        className={textAreaClassName}
                      />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">{t("mcpConfig.workingDir")}</label>
                    <Input
                      value={editing.cwd}
                      onChange={(e) => setEditing({ ...editing, cwd: e.target.value })}
                      placeholder={t("mcpConfig.cwdPlaceholder")}
                    />
                  </div>
                </div>
              ) : (
                <div className="space-y-3 px-4 pb-4">
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">{t("mcpConfig.serviceUrl")}</label>
                    <Input
                      value={editing.url}
                      onChange={(e) => setEditing({ ...editing, url: e.target.value })}
                      placeholder={t("mcpConfig.urlPlaceholder")}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">{t("mcpConfig.headers")}</label>
                    <textarea
                      value={headersText}
                      onChange={(e) => setHeadersText(e.target.value)}
                      placeholder={t("mcpConfig.headersPlaceholder")}
                      className={textAreaClassName}
                    />
                    <p className="text-xs text-muted-foreground">{t("mcpConfig.headersExample")}</p>
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between border-t px-4 py-3">
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={editing.enabled}
                    onChange={(e) => setEditing({ ...editing, enabled: e.target.checked })}
                  />
                  {t("mcpConfig.configAvailable")}
                </label>
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setEditing(null)}>{t("common:cancel")}</Button>
                  <Button size="sm" onClick={() => void handleSave()}>{t("common:save")}</Button>
                </div>
              </div>
            </div>
          )}

          <SettingsCard>
            {filteredServers.length === 0 && !editing ? (
              <div className="px-4 py-6 text-sm text-muted-foreground text-center">
                {serverSearch.trim() ? t("mcpConfig.noSearchResults") : t("mcpConfig.noMcpConfigs")}
              </div>
            ) : (
              filteredServers.map((server) => (
                <SettingsRow
                  key={server.id}
                  label={server.name}
                  description={
                    server.transport === "stdio"
                      ? [server.command, ...server.args].filter(Boolean).join(" ")
                      : server.url
                  }
                >
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => beginEditing({ ...server })}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => setDeleteTarget(server)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </SettingsRow>
              ))
            )}
          </SettingsCard>
        </SettingsSection>
      </div>

      <Dialog open={deleteTarget !== null} onOpenChange={(nextOpen) => !nextOpen && setDeleteTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("mcpConfig.confirmDeleteMcp")}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {t("mcpConfig.deleteMcpWarning", { name: deleteTarget?.name || t("mcpConfig.currentConfig") })}
          </p>
          <DialogFooter className="gap-2">
            <Button variant="secondary" onClick={() => setDeleteTarget(null)}>{t("common:cancel")}</Button>
            <Button variant="destructive" onClick={() => void handleDelete()}>{t("common:delete")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}