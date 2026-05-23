import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Eye, EyeOff, Loader2, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAppStore } from "@/lib/store";
import { toast } from "@/components/ui/toast";
import type { Provider } from "@/types";

interface ApiKeyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  provider: Provider | null;
}

const PROVIDER_INFO: Record<string, { placeholder: string; envVar: string }> = {
  anthropic: { placeholder: "sk-ant-...", envVar: "ANTHROPIC_API_KEY" },
  openai: { placeholder: "sk-...", envVar: "OPENAI_API_KEY" },
  google: { placeholder: "AIza...", envVar: "GOOGLE_API_KEY" },
};

export function ApiKeyDialog({
  open,
  onOpenChange,
  provider,
}: ApiKeyDialogProps): React.JSX.Element | null {
  const { t } = useTranslation("settings");
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [hasExistingKey, setHasExistingKey] = useState(false);

  const { setApiKey: saveApiKey, deleteApiKey } = useAppStore();

  // Check if there's an existing key when dialog opens
  useEffect(() => {
    if (open && provider) {
      setHasExistingKey(provider.hasApiKey);
      setApiKey("");
      setShowKey(false);
    }
  }, [open, provider]);

  if (!provider) return null;

  const info = PROVIDER_INFO[provider.id] || { placeholder: "...", envVar: "" };

  async function handleSave(): Promise<void> {
    if (!apiKey.trim()) return;
    if (!provider) return;

    setSaving(true);
    try {
      await saveApiKey(provider.id, apiKey.trim());
      onOpenChange(false);
      toast.success(t("apiKey.saved"));
    } catch {
      toast.error(t("apiKey.saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(): Promise<void> {
    if (!provider) return;
    setDeleting(true);
    try {
      await deleteApiKey(provider.id);
      onOpenChange(false);
      toast.success(t("apiKey.removed"));
    } catch {
      toast.error(t("apiKey.removeFailed"));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {hasExistingKey
              ? t("apiKey.updateKey", { name: provider.name })
              : t("apiKey.addKey", { name: provider.name })}
          </DialogTitle>
          <DialogDescription>
            {hasExistingKey
              ? t("apiKey.updateDesc")
              : t("apiKey.addDesc", { name: provider.name })}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-6 py-2 md:grid-cols-[0.9fr_1.1fr]">
          <div className="app-flat-surface rounded-[24px] px-5 py-5">
            <div className="text-section-header">{t("apiKey.provider")}</div>
            <div className="mt-2 text-xl font-semibold tracking-[-0.03em] text-foreground">
              {provider.name}
            </div>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              {t("apiKey.providerDesc")}
            </p>
            <div className="mt-5 rounded-2xl border border-border/70 bg-background/60 px-4 py-3">
              <div className="text-xs text-muted-foreground">{t("apiKey.envVar")}</div>
              <div className="mt-1 font-mono text-sm text-foreground">{info.envVar}</div>
            </div>
          </div>
          <div className="space-y-4">
            <div className="relative">
              <Input
                type={showKey ? "text" : "password"}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={
                  hasExistingKey ? "••••••••••••••••" : info.placeholder
                }
                className="pr-10"
                autoFocus
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              >
                {showKey ? (
                  <EyeOff className="size-4" />
                ) : (
                  <Eye className="size-4" />
                )}
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              {hasExistingKey
                ? t("apiKey.emptyNoOverwrite")
                : t("apiKey.localOnly")}
            </p>
          </div>
        </div>

        <div className="flex justify-between gap-3">
          {hasExistingKey ? (
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={handleDelete}
              disabled={deleting || saving}
            >
              {deleting ? (
                <Loader2 className="size-4 animate-spin mr-2" />
              ) : (
                <Trash2 className="size-4 mr-2" />
              )}
              {t("apiKey.removeKey")}
            </Button>
          ) : (
            <div />
          )}
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              {t("common:cancel")}
            </Button>
            <Button
              type="button"
              onClick={handleSave}
              disabled={!apiKey.trim() || saving}
            >
              {saving ? <Loader2 className="size-4 animate-spin" /> : t("common:save")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
