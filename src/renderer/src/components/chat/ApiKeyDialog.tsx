import { useState, useEffect } from "react";
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

    console.log("[ApiKeyDialog] Saving API key for provider:", provider.id);
    setSaving(true);
    try {
      await saveApiKey(provider.id, apiKey.trim());
      console.log("[ApiKeyDialog] API key saved successfully");
      onOpenChange(false);
    } catch (e) {
      console.error("[ApiKeyDialog] Failed to save API key:", e);
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
    } catch (e) {
      console.error("Failed to delete API key:", e);
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
              ? `更新 ${provider.name} API 密钥`
              : `添加 ${provider.name} API 密钥`}
          </DialogTitle>
          <DialogDescription>
            {hasExistingKey
              ? "输入新密钥以替换现有密钥，或使用下方按钮移除。"
              : `输入 ${provider.name} 的 API 密钥以使用其模型。`}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-6 py-2 md:grid-cols-[0.9fr_1.1fr]">
          <div className="app-flat-surface rounded-[24px] px-5 py-5">
            <div className="text-section-header">Provider</div>
            <div className="mt-2 text-xl font-semibold tracking-[-0.03em] text-foreground">
              {provider.name}
            </div>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              使用平台密钥后，这个提供商的模型就可以在当前应用内直接调用。
            </p>
            <div className="mt-5 rounded-2xl border border-border/70 bg-background/60 px-4 py-3">
              <div className="text-xs text-muted-foreground">环境变量</div>
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
                ? "留空不会覆盖现有密钥。"
                : "密钥仅保存在本地，不会显示在会话消息里。"}
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
              移除密钥
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
              取消
            </Button>
            <Button
              type="button"
              onClick={handleSave}
              disabled={!apiKey.trim() || saving}
            >
              {saving ? <Loader2 className="size-4 animate-spin" /> : "保存"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
