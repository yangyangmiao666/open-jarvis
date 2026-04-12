import { useEffect, useState, useCallback, useRef } from "react"
import { ThreadSidebar } from "@/components/sidebar/ThreadSidebar"
import { TabbedPanel, TabBar } from "@/components/tabs"
import { RightPanel } from "@/components/panels/RightPanel"
import { KanbanView, KanbanHeader } from "@/components/kanban"
import { ResizeHandle } from "@/components/ui/resizable"
import { ThemeToggle } from "@/components/ThemeToggle"
import { WindowTitleBar } from "@/components/WindowTitleBar"
import { useAppStore } from "@/lib/store"
import { ThreadProvider } from "@/lib/thread-context"

// 左侧栏最小宽度（会话列表 + 品牌区）
const BADGE_MIN_SCREEN_WIDTH = 235
const LEFT_MAX = 350
const LEFT_DEFAULT = 240

const RIGHT_MIN = 250
const RIGHT_MAX = 450
const RIGHT_DEFAULT = 320

function isDarwin(): boolean {
  return window.electron?.process?.platform === "darwin"
}

function App(): React.JSX.Element {
  const { currentThreadId, loadThreads, createThread, showKanbanView } = useAppStore()
  const [isLoading, setIsLoading] = useState(true)
  const [leftWidth, setLeftWidth] = useState(LEFT_DEFAULT)
  const [rightWidth, setRightWidth] = useState(RIGHT_DEFAULT)

  // Track drag start widths
  const dragStartWidths = useRef<{ left: number; right: number } | null>(null)

  const leftMinWidth = BADGE_MIN_SCREEN_WIDTH

  // Enforce minimum width when zoom changes
  useEffect(() => {
    if (leftWidth < leftMinWidth) {
      setLeftWidth(leftMinWidth)
    }
  }, [leftMinWidth, leftWidth])

  const handleLeftResize = useCallback(
    (totalDelta: number) => {
      if (!dragStartWidths.current) {
        dragStartWidths.current = { left: leftWidth, right: rightWidth }
      }
      const newWidth = dragStartWidths.current.left + totalDelta
      setLeftWidth(Math.min(LEFT_MAX, Math.max(leftMinWidth, newWidth)))
    },
    [leftWidth, rightWidth, leftMinWidth]
  )

  const handleRightResize = useCallback(
    (totalDelta: number) => {
      if (!dragStartWidths.current) {
        dragStartWidths.current = { left: leftWidth, right: rightWidth }
      }
      const newWidth = dragStartWidths.current.right - totalDelta
      setRightWidth(Math.min(RIGHT_MAX, Math.max(RIGHT_MIN, newWidth)))
    },
    [leftWidth, rightWidth]
  )

  // Reset drag start on mouse up
  useEffect(() => {
    const handleMouseUp = (): void => {
      dragStartWidths.current = null
    }
    document.addEventListener("mouseup", handleMouseUp)
    return () => document.removeEventListener("mouseup", handleMouseUp)
  }, [])

  useEffect(() => {
    async function init(): Promise<void> {
      try {
        await loadThreads()
        // Create a default thread if none exist
        const threads = useAppStore.getState().threads
        if (threads.length === 0) {
          await createThread()
        }
      } catch (error) {
        console.error("Failed to initialize:", error)
      } finally {
        setIsLoading(false)
      }
    }
    init()
  }, [loadThreads, createThread])

  if (isLoading) {
    return (
        <div className="flex h-screen items-center justify-center bg-background">
        <div className="text-muted-foreground">正在初始化…</div>
      </div>
    )
  }

  return (
    <ThreadProvider>
      <div className="flex h-screen flex-col overflow-hidden bg-background">
        {isDarwin() ? <WindowTitleBar /> : null}

        <div className="flex min-h-0 flex-1 flex-row overflow-hidden">
          {/* 左侧栏：与标题栏下缘对齐（红绿灯下方），不再被整行标签条垫高一格 */}
          <div
            style={{ width: leftWidth }}
            className="flex shrink-0 flex-col overflow-hidden border-r border-border bg-sidebar"
          >
            <ThreadSidebar />
          </div>

          <ResizeHandle onDrag={handleLeftResize} />

          <div className="flex min-w-0 min-h-0 flex-1 flex-col overflow-hidden">
            <div className="app-drag-region flex h-9 w-full shrink-0 border-b border-border bg-background">
              <div className="flex min-w-0 flex-1 items-stretch overflow-hidden">
                <div className="min-w-0 flex-1 overflow-hidden">
                  {showKanbanView ? (
                    <KanbanHeader className="h-full" />
                  ) : (
                    currentThreadId && <TabBar className="h-full border-b-0" />
                  )}
                </div>
                <div className="app-no-drag flex shrink-0 items-center border-l border-border/60 pr-2">
                  <ThemeToggle />
                </div>
              </div>
            </div>

            <div className="flex min-h-0 min-w-0 flex-1 flex-row overflow-hidden">
              {showKanbanView ? (
                <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                  <KanbanView />
                </main>
              ) : (
                <>
                  <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                    {currentThreadId ? (
                      <TabbedPanel threadId={currentThreadId} showTabBar={false} />
                    ) : (
                      <div className="flex flex-1 items-center justify-center text-muted-foreground">
                        请选择或新建会话以开始
                      </div>
                    )}
                  </main>
                  <ResizeHandle onDrag={handleRightResize} />
                  <div style={{ width: rightWidth }} className="shrink-0">
                    <RightPanel />
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </ThreadProvider>
  )
}

export default App
