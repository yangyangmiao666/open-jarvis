import {memo, useCallback, useEffect, useMemo, useRef, useState} from "react";
import {useTranslation} from "react-i18next";
import {
  BookOpen,
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
  MemoryStick,
  Loader2,
  PlugZap,
  XCircle,
} from "lucide-react";
import {cn} from "@/lib/utils";
import {useAppStore} from "@/lib/store";
import {useThreadState} from "@/lib/thread-context";
import {Badge} from "@/components/ui/badge";
import {Button} from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type {ResourceStatsSnapshot, Todo} from "@/types";
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
  accent?: "blue" | "green" | "amber" | "purple";
}

const SECTION_ACCENT_ICON: Record<string, string> = {
  blue: "icon-blue",
  green: "icon-green",
  amber: "icon-amber",
  purple: "icon-purple",
};

const SECTION_ACCENT_BADGE: Record<string, string> = {
  blue: "badge-blue",
  green: "badge-green",
  amber: "badge-amber",
  purple: "badge-purple",
};

function SectionHeader({
  title,
  icon: Icon,
  badge,
  isOpen,
  onToggle,
  accent,
}: SectionHeaderProps): React.JSX.Element {
  const iconClass = accent ? SECTION_ACCENT_ICON[accent] : "text-foreground/80";
  const badgeClass = accent ? SECTION_ACCENT_BADGE[accent] : "";
  return (
    <button
      onClick={onToggle}
      className="group app-elevated-hover flex w-full shrink-0 items-center gap-2 rounded-[18px] border border-transparent px-3 py-2.5 text-section-header transition-colors hover:border-border/70 hover:bg-background-interactive/78 hover:text-foreground"
      style={{ height: HEADER_HEIGHT }}
    >
      <ChevronRight
        className={cn(
          "size-3.5 text-muted-foreground transition-transform duration-200",
          isOpen && "rotate-90",
        )}
      />
      <Icon className={cn("size-4", iconClass)} />
      <span className="flex-1 text-left">{title}</span>
      {badge !== undefined && badge !== 0 && badge !== "" && (
        <span className={cn("rounded-full border border-border/70 px-2 py-0.5 text-[10px] tabular-nums", badgeClass ? `${badgeClass}` : "bg-background/55 text-muted-foreground")}>
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
  const { t } = useTranslation('panels');
  const { currentThreadId } = useAppStore();
  const threadState = useThreadState(currentThreadId);
  const todos = threadState?.todos ?? [];
  const workspaceFiles = threadState?.workspaceFiles ?? [];
  const subagents = threadState?.subagents ?? [];
  const containerRef = useRef<HTMLDivElement>(null);

  const [tasksOpen, setTasksOpen] = useState(true);
  const [filesOpen, setFilesOpen] = useState(true);
  const [agentsOpen, setAgentsOpen] = useState(true);
  const [resourceStats, setResourceStats] = useState<ResourceStatsSnapshot | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadResourceStats(): Promise<void> {
      try {
        if (currentThreadId) {
          await window.api.mcp.bootstrap(currentThreadId);
        }
        const stats = await window.api.settings.getResourceStats(
          currentThreadId ?? undefined,
        );
        if (!cancelled) {
          setResourceStats(stats);
        }
      } catch (error) {
        console.error("[RightPanel] Failed to load resource stats:", error);
      }
    }

    void loadResourceStats();
    const timer = window.setInterval(() => {
      void loadResourceStats();
    }, 5000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [currentThreadId, threadState?.enabledMcpServerIds, threadState?.workspacePath]);

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
      className="flex h-full w-full flex-col overflow-hidden border-l border-border/60 bg-background-elevated"
    >
      <div className="border-b border-border/65 bg-background/65 px-3 py-2">
        <ResourceSummaryCard stats={resourceStats} />
      </div>

      {/* TASKS */}
      <div className="flex shrink-0 flex-col border-b border-border/65 bg-background-elevated">
        <SectionHeader
          title={t('sections.tasks')}
          icon={ListTodo}
          badge={todos.length}
          isOpen={tasksOpen}
          onToggle={() => setTasksOpen((prev) => !prev)}
          accent="blue"
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
      <div className="flex shrink-0 flex-col border-b border-border/65 bg-background-elevated">
        <SectionHeader
          title={t('sections.files')}
          icon={FolderTree}
          badge={workspaceFiles.length > 0 ? t('filesBadge', { count: workspaceFiles.length }) : undefined}
          isOpen={filesOpen}
          onToggle={() => setFilesOpen((prev) => !prev)}
          accent="amber"
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
      <div className="flex shrink-0 flex-col bg-background-elevated">
        <SectionHeader
          title={t('sections.subagents')}
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

function ResourceSummaryCard({
  stats,
}: {
  stats: ResourceStatsSnapshot | null;
}): React.JSX.Element {
  const { t } = useTranslation("panels");

  const items = [
    {
      key: "memories",
      label: t("resources.memories"),
      shortLabel: t("resources.memoriesShort"),
      icon: MemoryStick,
      loaded: stats?.memories.loaded ?? 0,
      failed: stats?.memories.failed ?? 0,
      loading: 0,
      entries:
        stats?.memories.items.map((item) => ({
          title: item.title,
          subtitle: item.summary,
        })) ?? [],
    },
    {
      key: "skills",
      label: t("resources.skills"),
      shortLabel: t("resources.skillsShort"),
      icon: BookOpen,
      loaded: stats?.skills.loaded ?? 0,
      failed: stats?.skills.failed ?? 0,
      loading: 0,
      entries:
        stats?.skills.items.map((item) => ({
          title: item.folderName,
          subtitle: item.description,
        })) ?? [],
    },
    {
      key: "mcp",
      label: t("resources.mcpTools"),
      shortLabel: t("resources.mcpShort"),
      icon: PlugZap,
      loaded: stats?.mcp.loaded ?? 0,
      failed: stats?.mcp.failed ?? 0,
      loading: stats?.mcp.loading ?? 0,
      entries:
        stats?.mcp.items.map((item) => ({
          title: item.toolName,
          subtitle: item.serverName,
        })) ?? [],
    },
  ];

  return (
    <div className="flex items-center justify-center gap-1.5">
      {items.map(
        ({
          key,
          label,
          shortLabel,
          icon: Icon,
          loaded,
          failed,
          loading,
          entries,
        }) => (
          <Popover key={key}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="group flex items-center gap-1 rounded-full border border-border/70 bg-background/75 px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:border-primary/35 hover:text-foreground"
                aria-label={label}
              >
                <Icon className="size-3.5 text-primary" />
                <span className="font-medium">{shortLabel}</span>
                <span className="tabular-nums text-foreground">{loaded}</span>
                {(failed > 0 || loading > 0) && (
                  <span
                    className={cn(
                      "tabular-nums",
                      failed > 0
                        ? "text-status-critical"
                        : "text-status-info",
                    )}
                  >
                    /{failed > 0 ? failed : loading}
                  </span>
                )}
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-72 p-3">
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Icon className="size-4 text-primary" />
                  <span className="text-sm font-medium">{label}</span>
                </div>
                <div className="flex flex-wrap gap-1.5 text-[11px]">
                  <span className="rounded-full bg-status-nominal/15 px-2 py-1 text-status-nominal">
                    {t("resources.loadedCount", { count: loaded })}
                  </span>
                  {loading > 0 && (
                    <span className="rounded-full bg-status-info/10 px-2 py-1 text-status-info">
                      {t("resources.loadingCount", { count: loading })}
                    </span>
                  )}
                  <span
                    className={cn(
                      "rounded-full px-2 py-1",
                      failed > 0
                        ? "bg-status-critical/10 text-status-critical"
                        : "bg-muted text-muted-foreground",
                    )}
                  >
                    {t("resources.failedCount", { count: failed })}
                  </span>
                </div>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {loading > 0
                    ? t("resources.detailWithLoading")
                    : failed > 0
                      ? t("resources.detailWithFailures")
                      : t("resources.detailHealthy")}
                </p>
                <div className="max-h-80 space-y-1.5 overflow-y-auto pr-1">
                  {entries.length > 0 ? (
                    entries.map((entry) => (
                      <div
                        key={`${key}-${entry.title}-${entry.subtitle}`}
                        className="rounded-xl border border-border/60 bg-background/45 px-3 py-2"
                      >
                        <div className="text-xs font-medium text-foreground">
                          {entry.title}
                        </div>
                        {entry.subtitle ? (
                          <div className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">
                            {entry.subtitle}
                          </div>
                        ) : null}
                      </div>
                    ))
                  ) : (
                    <div className="rounded-xl border border-dashed border-border/60 px-3 py-2 text-xs text-muted-foreground">
                      {t("resources.emptyList")}
                    </div>
                  )}
                </div>
              </div>
            </PopoverContent>
          </Popover>
        ),
      )}
    </div>
  );
}

// ============ Content Components ============

const STATUS_CONFIG = {
  pending: {
    icon: Circle,
    badge: "outline" as const,
    statusKey: "pending" as const,
    color: "text-muted-foreground",
  },
  in_progress: {
    icon: Clock,
    badge: "info" as const,
    statusKey: "inProgress" as const,
    color: "text-status-info",
  },
  completed: {
    icon: CheckCircle2,
    badge: "nominal" as const,
    statusKey: "completed" as const,
    color: "text-status-nominal",
  },
  cancelled: {
    icon: XCircle,
    badge: "critical" as const,
    statusKey: "cancelled" as const,
    color: "text-muted-foreground",
  },
};

function TasksContent(): React.JSX.Element {
  const { t } = useTranslation('panels');
  const { currentThreadId } = useAppStore();
  const threadState = useThreadState(currentThreadId);
  const todos = threadState?.todos ?? [];
  const [completedExpanded, setCompletedExpanded] = useState(false);

  if (todos.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center px-4 py-8 text-center text-sm text-muted-foreground">
        <ListTodo className="size-8 mb-2 opacity-50" />
        <span>{t('tasks.noTasks')}</span>
        <span className="text-xs mt-1">{t('tasks.noTasksHint')}</span>
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
          <span className="text-muted-foreground">{t('tasks.progress')}</span>
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
                {t('tasks.completedLabel', { count: doneItems.length })}
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
  const { t } = useTranslation('panels');
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
        {t(`taskStatus.${config.statusKey}`)}
      </Badge>
    </div>
  );
}

function FilesContent(): React.JSX.Element {
  const { t } = useTranslation('panels');
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
          {workspacePath ? workspacePath.split('/').pop() : t('files.noFolderLinked')}
        </span>
        {workspaceFiles.length > 0 && (
          <div className="flex shrink-0 overflow-hidden rounded-full border border-border bg-background/60">
            <button
              type="button"
              title={t('files.treeView')}
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
              title={t('files.listView')}
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
          title={workspacePath ? t('files.openFolderTitle', { path: workspacePath }) : t('files.noFolderToOpen')}
        >
          <FolderOpen className="size-3" />
          <span className="ml-1">{t('files.openFolder')}</span>
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
                ? t('files.syncToTitle', { path: workspacePath })
                : t('files.syncToDisk')
              : workspacePath
                ? t('files.changeFolderTitle')
                : t('files.linkFolderTitle')
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
              ? t('files.sync')
              : workspacePath
                ? t('files.changeFolder')
                : t('files.linkFolder')}
          </span>
        </Button>
      </div>

      {/* File tree or empty state */}
      {workspaceFiles.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center px-4 py-8 text-center text-sm text-muted-foreground">
          <FolderTree className="size-8 mb-2 opacity-50" />
          <span>{t('files.noWorkspaceFiles')}</span>
          <span className="text-xs mt-1">
            {workspacePath
              ? t('files.linkedFolder', { name: workspacePath.split('/').pop() })
              : t('files.linkFolderHint')}
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

const SUBAGENT_STATUS_KEY: Record<string, string> = {
  pending: "pending",
  running: "running",
  completed: "completed",
  failed: "failed",
};

function AgentsContent(): React.JSX.Element {
  const { t } = useTranslation('panels');
  const { currentThreadId } = useAppStore();
  const threadState = useThreadState(currentThreadId);
  const subagents = threadState?.subagents ?? [];

  if (subagents.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center text-center text-sm text-muted-foreground py-8 px-4">
        <GitBranch className="size-8 mb-2 opacity-50" />
        <span>{t('subagents.noSubagents')}</span>
        <span className="text-xs mt-1">{t('subagents.noSubagentsHint')}</span>
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
              {t(`subagentStatus.${SUBAGENT_STATUS_KEY[agent.status] ?? agent.status}`)}
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
