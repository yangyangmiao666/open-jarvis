import { useState } from "react";
import {
  Plus,
  MessageSquare,
  Trash2,
  Pencil,
  Loader2,
  LayoutGrid,
  AlertCircle,
  Settings,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAppStore } from "@/lib/store";
import {
  useThreadStream,
  useCurrentThread,
  useThreadState,
} from "@/lib/thread-context";
import { cn, formatRelativeTime, truncate } from "@/lib/utils";
import { JarvisMark } from "@/components/branding/JarvisMark";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import type { Thread } from "@/types";

// Thread status indicator that shows loading, interrupted, or default state
function ThreadStatusIcon({
  threadId,
}: {
  threadId: string;
}): React.JSX.Element {
  const { isLoading } = useThreadStream(threadId);
  const { pendingApproval } = useCurrentThread(threadId);

  if (isLoading) {
    return (
      <Loader2 className="size-4 shrink-0 text-status-info animate-spin" />
    );
  }

  if (pendingApproval) {
    return <AlertCircle className="size-4 shrink-0 text-status-warning" />;
  }

  return <MessageSquare className="size-4 shrink-0 text-muted-foreground" />;
}
// Individual thread list item component
function ThreadListItem({
  thread,
  isSelected,
  isEditing,
  editingTitle,
  bulkMode,
  isBulkChecked,
  onSelect,
  onDelete,
  onStartEditing,
  onSaveTitle,
  onCancelEditing,
  onEditingTitleChange,
  onToggleBulk,
}: {
  thread: Thread;
  isSelected: boolean;
  isEditing: boolean;
  editingTitle: string;
  bulkMode: boolean;
  isBulkChecked: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onStartEditing: () => void;
  onSaveTitle: () => void;
  onCancelEditing: () => void;
  onEditingTitleChange: (value: string) => void;
  onToggleBulk: () => void;
}): React.JSX.Element {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className={cn(
            "group app-elevated-hover flex items-center gap-2 overflow-hidden rounded-2xl border px-3 py-2.5 cursor-pointer",
            isSelected
              ? "border-sidebar-ring/30 bg-sidebar-accent text-sidebar-accent-foreground shadow-[0_16px_30px_color-mix(in_srgb,var(--sidebar-ring)_10%,transparent)]"
              : "border-transparent hover:border-sidebar-border/80 hover:bg-sidebar-accent/70",
          )}
          onClick={() => {
            if (!isEditing) {
              if (bulkMode) {
                onToggleBulk();
              } else {
                onSelect();
              }
            }
          }}
        >
          {bulkMode && (
            <input
              type="checkbox"
              checked={isBulkChecked}
              onChange={onToggleBulk}
              onClick={(e) => e.stopPropagation()}
              className="size-3.5 rounded border-border shrink-0 accent-primary"
            />
          )}
          <ThreadStatusIcon threadId={thread.thread_id} />
          <div className="flex-1 min-w-0 overflow-hidden">
            {isEditing ? (
              <input
                type="text"
                value={editingTitle}
                onChange={(e) => onEditingTitleChange(e.target.value)}
                onBlur={onSaveTitle}
                onKeyDown={(e) => {
                  if (e.key === "Enter") onSaveTitle();
                  if (e.key === "Escape") onCancelEditing();
                }}
                className="w-full bg-background border border-border rounded px-1 py-0.5 text-sm outline-none focus:ring-1 focus:ring-ring"
                autoFocus
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <>
                <div className="text-sm truncate block">
                  {thread.title || truncate(thread.thread_id, 20)}
                </div>
                <div className="text-[10px] text-muted-foreground truncate">
                  {formatRelativeTime(thread.updated_at)}
                </div>
              </>
            )}
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            className="shrink-0 rounded-full opacity-0 group-hover:opacity-100"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
          >
            <Trash2 className="size-3" />
          </Button>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={onStartEditing}>
          <Pencil className="size-4 mr-2" />
          重命名
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" onClick={onDelete}>
          <Trash2 className="size-4 mr-2" />
          删除
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

interface ThreadSidebarProps {
  onOpenSettings: () => void;
}

export function ThreadSidebar({
  onOpenSettings,
}: ThreadSidebarProps): React.JSX.Element {
  const {
    threads,
    currentThreadId,
    createThread,
    selectThread,
    deleteThread,
    deleteThreads,
    updateThread,
    setShowKanbanView,
  } = useAppStore();
  const currentThread = useThreadState(currentThreadId);

  const [editingThreadId, setEditingThreadId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [bulkMode, setBulkMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [deleteConfirm, setDeleteConfirm] = useState<
    null | { type: "single"; id: string } | { type: "bulk" }
  >(null);

  const startEditing = (threadId: string, currentTitle: string): void => {
    setEditingThreadId(threadId);
    setEditingTitle(currentTitle || "");
  };

  const saveTitle = async (): Promise<void> => {
    if (editingThreadId && editingTitle.trim()) {
      await updateThread(editingThreadId, { title: editingTitle.trim() });
    }
    setEditingThreadId(null);
    setEditingTitle("");
  };

  const cancelEditing = (): void => {
    setEditingThreadId(null);
    setEditingTitle("");
  };

  const handleNewThread = async (): Promise<void> => {
    if (
      currentThreadId &&
      currentThread &&
      currentThread.messages.length === 0 &&
      currentThread.draftInput.trim().length === 0
    ) {
      await selectThread(currentThreadId);
      return;
    }

    await createThread({ title: `新会话 ${new Date().toLocaleDateString()}` });
  };

  const toggleBulk = (threadId: string): void => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(threadId)) next.delete(threadId);
      else next.add(threadId);
      return next;
    });
  };

  const exitBulkMode = (): void => {
    setBulkMode(false);
    setSelectedIds(new Set());
  };

  const handleBulkDeleteRequest = (): void => {
    if (selectedIds.size === 0) return;
    setDeleteConfirm({ type: "bulk" });
  };

  const executeConfirmedDelete = async (): Promise<void> => {
    if (!deleteConfirm) return;
    if (deleteConfirm.type === "single") {
      await deleteThread(deleteConfirm.id);
    } else {
      const ids = [...selectedIds];
      if (ids.length === 0) {
        setDeleteConfirm(null);
        return;
      }
      await deleteThreads(ids);
      exitBulkMode();
    }
    setDeleteConfirm(null);
  };

  return (
    <aside className="flex h-full w-full flex-col overflow-hidden bg-transparent">
      {/* 品牌区：紧贴标题栏下缘，在「红绿灯区域以下 ~ 本区分割线」之间垂直居中 */}
      <div className="app-sidebar-brand app-hairline flex min-h-[5.4rem] shrink-0 items-center gap-3 px-3 py-4">
        <div
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[1.45rem] border border-primary/28 bg-[linear-gradient(180deg,color-mix(in_srgb,var(--primary)_24%,transparent),color-mix(in_srgb,var(--accent)_16%,transparent))] text-primary shadow-[0_22px_44px_color-mix(in_srgb,var(--primary)_16%,transparent)]"
          aria-hidden
        >
          <JarvisMark className="size-[24px]" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="app-display-title truncate text-[1.02rem] leading-none text-sidebar-foreground">
            Open Jarvis
          </p>
          <div className="mt-1 flex items-center gap-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-primary/85">
              Workspace Agent
            </p>
            <p className="font-mono text-[10px] text-muted-foreground/90">
              v{__APP_VERSION__}
            </p>
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            对话、文件与工具流的统一工作台
          </p>
        </div>
      </div>

      <div className="space-y-2 border-b border-sidebar-border/65 bg-[linear-gradient(180deg,color-mix(in_srgb,var(--sidebar-accent)_46%,transparent),transparent)] p-3">
        <div className="flex items-center gap-2">
          <Button
            variant="default"
            size="sm"
            className="min-w-0 flex-1 justify-start gap-2 rounded-2xl"
            onClick={handleNewThread}
          >
            <Plus className="size-4" />
            新会话
          </Button>
          {!bulkMode && (
            <Button
              variant="outline"
              size="sm"
              className="h-9 shrink-0 rounded-2xl px-3 text-xs"
              onClick={() => setBulkMode(true)}
            >
              多选
            </Button>
          )}
          {bulkMode ? (
            <Button
              variant="outline"
              size="sm"
              className="h-9 shrink-0 rounded-2xl px-3 text-xs"
              disabled={threads.length === 0}
              onClick={() => {
                const allSelected =
                  threads.length > 0 && selectedIds.size === threads.length;
                setSelectedIds(
                  allSelected
                    ? new Set()
                    : new Set(threads.map((t) => t.thread_id)),
                );
              }}
            >
              {threads.length > 0 && selectedIds.size === threads.length
                ? "取消全选"
                : "全选"}
            </Button>
          ) : null}
        </div>
        {bulkMode ? (
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              className="h-9 flex-1 rounded-2xl px-3 text-xs"
              onClick={exitBulkMode}
            >
              完成
            </Button>
            <Button
              variant="destructive"
              size="sm"
              className="h-9 flex-1 rounded-2xl px-3 text-xs"
              disabled={selectedIds.size === 0}
              onClick={() => handleBulkDeleteRequest()}
            >
              删除 ({selectedIds.size})
            </Button>
          </div>
        ) : null}
      </div>

      {/* Thread List */}
      <ScrollArea className="app-subtle-scroll flex-1 min-h-0">
        <div className="space-y-1.5 overflow-hidden p-3 pt-1">
          {threads.map((thread) => (
            <ThreadListItem
              key={thread.thread_id}
              thread={thread}
              isSelected={currentThreadId === thread.thread_id}
              isEditing={editingThreadId === thread.thread_id}
              editingTitle={editingTitle}
              bulkMode={bulkMode}
              isBulkChecked={selectedIds.has(thread.thread_id)}
              onSelect={() => selectThread(thread.thread_id)}
              onDelete={() =>
                setDeleteConfirm({ type: "single", id: thread.thread_id })
              }
              onStartEditing={() =>
                startEditing(thread.thread_id, thread.title || "")
              }
              onSaveTitle={saveTitle}
              onCancelEditing={cancelEditing}
              onEditingTitleChange={setEditingTitle}
              onToggleBulk={() => toggleBulk(thread.thread_id)}
            />
          ))}

          {threads.length === 0 && (
            <div className="px-3 py-8 text-center text-sm text-muted-foreground">
              暂无会话
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Overview Toggle */}
      <div className="border-t border-sidebar-border/80 bg-[linear-gradient(180deg,transparent,color-mix(in_srgb,var(--sidebar-accent)_44%,transparent))] p-3">
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            className="min-w-0 flex-1 justify-start gap-2 rounded-2xl"
            onClick={() => setShowKanbanView(true)}
          >
            <LayoutGrid className="size-4" />
            总览
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-9 shrink-0 rounded-2xl"
            onClick={onOpenSettings}
            title="打开设置"
          >
            <Settings className="size-4" />
          </Button>
        </div>
        <div className="mt-3 rounded-[1.35rem] border border-sidebar-border/70 bg-[linear-gradient(180deg,color-mix(in_srgb,var(--sidebar-accent)_82%,transparent),color-mix(in_srgb,var(--sidebar)_78%,transparent))] px-3 py-3.5 shadow-[0_18px_34px_color-mix(in_srgb,#000_10%,transparent)]">
          <div className="flex items-baseline gap-2 text-sidebar-foreground/90">
            <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
              Built by
            </span>
            <span className="app-display-title truncate text-[0.88rem] leading-none text-sidebar-foreground">
              Yang-yang Miao
            </span>
          </div>
        </div>
      </div>

      <Dialog
        open={deleteConfirm !== null}
        onOpenChange={(o) => !o && setDeleteConfirm(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {deleteConfirm?.type === "bulk"
                ? "确认删除多个会话？"
                : "确认删除会话？"}
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {deleteConfirm?.type === "bulk"
              ? `将永久删除所选的 ${selectedIds.size} 个会话及其消息记录，此操作不可恢复。`
              : "将永久删除该会话及其消息记录，此操作不可恢复。"}
          </p>
          <DialogFooter className="gap-3 sm:gap-3">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setDeleteConfirm(null)}
            >
              取消
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void executeConfirmedDelete()}
            >
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </aside>
  );
}
