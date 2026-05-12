import { useCurrentThread } from "@/lib/thread-context";
import { TabBar } from "./TabBar";
import { FileViewer } from "./FileViewer";
import { ChatContainer } from "@/components/chat/ChatContainer";
import type { SettingsOpenRequest } from "@/types";

interface TabbedPanelProps {
  threadId: string;
  showTabBar?: boolean;
  onOpenSettings: (request?: SettingsOpenRequest) => void;
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

      {/* Content Area */}
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
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
