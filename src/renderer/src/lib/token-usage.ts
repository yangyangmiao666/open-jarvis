export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  lastUpdated: Date;
}

export interface TokenUsageEntry {
  usageKey: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  recordedAt: string;
}

export interface PromptTokenEstimateSnapshot {
  hiddenPromptTokens: number;
  systemPromptTokens: number;
  filesystemPromptTokens: number;
  referencedPathsTokens: number;
  summarizationMessageTokens: number;
  estimatedInputTokens?: number;
  lastUpdated: string;
}

export interface TokenUsageTotals {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

interface SerializedTokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  lastUpdated: string;
}

export interface PersistedTokenUsageStats {
  latest: SerializedTokenUsage;
  totals: TokenUsageTotals;
  entries: TokenUsageEntry[];
  lastRecordedUsageKey?: string | null;
}

export const TOKEN_USAGE_UPDATED_EVENT = "openwork:token-usage-updated";

const TOKEN_USAGE_ENTRIES_LIMIT = 200;

export function tokenUsageStorageKey(threadId: string): string {
  return `openwork-thread-${threadId}-token-usage`;
}

export function tokenUsageStatsStorageKey(threadId: string): string {
  return `openwork-thread-${threadId}-token-usage-stats`;
}

export function promptTokenEstimateStorageKey(threadId: string): string {
  return `openwork-thread-${threadId}-prompt-token-estimate`;
}

function serializeUsage(usage: TokenUsage): SerializedTokenUsage {
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    cacheReadTokens: usage.cacheReadTokens,
    cacheCreationTokens: usage.cacheCreationTokens,
    lastUpdated: usage.lastUpdated.toISOString(),
  };
}

function mergeUsageValues(
  current: SerializedTokenUsage | TokenUsage | null | undefined,
  incoming: SerializedTokenUsage | TokenUsage,
): SerializedTokenUsage {
  const currentInput = current?.inputTokens ?? 0;
  const currentOutput = current?.outputTokens ?? 0;
  const nextInput = incoming.inputTokens > 0 ? incoming.inputTokens : currentInput;
  const nextOutput = incoming.outputTokens > 0 ? incoming.outputTokens : currentOutput;
  const nextTotal = Math.max(
    incoming.totalTokens ?? 0,
    current?.totalTokens ?? 0,
    nextInput + nextOutput,
  );

  return {
    inputTokens: nextInput,
    outputTokens: nextOutput,
    totalTokens: nextTotal,
    cacheReadTokens: incoming.cacheReadTokens ?? current?.cacheReadTokens,
    cacheCreationTokens:
      incoming.cacheCreationTokens ?? current?.cacheCreationTokens,
    lastUpdated:
      incoming.lastUpdated instanceof Date
        ? incoming.lastUpdated.toISOString()
        : incoming.lastUpdated,
  };
}

function deserializeUsage(
  usage: SerializedTokenUsage | null | undefined,
): TokenUsage | null {
  if (!usage || typeof usage.inputTokens !== "number") {
    return null;
  }

  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens ?? 0,
    totalTokens: usage.totalTokens ?? usage.inputTokens + (usage.outputTokens ?? 0),
    cacheReadTokens: usage.cacheReadTokens,
    cacheCreationTokens: usage.cacheCreationTokens,
    lastUpdated: usage.lastUpdated ? new Date(usage.lastUpdated) : new Date(),
  };
}

function dispatchTokenUsageUpdated(): void {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(new CustomEvent(TOKEN_USAGE_UPDATED_EVENT));
}

export function subscribeToTokenUsageUpdates(callback: () => void): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }

  window.addEventListener(TOKEN_USAGE_UPDATED_EVENT, callback);
  return () => {
    window.removeEventListener(TOKEN_USAGE_UPDATED_EVENT, callback);
  };
}

function buildUsageTotals(usage: TokenUsage): TokenUsageTotals {
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    cacheReadTokens: usage.cacheReadTokens ?? 0,
    cacheCreationTokens: usage.cacheCreationTokens ?? 0,
  };
}

function readStorage<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore localStorage failures (quota/private mode)
  }
}

export function loadPersistedTokenUsage(threadId: string): TokenUsage | null {
  const stats = loadPersistedTokenUsageStats(threadId);
  if (stats) {
    return deserializeUsage(stats.latest);
  }

  const legacy = readStorage<SerializedTokenUsage>(tokenUsageStorageKey(threadId));
  return deserializeUsage(legacy);
}

export function persistTokenUsage(threadId: string, usage: TokenUsage): void {
  writeStorage(tokenUsageStorageKey(threadId), serializeUsage(usage));
}

export function loadPersistedTokenUsageStats(
  threadId: string,
): PersistedTokenUsageStats | null {
  const persisted = readStorage<PersistedTokenUsageStats>(
    tokenUsageStatsStorageKey(threadId),
  );
  if (persisted?.latest && persisted?.totals && Array.isArray(persisted.entries)) {
    return persisted;
  }

  const legacy = deserializeUsage(
    readStorage<SerializedTokenUsage>(tokenUsageStorageKey(threadId)),
  );
  if (!legacy) {
    return null;
  }

  return {
    latest: serializeUsage(legacy),
    totals: buildUsageTotals(legacy),
    entries: [
      {
        usageKey: `legacy:${threadId}`,
        inputTokens: legacy.inputTokens,
        outputTokens: legacy.outputTokens,
        totalTokens: legacy.totalTokens,
        cacheReadTokens: legacy.cacheReadTokens,
        cacheCreationTokens: legacy.cacheCreationTokens,
        recordedAt: legacy.lastUpdated.toISOString(),
      },
    ],
    lastRecordedUsageKey: `legacy:${threadId}`,
  };
}

