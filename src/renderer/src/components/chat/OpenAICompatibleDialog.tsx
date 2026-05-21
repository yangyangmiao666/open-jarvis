import { useState, useEffect } from "react";
import { Plus, Trash2, Pencil, Copy, Boxes, Sparkles, Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "@/components/ui/toast";
import type { OpenAICompatibleProfile } from "@/types";

interface OpenAICompatibleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
  initialProfileId?: string | null;
}

const emptyForm = (): Omit<OpenAICompatibleProfile, "id"> & {
  id?: string;
} => ({
  name: "",
  baseUrl: "",
  apiKey: "",
  model: "",
  apiFormat: "openai",
  thinkingType: "disabled",
  thinkingEffort: "high",
  reasoningContent: "auto",
  contextWindow: undefined,
});

function normalizeThinkingEffort(
  effort?: string,
): NonNullable<OpenAICompatibleProfile["thinkingEffort"]> {
  switch (effort) {
    case "low":
    case "medium":
    case "high":
    case "xhigh":
    case "max":
      return effort;
    default:
      return "high";
  }
}

function formatThinkingEffort(
  effort?: OpenAICompatibleProfile["thinkingEffort"],
): string {
  switch (effort) {
    case "low":
      return "low";
    case "medium":
      return "medium";
    case "xhigh":
    case "max":
      return "xhigh/max";
    default:
      return "high";
  }
}

function normalizeReasoningContentMode(
  mode?: string,
): NonNullable<OpenAICompatibleProfile["reasoningContent"]> {
  switch (mode) {
    case "enabled":
    case "disabled":
      return mode;
    case "auto":
    default:
      return "auto";
  }
}

function formatReasoningContentMode(
  mode?: OpenAICompatibleProfile["reasoningContent"],
): string {
  switch (mode) {
    case "enabled":
      return "总是回传";
    case "disabled":
      return "关闭";
    case "auto":
    default:
      return "自动";
  }
}

function buildDuplicateProfile(
  profile: OpenAICompatibleProfile,
): Omit<OpenAICompatibleProfile, "id"> & { id?: string } {
  const baseName = profile.name?.trim() || profile.model.trim() || "自定义模型";
  return {
    ...profile,
    id: undefined,
    name: `${baseName} 副本`,
  };
}

