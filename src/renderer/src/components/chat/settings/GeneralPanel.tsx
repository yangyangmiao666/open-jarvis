import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Download, Upload, AlertTriangle, ShieldCheck } from "lucide-react";
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
import { SettingsSection, SettingsCard, SettingsRow } from "./primitives";
import { LanguageSelector } from "@/components/chat/LanguageSelector";
import { useAppStore } from "@/lib/store";
import type { GlobalConfigImportResult } from "@/types";

export function GeneralPanel(): React.JSX.Element {
  const { t } = useTranslation("settings");
  const { loadModels, loadProviders } = useAppStore();

  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [includeApiKeys, setIncludeApiKeys] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importMode, setImportMode] = useState<"merge" | "replace">("merge");
  const [importResult, setImportResult] = useState<GlobalConfigImportResult | null>(null);
  const [importResultOpen, setImportResultOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);

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

  return (
    <>
      <div className="space-y-6">
        <SettingsSection title={t("settingsHub.globalConfig")} description={t("importDialog.description")}>
          <SettingsCard>
            <SettingsRow
              label={t("exportDialog.title")}
              icon={<Download className="h-4 w-4" />}
              description={t("exportDialog.description")}
            >
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setIncludeApiKeys(false);
                  setExportDialogOpen(true);
                }}
              >
                {t("settingsHub.exportAll")}
              </Button>
            </SettingsRow>
            <SettingsRow
              label={t("importDialog.title")}
              icon={<Upload className="h-4 w-4" />}
              description={t("importDialog.description")}
            >
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setImportMode("merge");
                  setImportDialogOpen(true);
                }}
              >
                {t("settingsHub.importAll")}
              </Button>
            </SettingsRow>
          </SettingsCard>
        </SettingsSection>

        <SettingsSection title={t("settingsHub.languageLabel")}>
          <SettingsCard>
            <SettingsRow label={t("settingsHub.languageLabel")} description="">
              <LanguageSelector />
            </SettingsRow>
          </SettingsCard>
        </SettingsSection>
      </div>

      {/* Export Confirmation Dialog */}
      <Dialog open={exportDialogOpen} onOpenChange={setExportDialogOpen}>
        <DialogContent className="w-[min(96vw,28rem)]">
          <DialogHeader>
            <DialogTitle>{t("exportDialog.title")}</DialogTitle>
            <DialogDescription>{t("exportDialog.description")}</DialogDescription>
          </DialogHeader>
          <div className="flex items-center justify-between rounded-lg border px-4 py-3">
            <div className="flex items-center gap-2.5">
              <ShieldCheck className="h-4 w-4 text-[var(--status-nominal)]" />
              <div>
                <div className="text-sm font-medium">{t("exportDialog.includeApiKeys")}</div>
                <div className="text-xs text-muted-foreground">{t("exportDialog.includeApiKeysDesc")}</div>
              </div>
            </div>
            <Switch checked={includeApiKeys} onCheckedChange={setIncludeApiKeys} />
          </div>
          {!includeApiKeys && (
            <div className="flex items-start gap-2 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--status-warning)]" />
              <span>{t("exportDialog.noApiKeysWarning")}</span>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setExportDialogOpen(false)} disabled={exporting}>
              {t("common:cancel")}
            </Button>
            <Button onClick={handleExport} disabled={exporting}>
              {exporting ? t("exportDialog.exporting") : t("exportDialog.export")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Import Confirmation Dialog */}
      <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
        <DialogContent className="w-[min(96vw,28rem)]">
          <DialogHeader>
            <DialogTitle>{t("importDialog.title")}</DialogTitle>
            <DialogDescription>{t("importDialog.description")}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <button
              type="button"
              className={`flex items-start gap-3 rounded-lg border px-4 py-3 text-left transition-all ${
                importMode === "merge"
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-muted"
              }`}
              onClick={() => setImportMode("merge")}
            >
              <div className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
                importMode === "merge" ? "border-primary bg-primary text-primary-foreground" : "border-border"
              }`}>
                {importMode === "merge" && <div className="h-1.5 w-1.5 rounded-full bg-current" />}
              </div>
              <div>
                <div className="text-sm font-medium">{t("importDialog.merge")}</div>
                <div className="text-xs text-muted-foreground">{t("importDialog.mergeDesc")}</div>
              </div>
            </button>
            <button
              type="button"
              className={`flex items-start gap-3 rounded-lg border px-4 py-3 text-left transition-all ${
                importMode === "replace"
                  ? "border-[var(--status-warning)] bg-[var(--status-warning)]/5"
                  : "border-border hover:border-muted"
              }`}
              onClick={() => setImportMode("replace")}
            >
              <div className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
                importMode === "replace" ? "border-[var(--status-warning)] bg-[var(--status-warning)]" : "border-border"
              }`}>
                {importMode === "replace" && <div className="h-1.5 w-1.5 rounded-full bg-white" />}
              </div>
              <div>
                <div className="text-sm font-medium">{t("importDialog.replace")}</div>
                <div className="text-xs text-muted-foreground">{t("importDialog.replaceDesc")}</div>
              </div>
            </button>
          </div>
          {importMode === "replace" && (
            <div className="flex items-start gap-2 rounded-lg bg-[var(--status-warning)]/5 px-3 py-2 text-xs text-[var(--status-warning)]">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{t("importDialog.replaceWarning")}</span>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportDialogOpen(false)} disabled={importing}>
              {t("common:cancel")}
            </Button>
            <Button onClick={handleImport} disabled={importing} variant={importMode === "replace" ? "destructive" : "default"}>
              {importing ? t("importDialog.importing") : t("importDialog.import")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Import Result Dialog */}
      <Dialog open={importResultOpen} onOpenChange={setImportResultOpen}>
        <DialogContent className="w-[min(96vw,24rem)]">
          <DialogHeader>
            <DialogTitle>{t("importResult.title")}</DialogTitle>
            <DialogDescription>{t("importResult.description")}</DialogDescription>
          </DialogHeader>
          {importResult && (
            <div className="flex flex-col gap-1.5 rounded-lg border px-4 py-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("importResult.modelConfig")}</span>
                <span className="font-medium">{importResult.profilesImported} {t("importResult.items")}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("importResult.mcpServers")}</span>
                <span className="font-medium">{importResult.serversImported} {t("importResult.items")}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("importResult.skills")}</span>
                <span className="font-medium">{importResult.skillsImported} {t("importResult.items")}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("importResult.proxyConfig")}</span>
                <span className="font-medium">{importResult.proxyUpdated ? t("importResult.updated") : t("importResult.unchanged")}</span>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setImportResultOpen(false)}>{t("common:confirm")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}