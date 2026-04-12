import { ExternalLink } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useObjectUrlFromBase64 } from "@/lib/media-blob"

interface PDFViewerProps {
  filePath: string
  base64Content: string
}

export function PDFViewer({ filePath, base64Content }: PDFViewerProps): React.JSX.Element {
  const fileName = filePath.split("/").pop() || filePath
  const blobUrl = useObjectUrlFromBase64(base64Content, "application/pdf")
  const dataUrl = `data:application/pdf;base64,${base64Content}`
  const pdfUrl = blobUrl ?? dataUrl

  const handleOpenExternal = (): void => {
    const link = document.createElement("a")
    link.href = pdfUrl
    link.download = fileName
    link.click()
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border bg-background/50 px-4 py-2">
        <div className="flex min-w-0 items-center gap-2 overflow-hidden text-xs text-muted-foreground">
          <span className="truncate">{fileName}</span>
          <span className="shrink-0 text-muted-foreground/50">•</span>
          <span className="shrink-0">PDF 文档</span>
        </div>

        <Button variant="ghost" size="sm" onClick={handleOpenExternal} className="h-7 shrink-0 gap-1 px-2">
          <ExternalLink className="size-3" />
          <span className="text-xs">下载</span>
        </Button>
      </div>

      {/* 占满中间栏剩余高度，避免固定 min-height 导致底部留白 */}
      <div className="relative min-h-0 flex-1 bg-muted/20">
        <iframe title={fileName} src={pdfUrl} className="absolute inset-0 h-full w-full border-0 bg-background" />
      </div>

      <p className="shrink-0 border-t border-border/60 bg-background/80 px-4 py-1.5 text-center text-[10px] text-muted-foreground">
        若内嵌预览空白，请使用右上角下载后用系统阅读器打开。
      </p>
    </div>
  )
}
