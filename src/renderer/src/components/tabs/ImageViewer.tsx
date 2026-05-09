import { useRef, useState } from "react";
import { useObjectUrlFromBase64 } from "@/lib/media-blob";
import { ZoomIn, ZoomOut, Maximize2, RotateCw, Hand } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ImageViewerProps {
  filePath: string;
  base64Content: string;
  mimeType: string;
}

export function ImageViewer({
  filePath,
  base64Content,
  mimeType,
}: ImageViewerProps): React.JSX.Element {
  const [zoom, setZoom] = useState(100);
  const [rotation, setRotation] = useState(0);
  const [isPanning, setIsPanning] = useState(false);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const panStartRef = useRef({ x: 0, y: 0 });

  const fileName = filePath.split("/").pop() || filePath;
  const blobUrl = useObjectUrlFromBase64(base64Content, mimeType);
  const imageUrl = blobUrl ?? `data:${mimeType};base64,${base64Content}`;

  const handleZoomIn = (): void => {
    const newZoom = Math.min(zoom + 25, 400);
    setZoom(newZoom);
    if (newZoom <= 100) {
      setPanOffset({ x: 0, y: 0 });
    }
  };

  const handleZoomOut = (): void => {
    const newZoom = Math.max(zoom - 25, 25);
    setZoom(newZoom);
    if (newZoom <= 100) {
      setPanOffset({ x: 0, y: 0 });
    }
  };

  const handleResetZoom = (): void => {
    setZoom(100);
    setRotation(0);
    setPanOffset({ x: 0, y: 0 });
  };

  const handleRotate = (): void => {
    setRotation((prev) => (prev + 90) % 360);
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (zoom > 100) {
      setIsPanning(true);
      panStartRef.current = {
        x: e.clientX - panOffset.x,
        y: e.clientY - panOffset.y,
      };
      e.currentTarget.setPointerCapture(e.pointerId);
      e.preventDefault();
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (isPanning && zoom > 100) {
      setPanOffset({
        x: e.clientX - panStartRef.current.x,
        y: e.clientY - panStartRef.current.y,
      });
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    setIsPanning(false);
  };

  const handlePointerCancel = (): void => {
    setIsPanning(false);
  };

  const canPan = zoom > 100;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border bg-background px-4 py-2">
        <div className="flex items-center gap-2 text-xs text-muted-foreground overflow-hidden">
          <span className="truncate">{fileName}</span>
          <span className="text-muted-foreground/50">•</span>
          <span>Image</span>
          {canPan && (
            <>
              <span className="text-muted-foreground/50">•</span>
              <span className="flex items-center gap-1">
                <Hand className="size-3" />
                Drag to pan
              </span>
            </>
          )}
        </div>

        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleZoomOut}
            disabled={zoom <= 25}
            className="h-7 px-2"
          >
            <ZoomOut className="size-4" />
          </Button>

          <span className="text-xs text-muted-foreground min-w-[3rem] text-center">
            {zoom}%
          </span>

          <Button
            variant="ghost"
            size="sm"
            onClick={handleZoomIn}
            disabled={zoom >= 400}
            className="h-7 px-2"
          >
            <ZoomIn className="size-4" />
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={handleRotate}
            className="h-7 px-2"
          >
            <RotateCw className="size-4" />
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={handleResetZoom}
            className="h-7 px-2"
          >
            <Maximize2 className="size-4" />
          </Button>
        </div>
      </div>

      <div
        ref={containerRef}
        className="relative min-h-0 flex-1 overflow-hidden bg-background"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        style={{
          cursor: canPan ? (isPanning ? "grabbing" : "grab") : "default",
          userSelect: "none",
          touchAction: "none",
        }}
      >
        <div className="absolute inset-0 flex items-center justify-center p-6">
          <img
            src={imageUrl}
            alt={fileName}
            className="max-h-full max-w-full object-contain transition-transform duration-150"
            style={{
              transform: `translate3d(${panOffset.x}px, ${panOffset.y}px, 0) scale(${zoom / 100}) rotate(${rotation}deg)`,
              transformOrigin: "center center",
              imageRendering: zoom > 100 ? "pixelated" : "auto",
              willChange: canPan ? "transform" : undefined,
            }}
            draggable={false}
          />
        </div>
      </div>
    </div>
  );
}
