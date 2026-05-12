import { useEffect, useState, useCallback, useRef } from "react";
import { ThreadSidebar } from "@/components/sidebar/ThreadSidebar";
import { TabbedPanel, TabBar } from "@/components/tabs";
import { RightPanel } from "@/components/panels/RightPanel";
import { KanbanView, KanbanHeader } from "@/components/kanban";
import { ResizeHandle } from "@/components/ui/resizable";
import { ThemeToggle } from "@/components/ThemeToggle";
import { WindowTitleBar } from "@/components/WindowTitleBar";
import { SettingsHubDialog } from "@/components/chat/SettingsHubDialog";
import { Toaster } from "@/components/ui/toast";
import { useAppStore } from "@/lib/store";
import { ThreadProvider } from "@/lib/thread-context";
import type { SettingsOpenRequest } from "@/types";

// 左侧栏最小宽度（会话列表 + 品牌区）
const BADGE_MIN_SCREEN_WIDTH = 220;
const LEFT_MAX = 350;
const LEFT_DEFAULT = 220;

const RIGHT_MIN = 230;
const RIGHT_MAX = 450;
const RIGHT_DEFAULT = 280;

function isDarwin(): boolean {
  return window.electron?.process?.platform === "darwin";
}

interface AppShellProps {
  leftWidth: number;
  rightWidth: number;
  handleLeftResize: (delta: number) => void;
  handleRightResize: (delta: number) => void;
}

function AppShell({
  leftWidth,
  rightWidth,
  handleLeftResize,
  handleRightResize,
}: AppShellProps): React.JSX.Element {
  const { currentThreadId, showKanbanView, settingsOpen, setSettingsOpen } =
    useAppStore();
  const [settingsRequest, setSettingsRequest] = useState<SettingsOpenRequest | null>(
    null,
  );

  const handleOpenSettings = useCallback((request?: SettingsOpenRequest) => {
    setSettingsRequest(request ?? null);
    setSettingsOpen(true);
  }, [setSettingsOpen]);

  const handleSettingsOpenChange = useCallback((nextOpen: boolean) => {
    setSettingsOpen(nextOpen);
    if (!nextOpen) {
      setSettingsRequest(null);
    }
  }, [setSettingsOpen]);

  return (
    <div className="app-shell flex h-screen flex-col overflow-hidden bg-background">
      <div className="app-stage">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {isDarwin() ? <WindowTitleBar /> : null}

          <div className="flex min-h-0 flex-1 flex-row overflow-hidden">
            <div
              style={{ width: leftWidth }}
              className="app-sidebar-chrome flex shrink-0 flex-col overflow-hidden border-r border-border/70"
            >
              <ThreadSidebar onOpenSettings={handleOpenSettings} />
            </div>

            <ResizeHandle onDrag={handleLeftResize} />

            <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
              <div className="app-toolbar app-drag-region relative flex h-11 w-full shrink-0 border-b border-border/70">
                <div className="flex min-w-0 flex-1 items-stretch overflow-hidden">
                  <div className="min-w-0 flex-1 overflow-hidden">
                    {showKanbanView ? (
                      <KanbanHeader className="h-full" />
                    ) : (
                      currentThreadId && <TabBar className="h-full border-b-0" />
                    )}
                  </div>
                  <div className="app-no-drag flex shrink-0 items-center border-l border-border/50 px-2.5">
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
                        <TabbedPanel
                          threadId={currentThreadId}
                          showTabBar={false}
                          onOpenSettings={handleOpenSettings}
                        />
                      ) : (
                        <div className="flex flex-1 items-center justify-center text-muted-foreground">
                          请选择或新建会话以开始
                        </div>
                      )}
                    </main>
                    <ResizeHandle onDrag={handleRightResize} />
                    <div
                      style={{ width: rightWidth }}
                      className="app-panel shrink-0 border-l border-border/60"
                    >
                      <RightPanel />
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <SettingsHubDialog
        open={settingsOpen}
        onOpenChange={handleSettingsOpenChange}
        request={settingsRequest}
      />
    </div>
  );
}

function App(): React.JSX.Element {
  const {
    loadThreads,
    createThread,
  } = useAppStore();
  const [isLoading, setIsLoading] = useState(true);
  const [leftWidth, setLeftWidth] = useState(LEFT_DEFAULT);
  const [rightWidth, setRightWidth] = useState(RIGHT_DEFAULT);
  // Track drag start widths
  const dragStartWidths = useRef<{ left: number; right: number } | null>(null);

  const leftMinWidth = BADGE_MIN_SCREEN_WIDTH;

  // Enforce minimum width when zoom changes
  useEffect(() => {
    if (leftWidth < leftMinWidth) {
      setLeftWidth(leftMinWidth);
    }
  }, [leftMinWidth, leftWidth]);

  const handleLeftResize = useCallback(
    (totalDelta: number) => {
      if (!dragStartWidths.current) {
        dragStartWidths.current = { left: leftWidth, right: rightWidth };
      }
      const newWidth = dragStartWidths.current.left + totalDelta;
      setLeftWidth(Math.min(LEFT_MAX, Math.max(leftMinWidth, newWidth)));
    },
    [leftWidth, rightWidth, leftMinWidth],
  );

  const handleRightResize = useCallback(
    (totalDelta: number) => {
      if (!dragStartWidths.current) {
        dragStartWidths.current = { left: leftWidth, right: rightWidth };
      }
      const newWidth = dragStartWidths.current.right - totalDelta;
      setRightWidth(Math.min(RIGHT_MAX, Math.max(RIGHT_MIN, newWidth)));
    },
    [leftWidth, rightWidth],
  );

  // Reset drag start on mouse up
  useEffect(() => {
    const handleMouseUp = (): void => {
      dragStartWidths.current = null;
    };
    document.addEventListener("mouseup", handleMouseUp);
    return () => document.removeEventListener("mouseup", handleMouseUp);
  }, []);

  useEffect(() => {
    async function init(): Promise<void> {
      try {
        await loadThreads();
        // Create a default thread if none exist
        const threads = useAppStore.getState().threads;
        if (threads.length === 0) {
          await createThread();
        }
      } catch (error) {
        console.error("Failed to initialize:", error);
      } finally {
        setIsLoading(false);
      }
    }
    init();
  }, [loadThreads, createThread]);

  if (isLoading) {
    return (
      <div className="relative flex h-screen items-center justify-center overflow-hidden bg-background">
        <div className="app-flat-surface animate-scale-in relative rounded-[30px] px-8 py-6 text-center shadow-none">
          <div className="text-section-header">Booting Interface</div>
          <div className="mt-2 text-lg font-semibold tracking-[-0.03em] text-foreground">
            正在初始化…
          </div>
        </div>
      </div>
    );
  }

  return (
    <ThreadProvider>
      <AppShell
        leftWidth={leftWidth}
        rightWidth={rightWidth}
        handleLeftResize={handleLeftResize}
        handleRightResize={handleRightResize}
      />
      <Toaster position="top-center" richColors duration={2000} />
    </ThreadProvider>
  );
}

export default App;
