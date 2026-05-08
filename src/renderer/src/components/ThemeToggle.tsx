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
      variant="outline"
      size="icon"
      className={cn(
        "group rounded-[1rem] text-muted-foreground shadow-none hover:rotate-[4deg] hover:text-foreground",
        className,
      )}
      title={isDark ? "切换为亮色" : "切换为深色"}
      aria-label={isDark ? "切换为亮色" : "切换为深色"}
      onClick={() => toggleColorMode()}
    >
      {isDark ? <Sun className="size-4 transition-transform duration-300 group-hover:rotate-12" /> : <Moon className="size-4 transition-transform duration-300 group-hover:-rotate-12" />}
    </Button>
  );
}
