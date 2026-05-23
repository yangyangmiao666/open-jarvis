import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Trash2, Pencil, Copy, Search, FileJson } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "@/lib/toast";
import {
  SettingsSection,
  SettingsCard,
  SettingsRow,
  SettingsSegmentedControl,
} from "./primitives";
import { Switch } from "@/components/ui/switch";
import type { MCPServerConfig, MCPTransportType } from "@/types";

const textAreaClassName =
  "flex min-h-[96px] w-full rounded-lg border border-input app-premium-field px-3 py-2 text-xs font-mono " +
  "placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/55 " +
  "focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 resize-y";

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

function serializeServerToJson(server: Omit<MCPServerConfig, "id"> & { id?: string }): string {
  const obj: Record<string, unknown> = {};
  if (server.id) obj.id = server.id;
  obj.name = server.name;
  obj.transport = server.transport;
  obj.command = server.command;
  obj.args = server.args;
  obj.env = server.env;
  obj.headers = server.headers;
  obj.url = server.url;
  obj.enabled = server.enabled;
  return JSON.stringify(obj, null, 2);
}

function parseServerFromJson(text: string): Omit<MCPServerConfig, "id"> & { id?: string } | null {
  try {
    const obj = JSON.parse(text);
    return {
      id: typeof obj.id === "string" ? obj.id : undefined,
      name: typeof obj.name === "string" ? obj.name : "",
      transport: obj.transport === "sse" || obj.transport === "streamable_http" ? obj.transport : "stdio",
      command: typeof obj.command === "string" ? obj.command : "",
      args: Array.isArray(obj.args) ? obj.args.map(String) : [],
      env: typeof obj.env === "object" && obj.env !== null ? Object.fromEntries(Object.entries(obj.env).map(([k, v]) => [k, String(v)])) : {},
      headers: typeof obj.headers === "object" && obj.headers !== null ? Object.fromEntries(Object.entries(obj.headers).map(([k, v]) => [k, String(v)])) : {},
      cwd: typeof obj.cwd === "string" ? obj.cwd : "",
      url: typeof obj.url === "string" ? obj.url : "",
      enabled: obj.enabled !== false,
    };
  } catch {
    return null;
  }
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
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [serverSearch, setServerSearch] = useState("");
  const [editMode, setEditMode] = useState<"form" | "json">("form");
  const [jsonText, setJsonText] = useState("");

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
    setJsonText(serializeServerToJson(next));
    setEditMode("form");
  };

  const switchToFormMode = (): void => {
    if (!editing) return;
    const parsed = parseServerFromJson(jsonText);
    if (parsed) {
      setEditing(parsed);
      setEnvText(stringifyEnv(parsed.env));
      setHeadersText(stringifyEnv(parsed.headers));
      setArgsText(parsed.args.join("\n"));
      setEditMode("form");
    } else {
      toast.error(t("mcpConfig.invalidJson"));
    }
  };

  const switchToJsonMode = (): void => {
    if (!editing) return;
    setJsonText(serializeServerToJson(editing));
    setEditMode("json");
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
  }, []);

  const handleSave = async (): Promise<void> => {
    if (!editing) return;

    let payload: Omit<MCPServerConfig, "id"> & { id?: string };
    if (editMode === "json") {
      const parsed = parseServerFromJson(jsonText);
      if (!parsed) {
        toast.error(t("mcpConfig.invalidJson"));
        return;
      }
      payload = parsed;
    } else {
      payload = {
        ...editing,
        env: parseEnv(envText),
        headers: parseEnv(headersText),
        args: argsText.split("\n").map((a) => a.trim()).filter(Boolean),
      };
    }

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
      setImportDialogOpen(false);
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
              <Button variant="outline" size="sm" onClick={() => setImportDialogOpen(true)}>
                <FileJson className="h-4 w-4 mr-1" />
                {t("mcpConfig.importJson")}
              </Button>
              <Button variant="outline" size="sm" onClick={() => beginEditing(emptyForm())}>
                <Plus className="h-4 w-4 mr-1" />
                {t("common:add")}
              </Button>
            </div>
          }
        >
          {filteredServers.length === 0 ? (
            <div className="rounded-xl border border-border/50 px-4 py-8 text-center text-sm text-muted-foreground">
              {serverSearch.trim() ? t("mcpConfig.noSearchResults") : t("mcpConfig.noMcpConfigs")}
            </div>
          ) : (
            <SettingsCard>
              {filteredServers.map((server) => (
                <SettingsRow
                  key={server.id}
                  label={server.name}
                  description={
                    server.transport === "stdio"
                      ? [server.command, ...server.args].filter(Boolean).join(" ")
                      : server.url
                  }
                >
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={enabledIdSet.has(server.id)}
                      onCheckedChange={(checked) => handleToggleEnabled(server.id, checked)}
                    />
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => beginEditing({ ...server })}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => setDeleteTarget(server)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </SettingsRow>
              ))}
            </SettingsCard>
          )}
        </SettingsSection>
      </div>

      {/* Edit / New Server Dialog */}
      <Dialog open={editing !== null} onOpenChange={(nextOpen) => !nextOpen && setEditing(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing?.id ? t("mcpConfig.editConfigTitle") : t("mcpConfig.newConfigTitle")}</DialogTitle>
          </DialogHeader>
          <SettingsSegmentedControl
            options={[
              { value: "form", label: t("mcpConfig.formMode") },
              { value: "json", label: t("mcpConfig.jsonMode") },
            ]}
            value={editMode}
            onValueChange={(v) => v === "form" ? switchToFormMode() : switchToJsonMode()}
          />
          {editMode === "json" ? (
            <textarea
              value={jsonText}
              onChange={(e) => setJsonText(e.target.value)}
              className={textAreaClassName + " min-h-[300px]"}
              placeholder={serializeServerToJson(emptyForm())}
            />
          ) : (
            <ScrollArea className="max-h-[60vh]">
              <div className="space-y-3 pr-1">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">{t("mcpConfig.displayName")}</label>
                    <Input
                      value={editing?.name ?? ""}
                      onChange={(e) => setEditing({ ...(editing ?? emptyForm()), name: e.target.value })}
                      placeholder={t("mcpConfig.namePlaceholder")}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">{t("mcpConfig.transport")}</label>
                    <Select
                      value={editing?.transport ?? "stdio"}
                      onValueChange={(v) => setEditing({ ...(editing ?? emptyForm()), transport: v as MCPTransportType })}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="stdio">stdio</SelectItem>
                        <SelectItem value="streamable_http">streamable_http</SelectItem>
                        <SelectItem value="sse">sse</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {editing?.transport === "stdio" ? (
                  <div className="space-y-3">
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium">{t("mcpConfig.startCommand")}</label>
                      <Input
                        value={editing?.command ?? ""}
                        onChange={(e) => setEditing({ ...(editing ?? emptyForm()), command: e.target.value })}
                        placeholder={t("mcpConfig.commandPlaceholder")}
                      />
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
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
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium">{t("mcpConfig.serviceUrl")}</label>
                      <Input
                        value={editing?.url ?? ""}
                        onChange={(e) => setEditing({ ...(editing ?? emptyForm()), url: e.target.value })}
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

                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={editing?.enabled ?? true}
                    onChange={(e) => setEditing({ ...(editing ?? emptyForm()), enabled: e.target.checked })}
                    className="h-4 w-4 rounded border-border"
                  />
                  <label className="text-xs text-muted-foreground">{t("mcpConfig.configAvailable")}</label>
                </div>
              </div>
            </ScrollArea>
          )}
          <DialogFooter className="gap-2">
            <Button variant="secondary" onClick={() => setEditing(null)}>{t("common:cancel")}</Button>
            <Button onClick={() => void handleSave()}>{t("common:save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Import JSON Dialog */}
      <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("mcpConfig.importExport")}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{t("mcpConfig.importExportDesc")}</p>
          <textarea
            value={importJson}
            onChange={(e) => setImportJson(e.target.value)}
            placeholder={'{\n  "mcpServers": {\n    "my-server": {\n      "command": "npx",\n      "args": ["-y", "@scope/server"]\n    }\n  }\n}'}
            className={textAreaClassName + " min-h-[160px]"}
          />
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => void handleCopyExport()}>
              <Copy className="h-3.5 w-3.5 mr-1" />
              {t("mcpConfig.copyExport")}
            </Button>
            <Button disabled={!importJson.trim()} onClick={() => void handleImport()}>
              {t("mcpConfig.importJson")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
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