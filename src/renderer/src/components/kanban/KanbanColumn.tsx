import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type ColumnStatus = "pending" | "in_progress" | "interrupted" | "done";

interface KanbanColumnProps {
  title: string;
  status: ColumnStatus;
  count: number;
  children: React.ReactNode;
}

const columnConfig: Record<
  ColumnStatus,
  { badge: "outline" | "info" | "warning" | "nominal"; tone: string }
> = {
  pending: { badge: "outline", tone: "bg-foreground/[0.03]" },
  in_progress: { badge: "info", tone: "bg-status-info/10" },
  interrupted: { badge: "warning", tone: "bg-status-warning/10" },
  done: { badge: "nominal", tone: "bg-status-nominal/10" },
};

export function KanbanColumn({
  title,
  status,
  count,
  children,
}: KanbanColumnProps): React.JSX.Element {
  const config = columnConfig[status];

  return (
    <div
      className={cn(
        "app-flat-surface flex min-w-[280px] w-[280px] flex-1 flex-col rounded-[26px] border border-border/70",
      )}
    >
      <div className="flex items-center justify-between border-b border-border/70 px-4 py-3">
        <span className="flex items-center gap-2 text-section-header">
          <span className={cn("size-2 rounded-full", config.tone)} />
          {title}
        </span>
        <Badge variant={config.badge}>{count}</Badge>
      </div>
      <ScrollArea className="app-subtle-scroll flex-1 min-h-0">
        <div className="space-y-3 p-3">{children}</div>
      </ScrollArea>
    </div>
  );
}
