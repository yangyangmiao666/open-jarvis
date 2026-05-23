import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronLeft,
  ChevronRight,
  FolderTree,
  LibraryBig,
  Search,
  Sparkles,
  SquarePen,
  WandSparkles,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { toast } from "@/components/ui/toast";

interface SkillsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type EditorMode = "create" | "edit";

type SkillsDeleteConfirmState =
  | { type: "folders" }
  | null;

const PAGE_SIZE = 12;

export function SkillsDialog({
  open,
  onOpenChange,
}: SkillsDialogProps): React.JSX.Element {
  const { t } = useTranslation("settings");
  const workspaceSkillTarget = undefined;
  const [sources, setSources] = useState<string[]>([]);
  const [folders, setFolders] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [currentPage, setCurrentPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [workspaceReady, setWorkspaceReady] = useState(false);

  const [deleteConfirm, setDeleteConfirm] =
    useState<SkillsDeleteConfirmState>(null);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editorMode, setEditorMode] = useState<EditorMode>("create");
  const [originFolder, setOriginFolder] = useState<string | null>(null);
  const [editorName, setEditorName] = useState("");
  const [editorMarkdown, setEditorMarkdown] = useState("");
  const [editorLoading, setEditorLoading] = useState(false);
  const [highlightedCard, setHighlightedCard] = useState<string | null>(null);

  const textAreaClassName = cn(
    "flex w-full rounded-[20px] border border-input/90 bg-background/78 px-4 py-3 text-xs font-mono shadow-[inset_0_1px_0_color-mix(in_srgb,#fff_10%,transparent)]",
    "placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/55",
    "disabled:cursor-not-allowed disabled:opacity-50",
  );

  const reload = async (): Promise<void> => {
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
  };

  useEffect(() => {
    if (!open) return;
    void reload();
    setCurrentPage(1);
    setSearchQuery("");
  }, [open, reload]);

  const filteredFolders = useMemo(() => {
    const keyword = searchQuery.trim().toLowerCase();
    if (!keyword) return folders;
    return folders.filter((folder) => folder.toLowerCase().includes(keyword));
  }, [folders, searchQuery]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery]);

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(filteredFolders.length / PAGE_SIZE)),
    [filteredFolders.length],
  );

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  const pagedFolders = useMemo(() => {
    const safePage = Math.min(currentPage, totalPages);
    const start = (safePage - 1) * PAGE_SIZE;
    return filteredFolders.slice(start, start + PAGE_SIZE);
  }, [filteredFolders, currentPage, totalPages]);

  const handleConfirmDelete = async (): Promise<void> => {
    if (!deleteConfirm) return;

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
    setEditorMarkdown(result.success && result.content !== undefined ? result.content : "");
    setEditorLoading(false);
  };

  const toggleSelect = (folderName: string): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(folderName)) next.delete(folderName);
      else next.add(folderName);
      return next;
    });
  };

  const toggleSelectPage = (): void => {
    const allCurrentPageSelected = pagedFolders.every((folder) =>
      selected.has(folder),
    );

    setSelected((prev) => {
      const next = new Set(prev);
      if (allCurrentPageSelected) {
        for (const folder of pagedFolders) next.delete(folder);
      } else {
        for (const folder of pagedFolders) next.add(folder);
      }
      return next;
    });
  };

  const handleSaveEditor = async (): Promise<void> => {
    const skillName = editorName.trim();
    if (!workspaceReady || !skillName || editorLoading) return;

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
        if (!originFolder) return;
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
    if (!workspaceReady || selected.size === 0) return;
    setBusy(true);
    try {
      await window.api.skills.deleteSkillFolders(workspaceSkillTarget, [...selected]);
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
    pagedFolders.length > 0 && pagedFolders.every((folder) => selected.has(folder));

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex max-h-[min(92vh,56rem)] w-[min(96vw,88rem)] max-w-352 flex-col overflow-hidden p-0">
          <DialogHeader className="shrink-0 rounded-t-4xl border-b border-border/60 px-6 py-5 pr-16 sm:px-7 sm:pr-20">
            <div className="flex items-center gap-3">
              <div className="badge-green inline-flex shrink-0 items-center gap-2 rounded-full border border-status-nominal/20 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em]">
                <WandSparkles className="size-3.5" />
                {t('skills.workspaceLabel')}
              </div>
              <DialogTitle className="text-xl tracking-[-0.03em]">
                {t("skills.title")}
              </DialogTitle>
            </div>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          <div className="grid min-h-0 gap-4 lg:grid-cols-[minmax(0,0.74fr)_minmax(0,1.46fr)]">
            <section className="app-flat-surface flex min-h-0 flex-col gap-4 rounded-[26px] border border-border/70 px-5 py-5">
              <div className="flex items-start gap-3">
                  <div className="icon-green flex size-11 shrink-0 items-center justify-center rounded-[18px] border border-border/70 shadow-[0_8px_18px_color-mix(in_srgb,var(--status-nominal)_7%,transparent),inset_0_1px_0_color-mix(in_srgb,#fff_12%,transparent)]">
                  <LibraryBig className="size-5" />
                </div>
                <div className="min-w-0">
                  <div className="text-section-header">{t('skills.sourcesLabel')}</div>
                  <div className="mt-1 text-base font-semibold tracking-[-0.02em] text-foreground">
                    {t("skills.globalSources")}
                  </div>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    {t("skills.globalSourcesDesc")}
                  </p>
                </div>
              </div>

              <ScrollArea className="app-subtle-scroll h-40 rounded-[22px] border border-border/70 bg-background/35">
                <div className="space-y-2 p-3">
                  {sources.length === 0 && (
                    <div className="rounded-2xl border border-dashed border-border/70 px-3 py-8 text-center text-xs text-muted-foreground">
                      {t("skills.defaultSourceOnly")}
                    </div>
                  )}
                  {sources.map((source) => (
                    <div
                      key={source}
                      className="flex items-center justify-between gap-3 rounded-2xl border border-border/60 bg-[linear-gradient(180deg,color-mix(in_srgb,var(--card)_86%,transparent),color-mix(in_srgb,var(--background-elevated)_74%,transparent))] px-3 py-2 text-xs font-mono"
                    >
                      <span className="truncate">{source}</span>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </section>

            <section className="app-flat-surface flex min-h-0 flex-col overflow-hidden rounded-[26px] border border-border/70 px-5 py-5">
              <div className="flex shrink-0 flex-wrap items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className="icon-amber flex size-11 shrink-0 items-center justify-center rounded-[18px] border border-border/70 shadow-[0_8px_18px_color-mix(in_srgb,var(--status-warning)_7%,transparent),inset_0_1px_0_color-mix(in_srgb,#fff_12%,transparent)]">
                    <FolderTree className="size-5" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-section-header">{t('skills.globalLabel')}</div>
                    <div className="mt-1 text-base font-semibold tracking-[-0.02em] text-foreground">
                      {t("skills.skillFoldersPaginated")}
                    </div>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">
                      {t("skills.skillFoldersDesc")}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-10 rounded-2xl px-4 text-xs whitespace-nowrap"
                    disabled={busy || !workspaceReady}
                    onClick={() => void handleImport()}
                  >
                    <Sparkles className="mr-1 size-3.5" />
                    {t("skills.importFromDisk")}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    className="h-10 rounded-2xl px-4 text-xs whitespace-nowrap"
                    disabled={busy || !workspaceReady}
                    onClick={openCreateEditor}
                  >
                    <SquarePen className="mr-1 size-3.5" />
                    {t("skills.newSkill")}
                  </Button>
                </div>
              </div>

              <div className="mt-3 shrink-0">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder={t("skills.searchSkillName")}
                    className="h-10 rounded-2xl pl-9 text-xs"
                  />
                </div>
              </div>

              <div className="mt-3 flex shrink-0 flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
                <span>
                  {t("skills.matchCount", { filtered: filteredFolders.length, total: folders.length, selected: selectedCount })}
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 rounded-xl px-3 text-[11px]"
                    disabled={pagedFolders.length === 0 || busy || !workspaceReady}
                    onClick={toggleSelectPage}
                  >
                    {allCurrentPageSelected ? t("skills.deselectPageAll") : t("skills.selectPageAll")}
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    className="h-8 rounded-xl px-3 text-[11px]"
                    disabled={busy || selectedCount === 0 || !workspaceReady}
                    onClick={() => setDeleteConfirm({ type: "folders" })}
                  >
                    {t("skills.deleteSelected")}
                  </Button>
                </div>
              </div>

              <div className="app-subtle-scroll mt-3 min-h-0 flex-1 overflow-y-auto rounded-[22px] border border-border/70 bg-background/35 p-3">
                {!workspaceReady ? (
                  <div className="rounded-2xl border border-dashed border-border/70 px-3 py-16 text-center text-xs text-muted-foreground">
                    {t("skills.selectWorkspaceFirst")}
                  </div>
                ) : folders.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-border/70 px-3 py-16 text-center text-xs text-muted-foreground">
                    {t("skills.noSkillFolders")}
                  </div>
                ) : filteredFolders.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-border/70 px-3 py-16 text-center text-xs text-muted-foreground">
                    {t("skills.noMatchingSkills")}
                  </div>
                ) : (
                  <div key={currentPage} className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 animate-soft-fade">
                    {pagedFolders.map((folderName) => {
                      const checked = selected.has(folderName);
                      return (
                        <button
                          key={folderName}
                          type="button"
                          className={cn(
                            "group flex min-h-40.5 flex-col items-start rounded-[18px] border border-border/70 bg-[linear-gradient(180deg,color-mix(in_srgb,var(--card)_86%,transparent),color-mix(in_srgb,var(--background-elevated)_74%,transparent))] p-4 text-left transition-colors hover:border-primary/24 hover:bg-background-interactive/55",
                            highlightedCard === folderName && "animate-card-highlight",
                          )}
                          onClick={() => void openEditEditor(folderName)}
                        >
                          <div className="flex w-full items-start justify-between gap-2">
                            <span className="truncate text-sm font-semibold tracking-[-0.01em] text-foreground">
                              {folderName}
                            </span>
                            <input
                              type="checkbox"
                              className="mt-0.5 size-3.5 accent-primary"
                              checked={checked}
                              onClick={(event) => event.stopPropagation()}
                              onChange={() => toggleSelect(folderName)}
                            />
                          </div>
                          <div className="mt-3 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                            {t('skills.skillTag')}
                          </div>
                          <p className="mt-2 line-clamp-4 text-xs leading-5 text-muted-foreground">
                            {t("skills.cardHint")}
                          </p>
                          <div className="mt-4 text-[11px] font-medium text-primary opacity-85 transition-opacity group-hover:opacity-100">
                            {t("skills.openEditor")}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="mt-3 flex shrink-0 items-center justify-between gap-3 border-t border-border/60 pt-3">
                <div className="text-xs text-muted-foreground">
                  {t("skills.pageInfo", { current: Math.min(currentPage, totalPages), total: totalPages })}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-9 rounded-xl px-3"
                    disabled={currentPage <= 1}
                    onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                  >
                    <ChevronLeft className="size-3.5" />
                    {t("skills.prevPage")}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-9 rounded-xl px-3"
                    disabled={currentPage >= totalPages}
                    onClick={() =>
                      setCurrentPage((prev) => Math.min(totalPages, prev + 1))
                    }
                  >
                    {t("skills.nextPage")}
                    <ChevronRight className="size-3.5" />
                  </Button>
                </div>
              </div>
            </section>
          </div>
          </div>

          </DialogContent>
      </Dialog>

      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogContent className="flex max-h-[min(88vh,48rem)] w-[min(96vw,56rem)] max-w-3xl flex-col overflow-hidden p-0">
          <DialogHeader className="shrink-0 rounded-t-4xl border-b border-border/60 px-5 py-5 pr-16 sm:pr-20">
            <DialogTitle>
              {editorMode === "create" ? t("skills.createTitle") : t("skills.editTitle")}
            </DialogTitle>
          </DialogHeader>

          <div className="flex min-h-0 flex-1 flex-col px-5 py-4">
            <ScrollArea className="min-h-0 flex-1 rounded-3xl border border-border/80 bg-[linear-gradient(180deg,color-mix(in_srgb,var(--card)_88%,transparent),color-mix(in_srgb,var(--background-elevated)_82%,transparent))]">
              <div className="flex flex-col gap-4 p-4 sm:p-5">
                <div className="flex items-start gap-3">
                  <div className="icon-green flex size-10 shrink-0 items-center justify-center rounded-[16px] border border-border/70 shadow-[0_8px_18px_color-mix(in_srgb,var(--status-nominal)_7%,transparent),inset_0_1px_0_color-mix(in_srgb,#fff_12%,transparent)]">
                    <SquarePen className="size-4.5" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-section-header">{t('skills.editorLabel')}</div>
                    <div className="mt-1 text-base font-semibold tracking-[-0.02em] text-foreground">
                      {editorMode === "create" ? t("skills.newSkillContent") : t("skills.editSkillContent")}
                    </div>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">
                      {t("skills.editorDesc")}
                    </p>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-foreground">{t("skills.skillFolderName")}</label>
                  <Input
                    value={editorName}
                    onChange={(event) => setEditorName(event.target.value)}
                    placeholder={t("skills.skillFolderNamePlaceholder")}
                    className="rounded-2xl border-border/80 bg-background/80 text-xs font-mono"
                    disabled={busy || editorLoading}
                  />
                </div>

                <div className="flex flex-col space-y-1.5">
                  <label className="text-sm font-medium text-foreground">{t("skills.skillMdContent")}</label>
                  <ScrollArea className="rounded-3xl border border-border/85 bg-background/88 shadow-[inset_0_1px_0_color-mix(in_srgb,#fff_10%,transparent),0_0_0_1px_color-mix(in_srgb,var(--border)_35%,transparent)]">
                    <textarea
                      value={editorMarkdown}
                      onChange={(event) => setEditorMarkdown(event.target.value)}
                      placeholder={editorLoading ? t("skills.loadingPlaceholder") : t("skills.skillMdContent")}
                      disabled={busy || editorLoading}
                      className={cn(
                        textAreaClassName,
                        "min-h-90 resize-none border-0 bg-transparent shadow-none",
                      )}
                    />
                  </ScrollArea>
                </div>
              </div>
            </ScrollArea>
          </div>

          <DialogFooter className="shrink-0 border-t border-border/60 px-5 py-4 sm:gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setEditorOpen(false)}
              disabled={busy}
            >
              {t("common:cancel")}
            </Button>
            <Button
              type="button"
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
        onOpenChange={(nextOpen) => !nextOpen && setDeleteConfirm(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("skills.confirmDeleteSkills")}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {t("skills.deleteSkillsWarning", { count: selectedCount })}
          </p>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setDeleteConfirm(null)}
            >
              {t("common:cancel")}
            </Button>
            <Button
              type="button"
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