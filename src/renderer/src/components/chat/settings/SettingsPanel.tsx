import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { X, Settings, Bot, Globe, Zap, Server, Info, BarChart3 } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { GeneralPanel } from "./GeneralPanel";
import { OpenAICompatiblePanel } from "./OpenAICompatiblePanel";
import { ProxyConfigPanel } from "./ProxyConfigPanel";
import { SkillsPanel } from "./SkillsPanel";
import { MCPConfigPanel } from "./MCPConfigPanel";
import { AboutPanel } from "./AboutPanel";
import { UsageLogsPanel } from "./UsageLogsPanel";
import type { SettingsOpenRequest } from "@/types";

type Tab = "general" | "models" | "proxy" | "skills" | "mcp" | "about" | "usage";

interface SettingsPanelProps {
  onClose: () => void;
  request?: SettingsOpenRequest | null;
}

const TABS: { id: Tab; icon: typeof Settings; labelKey: string }[] = [
  { id: "general", icon: Settings, labelKey: "settingsHub.tabGeneral" },
  { id: "models", icon: Bot, labelKey: "settingsHub.tabModels" },
  { id: "proxy", icon: Globe, labelKey: "settingsHub.tabProxy" },
  { id: "skills", icon: Zap, labelKey: "settingsHub.tabSkills" },
  { id: "mcp", icon: Server, labelKey: "settingsHub.tabMcp" },
  { id: "usage", icon: BarChart3, labelKey: "settingsHub.tabUsage" },
  { id: "about", icon: Info, labelKey: "settingsHub.tabAbout" },
];

export function SettingsPanel({ onClose, request }: SettingsPanelProps) {
  const { t } = useTranslation("settings");
  const [activeTab, setActiveTab] = useState<Tab>("general");
  const [profileId, setProfileId] = useState<string | undefined>();

  useEffect(() => {
    if (request?.panel) {
      setActiveTab(request.panel as Tab);
    }
    if (request?.profileId) {
      setProfileId(request.profileId);
    }
  }, [request]);

  const activeTabDef = TABS.find((t) => t.id === activeTab) || TABS[0];
  const ActiveIcon = activeTabDef.icon;

  const renderContent = () => {
    switch (activeTab) {
      case "general":
        return <GeneralPanel />;
      case "models":
        return <OpenAICompatiblePanel profileId={profileId} />;
      case "proxy":
        return <ProxyConfigPanel />;
      case "skills":
        return <SkillsPanel />;
      case "mcp":
        return <MCPConfigPanel />;
      case "about":
        return <AboutPanel />;
      case "usage":
        return <UsageLogsPanel />;
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Top header bar */}
      <div className="flex items-center h-12 px-4 border-b shrink-0">
        <div className="flex items-center gap-2">
          <ActiveIcon className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-semibold">
            {t(activeTabDef.labelKey)}
          </span>
        </div>
        <div className="flex-1" />
        <button
          onClick={onClose}
          className="inline-flex items-center justify-center rounded-md h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex flex-1 min-h-0">
        {/* Left sidebar */}
        <div className="w-[160px] border-r shrink-0 py-2 px-2">
          <nav className="flex flex-col gap-0.5">
            {TABS.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={
                    `flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ` +
                    (isActive
                      ? "bg-muted text-foreground font-medium"
                      : "text-muted-foreground hover:bg-muted/50 hover:text-foreground")
                  }
                >
                  <Icon className="h-4 w-4" />
                  {t(tab.labelKey)}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Right content */}
        <ScrollArea className="flex-1">
          <div className="px-6 py-4">{renderContent()}</div>
        </ScrollArea>
      </div>
    </div>
  );
}