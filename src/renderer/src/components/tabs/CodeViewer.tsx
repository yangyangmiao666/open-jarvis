import { useEffect, useState, useMemo } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAppStore } from "@/lib/store";
import {
  getHighlighter,
  getLanguageFromFilePath,
} from "@/lib/shiki-highlighter";

interface CodeViewerProps {
  filePath: string;
  content: string;
}

/** 单次遍历计数，避免大文件 `split('\n')` 分配巨型数组 */
function countLinesFast(s: string): number {
  if (s.length === 0) return 0;
  let n = 1;
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) === 10) n++;
  }
  return n;
}

function formatCharCount(n: number): string {
  if (n < 1024) return `${n} 字符`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

/** CSV/TSV 不走 Shiki，并截断预览，避免主线程长时间阻塞 */
const TABULAR_PREVIEW_MAX_CHARS = 800_000;

export function CodeViewer({
  filePath,
  content,
}: CodeViewerProps): React.JSX.Element {
  const [highlightedHtml, setHighlightedHtml] = useState<string | null>(null);
  const colorMode = useAppStore((s) => s.colorMode);
  const shikiTheme =
    colorMode === "light" ? "github-light-default" : "github-dark-default";

  const baseName = useMemo(
    () => filePath.split(/[/\\]/).pop() || filePath,
    [filePath],
  );

  const isTabularText = useMemo(
    () => /\.(csv|tsv)$/i.test(baseName),
    [baseName],
  );

  const tabularPreview = useMemo(() => {
    if (!isTabularText) return null;
    if (content.length <= TABULAR_PREVIEW_MAX_CHARS) {
      return { text: content, truncated: false as const };
    }
    return {
      text: content.slice(0, TABULAR_PREVIEW_MAX_CHARS),
      truncated: true as const,
    };
  }, [content, isTabularText]);

  const language = useMemo(() => getLanguageFromFilePath(filePath), [filePath]);

  const lineCount = useMemo(() => countLinesFast(content), [content]);

  useEffect(() => {
    let cancelled = false;

    if (isTabularText) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setHighlightedHtml(null);
      return;
    }

    async function highlight(): Promise<void> {
      if (content === undefined) {
        setHighlightedHtml(null);
        return;
      }

      try {
        const highlighter = await getHighlighter();

        if (cancelled) return;

        const html = highlighter.codeToHtml(content, {
          lang: language,
          theme: shikiTheme,
        });

        if (cancelled) return;

        setHighlightedHtml(html);
      } catch (e) {
        console.error("[CodeViewer] Shiki highlighting failed:", e);
        setHighlightedHtml(null);
      }
    }

    void highlight();

    return () => {
      cancelled = true;
    };
  }, [content, language, shikiTheme, isTabularText]);

  if (isTabularText && tabularPreview) {
    const previewLineCount = countLinesFast(tabularPreview.text);
    const kind = baseName.toLowerCase().endsWith(".tsv") ? "TSV" : "CSV";

    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex shrink-0 items-center gap-2 border-b border-border bg-background/50 px-4 py-2 text-xs text-muted-foreground">
          <span className="truncate">{filePath}</span>
          <span className="text-muted-foreground/50">•</span>
          <span>
            {tabularPreview.truncated ? "≥ " : ""}
            {previewLineCount.toLocaleString()} 行（预览）
          </span>
          <span className="text-muted-foreground/50">•</span>
          <span>{formatCharCount(content.length)}</span>
          <span className="text-muted-foreground/50">•</span>
          <span className="text-muted-foreground/70">{kind} 纯文本</span>
        </div>
        {tabularPreview.truncated && (
          <div className="shrink-0 border-b border-border bg-status-warning/10 px-4 py-1.5 text-[11px] text-muted-foreground">
            文件较大，仅预览前 {TABULAR_PREVIEW_MAX_CHARS.toLocaleString()}{" "}
            字符以降低卡顿；完整内容请用外部表格软件打开。
          </div>
        )}
        <ScrollArea className="min-h-0 flex-1">
          <pre className="break-all p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap">
            {tabularPreview.text}
          </pre>
        </ScrollArea>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-2 border-b border-border bg-background/50 px-4 py-2 text-xs text-muted-foreground">
        <span className="truncate">{filePath}</span>
        <span className="text-muted-foreground/50">•</span>
        <span>{lineCount.toLocaleString()} 行</span>
        <span className="text-muted-foreground/50">•</span>
        <span className="text-muted-foreground/70">{language}</span>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="shiki-wrapper">
          {highlightedHtml ? (
            <div
              className="shiki-content"
              dangerouslySetInnerHTML={{ __html: highlightedHtml }}
            />
          ) : (
            <pre className="break-all p-4 font-mono text-sm leading-relaxed whitespace-pre-wrap">
              {content}
            </pre>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
