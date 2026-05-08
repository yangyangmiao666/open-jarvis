import { useCurrentThread } from "@/lib/thread-context";
import { TabBar } from "./TabBar";
import { FileViewer } from "./FileViewer";
import { ChatContainer } from "@/components/chat/ChatContainer";

interface TabbedPanelProps {
  threadId: string;
  showTabBar?: boolean;
  onOpenSettings: () => void;
}

export function TabbedPanel({
  threadId,
  showTabBar = true,
  onOpenSettings,
}: TabbedPanelProps): React.JSX.Element {
  const { activeTab, openFiles } = useCurrentThread(threadId);

  // Determine what to render based on active tab
  const isAgentTab = activeTab === "agent";
  const activeFile = openFiles.find((f) => f.path === activeTab);

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-transparent">
      {/* Tab Bar (optional - can be rendered externally in titlebar) */}
      {showTabBar && <TabBar />}

      {/* Subtle gradient fade from titlebar */}
      <div className="h-1 shrink-0 bg-gradient-to-b from-primary/30 via-accent/20 to-transparent" />

      {/* Content Area */}
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,color-mix(in_srgb,var(--primary)_8%,transparent),transparent_34%),radial-gradient(circle_at_bottom_right,color-mix(in_srgb,var(--accent)_8%,transparent),transparent_36%)]" />
        {isAgentTab ? (
          <ChatContainer threadId={threadId} onOpenSettings={onOpenSettings} />
        ) : activeFile ? (
          // Use key to force remount when file changes, ensuring fresh state
          <FileViewer
            key={activeFile.path}
            filePath={activeFile.path}
            threadId={threadId}
          />
        ) : (
          // Fallback - shouldn't happen but just in case
          <div className="flex flex-1 items-center justify-center text-muted-foreground">
            Select a tab to view content
          </div>
        )}
      </div>
    </div>
  );
}
