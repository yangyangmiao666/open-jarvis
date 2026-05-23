import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Save, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { SettingsSection, SettingsCard, SettingsInput } from "./primitives";
import type { ProxyConfig } from "@/types";

const emptyConfig: ProxyConfig = {
  httpProxy: "",
  httpsProxy: "",
  allProxy: "",
};

export function ProxyConfigPanel(): React.JSX.Element {
  const { t } = useTranslation("settings");
  const [config, setConfig] = useState<ProxyConfig>(emptyConfig);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void window.api.settings.getProxyConfig().then((nextConfig) => {
      setConfig(nextConfig);
    });
  }, []);

  const updateField = (key: keyof ProxyConfig, e: React.ChangeEvent<HTMLInputElement>): void => {
    setConfig((current) => ({ ...current, [key]: e.target.value }));
  };

  const handleSave = async (): Promise<void> => {
    setSaving(true);
    try {
      const saved = await window.api.settings.setProxyConfig(config);
      setConfig(saved);
      toast.success(t("proxyConfig.savedAndActive"));
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
    } catch {
      toast.error(t("proxyConfig.resetFailed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <SettingsSection
        title={t("proxyConfig.title")}
        description={t("proxyConfig.description")}
      >
        <SettingsCard divided={false}>
          <SettingsInput
            label={t("proxyConfig.httpsProxy")}
            value={config.httpsProxy}
            onChange={(e) => updateField("httpsProxy", e)}
            placeholder={t("proxyConfig.httpsProxyPlaceholder")}
          />
          <SettingsInput
            label={t("proxyConfig.httpProxy")}
            value={config.httpProxy}
            onChange={(e) => updateField("httpProxy", e)}
            placeholder={t("proxyConfig.httpProxyPlaceholder")}
          />
          <SettingsInput
            label={t("proxyConfig.allProxy")}
            value={config.allProxy}
            onChange={(e) => updateField("allProxy", e)}
            placeholder={t("proxyConfig.allProxyPlaceholder")}
          />
        </SettingsCard>
      </SettingsSection>

      <div className="rounded-xl border border-border/50 bg-muted/30 px-4 py-3 text-xs leading-5 text-muted-foreground">
        {t("proxyConfig.autoNodeProxy")}
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="ghost" disabled={saving} onClick={() => void handleReset()}>
          <RotateCcw className="h-4 w-4 mr-1" />
          {t("proxyConfig.clear")}
        </Button>
        <Button disabled={saving} onClick={() => void handleSave()}>
          <Save className="h-4 w-4 mr-1" />
          {t("common:save")}
        </Button>
      </div>
    </div>
  );
}