import { useState, useEffect } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"

interface SkillsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  threadId: string | null
}

export function SkillsDialog({ open, onOpenChange, threadId }: SkillsDialogProps): React.JSX.Element {
  const [sources, setSources] = useState<string[]>([])
  const [newSource, setNewSource] = useState("")
  const [folders, setFolders] = useState<string[]>([])
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [newSkillName, setNewSkillName] = useState("")
  const [newSkillMarkdown, setNewSkillMarkdown] = useState("")
  const [editName, setEditName] = useState("")
  const [editMarkdown, setEditMarkdown] = useState("")
  const [editLoading, setEditLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [skillDeleteConfirmOpen, setSkillDeleteConfirmOpen] = useState(false)

  const reload = async (): Promise<void> => {
    const s = await window.api.skills.listSources()
    setSources(s)
    if (threadId) {
      const r = await window.api.skills.listWorkspaceSkillFolders(threadId)
      if (r.success && r.folders) setFolders(r.folders)
      else setFolders([])
    } else {
      setFolders([])
    }
    setSelected(new Set())
  }

  const selectedSingle = selected.size === 1 ? [...selected][0] : null

  useEffect(() => {
    if (!open || !threadId || !selectedSingle) {
      setEditName("")
      setEditMarkdown("")
      setEditLoading(false)
      return
    }
    setEditName(selectedSingle)
    setEditMarkdown("")
    setEditLoading(true)
    let cancelled = false
    void window.api.skills.readSkillMarkdown(threadId, selectedSingle).then((r) => {
      if (cancelled) return
      setEditMarkdown(r.success && r.content !== undefined ? r.content : "")
      setEditLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [open, threadId, selectedSingle])

  useEffect(() => {
    if (open) void reload()
  }, [open, threadId])

  const toggle = (name: string): void => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  const addSource = (): void => {
    const t = newSource.trim()
    if (!t) return
    const path = t.startsWith("/") ? t : `/${t}`
    if (sources.includes(path)) return
    const next = [...sources, path]
    setSources(next)
    void window.api.skills.setSources(next)
    setNewSource("")
  }

  const removeSource = (p: string): void => {
    const next = sources.filter((x) => x !== p)
    setSources(next)
    void window.api.skills.setSources(next)
  }

  const handleImport = async (): Promise<void> => {
    if (!threadId) return
    setBusy(true)
    try {
      await window.api.skills.importFolder(threadId)
      await reload()
    } finally {
      setBusy(false)
    }
  }

  const handleCreate = async (): Promise<void> => {
    if (!threadId || !newSkillName.trim()) return
    setBusy(true)
    try {
      const md = newSkillMarkdown.trim()
      await window.api.skills.createSkill(threadId, newSkillName.trim(), md ? md : undefined)
      setNewSkillName("")
      setNewSkillMarkdown("")
      await reload()
    } finally {
      setBusy(false)
    }
  }

  const handleSaveEdit = async (): Promise<void> => {
    if (!threadId || selected.size !== 1) return
    const currentFolder = [...selected][0]
    setBusy(true)
    try {
      let finalFolder = currentFolder
      const renameResult = await window.api.skills.renameSkillFolder(
        threadId,
        currentFolder,
        editName.trim()
      )
      if (!renameResult.success) {
        console.error(renameResult.error)
        return
      }
      if (renameResult.folder) finalFolder = renameResult.folder
      const writeResult = await window.api.skills.writeSkillMarkdown(
        threadId,
        finalFolder,
        editMarkdown
      )
      if (!writeResult.success) {
        console.error(writeResult.error)
        return
      }
      await reload()
    } finally {
      setBusy(false)
    }
  }

  const handleDeleteFolders = async (): Promise<void> => {
    if (!threadId || selected.size === 0) return
    setBusy(true)
    try {
      await window.api.skills.deleteSkillFolders(threadId, [...selected])
      await reload()
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>技能（智能体 Skills）</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 flex-1 min-h-0 overflow-hidden flex flex-col">
          <div>
            <div className="text-xs font-medium text-muted-foreground mb-1">
              加载路径（相对工作区根，POSIX）
            </div>
            <ScrollArea className="h-24 rounded border border-border">
              <div className="p-2 space-y-1">
                {sources.map((p) => (
                  <div key={p} className="flex items-center justify-between gap-2 text-xs font-mono">
                    <span className="truncate">{p}</span>
                    <Button type="button" variant="ghost" size="sm" className="h-6 text-[10px]" onClick={() => removeSource(p)}>
                      移除
                    </Button>
                  </div>
                ))}
              </div>
            </ScrollArea>
            <div className="flex gap-2 mt-2">
              <Input
                value={newSource}
                onChange={(e) => setNewSource(e.target.value)}
                placeholder="例如：/.deepagents/skills"
                className="text-xs h-8"
              />
              <Button type="button" size="sm" className="h-8 shrink-0" onClick={addSource}>
                添加
              </Button>
            </div>
          </div>

          {threadId && (
            <>
              <div>
                <div className="flex items-center justify-between gap-2 mb-1">
                  <div className="text-xs font-medium text-muted-foreground">
                    工作区 .deepagents/skills 中的技能目录
                  </div>
                  {folders.length > 0 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-6 px-1.5 text-[10px] shrink-0"
                      disabled={busy}
                      onClick={() => {
                        const allSelected =
                          folders.length > 0 && selected.size === folders.length
                        setSelected(allSelected ? new Set() : new Set(folders))
                      }}
                    >
                      {folders.length > 0 && selected.size === folders.length ? "取消全选" : "全选"}
                    </Button>
                  )}
                </div>
                <ScrollArea className="h-32 rounded border border-border">
                  <div className="p-2 space-y-1">
                    {folders.length === 0 && (
                      <div className="text-xs text-muted-foreground py-4 text-center">暂无</div>
                    )}
                    {folders.map((name) => (
                      <label
                        key={name}
                        className="flex items-center gap-2 text-xs cursor-pointer hover:bg-muted/50 rounded px-1 py-0.5"
                      >
                        <input
                          type="checkbox"
                          checked={selected.has(name)}
                          onChange={() => toggle(name)}
                          className="size-3.5 accent-primary"
                        />
                        <span className="font-mono">{name}</span>
                      </label>
                    ))}
                  </div>
                </ScrollArea>
                <div className="flex flex-wrap gap-2 mt-2">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="h-8 text-xs"
                    disabled={busy}
                    onClick={() => void handleImport()}
                  >
                    从磁盘导入文件夹
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    className="h-8 text-xs"
                    disabled={busy || selected.size === 0}
                    onClick={() => setSkillDeleteConfirmOpen(true)}
                  >
                    删除所选目录
                  </Button>
                </div>

                {selected.size === 1 && (
                  <div className="mt-3 space-y-2 rounded border border-border p-2 bg-muted/20">
                    <div className="text-xs font-medium text-muted-foreground">编辑所选技能</div>
                    <Input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      placeholder="目录名（保存时会规范为小写与连字符）"
                      className="text-xs h-8 font-mono"
                      disabled={busy || editLoading}
                    />
                    <textarea
                      value={editMarkdown}
                      onChange={(e) => setEditMarkdown(e.target.value)}
                      placeholder={editLoading ? "加载中…" : "SKILL.md 内容"}
                      disabled={busy || editLoading}
                      className={cn(
                        "flex min-h-[140px] w-full rounded-sm border border-input bg-background px-3 py-2 text-xs font-mono shadow-sm",
                        "placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                        "disabled:cursor-not-allowed disabled:opacity-50"
                      )}
                    />
                    <Button
                      type="button"
                      size="sm"
                      className="h-8 text-xs"
                      disabled={busy || editLoading || !editName.trim()}
                      onClick={() => void handleSaveEdit()}
                    >
                      保存技能
                    </Button>
                  </div>
                )}

                {selected.size !== 1 && (
                  <div className="flex flex-col gap-2 mt-3">
                    <Input
                      value={newSkillName}
                      onChange={(e) => setNewSkillName(e.target.value)}
                      placeholder="新建技能目录名（小写字母、数字、连字符）"
                      className="text-xs h-8"
                    />
                    <textarea
                      value={newSkillMarkdown}
                      onChange={(e) => setNewSkillMarkdown(e.target.value)}
                      placeholder="可选：自定义 SKILL.md 全文；留空则使用默认模板"
                      disabled={busy}
                      className={cn(
                        "flex min-h-[100px] w-full rounded-sm border border-input bg-background px-3 py-2 text-xs font-mono shadow-sm",
                        "placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                        "disabled:cursor-not-allowed disabled:opacity-50"
                      )}
                    />
                    <Button
                      type="button"
                      size="sm"
                      className="h-8 shrink-0 w-fit"
                      disabled={busy || !newSkillName.trim()}
                      onClick={() => void handleCreate()}
                    >
                      新建
                    </Button>
                  </div>
                )}
              </div>
            </>
          )}

          {!threadId && (
            <p className="text-xs text-muted-foreground">请选择会话以管理工作区内的技能文件夹。</p>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog open={skillDeleteConfirmOpen} onOpenChange={setSkillDeleteConfirmOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>确认删除技能？</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          将永久删除所选的 {selected.size} 个技能目录及其中的文件，此操作不可恢复。
        </p>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="secondary" onClick={() => setSkillDeleteConfirmOpen(false)}>
            取消
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => {
              setSkillDeleteConfirmOpen(false)
              void handleDeleteFolders()
            }}
          >
            删除
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  )
}
