import { CircleGauge, Zap, ArrowDown, ArrowUp, Database } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { TokenUsage } from "@/lib/thread-context";

// Context window limits by model (in tokens)
// These are approximate and may vary
const MODEL_CONTEXT_LIMITS: Record<string, number> = {
  // Anthropic models
  "claude-opus-4-5-20251101": 200_000,
  "claude-sonnet-4-5-20250929": 200_000,
  "claude-3-5-sonnet-20241022": 200_000,
  "claude-3-5-haiku-20241022": 200_000,
  "claude-3-opus-20240229": 200_000,
  "claude-3-sonnet-20240229": 200_000,
  "claude-3-haiku-20240307": 200_000,
  // OpenAI models
  "gpt-4o": 128_000,
  "gpt-4o-mini": 128_000,
  "gpt-4-turbo": 128_000,
  "gpt-4": 8_192,
  o1: 200_000,
  "o1-mini": 128_000,
  o3: 200_000,
  "o3-mini": 200_000,
  // Google models
  "gemini-3-pro-preview": 2_000_000,
  "gemini-3-flash-preview": 1_000_000,
  "gemini-2.5-pro": 2_000_000,
  "gemini-2.5-flash": 1_000_000,
  "gemini-2.5-flash-lite": 1_000_000,
  "gemini-2.0-flash": 1_000_000,
  "gemini-1.5-pro": 2_000_000,
  "gemini-1.5-flash": 1_000_000,
};

// Default limit if model not found
const DEFAULT_CONTEXT_LIMIT = 128_000;

function getContextLimit(modelId: string): number {
  // Try exact match first
  if (MODEL_CONTEXT_LIMITS[modelId]) {
    return MODEL_CONTEXT_LIMITS[modelId];
  }

  // Try prefix match for model families
  for (const [key, limit] of Object.entries(MODEL_CONTEXT_LIMITS)) {
    if (modelId.startsWith(key)) {
      return limit;
    }
  }

  // Infer from model name patterns
  if (modelId.includes("claude")) return 200_000;
  if (
    modelId.includes("gpt-4o") ||
    modelId.includes("o1") ||
    modelId.includes("o3")
  )
    return 128_000;
  if (modelId.includes("gemini")) return 1_000_000;

  return DEFAULT_CONTEXT_LIMIT;
}

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
  modelId: string;
  className?: string;
}

export function ContextUsageIndicator({
  tokenUsage,
  modelId,
  className,
}: ContextUsageIndicatorProps): React.JSX.Element {
  const hasUsage = Boolean(tokenUsage);

  const contextLimit = getContextLimit(modelId);
  const usedTokens = tokenUsage?.inputTokens ?? 0;
  const usagePercent = Math.min((usedTokens / contextLimit) * 100, 100);

  // Determine color based on usage
  let colorClass = "text-blue-500";
  let bgColorClass = "bg-blue-500/20";
  let barColorClass = "bg-blue-500";
  let statusText = "正常";

  if (usagePercent >= 90) {
    colorClass = "text-red-500";
    bgColorClass = "bg-red-500/20";
    barColorClass = "bg-red-500";
    statusText = "危急";
  } else if (usagePercent >= 75) {
    colorClass = "text-orange-500";
    bgColorClass = "bg-orange-500/20";
    barColorClass = "bg-orange-500";
    statusText = "警告";
  } else if (usagePercent >= 50) {
    colorClass = "text-yellow-500";
    bgColorClass = "bg-yellow-500/20";
    barColorClass = "bg-yellow-500";
    statusText = "中等";
  }

  const hasCacheData =
    (tokenUsage?.cacheReadTokens ?? 0) > 0 ||
    (tokenUsage?.cacheCreationTokens ?? 0) > 0;

  if (!hasUsage) {
    colorClass = "text-muted-foreground";
    bgColorClass = "bg-muted/70";
    barColorClass = "bg-muted-foreground/40";
    statusText = "等待中";
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className={cn(
            "flex items-center gap-1.5 px-2 py-0.5 rounded-sm text-xs transition-colors hover:opacity-80",
            bgColorClass,
            colorClass,
            className,
          )}
        >
          <CircleGauge className="size-3.5" />
          <span className="font-mono">
            {hasUsage
              ? `${formatTokenCount(usedTokens)} / ${formatTokenCount(contextLimit)}`
              : "上下文窗口"}
          </span>
          {hasUsage ? (
            <span className="text-[10px] opacity-70">
              ({usagePercent.toFixed(0)}%)
            </span>
          ) : null}
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-72 p-0 bg-background border-border"
        align="end"
        sideOffset={8}
      >
        <div className="p-3 space-y-3">
          {/* Header */}
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-foreground">
              上下文窗口
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
                  ? `${formatTokenCountFull(usedTokens)} tokens`
                  : "等待首条响应后显示"}
              </span>
              <span>{formatTokenCountFull(contextLimit)} max</span>
            </div>
          </div>

          {/* Token breakdown */}
          <div className="space-y-1.5 pt-2 border-t border-border">
            <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
              Token 使用详情
            </div>

            <div className="space-y-1">
              {/* Input tokens */}
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <ArrowUp className="size-3" />
                  <span>输入</span>
                </div>
                <span className="font-mono">
                  {formatTokenCountFull(tokenUsage?.inputTokens ?? 0)}
                </span>
              </div>

              {/* Output tokens */}
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <ArrowDown className="size-3" />
                  <span>输出</span>
                </div>
                <span className="font-mono">
                  {formatTokenCountFull(tokenUsage?.outputTokens ?? 0)}
                </span>
              </div>

              {/* Total */}
              <div className="flex items-center justify-between text-xs pt-1 border-t border-border/50">
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <Zap className="size-3" />
                  <span>总计</span>
                </div>
                <span className="font-mono">
                  {formatTokenCountFull(tokenUsage?.totalTokens ?? 0)}
                </span>
              </div>
            </div>
          </div>

          {/* Cache info (always show, with "none" state) */}
          <div className="space-y-1.5 pt-2 border-t border-border">
            <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
              缓存
            </div>

            <div className="space-y-1">
              {hasCacheData ? (
                <>
                  {tokenUsage?.cacheReadTokens !== undefined &&
                    tokenUsage.cacheReadTokens > 0 && (
                      <div className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-1.5 text-green-500">
                          <Database className="size-3" />
                          <span>缓存命中</span>
                        </div>
                        <span className="font-mono text-green-500">
                          {formatTokenCountFull(tokenUsage.cacheReadTokens)}
                        </span>
                      </div>
                    )}

                  {tokenUsage?.cacheCreationTokens !== undefined &&
                    tokenUsage.cacheCreationTokens > 0 && (
                      <div className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-1.5 text-blue-500">
                          <Database className="size-3" />
                          <span>缓存创建</span>
                        </div>
                        <span className="font-mono text-blue-500">
                          {formatTokenCountFull(tokenUsage.cacheCreationTokens)}
                        </span>
                      </div>
                    )}
                </>
              ) : (
                <div className="text-xs text-muted-foreground">无缓存令牌</div>
              )}
            </div>
          </div>

          {/* Last updated */}
          <div className="pt-2 border-t border-border">
            <div className="text-[10px] text-muted-foreground">
              最后更新：
              {hasUsage
                ? tokenUsage?.lastUpdated.toLocaleTimeString("zh-CN", {
                    hour12: false,
                  })
                : "等待首条响应"}
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
