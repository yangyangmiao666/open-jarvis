import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  Database,
  FolderTree,
  Pencil,
  RefreshCcw,
  RotateCcw,
  Sparkles,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "@/lib/toast";
import { useAppStore } from "@/lib/store";
import { formatDateTimeWithYear } from "@/lib/utils";
import type { MemoryDocumentSummary, MemorySettings } from "@/types";
import {
  SettingsSection,
  SettingsCard,
  SettingsInput,
  SettingsRow,
  SettingsToggle,
} from "./primitives";

const MEMORY_PAGE_SIZE = 8;

function promotionStatusLabel(
  status: MemoryDocumentSummary["promotionStatus"],
): string {
  switch (status) {
    case "candidate":
      return "待沉淀";
    case "promoted":
      return "已沉淀";
    case "rejected":
      return "已忽略";
    case "none":
    default:
      return "普通记忆";
  }
}

function promotionStatusClassName(
  status: MemoryDocumentSummary["promotionStatus"],
): string {
  switch (status) {
    case "candidate":
      return "border-[var(--status-warning)]/40 bg-[var(--status-warning)]/10 text-[var(--status-warning)]";
    case "promoted":
      return "border-[var(--status-nominal)]/40 bg-[var(--status-nominal)]/10 text-[var(--status-nominal)]";
    case "rejected":
      return "border-border bg-muted text-muted-foreground";
    case "none":
    default:
      return "border-border bg-background text-muted-foreground";
  }
}

function getRouteFileName(routePath: string): string {
  const segments = routePath.split("/").filter(Boolean);
  return segments[segments.length - 1] ?? "";
}

function buildRoutePathWithFileName(
  routePath: string,
  fileName: string,
): string | null {
  const trimmed = fileName.trim();
  if (
    !trimmed ||
    trimmed.includes("/") ||
    trimmed.includes("\\") ||
    trimmed === "." ||
    trimmed === ".."
  ) {
    return null;
  }

  const normalizedFileName = trimmed.endsWith(".md") ? trimmed : `${trimmed}.md`;
  const index = routePath.lastIndexOf("/");
  if (index < 0) {
    return null;
  }

  return `${routePath.slice(0, index + 1)}${normalizedFileName}`;
}

