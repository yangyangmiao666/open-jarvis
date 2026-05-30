import { FileText } from "lucide-react";
import { useTranslation } from "react-i18next";
import { getFileIcon } from "@/lib/file-types";
import { cn } from "@/lib/utils";
import type { MessageSkillRef } from "@/types";

interface MessageReferenceChipsProps {
  referencedPaths?: string[];
  selectedSkills?: MessageSkillRef[];
  onOpenFile?: (path: string, name: string) => void;
  onOpenSkill?: (skill: MessageSkillRef) => void;
  className?: string;
}

export function MessageReferenceChips({
  referencedPaths = [],
  selectedSkills = [],
  onOpenFile,
  onOpenSkill,
  className,
}: MessageReferenceChipsProps): React.JSX.Element | null {
  const { t } = useTranslation("chat");

  if (referencedPaths.length === 0 && selectedSkills.length === 0) {
    return null;
  }

  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {referencedPaths.map((path) => {
        const fileName = path.split(/[/\\]/).pop() || path;
        return (
          <button
            key={`file:${path}`}
            type="button"
            onClick={() => onOpenFile?.(path, fileName)}
            className="inline-flex max-w-full items-center gap-1 rounded-full border border-border bg-background/90 px-2.5 py-1 text-[11px] font-mono text-muted-foreground transition-colors hover:border-primary/30 hover:bg-background-interactive hover:text-foreground"
            title={t("referenceChips.openFile", { path })}
          >
            <span className="text-xs">{getFileIcon(fileName)}</span>
            <span className="truncate">{path}</span>
          </button>
        );
      })}
      {selectedSkills.map((skill) => (
        <button
          key={`skill:${skill.folderName}`}
          type="button"
          onClick={() => onOpenSkill?.(skill)}
          className="inline-flex max-w-full items-center gap-1 rounded-full border border-primary/20 bg-primary/10 px-2.5 py-1 text-[11px] text-primary transition-colors hover:bg-primary/14"
          title={skill.description || t("referenceChips.openSkill", { name: skill.folderName })}
        >
          <FileText className="size-3 shrink-0" />
          <span className="truncate">/{skill.folderName}</span>
        </button>
      ))}
    </div>
  );
}
