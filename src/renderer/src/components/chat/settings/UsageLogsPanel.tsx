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
  loadPersistedPromptTokenEstimate,
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
  bucketKey: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

interface UsageSnapshot {
  models: ModelUsage[];
  activityEntries: Array<{
    recordedAt: string;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  }>;
  hasEstimatedData: boolean;
}

type TimeGranularity = "day" | "month" | "year";

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function collectUsage(
  threads: { thread_id: string; metadata?: Record<string, unknown> }[],
): UsageSnapshot {
  const modelMap = new Map<string, ModelUsage>();
  const activityEntries: UsageSnapshot["activityEntries"] = [];
  let hasEstimatedData = false;

  for (const thread of threads) {
    const stats = loadPersistedTokenUsageStats(thread.thread_id);
    const modelId = (thread.metadata as Record<string, unknown> | undefined)?.model as string || "unknown";
    const estimate = loadPersistedPromptTokenEstimate(thread.thread_id);
    const estimatedInput = estimate
      ? estimate.estimatedInputTokens ?? (estimate.hiddenPromptTokens + estimate.summarizationMessageTokens)
      : 0;

    const input =
      stats && stats.totals.inputTokens > 0
        ? stats.totals.inputTokens
        : estimatedInput;
    const output = stats?.totals.outputTokens ?? 0;
    const total = Math.max(stats?.totals.totalTokens ?? 0, estimatedInput + output);
    const cacheRead = stats?.totals.cacheReadTokens ?? 0;
    const cacheCreation = stats?.totals.cacheCreationTokens ?? 0;

    if (input <= 0 && output <= 0 && total <= 0) {
      continue;
    }

    if ((!stats || stats.totals.inputTokens <= 0) && estimatedInput > 0) {
      hasEstimatedData = true;
    }

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

    if (stats) {
      for (const entry of stats.entries) {
        activityEntries.push({
          recordedAt: entry.recordedAt,
          inputTokens: entry.inputTokens,
          outputTokens: entry.outputTokens,
          totalTokens: entry.totalTokens,
        });
      }
    } else if (estimate?.lastUpdated) {
      activityEntries.push({
        recordedAt: estimate.lastUpdated,
        inputTokens: input,
        outputTokens: output,
        totalTokens: total,
      });
    }
  }

  return {
    models: Array.from(modelMap.values()).sort((a, b) => b.totalTokens - a.totalTokens),
    activityEntries: activityEntries.sort((left, right) =>
      left.recordedAt.localeCompare(right.recordedAt),
    ),
    hasEstimatedData,
  };
}

