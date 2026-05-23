import {
  FileText,
  FolderOpen,
  Search,
  Edit,
  Terminal,
  ListTodo,
  GitBranch,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  Circle,
  Clock,
  XCircle,
  File,
  Folder,
} from "lucide-react";
import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ToolCall, Todo } from "@/types";
import { getFileType } from "@/lib/file-types";
import { ShikiCodePreview } from "./ShikiCodePreview";
import { InlineMediaPreview } from "./InlineMediaPreview";

interface ToolCallRendererProps {
  toolCall: ToolCall;
  result?: string | unknown;
  isError?: boolean;
  needsApproval?: boolean;
  /** 为 false 时仍显示「待审批」样式与预览，但不渲染内联按钮（由对话区底部固定栏操作） */
  showInlineApprovalActions?: boolean;
  onApprovalDecision?: (
    decision: "approve" | "reject" | "edit",
    options?: { rememberForWorkspace?: boolean },
  ) => void;
  threadId: string;
  onOpenFile?: (path: string, name: string) => void;
}

const TOOL_ICONS: Record<
  string,
  React.ComponentType<{ className?: string }>
> = {
  read_file: FileText,
  write_file: Edit,
  edit_file: Edit,
  ls: FolderOpen,
  glob: FolderOpen,
  grep: Search,
  execute: Terminal,
  write_todos: ListTodo,
  task: GitBranch,
};

// Tool label keys for i18n lookup
const TOOL_LABEL_KEYS: Record<string, string> = {
  read_file: "readFile",
  write_file: "writeFile",
  edit_file: "editFile",
  ls: "ls",
  glob: "glob",
  grep: "grep",
  execute: "execute",
  write_todos: "writeTodos",
  task: "task",
};

// Tools whose results are shown in the UI panels and don't need verbose display
const PANEL_SYNCED_TOOLS = new Set(["write_todos"]);

// Helper to get a clean file name from path
function getFileName(path: string): string {
  return path.split(/[/\\]/).pop() || path;
}

