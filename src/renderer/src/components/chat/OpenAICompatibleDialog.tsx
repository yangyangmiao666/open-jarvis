import { useState, useEffect } from "react";
import { Plus, Trash2, Pencil, Boxes, Sparkles, Eye, EyeOff } from "lucide-react";
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
import type { OpenAICompatibleProfile } from "@/types";

interface OpenAICompatibleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

const emptyForm = (): Omit<OpenAICompatibleProfile, "id"> & {
  id?: string;
} => ({
  name: "",
  baseUrl: "",
  apiKey: "",
  model: "",
  contextWindow: undefined,
});

export function OpenAICompatibleDialog({
  open,
  onOpenChange,
  onSaved,
}: OpenAICompatibleDialogProps): React.JSX.Element {
  const [profiles, setProfiles] = useState<OpenAICompatibleProfile[]>([]);
  const [showApiKey, setShowApiKey] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<OpenAICompatibleProfile | null>(
    null,
  );
  const [editing, setEditing] = useState<
    (Omit<OpenAICompatibleProfile, "id"> & { id?: string }) | null
  >(null);

  const load = async (): Promise<void> => {
    const list = await window.api.models.openaiCompatibleList();
    setProfiles(list);
  };

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void load();

      setEditing(null);
      setShowApiKey(false);
    }
  }, [open]);

  useEffect(() => {
    setShowApiKey(false);
  }, [editing?.id]);

  const handleSave = async (): Promise<void> => {
    if (!editing) return;
    if (!editing.baseUrl.trim() || !editing.model.trim()) {
      return;
    }
    await window.api.models.openaiCompatibleUpsert(editing);
    await load();
    onSaved();
    setEditing(null);
  };

  const handleDelete = async (): Promise<void> => {
    if (!deleteTarget) return;
    await window.api.models.openaiCompatibleDelete(deleteTarget.id);
    await load();
    onSaved();
    setDeleteTarget(null);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex max-h-[min(92vh,54rem)] w-[min(96vw,72rem)] max-w-5xl flex-col overflow-hidden p-0">
        <DialogHeader className="rounded-t-[32px] border-b border-border/70 bg-[radial-gradient(circle_at_top_left,color-mix(in_srgb,var(--primary)_14%,transparent),transparent_46%),linear-gradient(180deg,color-mix(in_srgb,var(--card)_98%,transparent),color-mix(in_srgb,var(--background)_94%,transparent))] px-6 py-4 pr-14 sm:px-7">
          <div className="flex items-center gap-3">
            <div className="inline-flex shrink-0 items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">
              <Boxes className="size-3.5" />
              Models Workspace
            </div>
            <DialogTitle className="text-xl tracking-[-0.03em]">
              自定义模型配置
            </DialogTitle>
          </div>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5 sm:px-7">
        <div className="grid min-h-0 gap-4 lg:grid-cols-[1.05fr_1.2fr]">
          <section className="app-flat-surface flex min-h-0 flex-col gap-4 rounded-[26px] border border-border/70 px-5 py-5">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="text-section-header">Profiles</div>
                <div className="mt-1 text-base font-semibold tracking-[-0.02em] text-foreground">
                  已有配置
                </div>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  查看、编辑和删除当前已经接入的 OpenAI Compatible 模型配置。
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
                      onClick={() => setEditing({ ...p })}
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-8 shrink-0 rounded-xl text-destructive"
                      onClick={() => setDeleteTarget(p)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </section>

          <section className="app-flat-surface flex min-h-0 flex-col gap-4 rounded-[26px] border border-border/70 px-5 py-5">
            <div className="flex items-start gap-3">
              <div className="flex size-11 shrink-0 items-center justify-center rounded-[18px] border border-border/70 bg-background-elevated/80 text-primary shadow-[0_8px_18px_color-mix(in_srgb,var(--primary)_7%,transparent),inset_0_1px_0_color-mix(in_srgb,#fff_12%,transparent)]">
                <Sparkles className="size-5" />
              </div>
              <div className="min-w-0">
                <div className="text-section-header">Editor</div>
                <div className="mt-1 text-base font-semibold tracking-[-0.02em] text-foreground">
                  {editing ? "编辑配置" : "新增配置"}
                </div>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  填写 Base URL、API 密钥、模型 ID 和上下文窗口；保存后会立即进入模型列表，并同步用于上下文窗口展示与压缩阈值计算。
                </p>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto pr-1">
            <div className="space-y-4">
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
                  placeholder="https://api.example.com 或 http://127.0.0.1:11434/v1"
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
