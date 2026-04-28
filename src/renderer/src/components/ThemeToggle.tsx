import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAppStore } from "@/lib/store";
import { cn } from "@/lib/utils";

export function ThemeToggle({
  className,
}: {
  className?: string;
}): React.JSX.Element {
  const colorMode = useAppStore((s) => s.colorMode);
  const toggleColorMode = useAppStore((s) => s.toggleColorMode);
  const isDark = colorMode === "dark";

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={cn(
        "size-8 shrink-0 rounded-[0.95rem] border border-border/55 bg-card/40 text-muted-foreground shadow-[inset_0_1px_0_color-mix(in_srgb,#fff_8%,transparent)] backdrop-blur-md hover:border-border-emphasis hover:bg-card/72 hover:text-foreground",
        className,
      )}
      title={isDark ? "切换为亮色" : "切换为深色"}
      aria-label={isDark ? "切换为亮色" : "切换为深色"}
      onClick={() => toggleColorMode()}
    >
      {isDark ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </Button>
  );
}
