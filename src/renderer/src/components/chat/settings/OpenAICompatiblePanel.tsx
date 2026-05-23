import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Trash2, Pencil, Copy } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { toast } from "@/lib/toast";
import {
  SettingsSection,
  SettingsCard,
  SettingsRow,
  SettingsInput,
  SettingsSecretInput,
  SettingsSelect,
} from "./primitives";
import { useAppStore } from "@/lib/store";
import type { OpenAICompatibleProfile, CustomModelApiFormat, CustomModelThinkingType, CustomModelThinkingEffort, CustomModelReasoningContentMode } from "@/types";

interface OpenAICompatiblePanelProps {
  profileId?: string;
}

const emptyForm = (): Omit<OpenAICompatibleProfile, "id"> & { id?: string } => ({
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

function normalizeThinkingEffort(effort?: string): CustomModelThinkingEffort {
  switch (effort) {
    case "low": case "medium": case "high": case "xhigh": case "max": return effort;
    default: return "high";
  }
}

function normalizeReasoningContentMode(mode?: string): CustomModelReasoningContentMode {
  switch (mode) {
    case "enabled": case "disabled": return mode;
    default: return "auto";
  }
}

export function OpenAICompatiblePanel({ profileId }: OpenAICompatiblePanelProps): React.JSX.Element {
  const { t } = useTranslation("settings");
  const { loadModels, loadProviders } = useAppStore();
  const [profiles, setProfiles] = useState<OpenAICompatibleProfile[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<OpenAICompatibleProfile | null>(null);
  const [editing, setEditing] = useState<(Omit<OpenAICompatibleProfile, "id"> & { id?: string }) | null>(null);

  const load = async (): Promise<OpenAICompatibleProfile[]> => {
    const list = await window.api.models.openaiCompatibleList();
    setProfiles(list);
    return list;
  };

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const list = await load();
      if (cancelled) return;
      if (profileId) {
        const target = list.find((p) => p.id === profileId);
        setEditing(target ? { ...target } : emptyForm());
      } else {
        setEditing(null);
      }
    })();
    return () => { cancelled = true; };
  }, [profileId]);

  const handleSave = async (): Promise<void> => {
    if (!editing) return;
    if (!editing.baseUrl.trim() || !editing.model.trim()) {
      toast.error(t("openAICompatible.fillBaseUrlAndModel"));
      return;
    }
    try {
      await window.api.models.openaiCompatibleUpsert(editing);
      await load();
      void loadProviders();
      void loadModels();
      setEditing(null);
      toast.success(t("openAICompatible.saved"));
    } catch {
      toast.error(t("openAICompatible.saveFailed"));
    }
  };

  const handleDelete = async (): Promise<void> => {
    if (!deleteTarget) return;
    try {
      await window.api.models.openaiCompatibleDelete(deleteTarget.id);
      await load();
      void loadProviders();
      void loadModels();
      setDeleteTarget(null);
      toast.success(t("openAICompatible.deleted"));
    } catch {
      toast.error(t("openAICompatible.deleteFailed"));
    }
  };

  const handleDuplicate = (profile: OpenAICompatibleProfile): void => {
    const baseName = profile.name?.trim() || profile.model.trim() || t("openAICompatible.customModel");
    setEditing({
      ...profile,
      id: undefined,
      name: t("openAICompatible.duplicateName", { name: baseName }),
    });
    toast.success(t("openAICompatible.duplicatedDraft"));
  };

  return (
    <>
      <div className="space-y-6">
        <SettingsSection
          title={t("openAICompatible.existingConfigs")}
          description={t("openAICompatible.existingConfigsDesc")}
          action={
            <Button variant="outline" size="sm" onClick={() => setEditing(emptyForm())}>
              <Plus className="h-4 w-4 mr-1" />
              {t("openAICompatible.addConfig")}
            </Button>
          }
        >
          {profiles.length === 0 ? (
            <div className="rounded-xl border border-border/50 px-4 py-8 text-center text-sm text-muted-foreground">
              {t("openAICompatible.noConfigs")}
            </div>
          ) : (
            <SettingsCard>
              {profiles.map((p) => (
                <SettingsRow
                  key={p.id}
                  label={p.name || p.model}
                  description={`${p.baseUrl} · ${p.apiFormat === "anthropic" ? "Anthropic" : "OpenAI"} · ${p.model}`}
                >
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setEditing({ ...p })}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleDuplicate(p)}>
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => setDeleteTarget(p)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </SettingsRow>
              ))}
            </SettingsCard>
          )}
        </SettingsSection>
      </div>

      {/* Edit / New Configuration Dialog */}
      <Dialog open={editing !== null} onOpenChange={(nextOpen) => !nextOpen && setEditing(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing?.id ? t("openAICompatible.editConfigTitle") : t("openAICompatible.newConfigTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1 -mr-1">
            <SettingsSelect
              label={t("openAICompatible.requestFormat")}
              description={t("openAICompatible.requestFormatDesc")}
              value={editing?.apiFormat ?? "openai"}
              onValueChange={(v) => setEditing({ ...(editing ?? emptyForm()), apiFormat: v as CustomModelApiFormat })}
              options={[
                { value: "openai", label: "OpenAI" },
                { value: "anthropic", label: "Anthropic" },
              ]}
            />
            <SettingsInput
              label={t("openAICompatible.displayName")}
              value={editing?.name ?? ""}
              onChange={(e) => setEditing({ ...(editing ?? emptyForm()), name: e.target.value })}
              placeholder={t("openAICompatible.namePlaceholder")}
            />
            <SettingsInput
              label={t("openAICompatible.baseUrl")}
              value={editing?.baseUrl ?? ""}
              onChange={(e) => setEditing({ ...(editing ?? emptyForm()), baseUrl: e.target.value })}
              placeholder={editing?.apiFormat === "anthropic" ? t("openAICompatible.baseUrlPlaceholderAnthropic") : t("openAICompatible.baseUrlPlaceholderOpenAI")}
            />
            <SettingsSecretInput
              label={t("openAICompatible.apiKey")}
              description={t("openAICompatible.apiKeyToggleDesc")}
              value={editing?.apiKey ?? ""}
              onChange={(e) => setEditing({ ...(editing ?? emptyForm()), apiKey: e.target.value })}
              placeholder={t("openAICompatible.apiKeyPlaceholder")}
            />
            <SettingsInput
              label={t("openAICompatible.modelId")}
              value={editing?.model ?? ""}
              onChange={(e) => setEditing({ ...(editing ?? emptyForm()), model: e.target.value })}
              placeholder={t("openAICompatible.modelIdPlaceholder")}
            />
            <SettingsSelect
              label={t("openAICompatible.thinkingMode")}
              value={editing?.thinkingType ?? "disabled"}
              onValueChange={(v) => setEditing({ ...(editing ?? emptyForm()), thinkingType: v as CustomModelThinkingType })}
              options={[
                { value: "disabled", label: t("openAICompatible.thinkingOff") },
                { value: "enabled", label: t("openAICompatible.thinkingOn", { effort: "" }).replace(/ \/ $/, "") },
              ]}
            />
            <SettingsSelect
              label={t("openAICompatible.thinkingEffort")}
              description={t("openAICompatible.thinkingEffortDesc")}
              value={editing?.thinkingEffort ?? "high"}
              onValueChange={(v) => setEditing({ ...(editing ?? emptyForm()), thinkingEffort: normalizeThinkingEffort(v) })}
              disabled={(editing?.thinkingType ?? "disabled") !== "enabled"}
              options={[
                { value: "low", label: "low" },
                { value: "medium", label: "medium" },
                { value: "high", label: "high" },
                { value: "xhigh", label: "xhigh/max" },
              ]}
            />
            <SettingsSelect
              label={t("openAICompatible.reasoningContent")}
              description={editing?.apiFormat === "anthropic" ? t("openAICompatible.reasoningAnthropicDesc") : t("openAICompatible.reasoningAutoDesc")}
              value={editing?.reasoningContent ?? "auto"}
              onValueChange={(v) => setEditing({ ...(editing ?? emptyForm()), reasoningContent: normalizeReasoningContentMode(v) })}
              disabled={(editing?.apiFormat ?? "openai") === "anthropic"}
              options={[
                { value: "auto", label: t("openAICompatible.reasoningAuto") },
                { value: "enabled", label: t("openAICompatible.reasoningAlways") },
                { value: "disabled", label: t("openAICompatible.reasoningDisabled") },
              ]}
            />
            <SettingsInput
              label={t("openAICompatible.contextWindow")}
              description={t("openAICompatible.contextWindowDesc")}
              value={editing?.contextWindow?.toString() ?? ""}
              onChange={(e) => {
                const rawValue = e.target.value.trim();
                const nextValue = rawValue.length === 0 ? undefined : Number.parseInt(rawValue, 10);
                setEditing({ ...(editing ?? emptyForm()), contextWindow: typeof nextValue === "number" && nextValue > 0 ? nextValue : undefined });
              }}
              placeholder={t("openAICompatible.contextWindowPlaceholder")}
            />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="secondary" onClick={() => setEditing(null)}>{t("common:cancel")}</Button>
            <Button onClick={() => void handleSave()}>{t("common:save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteTarget !== null} onOpenChange={(nextOpen) => !nextOpen && setDeleteTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("openAICompatible.confirmDeleteModel")}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {t("openAICompatible.deleteModelWarning", { name: deleteTarget?.name || deleteTarget?.model || t("openAICompatible.currentConfig") })}
          </p>
          <DialogFooter className="gap-2">
            <Button variant="secondary" onClick={() => setDeleteTarget(null)}>{t("common:cancel")}</Button>
            <Button variant="destructive" onClick={() => void handleDelete()}>{t("common:delete")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}