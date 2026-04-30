import {memo, useCallback, useEffect, useMemo, useRef, useState} from "react";
import {
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  Clock,
  Download,
  File,
  FileCode,
  FileJson,
  FileText,
  FileType,
  Folder,
  FolderOpen,
  FolderSync,
  FolderTree,
  GitBranch,
  GripHorizontal,
  Image,
  LayoutList,
  ListTodo,
  Loader2,
  XCircle,
} from "lucide-react";
import {cn} from "@/lib/utils";
import {useAppStore} from "@/lib/store";
import {useThreadState} from "@/lib/thread-context";
import {Badge} from "@/components/ui/badge";
import {Button} from "@/components/ui/button";
import type {Todo} from "@/types";
import {WorkspaceFileListTable} from "./WorkspaceFileListTable";
import {buildFileTree, type TreeNode, type WorkspaceFileInfo,} from "@/lib/workspace-file-tree";

const HEADER_HEIGHT = 40; // px
const HANDLE_HEIGHT = 6; // px
const MIN_CONTENT_HEIGHT = 60; // px
const COLLAPSE_THRESHOLD = 55; // px - auto-collapse when below this

interface SectionHeaderProps {
  title: string;
  icon: React.ElementType;
  badge?: number | string;
  isOpen: boolean;
  onToggle: () => void;
}

function SectionHeader({
  title,
  icon: Icon,
  badge,
  isOpen,
  onToggle,
}: SectionHeaderProps): React.JSX.Element {
  return (
    <button
      onClick={onToggle}
      className="group flex w-full shrink-0 items-center gap-2 rounded-xl px-3 py-2.5 text-section-header transition-colors hover:bg-background-interactive/78 hover:text-foreground"
      style={{ height: HEADER_HEIGHT }}
    >
      <ChevronRight
        className={cn(
          "size-3.5 text-muted-foreground transition-transform duration-200",
          isOpen && "rotate-90",
        )}
      />
      <Icon className="size-4 text-foreground/80" />
      <span className="flex-1 text-left">{title}</span>
      {badge !== undefined && badge !== 0 && badge !== "" && (
        <span className="rounded-full border border-border/70 bg-background/55 px-2 py-0.5 text-[10px] text-muted-foreground tabular-nums">
          {badge}
        </span>
      )}
    </button>
  );
}

interface ResizeHandleProps {
  onDrag: (delta: number) => void;
}

function ResizeHandle({ onDrag }: ResizeHandleProps): React.JSX.Element {
  const startYRef = useRef<number>(0);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      startYRef.current = e.clientY;

      const handleMouseMove = (e: MouseEvent): void => {
        // Calculate total delta from drag start
        const totalDelta = e.clientY - startYRef.current;
        onDrag(totalDelta);
      };

      const handleMouseUp = (): void => {
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "row-resize";
      document.body.style.userSelect = "none";
    },
    [onDrag],
  );

  return (
    <div
      onMouseDown={handleMouseDown}
      className="group relative flex shrink-0 cursor-row-resize select-none items-center justify-center bg-transparent"
      style={{ height: HANDLE_HEIGHT }}
    >
      <div className="pointer-events-none absolute inset-x-3 top-1/2 h-px -translate-y-1/2 rounded-full bg-border/65 opacity-0 transition-all duration-200 group-hover:inset-x-1.5 group-hover:bg-primary/65 group-hover:opacity-100 group-active:opacity-100 group-active:bg-primary" />
      <GripHorizontal className="pointer-events-none size-4 text-muted-foreground/45 opacity-0 transition-all duration-200 group-hover:opacity-100 group-active:opacity-100 group-active:text-primary" />
    </div>
  );
}

