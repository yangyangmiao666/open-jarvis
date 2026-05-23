import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
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
  t?: (key: string) => string,
): string {
  switch (mode) {
    case "enabled":
      return t ? t("openAICompatible.reasoningAlways") : "Always pass back";
    case "disabled":
      return t ? t("openAICompatible.reasoningDisabled") : "Off";
    case "auto":
    default:
      return t ? t("openAICompatible.reasoningAuto") : "Auto";
  }
}

function buildDuplicateProfile(
  profile: OpenAICompatibleProfile,
  t: (key: string, options?: Record<string, unknown>) => string,
): Omit<OpenAICompatibleProfile, "id"> & { id?: string } {
  const baseName = profile.name?.trim() || profile.model.trim() || t("openAICompatible.customModel");
  return {
    ...profile,
    id: undefined,
    name: t("openAICompatible.duplicateName", { name: baseName }),
  };
}

export function OpenAICompatibleDialog({
  open,
  onOpenChange,
  onSaved,
  initialProfileId,
}: OpenAICompatibleDialogProps): React.JSX.Element {
  const { t } = useTranslation("settings");
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
      toast.error(t("openAICompatible.fillBaseUrlAndModel"));
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
      toast.success(t("openAICompatible.saved"));
    } catch (e) {
      toast.error(t("openAICompatible.saveFailed"));
    }
  };

  const handleDelete = async (): Promise<void> => {
    if (!deleteTarget) return;
    try {
      await window.api.models.openaiCompatibleDelete(deleteTarget.id);
      await load();
      onSaved();
      setDeleteTarget(null);
      toast.success(t("openAICompatible.deleted"));
    } catch (e) {
      toast.error(t("openAICompatible.deleteFailed"));
    }
  };

  const handleDuplicate = (profile: OpenAICompatibleProfile): void => {
    setShowApiKey(false);
    setEditing(buildDuplicateProfile(profile, t));
    toast.success(t("openAICompatible.duplicatedDraft"));
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex max-h-[min(92vh,54rem)] w-[min(96vw,72rem)] max-w-5xl flex-col overflow-hidden p-0">
        <DialogHeader className="shrink-0 rounded-t-4xl border-b border-border/60 px-6 py-5 pr-16 sm:px-7 sm:pr-20">
          <div className="flex items-center gap-3">
            <div className="badge-blue inline-flex shrink-0 items-center gap-2 rounded-full border border-status-info/20 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em]">
              <Boxes className="size-3.5" />
              {t('openAICompatible.modelsWorkspace')}
            </div>
            <DialogTitle className="text-xl tracking-[-0.03em]">
              {t('openAICompatible.title')}
            </DialogTitle>
          </div>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5 sm:px-7">
        <div className="grid min-h-0 gap-4 lg:grid-cols-[minmax(18rem,0.92fr)_minmax(24rem,1.08fr)]">
          <section className="app-flat-surface flex min-h-0 min-w-0 flex-col gap-4 rounded-[26px] border border-border/70 px-5 py-5">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="text-section-header">{t('openAICompatible.profiles')}</div>
                <div className="mt-1 text-base font-semibold tracking-[-0.02em] text-foreground">
                  {t('openAICompatible.existingConfigs')}
                </div>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {t('openAICompatible.existingConfigsDesc')}
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
                {t('openAICompatible.addConfig')}
              </Button>
            </div>

            <ScrollArea className="app-subtle-scroll min-h-0 flex-1 rounded-[22px] border border-border/70 bg-background/35">
              <div className="space-y-2 p-3">
                {profiles.length === 0 && !editing && (
                  <div className="rounded-2xl border border-dashed border-border/70 px-3 py-8 text-center text-xs text-muted-foreground">
                    {t('openAICompatible.noConfigs')}
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
                        {t('openAICompatible.model')}{p.model}
                      </div>
                      <div className="text-muted-foreground truncate font-mono">
                        {t('openAICompatible.format')}{p.apiFormat === "anthropic" ? "Anthropic" : "OpenAI"}
                      </div>
                      <div className="text-muted-foreground truncate font-mono">
                        {t('openAICompatible.thinking')}
                        {p.thinkingType === "enabled"
                          ? t('openAICompatible.thinkingOn', { effort: formatThinkingEffort(p.thinkingEffort) })
                          : t('openAICompatible.thinkingOff')}
                      </div>
                      <div className="text-muted-foreground truncate font-mono">
                        {t('openAICompatible.reasoningPassback')}{formatReasoningContentMode(p.reasoningContent, t)}
                      </div>
                      <div className="text-muted-foreground truncate font-mono">
                        {t('openAICompatible.context')}
                        {typeof p.contextWindow === "number"
                          ? p.contextWindow.toLocaleString()
                          : t('openAICompatible.autoInfer')}
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-8 shrink-0 rounded-xl"
                      title={t('openAICompatible.copyConfig')}
                      onClick={() => handleDuplicate(p)}
                    >
                      <Copy className="size-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-8 shrink-0 rounded-xl"
                      title={t('openAICompatible.editConfig')}
                      onClick={() => setEditing({ ...p })}
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-8 shrink-0 rounded-xl text-destructive"
                      title={t('openAICompatible.deleteConfig')}
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
                {t('openAICompatible.clickToEditOrAdd')}
              </div>
            )}
            {editing && (
            <>
            <div className="flex items-start gap-3">
              <div className="icon-blue flex size-11 shrink-0 items-center justify-center rounded-[18px] border border-border/70 shadow-[0_8px_18px_color-mix(in_srgb,var(--status-info)_7%,transparent),inset_0_1px_0_color-mix(in_srgb,#fff_12%,transparent)]">
                <Sparkles className="size-5" />
              </div>
              <div className="min-w-0">
                <div className="text-section-header">{t('openAICompatible.editor')}</div>
                <div className="mt-1 text-base font-semibold tracking-[-0.02em] text-foreground">
                  {editing?.id ? t('openAICompatible.editConfigTitle') : t('openAICompatible.newConfigTitle')}
                </div>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {t('openAICompatible.editorDesc')}
                </p>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto pr-1">
            <div className="space-y-4">
              <div className="space-y-1">
                <label htmlFor="oac-format" className="text-sm font-medium">
                  {t('openAICompatible.requestFormat')}
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
                  {t('openAICompatible.requestFormatDesc')}
                </p>
              </div>
              <div className="space-y-1">
                <label htmlFor="oac-name" className="text-sm font-medium">
                  {t('openAICompatible.displayName')}
                </label>
                <Input
                  id="oac-name"
                  value={editing?.name ?? ""}
                  onChange={(e) =>
                    setEditing({ ...(editing ?? emptyForm()), name: e.target.value })
                  }
                  placeholder={t('openAICompatible.namePlaceholder')}
                />
              </div>
              <div className="space-y-1">
                <label htmlFor="oac-base" className="text-sm font-medium">
                  {t('openAICompatible.baseUrl')}
                </label>
                <Input
                  id="oac-base"
                  value={editing?.baseUrl ?? ""}
                  onChange={(e) =>
                    setEditing({ ...(editing ?? emptyForm()), baseUrl: e.target.value })
                  }
                  placeholder={
                    editing?.apiFormat === "anthropic"
                      ? t('openAICompatible.baseUrlPlaceholderAnthropic')
                      : t('openAICompatible.baseUrlPlaceholderOpenAI')
                  }
                />
              </div>
              <div className="space-y-1">
                <label htmlFor="oac-key" className="text-sm font-medium">
                  {t('openAICompatible.apiKey')}
                </label>
                <div className="relative">
                  <Input
                    id="oac-key"
                    type={showApiKey ? "text" : "password"}
                    value={editing?.apiKey ?? ""}
                    onChange={(e) =>
                      setEditing({ ...(editing ?? emptyForm()), apiKey: e.target.value })
                    }
                    placeholder={t('openAICompatible.apiKeyPlaceholder')}
                    className="pr-11"
                  />
                  <button
                    type="button"
                    aria-label={showApiKey ? t('openAICompatible.hideApiKey') : t('openAICompatible.showApiKey')}
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
                  {t('openAICompatible.apiKeyToggleDesc')}
                </p>
              </div>
              <div className="space-y-1">
                <label htmlFor="oac-model" className="text-sm font-medium">
                  {t('openAICompatible.modelId')}
                </label>
                <Input
                  id="oac-model"
                  value={editing?.model ?? ""}
                  onChange={(e) =>
                    setEditing({ ...(editing ?? emptyForm()), model: e.target.value })
                  }
                  placeholder={t('openAICompatible.modelIdPlaceholder')}
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1">
                  <label htmlFor="oac-thinking-type" className="text-sm font-medium">
                    {t('openAICompatible.thinkingMode')}
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
                    <option value="disabled">{t('openAICompatible.thinkingOff')}</option>
                    <option value="enabled">{t('openAICompatible.thinkingOn', { effort: '' }).replace(/ \/ $/, '')}</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label htmlFor="oac-thinking-effort" className="text-sm font-medium">
                    {t('openAICompatible.thinkingEffort')}
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
                {t('openAICompatible.thinkingEffortDesc')}
              </p>
              <div className="space-y-1">
                <label
                  htmlFor="oac-reasoning-content"
                  className="text-sm font-medium"
                >
                  {t('openAICompatible.reasoningContent')}
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
                  <option value="auto">{t('openAICompatible.reasoningAuto')}</option>
                  <option value="enabled">{t('openAICompatible.reasoningAlways')}</option>
                  <option value="disabled">{t('openAICompatible.reasoningDisabled')}</option>
                </select>
                <p className="text-xs leading-5 text-muted-foreground">
                  {editing?.apiFormat === "anthropic"
                    ? t('openAICompatible.reasoningAnthropicDesc')
                    : t('openAICompatible.reasoningAutoDesc')}
                </p>
              </div>
              <div className="space-y-1">
                <label
                  htmlFor="oac-context-window"
                  className="text-sm font-medium"
                >
                  {t('openAICompatible.contextWindow')}
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
                  placeholder={t('openAICompatible.contextWindowPlaceholder')}
                />
                <p className="text-xs leading-5 text-muted-foreground">
                  {t('openAICompatible.contextWindowDesc')}
                </p>
              </div>
              <div className="flex flex-wrap gap-2 justify-end">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setEditing(null)}
                >
                  {t('common:cancel')}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={!editing}
                  onClick={() => void handleSave()}
                >
                  {t('common:save')}
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
            <DialogTitle>{t('openAICompatible.confirmDeleteModel')}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {t('openAICompatible.deleteModelWarning', { name: deleteTarget?.name || deleteTarget?.model || t('openAICompatible.currentConfig') })}
          </p>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setDeleteTarget(null)}
            >
              {t('common:cancel')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void handleDelete()}
            >
              {t('common:delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
