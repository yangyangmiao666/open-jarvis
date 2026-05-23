import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Download, Upload, AlertTriangle, ShieldCheck, Volume2, Sun, Moon } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
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
import { Switch } from "@/components/ui/switch";
import {
  SettingsSection,
  SettingsCard,
  SettingsRow,
  SettingsToggle,
} from "./primitives";
import { useAppStore } from "@/lib/store";
import {
  NOTIFICATION_SOUNDS,
  DEFAULT_NOTIFICATION_SOUNDS,
  ensureDesktopNotificationPermission,
  playNotificationSound,
} from "@/lib/notifications";
import type { NotificationSoundId, NotificationSoundType, NotificationSoundSettings } from "@/lib/notifications";
import type { GlobalConfigImportResult } from "@/types";

// ===== SoundPicker =====

interface SoundPickerProps {
  label: string;
  description?: string;
  type: NotificationSoundType;
  sounds: NotificationSoundSettings;
  disabled: boolean;
  onSoundChange: (type: NotificationSoundType, soundId: NotificationSoundId) => void;
}

function SoundPicker({ label, description, type, sounds, disabled, onSoundChange }: SoundPickerProps): React.JSX.Element {
  const { t } = useTranslation("settings");
  const currentId = sounds[type] ?? DEFAULT_NOTIFICATION_SOUNDS[type];

  const soundOptions = [
    { value: "none", label: t("general.soundNone") },
    ...NOTIFICATION_SOUNDS.map((s) => ({ value: s.id, label: s.label })),
  ];

  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="text-sm font-medium leading-tight">{label}</div>
        {description && <div className="text-xs text-muted-foreground leading-relaxed">{description}</div>}
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <Select
          value={currentId}
          disabled={disabled}
          onValueChange={(v) => onSoundChange(type, v as NotificationSoundId)}
        >
          <SelectTrigger className="h-9 w-[260px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {soundOptions.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0"
          disabled={disabled || currentId === "none"}
          onClick={() => playNotificationSound(currentId)}
          title={t("general.previewSound")}
        >
          <Volume2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

export function GeneralPanel(): React.JSX.Element {
  const { t } = useTranslation("settings");
  const {
    loadModels,
    loadProviders,
    colorMode,
    setColorMode,
    language,
    setLanguage,
    notificationsEnabled,
    setNotificationsEnabled,
    notificationSoundEnabled,
    setNotificationSoundEnabled,
    notificationSounds,
    setNotificationSound,
  } = useAppStore();

  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [includeApiKeys, setIncludeApiKeys] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importMode, setImportMode] = useState<"merge" | "replace">("merge");
  const [importResult, setImportResult] = useState<GlobalConfigImportResult | null>(null);
  const [importResultOpen, setImportResultOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);

  const handleDesktopNotificationToggle = async (enabled: boolean): Promise<void> => {
    if (enabled) {
      await ensureDesktopNotificationPermission();
    }
    setNotificationsEnabled(enabled);
  };

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

  const soundDisabled = !notificationSoundEnabled;

  return (
    <>
      <div className="space-y-8">
        {/* General Settings */}
        <SettingsSection title={t("general.generalSettings")} description={t("general.generalSettingsDesc")}>
          <SettingsCard>
            <SettingsRow
              label={t("general.theme")}
              description={t("general.themeDesc")}
              icon={colorMode === "dark" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
            >
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  className={`rounded-full px-3 py-1 text-xs font-medium transition-all ${
                    colorMode === "light"
                      ? "bg-primary text-primary-foreground"
                      : "border border-border text-muted-foreground hover:bg-muted"
                  }`}
                  onClick={() => setColorMode("light")}
                >
                  {t("general.light")}
                </button>
                <button
                  type="button"
                  className={`rounded-full px-3 py-1 text-xs font-medium transition-all ${
                    colorMode === "dark"
                      ? "bg-primary text-primary-foreground"
                      : "border border-border text-muted-foreground hover:bg-muted"
                  }`}
                  onClick={() => setColorMode("dark")}
                >
                  {t("general.dark")}
                </button>
              </div>
            </SettingsRow>

            <SettingsRow
              label={t("general.language")}
              description={t("general.languageDesc")}
            >
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  className={`rounded-full px-3 py-1 text-xs font-medium transition-all ${
                    language === "zh-CN"
                      ? "bg-primary text-primary-foreground"
                      : "border border-border text-muted-foreground hover:bg-muted"
                  }`}
                  onClick={() => setLanguage("zh-CN")}
                >
                  中文
                </button>
                <button
                  type="button"
                  className={`rounded-full px-3 py-1 text-xs font-medium transition-all ${
                    language === "en-US"
                      ? "bg-primary text-primary-foreground"
                      : "border border-border text-muted-foreground hover:bg-muted"
                  }`}
                  onClick={() => setLanguage("en-US")}
                >
                  English
                </button>
              </div>
            </SettingsRow>

            <SettingsToggle
              label={t("general.desktopNotification")}
              description={t("general.desktopNotificationDesc")}
              checked={notificationsEnabled}
              onCheckedChange={(checked) => {
                void handleDesktopNotificationToggle(checked);
              }}
            />

            <SettingsToggle
              label={t("general.notificationSound")}
              description={t("general.notificationSoundDesc")}
              checked={notificationSoundEnabled}
              onCheckedChange={setNotificationSoundEnabled}
            />

            <SoundPicker
              label={t("general.taskCompleteSound")}
              description={t("general.taskCompleteSoundDesc")}
              type="taskComplete"
              sounds={notificationSounds}
              disabled={soundDisabled}
              onSoundChange={setNotificationSound}
            />

            <SoundPicker
              label={t("general.permissionRequestSound")}
              description={t("general.permissionRequestSoundDesc")}
              type="permissionRequest"
              sounds={notificationSounds}
              disabled={soundDisabled}
              onSoundChange={setNotificationSound}
            />
          </SettingsCard>
        </SettingsSection>

        {/* Config Import/Export */}
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
            <div className="flex flex-col gap-2 rounded-lg border px-4 py-3 text-sm">
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