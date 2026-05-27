import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronLeft,
  ChevronRight,
  Search,
  Sparkles,
  SquarePen,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "@/lib/toast";
import { cn, formatDateTimeWithYear } from "@/lib/utils";
import type { SkillSummary } from "@/types";
import { SettingsCard, SettingsRow, SettingsSection } from "./primitives";

function getColumnCount(viewportWidth: number): number {
  if (viewportWidth >= 1536) {
    return 4;
  }
  if (viewportWidth >= 1280) {
    return 3;
  }
  if (viewportWidth >= 768) {
    return 2;
  }
  return 1;
}

function getResponsivePageSize(listHeight: number, viewportWidth: number): number {
  const columns = getColumnCount(viewportWidth);
  const estimatedCardHeight = viewportWidth >= 1536 ? 126 : 132;
  const gap = 8;
  const rows = Math.max(1, Math.floor((listHeight + gap) / (estimatedCardHeight + gap)));
  return Math.max(columns, columns * rows);
}

type SkillsDeleteConfirmState = { type: "folders" } | null;

const textAreaClassName = cn(
  "flex w-full rounded-lg border border-input app-premium-field px-3 py-2 text-xs font-mono",
  "placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
  "disabled:cursor-not-allowed disabled:opacity-50 resize-y",
);

