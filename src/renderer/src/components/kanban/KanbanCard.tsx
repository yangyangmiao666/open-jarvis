import { MessageSquare, Loader2, Clock, Bot } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn, formatRelativeTime, truncate } from "@/lib/utils";
import { useThreadStream } from "@/lib/thread-context";
import { useTranslation } from "react-i18next";
import type { Thread, Subagent } from "@/types";

type KanbanStatus = "pending" | "in_progress" | "interrupted" | "done";

interface ThreadCardProps {
  thread: Thread;
  status: KanbanStatus;
  onClick: () => void;
}

interface SubagentCardProps {
  subagent: Subagent;
  parentThread: Thread;
  onClick: () => void;
}

function ThreadStatusIcon({
  threadId,
}: {
  threadId: string;
}): React.JSX.Element {
  const { isLoading } = useThreadStream(threadId);

  if (isLoading) {
    return (
      <Loader2 className="size-4 shrink-0 text-status-info animate-spin" />
    );
  }
  return <MessageSquare className="size-4 shrink-0 text-muted-foreground" />;
}

export function ThreadKanbanCard({
  thread,
  status,
  onClick,
}: ThreadCardProps): React.JSX.Element {
  const { t } = useTranslation('kanban');
  return (
    <Card
      className={cn(
        "cursor-pointer rounded-[24px] transition-all hover:-translate-y-1 hover:scale-[1.01]",
        status === "in_progress" && "border-status-info/45",
        status === "interrupted" && "!border-status-warning/45 !bg-status-warning/8",
      )}
      onClick={onClick}
    >
      <CardContent className="p-3">
        <div className="flex items-start gap-2">
          {status === "interrupted" ? (
            <MessageSquare className="size-4 shrink-0 text-status-warning" />
          ) : (
            <ThreadStatusIcon threadId={thread.thread_id} />
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium truncate">
                {thread.title || truncate(thread.thread_id, 20)}
              </span>
              {status === "done" && (
                <Badge variant="nominal" className="shrink-0 text-[9px]">
                  {t('card.completed')}
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-2 mt-1 text-[10px] text-muted-foreground">
              <Clock className="size-3" />
              {formatRelativeTime(thread.updated_at)}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function SubagentKanbanCard({
  subagent,
  parentThread,
  onClick,
}: SubagentCardProps): React.JSX.Element {
  const { t } = useTranslation('kanban');
  const isDone =
    subagent.status === "completed" || subagent.status === "failed";

  return (
    <Card
      className={cn(
        "cursor-pointer rounded-[24px] border-dashed transition-all hover:-translate-y-1 hover:scale-[1.01]",
        subagent.status === "running" && "border-status-info/50",
      )}
      onClick={onClick}
    >
      <CardContent className="p-3 overflow-hidden">
        <div className="flex items-start gap-2 min-w-0">
          <Bot
            className={cn(
              "size-4 shrink-0",
              subagent.status === "running"
                ? "text-status-info"
                : "text-muted-foreground",
            )}
          />
          <div className="flex-1 min-w-0 overflow-hidden">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium truncate">
                {subagent.name}
              </span>
              {isDone && (
                <Badge
                  variant={
                    subagent.status === "failed" ? "critical" : "nominal"
                  }
                  className="shrink-0 text-[9px]"
                >
                  {subagent.status === "failed" ? t('card.failed') : t('card.completed')}
                </Badge>
              )}
            </div>
            <p className="text-[10px] text-muted-foreground line-clamp-2 mt-0.5 break-words">
              {subagent.description}
            </p>
            <div className="flex items-center gap-1 mt-1 text-[10px] text-muted-foreground">
              <span className="truncate">
                ↳ {parentThread.title || truncate(parentThread.thread_id, 15)}
              </span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
