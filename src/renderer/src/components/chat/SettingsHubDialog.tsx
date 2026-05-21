import { useEffect, useState } from "react";
import { Boxes, Cable, Sparkles, Wrench, Orbit, Network, Download, Upload, AlertTriangle, ShieldCheck } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useAppStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { OpenAICompatibleDialog } from "./OpenAICompatibleDialog";
import { MCPConfigDialog } from "./MCPConfigDialog";
import { SkillsDialog } from "../panels/SkillsDialog";
import { ProxyConfigDialog } from "./ProxyConfigDialog";
import type { SettingsOpenRequest, GlobalConfigImportResult } from "@/types";

interface SettingsHubDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  request?: SettingsOpenRequest | null;
}

interface SettingsCardProps {
  icon: React.ElementType;
  eyebrow: string;
  title: string;
  description: string;
  actionLabel: string;
  onAction: () => void;
  accent?: "blue" | "green" | "amber" | "purple";
}

const ACCENT_MAP: Record<string, string> = {
  blue: "icon-blue",
  green: "icon-green",
  amber: "icon-amber",
  purple: "icon-purple",
};

function SettingsCard({
  icon: Icon,
  eyebrow,
  title,
  description,
  actionLabel,
  onAction,
  accent,
}: SettingsCardProps): React.JSX.Element {
  return (
    <div className="app-premium-surface group flex h-full flex-col gap-4 overflow-visible rounded-[28px] px-5 py-5 transition-all duration-200 hover:-translate-y-1 hover:shadow-[inset_0_0_0_1px_color-mix(in_srgb,#fff_8%,transparent),0_16px_34px_color-mix(in_srgb,#000_12%,transparent)]">
      <div className="flex items-center gap-3">
        <div className={cn("app-premium-pill flex size-10 shrink-0 items-center justify-center rounded-[16px] transition-transform duration-200 group-hover:scale-[1.03]", accent ? ACCENT_MAP[accent] : "text-primary")}>
          <Icon className="size-4.5" />
        </div>
        <div className="min-w-0">
          <div className="text-section-header">{eyebrow}</div>
          <div className="mt-0.5 text-base font-semibold tracking-[-0.03em] text-foreground">{title}</div>
        </div>
      </div>
      <p className="text-xs leading-5 text-muted-foreground">{description}</p>
      <Button
        type="button"
        variant="outline"
        className="mt-auto h-11 w-full justify-between rounded-2xl px-4 text-sm"
        onClick={onAction}
      >
        <span>{actionLabel}</span>
        <Sparkles className="size-4" />
      </Button>
    </div>
  );
}