export function SkillsPanel(): React.JSX.Element {
  const { t } = useTranslation("settings");
  const workspaceSkillTarget = undefined;
  const [sources, setSources] = useState<string[]>([]);
  const [folders, setFolders] = useState<SkillSummary[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(12);
  const [skillsDialogOpen, setSkillsDialogOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [workspaceReady, setWorkspaceReady] = useState(false);
  const [deleteConfirm, setDeleteConfirm] =
    useState<SkillsDeleteConfirmState>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorMode, setEditorMode] = useState<"create" | "edit">("create");
  const [originFolder, setOriginFolder] = useState<string | null>(null);
  const [editorName, setEditorName] = useState("");
  const [editorMarkdown, setEditorMarkdown] = useState("");
  const [editorLoading, setEditorLoading] = useState(false);
  const [highlightedCard, setHighlightedCard] = useState<string | null>(null);
  const listViewportRef = useRef<HTMLDivElement | null>(null);

  const reload = useCallback(async (): Promise<void> => {
    const [nextSources, result] = await Promise.all([
      window.api.skills.listSources(),
      window.api.skills.listWorkspaceSkillFolders(workspaceSkillTarget),
    ]);

    setSources(nextSources);
    if (result.success && result.folders) {
      setFolders(result.folders);
      setWorkspaceReady(true);
    } else {
      setFolders([]);
      setWorkspaceReady(false);
    }
    setSelected(new Set());
  }, [workspaceSkillTarget]);

  useEffect(() => {
    void reload();
    setCurrentPage(1);
    setSearchQuery("");
  }, [reload]);

  useEffect(() => {
    if (!skillsDialogOpen) {
      return;
    }

    const updatePageSize = (): void => {
      const listHeight = listViewportRef.current?.clientHeight ?? 0;
      if (!listHeight) {
        return;
      }
      setPageSize(getResponsivePageSize(listHeight, window.innerWidth));
    };

    updatePageSize();
    const resizeObserver = new ResizeObserver(() => {
      updatePageSize();
    });

    if (listViewportRef.current) {
      resizeObserver.observe(listViewportRef.current);
    }
    window.addEventListener("resize", updatePageSize);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", updatePageSize);
    };
  }, [skillsDialogOpen]);

  const filteredFolders = useMemo(() => {
    const keyword = searchQuery.trim().toLowerCase();
    if (!keyword) {
      return folders;
    }

    return folders.filter((folder) =>
      folder.folderName.toLowerCase().includes(keyword),
    );
  }, [folders, searchQuery]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery]);

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(filteredFolders.length / pageSize)),
    [filteredFolders.length, pageSize],
  );

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  const pagedFolders = useMemo(() => {
    const safePage = Math.min(currentPage, totalPages);
    const start = (safePage - 1) * pageSize;
    return filteredFolders.slice(start, start + pageSize);
  }, [filteredFolders, currentPage, totalPages, pageSize]);

  const handleConfirmDelete = async (): Promise<void> => {
    if (!deleteConfirm) {
      return;
    }

    await handleDeleteFolders();
  };

  const handleImport = async (): Promise<void> => {
    setBusy(true);
    try {
      const result = await window.api.skills.importFolder(workspaceSkillTarget);
      await reload();
      if (result.success) {
        toast.success(t("skills.loadedFromDisk"));
      } else {
        toast.error(result.error ?? t("skills.importFailed"));
      }
    } finally {
      setBusy(false);
    }
  };

  const openCreateEditor = (): void => {
    setEditorMode("create");
    setOriginFolder(null);
    setEditorName("");
    setEditorMarkdown("");
    setEditorLoading(false);
    setEditorOpen(true);
  };

  const openEditEditor = async (folderName: string): Promise<void> => {
    setHighlightedCard(folderName);
    setTimeout(() => setHighlightedCard(null), 220);
    setEditorMode("edit");
    setOriginFolder(folderName);
    setEditorName(folderName);
    setEditorMarkdown("");
    setEditorLoading(true);
    setEditorOpen(true);

    const result = await window.api.skills.readSkillMarkdown(
      workspaceSkillTarget,
      folderName,
    );
    setEditorMarkdown(
      result.success && result.content !== undefined ? result.content : "",
    );
    setEditorLoading(false);
  };

  const toggleSelect = (folderName: string): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(folderName)) {
        next.delete(folderName);
      } else {
        next.add(folderName);
      }
      return next;
    });
  };

  const toggleSelectPage = (): void => {
    const allCurrentPageSelected = pagedFolders.every((folder) =>
      selected.has(folder.folderName),
    );

    setSelected((prev) => {
      const next = new Set(prev);
      if (allCurrentPageSelected) {
        for (const folder of pagedFolders) {
          next.delete(folder.folderName);
        }
      } else {
        for (const folder of pagedFolders) {
          next.add(folder.folderName);
        }
      }
      return next;
    });
  };

  const handleSaveEditor = async (): Promise<void> => {
    const skillName = editorName.trim();
    if (!workspaceReady || !skillName || editorLoading) {
      return;
    }

    setBusy(true);
    try {
      if (editorMode === "create") {
        const createResult = await window.api.skills.createSkill(
          workspaceSkillTarget,
          skillName,
          editorMarkdown.trim() ? editorMarkdown : undefined,
        );
        if (!createResult.success) {
          toast.error(createResult.error ?? t("skills.createFailed"));
          return;
        }
        toast.success(t("skills.skillCreated"));
      } else {
        if (!originFolder) {
          return;
        }
        let finalFolder = originFolder;

        const renameResult = await window.api.skills.renameSkillFolder(
          workspaceSkillTarget,
          originFolder,
          skillName,
        );
        if (!renameResult.success) {
          toast.error(renameResult.error ?? t("skills.renameFailed"));
          return;
        }
        if (renameResult.folder) {
          finalFolder = renameResult.folder;
        }

        const writeResult = await window.api.skills.writeSkillMarkdown(
          workspaceSkillTarget,
          finalFolder,
          editorMarkdown,
        );
        if (!writeResult.success) {
          toast.error(writeResult.error ?? t("skills.saveFailed"));
          return;
        }
        toast.success(t("skills.skillUpdated"));
      }

      setEditorOpen(false);
      await reload();
      setCurrentPage(1);
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteFolders = async (): Promise<void> => {
    if (!workspaceReady || selected.size === 0) {
      return;
    }

    setBusy(true);
    try {
      await window.api.skills.deleteSkillFolders(
        workspaceSkillTarget,
        [...selected],
      );
      await reload();
      toast.success(t("skills.deletedSelectedSkills"));
      setDeleteConfirm(null);
    } catch {
      toast.error(t("skills.deleteFailed"));
    } finally {
      setBusy(false);
    }
  };

  const selectedCount = selected.size;
  const allCurrentPageSelected =
    pagedFolders.length > 0 &&
    pagedFolders.every((folder) => selected.has(folder.folderName));

  return (
    <>
      <div className="space-y-6">
        <SettingsSection
          title={t("skills.globalSources")}
          description={t("skills.globalSourcesDesc")}
        >
          <SettingsCard>
            {sources.length === 0 ? (
              <div className="px-4 py-3 text-sm text-muted-foreground">
                {t("skills.defaultSourceOnly")}
              </div>
            ) : (
              sources.map((source) => <SettingsRow key={source} label={source} />)
            )}
          </SettingsCard>
        </SettingsSection>

        <SettingsSection
          title={t("skills.skillFoldersPaginated")}
          description={t("skills.skillFoldersDesc")}
          action={
            <Button
              variant="outline"
              size="sm"
              disabled={!workspaceReady}
              onClick={() => {
                setCurrentPage(1);
                setSkillsDialogOpen(true);
              }}
            >
              {t("skills.openList")}
            </Button>
          }
        >
          <SettingsCard>
            <SettingsRow
              label={t("skills.allSkills")}
              description={
                workspaceReady
                  ? t("skills.skillListDesc", { count: folders.length })
                  : t("skills.selectWorkspaceFirst")
              }
            />
          </SettingsCard>
        </SettingsSection>
      </div>

      <Dialog open={skillsDialogOpen} onOpenChange={setSkillsDialogOpen}>
        <DialogContent className="flex h-[min(88vh,48rem)] w-[min(96vw,78rem)] max-w-7xl flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle>{t("skills.listDialogTitle")}</DialogTitle>
          </DialogHeader>

          <div className="flex min-h-0 flex-1 flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={busy || !workspaceReady}
                onClick={() => void handleImport()}
              >
                <Sparkles className="mr-1 h-3.5 w-3.5" />
                {t("skills.importFromDisk")}
              </Button>
              <Button
                size="sm"
                disabled={busy || !workspaceReady}
                onClick={openCreateEditor}
              >
                <SquarePen className="mr-1 h-3.5 w-3.5" />
                {t("skills.newSkill")}
              </Button>
            </div>

            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t("skills.searchSkillName")}
                className="h-9 rounded-lg pl-9 text-sm"
              />
            </div>

            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                {t("skills.matchCount", {
                  filtered: filteredFolders.length,
                  total: folders.length,
                  selected: selectedCount,
                })}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-[11px]"
                  disabled={pagedFolders.length === 0 || busy || !workspaceReady}
                  onClick={toggleSelectPage}
                >
                  {allCurrentPageSelected
                    ? t("skills.deselectPageAll")
                    : t("skills.selectPageAll")}
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  className="h-7 px-2 text-[11px]"
                  disabled={busy || selectedCount === 0 || !workspaceReady}
                  onClick={() => setDeleteConfirm({ type: "folders" })}
                >
                  {t("skills.deleteSelected")}
                </Button>
              </div>
            </div>

            <div
              ref={listViewportRef}
              className="min-h-0 flex-1 overflow-hidden rounded-xl border border-border/50 bg-card"
            >
              <ScrollArea className="h-full">
              {!workspaceReady ? (
                <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                  {t("skills.selectWorkspaceFirst")}
                </div>
              ) : folders.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                  {t("skills.noSkillFolders")}
                </div>
              ) : filteredFolders.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                  {t("skills.noMatchingSkills")}
                </div>
              ) : (
                <div
                  key={currentPage}
                  className="grid gap-2 p-2.5 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4"
                >
                  {pagedFolders.map((folder) => {
                    const checked = selected.has(folder.folderName);
                    return (
                      <button
                        key={folder.folderName}
                        type="button"
                        className={cn(
                          "group flex min-h-18 flex-col items-start rounded-lg border border-border/50 px-3 py-2.5 text-left transition-colors hover:border-primary/20 hover:bg-primary/5",
                          highlightedCard === folder.folderName &&
                            "animate-card-highlight",
                        )}
                        onClick={() => void openEditEditor(folder.folderName)}
                      >
                        <div className="flex w-full items-start justify-between gap-2">
                          <span className="truncate text-[13px] font-semibold leading-5">
                            {folder.folderName}
                          </span>
                          <input
                            type="checkbox"
                            className="mt-0.5 size-3.5 accent-primary"
                            checked={checked}
                            onClick={(e) => e.stopPropagation()}
                            onChange={() => toggleSelect(folder.folderName)}
                          />
                        </div>
                        <div className="mt-2 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                          {t("skills.skillTag")}
                        </div>
                        <div className="mt-1 text-[11px] text-muted-foreground">
                          {t("skills.lastUpdated", {
                            value: formatDateTimeWithYear(folder.updatedAt),
                          })}
                        </div>
                        <p className="mt-1.5 line-clamp-2 text-[11px] leading-4 text-muted-foreground">
                          {folder.description}
                        </p>
                        <div className="mt-2 text-[11px] font-medium text-primary opacity-85 transition-opacity group-hover:opacity-100">
                          {t("skills.openEditor")}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
              </ScrollArea>
            </div>

            {totalPages > 1 && (
              <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border/50 pt-2">
                <div className="text-xs text-muted-foreground">
                  {t("skills.pageInfo", {
                    current: Math.min(currentPage, totalPages),
                    total: totalPages,
                  })}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 px-2"
                    disabled={currentPage <= 1}
                    onClick={() =>
                      setCurrentPage((prev) => Math.max(1, prev - 1))
                    }
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                    {t("skills.prevPage")}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 px-2"
                    disabled={currentPage >= totalPages}
                    onClick={() =>
                      setCurrentPage((prev) => Math.min(totalPages, prev + 1))
                    }
                  >
                    {t("skills.nextPage")}
                    <ChevronRight className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogContent className="flex max-h-[min(88vh,48rem)] w-[min(96vw,56rem)] max-w-3xl flex-col overflow-hidden p-0">
          <DialogHeader className="shrink-0 border-b px-5 py-4">
            <DialogTitle>
              {editorMode === "create"
                ? t("skills.createTitle")
                : t("skills.editTitle")}
            </DialogTitle>
          </DialogHeader>

          <div className="flex min-h-0 flex-1 flex-col px-5 py-4">
            <ScrollArea className="min-h-0 flex-1 rounded-xl border border-border/50">
              <div className="flex flex-col gap-4 p-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">
                    {t("skills.skillFolderName")}
                  </label>
                  <Input
                    value={editorName}
                    onChange={(e) => setEditorName(e.target.value)}
                    placeholder={t("skills.skillFolderNamePlaceholder")}
                    disabled={busy || editorLoading}
                  />
                </div>

                <div className="flex flex-col space-y-1.5">
                  <label className="text-sm font-medium">
                    {t("skills.skillMdContent")}
                  </label>
                  <ScrollArea className="rounded-xl border border-border/50">
                    <textarea
                      value={editorMarkdown}
                      onChange={(e) => setEditorMarkdown(e.target.value)}
                      placeholder={
                        editorLoading
                          ? t("skills.loadingPlaceholder")
                          : t("skills.skillMdContent")
                      }
                      disabled={busy || editorLoading}
                      className={cn(
                        textAreaClassName,
                        "min-h-60 border-0 bg-transparent",
                      )}
                    />
                  </ScrollArea>
                </div>
              </div>
            </ScrollArea>
          </div>

          <DialogFooter className="gap-2 border-t px-5 py-3">
            <Button
              variant="ghost"
              onClick={() => setEditorOpen(false)}
              disabled={busy}
            >
              {t("common:cancel")}
            </Button>
            <Button
              disabled={busy || editorLoading || !editorName.trim()}
              onClick={() => void handleSaveEditor()}
            >
              {t("common:save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={deleteConfirm !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            setDeleteConfirm(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("skills.confirmDeleteSkills")}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {t("skills.deleteSkillsWarning", { count: selectedCount })}
          </p>
          <DialogFooter className="gap-2">
            <Button variant="secondary" onClick={() => setDeleteConfirm(null)}>
              {t("common:cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={() => void handleConfirmDelete()}
            >
              {t("common:delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
