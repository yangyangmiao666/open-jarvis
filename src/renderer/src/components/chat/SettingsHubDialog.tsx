import { useState } from "react";
import { Boxes, Cable, Sparkles, Wrench, Orbit } from "lucide-react";
import {
  Dialog,
  DialogContent,
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
    <div className="app-flat-surface group flex h-full flex-col gap-4 rounded-[28px] border border-border/70 px-5 py-5 transition-all duration-200 hover:-translate-y-1 hover:border-primary/22 hover:bg-background/76 hover:shadow-[0_12px_28px_color-mix(in_srgb,var(--primary)_8%,transparent)]">
      <div className="flex items-center gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-[16px] border border-border/70 bg-background-elevated/80 text-primary shadow-[0_8px_20px_color-mix(in_srgb,var(--primary)_7%,transparent),inset_0_1px_0_color-mix(in_srgb,#fff_12%,transparent)] transition-transform duration-200 group-hover:scale-[1.03]">
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
}: SettingsHubDialogProps): React.JSX.Element {
  const [openAICompatibleOpen, setOpenAICompatibleOpen] = useState(false);
  const [skillsOpen, setSkillsOpen] = useState(false);
  const [mcpOpen, setMcpOpen] = useState(false);
  const { loadModels, loadProviders } = useAppStore();

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-5xl overflow-hidden">
          <DialogHeader className="relative overflow-hidden rounded-[28px] border border-border/70 bg-[radial-gradient(circle_at_top_left,color-mix(in_srgb,var(--primary)_14%,transparent),transparent_46%),linear-gradient(180deg,color-mix(in_srgb,var(--card)_98%,transparent),color-mix(in_srgb,var(--background)_94%,transparent))] px-6 py-4 pr-14 sm:px-7">
            <div className="flex items-center gap-3">
              <div className="inline-flex shrink-0 items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">
                <Orbit className="size-3.5" />
                Control Center
              </div>
              <DialogTitle className="text-xl tracking-[-0.03em]">
                设置中枢
              </DialogTitle>
            </div>
          </DialogHeader>

          <div className="grid items-stretch gap-4 bg-[linear-gradient(180deg,transparent,color-mix(in_srgb,var(--background-elevated)_38%,transparent))] md:grid-cols-3">
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
              description="维护全局技能源以及当前工作区中的 .deepagents/skills 目录，统一处理导入、新建和编辑。全局默认目录为 ~/.open-jarvis/skills。"
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
