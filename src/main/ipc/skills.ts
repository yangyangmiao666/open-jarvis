import { IpcMain, dialog } from "electron"
import * as fs from "fs/promises"
import * as path from "path"
import { getThread } from "../db"
import { getSkillSources, setSkillSources } from "../skill-config"
import { decodeTextBuffer } from "../text-encoding"

function validateSkillFolderSegment(name: string): boolean {
  return Boolean(name) && !name.includes("..") && !name.includes("/") && !name.includes("\\")
}

function slugifySkillName(raw: string): string | null {
  const safe = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return safe || null
}

function getWorkspacePath(threadId: string): string | null {
  const thread = getThread(threadId)
  if (!thread?.metadata) return null
  const meta = JSON.parse(thread.metadata) as { workspacePath?: string }
  return meta.workspacePath ?? null
}

export function registerSkillHandlers(ipcMain: IpcMain): void {
  ipcMain.handle("skills:listSources", async () => getSkillSources())

  ipcMain.handle("skills:setSources", async (_e, paths: string[]) => {
    setSkillSources(paths)
  })

  ipcMain.handle("skills:listWorkspaceSkillFolders", async (_e, threadId: string) => {
    const ws = getWorkspacePath(threadId)
    if (!ws) return { success: false as const, error: "No workspace", folders: [] }
    const root = path.join(ws, ".deepagents", "skills")
    try {
      await fs.mkdir(root, { recursive: true })
      const names = await fs.readdir(root, { withFileTypes: true })
      const folders = names.filter((d) => d.isDirectory()).map((d) => d.name)
      return { success: true as const, folders }
    } catch (e) {
      return {
        success: false as const,
        error: e instanceof Error ? e.message : "list failed",
        folders: [] as string[]
      }
    }
  })

  ipcMain.handle(
    "skills:importFolder",
    async (_e, { threadId }: { threadId: string }) => {
      const ws = getWorkspacePath(threadId)
      if (!ws) return { success: false, error: "No workspace" }
      const result = await dialog.showOpenDialog({
        properties: ["openDirectory"],
        title: "Import skill folder"
      })
      if (result.canceled || !result.filePaths[0]) {
        return { success: false, error: "cancelled" }
      }
      const src = result.filePaths[0]
      const base = path.basename(src)
      const destRoot = path.join(ws, ".deepagents", "skills")
      await fs.mkdir(destRoot, { recursive: true })
      const dest = path.join(destRoot, base)
      await fs.cp(src, dest, { recursive: true })
      return { success: true, importedName: base }
    }
  )

  ipcMain.handle(
    "skills:createSkill",
    async (
      _e,
      { threadId, name, markdown }: { threadId: string; name: string; markdown?: string }
    ) => {
      const ws = getWorkspacePath(threadId)
      if (!ws) return { success: false, error: "No workspace" }
      const safe = slugifySkillName(name)
      if (!safe) return { success: false, error: "Invalid name" }
      const dir = path.join(ws, ".deepagents", "skills", safe)
      await fs.mkdir(dir, { recursive: true })
      const skillMd = path.join(dir, "SKILL.md")
      const body =
        markdown !== undefined && markdown !== ""
          ? markdown
          : `---
name: ${safe}
description: Custom skill — edit this file to describe what the agent should do.
---

# ${safe}

Add instructions for the agent here.
`
      await fs.writeFile(skillMd, body, "utf-8")
      return { success: true, folder: safe }
    }
  )

  ipcMain.handle(
    "skills:readSkillMarkdown",
    async (_e, { threadId, folderName }: { threadId: string; folderName: string }) => {
      const ws = getWorkspacePath(threadId)
      if (!ws) return { success: false as const, error: "No workspace" }
      if (!validateSkillFolderSegment(folderName)) {
        return { success: false as const, error: "Invalid folder" }
      }
      const skillMd = path.join(ws, ".deepagents", "skills", folderName, "SKILL.md")
      try {
        const buf = await fs.readFile(skillMd)
        const content = decodeTextBuffer(buf)
        return { success: true as const, content }
      } catch (e) {
        return {
          success: false as const,
          error: e instanceof Error ? e.message : "read failed"
        }
      }
    }
  )

  ipcMain.handle(
    "skills:writeSkillMarkdown",
    async (
      _e,
      { threadId, folderName, content }: { threadId: string; folderName: string; content: string }
    ) => {
      const ws = getWorkspacePath(threadId)
      if (!ws) return { success: false as const, error: "No workspace" }
      if (!validateSkillFolderSegment(folderName)) {
        return { success: false as const, error: "Invalid folder" }
      }
      const skillMd = path.join(ws, ".deepagents", "skills", folderName, "SKILL.md")
      try {
        await fs.writeFile(skillMd, content, "utf-8")
        return { success: true as const }
      } catch (e) {
        return {
          success: false as const,
          error: e instanceof Error ? e.message : "write failed"
        }
      }
    }
  )

  ipcMain.handle(
    "skills:renameSkillFolder",
    async (
      _e,
      { threadId, oldName, newName }: { threadId: string; oldName: string; newName: string }
    ) => {
      const ws = getWorkspacePath(threadId)
      if (!ws) return { success: false as const, error: "No workspace" }
      if (!validateSkillFolderSegment(oldName)) {
        return { success: false as const, error: "Invalid old folder" }
      }
      const newSafe = slugifySkillName(newName)
      if (!newSafe) return { success: false as const, error: "Invalid new name" }
      if (oldName === newSafe) return { success: true as const, folder: oldName }
      const oldDir = path.join(ws, ".deepagents", "skills", oldName)
      const newDir = path.join(ws, ".deepagents", "skills", newSafe)
      try {
        await fs.access(oldDir)
      } catch {
        return { success: false as const, error: "Source folder not found" }
      }
      try {
        await fs.access(newDir)
        return { success: false as const, error: "Target folder already exists" }
      } catch {
        /* target free */
      }
      try {
        await fs.rename(oldDir, newDir)
        return { success: true as const, folder: newSafe }
      } catch (e) {
        return {
          success: false as const,
          error: e instanceof Error ? e.message : "rename failed"
        }
      }
    }
  )

  ipcMain.handle(
    "skills:deleteSkillFolders",
    async (_e, { threadId, folderNames }: { threadId: string; folderNames: string[] }) => {
      const ws = getWorkspacePath(threadId)
      if (!ws) return { success: false, error: "No workspace" }
      for (const name of folderNames) {
        if (!name || name.includes("..") || name.includes("/") || name.includes("\\")) continue
        const dir = path.join(ws, ".deepagents", "skills", name)
        await fs.rm(dir, { recursive: true, force: true })
      }
      return { success: true }
    }
  )
}
