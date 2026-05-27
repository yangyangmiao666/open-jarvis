import { useEffect, useState, useMemo } from "react";
import { Loader2, AlertCircle, ExternalLink, FileCode } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useCurrentThread } from "@/lib/thread-context";
import { getFileType, isBinaryFile } from "@/lib/file-types";
import { CodeViewer } from "./CodeViewer";
import { ImageViewer } from "./ImageViewer";
import { MediaViewer } from "./MediaViewer";
import { PDFViewer } from "./PDFViewer";
import { BinaryFileViewer } from "./BinaryFileViewer";
import { normalizeLocalFilePath } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface FileViewerProps {
  filePath: string;
  threadId: string;
}

export function FileViewer({
  filePath,
  threadId,
}: FileViewerProps): React.JSX.Element | null {
  const { t } = useTranslation('tabs');
  const { fileContents, setFileContents } = useCurrentThread(threadId);
  const normalizedFilePath = useMemo(() => normalizeLocalFilePath(filePath), [filePath]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [binaryContent, setBinaryContent] = useState<string | null>(null);
  const [fileSize, setFileSize] = useState<number | undefined>();

  // Get file type info
  const fileName = normalizedFilePath.split("/").pop() || normalizedFilePath;
  const fileTypeInfo = useMemo(() => getFileType(fileName), [fileName]);
  const isBinary = useMemo(() => isBinaryFile(fileName), [fileName]);
  const isHtmlFile = useMemo(() => /\.html?$/i.test(fileName), [fileName]);

  // Get cached content or load it
  const content = fileContents[normalizedFilePath];

  // Reset state when filePath changes
  useEffect(() => {
    setError(null);
    setBinaryContent(null);
    setFileSize(undefined);
  }, [normalizedFilePath]);

  // Load file content (text or binary depending on file type)
  useEffect(() => {
    async function loadFile(): Promise<void> {
      // Skip if already loaded
      if (content !== undefined || binaryContent !== null) {
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        if (isBinary) {
          // Read as binary file (base64)
          const result = await window.api.workspace.readBinaryFile(
            threadId,
            normalizedFilePath,
          );
          if (result.success && result.content !== undefined) {
            setBinaryContent(result.content);
            setFileSize(result.size);
          } else {
            setError(result.error || t('fileViewer.readFileFailed'));
          }
        } else {
          // Read as text file
          const result = await window.api.workspace.readFile(
            threadId,
            normalizedFilePath,
          );
          if (result.success && result.content !== undefined) {
            setFileContents(normalizedFilePath, result.content);
            setFileSize(result.size);
          } else {
            setError(result.error || t('fileViewer.readFileFailed'));
          }
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : t('fileViewer.readFileFailed'));
      } finally {
        setIsLoading(false);
      }
    }

    loadFile();
  }, [threadId, normalizedFilePath, content, binaryContent, setFileContents, isBinary, t]);

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <div className="app-flat-surface animate-scale-in flex min-w-[18rem] max-w-sm flex-col items-center gap-4 rounded-[28px] px-8 py-10 text-center text-muted-foreground">
          <div className="flex size-12 items-center justify-center rounded-2xl bg-background-interactive text-primary">
            <Loader2 className="size-5 animate-spin" />
          </div>
          <div className="space-y-1">
            <div className="text-base font-medium text-foreground">{t('fileViewer.loadingFile')}</div>
            <div className="text-sm">{t('fileViewer.preparingPreview', { fileName })}</div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-muted-foreground">
        <div className="app-flat-surface flex max-w-md flex-col items-center gap-4 rounded-[28px] px-8 py-10 text-center">
          <AlertCircle className="size-10 text-status-critical" />
          <div className="text-center">
            <div className="mb-1 font-medium text-foreground">
              {t('fileViewer.cannotLoadFile')}
            </div>
            <div className="text-sm">{error}</div>
          </div>
        </div>
      </div>
    );
  }

  if (content === undefined && binaryContent === null) {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-muted-foreground">
        <div className="app-flat-surface flex flex-col items-center gap-3 rounded-[28px] px-8 py-10 text-center">
          <FileCode className="size-8 text-primary/80" />
          <div className="text-base font-medium text-foreground">{t('fileViewer.noContent')}</div>
          <div className="text-sm">{t('fileViewer.noContentHint')}</div>
        </div>
      </div>
    );
  }

  // Route to appropriate viewer based on file type
  if (fileTypeInfo.type === "image" && binaryContent) {
    return (
      <ImageViewer
        filePath={normalizedFilePath}
        base64Content={binaryContent}
        mimeType={fileTypeInfo.mimeType || "image/png"}
      />
    );
  }

  if (fileTypeInfo.type === "video" && binaryContent) {
    return (
      <MediaViewer
        filePath={normalizedFilePath}
        base64Content={binaryContent}
        mimeType={fileTypeInfo.mimeType || "video/mp4"}
        mediaType="video"
      />
    );
  }

  if (fileTypeInfo.type === "audio" && binaryContent) {
    return (
      <MediaViewer
        filePath={normalizedFilePath}
        base64Content={binaryContent}
        mimeType={fileTypeInfo.mimeType || "audio/mpeg"}
        mediaType="audio"
      />
    );
  }

  if (fileTypeInfo.type === "pdf" && binaryContent) {
    return <PDFViewer filePath={normalizedFilePath} base64Content={binaryContent} />;
  }

  if (fileTypeInfo.type === "binary") {
    return <BinaryFileViewer filePath={normalizedFilePath} size={fileSize} />;
  }

  // Default to code/text viewer
  if (content !== undefined) {
    return (
      <CodeViewer
        filePath={normalizedFilePath}
        content={content}
        headerActions={isHtmlFile ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 shrink-0 gap-1 px-2"
            onClick={() => {
              void window.api.workspace.openInBrowser(threadId, normalizedFilePath);
            }}
          >
            <ExternalLink className="size-3" />
            <span className="text-xs">{t("codeViewer.openInBrowser")}</span>
          </Button>
        ) : undefined}
      />
    );
  }

  return null;
}