import { useState } from "react";
import { Boxes, Cable, Sparkles, Wrench, Orbit, Layers3 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useAppStore } from "@/lib/store";
import { OpenAICompatibleDialog } from "./OpenAICompatibleDialog";
import { MCPConfigDialog } from "./MCPConfigDialog";
import { SkillsDialog } from "../panels/SkillsDialog";

interface SettingsHubDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface SettingsCardProps {
  icon: React.ElementType;
  eyebrow: string;
  title: string;
  description: string;
  actionLabel: string;
  onAction: () => void;
}

function SettingsCard({
  icon: Icon,
  eyebrow,
  title,
  description,
  actionLabel,
  onAction,
}: SettingsCardProps): React.JSX.Element {
  return (
    <div className="app-flat-surface group flex h-full flex-col gap-5 rounded-[28px] border border-border/70 px-5 py-5 transition-all duration-200 hover:-translate-y-1 hover:border-primary/30 hover:bg-background/72 hover:shadow-[0_24px_54px_color-mix(in_srgb,var(--primary)_10%,transparent)]">
      <div className="flex min-h-[156px] items-start gap-3">
        <div className="flex size-12 shrink-0 items-center justify-center rounded-[18px] border border-border/70 bg-background/75 text-primary shadow-[0_14px_30px_color-mix(in_srgb,var(--primary)_8%,transparent),inset_0_1px_0_color-mix(in_srgb,#fff_12%,transparent)] transition-transform duration-200 group-hover:scale-[1.03]">
          <Icon className="size-5" />
        </div>
        <div className="flex min-h-[132px] min-w-0 flex-1 flex-col">
          <div className="text-section-header">{eyebrow}</div>
          <div className="mt-1 text-lg font-semibold tracking-[-0.03em] text-foreground">
            {title}
          </div>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {description}
          </p>
        </div>
      </div>
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
}: SettingsHubDialogProps): React.JSX.Element {
  const [openAICompatibleOpen, setOpenAICompatibleOpen] = useState(false);
  const [skillsOpen, setSkillsOpen] = useState(false);
  const [mcpOpen, setMcpOpen] = useState(false);
  const { loadModels, loadProviders } = useAppStore();

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-5xl overflow-hidden">
          <DialogHeader className="relative overflow-hidden rounded-[28px] border border-border/70 bg-[radial-gradient(circle_at_top_left,color-mix(in_srgb,var(--primary)_18%,transparent),transparent_44%),linear-gradient(180deg,color-mix(in_srgb,var(--card)_96%,transparent),color-mix(in_srgb,var(--background)_92%,transparent))] px-6 py-6 pr-14 sm:px-7">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">
                  <Orbit className="size-3.5" />
                  Control Center
                </div>
                <DialogTitle className="mt-4 text-[1.75rem] tracking-[-0.04em]">
                  设置中枢
                </DialogTitle>
                <DialogDescription className="mt-3 max-w-2xl text-sm leading-6">
                  将模型接入、技能目录与 MCP
                  工具配置收敛到一处，减少在不同面板之间来回切换的成本。
                </DialogDescription>
              </div>
              <div className="hidden shrink-0 items-center gap-2 rounded-[22px] border border-border/70 bg-background/55 px-4 py-3 text-xs text-muted-foreground backdrop-blur-sm md:flex">
                <Layers3 className="size-4 text-primary" />
                分区更清晰，操作更集中
              </div>
            </div>
          </DialogHeader>

          <div className="grid items-stretch gap-4 md:grid-cols-3">
            <SettingsCard
              icon={Boxes}
              eyebrow="Models"
              title="自定义模型配置"
              description="管理 OpenAI 兼容接口、私有网关和本地部署模型，保存后模型列表会自动刷新。"
              actionLabel="打开模型配置"
              onAction={() => setOpenAICompatibleOpen(true)}
            />
            <SettingsCard
              icon={Wrench}
              eyebrow="Skills"
              title="技能配置"
              description="维护全局技能源以及当前全局工作区中的 .deepagents/skills 目录，统一处理导入、新建和编辑。"
              actionLabel="打开技能配置"
              onAction={() => setSkillsOpen(true)}
            />
            <SettingsCard
              icon={Cable}
              eyebrow="MCP"
              title="MCP 配置"
              description="管理 MCP Server 列表，并配置所有会话默认启用的工具能力。"
              actionLabel="打开 MCP 配置"
              onAction={() => setMcpOpen(true)}
            />
          </div>
        </DialogContent>
      </Dialog>

      <OpenAICompatibleDialog
        open={openAICompatibleOpen}
        onOpenChange={setOpenAICompatibleOpen}
        onSaved={() => {
          void loadProviders();
          void loadModels();
        }}
      />

      <SkillsDialog
        open={skillsOpen}
        onOpenChange={setSkillsOpen}
      />

      <MCPConfigDialog
        open={mcpOpen}
        onOpenChange={setMcpOpen}
      />
    </>
  );
}