export function appendPersistedTokenUsageStats(
  threadId: string,
  usage: TokenUsage,
  usageKey?: string,
): PersistedTokenUsageStats {
  const normalizedKey =
    usageKey?.trim() ||
    `${usage.lastUpdated.toISOString()}:${usage.inputTokens}:${usage.outputTokens}:${usage.totalTokens}`;
  const existing = loadPersistedTokenUsageStats(threadId);
  const serializedUsage = serializeUsage(usage);

  const existingEntryIndex =
    existing?.entries.findIndex((entry) => entry.usageKey === normalizedKey) ?? -1;

  if (existing && existingEntryIndex >= 0) {
    const currentEntry = existing.entries[existingEntryIndex];
    const mergedUsage = mergeUsageValues(
      {
        inputTokens: currentEntry.inputTokens,
        outputTokens: currentEntry.outputTokens,
        totalTokens: currentEntry.totalTokens,
        cacheReadTokens: currentEntry.cacheReadTokens,
        cacheCreationTokens: currentEntry.cacheCreationTokens,
        lastUpdated: currentEntry.recordedAt,
      },
      serializedUsage,
    );
    const nextEntries = [...existing.entries];
    nextEntries[existingEntryIndex] = {
      ...currentEntry,
      inputTokens: mergedUsage.inputTokens,
      outputTokens: mergedUsage.outputTokens,
      totalTokens: mergedUsage.totalTokens,
      cacheReadTokens: mergedUsage.cacheReadTokens,
      cacheCreationTokens: mergedUsage.cacheCreationTokens,
      recordedAt: mergedUsage.lastUpdated,
    };

    const next = {
      ...existing,
      latest: mergeUsageValues(existing.latest, serializedUsage),
      totals: {
        inputTokens:
          existing.totals.inputTokens - currentEntry.inputTokens + mergedUsage.inputTokens,
        outputTokens:
          existing.totals.outputTokens - currentEntry.outputTokens + mergedUsage.outputTokens,
        totalTokens:
          existing.totals.totalTokens - currentEntry.totalTokens + mergedUsage.totalTokens,
        cacheReadTokens:
          existing.totals.cacheReadTokens - (currentEntry.cacheReadTokens ?? 0) + (mergedUsage.cacheReadTokens ?? 0),
        cacheCreationTokens:
          existing.totals.cacheCreationTokens - (currentEntry.cacheCreationTokens ?? 0) + (mergedUsage.cacheCreationTokens ?? 0),
      },
      entries: nextEntries,
      lastRecordedUsageKey: normalizedKey,
    };
    persistTokenUsage(threadId, deserializeUsage(next.latest) ?? usage);
    writeStorage(tokenUsageStatsStorageKey(threadId), next);
    dispatchTokenUsageUpdated();
    return next;
  }

  if (existing && existing.lastRecordedUsageKey === normalizedKey) {
    const next = {
      ...existing,
      latest: mergeUsageValues(existing.latest, serializedUsage),
      lastRecordedUsageKey: normalizedKey,
    };
    persistTokenUsage(threadId, deserializeUsage(next.latest) ?? usage);
    writeStorage(tokenUsageStatsStorageKey(threadId), next);
    dispatchTokenUsageUpdated();
    return next;
  }

  const previousTotals = existing?.totals ?? {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
  };

  const next: PersistedTokenUsageStats = {
    latest: serializedUsage,
    totals: {
      inputTokens: previousTotals.inputTokens + usage.inputTokens,
      outputTokens: previousTotals.outputTokens + usage.outputTokens,
      totalTokens: previousTotals.totalTokens + usage.totalTokens,
      cacheReadTokens:
        previousTotals.cacheReadTokens + (usage.cacheReadTokens ?? 0),
      cacheCreationTokens:
        previousTotals.cacheCreationTokens + (usage.cacheCreationTokens ?? 0),
    },
    entries: [
      ...(existing?.entries ?? []),
      {
        usageKey: normalizedKey,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        totalTokens: usage.totalTokens,
        cacheReadTokens: usage.cacheReadTokens,
        cacheCreationTokens: usage.cacheCreationTokens,
        recordedAt: usage.lastUpdated.toISOString(),
      },
    ].slice(-TOKEN_USAGE_ENTRIES_LIMIT),
    lastRecordedUsageKey: normalizedKey,
  };

  persistTokenUsage(threadId, usage);
  writeStorage(tokenUsageStatsStorageKey(threadId), next);
  dispatchTokenUsageUpdated();
  return next;
}

export function clearAllPersistedTokenUsage(): void {
  try {
    const keys: string[] = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (
        key?.startsWith("openwork-thread-") &&
        (key.endsWith("-token-usage") ||
          key.endsWith("-token-usage-stats") ||
          key.endsWith("-prompt-token-estimate"))
      ) {
        keys.push(key);
      }
    }
    for (const key of keys) {
      localStorage.removeItem(key);
    }
  } catch {
    // Ignore localStorage failures
  }
  dispatchTokenUsageUpdated();
}

export function loadPersistedPromptTokenEstimate(
  threadId: string,
): PromptTokenEstimateSnapshot | null {
  const estimate = readStorage<PromptTokenEstimateSnapshot>(
    promptTokenEstimateStorageKey(threadId),
  );
  if (!estimate || typeof estimate.hiddenPromptTokens !== "number") {
    return null;
  }
  return estimate;
}

export function persistPromptTokenEstimate(
  threadId: string,
  estimate: PromptTokenEstimateSnapshot,
): void {
  writeStorage(promptTokenEstimateStorageKey(threadId), estimate);
  dispatchTokenUsageUpdated();
}