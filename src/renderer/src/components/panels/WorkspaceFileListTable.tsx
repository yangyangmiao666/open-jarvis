import { useMemo, useState, useCallback, useEffect, useRef } from "react"
import { ArrowDown, ArrowUp, GripVertical, ChevronDown, ChevronRight } from "lucide-react"
import { cn, formatDateTimeWithYear } from "@/lib/utils"
import { useAppStore } from "@/lib/store"
import { useThreadState } from "@/lib/thread-context"
import {
  buildFileTree,
  type TreeNode,
  type WorkspaceFileInfo
} from "@/lib/workspace-file-tree"

type SortColumn = "path" | "size" | "created" | "modified"
type SortMode = "asc" | "desc" | "default"

const COLS: { id: SortColumn; label: string; min: number; defaultWidth: number }[] = [
  { id: "path", label: "名称", min: 120, defaultWidth: 220 },
  { id: "size", label: "大小", min: 56, defaultWidth: 72 },
  { id: "created", label: "创建时间", min: 152, defaultWidth: 168 },
  { id: "modified", label: "更新时间", min: 152, defaultWidth: 168 }
]

function formatSize(n?: number): string {
  if (n === undefined) return "—"
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function storageKey(threadId: string | null, suffix: string): string {
  return `openwork-files-${threadId ?? "global"}-${suffix}`
}

interface WorkspaceFileListTableProps {
  files: WorkspaceFileInfo[]
  workspacePath: string | null
}

type FlatRow = { node: TreeNode; depth: number }

function flattenVisible(nodes: TreeNode[], expanded: Set<string>, depth: number): FlatRow[] {
  const out: FlatRow[] = []
  for (const node of nodes) {
    out.push({ node, depth })
    if (node.is_dir && expanded.has(node.path) && node.children.length > 0) {
      out.push(...flattenVisible(node.children, expanded, depth + 1))
    }
  }
  return out
}

function compareNodes(a: TreeNode, b: TreeNode, col: SortColumn, mult: number): number {
  let cmp = 0
  switch (col) {
    case "path": {
      if (a.is_dir !== b.is_dir) {
        return a.is_dir ? -1 : 1
      }
      return a.name.localeCompare(b.name) * mult
    }
    case "size": {
      const sa = a.is_dir ? -1 : (a.size ?? 0)
      const sb = b.is_dir ? -1 : (b.size ?? 0)
      cmp = sa - sb
      break
    }
    case "created": {
      const ta = a.created_at ? Date.parse(a.created_at) : 0
      const tb = b.created_at ? Date.parse(b.created_at) : 0
      cmp = ta - tb
      break
    }
    case "modified": {
      const ta = a.modified_at ? Date.parse(a.modified_at) : 0
      const tb = b.modified_at ? Date.parse(b.modified_at) : 0
      cmp = ta - tb
      break
    }
    default:
      cmp = 0
  }
  if (cmp !== 0) return cmp * mult
  return a.name.localeCompare(b.name) * mult
}

function sortTreeRecursive(nodes: TreeNode[], col: SortColumn, mode: SortMode): TreeNode[] {
  if (mode === "default") return nodes
  const mult = mode === "asc" ? 1 : -1
  const sorted = [...nodes].sort((a, b) => compareNodes(a, b, col, mult))
  return sorted.map((n) => ({
    ...n,
    children: sortTreeRecursive(n.children, col, mode)
  }))
}

export function WorkspaceFileListTable({
  files,
  workspacePath
}: WorkspaceFileListTableProps): React.JSX.Element {
  const { currentThreadId } = useAppStore()
  const threadState = useThreadState(currentThreadId)
  const openFile = threadState?.openFile

  const [sortColumn, setSortColumn] = useState<SortColumn | null>(null)
  const [sortMode, setSortMode] = useState<SortMode>("default")
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())

  const [widths, setWidths] = useState<Record<SortColumn, number>>(() =>
    Object.fromEntries(COLS.map((c) => [c.id, c.defaultWidth])) as Record<SortColumn, number>
  )

  const resizeRef = useRef<{ col: SortColumn; startX: number; startW: number } | null>(null)

  const filesIdentity = useMemo(() => files.map((f) => f.path).join("\0"), [files])

  useEffect(() => {
    setExpanded(new Set())
  }, [filesIdentity])

  useEffect(() => {
    const raw = localStorage.getItem(storageKey(currentThreadId, "cols"))
    if (!raw) return
    try {
      const parsed = JSON.parse(raw) as Partial<Record<SortColumn, number>>
      setWidths((w) => ({ ...w, ...parsed }))
    } catch {
      /* ignore */
    }
  }, [currentThreadId, workspacePath])

  useEffect(() => {
    const raw = localStorage.getItem(storageKey(currentThreadId, "sort"))
    if (!raw) return
    try {
      const parsed = JSON.parse(raw) as { col: SortColumn | null; mode: SortMode }
      setSortColumn(parsed.col)
      setSortMode(parsed.mode ?? "default")
    } catch {
      /* ignore */
    }
  }, [currentThreadId, workspacePath])

  useEffect(() => {
    localStorage.setItem(
      storageKey(currentThreadId, "sort"),
      JSON.stringify({ col: sortColumn, mode: sortMode })
    )
  }, [currentThreadId, sortColumn, sortMode])

  useEffect(() => {
    localStorage.setItem(storageKey(currentThreadId, "cols"), JSON.stringify(widths))
  }, [currentThreadId, widths])

  const tree = useMemo(() => buildFileTree(files), [files])

  const orderedTree = useMemo(() => {
    if (!sortColumn || sortMode === "default") return tree
    return sortTreeRecursive(tree, sortColumn, sortMode)
  }, [tree, sortColumn, sortMode])

  const flatRows = useMemo(
    () => flattenVisible(orderedTree, expanded, 0),
    [orderedTree, expanded]
  )

  const totalTableWidth = useMemo(
    () => COLS.reduce((sum, c) => sum + widths[c.id], 0),
    [widths]
  )

  const onHeaderClick = useCallback(
    (col: SortColumn) => {
      if (sortColumn !== col) {
        setSortColumn(col)
        setSortMode("asc")
        return
      }
      if (sortMode === "asc") setSortMode("desc")
      else if (sortMode === "desc") {
        setSortMode("default")
        setSortColumn(null)
      } else setSortMode("asc")
    },
    [sortColumn, sortMode]
  )

  const onResizeStart = useCallback(
    (col: SortColumn, e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      resizeRef.current = { col, startX: e.clientX, startW: widths[col] }
      const onMove = (ev: MouseEvent): void => {
        const r = resizeRef.current
        if (!r) return
        const delta = ev.clientX - r.startX
        const def = COLS.find((c) => c.id === r.col)!
        const next = Math.max(def.min, r.startW + delta)
        setWidths((w) => ({ ...w, [r.col]: next }))
      }
      const onUp = (): void => {
        resizeRef.current = null
        document.removeEventListener("mousemove", onMove)
        document.removeEventListener("mouseup", onUp)
        document.body.style.cursor = ""
        document.body.style.userSelect = ""
      }
      document.addEventListener("mousemove", onMove)
      document.addEventListener("mouseup", onUp)
      document.body.style.cursor = "col-resize"
      document.body.style.userSelect = "none"
    },
    [widths]
  )

  const SortIcon = ({ col }: { col: SortColumn }): React.JSX.Element => {
    if (sortColumn !== col || sortMode === "default") {
      return <span className="inline-block w-3.5 h-3.5 opacity-30">↕</span>
    }
    return sortMode === "asc" ? (
      <ArrowUp className="size-3.5 shrink-0" />
    ) : (
      <ArrowDown className="size-3.5 shrink-0" />
    )
  }

  const displayName = (path: string): string => {
    const p = path.startsWith("/") ? path.slice(1) : path
    const parts = p.split("/")
    return parts[parts.length - 1] || path
  }

  const toggleDir = useCallback((path: string, e: React.MouseEvent): void => {
    e.stopPropagation()
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }, [])

  return (
    <div className="min-h-0 flex-1 overflow-x-auto">
      <table className="table-fixed border-collapse text-xs" style={{ width: totalTableWidth }}>
        <colgroup>
          {COLS.map((col) => (
            <col key={col.id} style={{ width: widths[col.id] }} />
          ))}
        </colgroup>
        <thead>
          <tr className="border-b border-border bg-muted/40">
            {COLS.map((col) => (
              <th
                key={col.id}
                style={{ minWidth: col.min }}
                className="relative px-2 py-1.5 text-left font-medium text-muted-foreground select-none"
              >
                <button
                  type="button"
                  className="flex w-full min-w-0 items-center gap-1 pr-3 hover:text-foreground"
                  onClick={() => onHeaderClick(col.id)}
                >
                  <span className="truncate">{col.label}</span>
                  <SortIcon col={col.id} />
                </button>
                <button
                  type="button"
                  aria-label={`调整「${col.label}」列宽`}
                  className="absolute top-0 right-0 z-10 flex h-full w-4 cursor-col-resize items-center justify-center border-0 bg-transparent p-0 hover:bg-primary/25"
                  onMouseDown={(e) => onResizeStart(col.id, e)}
                >
                  <GripVertical className="size-3.5 opacity-50 pointer-events-none" />
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {flatRows.map(({ node, depth }) => {
            const isOpen = expanded.has(node.path)
            const pad = 8 + depth * 16
            return (
              <tr
                key={node.path}
                className={cn(
                  "border-b border-border/40 hover:bg-background-interactive/80 cursor-pointer",
                  node.is_dir && "opacity-90"
                )}
                onClick={() => {
                  if (node.is_dir) {
                    setExpanded((prev) => {
                      const next = new Set(prev)
                      if (next.has(node.path)) next.delete(node.path)
                      else next.add(node.path)
                      return next
                    })
                  } else if (openFile) {
                    openFile(node.path, displayName(node.path))
                  }
                }}
              >
                <td className="truncate px-2 py-1 font-mono" title={node.path}>
                  <div className="flex items-center min-w-0" style={{ paddingLeft: pad }}>
                    {node.is_dir ? (
                      <button
                        type="button"
                        className="w-4 shrink-0 flex items-center justify-center mr-0.5"
                        onClick={(e) => toggleDir(node.path, e)}
                      >
                        {node.children.length > 0 ? (
                          isOpen ? (
                            <ChevronDown className="size-3 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="size-3 text-muted-foreground" />
                          )
                        ) : (
                          <span className="w-3" />
                        )}
                      </button>
                    ) : (
                      <span className="w-4 shrink-0" />
                    )}
                    <span className="truncate">
                      {node.is_dir ? "📁 " : ""}
                      {node.name}
                    </span>
                  </div>
                </td>
                <td className="px-2 py-1 tabular-nums text-muted-foreground">
                  {node.is_dir ? "—" : formatSize(node.size)}
                </td>
                <td className="px-2 py-1 text-muted-foreground whitespace-nowrap">
                  {node.created_at ? formatDateTimeWithYear(node.created_at) : "—"}
                </td>
                <td className="px-2 py-1 text-muted-foreground whitespace-nowrap">
                  {node.modified_at ? formatDateTimeWithYear(node.modified_at) : "—"}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
