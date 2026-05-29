import {
  AlertCircle,
  BarChart3,
  Copy,
  Download,
  Eye,
  EyeOff,
  GitBranch,
  Globe,
  Maximize2,
  Search,
  Sparkles,
  SquareCode,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import React, {
  Component,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ErrorInfo,
} from "react";
import * as echarts from "echarts";
import mermaid from "mermaid";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/lib/toast";
import i18n from "@/lib/locales";
import { copyImageDataUrlToClipboard } from "@/lib/image-clipboard";

const HTML_LANGUAGES = new Set(["html", "htm"]);
const ECHARTS_LANGUAGES = new Set(["echarts", "echart", "chart"]);
const MERMAID_LANGUAGES = new Set(["mermaid"]);

const MIN_SCALE = 0.5;
const MAX_SCALE = 3;
const SCALE_STEP = 0.2;

interface MarkdownRichCodeBlockProps {
  language?: string;
  code: string;
  hideSource?: boolean;
  isStreaming?: boolean;
}

interface PreviewErrorBoundaryProps {
  children: React.JSX.Element;
  fallbackTitle: string;
}

interface PreviewErrorBoundaryState {
  hasError: boolean;
  message: string;
}

class PreviewErrorBoundary extends Component<
  PreviewErrorBoundaryProps,
  PreviewErrorBoundaryState
> {
  state: PreviewErrorBoundaryState = {
    hasError: false,
    message: "",
  };

  static getDerivedStateFromError(error: unknown): PreviewErrorBoundaryState {
    return {
      hasError: true,
      message:
        error instanceof Error
          ? error.message
          : "预览渲染失败，生成的代码可能存在语法或结构问题。",
    };
  }

  componentDidCatch(error: unknown, errorInfo: ErrorInfo): void {
    console.error("[MarkdownRichCodeBlock] Preview render failed", {
      error,
      errorInfo,
    });
  }

  render(): React.JSX.Element {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-55 items-center gap-3 rounded-[18px] border border-status-warning/30 bg-status-warning/8 px-4 py-5 text-sm text-status-warning">
          <AlertCircle className="size-4 shrink-0" />
          <span>
            {this.props.fallbackTitle}渲染失败：{this.state.message}
          </span>
        </div>
      );
    }

    return this.props.children;
  }
}

function normalizeLanguage(language?: string): string {
  return language?.trim().toLowerCase() ?? "";
}

