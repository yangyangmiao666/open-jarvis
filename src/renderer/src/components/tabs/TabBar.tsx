import { Bot, X, FileCode, FileText, FileJson, File } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/lib/store";
import { useThreadState, type OpenFile } from "@/lib/thread-context";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

interface TabBarProps {
  className?: string;
  threadId?: string;
}

export function TabBar({
  className,
  threadId: propThreadId,
}: TabBarProps): React.JSX.Element | null {
  const { currentThreadId } = useAppStore();
  const threadId = propThreadId ?? currentThreadId;
  const threadState = useThreadState(threadId);

  if (!threadState) {
    return null;
  }

  const {
    openFiles,
    activeTab,
    setActiveTab,
    closeFile,
    closeOtherFiles,
    closeAllFiles,
  } = threadState;

  return (
    <div
      className={cn(
        "app-tabstrip overflow-x-auto scrollbar-hide",
        className,
      )}
    >
      {/* Agent Tab - Always first and prominent */}
      <button
        onClick={() => setActiveTab("agent")}
        className={cn(
          "app-tab font-medium",
          activeTab === "agent"
            ? "app-tab-active"
            : "",
        )}
      >
        <Bot className={cn("size-4", activeTab === "agent" ? "text-primary" : "text-muted-foreground")} />
        <span>智能体</span>
      </button>

      {/* File Tabs */}
      {openFiles.map((file) => (
        <FileTab
          key={file.path}
          file={file}
          isActive={activeTab === file.path}
          onSelect={() => setActiveTab(file.path)}
          onClose={() => closeFile(file.path)}
          onCloseOthers={() => closeOtherFiles(file.path)}
          onCloseAll={() => closeAllFiles()}
        />
      ))}

      {/* Spacer to fill remaining space */}
      <div className="flex-1 min-w-0" />
    </div>
  );
}

interface FileTabProps {
  file: OpenFile;
  isActive: boolean;
  onSelect: () => void;
  onClose: () => void;
  onCloseOthers: () => void;
  onCloseAll: () => void;
}

function FileTab({
  file,
  isActive,
  onSelect,
  onClose,
  onCloseOthers,
  onCloseAll,
}: FileTabProps): React.JSX.Element {
  const handleClose = (e: React.MouseEvent): void => {
    e.stopPropagation();
    onClose();
  };

  const handleMouseDown = (e: React.MouseEvent): void => {
    // Middle click to close
    if (e.button === 1) {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <button
          onClick={onSelect}
          onMouseDown={handleMouseDown}
          className={cn(
            "app-tab group",
            isActive
              ? "app-tab-active"
              : "",
          )}
          title={file.path}
        >
          <FileIcon name={file.name} />
          <span className="truncate">{file.name}</span>
          <span
            role="button"
            tabIndex={0}
            onClick={handleClose}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                handleClose(e as unknown as React.MouseEvent);
              }
            }}
            className={cn(
              "app-tab-close flex size-5 items-center justify-center rounded-full transition-colors",
              isActive ? "opacity-100" : "opacity-0 group-hover:opacity-100",
            )}
          >
            <X className="size-3" />
          </span>
        </button>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-48">
        <ContextMenuItem onClick={onClose}>关闭</ContextMenuItem>
        <ContextMenuItem onClick={onCloseOthers}>关闭其他标签</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={onCloseAll}>全部关闭</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

function FileIcon({ name }: { name: string }): React.JSX.Element {
  const ext = name.includes(".") ? name.split(".").pop()?.toLowerCase() : "";

  switch (ext) {
    case "ts":
    case "tsx":
    case "js":
    case "jsx":
    case "py":
    case "css":
    case "scss":
    case "html":
      return <FileCode className="size-3.5 text-primary shrink-0" />;
    case "json":
      return <FileJson className="size-3.5 text-accent shrink-0" />;
    case "md":
    case "mdx":
    case "txt":
      return <FileText className="size-3.5 text-muted-foreground shrink-0" />;
    default:
      return <File className="size-3.5 text-muted-foreground shrink-0" />;
  }
}
