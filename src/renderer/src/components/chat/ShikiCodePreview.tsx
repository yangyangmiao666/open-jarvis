import { useEffect, useMemo, useState } from "react";
import { useAppStore } from "@/lib/store";
import { useTranslation } from "react-i18next";
import {
  getHighlighter,
  getLanguageFromFilePath,
} from "@/lib/shiki-highlighter";

interface ShikiCodePreviewProps {
  content: string;
  /** Virtual path for extension → language (e.g. tool read_file path) */
  filePath?: string;
  maxLines?: number;
}

export function ShikiCodePreview({
  content,
  filePath = "",
  maxLines = 10,
}: ShikiCodePreviewProps): React.JSX.Element {
  const [html, setHtml] = useState<string | null>(null);
  const colorMode = useAppStore((s) => s.colorMode);
  const { t } = useTranslation('chat');
  const theme =
    colorMode === "light" ? "github-light-default" : "github-dark-default";

  const lines = content.split("\n");
  const hasMore = lines.length > maxLines;
  const snippet = useMemo(
    () => lines.slice(0, maxLines).join("\n"),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [content, maxLines],
  );

  const lang = useMemo(
    () => getLanguageFromFilePath(filePath || "snippet.txt"),
    [filePath],
  );

  useEffect(() => {
    let cancelled = false;

    async function run(): Promise<void> {
      try {
        const highlighter = await getHighlighter();
        if (cancelled) return;
        const out = highlighter.codeToHtml(snippet, { lang, theme });
        if (!cancelled) setHtml(out);
      } catch (e) {
        console.error("[ShikiCodePreview]", e);
        if (!cancelled) setHtml(null);
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [snippet, lang, theme]);

  return (
    <div className="text-xs bg-background rounded-sm overflow-hidden w-full border border-border/60">
      <div className="shiki-wrapper max-h-40 overflow-auto">
        {html ? (
          <div
            className="shiki-content"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        ) : (
          <pre className="p-2 font-mono whitespace-pre-wrap break-all">
            {snippet}
          </pre>
        )}
      </div>
      {hasMore && (
        <div className="px-2 py-1 text-muted-foreground bg-background-elevated border-t border-border text-[10px]">
          … {t('workspacePicker.moreLines', { count: lines.length - maxLines })}
        </div>
      )}
    </div>
  );
}
