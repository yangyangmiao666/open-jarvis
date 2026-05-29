import { IpcMain, dialog } from "electron";
import * as fs from "fs/promises";
import * as path from "path";
import { getGlobalSkillsRoot, getSkillSources, setSkillSources } from "../skill-config";
import {
  createMemoryPromotionCandidate,
  getMemoryPromotionSkillFolder,
  markMemoryPromotionStatus,
} from "../services/memory-service";
import { decodeTextBuffer } from "../text-encoding";
import type { MemoryPromotionCandidate, SkillSummary } from "../types";

function validateSkillFolderSegment(name: string): boolean {
  return (
    Boolean(name) &&
    !name.includes("..") &&
    !name.includes("/") &&
    !name.includes("\\")
  );
}

function slugifySkillName(raw: string): string | null {
  const safe = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return safe || null;
}

function resolveSkillsRoot(threadId?: string): string | null {
  void threadId;
  return getGlobalSkillsRoot();
}

async function promoteMemoryCandidate(
  candidate: MemoryPromotionCandidate,
): Promise<{ success: true; folder: string } | { success: false; error: string }> {
  const safe = slugifySkillName(candidate.skillName);
  if (!safe) {
    return { success: false, error: "Invalid skill name" };
  }

  try {
    const root = getGlobalSkillsRoot();
    const dir = path.join(root, safe);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "SKILL.md"), candidate.skillMarkdown, "utf-8");
    await markMemoryPromotionStatus(
      candidate.workspacePath,
      candidate.memoryPath,
      "promoted",
      safe,
    );
    return { success: true, folder: safe };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : "promotion failed",
    };
  }
}

async function getSkillUpdatedAt(root: string, folderName: string): Promise<string> {
  const skillMarkdownPath = path.join(root, folderName, "SKILL.md");
  const stat = await fs.stat(skillMarkdownPath).catch(async () =>
    fs.stat(path.join(root, folderName)),
  );
  return stat.mtime.toISOString();
}

