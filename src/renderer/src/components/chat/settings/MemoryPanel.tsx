import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Database, FolderTree, RefreshCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAppStore } from "@/lib/store";
import { formatDateTimeWithYear } from "@/lib/utils";
import type { MemoryDocumentSummary, MemorySettings } from "@/types";
import {
  SettingsSection,
  SettingsCard,
  SettingsInput,
  SettingsRow,
} from "./primitives";

function promotionStatusLabel(
  status: MemoryDocumentSummary["promotionStatus"],
): string {
  switch (status) {
    case "candidate":
      return "待晋升";
    case "promoted":
      return "已晋升";
    case "rejected":
      return "已忽略";
    case "none":
    default:
      return "普通记忆";
  }
}

function promotionStatusClassName(
  status: MemoryDocumentSummary["promotionStatus"],
): string {
  switch (status) {
    case "candidate":
      return "border-[var(--status-warning)]/40 bg-[var(--status-warning)]/10 text-[var(--status-warning)]";
    case "promoted":
      return "border-[var(--status-nominal)]/40 bg-[var(--status-nominal)]/10 text-[var(--status-nominal)]";
    case "rejected":
      return "border-border bg-muted text-muted-foreground";
    case "none":
    default:
      return "border-border bg-background text-muted-foreground";
  }
}

export function MemoryPanel(): React.JSX.Element {
  const { t } = useTranslation("settings");
  const currentThreadId = useAppStore((state) => state.currentThreadId);
  const [memorySettings, setMemorySettings] = useState<MemorySettings | null>(null);
  const [thresholdDraft, setThresholdDraft] = useState("3");
  const [workspacePath, setWorkspacePath] = useState<string | null>(null);
  const [memoryDir, setMemoryDir] = useState<string | null>(null);
  const [memories, setMemories] = useState<MemoryDocumentSummary[]>([]);
  const [loading, setLoading] = useState(false);

  const loadData = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const [settings, memoryResult] = await Promise.all([
        window.api.settings.getMemorySettings(),
        window.api.settings.listWorkspaceMemories(currentThreadId ?? undefined),
      ]);
      setMemorySettings(settings);
      setThresholdDraft(String(settings.skillPromotionRecallThreshold));
      setWorkspacePath(memoryResult.workspacePath);
      setMemoryDir(memoryResult.memoryDir);
      setMemories(memoryResult.memories);
    } finally {
      setLoading(false);
    }
  }, [currentThreadId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleThresholdBlur = async (): Promise<void> => {
    const parsed = Number.parseInt(thresholdDraft, 10);
    const nextThreshold = Number.isFinite(parsed)
      ? Math.min(50, Math.max(1, parsed))
      : 3;
    const next = await window.api.settings.setMemorySettings({
      skillPromotionRecallThreshold: nextThreshold,
    });
    setMemorySettings(next);
    setThresholdDraft(String(next.skillPromotionRecallThreshold));
  };

  return (
    <div className="space-y-8">
      <SettingsSection
        title={t("memory.title")}
        description={t("memory.description")}
      >
        <SettingsCard>
          <SettingsInput
            label={t("memory.recallThreshold")}
            description={t("memory.recallThresholdDesc")}
            type="number"
            min={1}
            max={50}
            step={1}
            value={thresholdDraft}
            onChange={(event) => setThresholdDraft(event.target.value)}
            onBlur={() => {
              void handleThresholdBlur();
            }}
            disabled={!memorySettings}
          />
          <SettingsRow
            label={t("memory.workspacePath")}
            description={workspacePath ?? t("memory.noWorkspace")}
            icon={<FolderTree className="h-4 w-4" />}
          />
          <SettingsRow
            label={t("memory.memoryDir")}
            description={memoryDir ?? t("memory.noWorkspace")}
            icon={<Database className="h-4 w-4" />}
          >
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void loadData();
              }}
              disabled={loading}
            >
              <RefreshCcw className="mr-2 h-3.5 w-3.5" />
              {t("memory.refresh")}
            </Button>
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection
        title={t("memory.memoryList")}
        description={t("memory.memoryListDesc", { count: memories.length })}
      >
        <SettingsCard>
          {memories.length === 0 ? (
            <div className="px-4 py-4 text-sm text-muted-foreground">
              {workspacePath ? t("memory.empty") : t("memory.noWorkspace")}
            </div>
          ) : (
            memories.map((memory) => (
              <div key={memory.routePath} className="border-b border-border px-4 py-3 last:border-b-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="text-sm font-medium text-foreground">
                      {memory.title}
                    </div>
                    <div className="text-xs text-muted-foreground break-all">
                      {memory.routePath}
                    </div>
                    <div className="text-xs leading-relaxed text-muted-foreground">
                      {memory.summary || t("memory.noSummary")}
                    </div>
                  </div>
                  <div
                    className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${promotionStatusClassName(memory.promotionStatus)}`}
                  >
                    {promotionStatusLabel(memory.promotionStatus)}
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
                  <span>{t("memory.recallCount", { count: memory.recallCount })}</span>
                  <span>{t("memory.lastUpdated", { value: formatDateTimeWithYear(memory.lastUpdatedAt) })}</span>
                </div>
              </div>
            ))
          )}
        </SettingsCard>
      </SettingsSection>
    </div>
  );
}