import { Bot } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAppStore } from "@/lib/store";
import { cn } from "@/lib/utils";

export function KanbanHeader({
  className,
}: {
  className?: string;
}): React.JSX.Element {
  const { showSubagentsInKanban, setShowSubagentsInKanban, threads } =
    useAppStore();

  const activeCount = threads.filter(
    (t) => t.status === "busy" || t.status === "interrupted",
  ).length;

  return (
    <div
      className={cn(
        "app-no-drag relative flex items-center justify-between overflow-hidden border-b border-border/60 bg-[linear-gradient(180deg,color-mix(in_srgb,var(--background-elevated)_84%,transparent),color-mix(in_srgb,var(--background)_40%,transparent))] px-3",
        className,
      )}
    >
      <div className="pointer-events-none absolute inset-y-0 left-0 w-24 bg-[radial-gradient(circle_at_left,color-mix(in_srgb,var(--primary)_10%,transparent),transparent_70%)]" />

      <div className="relative flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
        <div
          className={cn(
            "size-1.5 rounded-full",
            activeCount > 0
              ? "bg-status-nominal animate-tactical-pulse"
              : "bg-muted-foreground",
          )}
        />
        <span className="tabular-nums">
          {activeCount > 0 ? `${activeCount} 活跃` : "空闲"}
        </span>
      </div>

      {/* Right side - Controls */}
      <Button
        variant={showSubagentsInKanban ? "secondary" : "ghost"}
        size="sm"
        onClick={() => setShowSubagentsInKanban(!showSubagentsInKanban)}
        className="relative h-8 gap-2 rounded-full px-3"
      >
        <Bot className="size-3.5" />
        {showSubagentsInKanban ? "隐藏" : "显示"}子智能体
      </Button>
    </div>
  );
}