function parseSkillDescription(markdown: string): string {
  const frontmatterMatch = markdown.match(/^---\s*\n([\s\S]*?)\n---\s*/);
  const frontmatter = frontmatterMatch?.[1] ?? "";
  const descriptionMatch = frontmatter.match(/^description:\s*(.+)$/m);
  const frontmatterDescription = descriptionMatch?.[1]?.trim();
  if (frontmatterDescription) {
    return frontmatterDescription.replace(/^['"]|['"]$/g, "");
  }

  const withoutFrontmatter = frontmatterMatch
    ? markdown.slice(frontmatterMatch[0].length)
    : markdown;
  const lines = withoutFrontmatter
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith("#"));

  return lines[0] ?? "No description";
}

async function getSkillDescription(root: string, folderName: string): Promise<string> {
  const skillMarkdownPath = path.join(root, folderName, "SKILL.md");
  try {
    const buf = await fs.readFile(skillMarkdownPath);
    return parseSkillDescription(decodeTextBuffer(buf));
  } catch {
    return "No description";
  }
}

export function registerSkillHandlers(ipcMain: IpcMain): void {
  ipcMain.handle("skills:listSources", async () => getSkillSources());

  ipcMain.handle("skills:setSources", async (_e, paths: string[]) => {
    setSkillSources(paths);
  });

  ipcMain.handle(
    "skills:listWorkspaceSkillFolders",
    async (_e, threadId?: string) => {
      const root = resolveSkillsRoot(threadId);
      if (!root)
        return {
          success: false as const,
          error: "No workspace",
          folders: [] as SkillSummary[],
        };
      try {
        await fs.mkdir(root, { recursive: true });
        const names = await fs.readdir(root, { withFileTypes: true });
        const folders = await Promise.all(
          names
            .filter((d) => d.isDirectory())
            .map(async (d) => {
              const [updatedAt, description] = await Promise.all([
                getSkillUpdatedAt(root, d.name),
                getSkillDescription(root, d.name),
              ]);
              return {
                folderName: d.name,
                updatedAt,
                description,
              };
            }),
        );
        folders.sort((left, right) =>
          right.updatedAt.localeCompare(left.updatedAt),
        );
        return { success: true as const, folders };
      } catch (e) {
        return {
          success: false as const,
          error: e instanceof Error ? e.message : "list failed",
          folders: [] as SkillSummary[],
        };
      }
    },
  );

  ipcMain.handle(
    "skills:importFolder",
    async (_e, { threadId }: { threadId?: string }) => {
      const destRoot = resolveSkillsRoot(threadId);
      if (!destRoot) return { success: false, error: "No workspace" };
      const result = await dialog.showOpenDialog({
        properties: ["openDirectory", "multiSelections"],
        title: "Import skill folders",
      });
      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, error: "cancelled" };
      }
      await fs.mkdir(destRoot, { recursive: true });
      const importedNames: string[] = [];

      for (const src of result.filePaths) {
        const base = path.basename(src);
        const dest = path.join(destRoot, base);
        await fs.cp(src, dest, { recursive: true, force: true });
        importedNames.push(base);
      }

      return { success: true, importedName: importedNames[0], importedNames };
    },
  );

  ipcMain.handle(
    "skills:createSkill",
    async (
      _e,
      {
        threadId,
        name,
        markdown,
      }: { threadId?: string; name: string; markdown?: string },
    ) => {
      const root = resolveSkillsRoot(threadId);
      if (!root) return { success: false, error: "No workspace" };
      const safe = slugifySkillName(name);
      if (!safe) return { success: false, error: "Invalid name" };
      const dir = path.join(root, safe);
      await fs.mkdir(dir, { recursive: true });
      const skillMd = path.join(dir, "SKILL.md");
      const body =
        markdown !== undefined && markdown !== ""
          ? markdown
          : `---
name: ${safe}
description: Custom skill — edit this file to describe what the agent should do.
---

# ${safe}

Add instructions for the agent here.
`;
      await fs.writeFile(skillMd, body, "utf-8");
      return { success: true, folder: safe };
    },
  );

  ipcMain.handle(
    "skills:readSkillMarkdown",
    async (
      _e,
      { threadId, folderName }: { threadId?: string; folderName: string },
    ) => {
      const root = resolveSkillsRoot(threadId);
      if (!root) return { success: false as const, error: "No workspace" };
      if (!validateSkillFolderSegment(folderName)) {
        return { success: false as const, error: "Invalid folder" };
      }
      const skillMd = path.join(root, folderName, "SKILL.md");
      try {
        const buf = await fs.readFile(skillMd);
        const content = decodeTextBuffer(buf);
        return { success: true as const, content };
      } catch (e) {
        return {
          success: false as const,
          error: e instanceof Error ? e.message : "read failed",
        };
      }
    },
  );

  ipcMain.handle(
    "skills:writeSkillMarkdown",
    async (
      _e,
      {
        threadId,
        folderName,
        content,
      }: { threadId?: string; folderName: string; content: string },
    ) => {
      const root = resolveSkillsRoot(threadId);
      if (!root) return { success: false as const, error: "No workspace" };
      if (!validateSkillFolderSegment(folderName)) {
        return { success: false as const, error: "Invalid folder" };
      }
      const skillMd = path.join(root, folderName, "SKILL.md");
      try {
        await fs.writeFile(skillMd, content, "utf-8");
        return { success: true as const };
      } catch (e) {
        return {
          success: false as const,
          error: e instanceof Error ? e.message : "write failed",
        };
      }
    },
  );

  ipcMain.handle(
    "skills:renameSkillFolder",
    async (
      _e,
      {
        threadId,
        oldName,
        newName,
      }: { threadId?: string; oldName: string; newName: string },
    ) => {
      const root = resolveSkillsRoot(threadId);
      if (!root) return { success: false as const, error: "No workspace" };
      if (!validateSkillFolderSegment(oldName)) {
        return { success: false as const, error: "Invalid old folder" };
      }
      const newSafe = slugifySkillName(newName);
      if (!newSafe)
        return { success: false as const, error: "Invalid new name" };
      if (oldName === newSafe)
        return { success: true as const, folder: oldName };
      const oldDir = path.join(root, oldName);
      const newDir = path.join(root, newSafe);
      try {
        await fs.access(oldDir);
      } catch {
        return { success: false as const, error: "Source folder not found" };
      }
      try {
        await fs.access(newDir);
        return {
          success: false as const,
          error: "Target folder already exists",
        };
      } catch {
        /* target free */
      }
      try {
        await fs.rename(oldDir, newDir);
        return { success: true as const, folder: newSafe };
      } catch (e) {
        return {
          success: false as const,
          error: e instanceof Error ? e.message : "rename failed",
        };
      }
    },
  );

  ipcMain.handle(
    "skills:deleteSkillFolders",
    async (
      _e,
      { threadId, folderNames }: { threadId?: string; folderNames: string[] },
    ) => {
      const root = resolveSkillsRoot(threadId);
      if (!root) return { success: false, error: "No workspace" };
      for (const name of folderNames) {
        if (
          !name ||
          name.includes("..") ||
          name.includes("/") ||
          name.includes("\\")
        )
          continue;
        const dir = path.join(root, name);
        await fs.rm(dir, { recursive: true, force: true });
      }
      return { success: true };
    },
  );

  ipcMain.handle(
    "skills:confirmPromotion",
    async (_e, candidate: MemoryPromotionCandidate) => {
      return promoteMemoryCandidate(candidate);
    },
  );

  ipcMain.handle(
    "skills:settleMemoryAsSkill",
    async (_e, payload: { workspacePath: string; routePath: string }) => {
      const candidate = await createMemoryPromotionCandidate(
        payload.workspacePath,
        payload.routePath,
      );
      if (!candidate) {
        return { success: false as const, error: "Memory not found" };
      }

      const result = await promoteMemoryCandidate(candidate);
      if (!result.success) {
        return {
          success: false as const,
          error: result.error || "settle failed",
        };
      }

      return result;
    },
  );

  ipcMain.handle(
    "skills:undoMemorySettlement",
    async (_e, payload: { workspacePath: string; routePath: string }) => {
      const candidate = await createMemoryPromotionCandidate(
        payload.workspacePath,
        payload.routePath,
      );
      if (!candidate) {
        return { success: false as const, error: "Memory not found" };
      }

      const folderName = await getMemoryPromotionSkillFolder(
        payload.workspacePath,
        payload.routePath,
      );
      if (!folderName || !validateSkillFolderSegment(folderName)) {
        return { success: false as const, error: "Skill folder not found" };
      }

      try {
        const root = getGlobalSkillsRoot();
        await fs.rm(path.join(root, folderName), {
          recursive: true,
          force: true,
        });
        await markMemoryPromotionStatus(
          candidate.workspacePath,
          candidate.memoryPath,
          "none",
          null,
        );
        return { success: true as const, folder: folderName };
      } catch (e) {
        return {
          success: false as const,
          error: e instanceof Error ? e.message : "undo failed",
        };
      }
    },
  );

  ipcMain.handle(
    "skills:rejectPromotion",
    async (_e, candidate: MemoryPromotionCandidate) => {
      try {
        await markMemoryPromotionStatus(
          candidate.workspacePath,
          candidate.memoryPath,
          "rejected",
        );
        return { success: true as const };
      } catch (e) {
        return {
          success: false as const,
          error: e instanceof Error ? e.message : "reject failed",
        };
      }
    },
  );
}