export function RightPanel(): React.JSX.Element {
  const { currentThreadId } = useAppStore();
  const threadState = useThreadState(currentThreadId);
  const todos = threadState?.todos ?? [];
  const workspaceFiles = threadState?.workspaceFiles ?? [];
  const subagents = threadState?.subagents ?? [];
  const containerRef = useRef<HTMLDivElement>(null);

  const [tasksOpen, setTasksOpen] = useState(true);
  const [filesOpen, setFilesOpen] = useState(true);
  const [agentsOpen, setAgentsOpen] = useState(true);

  // Store content heights in pixels (null = auto/equal distribution)
  const [tasksHeight, setTasksHeight] = useState<number | null>(null);
  const [filesHeight, setFilesHeight] = useState<number | null>(null);
  const [agentsHeight, setAgentsHeight] = useState<number | null>(null);

  // Track drag start heights
  const dragStartHeights = useRef<{
    tasks: number;
    files: number;
    agents: number;
  } | null>(null);

  // Calculate available content height
  const getAvailableContentHeight = useCallback(() => {
    if (!containerRef.current) return 0;
    const totalHeight = containerRef.current.clientHeight;

    // Subtract headers (always visible)
    let used = HEADER_HEIGHT * 3;

    // Subtract handles (only between open panels)
    if (tasksOpen && (filesOpen || agentsOpen)) used += HANDLE_HEIGHT;
    if (filesOpen && agentsOpen) used += HANDLE_HEIGHT;

    return Math.max(0, totalHeight - used);
  }, [tasksOpen, filesOpen, agentsOpen]);

  // Get current heights for each panel's content area
  const getContentHeights = useCallback(() => {
    const available = getAvailableContentHeight();
    const openCount = [tasksOpen, filesOpen, agentsOpen].filter(Boolean).length;

    if (openCount === 0) {
      return { tasks: 0, files: 0, agents: 0 };
    }

    const defaultHeight = available / openCount;

    return {
      tasks: tasksOpen ? (tasksHeight ?? defaultHeight) : 0,
      files: filesOpen ? (filesHeight ?? defaultHeight) : 0,
      agents: agentsOpen ? (agentsHeight ?? defaultHeight) : 0,
    };
  }, [
    getAvailableContentHeight,
    tasksOpen,
    filesOpen,
    agentsOpen,
    tasksHeight,
    filesHeight,
    agentsHeight,
  ]);

  // Handle resize between tasks and the next open section
  const handleTasksResize = useCallback(
    (totalDelta: number) => {
      if (!dragStartHeights.current) {
        const heights = getContentHeights();
        dragStartHeights.current = { ...heights };
      }

      const start = dragStartHeights.current;
      const available = getAvailableContentHeight();

      // Determine which panel is being resized against
      const otherStart = filesOpen ? start.files : start.agents;

      // Calculate new heights with proper clamping
      let newTasksHeight = start.tasks + totalDelta;
      let newOtherHeight = otherStart - totalDelta;

      // Clamp both to min height
      if (newTasksHeight < MIN_CONTENT_HEIGHT) {
        newTasksHeight = MIN_CONTENT_HEIGHT;
        newOtherHeight = otherStart + (start.tasks - MIN_CONTENT_HEIGHT);
      }
      if (newOtherHeight < MIN_CONTENT_HEIGHT) {
        newOtherHeight = MIN_CONTENT_HEIGHT;
        newTasksHeight = start.tasks + (otherStart - MIN_CONTENT_HEIGHT);
      }

      // Ensure total doesn't exceed available (accounting for third panel if open)
      const thirdPanelHeight =
        filesOpen && agentsOpen ? (agentsHeight ?? available / 3) : 0;
      const maxForTwo = available - thirdPanelHeight;
      if (newTasksHeight + newOtherHeight > maxForTwo) {
        const excess = newTasksHeight + newOtherHeight - maxForTwo;
        if (totalDelta > 0) {
          newOtherHeight = Math.max(
            MIN_CONTENT_HEIGHT,
            newOtherHeight - excess,
          );
        } else {
          newTasksHeight = Math.max(
            MIN_CONTENT_HEIGHT,
            newTasksHeight - excess,
          );
        }
      }

      setTasksHeight(newTasksHeight);
      if (filesOpen) {
        setFilesHeight(newOtherHeight);
      } else if (agentsOpen) {
        setAgentsHeight(newOtherHeight);
      }

      // Auto-collapse if below threshold
      if (newTasksHeight < COLLAPSE_THRESHOLD) {
        setTasksOpen(false);
      }
      if (newOtherHeight < COLLAPSE_THRESHOLD) {
        if (filesOpen) setFilesOpen(false);
        else if (agentsOpen) setAgentsOpen(false);
      }
    },
    [
      getContentHeights,
      getAvailableContentHeight,
      filesOpen,
      agentsOpen,
      agentsHeight,
    ],
  );

  // Handle resize between files and agents
  const handleFilesResize = useCallback(
    (totalDelta: number) => {
      if (!dragStartHeights.current) {
        const heights = getContentHeights();
        dragStartHeights.current = { ...heights };
      }

      const start = dragStartHeights.current;
      const available = getAvailableContentHeight();
      const tasksH = tasksOpen ? (tasksHeight ?? available / 3) : 0;
      const maxForFilesAndAgents = available - tasksH;

      // Calculate new heights with proper clamping
      let newFilesHeight = start.files + totalDelta;
      let newAgentsHeight = start.agents - totalDelta;

      // Clamp both to min height
      if (newFilesHeight < MIN_CONTENT_HEIGHT) {
        newFilesHeight = MIN_CONTENT_HEIGHT;
        newAgentsHeight = start.agents + (start.files - MIN_CONTENT_HEIGHT);
      }
      if (newAgentsHeight < MIN_CONTENT_HEIGHT) {
        newAgentsHeight = MIN_CONTENT_HEIGHT;
        newFilesHeight = start.files + (start.agents - MIN_CONTENT_HEIGHT);
      }

      // Ensure total doesn't exceed available
      if (newFilesHeight + newAgentsHeight > maxForFilesAndAgents) {
        const excess = newFilesHeight + newAgentsHeight - maxForFilesAndAgents;
        if (totalDelta > 0) {
          newAgentsHeight = Math.max(
            MIN_CONTENT_HEIGHT,
            newAgentsHeight - excess,
          );
        } else {
          newFilesHeight = Math.max(
            MIN_CONTENT_HEIGHT,
            newFilesHeight - excess,
          );
        }
      }

      setFilesHeight(newFilesHeight);
      setAgentsHeight(newAgentsHeight);

      // Auto-collapse if below threshold
      if (newFilesHeight < COLLAPSE_THRESHOLD) {
        setFilesOpen(false);
      }
      if (newAgentsHeight < COLLAPSE_THRESHOLD) {
        setAgentsOpen(false);
      }
    },
    [getContentHeights, getAvailableContentHeight, tasksOpen, tasksHeight],
  );

  // Reset drag start on mouse up
  useEffect(() => {
    const handleMouseUp = (): void => {
      dragStartHeights.current = null;
    };
    document.addEventListener("mouseup", handleMouseUp);
    return () => document.removeEventListener("mouseup", handleMouseUp);
  }, []);

  // Reset heights when panels open/close to redistribute
  useEffect(() => {
    setTasksHeight(null);
    setFilesHeight(null);
    setAgentsHeight(null);
  }, [tasksOpen, filesOpen, agentsOpen]);

  // Calculate heights in an effect (refs can't be accessed during render)
  const [heights, setHeights] = useState({ tasks: 0, files: 0, agents: 0 });
  useEffect(() => {
    setHeights(getContentHeights());
  }, [getContentHeights]);

  return (
    <aside
      ref={containerRef}
      className="flex h-full w-full flex-col overflow-hidden border-l border-border/60 bg-[linear-gradient(180deg,color-mix(in_srgb,var(--background-elevated)_94%,transparent),color-mix(in_srgb,var(--background)_88%,transparent))] backdrop-blur-md"
    >
      {/* TASKS */}
      <div className="flex shrink-0 flex-col border-b border-border/65 bg-[linear-gradient(180deg,color-mix(in_srgb,var(--background-elevated)_76%,transparent),transparent)]">
        <SectionHeader
          title="任务"
          icon={ListTodo}
          badge={todos.length}
          isOpen={tasksOpen}
          onToggle={() => setTasksOpen((prev) => !prev)}
        />
        {tasksOpen && (
          <div className="animate-soft-fade overflow-auto" style={{ height: heights.tasks }}>
            <TasksContent />
          </div>
        )}
      </div>

      {/* Resize handle after TASKS */}
      {tasksOpen && (filesOpen || agentsOpen) && (
        <ResizeHandle onDrag={handleTasksResize} />
      )}

      {/* FILES */}
      <div className="flex shrink-0 flex-col border-b border-border/65 bg-[linear-gradient(180deg,color-mix(in_srgb,var(--background-elevated)_68%,transparent),transparent)]">
        <SectionHeader
          title="文件"
          icon={FolderTree}
          badge={workspaceFiles.length > 0 ? `${workspaceFiles.length}个文件` : undefined}
          isOpen={filesOpen}
          onToggle={() => setFilesOpen((prev) => !prev)}
        />
        {filesOpen && (
          <div className="animate-soft-fade overflow-auto" style={{ height: heights.files }}>
            <FilesContent />
          </div>
        )}
      </div>

      {/* Resize handle after FILES */}
      {filesOpen && agentsOpen && <ResizeHandle onDrag={handleFilesResize} />}

      {/* AGENTS */}
      <div className="flex shrink-0 flex-col bg-[linear-gradient(180deg,color-mix(in_srgb,var(--background-elevated)_58%,transparent),transparent)]">
        <SectionHeader
          title="子智能体"
          icon={GitBranch}
          badge={subagents.length}
          isOpen={agentsOpen}
          onToggle={() => setAgentsOpen((prev) => !prev)}
        />
        {agentsOpen && (
          <div className="animate-soft-fade overflow-auto" style={{ height: heights.agents }}>
            <AgentsContent />
          </div>
        )}
      </div>
    </aside>
  );
}

