import { Moon, Sun } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useAppStore } from "@/lib/store"
import { cn } from "@/lib/utils"

export function ThemeToggle({ className }: { className?: string }): React.JSX.Element {
  const colorMode = useAppStore((s) => s.colorMode)
  const toggleColorMode = useAppStore((s) => s.toggleColorMode)
  const isDark = colorMode === "dark"

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={cn("size-8 shrink-0 text-muted-foreground hover:text-foreground", className)}
      title={isDark ? "切换为亮色" : "切换为深色"}
      aria-label={isDark ? "切换为亮色" : "切换为深色"}
      onClick={() => toggleColorMode()}
    >
      {isDark ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </Button>
  )
}
