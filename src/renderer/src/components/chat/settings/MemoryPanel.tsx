import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
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
import { toast } from "@/lib/toast";
import { useAppStore } from "@/lib/store";
import { formatDateTimeWithYear } from "@/lib/utils";
import type { MemoryDocumentSummary, MemorySettings } from "@/types";
import {
  SettingsSection,
  SettingsCard,
  SettingsInput,
  SettingsRow,
  SettingsTextarea,
} from "./primitives";

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
  const [loading, setLoading] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorLoading, setEditorLoading] = useState(false);
  const [editorSaving, setEditorSaving] = useState(false);
  const [editingRoutePath, setEditingRoutePath] = useState<string | null>(null);
  const [editorTitle, setEditorTitle] = useState("");
  const [editorSummary, setEditorSummary] = useState("");
  const [editorBody, setEditorBody] = useState("");
  const [deleteTarget, setDeleteTarget] =
    useState<MemoryDocumentSummary | null>(null);
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
    } finally {
      setLoading(false);
    }
  }, [currentThreadId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

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

  const resetEditor = (): void => {
    setEditingRoutePath(null);
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

    setEditorSaving(true);
    try {
      const result = await window.api.settings.updateWorkspaceMemoryDocument(
        currentThreadId ?? undefined,
        editingRoutePath,
        {
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
    if (!deleteTarget) {
      return;
    }

    const result = await window.api.settings.deleteWorkspaceMemoryDocument(
      currentThreadId ?? undefined,
      deleteTarget.routePath,
    );
    if (!result.success) {
      toast.error(result.error ?? t("memory.deleteFailed"));
      return;
    }

    toast.success(t("memory.deleted"));
    setDeleteTarget(null);
    await loadData();
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
            {memories.length === 0 ? (
              <div className="px-4 py-4 text-sm text-muted-foreground">
                {workspacePath ? t("memory.empty") : t("memory.noWorkspace")}
              </div>
            ) : (
              memories.map((memory) => (
                <div
                  key={memory.routePath}
                  className="border-b border-border px-4 py-3 last:border-b-0"
                >
                  <div className="flex items-start justify-between gap-3">
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
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                      <span>
                        {t("memory.recallCount", { count: memory.recallCount })}
                      </span>
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
                        onClick={() => setDeleteTarget(memory)}
                        disabled={loading}
                      >
                        <Trash2 className="mr-1 h-3.5 w-3.5" />
                        {t("memory.delete")}
                      </Button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </SettingsCard>
        </SettingsSection>
      </div>

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
            <SettingsInput
              label={t("memory.titleField")}
              value={editorTitle}
              onChange={(event) => setEditorTitle(event.target.value)}
              disabled={editorLoading || editorSaving}
            />
            <SettingsTextarea
              label={t("memory.summaryField")}
              value={editorSummary}
              onChange={(event) => setEditorSummary(event.target.value)}
              disabled={editorLoading || editorSaving}
              rows={3}
            />
            <SettingsTextarea
              label={t("memory.bodyField")}
              value={editorBody}
              onChange={(event) => setEditorBody(event.target.value)}
              disabled={editorLoading || editorSaving}
              rows={14}
              className="font-mono text-xs"
            />
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
        open={deleteTarget !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            setDeleteTarget(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("memory.confirmDeleteTitle")}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {t("memory.confirmDeleteDesc", { name: deleteTarget?.title ?? "" })}
          </p>
          <DialogFooter className="gap-2">
            <Button variant="secondary" onClick={() => setDeleteTarget(null)}>
              {t("common:cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                void handleDeleteMemory();
              }}
            >
              {t("common:delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
