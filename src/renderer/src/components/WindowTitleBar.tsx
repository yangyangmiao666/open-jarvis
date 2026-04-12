import type { ReactElement } from "react"

/**
 * 独立标题栏：macOS 为交通灯预留左侧区域，中间为应用名（可拖拽移动窗口）。
 */
export function WindowTitleBar(): ReactElement {
  const isMac =
    typeof window !== "undefined" &&
    window.electron?.process?.platform === "darwin"

  return (
    <header
      className="window-titlebar app-drag-region relative flex h-8 w-full shrink-0 items-center border-b border-border bg-background"
      data-mac={isMac ? "" : undefined}
    >
      {/* 与系统交通灯对齐的占位（仅 macOS）；标题仍相对整窗水平居中 */}
      {isMac ? <div className="pointer-events-none w-[78px] shrink-0" aria-hidden /> : null}
      <h1 className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 select-none text-[13px] font-semibold tracking-tight text-foreground/90">
        Open-Jarvis
      </h1>
    </header>
  )
}
