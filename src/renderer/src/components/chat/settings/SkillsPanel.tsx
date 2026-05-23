import { useEffect, useMemo, useState } from "react";
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
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { toast } from "@/components/ui/toast";
import { SettingsSection, SettingsCard, SettingsRow } from "./primitives";

const PAGE_SIZE = 12;

type SkillsDeleteConfirmState = { type: "folders" } | null;

const textAreaClassName = cn(
  "flex w-full rounded-lg border border-input bg-background px-3 py-2 text-xs font-mono",
  "placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
  "disabled:cursor-not-allowed disabled:opacity-50 resize-y",
);

export function SkillsPanel(): React.JSX.Element {
  const { t } = useTranslation("settings");
  const workspaceSkillTarget = undefined;
  const [sources, setSources] = useState<string[]>([]);
  const [folders, setFolders] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [currentPage, setCurrentPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [workspaceReady, setWorkspaceReady] = useState(false);

  const [deleteConfirm, setDeleteConfirm] = useState<SkillsDeleteConfirmState>(null);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editorMode, setEditorMode] = useState<"create" | "edit">("create");
  const [originFolder, setOriginFolder] = useState<string | null>(null);
  const [editorName, setEditorName] = useState("");
  const [editorMarkdown, setEditorMarkdown] = useState("");
  const [editorLoading, setEditorLoading] = useState(false);
  const [highlightedCard, setHighlightedCard] = useState<string | null>(null);

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
    void reload();
    setCurrentPage(1);
    setSearchQuery("");
  }, []);

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

    const result = await window.api.skills.readSkillMarkdown(workspaceSkillTarget, folderName);
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
    const allCurrentPageSelected = pagedFolders.every((folder) => selected.has(folder));

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
      <div className="space-y-6">
        <SettingsSection title={t("skills.globalSources")} description={t("skills.globalSourcesDesc")}>
          <SettingsCard>
            {sources.length === 0 ? (
              <div className="px-4 py-3 text-sm text-muted-foreground">{t("skills.defaultSourceOnly")}</div>
            ) : (
              sources.map((source) => (
                <SettingsRow key={source} label={source} />
              ))
            )}
          </SettingsCard>
        </SettingsSection>

        <SettingsSection
          title={t("skills.skillFoldersPaginated")}
          description={t("skills.skillFoldersDesc")}
          action={
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={busy || !workspaceReady}
                onClick={() => void handleImport()}
              >
                <Sparkles className="h-3.5 w-3.5 mr-1" />
                {t("skills.importFromDisk")}
              </Button>
              <Button
                size="sm"
                disabled={busy || !workspaceReady}
                onClick={openCreateEditor}
              >
                <SquarePen className="h-3.5 w-3.5 mr-1" />
                {t("skills.newSkill")}
              </Button>
            </div>
          }
        >
          <div className="space-y-3">
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
                {t("skills.matchCount", { filtered: filteredFolders.length, total: folders.length, selected: selectedCount })}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-[11px]"
                  disabled={pagedFolders.length === 0 || busy || !workspaceReady}
                  onClick={toggleSelectPage}
                >
                  {allCurrentPageSelected ? t("skills.deselectPageAll") : t("skills.selectPageAll")}
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

            <div className="rounded-xl border border-border/50 bg-card overflow-hidden">
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
                <div key={currentPage} className="grid gap-2 p-3 md:grid-cols-2 xl:grid-cols-3">
                  {pagedFolders.map((folderName) => {
                    const checked = selected.has(folderName);
                    return (
                      <button
                        key={folderName}
                        type="button"
                        className={cn(
                          "group flex min-h-[120px] flex-col items-start rounded-lg border border-border/50 p-3 text-left transition-colors hover:border-primary/20 hover:bg-primary/5",
                          highlightedCard === folderName && "animate-card-highlight",
                        )}
                        onClick={() => void openEditEditor(folderName)}
                      >
                        <div className="flex w-full items-start justify-between gap-2">
                          <span className="truncate text-sm font-semibold">{folderName}</span>
                          <input
                            type="checkbox"
                            className="mt-0.5 size-3.5 accent-primary"
                            checked={checked}
                            onClick={(e) => e.stopPropagation()}
                            onChange={() => toggleSelect(folderName)}
                          />
                        </div>
                        <div className="mt-2 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                          {t("skills.skillTag")}
                        </div>
                        <p className="mt-1 line-clamp-3 text-xs leading-5 text-muted-foreground">
                          {t("skills.cardHint")}
                        </p>
                        <div className="mt-3 text-[11px] font-medium text-primary opacity-85 transition-opacity group-hover:opacity-100">
                          {t("skills.openEditor")}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-between gap-3 pt-1">
                <div className="text-xs text-muted-foreground">
                  {t("skills.pageInfo", { current: Math.min(currentPage, totalPages), total: totalPages })}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 px-2"
                    disabled={currentPage <= 1}
                    onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                    {t("skills.prevPage")}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 px-2"
                    disabled={currentPage >= totalPages}
                    onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
                  >
                    {t("skills.nextPage")}
                    <ChevronRight className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            )}
          </div>
        </SettingsSection>
      </div>

      {/* Skill editor dialog */}
      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogContent className="flex max-h-[min(88vh,48rem)] w-[min(96vw,56rem)] max-w-3xl flex-col overflow-hidden p-0">
          <DialogHeader className="shrink-0 border-b px-5 py-4">
            <DialogTitle>
              {editorMode === "create" ? t("skills.createTitle") : t("skills.editTitle")}
            </DialogTitle>
          </DialogHeader>

          <div className="flex min-h-0 flex-1 flex-col px-5 py-4">
            <ScrollArea className="min-h-0 flex-1 rounded-xl border border-border/50">
              <div className="flex flex-col gap-4 p-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">{t("skills.skillFolderName")}</label>
                  <Input
                    value={editorName}
                    onChange={(e) => setEditorName(e.target.value)}
                    placeholder={t("skills.skillFolderNamePlaceholder")}
                    disabled={busy || editorLoading}
                  />
                </div>

                <div className="flex flex-col space-y-1.5">
                  <label className="text-sm font-medium">{t("skills.skillMdContent")}</label>
                  <ScrollArea className="rounded-xl border border-border/50">
                    <textarea
                      value={editorMarkdown}
                      onChange={(e) => setEditorMarkdown(e.target.value)}
                      placeholder={editorLoading ? t("skills.loadingPlaceholder") : t("skills.skillMdContent")}
                      disabled={busy || editorLoading}
                      className={cn(textAreaClassName, "min-h-[240px] border-0 bg-transparent")}
                    />
                  </ScrollArea>
                </div>
              </div>
            </ScrollArea>
          </div>

          <DialogFooter className="shrink-0 border-t px-5 py-3 gap-2">
            <Button variant="ghost" onClick={() => setEditorOpen(false)} disabled={busy}>
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

      {/* Delete confirmation dialog */}
      <Dialog open={deleteConfirm !== null} onOpenChange={(nextOpen) => !nextOpen && setDeleteConfirm(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("skills.confirmDeleteSkills")}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {t("skills.deleteSkillsWarning", { count: selectedCount })}
          </p>
          <DialogFooter className="gap-2">
            <Button variant="secondary" onClick={() => setDeleteConfirm(null)}>{t("common:cancel")}</Button>
            <Button variant="destructive" onClick={() => void handleConfirmDelete()}>{t("common:delete")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}