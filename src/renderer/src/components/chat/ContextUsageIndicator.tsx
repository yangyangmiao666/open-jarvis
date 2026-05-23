import {ArrowDown, ArrowUp, CircleGauge, Database, Zap} from "lucide-react";
import {useTranslation} from "react-i18next";
import {Popover, PopoverContent, PopoverTrigger,} from "@/components/ui/popover";
import {cn} from "@/lib/utils";
import type {PromptTokenEstimate} from "@/lib/thread-context";
import type {TokenUsage} from "@/lib/token-usage";
import type {CustomModelApiFormat, Message, ProviderId} from "@/types";
import {getContextWindowForModel} from "../../../../model-context";

function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(1)}M`;
  }
  if (tokens >= 1_000) {
    return `${Math.round(tokens / 1_000)}K`;
  }
  return tokens.toString();
}

function formatTokenCountFull(tokens: number): string {
  return tokens.toLocaleString();
}

interface ContextUsageIndicatorProps {
  tokenUsage: TokenUsage | null;
  promptTokenEstimate?: PromptTokenEstimate | null;
  messages?: Message[];
  provider?: ProviderId;
  apiFormat?: CustomModelApiFormat;
  modelId: string;
  contextWindow?: number;
  className?: string;
}

function extractMessageText(message: Message): string {
  const content = message.content;
  if (typeof content === "string") {
    return content;
  }

  const contentText = content
    .map((block) => block.text ?? block.content ?? "")
    .filter((value) => value.length > 0)
    .join("\n");
  const toolCallText = message.tool_calls?.length
    ? JSON.stringify(message.tool_calls)
    : "";

  return [contentText, toolCallText].filter((value) => value.length > 0).join("\n");
}

function estimateMessageTokens(message: Message): number {
  const text = extractMessageText(message);
  if (text.trim().length === 0) {
    return 0;
  }

  // Conservative UI fallback: about 4 chars per token plus a small per-message overhead.
  return Math.max(1, Math.ceil(text.length / 4) + 6);
}

export function ContextUsageIndicator({
  tokenUsage,
  promptTokenEstimate,
  messages = [],
  provider,
  apiFormat,
  modelId,
  contextWindow,
  className,
}: ContextUsageIndicatorProps): React.JSX.Element {
  const { t } = useTranslation('chat');
  const visibleMessageTokens = messages.reduce(
    (sum, message) => sum + estimateMessageTokens(message),
    0,
  );
  const hiddenPromptTokens = promptTokenEstimate?.hiddenPromptTokens ?? 0;
  const summarizationMessageTokens =
    promptTokenEstimate?.summarizationMessageTokens ?? 0;
  const estimatedInputTokens =
    visibleMessageTokens + hiddenPromptTokens + summarizationMessageTokens;
  const hasEstimatedUsage = provider === "openai_compatible" &&
      apiFormat === "anthropic" &&
      estimatedInputTokens > 0 &&
      (!tokenUsage || estimatedInputTokens < tokenUsage.inputTokens);
  const hasUsage = Boolean(tokenUsage) || estimatedInputTokens > 0;

  const effectiveUsage = hasEstimatedUsage
    ? {
        inputTokens: estimatedInputTokens,
        outputTokens: tokenUsage?.outputTokens ?? 0,
        totalTokens: estimatedInputTokens + (tokenUsage?.outputTokens ?? 0),
        cacheReadTokens: tokenUsage?.cacheReadTokens,
        cacheCreationTokens: tokenUsage?.cacheCreationTokens,
      }
    : tokenUsage
      ? {
          inputTokens: tokenUsage.inputTokens,
          outputTokens: tokenUsage.outputTokens,
          totalTokens: tokenUsage.totalTokens,
          cacheReadTokens: tokenUsage.cacheReadTokens,
          cacheCreationTokens: tokenUsage.cacheCreationTokens,
        }
      : estimatedInputTokens > 0
        ? {
            inputTokens: estimatedInputTokens,
            outputTokens: 0,
            totalTokens: estimatedInputTokens,
            cacheReadTokens: undefined,
            cacheCreationTokens: undefined,
          }
        : null;
  const effectiveLastUpdated = hasEstimatedUsage
    ? promptTokenEstimate?.lastUpdated ?? tokenUsage?.lastUpdated ?? null
    : tokenUsage?.lastUpdated ?? promptTokenEstimate?.lastUpdated ?? null;

  const contextLimit = getContextWindowForModel(modelId, contextWindow);
  const usedTokens = effectiveUsage?.inputTokens ?? 0;
  const usagePercent = Math.min((usedTokens / contextLimit) * 100, 100);

  // Determine color based on usage
  let colorClass = "text-status-info";
  let bgColorClass = "bg-status-info/12";
  let barColorClass = "bg-status-info";
  let statusText = t('contextUsage.normal');

  if (usagePercent >= 90) {
    colorClass = "text-status-critical";
    bgColorClass = "bg-status-critical/12";
    barColorClass = "bg-status-critical";
    statusText = t('contextUsage.critical');
  } else if (usagePercent >= 75) {
    colorClass = "text-status-warning";
    bgColorClass = "bg-status-warning/12";
    barColorClass = "bg-status-warning";
    statusText = t('contextUsage.warning');
  } else if (usagePercent >= 50) {
    colorClass = "text-status-warning";
    bgColorClass = "bg-status-warning/10";
    barColorClass = "bg-status-warning";
    statusText = t('contextUsage.moderate');
  }

  const hasCacheData =
    (effectiveUsage?.cacheReadTokens ?? 0) > 0 ||
    (effectiveUsage?.cacheCreationTokens ?? 0) > 0;

  if (!hasUsage) {
    colorClass = "text-muted-foreground";
    bgColorClass = "bg-muted/70";
    barColorClass = "bg-muted-foreground/40";
    statusText = t('contextUsage.waiting');
  } else if (hasEstimatedUsage) {
    colorClass = "text-status-info";
    bgColorClass = "bg-status-info/10";
    barColorClass = "bg-status-info";
    statusText = t('contextUsage.estimated');
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className={cn(
            "flex items-center gap-1.5 rounded-full border border-border/70 px-2.5 py-1 text-xs transition-colors hover:translate-y-0 hover:bg-background-interactive/75",
            bgColorClass,
            colorClass,
            className,
          )}
        >
          <CircleGauge className="size-3.5" />
          <span className="font-mono">
            {hasUsage
              ? `${hasEstimatedUsage ? "~" : ""}${formatTokenCount(usedTokens)} / ${formatTokenCount(contextLimit)}`
              : t('contextUsage.contextWindow')}
          </span>
          {hasUsage ? (
            <span className="text-[10px] opacity-70">
              ({usagePercent.toFixed(0)}%)
            </span>
          ) : null}
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-72 border-border bg-background p-0"
        align="end"
        sideOffset={8}
      >
        <div className="p-3 space-y-3">
          {/* Header */}
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-foreground">
              {t('contextUsage.contextWindow')}
            </span>
            <span
              className={cn(
                "text-[10px] font-medium px-1.5 py-0.5 rounded",
                bgColorClass,
                colorClass,
              )}
            >
              {statusText}
            </span>
          </div>

          {/* Progress bar */}
          <div className="space-y-1">
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <div
                className={cn(
                  "h-full rounded-full transition-all",
                  barColorClass,
                )}
                style={{ width: `${hasUsage ? usagePercent : 0}%` }}
              />
            </div>
            <div className="flex justify-between text-[10px] text-muted-foreground">
	              <span>
	                {hasUsage
	                  ? `${hasEstimatedUsage ? t('contextUsage.estimated') + " " : ""}${formatTokenCountFull(usedTokens)} tokens`
	                  : t('contextUsage.waitFirstResponse')}
	              </span>
              <span>{formatTokenCountFull(contextLimit)} max</span>
            </div>
          </div>

          {/* Token breakdown */}
          <div className="space-y-1.5 pt-2 border-t border-border">
            <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
              {t('contextUsage.tokenDetails')}
            </div>

            {hasEstimatedUsage && (
              <div className="rounded-xl border border-status-info/20 bg-status-info/8 px-2.5 py-2 text-[11px] leading-5 text-muted-foreground">
                {t('contextUsage.estimateNote')}
              </div>
            )}

            <div className="space-y-1">
              {hasEstimatedUsage && (
                <>
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <ArrowUp className="size-3" />
                      <span>{t('contextUsage.visibleEstimate')}</span>
                    </div>
                    <span className="font-mono">
                      {formatTokenCountFull(visibleMessageTokens)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <ArrowUp className="size-3" />
                      <span>{t('contextUsage.hiddenPromptEstimate')}</span>
                    </div>
                    <span className="font-mono">
                      {formatTokenCountFull(hiddenPromptTokens)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <ArrowUp className="size-3" />
                      <span>{t('contextUsage.compressionEstimate')}</span>
                    </div>
                    <span className="font-mono">
                      {formatTokenCountFull(summarizationMessageTokens)}
                    </span>
                  </div>
                </>
              )}

              {/* Input tokens */}
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <ArrowUp className="size-3" />
                  <span>{t('contextUsage.input')}</span>
                </div>
                <span className="font-mono">
                  {formatTokenCountFull(effectiveUsage?.inputTokens ?? 0)}
                </span>
              </div>

              {hasEstimatedUsage &&
              (hiddenPromptTokens > 0 || summarizationMessageTokens > 0) ? (
                <div className="space-y-1 rounded-xl border border-border/60 bg-muted/20 px-2.5 py-2 text-[11px]">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">{t('contextUsage.systemPrompt')}</span>
                    <span className="font-mono">
                      {formatTokenCountFull(
                        promptTokenEstimate?.systemPromptTokens ?? 0,
                      )}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">{t('contextUsage.filesystemPrompt')}</span>
                    <span className="font-mono">
                      {formatTokenCountFull(
                        promptTokenEstimate?.filesystemPromptTokens ?? 0,
                      )}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">{t('contextUsage.referencedPathsSupplement')}</span>
                    <span className="font-mono">
                      {formatTokenCountFull(
                        promptTokenEstimate?.referencedPathsTokens ?? 0,
                      )}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">{t('contextUsage.compressionSummary')}</span>
                    <span className="font-mono">
                      {formatTokenCountFull(summarizationMessageTokens)}
                    </span>
                  </div>
                </div>
              ) : null}

              {/* Output tokens */}
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <ArrowDown className="size-3" />
                  <span>{t('contextUsage.output')}</span>
                </div>
                <span className="font-mono">
                  {formatTokenCountFull(effectiveUsage?.outputTokens ?? 0)}
                </span>
              </div>

              {/* Total */}
              <div className="flex items-center justify-between text-xs pt-1 border-t border-border/50">
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <Zap className="size-3" />
                  <span>{t('contextUsage.total')}</span>
                </div>
                <span className="font-mono">
                  {formatTokenCountFull(effectiveUsage?.totalTokens ?? 0)}
                </span>
              </div>
            </div>
          </div>

          {/* Cache info (always show, with "none" state) */}
          <div className="space-y-1.5 pt-2 border-t border-border">
            <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
              {t('contextUsage.cache')}
            </div>

            <div className="space-y-1">
              {hasCacheData ? (
                <>
                  {effectiveUsage?.cacheReadTokens !== undefined &&
                    effectiveUsage.cacheReadTokens > 0 && (
                      <div className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-1.5 text-status-nominal">
                          <Database className="size-3" />
                          <span>{t('contextUsage.cacheHit')}</span>
                        </div>
                        <span className="font-mono text-status-nominal">
                          {formatTokenCountFull(effectiveUsage.cacheReadTokens)}
                        </span>
                      </div>
                    )}

                  {effectiveUsage?.cacheCreationTokens !== undefined &&
                    effectiveUsage.cacheCreationTokens > 0 && (
                      <div className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-1.5 text-status-info">
                          <Database className="size-3" />
                          <span>{t('contextUsage.cacheCreation')}</span>
                        </div>
                        <span className="font-mono text-status-info">
                          {formatTokenCountFull(effectiveUsage.cacheCreationTokens)}
                        </span>
                      </div>
                    )}
                </>
              ) : (
                <div className="text-xs text-muted-foreground">{t('contextUsage.noCacheTokens')}</div>
              )}
            </div>
          </div>

          {/* Last updated */}
          <div className="pt-2 border-t border-border">
            <div className="text-[10px] text-muted-foreground">
              {t('contextUsage.lastUpdated')}
              {hasUsage
                ? effectiveLastUpdated?.toLocaleTimeString("zh-CN", {
                    hour12: false,
                  }) ?? t('contextUsage.waitFirstResponseShort')
                : t('contextUsage.waitFirstResponseShort')}
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
