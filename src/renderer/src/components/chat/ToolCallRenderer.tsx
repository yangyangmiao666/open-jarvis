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
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ToolCall, Todo } from "@/types";
import { ShikiCodePreview } from "./ShikiCodePreview";

interface ToolCallRendererProps {
  toolCall: ToolCall;
  result?: string | unknown;
  isError?: boolean;
  needsApproval?: boolean;
  /** 为 false 时仍显示「待审批」样式与预览，但不渲染内联按钮（由对话区底部固定栏操作） */
  showInlineApprovalActions?: boolean;
  onApprovalDecision?: (decision: "approve" | "reject" | "edit") => void;
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

const TOOL_LABELS: Record<string, string> = {
  read_file: "读取文件",
  write_file: "写入文件",
  edit_file: "编辑文件",
  ls: "列出目录",
  glob: "查找文件",
  grep: "搜索内容",
  execute: "执行命令",
  write_todos: "更新任务",
  task: "子智能体任务",
};

// Tools whose results are shown in the UI panels and don't need verbose display
const PANEL_SYNCED_TOOLS = new Set(["write_todos"]);

// Helper to get a clean file name from path
function getFileName(path: string): string {
  return path.split("/").pop() || path;
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
}: {
  files: string[] | Array<{ path: string; is_dir?: boolean }>;
  isGlob?: boolean;
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
          … 还有 {files.length - 15} 项
        </div>
      )}
    </div>
  );
}

// Render grep results nicely
function GrepResultsDisplay({
  matches,
}: {
  matches: Array<{ path: string; line?: number; text?: string }>;
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
                另有 {grouped[path].length - 3} 处匹配
              </div>
            )}
          </div>
        </div>
      ))}
      {hasMore && (
        <div className="text-xs text-muted-foreground">
          … 另有 {Object.keys(grouped).length - 5} 个文件含匹配
        </div>
      )}
    </div>
  );
}