function buildHtmlDocument(source: string): string {
  const trimmed = source.trim();
  if (/<!doctype\s+html/i.test(trimmed) || /<html[\s>]/i.test(trimmed)) {
    if (/<meta[^>]+http-equiv=["']Content-Security-Policy["']/i.test(trimmed)) {
      return /<html[^>]*\slang=/i.test(trimmed)
        ? trimmed
        : trimmed.replace(/<html([^>]*)>/i, `<html$1 lang="zh-CN">`);
    }

    const injectedCsp = `<meta http-equiv="Content-Security-Policy" content="default-src 'self' data: blob: https: http:; script-src 'unsafe-inline' 'unsafe-eval' blob: data: https: http:; script-src-elem 'unsafe-inline' blob: data: https: http:; style-src 'unsafe-inline' https: http:; img-src data: blob: https: http:; font-src data: blob: https: http:; connect-src data: blob: https: http: ws: wss:; worker-src blob: data:;">`;

    const htmlWithLang = /<html[^>]*\slang=/i.test(trimmed)
      ? trimmed
      : trimmed.replace(/<html([^>]*)>/i, `<html$1 lang="zh-CN">`);

    if (/<head[^>]*>/i.test(htmlWithLang)) {
      return htmlWithLang.replace(/<head([^>]*)>/i, `<head$1>\n    ${injectedCsp}`);
    }

    return htmlWithLang.replace(/<html([^>]*)>/i, `<html$1>\n  <head>\n    ${injectedCsp}\n  </head>`);
  }

  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'self' data: blob: https: http:; script-src 'unsafe-inline' 'unsafe-eval' blob: data: https: http:; script-src-elem 'unsafe-inline' blob: data: https: http:; style-src 'self' 'unsafe-inline' https: http:; img-src data: blob: https: http:; font-src data: blob: https: http:; connect-src data: blob: https: http: ws: wss:; worker-src blob: data:;" />
    <style>
      :root { color-scheme: light dark; }
      body {
        margin: 0;
        padding: 16px;
        font-family: "SF Pro Display", "PingFang SC", sans-serif;
        background: transparent;
      }
    </style>
  </head>
  <body>
${source}
  </body>
</html>`;
}

function isIdentifierBoundary(char: string | undefined): boolean {
  if (!char) {
    return true;
  }
  return !/[A-Za-z0-9_$]/.test(char);
}

function stripFunctionExpressionsForJson(source: string): {
  sanitized: string;
  replacedCount: number;
} {
  let i = 0;
  let replacedCount = 0;
  const out: string[] = [];

  while (i < source.length) {
    const char = source[i];

    if (char === '"' || char === "'") {
      const quote = char;
      out.push(char);
      i += 1;
      while (i < source.length) {
        const current = source[i];
        out.push(current);
        i += 1;
        if (current === "\\") {
          if (i < source.length) {
            out.push(source[i]);
            i += 1;
          }
          continue;
        }
        if (current === quote) {
          break;
        }
      }
      continue;
    }

    if (
      source.startsWith("function", i) &&
      isIdentifierBoundary(source[i - 1]) &&
      isIdentifierBoundary(source[i + "function".length])
    ) {
      const start = i;
      i += "function".length;

      while (i < source.length && /\s/.test(source[i])) {
        i += 1;
      }

      if (source[i] !== "(") {
        out.push(source[start]);
        i = start + 1;
        continue;
      }

      let parenDepth = 0;
      while (i < source.length) {
        const current = source[i];
        if (current === "(") {
          parenDepth += 1;
          i += 1;
          continue;
        }
        if (current === ")") {
          parenDepth -= 1;
          i += 1;
          if (parenDepth === 0) {
            break;
          }
          continue;
        }
        if (current === '"' || current === "'") {
          const quote = current;
          i += 1;
          while (i < source.length) {
            const strChar = source[i];
            i += 1;
            if (strChar === "\\") {
              i += 1;
              continue;
            }
            if (strChar === quote) {
              break;
            }
          }
          continue;
        }
        i += 1;
      }

      while (i < source.length && /\s/.test(source[i])) {
        i += 1;
      }

      if (source[i] !== "{") {
        out.push(source[start]);
        i = start + 1;
        continue;
      }

      let braceDepth = 0;
      while (i < source.length) {
        const current = source[i];
        if (current === "{") {
          braceDepth += 1;
          i += 1;
          continue;
        }
        if (current === "}") {
          braceDepth -= 1;
          i += 1;
          if (braceDepth === 0) {
            break;
          }
          continue;
        }
        if (current === '"' || current === "'") {
          const quote = current;
          i += 1;
          while (i < source.length) {
            const strChar = source[i];
            i += 1;
            if (strChar === "\\") {
              i += 1;
              continue;
            }
            if (strChar === quote) {
              break;
            }
          }
          continue;
        }
        i += 1;
      }

      out.push("null");
      replacedCount += 1;
      continue;
    }

    out.push(char);
    i += 1;
  }

  return {
    sanitized: out.join(""),
    replacedCount,
  };
}

function escapeLiteralNewlinesInStrings(source: string): string {
  let i = 0;
  const out: string[] = [];

  while (i < source.length) {
    const char = source[i];

    if (char === '"' || char === "'") {
      const quote = char;
      out.push(char);
      i += 1;

      while (i < source.length) {
        const current = source[i];

        if (current === "\\") {
          out.push(current);
          i += 1;
          if (i < source.length) {
            out.push(source[i]);
            i += 1;
          }
          continue;
        }

        if (current === "\n") {
          out.push("\\n");
          i += 1;
          continue;
        }

        if (current === "\r") {
          out.push("\\r");
          i += 1;
          continue;
        }

        out.push(current);
        i += 1;

        if (current === quote) {
          break;
        }
      }

      continue;
    }

    out.push(char);
    i += 1;
  }

  return out.join("");
}

function evaluateEChartsOptionExpression(source: string): echarts.EChartsOption {
  const normalizedSource = escapeLiteralNewlinesInStrings(source);

  return new Function(
    `"use strict"; return (${normalizedSource});`,
  )() as echarts.EChartsOption;
}

function parseEChartsOption(source: string): { option: echarts.EChartsOption | null; error: string | null } {
  const trimmed = source.trim();
  const optionMatch = trimmed.match(/(?:const|let|var)?\s*option\s*=\s*([\s\S]*?);?\s*$/);
  const candidate = optionMatch?.[1]?.trim() || trimmed;
  const normalizedCandidate = escapeLiteralNewlinesInStrings(candidate);

  try {
    return {
      option: JSON.parse(normalizedCandidate) as echarts.EChartsOption,
      error: null,
    };
  } catch {
    try {
      // CSP 禁止 eval/new Function，这里改为无执行解析：
      // 将 function 回调占位为 null，让主体 option 结构可被 JSON.parse 并继续渲染。
      const { sanitized, replacedCount } = stripFunctionExpressionsForJson(
        normalizedCandidate,
      );
      const option = JSON.parse(sanitized) as echarts.EChartsOption;
      return {
        option,
        error:
          replacedCount > 0
            ? "检测到 function 回调，已自动降级为静态值后渲染（颜色/formatter 等动态逻辑可能与原始效果略有差异）。"
            : null,
      };
    } catch {
      try {
        return {
          option: evaluateEChartsOptionExpression(candidate),
          error: null,
        };
      } catch {
    return {
      option: null,
      error:
        "ECharts 代码块当前需要有效的 option 对象（支持 JSON、含 function/箭头函数的 JS 对象字面量，以及常见的 map/三元表达式），例如 {\"title\":{\"text\":\"Demo\"},\"xAxis\":{...}}。",
    };
      }
    }
  }
}

function clampScale(nextScale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, nextScale));
}

interface DiagramViewportState {
  scale: number;
  offsetX: number;
  offsetY: number;
}

interface DiagramViewportProps {
  children: React.JSX.Element;
  minHeight?: number;
  className?: string;
  contentClassName?: string;
  controlsClassName?: string;
  onSaveImage?: () => void;
  onCopyImage?: () => void;
}

function DiagramViewport({
  children,
  minHeight = 320,
  className,
  contentClassName,
  controlsClassName,
  onSaveImage,
  onCopyImage,
}: DiagramViewportProps): React.JSX.Element {
  const [state, setState] = useState<DiagramViewportState>({
    scale: 1,
    offsetX: 0,
    offsetY: 0,
  });
  const dragStateRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    offsetX: number;
    offsetY: number;
  } | null>(null);

  const zoomBy = (delta: number) => {
    setState((current) => ({
      ...current,
      scale: clampScale(Number((current.scale + delta).toFixed(2))),
    }));
  };

  const resetView = () => {
    setState({ scale: 1, offsetX: 0, offsetY: 0 });
  };

  return (
    <div
      className={cn(
        "group/viewport relative w-full min-w-0 overflow-hidden rounded-[18px] border border-border/60 bg-white dark:bg-background",
        className,
      )}
    >
      <div
        className={cn(
          "pointer-events-none absolute right-3 top-3 z-10 flex items-center gap-1 rounded-full border border-border/70 bg-background/88 p-1 opacity-0 shadow-sm backdrop-blur-sm transition-opacity duration-150 group-hover/viewport:pointer-events-auto group-hover/viewport:opacity-100 group-focus-within/viewport:pointer-events-auto group-focus-within/viewport:opacity-100",
          controlsClassName,
        )}
      >
        <Button type="button" variant="ghost" size="icon-sm" onClick={() => zoomBy(-SCALE_STEP)} title="缩小">
          <ZoomOut className="size-3.5" />
        </Button>
        <Button type="button" variant="ghost" size="icon-sm" onClick={resetView} title="重置缩放">
          <Search className="size-3.5" />
        </Button>
        <Button type="button" variant="ghost" size="icon-sm" onClick={() => zoomBy(SCALE_STEP)} title="放大">
          <ZoomIn className="size-3.5" />
        </Button>
        {onSaveImage ? (
          <Button type="button" variant="ghost" size="icon-sm" onClick={onSaveImage} title="保存图片">
            <Download className="size-3.5" />
          </Button>
        ) : null}
        {onCopyImage ? (
          <Button type="button" variant="ghost" size="icon-sm" onClick={onCopyImage} title="复制图片">
            <Copy className="size-3.5" />
          </Button>
        ) : null}
      </div>
      <div
        className="relative cursor-grab overflow-hidden active:cursor-grabbing"
        style={{ minHeight }}
        onPointerDown={(event) => {
          dragStateRef.current = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            offsetX: state.offsetX,
            offsetY: state.offsetY,
          };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const dragState = dragStateRef.current;
          if (!dragState || dragState.pointerId !== event.pointerId) {
            return;
          }

          setState((current) => ({
            ...current,
            offsetX: dragState.offsetX + event.clientX - dragState.startX,
            offsetY: dragState.offsetY + event.clientY - dragState.startY,
          }));
        }}
        onPointerUp={(event) => {
          if (dragStateRef.current?.pointerId === event.pointerId) {
            dragStateRef.current = null;
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
        }}
        onPointerCancel={(event) => {
          if (dragStateRef.current?.pointerId === event.pointerId) {
            dragStateRef.current = null;
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
        }}
      >
        <div
          className={cn("flex min-h-[inherit] items-center justify-center p-4", contentClassName)}
          style={{
            transform: `translate(${state.offsetX}px, ${state.offsetY}px) scale(${state.scale})`,
            transformOrigin: "center center",
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

function PreviewFrame({
  code,
  expanded = false,
}: {
  code: string;
  expanded?: boolean;
}): React.JSX.Element {
  const documentHtml = useMemo(() => buildHtmlDocument(code), [code]);
  const previewUrl = useMemo(
    () => `data:text/html;charset=utf-8,${encodeURIComponent(documentHtml)}`,
    [documentHtml],
  );

  return (
    <DiagramViewport
      minHeight={expanded ? 640 : 320}
      className={expanded ? "bg-[linear-gradient(180deg,color-mix(in_srgb,var(--background)_82%,white),var(--background))]" : undefined}
      contentClassName={expanded ? "p-6" : undefined}
    >
      <iframe
        title="HTML Preview"
        sandbox="allow-scripts allow-same-origin"
        src={previewUrl}
        className={cn(
          "rounded-[18px] border border-border/60 bg-white",
          expanded ? "h-160 w-275" : "h-80 w-full min-w-0",
        )}
      />
    </DiagramViewport>
  );
}

function EChartsPreview({
  code,
  expanded = false,
}: {
  code: string;
  expanded?: boolean;
}): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartInstanceRef = useRef<echarts.ECharts | null>(null);
  const [error, setError] = useState<string | null>(null);
  const parsed = useMemo(() => parseEChartsOption(code), [code]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !parsed.option) {
      setError(parsed.error ?? null);
      return;
    }

    setError(null);
    let chart: echarts.ECharts | null = null;
    let resizeObserver: ResizeObserver | null = null;

    try {
      chart = echarts.init(container, undefined, {
        renderer: "canvas",
      });
      chart.setOption(parsed.option);
      chartInstanceRef.current = chart;

      resizeObserver = new ResizeObserver(() => {
        chart?.resize();
      });
      resizeObserver.observe(container);
    } catch (renderError) {
      setError(
        renderError instanceof Error
          ? renderError.message
          : "ECharts 渲染失败，请检查 option 结构是否有效。",
      );
      if (chart) {
        chart.dispose();
      }
      return;
    }

    return () => {
      chartInstanceRef.current = null;
      resizeObserver?.disconnect();
      chart?.dispose();
    };
  }, [parsed.error, parsed.option]);

  const handleSaveImage = useCallback(() => {
    const chart = chartInstanceRef.current;
    if (!chart) {
      toast.error("图表尚未渲染，无法保存");
      return;
    }
    try {
      // 确保图表完全渲染
      chart.resize();

      const chartOption = chart.getOption() as echarts.EChartsOption & {
        backgroundColor?: unknown;
      };
      const optionBackground = Array.isArray(chartOption.backgroundColor)
        ? chartOption.backgroundColor[0]
        : chartOption.backgroundColor;
      const containerBackground = window.getComputedStyle(chart.getDom()).backgroundColor;
      const exportBackgroundColor =
        typeof optionBackground === "string"
          ? optionBackground
          : containerBackground && containerBackground !== "rgba(0, 0, 0, 0)"
            ? containerBackground
            : undefined;

      const url = chart.getDataURL({
        type: "png",
        pixelRatio: 10,
        backgroundColor: exportBackgroundColor,
      });
      const link = document.createElement("a");
      link.href = url;
      link.download = "echarts-chart.png";
      link.click();
    } catch {
      toast.error("图片保存失败");
    }
  }, []);

  const handleCopyImage = useCallback(() => {
    const chart = chartInstanceRef.current;
    if (!chart) {
      toast.error("图表尚未渲染，无法复制");
      return;
    }

    try {
      chart.resize();
      const url = chart.getDataURL({
        type: "png",
        pixelRatio: 4,
      });
      void copyImageDataUrlToClipboard(url);
    } catch {
      toast.error("图片复制失败");
    }
  }, []);

  if (error) {
    return (
      <div className="flex min-h-55 items-center gap-3 rounded-[18px] border border-status-warning/30 bg-status-warning/8 px-4 py-5 text-sm text-status-warning">
        <AlertCircle className="size-4 shrink-0" />
        <span>{error}</span>
      </div>
    );
  }

  return (
    <DiagramViewport
      minHeight={expanded ? 640 : 320}
      contentClassName={expanded ? "p-6" : undefined}
      onSaveImage={handleSaveImage}
      onCopyImage={handleCopyImage}
    >
      <div
        ref={containerRef}
        className={cn(
          "rounded-[18px] border border-border/60 bg-background",
          expanded ? "h-160 w-275" : "h-80 w-full min-w-0",
        )}
      />
    </DiagramViewport>
  );
}

function MermaidPreview({
  code,
  expanded = false,
}: {
  code: string;
  expanded?: boolean;
}): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgStringRef = useRef<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hasSvg, setHasSvg] = useState(false);

  const renderMermaidPngDataUrl = useCallback((): Promise<string> => {
    const container = containerRef.current;
    if (!container) {
      return Promise.reject(new Error("暂无可复制的图表"));
    }

    const renderedSvg = container.querySelector("svg");
    if (!renderedSvg) {
      return Promise.reject(new Error("暂无可复制的图表"));
    }

    const svgClone = renderedSvg.cloneNode(true) as SVGSVGElement;
    svgClone.setAttribute("xmlns", "http://www.w3.org/2000/svg");

    let width = 0;
    let height = 0;
    const viewBox = svgClone.getAttribute("viewBox");
    if (viewBox) {
      const parts = viewBox.trim().split(/[\s,]+/);
      width = parseFloat(parts[2] ?? "0") || 0;
      height = parseFloat(parts[3] ?? "0") || 0;
    }

    if (!width || !height) {
      try {
        const bbox = renderedSvg.getBBox();
        width = bbox.width || width;
        height = bbox.height || height;
      } catch {
        // fall through to attribute fallback
      }
    }

    if (!width || !height) {
      width = parseFloat(svgClone.getAttribute("width") ?? "0") || 1600;
      height = parseFloat(svgClone.getAttribute("height") ?? "0") || 1200;
    }

    svgClone.setAttribute("width", String(width));
    svgClone.setAttribute("height", String(height));

    const serialized = new XMLSerializer().serializeToString(svgClone);
    const dataUri = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(serialized)}`;
    const scale = 10;
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(width * scale);
    canvas.height = Math.ceil(height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return Promise.reject(new Error("图片渲染失败"));
    }

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.scale(scale, scale);

    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/png"));
      };
      img.onerror = () => reject(new Error("图片渲染失败"));
      img.src = dataUri;
    });
  }, []);

  useEffect(() => {
    let active = true;
    const container = containerRef.current;

    const renderDiagram = async (): Promise<void> => {
      if (!container) {
        return;
      }

      const trimmed = code.trim();
      if (trimmed.length === 0) {
        setError("Mermaid 代码块为空，无法渲染图表。");
        setHasSvg(false);
        svgStringRef.current = null;
        container.innerHTML = "";
        return;
      }

      try {
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: "default",
          suppressErrorRendering: true,
        });
        const renderId = `mermaid-${Math.random().toString(36).slice(2)}`;
        const { svg } = await mermaid.render(renderId, trimmed);

        if (!active || !container) {
          return;
        }

        svgStringRef.current = svg;
        container.innerHTML = svg;
        setHasSvg(true);
        setError(null);
      } catch (renderError) {
        if (!active || !container) {
          return;
        }

        svgStringRef.current = null;
        container.innerHTML = "";
        setHasSvg(false);
        const message =
          renderError instanceof Error
            ? renderError.message
            : "Mermaid 图渲染失败，请检查语法。";
        setError(message);
      }
    };

    void renderDiagram();

    return () => {
      active = false;
      if (container) {
        container.innerHTML = "";
      }
      svgStringRef.current = null;
      setHasSvg(false);
    };
  }, [code]);

  const handleSaveImage = useCallback(() => {
    void renderMermaidPngDataUrl()
      .then((dataUrl) => {
      const link = document.createElement("a");
        link.href = dataUrl;
      link.download = "mermaid-diagram.png";
      link.click();
      })
      .catch(() => {
        toast.error("图片保存失败");
      });
  }, [renderMermaidPngDataUrl]);

  const handleCopyImage = useCallback(() => {
    void renderMermaidPngDataUrl()
      .then((dataUrl) => copyImageDataUrlToClipboard(dataUrl))
      .catch(() => {
        toast.error("图片复制失败");
      });
  }, [renderMermaidPngDataUrl]);

  if (error) {
    return (
      <div className="flex min-h-55 items-center gap-3 rounded-[18px] border border-status-warning/30 bg-status-warning/8 px-4 py-5 text-sm text-status-warning">
        <AlertCircle className="size-4 shrink-0" />
        <span>{error}</span>
      </div>
    );
  }

  return (
    <DiagramViewport
      minHeight={expanded ? 540 : 260}
      contentClassName={expanded ? "p-8" : undefined}
      onSaveImage={hasSvg ? handleSaveImage : undefined}
      onCopyImage={hasSvg ? handleCopyImage : undefined}
    >
      <div
        ref={containerRef}
        className={cn(
          "mermaid-preview flex items-center justify-center rounded-[18px] bg-white p-4 dark:bg-background",
          expanded ? "min-h-100 min-w-200 p-8" : "min-h-55 w-full min-w-0",
        )}
      />
    </DiagramViewport>
  );
}

function PreviewDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  children: React.JSX.Element;
}): React.JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92dvh] w-[min(96vw,78rem)] max-w-312 flex-col gap-4 overflow-hidden p-5 sm:p-6">
        <DialogHeader className="shrink-0 pr-14">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-hidden rounded-3xl border border-border/70 bg-background-elevated/70">
          {children}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export const MarkdownRichCodeBlock = memo(function MarkdownRichCodeBlock({
  language,
  code,
  hideSource = false,
  isStreaming = false,
}: MarkdownRichCodeBlockProps): React.JSX.Element {
  const normalizedLanguage = normalizeLanguage(language);
  const isHtml = HTML_LANGUAGES.has(normalizedLanguage);
  const isECharts = ECHARTS_LANGUAGES.has(normalizedLanguage);
  const isMermaid = MERMAID_LANGUAGES.has(normalizedLanguage);
  const supportsPreview = isHtml || isECharts || isMermaid;
  const supportsInteractivePreview = isECharts || isMermaid;

  // 流式输出期间：展示代码（无法渲染不完整结构）；流结束后：自动切换到预览
  const [showPreview, setShowPreview] = useState(supportsPreview && !isStreaming);
  const [showCode, setShowCode] = useState(isStreaming || !hideSource);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const prevIsStreamingRef = useRef(isStreaming);
  const isStreamingRef = useRef(isStreaming);

  useEffect(() => {
    isStreamingRef.current = isStreaming;
  }, [isStreaming]);

  // 语言 / hideSource 变化时重置显示状态
  useEffect(() => {
    if (isStreamingRef.current) {
      setShowPreview(false);
      setShowCode(true);
    } else {
      setShowPreview(supportsPreview);
      setShowCode(!hideSource);
    }
  }, [hideSource, supportsPreview, language]);

  // 流结束 → 自动切换到预览
  useEffect(() => {
    const wasStreaming = prevIsStreamingRef.current;
    prevIsStreamingRef.current = isStreaming;
    if (wasStreaming && !isStreaming && supportsPreview) {
      setShowPreview(true);
      setShowCode(false);
    }
  }, [isStreaming, supportsPreview]);

  if (!supportsPreview) {
    return (
      <pre className="my-3 overflow-x-auto rounded-2xl border border-border/60 bg-background-elevated/70 p-4 text-sm leading-6">
        <code className={cn(normalizedLanguage && `language-${normalizedLanguage}`)}>{code}</code>
      </pre>
    );
  }

  const previewTitle = isHtml
    ? "HTML 预览"
    : isECharts
      ? "ECharts 预览"
      : "Mermaid 预览";

  const previewDescription = isHtml
    ? "AI 消息中的 HTML 页面会在这里实时渲染。"
    : isECharts
      ? "AI 消息中的 ECharts option 会在这里实时渲染，可缩放拖动查看。"
      : "AI 消息中的 Mermaid 图会在这里实时渲染，可缩放拖动查看。";

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(code);
      toast.success(i18n.t("common:toast.copiedToClipboard"));
    } catch {
      toast.error("复制失败，请检查系统剪贴板权限");
    }
  };

  const renderPreview = (expanded = false): React.JSX.Element | null => {
    if (isHtml) {
      return <PreviewFrame code={code} expanded={expanded} />;
    }
    if (isECharts) {
      return <EChartsPreview code={code} expanded={expanded} />;
    }
    if (isMermaid) {
      return <MermaidPreview code={code} expanded={expanded} />;
    }
    return null;
  };

  return (
    <>
    <div className="relative isolate my-4 w-full min-w-0 max-w-full rounded-3xl">
      <div className="relative overflow-hidden rounded-[20px] border border-border bg-background-elevated">
      <div className="flex items-center gap-2 border-b border-border/50 bg-background/70 px-4 py-3 backdrop-blur-sm">
        <span className="flex size-8 items-center justify-center rounded-full bg-primary/10 text-primary">
          {isHtml ? (
            <Globe className="size-4" />
          ) : isECharts ? (
            <BarChart3 className="size-4" />
          ) : (
            <GitBranch className="size-4" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">{previewTitle}</p>
          <p className="text-xs text-muted-foreground">{previewDescription}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 rounded-full border border-border/60 bg-background/80 p-1">
            <Button
              type="button"
              variant={showPreview ? "secondary" : "ghost"}
              size="icon-sm"
              onClick={() => setShowPreview((current) => !current)}
              title={showPreview ? "隐藏预览" : "显示预览"}
            >
              {showPreview ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
            </Button>
            <Button
              type="button"
              variant={showCode ? "secondary" : "ghost"}
              size="icon-sm"
              onClick={() => setShowCode((current) => !current)}
              title={showCode ? "隐藏代码" : "显示代码"}
            >
              <SquareCode className="size-3.5" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => void handleCopyCode()}
              title="复制代码"
            >
              <Copy className="size-3.5" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => setIsDialogOpen(true)}
              title="放大预览"
            >
              <Maximize2 className="size-3.5" />
            </Button>
          </div>
          <span className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-background/80 px-2.5 py-1 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            <Sparkles className="size-3" />
            {normalizedLanguage}
          </span>
        </div>
      </div>
      <div className="space-y-4 p-4">
        {showPreview ? (
          <PreviewErrorBoundary
            key={`${normalizedLanguage}-${code}-inline`}
            fallbackTitle={previewTitle}
          >
            {renderPreview(false) ?? <div />}
          </PreviewErrorBoundary>
        ) : null}
        {showCode ? (
          <pre className="overflow-x-auto rounded-[18px] border border-border/60 bg-background/80 p-4 text-sm leading-6">
            <code>{code}</code>
          </pre>
        ) : null}
        {!showPreview && !showCode ? (
          <div className="flex min-h-30 items-center justify-center rounded-[18px] border border-dashed border-border/60 bg-background/50 px-4 py-6 text-sm text-muted-foreground">
            当前已隐藏预览和代码，可使用右上角按钮切换显示模式。
          </div>
        ) : null}
      </div>
    </div>
    </div>
    <PreviewDialog
      open={isDialogOpen}
      onOpenChange={setIsDialogOpen}
      title={`${previewTitle} · 放大查看`}
      description={supportsInteractivePreview ? "弹窗中支持按钮缩放与鼠标拖动，适合查看复杂图表与流程图。" : "弹窗中可以放大查看完整内容，同时仍可切换代码。"}
    >
      <PreviewErrorBoundary
        key={`${normalizedLanguage}-${code}-dialog`}
        fallbackTitle={previewTitle}
      >
        {renderPreview(true) ?? <div />}
      </PreviewErrorBoundary>
    </PreviewDialog>
    </>
  );
});
