import { useState } from "react";
import { Boxes, Cable, Sparkles, Wrench } from "lucide-react";
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
  threadId: string;
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
    <div className="app-flat-surface flex flex-col gap-4 rounded-[24px] px-5 py-5">
      <div className="flex items-start gap-3">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl border border-border/70 bg-background/70 text-primary shadow-[inset_0_1px_0_color-mix(in_srgb,#fff_10%,transparent)]">
          <Icon className="size-5" />
        </div>
        <div className="min-w-0">
          <div className="text-section-header">{eyebrow}</div>
          <div className="mt-1 text-base font-semibold tracking-[-0.02em] text-foreground">
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
        className="h-10 justify-between rounded-2xl px-4 text-sm"
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
  threadId,
}: SettingsHubDialogProps): React.JSX.Element {
  const [openAICompatibleOpen, setOpenAICompatibleOpen] = useState(false);
  const [skillsOpen, setSkillsOpen] = useState(false);
  const [mcpOpen, setMcpOpen] = useState(false);
  const { loadModels, loadProviders } = useAppStore();

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>设置</DialogTitle>
            <DialogDescription>
              将模型接入、技能目录与 MCP 工具配置集中到一个入口，避免在多个面板间来回切换。
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 md:grid-cols-3">
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
              description="维护全局技能源以及当前工作区中的 .deepagents/skills 目录，统一处理导入、新建和编辑。"
              actionLabel="打开技能配置"
              onAction={() => setSkillsOpen(true)}
            />
            <SettingsCard
              icon={Cable}
              eyebrow="MCP"
              title="MCP 配置"
              description="管理 MCP Server 列表，并为当前会话选择需要装配的工具能力。"
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
        threadId={threadId}
      />

      <MCPConfigDialog
        open={mcpOpen}
        onOpenChange={setMcpOpen}
        threadId={threadId}
      />
    </>
  );
}