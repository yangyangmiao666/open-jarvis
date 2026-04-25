import { useMemo } from "react";
import { useAppStore } from "@/lib/store";
import {
  useAllThreadStates,
  useAllStreamLoadingStates,
} from "@/lib/thread-context";
import { KanbanColumn } from "./KanbanColumn";
import { ThreadKanbanCard, SubagentKanbanCard } from "./KanbanCard";
import type { Thread, Subagent } from "@/types";

type KanbanStatus = "pending" | "in_progress" | "interrupted" | "done";

interface ThreadWithStatus {
  thread: Thread;
  status: KanbanStatus;
}

interface SubagentWithParent {
  subagent: Subagent;
  parentThread: Thread;
  status: KanbanStatus;
}

function getThreadKanbanStatus(
  thread: Thread,
  isLoading: boolean,
  hasDraft: boolean,
  hasPendingApproval: boolean,
): KanbanStatus {
  if (hasPendingApproval || thread.status === "interrupted")
    return "interrupted";
  if (thread.status === "busy" || isLoading) return "in_progress";
  if (hasDraft) return "pending";
  return "done";
}

export function KanbanView(): React.JSX.Element {
  const { threads, selectThread, showSubagentsInKanban } = useAppStore();
  const allThreadStates = useAllThreadStates();
  const loadingStates = useAllStreamLoadingStates();

  const handleCardClick = (threadId: string): void => {
    selectThread(threadId);
  };

  const categorizedThreads = useMemo(() => {
    const result: Record<KanbanStatus, ThreadWithStatus[]> = {
      pending: [],
      in_progress: [],
      interrupted: [],
      done: [],
    };

    for (const thread of threads) {
      const isLoading = loadingStates[thread.thread_id] ?? false;
      const threadState = allThreadStates[thread.thread_id];
      const hasDraft = Boolean(threadState?.draftInput?.trim());
      const hasPendingApproval = Boolean(threadState?.pendingApproval);
      const status = getThreadKanbanStatus(
        thread,
        isLoading,
        hasDraft,
        hasPendingApproval,
      );
      result[status].push({ thread, status });
    }

    return result;
  }, [threads, loadingStates, allThreadStates]);

  const categorizedSubagents = useMemo(() => {
    if (!showSubagentsInKanban) {
      return { pending: [], in_progress: [], interrupted: [], done: [] };
    }

    const result: Record<KanbanStatus, SubagentWithParent[]> = {
      pending: [],
      in_progress: [],
      interrupted: [],
      done: [],
    };

    const threadMap = new Map(threads.map((t) => [t.thread_id, t]));

    for (const [threadId, state] of Object.entries(allThreadStates)) {
      const parentThread = threadMap.get(threadId);
      if (!parentThread || !state.subagents) continue;

      for (const subagent of state.subagents) {
        let status: KanbanStatus;
        switch (subagent.status) {
          case "pending":
            status = "pending";
            break;
          case "running":
            status = "in_progress";
            break;
          case "completed":
            status = "done";
            break;
          case "failed":
            status = "done";
            break;
          default:
            status = "pending";
        }

        result[status].push({ subagent, parentThread, status });
      }
    }

    return result;
  }, [threads, allThreadStates, showSubagentsInKanban]);

  const columnData: { status: KanbanStatus; title: string }[] = [
    { status: "pending", title: "待处理" },
    { status: "in_progress", title: "进行中" },
    { status: "interrupted", title: "阻塞" },
    { status: "done", title: "已完成" },
  ];

  return (
    <div className="flex h-full flex-col bg-background/20">
      <div className="app-hairline shrink-0 px-4 py-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-section-header">Overview</div>
            <div className="text-xl font-semibold tracking-[-0.03em] text-foreground">
              会话与子智能体总览
            </div>
          </div>
          <div className="rounded-full border border-border/70 bg-card/70 px-3 py-1 text-xs text-muted-foreground">
            {threads.length} 个会话
          </div>
        </div>
      </div>
      <div className="flex-1 overflow-x-auto px-4 py-4">
        <div className="flex h-full min-w-max gap-4">
          {columnData.map(({ status, title }) => {
            const threadItems = categorizedThreads[status];
            const subagentItems = categorizedSubagents[status];
            const totalCount = threadItems.length + subagentItems.length;

            return (
              <KanbanColumn
                key={status}
                title={title}
                status={status}
                count={totalCount}
              >
                {threadItems.map(({ thread, status: threadStatus }) => (
                  <ThreadKanbanCard
                    key={thread.thread_id}
                    thread={thread}
                    status={threadStatus}
                    onClick={() => handleCardClick(thread.thread_id)}
                  />
                ))}
                {subagentItems.map(({ subagent, parentThread }) => (
                  <SubagentKanbanCard
                    key={subagent.id}
                    subagent={subagent}
                    parentThread={parentThread}
                    onClick={() => handleCardClick(parentThread.thread_id)}
                  />
                ))}
                {totalCount === 0 && (
                  <div className="rounded-2xl border border-dashed border-border/70 bg-background/35 px-4 py-8 text-center text-sm text-muted-foreground">
                    暂无条目
                  </div>
                )}
              </KanbanColumn>
            );
          })}
        </div>
      </div>
    </div>
  );
}
