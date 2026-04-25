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
  { badge: "outline" | "info" | "warning" | "nominal"; borderColor: string }
> = {
  pending: { badge: "outline", borderColor: "border-t-border" },
  in_progress: { badge: "info", borderColor: "border-t-status-info" },
  interrupted: { badge: "warning", borderColor: "border-t-status-warning" },
  done: { badge: "nominal", borderColor: "border-t-status-nominal" },
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
        "app-flat-surface flex min-w-[280px] w-[280px] flex-1 flex-col rounded-[26px]",
        config.borderColor,
      )}
    >
      <div className="flex items-center justify-between border-b border-border/70 px-4 py-3">
        <span className="text-section-header">{title}</span>
        <Badge variant={config.badge}>{count}</Badge>
      </div>
      <ScrollArea className="flex-1 min-h-0">
        <div className="space-y-3 p-3">{children}</div>
      </ScrollArea>
    </div>
  );
}