// ============ Content Components ============

const STATUS_CONFIG = {
  pending: {
    icon: Circle,
    badge: "outline" as const,
    label: "待处理",
    color: "text-muted-foreground",
  },
  in_progress: {
    icon: Clock,
    badge: "info" as const,
    label: "进行中",
    color: "text-status-info",
  },
  completed: {
    icon: CheckCircle2,
    badge: "nominal" as const,
    label: "已完成",
    color: "text-status-nominal",
  },
  cancelled: {
    icon: XCircle,
    badge: "critical" as const,
    label: "已取消",
    color: "text-muted-foreground",
  },
};

function TasksContent(): React.JSX.Element {
  const { currentThreadId } = useAppStore();
  const threadState = useThreadState(currentThreadId);
  const todos = threadState?.todos ?? [];
  const [completedExpanded, setCompletedExpanded] = useState(false);

  if (todos.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center px-4 py-8 text-center text-sm text-muted-foreground">
        <ListTodo className="size-8 mb-2 opacity-50" />
        <span>暂无任务</span>
        <span className="text-xs mt-1">智能体创建任务后会显示在这里</span>
      </div>
    );
  }

  const inProgress = todos.filter((t) => t.status === "in_progress");
  const pending = todos.filter((t) => t.status === "pending");
  const completed = todos.filter((t) => t.status === "completed");
  const cancelled = todos.filter((t) => t.status === "cancelled");

  // Completed section includes both completed and cancelled
  const doneItems = [...completed, ...cancelled];

  const done = completed.length;
  const total = todos.length;
  const progress = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div>
      {/* Progress bar */}
      <div className="border-b border-border/50 p-3">
        <div className="flex items-center justify-between mb-1.5 text-xs">
          <span className="text-muted-foreground">进度</span>
          <span className="font-mono">
            {done}/{total}
          </span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-background-interactive/85">
          <div
            className="h-full bg-status-nominal transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Todo list */}
      <div className="space-y-2 p-3">
        {/* Completed/Cancelled Section (Collapsible) */}
        {doneItems.length > 0 && (
          <div className="mb-1">
            <button
              onClick={() => setCompletedExpanded(!completedExpanded)}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mb-2 w-full"
            >
              {completedExpanded ? (
                <ChevronDown className="size-3.5" />
              ) : (
                <ChevronRight className="size-3.5" />
              )}
              <span className="uppercase tracking-wider font-medium">
                已完成（{doneItems.length}）
              </span>
            </button>
            {completedExpanded && (
              <div className="space-y-2 pl-5 mb-3">
                {doneItems.map((todo) => (
                  <TaskItem key={todo.id} todo={todo} />
                ))}
              </div>
            )}
          </div>
        )}

        {/* In Progress Section */}
        {inProgress.map((todo) => (
          <TaskItem key={todo.id} todo={todo} />
        ))}

        {/* Pending Section */}
        {pending.map((todo) => (
          <TaskItem key={todo.id} todo={todo} />
        ))}
      </div>
    </div>
  );
}

