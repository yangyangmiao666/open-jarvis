import { useState } from "react"
import {
  Plus,
  MessageSquare,
  Trash2,
  Pencil,
  Loader2,
  LayoutGrid,
  AlertCircle,
  Cpu
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog"
import { useAppStore } from "@/lib/store"
import { useThreadStream, useCurrentThread } from "@/lib/thread-context"
import { cn, formatRelativeTime, truncate } from "@/lib/utils"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger
} from "@/components/ui/context-menu"
import type { Thread } from "@/types"

// Thread status indicator that shows loading, interrupted, or default state
function ThreadStatusIcon({ threadId }: { threadId: string }): React.JSX.Element {
  const { isLoading } = useThreadStream(threadId)
  const { pendingApproval } = useCurrentThread(threadId)

  if (isLoading) {
    return <Loader2 className="size-4 shrink-0 text-status-info animate-spin" />
  }
  
  if (pendingApproval) {
    return <AlertCircle className="size-4 shrink-0 text-status-warning" />
  }
  
  return <MessageSquare className="size-4 shrink-0 text-muted-foreground" />
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
  onToggleBulk
}: {
  thread: Thread
  isSelected: boolean
  isEditing: boolean
  editingTitle: string
  bulkMode: boolean
  isBulkChecked: boolean
  onSelect: () => void
  onDelete: () => void
  onStartEditing: () => void
  onSaveTitle: () => void
  onCancelEditing: () => void
  onEditingTitleChange: (value: string) => void
  onToggleBulk: () => void
}): React.JSX.Element {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className={cn(
            "group flex items-center gap-2 rounded-sm px-3 py-2 cursor-pointer transition-colors overflow-hidden",
            isSelected
              ? "bg-sidebar-accent text-sidebar-accent-foreground"
              : "hover:bg-sidebar-accent/50"
          )}
          onClick={() => {
            if (!isEditing) {
              if (bulkMode) {
                onToggleBulk()
              } else {
                onSelect()
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
                  if (e.key === "Enter") onSaveTitle()
                  if (e.key === "Escape") onCancelEditing()
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
            className="opacity-0 group-hover:opacity-100 shrink-0"
            onClick={(e) => {
              e.stopPropagation()
              onDelete()
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
  )
}

export function ThreadSidebar(): React.JSX.Element {
  const {
    threads,
    currentThreadId,
    createThread,
    selectThread,
    deleteThread,
    deleteThreads,
    updateThread,
    setShowKanbanView
  } = useAppStore()

  const [editingThreadId, setEditingThreadId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState("")
  const [bulkMode, setBulkMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [deleteConfirm, setDeleteConfirm] = useState<
    null | { type: "single"; id: string } | { type: "bulk" }
  >(null)

  const startEditing = (threadId: string, currentTitle: string): void => {
    setEditingThreadId(threadId)
    setEditingTitle(currentTitle || "")
  }

  const saveTitle = async (): Promise<void> => {
    if (editingThreadId && editingTitle.trim()) {
      await updateThread(editingThreadId, { title: editingTitle.trim() })
    }
    setEditingThreadId(null)
    setEditingTitle("")
  }

  const cancelEditing = (): void => {
    setEditingThreadId(null)
    setEditingTitle("")
  }

  const handleNewThread = async (): Promise<void> => {
    await createThread({ title: `新会话 ${new Date().toLocaleDateString()}` })
  }

  const toggleBulk = (threadId: string): void => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(threadId)) next.delete(threadId)
      else next.add(threadId)
      return next
    })
  }

  const exitBulkMode = (): void => {
    setBulkMode(false)
    setSelectedIds(new Set())
  }

  const handleBulkDeleteRequest = (): void => {
    if (selectedIds.size === 0) return
    setDeleteConfirm({ type: "bulk" })
  }

  const executeConfirmedDelete = async (): Promise<void> => {
    if (!deleteConfirm) return
    if (deleteConfirm.type === "single") {
      await deleteThread(deleteConfirm.id)
    } else {
      const ids = [...selectedIds]
      if (ids.length === 0) {
        setDeleteConfirm(null)
        return
      }
      await deleteThreads(ids)
      exitBulkMode()
    }
    setDeleteConfirm(null)
  }

  return (
    <aside className="flex h-full w-full flex-col overflow-hidden bg-sidebar">
      {/* 品牌区：紧贴标题栏下缘，在「红绿灯区域以下 ~ 本区分割线」之间垂直居中 */}
      <div className="flex min-h-[3.25rem] shrink-0 items-center gap-3 border-b border-sidebar-border px-3 py-2">
        <div
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-cyan-500/30 bg-cyan-500/[0.07] text-cyan-600 dark:text-cyan-400"
          aria-hidden
        >
          <Cpu className="size-[22px]" strokeWidth={1.75} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold uppercase tracking-wide text-sidebar-foreground">
            Open-Jarvis
          </p>
          <p className="font-mono text-[10px] text-muted-foreground">{__APP_VERSION__}</p>
        </div>
      </div>

      <div className="space-y-1 p-2">
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start gap-2"
          onClick={handleNewThread}
        >
          <Plus className="size-4" />
          新会话
        </Button>
        {bulkMode ? (
          <div className="space-y-1">
            <Button
              variant="outline"
              size="sm"
              className="w-full text-xs h-7"
              disabled={threads.length === 0}
              onClick={() => {
                const allSelected =
                  threads.length > 0 && selectedIds.size === threads.length
                setSelectedIds(
                  allSelected ? new Set() : new Set(threads.map((t) => t.thread_id))
                )
              }}
            >
              {threads.length > 0 && selectedIds.size === threads.length ? "取消全选" : "全选"}
            </Button>
            <div className="flex gap-1">
              <Button variant="secondary" size="sm" className="flex-1 text-xs h-7" onClick={exitBulkMode}>
                完成
              </Button>
              <Button
                variant="destructive"
                size="sm"
                className="flex-1 text-xs h-7"
                disabled={selectedIds.size === 0}
                onClick={() => handleBulkDeleteRequest()}
              >
                删除 ({selectedIds.size})
              </Button>
            </div>
          </div>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="w-full justify-start gap-2 text-xs h-7"
            onClick={() => setBulkMode(true)}
          >
            多选删除
          </Button>
        )}
      </div>

      {/* Thread List */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-2 space-y-1 overflow-hidden">
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
              onDelete={() => setDeleteConfirm({ type: "single", id: thread.thread_id })}
              onStartEditing={() => startEditing(thread.thread_id, thread.title || "")}
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
      <div className="p-2 border-t border-border">
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start gap-2"
          onClick={() => setShowKanbanView(true)}
        >
          <LayoutGrid className="size-4" />
          总览
        </Button>
      </div>

      <Dialog open={deleteConfirm !== null} onOpenChange={(o) => !o && setDeleteConfirm(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {deleteConfirm?.type === "bulk" ? "确认删除多个会话？" : "确认删除会话？"}
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {deleteConfirm?.type === "bulk"
              ? `将永久删除所选的 ${selectedIds.size} 个会话及其消息记录，此操作不可恢复。`
              : "将永久删除该会话及其消息记录，此操作不可恢复。"}
          </p>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="secondary" onClick={() => setDeleteConfirm(null)}>
              取消
            </Button>
            <Button type="button" variant="destructive" onClick={() => void executeConfirmedDelete()}>
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </aside>
  )
}
