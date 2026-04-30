import type { ReactElement } from "react";

/**
 * 独立标题栏：macOS 为交通灯预留左侧区域，标题与交通灯保持同一视觉行。
 */
export function WindowTitleBar(): ReactElement {
  const isMac =
    typeof window !== "undefined" &&
    window.electron?.process?.platform === "darwin";

  return (
    <header
      className="window-titlebar app-drag-region app-toolbar relative flex h-10 w-full shrink-0 items-center justify-between border-b border-border/70 px-3"
      data-mac={isMac ? "" : undefined}
    >
      {/* 与系统交通灯对齐的占位（仅 macOS）；标题保持绝对居中 */}
      {isMac ? (
        <div className="pointer-events-none w-[78px] shrink-0" aria-hidden />
      ) : null}
      <div className="pointer-events-none flex-1" aria-hidden />
      <h1 className="app-display-title pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 select-none text-[13px] text-foreground/92">
        Open-Jarvis
      </h1>
      {isMac ? (
        <div className="pointer-events-none w-[78px] shrink-0" aria-hidden />
      ) : (
        <div className="pointer-events-none flex-1" aria-hidden />
      )}
    </header>
  );
}