function buildActivityBuckets(
  entries: UsageSnapshot["activityEntries"],
  granularity: TimeGranularity,
): ActivityBucket[] {
  const bucketMap = new Map<string, ActivityBucket>();

  for (const entry of entries) {
    const date = new Date(entry.recordedAt);
    if (Number.isNaN(date.getTime())) {
      continue;
    }

    const bucketKey =
      granularity === "year"
        ? `${date.getFullYear()}`
        : granularity === "month"
          ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`
          : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

    const existing = bucketMap.get(bucketKey);
    if (existing) {
      existing.inputTokens += entry.inputTokens;
      existing.outputTokens += entry.outputTokens;
      existing.totalTokens += entry.totalTokens;
    } else {
      bucketMap.set(bucketKey, {
        bucketKey,
        inputTokens: entry.inputTokens,
        outputTokens: entry.outputTokens,
        totalTokens: entry.totalTokens,
      });
    }
  }

  return Array.from(bucketMap.values())
    .sort((left, right) => left.bucketKey.localeCompare(right.bucketKey))
    .slice(-7);
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
  const { threads, models, loadModels } = useAppStore();
  const [usageSnapshot, setUsageSnapshot] = useState<UsageSnapshot>({ models: [], activityEntries: [], hasEstimatedData: false });
  const [sortKey, setSortKey] = useState<SortKey>("totalTokens");
  const [sortDesc, setSortDesc] = useState(true);
  const [timeGranularity, setTimeGranularity] = useState<TimeGranularity>("day");

  useEffect(() => {
    if (models.length === 0) {
      void loadModels();
    }
  }, [loadModels, models.length]);

  const refresh = useCallback(() => {
    setUsageSnapshot(collectUsage(threads));
  }, [threads]);

  useEffect(() => {
    refresh();
    return subscribeToTokenUsageUpdates(refresh);
  }, [refresh]);

  const usageData = usageSnapshot.models;

  const modelNameMap = useMemo(
    () => new Map(models.map((model) => [model.id, model.name])),
    [models],
  );

  const getModelLabel = useCallback(
    (modelId: string) => modelNameMap.get(modelId) ?? modelId,
    [modelNameMap],
  );

  const sorted = useMemo(() => {
    const copy = [...usageData];
    copy.sort((a, b) => {
      if (sortKey === "modelId") {
        const av = getModelLabel(a.modelId);
        const bv = getModelLabel(b.modelId);
        return sortDesc ? bv.localeCompare(av) : av.localeCompare(bv);
      }
      const av = a[sortKey];
      const bv = b[sortKey];
      return sortDesc ? (bv as number) - (av as number) : (av as number) - (bv as number);
    });
    return copy;
  }, [getModelLabel, sortDesc, sortKey, usageData]);

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
    setUsageSnapshot({ models: [], activityEntries: [], hasEstimatedData: false });
    toast.success(t("usage.cleared"));
  };

  const maxModelTokens = useMemo(
    () => Math.max(...usageData.map((row) => row.totalTokens), 1),
    [usageData],
  );

  const activityBuckets = useMemo(
    () => buildActivityBuckets(usageSnapshot.activityEntries, timeGranularity),
    [timeGranularity, usageSnapshot.activityEntries],
  );

  const maxActivityTokens = useMemo(
    () => Math.max(...activityBuckets.map((row) => row.totalTokens), 1),
    [activityBuckets],
  );

  const activityFormatter = useMemo(
    () => (bucketKey: string) => {
      if (timeGranularity === "year") {
        return bucketKey;
      }

      if (timeGranularity === "month") {
        const [year, month] = bucketKey.split("-");
        return new Intl.DateTimeFormat(i18n.language, {
          year: "numeric",
          month: "short",
        }).format(new Date(Number(year), Number(month) - 1, 1));
      }

      return new Intl.DateTimeFormat(i18n.language, {
        month: "numeric",
        day: "numeric",
      }).format(new Date(`${bucketKey}T00:00:00`));
    },
    [i18n.language, timeGranularity],
  );

  return (
    <div className="space-y-8">
      {/* Summary */}
      <SettingsSection title={t("usage.title")} description={t("usage.description")}>
        <SettingsCard>
          {usageSnapshot.hasEstimatedData ? (
            <div className="border-b border-border/50 px-4 py-3 text-xs text-muted-foreground">
              {t("usage.estimatedNotice")}
            </div>
          ) : null}
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
                        <span className="truncate font-medium text-foreground">{getModelLabel(row.modelId)}</span>
                        <div className="shrink-0 text-right font-mono text-muted-foreground">
                          <div>{formatTokens(row.totalTokens)}</div>
                          <div className="text-[10px]">
                            {t("usage.input")}: {formatTokens(row.inputTokens)} / {t("usage.output")}: {formatTokens(row.outputTokens)}
                          </div>
                        </div>
                      </div>
                      <div className="h-2.5 overflow-hidden rounded-full bg-muted/70">
                        <div className="flex h-full w-full gap-px overflow-hidden rounded-full">
                          <div className="bg-primary/75" style={{ width: inputWidth }} />
                          <div className="bg-chart-2" style={{ width: outputWidth }} />
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div className="flex items-center gap-4 pt-1 text-[10px] text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <span className="size-2 rounded-full bg-primary/75" />
                    {t("usage.input")}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span className="size-2 rounded-full bg-chart-2" />
                    {t("usage.output")}
                  </span>
                </div>
              </div>
            </SettingsCard>
            <SettingsCard>
              <div className="space-y-3 px-4 py-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-medium">{t("usage.recentActivity")}</div>
                  <div className="inline-flex rounded-lg border border-border/70 bg-muted/30 p-1 text-xs">
                    {(["day", "month", "year"] as TimeGranularity[]).map((option) => (
                      <button
                        key={option}
                        type="button"
                        className={`rounded-md px-2 py-1 transition-colors ${
                          timeGranularity === option
                            ? "bg-background text-foreground shadow-sm"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                        onClick={() => setTimeGranularity(option)}
                      >
                        {t(`usage.${option}`)}
                      </button>
                    ))}
                  </div>
                </div>
                {activityBuckets.length === 0 ? (
                  <div className="text-xs text-muted-foreground">{t("usage.noLogs")}</div>
                ) : (
                  <div className="flex h-36 items-end gap-2">
                    {activityBuckets.map((bucket) => {
                      const inputHeight = `${Math.max((bucket.inputTokens / maxActivityTokens) * 100, bucket.inputTokens > 0 ? 8 : 0)}%`;
                      const outputHeight = `${Math.max((bucket.outputTokens / maxActivityTokens) * 100, bucket.outputTokens > 0 ? 8 : 0)}%`;
                      const height = `${Math.max((bucket.totalTokens / maxActivityTokens) * 100, 12)}%`;
                      return (
                        <div key={bucket.bucketKey} className="flex min-w-0 flex-1 flex-col items-center gap-2">
                          <div className="text-[10px] font-mono text-muted-foreground">
                            {formatTokens(bucket.totalTokens)}
                          </div>
                          <div className="flex h-24 w-full items-end rounded-md bg-muted/40 px-1 pb-1">
                            <div className="flex h-full w-full items-end gap-px">
                              <div className="w-1/2 rounded-sm bg-primary/75" style={{ height: inputHeight || height }} />
                              <div className="w-1/2 rounded-sm bg-chart-2" style={{ height: outputHeight }} />
                            </div>
                          </div>
                          <div className="text-[10px] text-muted-foreground">
                            {activityFormatter(bucket.bucketKey)}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
                <div className="flex items-center gap-4 pt-1 text-[10px] text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <span className="size-2 rounded-full bg-primary/75" />
                    {t("usage.input")}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span className="size-2 rounded-full bg-chart-2" />
                    {t("usage.output")}
                  </span>
                </div>
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
                      <span className="text-sm font-medium truncate">{getModelLabel(row.modelId)}</span>
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