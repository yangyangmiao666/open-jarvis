import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ExternalLink, Monitor, Globe, Cpu, Terminal, ChevronDown, ChevronUp } from "lucide-react";
import { SettingsSection, SettingsCard, SettingsRow } from "./primitives";

declare const __APP_VERSION__: string;
const APP_VERSION = __APP_VERSION__;
const GITHUB_URL = "https://github.com/yangyangmiao666/open-jarvis";

interface ToolingVersions {
  bun: string | null;
  uv: string | null;
  python: string | null;
}

function getPlatformLabel(platform: string, arch: string, t: (key: string, options?: Record<string, unknown>) => string): string {
  if (platform === "darwin") return arch === "arm64" ? t("about.macArm") : t("about.macIntel");
  if (platform === "win32") return t("about.windows", { arch });
  return t("about.linux", { arch });
}

export function AboutPanel(): React.JSX.Element {
  const { t } = useTranslation("settings");
  const [tooling, setTooling] = useState<ToolingVersions>({ bun: null, uv: null, python: null });
  const [uaExpanded, setUaExpanded] = useState(false);

  useEffect(() => {
    window.api.settings.getToolingVersions().then(setTooling).catch(() => {});
  }, []);

  const platformLabel = getPlatformLabel(window.electron.process.platform, window.electron.process.arch, t);

  const ua = navigator.userAgent;
  const uaShort = ua.length > 60 ? ua.slice(0, 60) + "…" : ua;

  return (
    <div className="space-y-8">
      <SettingsSection title={t("about.title")} description={t("about.description")}>
        <SettingsCard>
          <SettingsRow label={t("about.version")}>
            <span className="text-sm text-muted-foreground font-mono">{APP_VERSION}</span>
          </SettingsRow>
          <SettingsRow label={t("about.runtime")}>
            <span className="text-sm text-muted-foreground">Electron + React</span>
          </SettingsRow>
          <SettingsRow label={t("about.license")} description={t("about.licenseDesc")}>
            <span className="text-sm text-muted-foreground">Apache 2.0</span>
          </SettingsRow>
          <SettingsRow label={t("about.projectUrl")}>
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-primary hover:underline inline-flex items-center gap-1.5"
            >
              github.com/yangyangmiao666/open-jarvis
              <ExternalLink className="h-3 w-3" />
            </a>
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title={t("about.tooling")} description={t("about.toolingDesc")}>
        <SettingsCard>
          <SettingsRow
            label="bun"
            icon={<Terminal className="h-4 w-4 text-muted-foreground" />}
          >
            <span className="text-sm text-muted-foreground font-mono">{tooling.bun ?? "—"}</span>
          </SettingsRow>
          <SettingsRow
            label="uv"
            icon={<Terminal className="h-4 w-4 text-muted-foreground" />}
          >
            <span className="text-sm text-muted-foreground font-mono">{tooling.uv ?? "—"}</span>
          </SettingsRow>
          <SettingsRow
            label="Python"
            icon={<Terminal className="h-4 w-4 text-muted-foreground" />}
          >
            <span className="text-sm text-muted-foreground font-mono">{tooling.python ?? "—"}</span>
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title={t("about.environment")} description={t("about.environmentDesc")}>
        <SettingsCard>
          <SettingsRow
            label={t("about.platform")}
            icon={<Monitor className="h-4 w-4 text-muted-foreground" />}
          >
            <span className="text-sm text-muted-foreground">{platformLabel}</span>
          </SettingsRow>
          <SettingsRow
            label={t("about.language")}
            icon={<Globe className="h-4 w-4 text-muted-foreground" />}
          >
            <span className="text-sm text-muted-foreground">{navigator.language}</span>
          </SettingsRow>
          <SettingsRow
            label={t("about.userAgent")}
            icon={<Cpu className="h-4 w-4 text-muted-foreground" />}
          >
            <div className="flex items-center gap-1.5 max-w-[280px]">
              <span
                className="text-xs text-muted-foreground font-mono leading-relaxed"
                title={ua}
              >
                {uaExpanded ? ua : uaShort}
              </span>
              {ua.length > 60 && (
                <button
                  type="button"
                  className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => setUaExpanded(!uaExpanded)}
                >
                  {uaExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                </button>
              )}
            </div>
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>
    </div>
  );
}