export function MemoryPanel(): React.JSX.Element {
  const { t } = useTranslation("settings");
  const currentThreadId = useAppStore((state) => state.currentThreadId);
  const [memorySettings, setMemorySettings] = useState<MemorySettings | null>(
    null,
  );
  const [thresholdDraft, setThresholdDraft] = useState("3");
  const [workspacePath, setWorkspacePath] = useState<string | null>(null);
  const [memoryDir, setMemoryDir] = useState<string | null>(null);
  const [memories, setMemories] = useState<MemoryDocumentSummary[]>([]);
  const [memoryDialogOpen, setMemoryDialogOpen] = useState(false);
  const [memoryPage, setMemoryPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorLoading, setEditorLoading] = useState(false);
  const [editorSaving, setEditorSaving] = useState(false);
  const [editingRoutePath, setEditingRoutePath] = useState<string | null>(null);
  const [editorFileName, setEditorFileName] = useState("");
  const [editorTitle, setEditorTitle] = useState("");
  const [editorSummary, setEditorSummary] = useState("");
  const [editorBody, setEditorBody] = useState("");
  const [selectedRoutePaths, setSelectedRoutePaths] = useState<string[]>([]);
  const [deleteTargets, setDeleteTargets] = useState<MemoryDocumentSummary[]>([]);
  const [deletingMemories, setDeletingMemories] = useState(false);
  const [settleTarget, setSettleTarget] =
    useState<MemoryDocumentSummary | null>(null);
  const [undoTarget, setUndoTarget] =
    useState<MemoryDocumentSummary | null>(null);
  const [settlingRoutePath, setSettlingRoutePath] = useState<string | null>(
    null,
  );
  const [undoingRoutePath, setUndoingRoutePath] = useState<string | null>(null);

  const loadData = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const [settings, memoryResult] = await Promise.all([
        window.api.settings.getMemorySettings(),
        window.api.settings.listWorkspaceMemories(currentThreadId ?? undefined),
      ]);
      setMemorySettings(settings);
      setThresholdDraft(String(settings.skillPromotionRecallThreshold));
      setWorkspacePath(memoryResult.workspacePath);
      setMemoryDir(memoryResult.memoryDir);
      setMemories(memoryResult.memories);
      setSelectedRoutePaths((prev) =>
        prev.filter((routePath) =>
          memoryResult.memories.some((memory) => memory.routePath === routePath),
        ),
      );
    } finally {
      setLoading(false);
    }
  }, [currentThreadId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const sortedMemories = useMemo(
    () => [...memories].sort((left, right) => right.lastUpdatedAt.localeCompare(left.lastUpdatedAt)),
    [memories],
  );

  const memoryTotalPages = useMemo(
    () => Math.max(1, Math.ceil(sortedMemories.length / MEMORY_PAGE_SIZE)),
    [sortedMemories.length],
  );

  const pagedMemories = useMemo(() => {
    const safePage = Math.min(memoryPage, memoryTotalPages);
    const start = (safePage - 1) * MEMORY_PAGE_SIZE;
    return sortedMemories.slice(start, start + MEMORY_PAGE_SIZE);
  }, [sortedMemories, memoryPage, memoryTotalPages]);

  const selectedCount = selectedRoutePaths.length;
  const allPagedSelected =
    pagedMemories.length > 0 &&
    pagedMemories.every((memory) => selectedRoutePaths.includes(memory.routePath));
  const somePagedSelected = pagedMemories.some((memory) =>
    selectedRoutePaths.includes(memory.routePath),
  );

  useEffect(() => {
    if (memoryPage > memoryTotalPages) {
      setMemoryPage(memoryTotalPages);
    }
  }, [memoryPage, memoryTotalPages]);

  const handleThresholdBlur = async (): Promise<void> => {
    const parsed = Number.parseInt(thresholdDraft, 10);
    const nextThreshold = Number.isFinite(parsed)
      ? Math.min(50, Math.max(1, parsed))
      : 3;
    const next = await window.api.settings.setMemorySettings({
      skillPromotionRecallThreshold: nextThreshold,
    });
    setMemorySettings(next);
    setThresholdDraft(String(next.skillPromotionRecallThreshold));
  };

  const handleMemoryConsolidationToggle = async (
    checked: boolean,
  ): Promise<void> => {
    const next = await window.api.settings.setMemorySettings({
      memoryConsolidationEnabled: checked,
    });
    setMemorySettings(next);
  };

  const resetEditor = (): void => {
    setEditingRoutePath(null);
    setEditorFileName("");
    setEditorTitle("");
    setEditorSummary("");
    setEditorBody("");
    setEditorLoading(false);
    setEditorSaving(false);
  };

  const handleOpenEditor = async (routePath: string): Promise<void> => {
    setEditorOpen(true);
    setEditorLoading(true);
    setEditingRoutePath(routePath);
    setEditorFileName("");
    setEditorTitle("");
    setEditorSummary("");
    setEditorBody("");

    try {
      const result = await window.api.settings.getWorkspaceMemoryDocument(
        currentThreadId ?? undefined,
        routePath,
      );
      if (!result.success || !result.document) {
        toast.error(result.error ?? t("memory.loadFailed"));
        setEditorOpen(false);
        resetEditor();
        return;
      }

      setEditorFileName(getRouteFileName(result.document.routePath));
      setEditorTitle(result.document.title);
      setEditorSummary(result.document.summary);
      setEditorBody(result.document.body);
    } finally {
      setEditorLoading(false);
    }
  };

  const handleSaveEditor = async (): Promise<void> => {
    if (!editingRoutePath || editorLoading || editorSaving) {
      return;
    }

    const nextRoutePath = buildRoutePathWithFileName(
      editingRoutePath,
      editorFileName,
    );
    if (!nextRoutePath) {
      toast.error(t("memory.invalidFileName"));
      return;
    }

    setEditorSaving(true);
    try {
      const result = await window.api.settings.updateWorkspaceMemoryDocument(
        currentThreadId ?? undefined,
        editingRoutePath,
        {
          nextRoutePath,
          title: editorTitle,
          summary: editorSummary,
          body: editorBody,
        },
      );
      if (!result.success) {
        toast.error(result.error ?? t("memory.saveFailed"));
        return;
      }

      toast.success(t("memory.updated"));
      setEditorOpen(false);
      resetEditor();
      await loadData();
    } finally {
      setEditorSaving(false);
    }
  };

  const handleDeleteMemory = async (): Promise<void> => {
    if (deleteTargets.length === 0 || deletingMemories) {
      return;
    }

    setDeletingMemories(true);
    try {
      const results = await Promise.all(
        deleteTargets.map((memory) =>
          window.api.settings.deleteWorkspaceMemoryDocument(
            currentThreadId ?? undefined,
            memory.routePath,
          ),
        ),
      );

      const firstError = results.find((result) => !result.success);
      if (firstError) {
        toast.error(firstError.error ?? t("memory.deleteFailed"));
        return;
      }

      toast.success(
        deleteTargets.length > 1
          ? t("memory.deletedMultiple", { count: deleteTargets.length })
          : t("memory.deleted"),
      );
      setSelectedRoutePaths((prev) =>
        prev.filter(
          (routePath) =>
            !deleteTargets.some((memory) => memory.routePath === routePath),
        ),
      );
      setDeleteTargets([]);
      await loadData();
    } finally {
      setDeletingMemories(false);
    }
  };

  const toggleMemorySelection = (routePath: string, checked: boolean): void => {
    setSelectedRoutePaths((prev) => {
      if (checked) {
        return prev.includes(routePath) ? prev : [...prev, routePath];
      }
      return prev.filter((item) => item !== routePath);
    });
  };

  const toggleCurrentPageSelection = (checked: boolean): void => {
    const pageRoutePaths = pagedMemories.map((memory) => memory.routePath);
    setSelectedRoutePaths((prev) => {
      if (checked) {
        return Array.from(new Set([...prev, ...pageRoutePaths]));
      }
      return prev.filter((routePath) => !pageRoutePaths.includes(routePath));
    });
  };

  const openDeleteSelectionDialog = (): void => {
    const targets = sortedMemories.filter((memory) =>
      selectedRoutePaths.includes(memory.routePath),
    );
    if (targets.length === 0) {
      return;
    }
    setDeleteTargets(targets);
  };

  const handleSettleAsSkill = async (): Promise<void> => {
    if (!workspacePath || !settleTarget || settlingRoutePath) {
      return;
    }

    setSettlingRoutePath(settleTarget.routePath);
    try {
      const result = await window.api.skills.settleMemoryAsSkill(
        workspacePath,
        settleTarget.routePath,
      );
      if (!result.success) {
        toast.error(result.error ?? t("memory.settleFailed"));
        return;
      }

      toast.success(t("memory.settled"));
      setSettleTarget(null);
      await loadData();
    } finally {
      setSettlingRoutePath(null);
    }
  };

  const handleUndoSettlement = async (): Promise<void> => {
    if (!workspacePath || !undoTarget || undoingRoutePath) {
      return;
    }

    setUndoingRoutePath(undoTarget.routePath);
    try {
      const result = await window.api.skills.undoMemorySettlement(
        workspacePath,
        undoTarget.routePath,
      );
      if (!result.success) {
        toast.error(result.error ?? t("memory.undoFailed"));
        return;
      }

      toast.success(t("memory.undoSettled"));
      setUndoTarget(null);
      await loadData();
    } finally {
      setUndoingRoutePath(null);
    }
  };

  return (
    <>
      <div className="space-y-8">
        <SettingsSection
          title={t("memory.title")}
          description={t("memory.description")}
        >
          <SettingsCard>
            <SettingsToggle
              label={t("memory.consolidationEnabled")}
              description={t("memory.consolidationEnabledDesc")}
              checked={memorySettings?.memoryConsolidationEnabled ?? false}
              onCheckedChange={(checked) => {
                void handleMemoryConsolidationToggle(checked);
              }}
              disabled={!memorySettings}
            />
            <SettingsInput
              label={t("memory.recallThreshold")}
              description={t("memory.recallThresholdDesc")}
              type="number"
              min={1}
              max={50}
              step={1}
              value={thresholdDraft}
              onChange={(event) => setThresholdDraft(event.target.value)}
              onBlur={() => {
                void handleThresholdBlur();
              }}
              disabled={!memorySettings}
            />
            <SettingsRow
              label={t("memory.workspacePath")}
              description={workspacePath ?? t("memory.noWorkspace")}
              icon={<FolderTree className="h-4 w-4" />}
            />
            <SettingsRow
              label={t("memory.memoryDir")}
              description={memoryDir ?? t("memory.noWorkspace")}
              icon={<Database className="h-4 w-4" />}
            >
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  void loadData();
                }}
                disabled={loading}
              >
                <RefreshCcw className="mr-2 h-3.5 w-3.5" />
                {t("memory.refresh")}
              </Button>
            </SettingsRow>
          </SettingsCard>
        </SettingsSection>

        <SettingsSection
          title={t("memory.memoryList")}
          description={t("memory.memoryListDesc", { count: memories.length })}
        >
          <SettingsCard>
            <div className="flex items-center justify-between gap-3 px-4 py-4">
              <div className="min-w-0 text-sm text-muted-foreground">
                {workspacePath ? t("memory.memoryListDesc", { count: memories.length }) : t("memory.noWorkspace")}
              </div>
              <div className="flex items-center gap-2">
                {selectedCount > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={openDeleteSelectionDialog}
                    disabled={loading}
                  >
                    <Trash2 className="mr-2 h-3.5 w-3.5" />
                    {t("memory.deleteSelected", { count: selectedCount })}
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setMemoryPage(1);
                    setMemoryDialogOpen(true);
                  }}
                  disabled={!workspacePath || loading}
                >
                  {t("memory.openList")}
                </Button>
              </div>
            </div>
          </SettingsCard>
        </SettingsSection>
      </div>

      <Dialog open={memoryDialogOpen} onOpenChange={setMemoryDialogOpen}>
        <DialogContent className="flex h-[min(88vh,48rem)] w-[min(96vw,72rem)] max-w-6xl flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle>{t("memory.listDialogTitle")}</DialogTitle>
          </DialogHeader>
          <div className="flex min-h-0 flex-1 flex-col gap-4">
            {sortedMemories.length === 0 ? (
              <div className="rounded-xl border border-border px-4 py-8 text-center text-sm text-muted-foreground">
                {workspacePath ? t("memory.empty") : t("memory.noWorkspace")}
              </div>
            ) : (
              <div className="flex min-h-0 flex-1 flex-col gap-3">
                <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-border"
                      checked={allPagedSelected}
                      ref={(element) => {
                        if (element) {
                          element.indeterminate = somePagedSelected && !allPagedSelected;
                        }
                      }}
                      onChange={(event) => toggleCurrentPageSelection(event.target.checked)}
                    />
                    <span>{t("memory.selectCurrentPage")}</span>
                  </div>
                  {selectedCount > 0 && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 px-2"
                      onClick={openDeleteSelectionDialog}
                      disabled={loading}
                    >
                      <CheckSquare className="mr-1 h-3.5 w-3.5" />
                      {t("memory.deleteSelected", { count: selectedCount })}
                    </Button>
                  )}
                </div>
                <div className="min-h-0 flex-1 overflow-hidden rounded-xl border border-border/60 bg-card">
                  <ScrollArea className="h-full">
                    {pagedMemories.map((memory) => (
                      <div
                        key={memory.routePath}
                        className="border-b border-border px-4 py-3 last:border-b-0"
                      >
                      <div className="flex items-start gap-3">
                        <input
                          type="checkbox"
                          className="mt-0.5 h-4 w-4 shrink-0 rounded border-border"
                          checked={selectedRoutePaths.includes(memory.routePath)}
                          onChange={(event) =>
                            toggleMemorySelection(memory.routePath, event.target.checked)
                          }
                        />
                      <div className="flex min-w-0 flex-1 items-start justify-between gap-3">
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="text-sm font-medium text-foreground">
                            {memory.title}
                          </div>
                          <div className="text-xs text-muted-foreground break-all">
                            {memory.routePath}
                          </div>
                          <div className="text-xs leading-relaxed text-muted-foreground">
                            {memory.summary || t("memory.noSummary")}
                          </div>
                        </div>
                        <div
                          className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${promotionStatusClassName(memory.promotionStatus)}`}
                        >
                          {promotionStatusLabel(memory.promotionStatus)}
                        </div>
                      </div>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
                        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                          <span>{t("memory.recallCount", { count: memory.recallCount })}</span>
                          <span>
                            {t("memory.lastUpdated", {
                              value: formatDateTimeWithYear(memory.lastUpdatedAt),
                            })}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2"
                            onClick={() => {
                              if (memory.promotionStatus === "promoted") {
                                setUndoTarget(memory);
                                return;
                              }
                              setSettleTarget(memory);
                            }}
                            disabled={
                              loading ||
                              !workspacePath ||
                              settlingRoutePath === memory.routePath ||
                              undoingRoutePath === memory.routePath
                            }
                          >
                            {memory.promotionStatus === "promoted" ? (
                              <RotateCcw className="mr-1 h-3.5 w-3.5" />
                            ) : (
                              <Sparkles className="mr-1 h-3.5 w-3.5" />
                            )}
                            {memory.promotionStatus === "promoted"
                              ? t("memory.undoSettlement")
                              : t("memory.settleAsSkill")}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2"
                            onClick={() => {
                              void handleOpenEditor(memory.routePath);
                            }}
                            disabled={loading}
                          >
                            <Pencil className="mr-1 h-3.5 w-3.5" />
                            {t("memory.edit")}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-destructive hover:text-destructive"
                            onClick={() => setDeleteTargets([memory])}
                            disabled={loading}
                          >
                            <Trash2 className="mr-1 h-3.5 w-3.5" />
                            {t("memory.delete")}
                          </Button>
                        </div>
                      </div>
                      </div>
                    ))}
                  </ScrollArea>
                </div>
                <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border/50 pt-2 text-xs text-muted-foreground">
                  <span>{t("memory.pageInfo", { current: memoryPage, total: memoryTotalPages })}</span>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 px-2"
                      disabled={memoryPage <= 1}
                      onClick={() => setMemoryPage((page) => Math.max(1, page - 1))}
                    >
                      <ChevronLeft className="mr-1 h-3.5 w-3.5" />
                      {t("memory.prevPage")}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 px-2"
                      disabled={memoryPage >= memoryTotalPages}
                      onClick={() => setMemoryPage((page) => Math.min(memoryTotalPages, page + 1))}
                    >
                      {t("memory.nextPage")}
                      <ChevronRight className="ml-1 h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={editorOpen}
        onOpenChange={(nextOpen) => {
          setEditorOpen(nextOpen);
          if (!nextOpen) {
            resetEditor();
          }
        }}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("memory.editDialogTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-lg border border-border/60 bg-muted/20 px-4 py-3 text-xs text-muted-foreground break-all">
              {editingRoutePath}
            </div>
            <div className="grid gap-4">
              <div className="grid grid-cols-[96px_minmax(0,1fr)] items-start gap-3">
                <label
                  htmlFor="memory-file-name"
                  className="pt-2 text-sm font-medium leading-snug text-foreground"
                >
                  {t("memory.fileNameField")}
                </label>
                <div className="space-y-1.5">
                  <Input
                    id="memory-file-name"
                    value={editorFileName}
                    onChange={(event) => setEditorFileName(event.target.value)}
                    disabled={editorLoading || editorSaving}
                  />
                  <div className="text-xs text-muted-foreground break-all">
                    {t("memory.fileNameHint")}
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-[96px_minmax(0,1fr)] items-start gap-3">
                <label
                  htmlFor="memory-title"
                  className="pt-2 text-sm font-medium leading-snug text-foreground"
                >
                  {t("memory.titleField")}
                </label>
                <Input
                  id="memory-title"
                  value={editorTitle}
                  onChange={(event) => setEditorTitle(event.target.value)}
                  disabled={editorLoading || editorSaving}
                />
              </div>
              <div className="grid grid-cols-[96px_minmax(0,1fr)] items-start gap-3">
                <label
                  htmlFor="memory-summary"
                  className="pt-2 text-sm font-medium leading-snug text-foreground"
                >
                  {t("memory.summaryField")}
                </label>
                <textarea
                  id="memory-summary"
                  value={editorSummary}
                  onChange={(event) => setEditorSummary(event.target.value)}
                  disabled={editorLoading || editorSaving}
                  rows={3}
                  className="flex min-h-[80px] w-full rounded-lg border border-input app-premium-field px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/55 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50"
                />
              </div>
              <div className="grid grid-cols-[96px_minmax(0,1fr)] items-start gap-3">
                <label
                  htmlFor="memory-body"
                  className="pt-2 text-sm font-medium leading-snug text-foreground"
                >
                  {t("memory.bodyField")}
                </label>
                <textarea
                  id="memory-body"
                  value={editorBody}
                  onChange={(event) => setEditorBody(event.target.value)}
                  disabled={editorLoading || editorSaving}
                  rows={14}
                  className="flex min-h-[80px] w-full rounded-lg border border-input app-premium-field px-3 py-2 font-mono text-xs ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/55 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50"
                />
              </div>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="secondary"
              onClick={() => setEditorOpen(false)}
              disabled={editorSaving}
            >
              {t("common:cancel")}
            </Button>
            <Button
              onClick={() => {
                void handleSaveEditor();
              }}
              disabled={editorLoading || editorSaving}
            >
              {t("common:save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={settleTarget !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            setSettleTarget(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("memory.confirmSettleTitle")}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {t("memory.confirmSettleDesc", {
              name: settleTarget?.title ?? "",
            })}
          </p>
          <DialogFooter className="gap-2">
            <Button
              variant="secondary"
              onClick={() => setSettleTarget(null)}
              disabled={Boolean(settlingRoutePath)}
            >
              {t("common:cancel")}
            </Button>
            <Button
              onClick={() => {
                void handleSettleAsSkill();
              }}
              disabled={Boolean(settlingRoutePath)}
            >
              {t("common:confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={undoTarget !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            setUndoTarget(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("memory.confirmUndoTitle")}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {t("memory.confirmUndoDesc", {
              name: undoTarget?.title ?? "",
            })}
          </p>
          <DialogFooter className="gap-2">
            <Button
              variant="secondary"
              onClick={() => setUndoTarget(null)}
              disabled={Boolean(undoingRoutePath)}
            >
              {t("common:cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                void handleUndoSettlement();
              }}
              disabled={Boolean(undoingRoutePath)}
            >
              {t("memory.undoSettlement")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={deleteTargets.length > 0}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            setDeleteTargets([]);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("memory.confirmDeleteTitle")}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {deleteTargets.length > 1
              ? t("memory.confirmDeleteMultiDesc", { count: deleteTargets.length })
              : t("memory.confirmDeleteDesc", {
                  name: deleteTargets[0]?.title ?? "",
                })}
          </p>
          <DialogFooter className="gap-2">
            <Button
              variant="secondary"
              onClick={() => setDeleteTargets([])}
              disabled={deletingMemories}
            >
              {t("common:cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                void handleDeleteMemory();
              }}
              disabled={deletingMemories}
            >
              {t("common:delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