function TaskItem({ todo }: { todo: Todo }): React.JSX.Element {
  const config = STATUS_CONFIG[todo.status];
  const Icon = config.icon;
  const isDone = todo.status === "completed" || todo.status === "cancelled";

  return (
    <div
      className={cn(
        "app-elevated-hover flex items-start gap-3 rounded-[1.15rem] border border-border/75 bg-[linear-gradient(180deg,color-mix(in_srgb,var(--card)_82%,transparent),color-mix(in_srgb,var(--background-elevated)_70%,transparent))] p-3",
        isDone && "opacity-50",
      )}
    >
      <Icon className={cn("size-3.5 shrink-0 mt-0.5", config.color)} />
      <span
        className={cn("flex-1 text-xs leading-snug", isDone && "line-through")}
      >
        {todo.content}
      </span>
      <Badge variant={config.badge} className="shrink-0 text-[10px]">
        {config.label}
      </Badge>
    </div>
  );
}

function FilesContent(): React.JSX.Element {
  const { currentThreadId } = useAppStore();
  const threadState = useThreadState(currentThreadId);
  const workspaceFiles = threadState?.workspaceFiles ?? [];
  const workspacePath = threadState?.workspacePath ?? null;
  const setWorkspacePath = threadState?.setWorkspacePath;
  const setWorkspaceFiles = threadState?.setWorkspaceFiles;
  const [syncing, setSyncing] = useState(false);
  const [syncSuccess] = useState(false);
  const [fileView, setFileView] = useState<"tree" | "list">(() => {
    if (typeof localStorage === "undefined") return "tree";
    return localStorage.getItem("openwork-file-view") === "list"
      ? "list"
      : "tree";
  });

  useEffect(() => {
    localStorage.setItem("openwork-file-view", fileView);
  }, [fileView]);

  // Load workspace path and files for current thread
  useEffect(() => {
    async function loadWorkspace(): Promise<void> {
      if (currentThreadId && setWorkspacePath && setWorkspaceFiles) {
        const path = await window.api.workspace.get(currentThreadId);
        setWorkspacePath(path);

        // If a folder is linked, load files from disk
        if (path) {
          const result =
            await window.api.workspace.loadFromDisk(currentThreadId);
          if (result.success && result.files) {
            setWorkspaceFiles(result.files);
          }
        }
      }
    }
    loadWorkspace();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentThreadId]);

  // Listen for file changes from the workspace watcher
  useEffect(() => {
    if (!currentThreadId || !setWorkspaceFiles) return;

    return window.api.workspace.onFilesChanged(async (data) => {
      // Only reload if the event is for the current thread
      if (data.threadId === currentThreadId) {
        console.log("[FilesContent] Files changed, reloading...", data);
        const result = await window.api.workspace.loadFromDisk(currentThreadId);
        if (result.success && result.files) {
          setWorkspaceFiles(result.files);
        }
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentThreadId]);

  // Handle selecting a workspace folder
  async function handleSelectFolder(): Promise<void> {
    if (!currentThreadId || !setWorkspacePath || !setWorkspaceFiles) return;
    setSyncing(true);
    try {
      const path = await window.api.workspace.select(currentThreadId);
      if (path) {
        setWorkspacePath(path);
        // Load files from the newly selected folder
        const result = await window.api.workspace.loadFromDisk(currentThreadId);
        if (result.success && result.files) {
          setWorkspaceFiles(result.files);
        }
      }
    } catch (e) {
      console.error("[FilesContent] Select folder error:", e);
    } finally {
      setSyncing(false);
    }
  }

  // Handle sync to disk
  // TODO: Implement syncToDisk API in main process
  async function handleSyncToDisk(): Promise<void> {
    if (!currentThreadId) return;

    // If no files, just select a folder
    if (workspaceFiles.length === 0) {
      await handleSelectFolder();
      return;
    }

    // syncToDisk is not yet implemented
    console.warn("[FilesContent] syncToDisk is not yet implemented");
  }

  async function handleOpenWorkspaceFolder(): Promise<void> {
    if (!workspacePath) return;

    try {
      const result = await window.api.workspace.openCurrentFolder(currentThreadId ?? undefined);
      if (!result.success) {
        console.error("[FilesContent] Open workspace folder error:", result.error);
      }
    } catch (e) {
      console.error("[FilesContent] Open workspace folder error:", e);
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header with sync button */}
      <div className="flex items-center justify-between gap-1 border-b border-border/50 bg-background/35 px-3 py-2 backdrop-blur-sm">
        <span
          className="text-[10px] text-muted-foreground truncate flex-1"
          title={workspacePath || undefined}
        >
          {workspacePath ? workspacePath.split("/").pop() : "未关联文件夹"}
        </span>
        {workspaceFiles.length > 0 && (
          <div className="flex shrink-0 overflow-hidden rounded-full border border-border bg-background/60">
            <button
              type="button"
              title="树形"
              className={cn(
                "px-2 py-1",
                fileView === "tree"
                  ? "bg-background-elevated text-foreground"
                  : "text-muted-foreground hover:bg-background-interactive/75",
              )}
              onClick={() => setFileView("tree")}
            >
              <FolderTree className="size-3" />
            </button>
            <button
              type="button"
              title="列表"
              className={cn(
                "border-l border-border px-2 py-1",
                fileView === "list"
                  ? "bg-background-elevated text-foreground"
                  : "text-muted-foreground hover:bg-background-interactive/75",
              )}
              onClick={() => setFileView("list")}
            >
              <LayoutList className="size-3" />
            </button>
          </div>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={handleOpenWorkspaceFolder}
          disabled={!workspacePath}
          className="h-7 rounded-full px-2 text-[10px]"
          title={workspacePath ? `打开 ${workspacePath}` : "暂无工作区文件夹可打开"}
        >
          <FolderOpen className="size-3" />
          <span className="ml-1">打开</span>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={
            workspaceFiles.length > 0 ? handleSyncToDisk : handleSelectFolder
          }
          disabled={syncing || !currentThreadId}
          className="h-7 rounded-full px-2 text-[10px]"
          title={
            workspaceFiles.length > 0
              ? workspacePath
                ? `同步到 ${workspacePath}`
                : "将文件同步到磁盘"
              : workspacePath
                ? "更换文件夹"
                : "关联同步文件夹"
          }
        >
          {syncing ? (
            <Loader2 className="size-3 animate-spin" />
          ) : syncSuccess ? (
            <Check className="size-3 text-status-nominal" />
          ) : workspaceFiles.length > 0 ? (
            <Download className="size-3" />
          ) : (
            <FolderSync className="size-3" />
          )}
          <span className="ml-1">
            {workspaceFiles.length > 0
              ? "同步"
              : workspacePath
                ? "更换"
                : "关联"}
          </span>
        </Button>
      </div>

      {/* File tree or empty state */}
      {workspaceFiles.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center px-4 py-8 text-center text-sm text-muted-foreground">
          <FolderTree className="size-8 mb-2 opacity-50" />
          <span>暂无工作区文件</span>
          <span className="text-xs mt-1">
            {workspacePath
              ? `已关联：${workspacePath.split("/").pop()}`
              : "点击「关联」设置同步文件夹"}
          </span>
        </div>
      ) : fileView === "list" ? (
        <WorkspaceFileListTable
          files={workspaceFiles}
          workspacePath={workspacePath}
        />
      ) : (
        <div className="py-1 overflow-auto flex-1">
          <FileTree files={workspaceFiles} fileView={fileView} />
        </div>
      )}
    </div>
  );
}

// ============ File Tree Components ============

function FileTree({
  files,
  fileView,
}: {
  files: WorkspaceFileInfo[];
  fileView: "tree" | "list";
}): React.JSX.Element {
  const { currentThreadId } = useAppStore();
  const threadState = useThreadState(currentThreadId);
  const openFile = threadState?.openFile;
  const tree = useMemo(() => buildFileTree(files), [files]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const filesIdentity = useMemo(
    () => files.map((f) => f.path).join("\0"),
    [files],
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setExpanded(new Set());
  }, [filesIdentity, fileView]);

  const toggleExpand = useCallback((path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  return (
    <div className="select-none">
      {tree.map((node) => (
        <FileTreeNode
          key={node.path}
          node={node}
          depth={0}
          expanded={expanded}
          onToggle={toggleExpand}
          openFile={openFile}
        />
      ))}
    </div>
  );
}

const FileTreeNode = memo(
  function FileTreeNode({
    node,
    depth,
    expanded,
    onToggle,
    openFile,
  }: {
    node: TreeNode;
    depth: number;
    expanded: Set<string>;
    onToggle: (path: string) => void;
    openFile?: (path: string, name: string) => void;
  }): React.JSX.Element {
    const isExpanded = expanded.has(node.path);
    const hasChildren = node.children.length > 0;
    const paddingLeft = 8 + depth * 16;

    const handleClick = (): void => {
      if (node.is_dir) {
        onToggle(node.path);
      } else if (openFile) {
        // Open file in a new tab
        openFile(node.path, node.name);
      }
    };

    return (
      <>
        <div
          onClick={handleClick}
          className={cn(
            "flex cursor-pointer items-center gap-1.5 rounded-lg py-1 pr-3 text-xs hover:bg-background-interactive/78",
          )}
          style={{ paddingLeft }}
        >
          {/* Expand/collapse chevron for directories */}
          {node.is_dir ? (
            <span className="w-3.5 flex items-center justify-center shrink-0">
              {hasChildren &&
                (isExpanded ? (
                  <ChevronDown className="size-3 text-muted-foreground" />
                ) : (
                  <ChevronRight className="size-3 text-muted-foreground" />
                ))}
            </span>
          ) : (
            <span className="w-3.5 shrink-0" />
          )}

          {/* Icon */}
          <FileIcon name={node.name} isDir={node.is_dir} isOpen={isExpanded} />

          {/* Name */}
          <span className="truncate flex-1">{node.name}</span>

          {/* Size for files */}
          {!node.is_dir && node.size !== undefined && (
            <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
              {formatSize(node.size)}
            </span>
          )}
        </div>

        {/* Children */}
        {node.is_dir &&
          isExpanded &&
          node.children.map((child) => (
            <FileTreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              onToggle={onToggle}
              openFile={openFile}
            />
          ))}
      </>
    );
  },
  (prevProps, nextProps) => {
    // `expanded` is a new Set on each toggle; we must re-render when it changes,
    // otherwise ancestors whose own open state is unchanged skip rendering and
    // descendants never receive the updated Set (nested folders appear "stuck").
    if (prevProps.expanded !== nextProps.expanded) return false;
    return (
      prevProps.node === nextProps.node &&
      prevProps.expanded.has(prevProps.node.path) ===
        nextProps.expanded.has(nextProps.node.path) &&
      prevProps.openFile === nextProps.openFile &&
      prevProps.onToggle === nextProps.onToggle &&
      prevProps.depth === nextProps.depth
    );
  },
);

function FileIcon({
  name,
  isDir,
  isOpen,
}: {
  name: string;
  isDir: boolean;
  isOpen?: boolean;
}): React.JSX.Element {
  if (isDir) {
    return isOpen ? (
      <FolderOpen className="size-3.5 shrink-0 text-primary" />
    ) : (
      <Folder className="size-3.5 shrink-0 text-primary" />
    );
  }

  // Get file extension
  const ext = name.includes(".") ? name.split(".").pop()?.toLowerCase() : "";

  // Map extensions to icons and colors
  switch (ext) {
    case "ts":
    case "tsx":
      return <FileCode className="size-3.5 shrink-0 text-primary" />;
    case "js":
    case "jsx":
      return <FileCode className="size-3.5 shrink-0 text-foreground/72" />;
    case "json":
      return <FileJson className="size-3.5 shrink-0 text-foreground/72" />;
    case "md":
    case "mdx":
      return <FileText className="size-3.5 text-muted-foreground shrink-0" />;
    case "py":
      return <FileCode className="size-3.5 shrink-0 text-primary/85" />;
    case "css":
    case "scss":
    case "sass":
      return <FileCode className="size-3.5 shrink-0 text-foreground/72" />;
    case "html":
      return <FileCode className="size-3.5 shrink-0 text-foreground/72" />;
    case "svg":
    case "png":
    case "jpg":
    case "jpeg":
    case "gif":
    case "webp":
      return <Image className="size-3.5 shrink-0 text-primary/80" />;
    case "yml":
    case "yaml":
      return <FileType className="size-3.5 shrink-0 text-foreground/72" />;
    default:
      return <File className="size-3.5 text-muted-foreground shrink-0" />;
  }
}

const SUBAGENT_STATUS_LABEL: Record<string, string> = {
  pending: "待处理",
  running: "运行中",
  completed: "已完成",
  failed: "失败",
};

function AgentsContent(): React.JSX.Element {
  const { currentThreadId } = useAppStore();
  const threadState = useThreadState(currentThreadId);
  const subagents = threadState?.subagents ?? [];

  if (subagents.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center text-center text-sm text-muted-foreground py-8 px-4">
        <GitBranch className="size-8 mb-2 opacity-50" />
        <span>暂无子智能体任务</span>
        <span className="text-xs mt-1">子智能体创建后会显示在这里</span>
      </div>
    );
  }

  return (
    <div className="p-3 space-y-2">
      {subagents.map((agent) => (
        <div
          key={agent.id}
          className="rounded-[18px] border border-border/75 bg-[linear-gradient(180deg,color-mix(in_srgb,var(--card)_88%,transparent),color-mix(in_srgb,var(--background-elevated)_72%,transparent))] p-3 shadow-[0_6px_16px_color-mix(in_srgb,#000_3%,transparent)]"
        >
          <div className="flex items-center gap-2 text-sm font-medium">
            <GitBranch className="size-3.5 text-status-info" />
            <span className="flex-1">{agent.name}</span>
            <span
              className={cn(
                "rounded-full px-1.5 py-0.5 text-[10px]",
                agent.status === "pending" && "bg-muted text-muted-foreground",
                agent.status === "running" &&
                  "bg-status-info/20 text-status-info",
                agent.status === "completed" &&
                  "bg-status-nominal/20 text-status-nominal",
                agent.status === "failed" &&
                  "bg-status-critical/20 text-status-critical",
              )}
            >
              {SUBAGENT_STATUS_LABEL[agent.status] ?? agent.status}
            </span>
          </div>
          {agent.description && (
            <p className="text-xs text-muted-foreground mt-1">
              {agent.description}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