export function OpenAICompatibleDialog({
  open,
  onOpenChange,
  onSaved,
  initialProfileId,
}: OpenAICompatibleDialogProps): React.JSX.Element {
  const [profiles, setProfiles] = useState<OpenAICompatibleProfile[]>([]);
  const [showApiKey, setShowApiKey] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<OpenAICompatibleProfile | null>(
    null,
  );
  const [editing, setEditing] = useState<
    (Omit<OpenAICompatibleProfile, "id"> & { id?: string }) | null
  >(null);

  const load = async (): Promise<OpenAICompatibleProfile[]> => {
    const list = await window.api.models.openaiCompatibleList();
    setProfiles(list);
    return list;
  };

  useEffect(() => {
    if (!open) {
      return;
    }

    let cancelled = false;

    void (async () => {
      const list = await load();
      if (cancelled) {
        return;
      }

      setShowApiKey(false);

      if (initialProfileId) {
        const target = list.find((profile) => profile.id === initialProfileId);
        setEditing(target ? { ...target } : emptyForm());
      } else {
        setEditing(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, initialProfileId]);

  useEffect(() => {
    setShowApiKey(false);
  }, [editing?.id]);

  const handleSave = async (): Promise<void> => {
    if (!editing) return;
    if (!editing.baseUrl.trim() || !editing.model.trim()) {
      toast.error("请填写接口地址和模型 ID");
      return;
    }
    try {
      const saved = await window.api.models.openaiCompatibleUpsert(editing);
      const list = await load();
      onSaved();
      const matched = list.find((p) => p.id === (saved?.id ?? editing.id));
      if (matched) {
        setEditing({ ...matched });
      }
      toast.success("模型配置已保存");
    } catch (e) {
      toast.error("保存失败");
    }
  };

  const handleDelete = async (): Promise<void> => {
    if (!deleteTarget) return;
    try {
      await window.api.models.openaiCompatibleDelete(deleteTarget.id);
      await load();
      onSaved();
      setDeleteTarget(null);
      toast.success("模型配置已删除");
    } catch (e) {
      toast.error("删除失败");
    }
  };

  const handleDuplicate = (profile: OpenAICompatibleProfile): void => {
    setShowApiKey(false);
    setEditing(buildDuplicateProfile(profile));
    toast.success("已复制为新配置草稿，保存后生效");
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex max-h-[min(92vh,54rem)] w-[min(96vw,72rem)] max-w-5xl flex-col overflow-hidden p-0">
        <DialogHeader className="shrink-0 rounded-t-[32px] border-b border-border/60 px-6 py-5 pr-16 sm:px-7 sm:pr-20">
          <div className="flex items-center gap-3">
            <div className="badge-blue inline-flex shrink-0 items-center gap-2 rounded-full border border-status-info/20 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em]">
              <Boxes className="size-3.5" />
              Models Workspace
            </div>
            <DialogTitle className="text-xl tracking-[-0.03em]">
              自定义模型配置
            </DialogTitle>
          </div>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5 sm:px-7">
        <div className="grid min-h-0 gap-4 lg:grid-cols-[minmax(18rem,0.92fr)_minmax(24rem,1.08fr)]">
          <section className="app-flat-surface flex min-h-0 min-w-0 flex-col gap-4 rounded-[26px] border border-border/70 px-5 py-5">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="text-section-header">Profiles</div>
                <div className="mt-1 text-base font-semibold tracking-[-0.02em] text-foreground">
                  已有配置
                </div>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  查看、编辑和删除当前已经接入的自定义模型配置，支持 OpenAI 格式和 Anthropic 格式接口。
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-10 shrink-0 rounded-2xl px-4 text-xs"
                onClick={() => setEditing(emptyForm())}
              >
                <Plus className="size-4" />
                添加配置
              </Button>
            </div>

            <ScrollArea className="app-subtle-scroll min-h-0 flex-1 rounded-[22px] border border-border/70 bg-background/35">
              <div className="space-y-2 p-3">
                {profiles.length === 0 && !editing && (
                  <div className="rounded-2xl border border-dashed border-border/70 px-3 py-8 text-center text-xs text-muted-foreground">
                    暂无配置
                  </div>
                )}
                {profiles.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center gap-2 rounded-2xl border border-border/55 bg-[linear-gradient(180deg,color-mix(in_srgb,var(--card)_86%,transparent),color-mix(in_srgb,var(--background-elevated)_76%,transparent))] px-3 py-2 text-xs transition-colors hover:border-primary/20 hover:bg-background-interactive/65"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{p.name || p.model}</div>
                      <div className="text-muted-foreground truncate font-mono">
                        {p.baseUrl}
                      </div>
                      <div className="text-muted-foreground truncate font-mono">
                        模型：{p.model}
                      </div>
                      <div className="text-muted-foreground truncate font-mono">
                        格式：{p.apiFormat === "anthropic" ? "Anthropic" : "OpenAI"}
                      </div>
                      <div className="text-muted-foreground truncate font-mono">
                        思考：
                        {p.thinkingType === "enabled"
                          ? `开启 / ${formatThinkingEffort(p.thinkingEffort)}`
                          : "关闭"}
                      </div>
                      <div className="text-muted-foreground truncate font-mono">
                        推理回传：{formatReasoningContentMode(p.reasoningContent)}
                      </div>
                      <div className="text-muted-foreground truncate font-mono">
                        上下文：
                        {typeof p.contextWindow === "number"
                          ? p.contextWindow.toLocaleString()
                          : "自动推断"}
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-8 shrink-0 rounded-xl"
                      title="复制配置"
                      onClick={() => handleDuplicate(p)}
                    >
                      <Copy className="size-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-8 shrink-0 rounded-xl"
                      title="编辑配置"
                      onClick={() => setEditing({ ...p })}
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-8 shrink-0 rounded-xl text-destructive"
                      title="删除配置"
                      onClick={() => setDeleteTarget(p)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </section>

          <section className={cn(
            "app-flat-surface flex min-h-0 min-w-0 flex-col gap-4 rounded-[26px] border border-border/70 px-5 py-5",
            "config-panel-transition",
            editing ? "config-panel-expanded animate-slide-down-in" : "config-panel-collapsed",
          )}>
            {!editing && (
              <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
                点击左侧配置编辑，或点击添加配置按钮
              </div>
            )}
            {editing && (
            <>
            <div className="flex items-start gap-3">
              <div className="icon-blue flex size-11 shrink-0 items-center justify-center rounded-[18px] border border-border/70 shadow-[0_8px_18px_color-mix(in_srgb,var(--status-info)_7%,transparent),inset_0_1px_0_color-mix(in_srgb,#fff_12%,transparent)]">
                <Sparkles className="size-5" />
              </div>
              <div className="min-w-0">
                <div className="text-section-header">Editor</div>
                <div className="mt-1 text-base font-semibold tracking-[-0.02em] text-foreground">
                  {editing?.id ? "编辑配置" : "新增配置"}
                </div>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  填写请求格式、Base URL、API 密钥、模型 ID、思考参数和上下文窗口；保存后会立即进入模型列表，并同步用于上下文窗口展示与压缩阈值计算。
                </p>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto pr-1">
            <div className="space-y-4">
              <div className="space-y-1">
                <label htmlFor="oac-format" className="text-sm font-medium">
                  请求格式
                </label>
                <select
                  id="oac-format"
                  value={editing?.apiFormat ?? "openai"}
                  onChange={(e) =>
                    setEditing({
                      ...(editing ?? emptyForm()),
                      apiFormat:
                        e.target.value === "anthropic" ? "anthropic" : "openai",
                    })
                  }
                  className="flex h-10 w-full rounded-xl border border-input bg-background px-3 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
                >
                  <option value="openai">OpenAI</option>
                  <option value="anthropic">Anthropic</option>
                </select>
                <p className="text-xs leading-5 text-muted-foreground">
                  选择你的网关兼容的请求体格式。OpenAI 格式会发送 `thinking` 和 `reasoning_effort`；Anthropic 格式会发送 `thinking` 和 `output_config.effort`，其历史 thinking/signature 由官方 SDK 作为内容块自动保留。
                </p>
              </div>
              <div className="space-y-1">
                <label htmlFor="oac-name" className="text-sm font-medium">
                  显示名称
                </label>
                <Input
                  id="oac-name"
                  value={editing?.name ?? ""}
                  onChange={(e) =>
                    setEditing({ ...(editing ?? emptyForm()), name: e.target.value })
                  }
                  placeholder="例如：本地 vLLM"
                />
              </div>
              <div className="space-y-1">
                <label htmlFor="oac-base" className="text-sm font-medium">
                  接口地址（Base URL）
                </label>
                <Input
                  id="oac-base"
                  value={editing?.baseUrl ?? ""}
                  onChange={(e) =>
                    setEditing({ ...(editing ?? emptyForm()), baseUrl: e.target.value })
                  }
                  placeholder={
                    editing?.apiFormat === "anthropic"
                      ? "https://api.example.com"
                      : "https://api.example.com 或 http://127.0.0.1:11434/v1"
                  }
                />
              </div>
              <div className="space-y-1">
                <label htmlFor="oac-key" className="text-sm font-medium">
                  API 密钥
                </label>
                <div className="relative">
                  <Input
                    id="oac-key"
                    type={showApiKey ? "text" : "password"}
                    value={editing?.apiKey ?? ""}
                    onChange={(e) =>
                      setEditing({ ...(editing ?? emptyForm()), apiKey: e.target.value })
                    }
                    placeholder="可填占位符，若网关不要求密钥"
                    className="pr-11"
                  />
                  <button
                    type="button"
                    aria-label={showApiKey ? "隐藏 API 密钥" : "显示 API 密钥"}
                    onClick={() => setShowApiKey((prev) => !prev)}
                    className="absolute right-2 top-1/2 inline-flex size-7 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-background-interactive/75 hover:text-foreground"
                  >
                    {showApiKey ? (
                      <EyeOff className="size-4" />
                    ) : (
                      <Eye className="size-4" />
                    )}
                  </button>
                </div>
                <p className="text-xs leading-5 text-muted-foreground">
                  点击右侧按钮可在明文和点状密钥显示之间切换。
                </p>
              </div>
              <div className="space-y-1">
                <label htmlFor="oac-model" className="text-sm font-medium">
                  模型 ID
                </label>
                <Input
                  id="oac-model"
                  value={editing?.model ?? ""}
                  onChange={(e) =>
                    setEditing({ ...(editing ?? emptyForm()), model: e.target.value })
                  }
                  placeholder="例如：gpt-4o、Qwen/Qwen2.5-7B-Instruct"
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1">
                  <label htmlFor="oac-thinking-type" className="text-sm font-medium">
                    思考模式
                  </label>
                  <select
                    id="oac-thinking-type"
                    value={editing?.thinkingType ?? "disabled"}
                    onChange={(e) =>
                      setEditing({
                        ...(editing ?? emptyForm()),
                        thinkingType:
                          e.target.value === "enabled" ? "enabled" : "disabled",
                      })
                    }
                    className="flex h-10 w-full rounded-xl border border-input bg-background px-3 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
                  >
                    <option value="disabled">关闭</option>
                    <option value="enabled">开启</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label htmlFor="oac-thinking-effort" className="text-sm font-medium">
                    思考强度
                  </label>
                  <select
                    id="oac-thinking-effort"
                    value={editing?.thinkingEffort ?? "high"}
                    onChange={(e) =>
                      setEditing({
                        ...(editing ?? emptyForm()),
                        thinkingEffort: normalizeThinkingEffort(e.target.value),
                      })
                    }
                    disabled={(editing?.thinkingType ?? "disabled") !== "enabled"}
                    className="flex h-10 w-full rounded-xl border border-input bg-background px-3 text-sm outline-none transition-colors disabled:cursor-not-allowed disabled:opacity-60 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
                  >
                    <option value="low">low</option>
                    <option value="medium">medium</option>
                    <option value="high">high</option>
                    <option value="xhigh">xhigh/max</option>
                  </select>
                </div>
              </div>
              <p className="text-xs leading-5 text-muted-foreground">
                会保留 low、medium、high、xhigh/max 这几个编辑档位。发送到兼容网关时，low/medium/high 会归一化到 high，xhigh/max 会归一化到 max。
              </p>
              <div className="space-y-1">
                <label
                  htmlFor="oac-reasoning-content"
                  className="text-sm font-medium"
                >
                  reasoning_content 回传
                </label>
                <select
                  id="oac-reasoning-content"
                  value={editing?.reasoningContent ?? "auto"}
                  onChange={(e) =>
                    setEditing({
                      ...(editing ?? emptyForm()),
                      reasoningContent: normalizeReasoningContentMode(e.target.value),
                    })
                  }
                  disabled={(editing?.apiFormat ?? "openai") === "anthropic"}
                  className="flex h-10 w-full rounded-xl border border-input bg-background px-3 text-sm outline-none transition-colors disabled:cursor-not-allowed disabled:opacity-60 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
                >
                  <option value="auto">自动</option>
                  <option value="enabled">总是回传</option>
                  <option value="disabled">关闭</option>
                </select>
                <p className="text-xs leading-5 text-muted-foreground">
                  {editing?.apiFormat === "anthropic"
                    ? "Anthropic 模式下官方 SDK 会把历史 thinking/signature 内容块原样回传，这个开关当前不额外介入。"
                    : "自动模式会在检测到历史工具调用且思考模式开启时回传 assistant.reasoning_content，适合 MiMo 这类要求多轮补回推理内容的 OpenAI 兼容模型。"}
                </p>
              </div>
              <div className="space-y-1">
                <label
                  htmlFor="oac-context-window"
                  className="text-sm font-medium"
                >
                  上下文窗口
                </label>
                <Input
                  id="oac-context-window"
                  type="number"
                  min={1}
                  step={1}
                  value={editing?.contextWindow ?? ""}
                  onChange={(e) => {
                    const rawValue = e.target.value.trim();
                    const nextValue =
                      rawValue.length === 0
                        ? undefined
                        : Number.parseInt(rawValue, 10);
                    setEditing({
                      ...(editing ?? emptyForm()),
                      contextWindow:
                        typeof nextValue === "number" && nextValue > 0
                          ? nextValue
                          : undefined,
                    });
                  }}
                  placeholder="例如：64000、128000、1000000"
                />
                <p className="text-xs leading-5 text-muted-foreground">
                  建议填写模型真实的最大输入 tokens。DeepSeek、Qwen、GLM、MiniMax 这类自定义模型会优先使用这里的值；不填时才退回自动推断。
                </p>
              </div>
              <div className="flex flex-wrap gap-2 justify-end">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setEditing(null)}
                >
                  取消
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={!editing}
                  onClick={() => void handleSave()}
                >
                  保存
                </Button>
              </div>
            </div>
            </div>
            </>
            )}
          </section>
        </div>
        </div>

        </DialogContent>
      </Dialog>

      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(nextOpen) => !nextOpen && setDeleteTarget(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>确认删除模型配置？</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            将删除模型配置“{deleteTarget?.name || deleteTarget?.model || "当前配置"}”，此操作不可恢复。
          </p>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setDeleteTarget(null)}
            >
              取消
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void handleDelete()}
            >
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