function toDisplayText(value: unknown): string {
  if (typeof value === "string") {
    return value.replace(/\r\n/g, "\n");
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

// Render todos nicely
function TodosDisplay({ todos }: { todos: Todo[] }): React.JSX.Element {
  const statusConfig: Record<string, { icon: typeof Circle; color: string }> = {
    pending: { icon: Circle, color: "text-muted-foreground" },
    in_progress: { icon: Clock, color: "text-status-info" },
    completed: { icon: CheckCircle2, color: "text-status-nominal" },
    cancelled: { icon: XCircle, color: "text-muted-foreground" },
  };

  const defaultConfig = { icon: Circle, color: "text-muted-foreground" };

  return (
    <div className="space-y-1">
      {todos.map((todo, i) => {
        const config = statusConfig[todo.status] || defaultConfig;
        const Icon = config.icon;
        const isDone =
          todo.status === "completed" || todo.status === "cancelled";
        return (
          <div
            key={todo.id || i}
            className={cn(
              "flex items-start gap-2 text-xs",
              isDone && "opacity-50",
            )}
          >
            <Icon className={cn("size-3.5 mt-0.5 shrink-0", config.color)} />
            <span className={cn(isDone && "line-through")}>{todo.content}</span>
          </div>
        );
      })}
    </div>
  );
}

// Render file list nicely
function FileListDisplay({
  files,
  isGlob,
  t,
}: {
  files: string[] | Array<{ path: string; is_dir?: boolean }>;
  isGlob?: boolean;
  t: (key: string, options?: Record<string, unknown>) => string;
}): React.JSX.Element {
  const items = files.slice(0, 15); // Limit display
  const hasMore = files.length > 15;

  return (
    <div className="space-y-0.5">
      {items.map((file, i) => {
        const path = typeof file === "string" ? file : file.path;
        const isDir = typeof file === "object" && file.is_dir;
        return (
          <div key={i} className="flex items-center gap-2 text-xs font-mono">
            {isDir ? (
              <Folder className="size-3 text-status-warning shrink-0" />
            ) : (
              <File className="size-3 text-muted-foreground shrink-0" />
            )}
            <span className="truncate">
              {isGlob ? path : getFileName(path)}
            </span>
          </div>
        );
      })}
      {hasMore && (
        <div className="text-xs text-muted-foreground mt-1">
          … {t('fileList.moreItems', { count: files.length - 15 })}
        </div>
      )}
    </div>
  );
}

// Render grep results nicely
function GrepResultsDisplay({
  matches,
  t,
}: {
  matches: Array<{ path: string; line?: number; text?: string }>;
  t: (key: string, options?: Record<string, unknown>) => string;
}): React.JSX.Element {
  const grouped = matches.reduce(
    (acc, match) => {
      if (!acc[match.path]) acc[match.path] = [];
      acc[match.path].push(match);
      return acc;
    },
    {} as Record<string, typeof matches>,
  );

  const files = Object.keys(grouped).slice(0, 5);
  const hasMore = Object.keys(grouped).length > 5;

  return (
    <div className="space-y-2">
      {files.map((path) => (
        <div key={path} className="text-xs">
          <div className="flex items-center gap-1.5 font-medium text-status-info mb-1">
            <FileText className="size-3" />
            {getFileName(path)}
          </div>
          <div className="space-y-0.5 pl-4 border-l border-border/50">
            {grouped[path].slice(0, 3).map((match, i) => (
              <div key={i} className="font-mono text-muted-foreground truncate">
                {match.line && (
                  <span className="text-status-warning mr-2">
                    {match.line}:
                  </span>
                )}
                {match.text?.trim()}
              </div>
            ))}
            {grouped[path].length > 3 && (
              <div className="text-muted-foreground">
                {t('grep.moreMatches', { count: grouped[path].length - 3 })}
              </div>
            )}
          </div>
        </div>
      ))}
      {hasMore && (
        <div className="text-xs text-muted-foreground">
          … {t('grep.moreFiles', { count: Object.keys(grouped).length - 5 })}
        </div>
      )}
    </div>
  );
}

// Render edit/write file summary
function FileEditSummary({
  args,
  t,
}: {
  args: Record<string, unknown>;
  t: (key: string, options?: Record<string, unknown>) => string;
}): React.JSX.Element | null {
  const path = (args.path || args.file_path) as string;
  const content = args.content as string | undefined;
  const oldStr = args.old_str as string | undefined;
  const newStr = args.new_str as string | undefined;

  if (oldStr !== undefined && newStr !== undefined) {
    // Edit operation
    return (
      <div className="text-xs space-y-2">
        <div className="flex items-center gap-1.5 text-status-critical">
          <span className="rounded-full border border-status-critical/20 bg-status-critical/10 px-1.5 py-0.5 font-mono">
            {t('fileEdit.removeLines', { count: oldStr.split("\n").length })}
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-status-nominal">
          <span className="rounded-full border border-status-nominal/20 bg-status-nominal/10 px-1.5 py-0.5 font-mono">
            {t('fileEdit.addLines', { count: newStr.split("\n").length })}
          </span>
        </div>
      </div>
    );
  }

  if (content) {
    const lines = content.split("\n").length;
    return (
      <div className="text-xs text-muted-foreground">
        {t('fileEdit.writeLines', { name: getFileName(path), count: lines })}
      </div>
    );
  }

  return null;
}

// Command display
function CommandDisplay({
  command,
  output,
}: {
  command: string;
  output?: string;
}): React.JSX.Element {
  return (
    <div className="text-xs space-y-2 w-full overflow-hidden">
      <div className="flex min-w-0 items-center gap-2 rounded-xl border border-border/70 bg-background-interactive/65 p-2 font-mono">
        <span className="text-status-info shrink-0">$</span>
        <span className="truncate">{command}</span>
      </div>
      {output && (
        <pre className="max-h-32 w-full overflow-auto rounded-xl border border-border/60 bg-background-interactive/55 p-2 font-mono whitespace-pre-wrap break-all text-muted-foreground">
          {output.slice(0, 500)}
          {output.length > 500 && "..."}
        </pre>
      )}
    </div>
  );
}

// Subagent task display
function TaskDisplay({
  args,
  isExpanded,
}: {
  args: Record<string, unknown>;
  isExpanded?: boolean;
}): React.JSX.Element {
  const name = args.name as string | undefined;
  const description = args.description as string | undefined;

  return (
    <div className="text-xs space-y-1">
      {name && (
        <div className="flex items-center gap-2">
          <GitBranch className="size-3 text-status-info" />
          <span className="font-medium truncate">{name}</span>
        </div>
      )}
      {description && (
        <p
          className={cn(
            "text-muted-foreground pl-5",
            !isExpanded && "line-clamp-2",
          )}
        >
          {description}
        </p>
      )}
    </div>
  );
}

export function ToolCallRenderer({
  toolCall,
  result,
  isError,
  needsApproval,
  showInlineApprovalActions = true,
  onApprovalDecision,
  threadId,
  onOpenFile,
}: ToolCallRendererProps): React.JSX.Element | null {
  const { t } = useTranslation('chat');
  // Defensive: ensure args is always an object
  const args = toolCall?.args || {};

  const [isExpanded, setIsExpanded] = useState(false);

  const toolLabels = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(TOOL_LABEL_KEYS).map(([key, labelKey]) => [
          key,
          t(`toolLabels.${labelKey}`),
        ]),
      ),
    [t],
  );

  // Bail out if no toolCall
  if (!toolCall) {
    return null;
  }

  const Icon = TOOL_ICONS[toolCall.name] || Terminal;
  const label = toolLabels[toolCall.name] || toolCall.name;
  const isPanelSynced = PANEL_SYNCED_TOOLS.has(toolCall.name);

  const handleApprove = (e: React.MouseEvent): void => {
    e.stopPropagation();
    onApprovalDecision?.("approve");
  };

  const handleReject = (e: React.MouseEvent): void => {
    e.stopPropagation();
    onApprovalDecision?.("reject");
  };

  // Format the main argument for display
  const getDisplayArg = (): string | null => {
    if (!args) return null;
    if (args.path) return args.path as string;
    if (args.file_path) return args.file_path as string;
    if (args.command) return (args.command as string).slice(0, 50);
    if (args.pattern) return args.pattern as string;
    if (args.query) return args.query as string;
    if (args.glob) return args.glob as string;
    return null;
  };

  const displayArg = getDisplayArg();

  // Render formatted content based on tool type
  const renderFormattedContent = (): React.ReactNode => {
    if (!args) return null;

    switch (toolCall.name) {
      case "write_todos": {
        const todos = args.todos as Todo[] | undefined;
        if (todos && todos.length > 0) {
          return <TodosDisplay todos={todos} />;
        }
        return null;
      }

      case "task": {
        return <TaskDisplay args={args} isExpanded={isExpanded} />;
      }

      case "edit_file":
      case "write_file": {
        return <FileEditSummary args={args} t={t} />;
      }

      case "execute": {
        const command = args.command as string;
        const output = typeof result === "string" ? result : undefined;
        return (
          <CommandDisplay
            command={command}
            output={isExpanded ? output : undefined}
          />
        );
      }

      default:
        return null;
    }
  };

  // Render result based on tool type
  const renderFormattedResult = (): React.ReactNode => {
    if (result === undefined) return null;

    // Handle errors
    if (isError) {
      return (
        <div className="text-xs text-status-critical flex items-start gap-1.5">
          <XCircle className="size-3 mt-0.5 shrink-0" />
          <span className="wrap-break-word">
            {toDisplayText(result)}
          </span>
        </div>
      );
    }

    switch (toolCall.name) {
      case "read_file": {
        const previewPath =
          ((args.path || args.file_path) as string | undefined) || "file.txt";
        const fileName = getFileName(previewPath);
        const fileTypeInfo = getFileType(fileName);

        if (["image", "video", "audio"].includes(fileTypeInfo.type)) {
          return (
            <div className="space-y-2">
              <div className="text-xs text-status-nominal flex items-center gap-1.5">
                <CheckCircle2 className="size-3" />
                <span>{t('task.mediaRead')}</span>
              </div>
              <InlineMediaPreview
                threadId={threadId}
                filePath={previewPath}
                fileType={fileTypeInfo.type}
                mimeType={fileTypeInfo.mimeType}
                onClick={() => onOpenFile?.(previewPath, fileName)}
              />
            </div>
          );
        }

        const content = toDisplayText(result);
        const lines = content.split("\n").length;
        return (
          <div className="space-y-2">
            <div className="text-xs text-status-nominal flex items-center gap-1.5">
              <CheckCircle2 className="size-3" />
              <span>{t('toolResults.readLines', { count: lines })}</span>
            </div>
            <ShikiCodePreview
              content={content}
              filePath={previewPath}
              maxLines={10}
            />
          </div>
        );
      }

      case "ls": {
        if (Array.isArray(result)) {
          const dirs = result.filter(
            (f: { is_dir?: boolean } | string) =>
              typeof f === "object" && f.is_dir,
          ).length;
          const files = result.length - dirs;
          return (
            <div className="space-y-2">
              <div className="text-xs text-status-nominal flex items-center gap-1.5">
                <CheckCircle2 className="size-3" />
                <span>
                  {t('toolResults.fileCount', { count: files })}
                  {dirs > 0 ? `，${t('toolResults.folderCount', { count: dirs })}` : ""}
                </span>
              </div>
              <FileListDisplay files={result} t={t} />
            </div>
          );
        }
        return null;
      }

      case "glob": {
        if (Array.isArray(result)) {
          return (
            <div className="space-y-2">
              <div className="text-xs text-status-nominal flex items-center gap-1.5">
                <CheckCircle2 className="size-3" />
                <span>{t('toolResults.matchCount', { count: result.length })}</span>
              </div>
              <FileListDisplay files={result} t={t} />
            </div>
          );
        }
        return null;
      }

      case "grep": {
        if (Array.isArray(result)) {
          const fileCount = new Set(result.map((m: { path: string }) => m.path))
            .size;
          return (
            <div className="space-y-2">
              <div className="text-xs text-status-nominal flex items-center gap-1.5">
                <CheckCircle2 className="size-3" />
                <span>
                  {t('toolResults.filesWithMatches', { count: fileCount, matchCount: result.length })}
                </span>
              </div>
              <GrepResultsDisplay matches={result} t={t} />
            </div>
          );
        }
        return null;
      }

      case "execute": {
        // When expanded, output is shown in CommandDisplay - just show status
        // When collapsed, show the output preview
        const output = toDisplayText(result);
        if (isExpanded) {
          return (
            <div className="text-xs text-status-nominal flex items-center gap-1.5">
              <CheckCircle2 className="size-3" />
              <span>{t('command.ended')}</span>
            </div>
          );
        }
        // Collapsed view - show output preview
        if (output.trim()) {
          return (
            <div className="space-y-2">
              <div className="text-xs text-status-nominal flex items-center gap-1.5">
                <CheckCircle2 className="size-3" />
                <span>{t('command.ended')}</span>
              </div>
              <pre className="text-xs font-mono bg-background rounded-sm p-2 overflow-auto max-h-32 text-muted-foreground whitespace-pre-wrap break-all">
                {output.slice(0, 500)}
                {output.length > 500 && "..."}
              </pre>
            </div>
          );
        }
        return (
          <div className="text-xs text-status-nominal flex items-center gap-1.5">
            <CheckCircle2 className="size-3" />
            <span>{t('command.endedNoOutput')}</span>
          </div>
        );
      }

      case "write_todos":
        // Already shown in Tasks panel
        return null;

      case "write_file":
      case "edit_file": {
        const filePath = (args.path || args.file_path) as string;
        const fileName = getFileName(filePath);
        const fileTypeInfo = getFileType(fileName);
        const isMedia = ["image", "video", "audio", "pdf"].includes(fileTypeInfo.type);
        const resultText = typeof result === "string" && result.trim() ? result : t('task.fileSaved');

        return (
          <div className="space-y-2">
            <div className="text-xs text-status-nominal flex items-center gap-1.5">
              <CheckCircle2 className="size-3" />
              <span>{resultText}</span>
            </div>
            {isMedia && (
              <InlineMediaPreview
                threadId={threadId}
                filePath={filePath}
                fileType={fileTypeInfo.type}
                mimeType={fileTypeInfo.mimeType}
                onClick={() => onOpenFile?.(filePath, fileName)}
              />
            )}
          </div>
        );
      }

      case "task": {
        // Subagent task completion
        if (typeof result === "string" && result.trim()) {
          return (
            <div className="space-y-2">
              <div className="text-xs text-status-nominal flex items-center gap-1.5">
                <CheckCircle2 className="size-3" />
                <span>{t('task.completed')}</span>
              </div>
              <div className="text-xs text-muted-foreground pl-5 line-clamp-3">
                {result.slice(0, 500)}
                {result.length > 500 && "..."}
              </div>
            </div>
          );
        }
        return (
          <div className="text-xs text-status-nominal flex items-center gap-1.5">
            <CheckCircle2 className="size-3" />
            <span>{t('task.completed')}</span>
          </div>
        );
      }

      default: {
        // Generic success for unknown tools
        const text = toDisplayText(result).trim();
        if (text) {
          return (
            <div className="text-xs text-status-nominal flex items-center gap-1.5">
              <CheckCircle2 className="size-3" />
              <span className="truncate">
                {text.slice(0, 100)}
                {text.length > 100 ? "..." : ""}
              </span>
            </div>
          );
        }
        return (
          <div className="text-xs text-status-nominal flex items-center gap-1.5">
            <CheckCircle2 className="size-3" />
            <span>{t('toolStatus.completed')}</span>
          </div>
        );
      }
    }
  };

  const formattedContent = renderFormattedContent();
  const formattedResult = renderFormattedResult();

  const inlineApprovalButtons =
    Boolean(needsApproval && onApprovalDecision) && showInlineApprovalActions;

  return (
    <div
      className={cn(
        "relative isolate rounded-3xl",
      )}
    >
      <div
        className={cn(
          "relative overflow-hidden rounded-[20px] border",
          needsApproval
            ? "border-status-warning/50 bg-background-elevated"
            : "border-border bg-background-elevated",
        )}
      >

        {/* Header */}
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="relative flex w-full items-center gap-2 px-3 py-2.5 transition-colors hover:bg-background-interactive/62"
        >
          {isExpanded ? (
            <ChevronDown className="size-4 text-muted-foreground shrink-0" />
          ) : (
            <ChevronRight className="size-4 text-muted-foreground shrink-0" />
          )}

          <Icon
            className={cn(
              "size-4 shrink-0",
              needsApproval ? "text-status-warning" : "text-primary",
            )}
          />

          <span className="text-xs font-medium shrink-0">{label}</span>

          {displayArg && (
            <span className="flex-1 truncate text-left text-xs text-muted-foreground font-mono">
              {displayArg}
            </span>
          )}

          {needsApproval && (
            <Badge variant="warning" className="ml-auto shrink-0">
              {t('toolStatus.pendingApproval')}
            </Badge>
          )}

          {!needsApproval && result === undefined && (
            <Badge variant="outline" className="ml-auto shrink-0 animate-pulse">
              {t('toolStatus.running')}
            </Badge>
          )}

          {result !== undefined && !needsApproval && (
            <Badge
              variant={isError ? "critical" : "nominal"}
              className="ml-auto shrink-0"
            >
              {isError ? t('toolStatus.error') : t('toolStatus.success')}
            </Badge>
          )}

          {isPanelSynced && !needsApproval && (
            <Badge variant="outline" className="shrink-0 text-[9px]">
              {t('toolStatus.synced')}
            </Badge>
          )}
        </button>

        {/* Approval UI */}
        {needsApproval ? (
          <div className="space-y-3 border-t border-status-warning/20 px-3 py-3">
            {/* Show formatted content (e.g., command preview) */}
            {formattedContent}

            {/* Arguments */}
            <div>
              <div className="text-section-header text-[10px] mb-1">{t('parameters')}</div>
              <pre className="max-h-24 overflow-auto rounded-xl border border-border bg-background-interactive p-2 text-xs font-mono">
                {JSON.stringify(args, null, 2)}
              </pre>
            </div>

            {inlineApprovalButtons ? (
              <div className="flex items-center justify-end gap-2">
                <button
                  className="rounded-full border border-border bg-background-elevated px-3 py-1.5 text-xs text-foreground transition-all hover:bg-background-interactive"
                  onClick={handleReject}
                >
                  {t('approval.reject')}
                </button>
                <button
                  className="rounded-full border border-border bg-foreground px-3 py-1.5 text-xs text-background transition-all hover:bg-foreground/90"
                  onClick={handleApprove}
                >
                  {t('approval.approveAndExecute')}
                </button>
              </div>
            ) : (
              <p className="text-[11px] text-muted-foreground">
                {t('approval.approveInFooter')}
              </p>
            )}
          </div>
        ) : null}

        {/* Expanded content - raw details */}
        {isExpanded && !needsApproval && (
          <div className="space-y-2 overflow-hidden border-t border-border px-3 py-2">
            {/* Formatted display first */}
            {formattedContent}
            {formattedResult}

            {/* Raw Arguments */}
            <div className="overflow-hidden w-full">
              <div className="text-section-header mb-1">{t('rawParameters')}</div>
              <pre className="max-h-48 w-full overflow-auto rounded-xl border border-border bg-background-interactive p-2 text-xs font-mono whitespace-pre-wrap break-all">
                {JSON.stringify(args, null, 2)}
              </pre>
            </div>

            {/* Raw Result */}
            {result !== undefined && (
              <div className="overflow-hidden w-full">
                <div className="text-section-header mb-1">{t('rawResult')}</div>
                <pre
                  className={cn(
                    "max-h-48 w-full overflow-auto rounded-xl p-2 text-xs font-mono whitespace-pre-wrap break-all",
                    isError
                      ? "border border-status-critical/30 bg-status-critical/10 text-status-critical"
                      : "border border-border bg-background-interactive",
                  )}
                >
                  {typeof result === "string"
                    ? result
                    : JSON.stringify(result, null, 2)}
                </pre>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
