import { useEffect, useState } from "react";
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
  const [config, setConfig] = useState<ProxyConfig>(emptyConfig);
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    void window.api.settings.getProxyConfig().then((nextConfig) => {
      setConfig(nextConfig);
      setStatus(null);
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
      setStatus("代理配置已保存并立即生效");
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async (): Promise<void> => {
    setSaving(true);
    try {
      const saved = await window.api.settings.setProxyConfig(emptyConfig);
      setConfig(saved);
      setStatus("代理配置已清空");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(92vh,48rem)] w-[min(96vw,42rem)] max-w-2xl flex-col overflow-hidden p-0">
        <DialogHeader className="rounded-t-[32px] border-b border-border/60 px-6 py-5 pr-14 sm:px-7">
          <div className="flex items-center gap-3">
            <div className="inline-flex shrink-0 items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">
              <Network className="size-3.5" />
              Proxy
            </div>
            <DialogTitle className="text-xl tracking-[-0.03em]">
              代理配置
            </DialogTitle>
          </div>
          <p className="text-sm leading-6 text-muted-foreground">
            保存后会写入应用环境配置，并立即更新主进程中的全局网络代理。通常只填 HTTPS 代理即可。
          </p>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5 sm:px-7">
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="proxy-https" className="text-sm font-medium">
                HTTPS 代理
              </label>
              <Input
                id="proxy-https"
                value={config.httpsProxy}
                onChange={(event) => updateField("httpsProxy", event.target.value)}
                placeholder="例如：http://127.0.0.1:7890"
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="proxy-http" className="text-sm font-medium">
                HTTP 代理
              </label>
              <Input
                id="proxy-http"
                value={config.httpProxy}
                onChange={(event) => updateField("httpProxy", event.target.value)}
                placeholder="例如：http://127.0.0.1:7890"
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="proxy-all" className="text-sm font-medium">
                ALL_PROXY
              </label>
              <Input
                id="proxy-all"
                value={config.allProxy}
                onChange={(event) => updateField("allProxy", event.target.value)}
                placeholder="例如：socks5://127.0.0.1:7891"
              />
            </div>
            <div className="rounded-2xl border border-border/70 bg-background/35 px-4 py-3 text-xs leading-6 text-muted-foreground">
              当前实现会在有任一代理地址时自动写入 NODE_USE_ENV_PROXY=1，方便子进程和部分运行时保持一致。
            </div>
          </div>
        </div>

        <DialogFooter className="shrink-0 border-t border-border/60 px-6 py-4 sm:px-7">
          <div className="mr-auto min-h-5 text-xs text-muted-foreground">
            {status ?? ""}
          </div>
          <Button
            type="button"
            variant="ghost"
            disabled={saving}
            onClick={() => void handleReset()}
          >
            <RotateCcw className="size-4" />
            清空
          </Button>
          <Button type="button" disabled={saving} onClick={() => void handleSave()}>
            <Save className="size-4" />
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}