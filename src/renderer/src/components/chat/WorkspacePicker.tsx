import { selectWorkspaceFolder } from "@/lib/workspace-utils";
import { Check, ChevronDown, Folder } from "lucide-react";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useCurrentThread } from "@/lib/thread-context";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";

interface WorkspacePickerProps {
  threadId: string;
}

export function WorkspacePicker({
  threadId,
}: WorkspacePickerProps): React.JSX.Element {
  const { workspacePath, setWorkspacePath, setWorkspaceFiles } =
    useCurrentThread(threadId);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const { t } = useTranslation('chat');

  // Load workspace path and files for current thread
  useEffect(() => {
    async function loadWorkspace(): Promise<void> {
      if (threadId) {
        const path = await window.api.workspace.get(threadId);
        setWorkspacePath(path);

        // If a folder is linked, load files from disk
        if (path) {
          const result = await window.api.workspace.loadFromDisk(threadId);
          if (result.success && result.files) {
            setWorkspaceFiles(result.files);
          }
        }
      }
    }
    loadWorkspace();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId]);

  async function handleSelectFolder(): Promise<void> {
    await selectWorkspaceFolder(
      threadId,
      setWorkspacePath,
      setWorkspaceFiles,
      setLoading,
      setOpen,
    );
  }

  const folderName = workspacePath?.split("/").pop();

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            "h-8 gap-1.5 rounded-full px-3 text-xs hover:translate-y-0",
            workspacePath ? "text-foreground" : "text-amber-500",
          )}
          disabled={!threadId}
        >
          <Folder className="size-3.5" />
          <span className="max-w-[120px] truncate">
            {workspacePath ? folderName : t('workspacePicker.selectWorkspace')}
          </span>
          <ChevronDown className="size-3 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 rounded-[24px] p-4 shadow-none" align="start">
        <div className="space-y-3">
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            {t('workspacePicker.workspaceFolder')}
          </div>

          {workspacePath ? (
            <div className="space-y-2">
              <div className="app-premium-surface flex items-center gap-2 rounded-2xl px-3 py-3">
                <Check className="size-3.5 text-status-nominal shrink-0" />
                <span className="text-sm truncate flex-1" title={workspacePath}>
                  {folderName}
                </span>
              </div>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                {t('workspacePicker.agentReadWrite')}
              </p>
              <Button
                variant="outline"
                size="sm"
                className="h-9 w-full rounded-2xl text-xs"
                onClick={handleSelectFolder}
                disabled={loading}
              >
                {t('workspacePicker.changeFolder')}
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                {t('workspacePicker.selectFolderDesc')}
              </p>
              <Button
                variant="default"
                size="sm"
                className="h-9 w-full rounded-2xl text-xs"
                onClick={handleSelectFolder}
                disabled={loading}
              >
                <Folder className="size-3.5 mr-1.5" />
                {t('workspacePicker.selectFolder')}
              </Button>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
