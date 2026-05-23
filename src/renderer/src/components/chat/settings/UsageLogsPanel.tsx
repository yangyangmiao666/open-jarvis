import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { RefreshCw, Trash2, Cpu, ArrowUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SettingsSection, SettingsCard, SettingsRow } from "./primitives";
import { toast } from "@/lib/toast";
import { useAppStore } from "@/lib/store";
import {
  clearAllPersistedTokenUsage,
  loadPersistedTokenUsageStats,
  subscribeToTokenUsageUpdates,
} from "@/lib/token-usage";

interface ModelUsage {
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  sessionCount: number;
}

interface ActivityBucket {
  dayKey: string;
  totalTokens: number;
}

interface UsageSnapshot {
  models: ModelUsage[];
  activity: ActivityBucket[];
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function collectUsage(
  threads: { thread_id: string; metadata?: Record<string, unknown> }[],
): UsageSnapshot {
  const modelMap = new Map<string, ModelUsage>();
  const activityMap = new Map<string, number>();

  for (const thread of threads) {
    const stats = loadPersistedTokenUsageStats(thread.thread_id);
    if (!stats) {
      continue;
    }

    const modelId = (thread.metadata as Record<string, unknown> | undefined)?.model as string || "unknown";
    const input = stats.totals.inputTokens;
    const output = stats.totals.outputTokens;
    const total = stats.totals.totalTokens;
    const cacheRead = stats.totals.cacheReadTokens;
    const cacheCreation = stats.totals.cacheCreationTokens;

    const existing = modelMap.get(modelId);
    if (existing) {
      existing.inputTokens += input;
      existing.outputTokens += output;
      existing.totalTokens += total;
      existing.cacheReadTokens += cacheRead;
      existing.cacheCreationTokens += cacheCreation;
      existing.sessionCount += 1;
    } else {
      modelMap.set(modelId, {
        modelId,
        inputTokens: input,
        outputTokens: output,
        totalTokens: total,
        cacheReadTokens: cacheRead,
        cacheCreationTokens: cacheCreation,
        sessionCount: 1,
      });
    }

    for (const entry of stats.entries) {
      const dayKey = entry.recordedAt.slice(0, 10);
      activityMap.set(dayKey, (activityMap.get(dayKey) ?? 0) + entry.totalTokens);
    }
  }

  return {
    models: Array.from(modelMap.values()).sort((a, b) => b.totalTokens - a.totalTokens),
    activity: Array.from(activityMap.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .slice(-7)
      .map(([dayKey, totalTokens]) => ({ dayKey, totalTokens })),
  };
}

type SortKey = "modelId" | "totalTokens" | "inputTokens" | "outputTokens" | "sessionCount";

interface SortHeaderButtonProps {
  label: string;
  field: SortKey;
  sortKey: SortKey;
  onSort: (key: SortKey) => void;
}

function SortHeaderButton({
  label,
  field,
  sortKey,
  onSort,
}: SortHeaderButtonProps): React.JSX.Element {
  return (
    <button
      type="button"
      className={`inline-flex items-center gap-1 text-xs font-medium transition-colors ${
        sortKey === field ? "text-foreground" : "text-muted-foreground hover:text-foreground"
      }`}
      onClick={() => onSort(field)}
    >
      {label}
      <ArrowUpDown className="h-3 w-3" />
    </button>
  );
}

export function UsageLogsPanel(): React.JSX.Element {
  const { t, i18n } = useTranslation("settings");
  const { threads } = useAppStore();
  const [usageSnapshot, setUsageSnapshot] = useState<UsageSnapshot>({ models: [], activity: [] });
  const [sortKey, setSortKey] = useState<SortKey>("totalTokens");
  const [sortDesc, setSortDesc] = useState(true);

  const refresh = useCallback(() => {
    setUsageSnapshot(collectUsage(threads));
  }, [threads]);

  useEffect(() => {
    refresh();
    return subscribeToTokenUsageUpdates(refresh);
  }, [refresh]);

  const usageData = usageSnapshot.models;

  const sorted = useMemo(() => {
    const copy = [...usageData];
    copy.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (typeof av === "string" && typeof bv === "string") {
        return sortDesc ? bv.localeCompare(av) : av.localeCompare(bv);
      }
      return sortDesc ? (bv as number) - (av as number) : (av as number) - (bv as number);
    });
    return copy;
  }, [usageData, sortKey, sortDesc]);

