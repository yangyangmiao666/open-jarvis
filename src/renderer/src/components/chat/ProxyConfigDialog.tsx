import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Network, Save, RotateCcw } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import type { ProxyConfig } from "@/types";

interface ProxyConfigDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const emptyConfig: ProxyConfig = {
  httpProxy: "",
  httpsProxy: "",
  allProxy: "",
};

export function ProxyConfigDialog({
  open,
  onOpenChange,
}: ProxyConfigDialogProps): React.JSX.Element {
  const { t } = useTranslation("settings");
  const [config, setConfig] = useState<ProxyConfig>(emptyConfig);
  const [saving, setSaving] = useState(false);
  const [successFlash, setSuccessFlash] = useState<"save" | "reset" | null>(null);

  useEffect(() => {
    if (!open) return;
    void window.api.settings.getProxyConfig().then((nextConfig) => {
      setConfig(nextConfig);
    });
  }, [open]);

  const updateField = (key: keyof ProxyConfig, value: string): void => {
    setConfig((current) => ({ ...current, [key]: value }));
  };

  const handleSave = async (): Promise<void> => {
    setSaving(true);
    try {
      const saved = await window.api.settings.setProxyConfig(config);
      setConfig(saved);
      toast.success(t("proxyConfig.savedAndActive"));
      setSuccessFlash("save");
      setTimeout(() => setSuccessFlash(null), 360);
    } catch {
      toast.error(t("proxyConfig.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async (): Promise<void> => {
    setSaving(true);
    try {
      const saved = await window.api.settings.setProxyConfig(emptyConfig);
      setConfig(saved);
      toast.success(t("proxyConfig.cleared"));
      setSuccessFlash("reset");
      setTimeout(() => setSuccessFlash(null), 360);
    } catch {
      toast.error(t("proxyConfig.resetFailed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(92vh,48rem)] w-[min(96vw,42rem)] max-w-2xl flex-col overflow-hidden p-0">
        <DialogHeader className="shrink-0 rounded-t-[32px] border-b border-border/60 px-6 py-5 pr-16 sm:px-7 sm:pr-20">
          <div className="flex items-center gap-3">
            <div className="badge-amber inline-flex shrink-0 items-center gap-2 rounded-full border border-status-warning/20 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em]">
              <Network className="size-3.5" />
              Proxy
            </div>
            <DialogTitle className="text-xl tracking-[-0.03em]">
              {t("proxyConfig.title")}
            </DialogTitle>
          </div>
          <p className="text-sm leading-6 text-muted-foreground">
            {t("proxyConfig.description")}
          </p>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5 sm:px-7">
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="proxy-https" className="text-sm font-medium">
                {t("proxyConfig.httpsProxy")}
              </label>
              <Input
                id="proxy-https"
                value={config.httpsProxy}
                onChange={(event) => updateField("httpsProxy", event.target.value)}
                placeholder={t("proxyConfig.httpsProxyPlaceholder")}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="proxy-http" className="text-sm font-medium">
                {t("proxyConfig.httpProxy")}
              </label>
              <Input
                id="proxy-http"
                value={config.httpProxy}
                onChange={(event) => updateField("httpProxy", event.target.value)}
                placeholder={t("proxyConfig.httpProxyPlaceholder")}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="proxy-all" className="text-sm font-medium">
                {t("proxyConfig.allProxy")}
              </label>
              <Input
                id="proxy-all"
                value={config.allProxy}
                onChange={(event) => updateField("allProxy", event.target.value)}
                placeholder={t("proxyConfig.allProxyPlaceholder")}
              />
            </div>
            <div className="rounded-2xl border border-border/70 bg-background/35 px-4 py-3 text-xs leading-6 text-muted-foreground">
              {t("proxyConfig.autoNodeProxy")}
            </div>
          </div>
        </div>

        <DialogFooter className="shrink-0 border-t border-border/60 px-6 py-4 sm:px-7">
          <Button
            type="button"
            variant="ghost"
            disabled={saving}
            onClick={() => void handleReset()}
            className={cn(successFlash === "reset" && "animate-button-success")}
          >
            <RotateCcw className="size-4" />
            {t("proxyConfig.clear")}
          </Button>
          <Button
            type="button"
            disabled={saving}
            onClick={() => void handleSave()}
            className={cn(successFlash === "save" && "animate-button-success")}
          >
            <Save className="size-4" />
            {t("common:save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}