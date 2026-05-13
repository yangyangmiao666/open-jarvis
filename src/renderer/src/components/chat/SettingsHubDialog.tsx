import { useEffect, useState } from "react";
import { Boxes, Cable, Sparkles, Wrench, Orbit, Network } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useAppStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { OpenAICompatibleDialog } from "./OpenAICompatibleDialog";
import { MCPConfigDialog } from "./MCPConfigDialog";
import { SkillsDialog } from "../panels/SkillsDialog";
import { ProxyConfigDialog } from "./ProxyConfigDialog";
import type { SettingsOpenRequest } from "@/types";

interface SettingsHubDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  request?: SettingsOpenRequest | null;
}

interface SettingsCardProps {
  icon: React.ElementType;
  eyebrow: string;
  title: string;
  description: string;
  actionLabel: string;
  onAction: () => void;
  accent?: "blue" | "green" | "amber" | "purple";
}

const ACCENT_MAP: Record<string, string> = {
  blue: "icon-blue",
  green: "icon-green",
  amber: "icon-amber",
  purple: "icon-purple",
};

function SettingsCard({
  icon: Icon,
  eyebrow,
  title,
  description,
  actionLabel,
  onAction,
  accent,
}: SettingsCardProps): React.JSX.Element {
  return (
    <div className="app-premium-surface group flex h-full flex-col gap-4 overflow-visible rounded-[28px] px-5 py-5 transition-all duration-200 hover:-translate-y-1 hover:shadow-[inset_0_0_0_1px_color-mix(in_srgb,#fff_8%,transparent),0_16px_34px_color-mix(in_srgb,#000_12%,transparent)]">
      <div className="flex items-center gap-3">
        <div className={cn("app-premium-pill flex size-10 shrink-0 items-center justify-center rounded-[16px] transition-transform duration-200 group-hover:scale-[1.03]", accent ? ACCENT_MAP[accent] : "text-primary")}>
          <Icon className="size-4.5" />
        </div>
        <div className="min-w-0">
          <div className="text-section-header">{eyebrow}</div>
          <div className="mt-0.5 text-base font-semibold tracking-[-0.03em] text-foreground">{title}</div>
        </div>
      </div>
      <p className="text-xs leading-5 text-muted-foreground">{description}</p>
      <Button
        type="button"
        variant="outline"
        className="mt-auto h-11 w-full justify-between rounded-2xl px-4 text-sm"
        onClick={onAction}
      >
        <span>{actionLabel}</span>
        <Sparkles className="size-4" />
      </Button>
    </div>
  );
}

export function SettingsHubDialog({
  open,
  onOpenChange,
  request,
}: SettingsHubDialogProps): React.JSX.Element {
  const [openAICompatibleOpen, setOpenAICompatibleOpen] = useState(false);
  const [skillsOpen, setSkillsOpen] = useState(false);
  const [mcpOpen, setMcpOpen] = useState(false);
  const [proxyOpen, setProxyOpen] = useState(false);
  const { loadModels, loadProviders } = useAppStore();

  useEffect(() => {
    if (!open || request?.panel !== "models") {
      return;
    }

    setOpenAICompatibleOpen(true);
  }, [open, request]);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex max-h-[min(92vh,52rem)] w-[min(96vw,72rem)] max-w-5xl flex-col p-0">
          <DialogHeader className="app-premium-surface relative overflow-hidden rounded-[28px] px-6 py-4 pr-14 sm:px-7">
            <div className="flex items-center gap-3">
              <div className="app-premium-pill inline-flex shrink-0 items-center gap-2 rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">
                <Orbit className="size-3.5" />
                Control Center
              </div>
              <DialogTitle className="text-xl tracking-[-0.03em]">
                设置中枢
              </DialogTitle>
            </div>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 sm:px-7 sm:pb-7">
            <div className="grid items-stretch gap-4 bg-[linear-gradient(180deg,transparent,color-mix(in_srgb,var(--background-elevated)_18%,transparent))] md:grid-cols-2 xl:grid-cols-4 py-2">
              <SettingsCard
                icon={Boxes}
                eyebrow="Models"
                title="自定义模型配置"
                description="管理 OpenAI 兼容接口、私有网关和本地部署模型，保存后模型列表会自动刷新。"
                actionLabel="打开模型配置"
                onAction={() => setOpenAICompatibleOpen(true)}
                accent="blue"
              />
              <SettingsCard
                icon={Network}
                eyebrow="Proxy"
                title="代理配置"
                description="配置 HTTP、HTTPS 或 SOCKS 代理。保存后会立即更新主进程网络请求，不再依赖手改 .env。"
                actionLabel="打开代理配置"
                onAction={() => setProxyOpen(true)}
                accent="amber"
              />
              <SettingsCard
                icon={Wrench}
                eyebrow="Skills"
                title="技能配置"
                description="维护全局技能目录，统一处理导入、新建和编辑。固定目录为 ~/.open-jarvis/skills。"
                actionLabel="打开技能配置"
                onAction={() => setSkillsOpen(true)}
                accent="green"
              />
              <SettingsCard
                icon={Cable}
                eyebrow="MCP"
                title="MCP 配置"
                description="管理 MCP Server 列表，并配置所有会话默认启用的工具能力。"
                actionLabel="打开 MCP 配置"
                onAction={() => setMcpOpen(true)}
                accent="purple"
              />
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <OpenAICompatibleDialog
        open={openAICompatibleOpen}
        onOpenChange={setOpenAICompatibleOpen}
        initialProfileId={request?.panel === "models" ? request.profileId : null}
        onSaved={() => {
          void loadProviders();
          void loadModels();
        }}
      />

      <SkillsDialog
        open={skillsOpen}
        onOpenChange={setSkillsOpen}
      />

      <ProxyConfigDialog open={proxyOpen} onOpenChange={setProxyOpen} />

      <MCPConfigDialog
        open={mcpOpen}
        onOpenChange={setMcpOpen}
      />
    </>
  );
}