  const totals = useMemo(() => ({
    inputTokens: usageData.reduce((s, u) => s + u.inputTokens, 0),
    outputTokens: usageData.reduce((s, u) => s + u.outputTokens, 0),
    totalTokens: usageData.reduce((s, u) => s + u.totalTokens, 0),
    cacheReadTokens: usageData.reduce((s, u) => s + u.cacheReadTokens, 0),
    cacheCreationTokens: usageData.reduce((s, u) => s + u.cacheCreationTokens, 0),
    sessions: usageData.reduce((s, u) => s + u.sessionCount, 0),
  }), [usageData]);

  const handleSort = useCallback((key: SortKey) => {
    if (sortKey === key) {
      setSortDesc((prev) => !prev);
    } else {
      setSortKey(key);
      setSortDesc(true);
    }
  }, [sortKey]);

  const handleClear = () => {
    clearAllPersistedTokenUsage();
    setUsageSnapshot({ models: [], activity: [] });
    toast.success(t("usage.cleared"));
  };

  const maxModelTokens = useMemo(
    () => Math.max(...usageData.map((row) => row.totalTokens), 1),
    [usageData],
  );

  const maxActivityTokens = useMemo(
    () => Math.max(...usageSnapshot.activity.map((row) => row.totalTokens), 1),
    [usageSnapshot.activity],
  );

