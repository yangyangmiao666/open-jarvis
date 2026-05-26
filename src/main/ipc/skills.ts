import { IpcMain, dialog } from "electron";
import * as fs from "fs/promises";
import * as path from "path";
import { getSkillSources, setSkillSources } from "../skill-config";
import {
  createMemoryPromotionCandidate,
  markMemoryPromotionStatus,
} from "../services/memory-service";
import { getOpenworkDir } from "../storage";
import { decodeTextBuffer } from "../text-encoding";
import type { MemoryPromotionCandidate } from "../types";

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

function getGlobalSkillsRoot(): string {
  return path.join(getOpenworkDir(), "skills");
}

function resolveSkillsRoot(threadId?: string): string | null {
  void threadId;
  return getGlobalSkillsRoot();
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
        return { success: false as const, error: "No workspace", folders: [] };
      try {
        await fs.mkdir(root, { recursive: true });
        const names = await fs.readdir(root, { withFileTypes: true });
        const folders = names.filter((d) => d.isDirectory()).map((d) => d.name);
        return { success: true as const, folders };
      } catch (e) {
        return {
          success: false as const,
          error: e instanceof Error ? e.message : "list failed",
          folders: [] as string[],
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
      const safe = slugifySkillName(candidate.skillName);
      if (!safe) {
        return { success: false as const, error: "Invalid skill name" };
      }

      try {
        const root = getGlobalSkillsRoot();
        const dir = path.join(root, safe);
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(
          path.join(dir, "SKILL.md"),
          candidate.skillMarkdown,
          "utf-8",
        );
        await markMemoryPromotionStatus(
          candidate.workspacePath,
          candidate.memoryPath,
          "promoted",
        );
        return { success: true as const, folder: safe };
      } catch (e) {
        return {
          success: false as const,
          error: e instanceof Error ? e.message : "promotion failed",
        };
      }
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

      const safe = slugifySkillName(candidate.skillName);
      if (!safe) {
        return { success: false as const, error: "Invalid skill name" };
      }

      try {
        const root = getGlobalSkillsRoot();
        const dir = path.join(root, safe);
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(
          path.join(dir, "SKILL.md"),
          candidate.skillMarkdown,
          "utf-8",
        );
        await markMemoryPromotionStatus(
          candidate.workspacePath,
          candidate.memoryPath,
          "promoted",
        );
        return { success: true as const, folder: safe };
      } catch (e) {
        return {
          success: false as const,
          error: e instanceof Error ? e.message : "settle failed",
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