// Render edit/write file summary
function FileEditSummary({
  args,
}: {
  args: Record<string, unknown>;
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
          <span className="font-mono bg-status-critical/10 px-1.5 py-0.5 rounded">
            − {oldStr.split("\n").length} 行
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-status-nominal">
          <span className="font-mono bg-status-nominal/10 px-1.5 py-0.5 rounded">
            + {newStr.split("\n").length} 行
          </span>
        </div>
      </div>
    );
  }

  if (content) {
    const lines = content.split("\n").length;
    return (
      <div className="text-xs text-muted-foreground">
        向 {getFileName(path)} 写入 {lines} 行
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
      <div className="font-mono bg-background rounded-sm p-2 flex items-center gap-2 min-w-0">
        <span className="text-status-info shrink-0">$</span>
        <span className="truncate">{command}</span>
      </div>
      {output && (
        <pre className="font-mono bg-background rounded-sm p-2 overflow-auto max-h-32 text-muted-foreground w-full whitespace-pre-wrap break-all">
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
}: ToolCallRendererProps): React.JSX.Element | null {
  // Defensive: ensure args is always an object
  const args = toolCall?.args || {};

  const [isExpanded, setIsExpanded] = useState(false);

  // Bail out if no toolCall
  if (!toolCall) {
    return null;
  }

  const Icon = TOOL_ICONS[toolCall.name] || Terminal;
  const label = TOOL_LABELS[toolCall.name] || toolCall.name;
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
        return <FileEditSummary args={args} />;
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
          <span className="break-words">
            {typeof result === "string" ? result : JSON.stringify(result)}
          </span>
        </div>
      );
    }

    switch (toolCall.name) {
      case "read_file": {
        const content =
          typeof result === "string" ? result : JSON.stringify(result);
        const lines = content.split("\n").length;
        const previewPath =
          ((args.path || args.file_path) as string | undefined) || "file.txt";
        return (
          <div className="space-y-2">
            <div className="text-xs text-status-nominal flex items-center gap-1.5">
              <CheckCircle2 className="size-3" />
              <span>已读 {lines} 行</span>
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
                  {files} 个文件
                  {dirs > 0 ? `，${dirs} 个文件夹` : ""}
                </span>
              </div>
              <FileListDisplay files={result} />
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
                <span>找到 {result.length} 项匹配</span>
              </div>
              <FileListDisplay files={result} isGlob />
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
                  {fileCount} 个文件中 {result.length} 处匹配
                </span>
              </div>
              <GrepResultsDisplay matches={result} />
            </div>
          );
        }
        return null;
      }

      case "execute": {
        // When expanded, output is shown in CommandDisplay - just show status
        // When collapsed, show the output preview
        const output =
          typeof result === "string" ? result : JSON.stringify(result);
        if (isExpanded) {
          return (
            <div className="text-xs text-status-nominal flex items-center gap-1.5">
              <CheckCircle2 className="size-3" />
              <span>命令已结束</span>
            </div>
          );
        }
        // Collapsed view - show output preview
        if (output.trim()) {
          return (
            <div className="space-y-2">
              <div className="text-xs text-status-nominal flex items-center gap-1.5">
                <CheckCircle2 className="size-3" />
                <span>命令已结束</span>
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
            <span>命令已结束（无输出）</span>
          </div>
        );
      }

      case "write_todos":
        // Already shown in Tasks panel
        return null;

      case "write_file":
      case "edit_file": {
        // Show confirmation message for file operations
        if (typeof result === "string" && result.trim()) {
          return (
            <div className="text-xs text-status-nominal flex items-center gap-1.5">
              <CheckCircle2 className="size-3" />
              <span>{result}</span>
            </div>
          );
        }
        return (
          <div className="text-xs text-status-nominal flex items-center gap-1.5">
            <CheckCircle2 className="size-3" />
            <span>文件已保存</span>
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
                <span>任务已完成</span>
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
            <span>任务已完成</span>
          </div>
        );
      }

      default: {
        // Generic success for unknown tools
        if (typeof result === "string" && result.trim()) {
          return (
            <div className="text-xs text-status-nominal flex items-center gap-1.5">
              <CheckCircle2 className="size-3" />
              <span className="truncate">
                {result.slice(0, 100)}
                {result.length > 100 ? "..." : ""}
              </span>
            </div>
          );
        }
        return (
          <div className="text-xs text-status-nominal flex items-center gap-1.5">
            <CheckCircle2 className="size-3" />
            <span>已完成</span>
          </div>
        );
      }
    }
  };

  const formattedContent = renderFormattedContent();
  const formattedResult = renderFormattedResult();
  const hasFormattedDisplay = formattedContent || formattedResult;

  const inlineApprovalButtons =
    Boolean(needsApproval && onApprovalDecision) && showInlineApprovalActions;

  return (
    <div
      className={cn(
        "rounded-sm border overflow-hidden",
        needsApproval
          ? "border-amber-500/50 bg-amber-500/5"
          : "border-border bg-background-elevated",
      )}
    >
      {/* Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex w-full items-center gap-2 px-3 py-2 hover:bg-background-interactive transition-colors"
      >
        {isExpanded ? (
          <ChevronDown className="size-4 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="size-4 text-muted-foreground shrink-0" />
        )}

        <Icon
          className={cn(
            "size-4 shrink-0",
            needsApproval ? "text-amber-500" : "text-status-info",
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
            待审批
          </Badge>
        )}

        {!needsApproval && result === undefined && (
          <Badge variant="outline" className="ml-auto shrink-0 animate-pulse">
            运行中
          </Badge>
        )}

        {result !== undefined && !needsApproval && (
          <Badge
            variant={isError ? "critical" : "nominal"}
            className="ml-auto shrink-0"
          >
            {isError ? "错误" : "成功"}
          </Badge>
        )}

        {isPanelSynced && !needsApproval && (
          <Badge variant="outline" className="shrink-0 text-[9px]">
            已同步
          </Badge>
        )}
      </button>

      {/* Approval UI */}
      {needsApproval ? (
        <div className="border-t border-amber-500/20 px-3 py-3 space-y-3">
          {/* Show formatted content (e.g., command preview) */}
          {formattedContent}

          {/* Arguments */}
          <div>
            <div className="text-section-header text-[10px] mb-1">参数</div>
            <pre className="text-xs font-mono bg-background p-2 rounded-sm overflow-auto max-h-24">
              {JSON.stringify(args, null, 2)}
            </pre>
          </div>

          {inlineApprovalButtons ? (
            <div className="flex items-center justify-end gap-2">
              <button
                className="px-3 py-1.5 text-xs border border-border rounded-sm hover:bg-background-interactive transition-colors"
                onClick={handleReject}
              >
                拒绝
              </button>
              <button
                className="px-3 py-1.5 text-xs bg-status-nominal text-background rounded-sm hover:bg-status-nominal/90 transition-colors"
                onClick={handleApprove}
              >
                批准并执行
              </button>
            </div>
          ) : (
            <p className="text-[11px] text-muted-foreground">
              请在对话区底部固定栏批准或拒绝。
            </p>
          )}
        </div>
      ) : null}

      {/* Formatted content (only visible when collapsed AND has result) */}
      {hasFormattedDisplay &&
        !isExpanded &&
        !needsApproval &&
        result !== undefined && (
          <div className="border-t border-border px-3 py-2 space-y-2 overflow-hidden">
            {formattedContent}
            {formattedResult}
          </div>
        )}

      {/* Expanded content - raw details */}
      {isExpanded && !needsApproval && (
        <div className="border-t border-border px-3 py-2 space-y-2 overflow-hidden">
          {/* Formatted display first */}
          {formattedContent}
          {formattedResult}

          {/* Raw Arguments */}
          <div className="overflow-hidden w-full">
            <div className="text-section-header mb-1">原始参数</div>
            <pre className="text-xs font-mono bg-background p-2 rounded-sm overflow-auto max-h-48 w-full whitespace-pre-wrap break-all">
              {JSON.stringify(args, null, 2)}
            </pre>
          </div>

          {/* Raw Result */}
          {result !== undefined && (
            <div className="overflow-hidden w-full">
              <div className="text-section-header mb-1">原始结果</div>
              <pre
                className={cn(
                  "text-xs font-mono p-2 rounded-sm overflow-auto max-h-48 w-full whitespace-pre-wrap break-all",
                  isError
                    ? "bg-status-critical/10 text-status-critical"
                    : "bg-background",
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
  );
}
