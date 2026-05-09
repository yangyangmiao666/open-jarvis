import { useEffect, useMemo, useState } from "react";
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

interface SkillsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type EditorMode = "create" | "edit";

type SkillsDeleteConfirmState =
  | { type: "folders" }
  | { type: "source"; value: string }
  | null;

const PAGE_SIZE = 12;

export function SkillsDialog({
  open,
  onOpenChange,
}: SkillsDialogProps): React.JSX.Element {
  const workspaceSkillTarget = undefined;
  const [sources, setSources] = useState<string[]>([]);
  const [newSource, setNewSource] = useState("");
  const [folders, setFolders] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [currentPage, setCurrentPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [workspaceReady, setWorkspaceReady] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const [deleteConfirm, setDeleteConfirm] =
    useState<SkillsDeleteConfirmState>(null);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editorMode, setEditorMode] = useState<EditorMode>("create");
  const [originFolder, setOriginFolder] = useState<string | null>(null);
  const [editorName, setEditorName] = useState("");
  const [editorMarkdown, setEditorMarkdown] = useState("");
  const [editorLoading, setEditorLoading] = useState(false);

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
    setStatus(null);
    setCurrentPage(1);
    setSearchQuery("");
  }, [open]);

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

  const addSource = (): void => {
    const target = newSource.trim();
    if (!target) return;
    const normalized = target;
    if (sources.includes(normalized)) {
      setNewSource("");
      return;
    }

    const nextSources = [...sources, normalized];
    setSources(nextSources);
    setNewSource("");
    setStatus("已添加技能来源路径");
    void window.api.skills.setSources(nextSources);
  };

  const removeSource = (target: string): void => {
    const nextSources = sources.filter((source) => source !== target);
    setSources(nextSources);
    setStatus("已移除技能来源路径");
    void window.api.skills.setSources(nextSources);
  };

  const handleConfirmDelete = async (): Promise<void> => {
    if (!deleteConfirm) return;

    if (deleteConfirm.type === "source") {
      removeSource(deleteConfirm.value);
      setDeleteConfirm(null);
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
        setStatus("已从磁盘导入技能目录");
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
          setStatus(createResult.error ?? "创建技能失败");
          return;
        }
        setStatus("技能已创建");
      } else {
        if (!originFolder) return;
        let finalFolder = originFolder;

        const renameResult = await window.api.skills.renameSkillFolder(
          workspaceSkillTarget,
          originFolder,
          skillName,
        );
        if (!renameResult.success) {
          setStatus(renameResult.error ?? "重命名失败");
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
          setStatus(writeResult.error ?? "保存失败");
          return;
        }
        setStatus("技能已更新");
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
      setStatus("已删除选中的技能目录");
      setDeleteConfirm(null);
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
        <DialogContent className="h-[88vh] max-h-[92vh] w-[min(96vw,88rem)] max-w-[88rem] flex flex-col overflow-hidden pb-2 sm:pb-2">
          <DialogHeader className="rounded-[28px] border border-border/70 bg-[radial-gradient(circle_at_top_left,color-mix(in_srgb,var(--primary)_14%,transparent),transparent_46%),linear-gradient(180deg,color-mix(in_srgb,var(--card)_98%,transparent),color-mix(in_srgb,var(--background)_94%,transparent))] px-6 py-4 pr-14">
            <div className="flex items-center gap-3">
              <div className="inline-flex shrink-0 items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">
                <WandSparkles className="size-3.5" />
                Skills Workspace
              </div>
              <DialogTitle className="text-xl tracking-[-0.03em]">
                技能配置
              </DialogTitle>
            </div>
          </DialogHeader>

          <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,0.74fr)_minmax(0,1.46fr)]">
            <section className="app-flat-surface flex min-h-0 flex-col gap-4 rounded-[26px] border border-border/70 px-5 py-5">
              <div className="flex items-start gap-3">
                  <div className="flex size-11 shrink-0 items-center justify-center rounded-[18px] border border-border/70 bg-background-elevated/80 text-primary shadow-[0_8px_18px_color-mix(in_srgb,var(--primary)_7%,transparent),inset_0_1px_0_color-mix(in_srgb,#fff_12%,transparent)]">
                  <LibraryBig className="size-5" />
                </div>
                <div className="min-w-0">
                  <div className="text-section-header">Sources</div>
                  <div className="mt-1 text-base font-semibold tracking-[-0.02em] text-foreground">
                    全局技能来源
                  </div>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    添加或移除全局技能来源路径。路径相对于工作区根目录，建议使用 POSIX 风格。
                  </p>
                </div>
              </div>

              <ScrollArea className="app-subtle-scroll h-40 rounded-[22px] border border-border/70 bg-background/35">
                <div className="space-y-2 p-3">
                  {sources.length === 0 && (
                    <div className="rounded-2xl border border-dashed border-border/70 px-3 py-8 text-center text-xs text-muted-foreground">
                      暂无额外路径，当前仅使用默认技能来源。
                    </div>
                  )}
                  {sources.map((source) => (
                    <div
                      key={source}
                      className="flex items-center justify-between gap-3 rounded-2xl border border-border/60 bg-[linear-gradient(180deg,color-mix(in_srgb,var(--card)_86%,transparent),color-mix(in_srgb,var(--background-elevated)_74%,transparent))] px-3 py-2 text-xs font-mono"
                    >
                      <span className="truncate">{source}</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 rounded-xl px-2 text-[11px]"
                        onClick={() =>
                          setDeleteConfirm({ type: "source", value: source })
                        }
                      >
                        移除
                      </Button>
                    </div>
                  ))}
                </div>
              </ScrollArea>

              <div className="flex gap-2">
                <Input
                  value={newSource}
                  onChange={(event) => setNewSource(event.target.value)}
                  placeholder="例如：~/.open-jarvis/skills"
                  className="text-xs"
                />
                <Button
                  type="button"
                  size="sm"
                  className="h-10 shrink-0 rounded-2xl px-4"
                  onClick={addSource}
                >
                  添加
                </Button>
              </div>
            </section>

            <section className="app-flat-surface flex min-h-0 flex-col overflow-hidden rounded-[26px] border border-border/70 px-5 py-5">
              <div className="flex shrink-0 flex-wrap items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className="flex size-11 shrink-0 items-center justify-center rounded-[18px] border border-border/70 bg-background-elevated/80 text-primary shadow-[0_8px_18px_color-mix(in_srgb,var(--primary)_7%,transparent),inset_0_1px_0_color-mix(in_srgb,#fff_12%,transparent)]">
                    <FolderTree className="size-5" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-section-header">Workspace</div>
                    <div className="mt-1 text-base font-semibold tracking-[-0.02em] text-foreground">
                      技能目录（卡片分页）
                    </div>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">
                      点击卡片直接编辑，支持多选删除与分页浏览。新增技能在独立子弹窗中完成。
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
                    从磁盘导入
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    className="h-10 rounded-2xl px-4 text-xs whitespace-nowrap"
                    disabled={busy || !workspaceReady}
                    onClick={openCreateEditor}
                  >
                    <SquarePen className="mr-1 size-3.5" />
                    新增技能
                  </Button>
                </div>
              </div>

              <div className="mt-3 shrink-0">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder="搜索技能目录名"
                    className="h-10 rounded-2xl pl-9 text-xs"
                  />
                </div>
              </div>

              <div className="mt-3 flex shrink-0 flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
                <span>
                  匹配 {filteredFolders.length} / {folders.length} 个技能目录，已选 {selectedCount} 个
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
                    {allCurrentPageSelected ? "取消本页全选" : "本页全选"}
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    className="h-8 rounded-xl px-3 text-[11px]"
                    disabled={busy || selectedCount === 0 || !workspaceReady}
                    onClick={() => setDeleteConfirm({ type: "folders" })}
                  >
                    删除选中
                  </Button>
                </div>
              </div>

              <div className="app-subtle-scroll mt-3 min-h-0 flex-1 overflow-y-auto rounded-[22px] border border-border/70 bg-background/35 p-3">
                {!workspaceReady ? (
                  <div className="rounded-2xl border border-dashed border-border/70 px-3 py-16 text-center text-xs text-muted-foreground">
                    请先在设置中选择全局工作区，随后即可导入、编辑和新建技能。
                  </div>
                ) : folders.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-border/70 px-3 py-16 text-center text-xs text-muted-foreground">
                    当前工作区还没有技能目录。
                  </div>
                ) : filteredFolders.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-border/70 px-3 py-16 text-center text-xs text-muted-foreground">
                    没有匹配的技能目录，请尝试其他关键词。
                  </div>
                ) : (
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                    {pagedFolders.map((folderName) => {
                      const checked = selected.has(folderName);
                      return (
                        <button
                          key={folderName}
                          type="button"
                          className="group flex min-h-[162px] flex-col items-start rounded-[18px] border border-border/70 bg-[linear-gradient(180deg,color-mix(in_srgb,var(--card)_86%,transparent),color-mix(in_srgb,var(--background-elevated)_74%,transparent))] p-4 text-left transition-colors hover:border-primary/24 hover:bg-background-interactive/55"
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
                            SKILL
                          </div>
                          <p className="mt-2 line-clamp-4 text-xs leading-5 text-muted-foreground">
                            点击卡片打开编辑弹窗，修改目录名与 SKILL.md 内容。
                          </p>
                          <div className="mt-4 text-[11px] font-medium text-primary opacity-85 transition-opacity group-hover:opacity-100">
                            打开编辑
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="mt-3 flex shrink-0 items-center justify-between gap-3 border-t border-border/60 pt-3">
                <div className="text-xs text-muted-foreground">
                  第 {Math.min(currentPage, totalPages)} / {totalPages} 页
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
                    上一页
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
                    下一页
                    <ChevronRight className="size-3.5" />
                  </Button>
                </div>
              </div>
            </section>
          </div>

          <div className="min-h-5 text-xs text-muted-foreground">{status ?? ""}</div>
        </DialogContent>
      </Dialog>

      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogContent className="max-h-[88vh] max-w-3xl flex flex-col">
          <DialogHeader className="rounded-[24px] border border-border/70 bg-[linear-gradient(180deg,color-mix(in_srgb,var(--card)_98%,transparent),color-mix(in_srgb,var(--background)_94%,transparent))] px-5 py-4">
            <DialogTitle>
              {editorMode === "create" ? "新增技能" : "编辑技能"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3 min-h-0 flex flex-col">
            <Input
              value={editorName}
              onChange={(event) => setEditorName(event.target.value)}
              placeholder="技能目录名（将规范为小写与连字符）"
              className="text-xs font-mono"
              disabled={busy || editorLoading}
            />
            <textarea
              value={editorMarkdown}
              onChange={(event) => setEditorMarkdown(event.target.value)}
              placeholder={editorLoading ? "加载中..." : "SKILL.md 内容"}
              disabled={busy || editorLoading}
              className={cn(textAreaClassName, "min-h-[360px] flex-1")}
            />
          </div>

          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setEditorOpen(false)}
              disabled={busy}
            >
              取消
            </Button>
            <Button
              type="button"
              disabled={busy || editorLoading || !editorName.trim()}
              onClick={() => void handleSaveEditor()}
            >
              保存
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
            <DialogTitle>
              {deleteConfirm?.type === "source"
                ? "确认移除技能来源？"
                : "确认删除技能？"}
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {deleteConfirm?.type === "source"
              ? `将移除技能来源路径“${deleteConfirm.value}”。移除后将不再从该路径加载技能。`
              : `将永久删除所选的 ${selectedCount} 个技能目录及其中的文件，此操作不可恢复。`}
          </p>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setDeleteConfirm(null)}
            >
              取消
            </Button>
            <Button
              type="button"
              variant={
                deleteConfirm?.type === "source" ? "secondary" : "destructive"
              }
              onClick={() => void handleConfirmDelete()}
            >
              {deleteConfirm?.type === "source" ? "移除" : "删除"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}