  const activityFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.language, {
        month: "numeric",
        day: "numeric",
      }),
    [i18n.language],
  );

  return (
    <div className="space-y-8">
      {/* Summary */}
      <SettingsSection title={t("usage.title")} description={t("usage.description")}>
        <SettingsCard>
          <SettingsRow label={t("usage.totalInputTokens")}>
            <span className="text-sm text-muted-foreground font-mono">{formatTokens(totals.inputTokens)}</span>
          </SettingsRow>
          <SettingsRow label={t("usage.totalOutputTokens")}>
            <span className="text-sm text-muted-foreground font-mono">{formatTokens(totals.outputTokens)}</span>
          </SettingsRow>
          <SettingsRow label={t("usage.totalAllTokens")}>
            <span className="text-sm font-mono font-medium">{formatTokens(totals.totalTokens)}</span>
          </SettingsRow>
          {totals.cacheReadTokens > 0 && (
            <SettingsRow label={t("usage.cacheReadTokens")}>
              <span className="text-sm text-muted-foreground font-mono">{formatTokens(totals.cacheReadTokens)}</span>
            </SettingsRow>
          )}
          {totals.cacheCreationTokens > 0 && (
            <SettingsRow label={t("usage.cacheCreationTokens")}>
              <span className="text-sm text-muted-foreground font-mono">{formatTokens(totals.cacheCreationTokens)}</span>
            </SettingsRow>
          )}
          <SettingsRow label={t("usage.trackedSessions")}>
            <span className="text-sm text-muted-foreground">{totals.sessions}</span>
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection
        title={t("usage.chartTitle")}
        description={t("usage.chartDescription")}
      >
        {usageData.length === 0 ? (
          <div className="rounded-xl border border-border/50 px-4 py-8 text-center text-sm text-muted-foreground">
            {t("usage.noLogs")}
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-[1.25fr_0.75fr]">
            <SettingsCard>
              <div className="space-y-3 px-4 py-4">
                {usageData.slice(0, 6).map((row) => {
                  const inputWidth = `${(row.inputTokens / maxModelTokens) * 100}%`;
                  const outputWidth = `${(row.outputTokens / maxModelTokens) * 100}%`;
                  return (
                    <div key={row.modelId} className="space-y-1.5">
                      <div className="flex items-center justify-between gap-3 text-xs">
                        <span className="truncate font-medium text-foreground">{row.modelId}</span>
                        <span className="shrink-0 font-mono text-muted-foreground">{formatTokens(row.totalTokens)}</span>
                      </div>
                      <div className="h-2.5 overflow-hidden rounded-full bg-muted/70">
                        <div className="flex h-full w-full gap-px overflow-hidden rounded-full">
                          <div className="bg-primary/75" style={{ width: inputWidth }} />
                          <div className="bg-primary" style={{ width: outputWidth }} />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </SettingsCard>
            <SettingsCard>
              <div className="space-y-3 px-4 py-4">
                <div className="text-sm font-medium">{t("usage.recentActivity")}</div>
                {usageSnapshot.activity.length === 0 ? (
                  <div className="text-xs text-muted-foreground">{t("usage.noLogs")}</div>
                ) : (
                  <div className="flex h-36 items-end gap-2">
                    {usageSnapshot.activity.map((bucket) => {
                      const height = `${Math.max((bucket.totalTokens / maxActivityTokens) * 100, 12)}%`;
                      return (
                        <div key={bucket.dayKey} className="flex min-w-0 flex-1 flex-col items-center gap-2">
                          <div className="text-[10px] font-mono text-muted-foreground">
                            {formatTokens(bucket.totalTokens)}
                          </div>
                          <div className="flex h-24 w-full items-end rounded-md bg-muted/40 px-1 pb-1">
                            <div className="w-full rounded-sm bg-primary/85" style={{ height }} />
                          </div>
                          <div className="text-[10px] text-muted-foreground">
                            {activityFormatter.format(new Date(`${bucket.dayKey}T00:00:00`))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </SettingsCard>
          </div>
        )}
      </SettingsSection>

      {/* Per-model breakdown */}
      <SettingsSection
        title={t("usage.perModel")}
        action={
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={refresh}>
              <RefreshCw className="h-3.5 w-3.5 mr-1" />
              {t("usage.refresh")}
            </Button>
            <Button variant="outline" size="sm" className="text-destructive" onClick={handleClear} disabled={usageData.length === 0}>
              <Trash2 className="h-3.5 w-3.5 mr-1" />
              {t("usage.clearLogs")}
            </Button>
          </div>
        }
      >
        {usageData.length === 0 ? (
          <div className="rounded-xl border border-border/50 px-4 py-8 text-center text-sm text-muted-foreground">
            {t("usage.noLogs")}
          </div>
        ) : (
          <div className="rounded-xl border border-border/50 overflow-hidden">
            {/* Table header */}
            <div className="flex items-center gap-3 px-4 py-2.5 border-b bg-muted/30">
              <div className="flex-1 min-w-0">
                <SortHeaderButton label={t("usage.model")} field="modelId" sortKey={sortKey} onSort={handleSort} />
              </div>
              <div className="w-18 text-right">
                <SortHeaderButton label={t("usage.input")} field="inputTokens" sortKey={sortKey} onSort={handleSort} />
              </div>
              <div className="w-18 text-right">
                <SortHeaderButton label={t("usage.output")} field="outputTokens" sortKey={sortKey} onSort={handleSort} />
              </div>
              <div className="w-18 text-right">
                <SortHeaderButton label={t("usage.total")} field="totalTokens" sortKey={sortKey} onSort={handleSort} />
              </div>
              <div className="w-12 text-right">
                <SortHeaderButton label={t("usage.sessions")} field="sessionCount" sortKey={sortKey} onSort={handleSort} />
              </div>
            </div>

            {/* Table body */}
            <ScrollArea className="max-h-80">
              <div className="divide-y">
                {sorted.map((row) => (
                  <div key={row.modelId} className="flex items-center gap-3 px-4 py-2.5">
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <Cpu className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="text-sm font-medium truncate">{row.modelId}</span>
                    </div>
                    <div className="w-18 text-right text-xs text-muted-foreground font-mono">
                      {formatTokens(row.inputTokens)}
                    </div>
                    <div className="w-18 text-right text-xs text-muted-foreground font-mono">
                      {formatTokens(row.outputTokens)}
                    </div>
                    <div className="w-18 text-right text-xs font-mono font-medium">
                      {formatTokens(row.totalTokens)}
                    </div>
                    <div className="w-12 text-right text-xs text-muted-foreground">
                      {row.sessionCount}
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>
        )}
      </SettingsSection>
    </div>
  );
}