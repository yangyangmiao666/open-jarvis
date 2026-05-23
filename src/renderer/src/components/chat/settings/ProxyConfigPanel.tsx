import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Save, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/lib/toast";
import {
  SettingsSection,
  SettingsCard,
  SettingsInput,
  SettingsSegmentedControl,
} from "./primitives";

type ProxyMode = "system" | "custom";

export function ProxyConfigPanel(): React.JSX.Element {
  const { t } = useTranslation("settings");
  const [proxyMode, setProxyMode] = useState<ProxyMode>("system");
  const [httpsProxy, setHttpsProxy] = useState("");
  const [httpProxy, setHttpProxy] = useState("");
  const [allProxy, setAllProxy] = useState("");
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const config = await window.api.settings.getProxyConfig();
        const hasProxyValues = !!(config.httpsProxy || config.httpProxy || config.allProxy);
        const mode: ProxyMode = config.proxyMode ?? (hasProxyValues ? "custom" : "system");
        setProxyMode(mode);
        setHttpsProxy(config.httpsProxy ?? "");
        setHttpProxy(config.httpProxy ?? "");
        setAllProxy(config.allProxy ?? "");
      } catch {
        // use defaults
      }
      setInitialized(true);
    })();
  }, []);

  const handleSave = async (): Promise<void> => {
    try {
      await window.api.settings.setProxyConfig({
        httpsProxy: proxyMode === "custom" ? httpsProxy : "",
        httpProxy: proxyMode === "custom" ? httpProxy : "",
        allProxy: proxyMode === "custom" ? allProxy : "",
        proxyMode,
      });
      toast.success(t("proxyConfig.savedAndActive"));
    } catch {
      toast.error(t("proxyConfig.saveFailed"));
    }
  };

  const handleReset = (): void => {
    setProxyMode("system");
    setHttpsProxy("");
    setHttpProxy("");
    setAllProxy("");
  };

  if (!initialized) return <></>;

  return (
    <div className="space-y-6">
      <SettingsSection title={t("proxyConfig.title")} description={t("proxyConfig.description")}>
        <SettingsCard divided={false}>
          <div className="px-4 pt-4 pb-1">
            <SettingsSegmentedControl
              value={proxyMode}
              onValueChange={(v) => setProxyMode(v as ProxyMode)}
              options={[
                { value: "system", label: t("proxyConfig.system") },
                { value: "custom", label: t("proxyConfig.custom") },
              ]}
            />
          </div>

          {proxyMode === "system" ? (
            <div className="px-4 pb-4">
              <p className="text-xs text-muted-foreground leading-relaxed">{t("proxyConfig.systemDesc")}</p>
            </div>
          ) : (
            <div className="space-y-1 px-4 pb-4">
              <SettingsInput
                label={t("proxyConfig.httpsProxy")}
                value={httpsProxy}
                onChange={(e) => setHttpsProxy(e.target.value)}
                placeholder={t("proxyConfig.httpsProxyPlaceholder")}
              />
              <SettingsInput
                label={t("proxyConfig.httpProxy")}
                value={httpProxy}
                onChange={(e) => setHttpProxy(e.target.value)}
                placeholder={t("proxyConfig.httpProxyPlaceholder")}
              />
              <SettingsInput
                label={t("proxyConfig.allProxy")}
                value={allProxy}
                onChange={(e) => setAllProxy(e.target.value)}
                placeholder={t("proxyConfig.allProxyPlaceholder")}
              />
            </div>
          )}
        </SettingsCard>
      </SettingsSection>

      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={handleReset}>
          <RotateCcw className="h-3.5 w-3.5 mr-1" />
          {t("proxyConfig.clear")}
        </Button>
        <Button size="sm" onClick={() => void handleSave()}>
          <Save className="h-3.5 w-3.5 mr-1" />
          {t("common:save")}
        </Button>
      </div>
    </div>
  );
}