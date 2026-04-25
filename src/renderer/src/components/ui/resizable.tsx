import { useCallback, useRef } from "react";
import { GripVertical } from "lucide-react";

const HANDLE_WIDTH = 6; // px

interface ResizeHandleProps {
  onDrag: (totalDelta: number) => void;
}

export function ResizeHandle({ onDrag }: ResizeHandleProps) {
  const startXRef = useRef<number>(0);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      startXRef.current = e.clientX;

      const handleMouseMove = (e: MouseEvent) => {
        // Calculate total delta from drag start
        const totalDelta = e.clientX - startXRef.current;
        onDrag(totalDelta);
      };

      const handleMouseUp = () => {
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [onDrag],
  );

  return (
    <div
      onMouseDown={handleMouseDown}
      className="group relative flex shrink-0 cursor-col-resize select-none items-center justify-center bg-transparent"
      style={{ width: HANDLE_WIDTH }}
    >
      <div className="pointer-events-none absolute inset-y-3 left-1/2 w-px -translate-x-1/2 rounded-full bg-border/65 opacity-0 transition-all duration-200 group-hover:inset-y-1.5 group-hover:bg-primary/65 group-hover:opacity-100 group-active:opacity-100 group-active:bg-primary" />
      <GripVertical className="pointer-events-none size-4 text-muted-foreground/45 opacity-0 transition-all duration-200 group-hover:opacity-100 group-active:opacity-100 group-active:text-primary" />
    </div>
  );
}