export function SettingsHubDialog({
  open,
  onOpenChange,
  request,
}: SettingsHubDialogProps): React.JSX.Element {
  const [openAICompatibleOpen, setOpenAICompatibleOpen] = useState(false);
  const [skillsOpen, setSkillsOpen] = useState(false);
  const [mcpOpen, setMcpOpen] = useState(false);
  const [proxyOpen, setProxyOpen] = useState(false);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [includeApiKeys, setIncludeApiKeys] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importMode, setImportMode] = useState<"merge" | "replace">("merge");
  const [importResult, setImportResult] = useState<GlobalConfigImportResult | null>(null);
  const [importResultOpen, setImportResultOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const { loadModels, loadProviders } = useAppStore();

  const handleExport = async () => {
    setExporting(true);
    try {
      const result = await window.api.settings.exportGlobalConfigToFile({ includeApiKeys });
      if (result.success) {
        setExportDialogOpen(false);
      }
    } finally {
      setExporting(false);
    }
  };

  const handleImport = async () => {
    setImporting(true);
    try {
      const result = await window.api.settings.importGlobalConfigFromFile(importMode);
      setImportDialogOpen(false);
      if (result.success) {
        setImportResult(result);
        setImportResultOpen(true);
        void loadModels();
        void loadProviders();
      }
    } finally {
      setImporting(false);
    }
  };

  useEffect(() => {
    if (!open || request?.panel !== "models") {
      return;
    }

    setOpenAICompatibleOpen(true);
  }, [open, request]);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex max-h-[min(92vh,52rem)] w-[min(96vw,72rem)] max-w-5xl flex-col p-0">
          <DialogHeader className="app-premium-surface relative overflow-hidden rounded-[28px] px-6 py-4 pr-14 sm:px-7">
            <div className="flex items-center gap-3">
              <div className="app-premium-pill inline-flex shrink-0 items-center gap-2 rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">
                <Orbit className="size-3.5" />
                Control Center
              </div>
              <DialogTitle className="text-xl tracking-[-0.03em]">
                设置中枢
              </DialogTitle>
            </div>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 sm:px-7 sm:pb-7">
            <div className="grid items-stretch gap-4 bg-[linear-gradient(180deg,transparent,color-mix(in_srgb,var(--background-elevated)_18%,transparent))] md:grid-cols-2 xl:grid-cols-4 py-2">
              <SettingsCard
                icon={Boxes}
                eyebrow="Models"
                title="自定义模型配置"
                description="管理 OpenAI 兼容接口、私有网关和本地部署模型，保存后模型列表会自动刷新。"
                actionLabel="打开模型配置"
                onAction={() => setOpenAICompatibleOpen(true)}
                accent="blue"
              />
              <SettingsCard
                icon={Network}
                eyebrow="Proxy"
                title="代理配置"
                description="配置 HTTP、HTTPS 或 SOCKS 代理。保存后会立即更新主进程网络请求，不再依赖手改 .env。"
                actionLabel="打开代理配置"
                onAction={() => setProxyOpen(true)}
                accent="amber"
              />
              <SettingsCard
                icon={Wrench}
                eyebrow="Skills"
                title="技能配置"
                description="维护全局技能目录，统一处理导入、新建和编辑。固定目录为 ~/.open-jarvis/skills。"
                actionLabel="打开技能配置"
                onAction={() => setSkillsOpen(true)}
                accent="green"
              />
              <SettingsCard
                icon={Cable}
                eyebrow="MCP"
                title="MCP 配置"
                description="管理 MCP Server 列表，并配置所有会话默认启用的工具能力。"
                actionLabel="打开 MCP 配置"
                onAction={() => setMcpOpen(true)}
                accent="purple"
              />
            </div>

            {/* Global Config Export / Import */}
            <div className="mt-4 border-t border-[var(--border-muted)] pt-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs text-[var(--text-tertiary)]">
                  <Orbit className="h-3.5 w-3.5" />
                  <span>全局配置</span>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1.5 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                    onClick={() => {
                      setIncludeApiKeys(false);
                      setExportDialogOpen(true);
                    }}
                  >
                    <Download className="h-3.5 w-3.5" />
                    导出全部
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1.5 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                    onClick={() => {
                      setImportMode("merge");
                      setImportDialogOpen(true);
                    }}
                  >
                    <Upload className="h-3.5 w-3.5" />
                    导入全部
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Export Confirmation Dialog */}
      <Dialog open={exportDialogOpen} onOpenChange={setExportDialogOpen}>
        <DialogContent className="w-[min(96vw,28rem)]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Download className="h-4.5 w-4.5 text-primary" />
              导出全局配置
            </DialogTitle>
            <DialogDescription>
              将所有配置（模型、代理、MCP、技能）导出为 JSON 文件，方便备份或迁移到其他设备。
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center justify-between rounded-xl border border-[var(--border-muted)] px-4 py-3">
            <div className="flex items-center gap-2.5">
              <ShieldCheck className="h-4 w-4 text-[var(--status-nominal)]" />
              <div>
                <div className="text-sm font-medium">包含 API 密钥</div>
                <div className="text-xs text-[var(--text-tertiary)]">导出文件将包含所有已保存的密钥</div>
              </div>
            </div>
            <Switch
              checked={includeApiKeys}
              onCheckedChange={setIncludeApiKeys}
            />
          </div>
          {!includeApiKeys && (
            <div className="flex items-start gap-2 rounded-lg bg-[var(--background-elevated)] px-3 py-2 text-xs text-[var(--text-tertiary)]">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--status-warning)]" />
              <span>API 密钥不会包含在导出文件中，导入后需重新配置密钥。</span>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setExportDialogOpen(false)} disabled={exporting}>
              取消
            </Button>
            <Button onClick={handleExport} disabled={exporting}>
              {exporting ? "导出中…" : "导出"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Import Confirmation Dialog */}
      <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
        <DialogContent className="w-[min(96vw,28rem)]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Upload className="h-4.5 w-4.5 text-primary" />
              导入全局配置
            </DialogTitle>
            <DialogDescription>
              从 JSON 文件导入配置。选择合并模式保留现有配置，或替换模式覆盖全部。
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <button
              type="button"
              className={cn(
                "flex items-start gap-3 rounded-xl border px-4 py-3 text-left transition-all",
                importMode === "merge"
                  ? "border-primary bg-[color-mix(in_srgb,var(--primary)_8%,transparent)]"
                  : "border-[var(--border-muted)] hover:border-[var(--border-subtle)]"
              )}
              onClick={() => setImportMode("merge")}
            >
              <div className={cn(
                "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
                importMode === "merge" ? "border-primary bg-primary" : "border-[var(--border-muted)]"
              )}>
                {importMode === "merge" && <div className="h-1.5 w-1.5 rounded-full bg-primary-foreground" />}
              </div>
              <div>
                <div className="text-sm font-medium">合并</div>
                <div className="text-xs text-[var(--text-tertiary)]">保留现有配置，仅添加或更新导入的项</div>
              </div>
            </button>
            <button
              type="button"
              className={cn(
                "flex items-start gap-3 rounded-xl border px-4 py-3 text-left transition-all",
                importMode === "replace"
                  ? "border-[var(--status-warning)] bg-[color-mix(in_srgb,var(--status-warning)_8%,transparent)]"
                  : "border-[var(--border-muted)] hover:border-[var(--border-subtle)]"
              )}
              onClick={() => setImportMode("replace")}
            >
              <div className={cn(
                "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
                importMode === "replace" ? "border-[var(--status-warning)] bg-[var(--status-warning)]" : "border-[var(--border-muted)]"
              )}>
                {importMode === "replace" && <div className="h-1.5 w-1.5 rounded-full bg-white" />}
              </div>
              <div>
                <div className="text-sm font-medium">替换</div>
                <div className="text-xs text-[var(--text-tertiary)]">清除所有现有配置，用导入数据完全覆盖</div>
              </div>
            </button>
          </div>
          {importMode === "replace" && (
            <div className="flex items-start gap-2 rounded-lg bg-[color-mix(in_srgb,var(--status-warning)_10%,transparent)] px-3 py-2 text-xs text-[var(--status-warning)]">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>替换模式将删除所有现有配置，此操作不可撤销。</span>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportDialogOpen(false)} disabled={importing}>
              取消
            </Button>
            <Button onClick={handleImport} disabled={importing} variant={importMode === "replace" ? "destructive" : "default"}>
              {importing ? "导入中…" : "导入"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Import Result Dialog */}
      <Dialog open={importResultOpen} onOpenChange={setImportResultOpen}>
        <DialogContent className="w-[min(96vw,24rem)]">
          <DialogHeader>
            <DialogTitle>导入完成</DialogTitle>
            <DialogDescription>
              配置已成功导入，模型列表已刷新。
            </DialogDescription>
          </DialogHeader>
          {importResult && (
            <div className="flex flex-col gap-1.5 rounded-xl border border-[var(--border-muted)] px-4 py-3 text-sm">
              <div className="flex justify-between">
                <span className="text-[var(--text-secondary)]">模型配置</span>
                <span className="font-medium">{importResult.profilesImported} 项</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--text-secondary)]">MCP 服务器</span>
                <span className="font-medium">{importResult.serversImported} 项</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--text-secondary)]">技能</span>
                <span className="font-medium">{importResult.skillsImported} 项</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--text-secondary)]">代理配置</span>
                <span className="font-medium">{importResult.proxyUpdated ? "已更新" : "未变更"}</span>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setImportResultOpen(false)}>确定</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <OpenAICompatibleDialog
        open={openAICompatibleOpen}
        onOpenChange={setOpenAICompatibleOpen}
        initialProfileId={request?.panel === "models" ? request.profileId : null}
        onSaved={() => {
          void loadProviders();
          void loadModels();
        }}
      />

      <SkillsDialog
        open={skillsOpen}
        onOpenChange={setSkillsOpen}
      />

      <ProxyConfigDialog open={proxyOpen} onOpenChange={setProxyOpen} />

      <MCPConfigDialog
        open={mcpOpen}
        onOpenChange={setMcpOpen}
      />
    </>
  );
}
