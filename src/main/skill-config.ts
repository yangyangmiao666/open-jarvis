import Store from "electron-store"
import path from "node:path"
import { getOpenworkDir } from "./storage"

const store = new Store({
  name: "settings",
  cwd: getOpenworkDir()
})

const KEY = "skillSources"

/** POSIX-style paths stored relative to workspace root, e.g. `/.deepagents/skills`. */
export function getSkillSources(): string[] {
  const v = store.get(KEY, ["/.deepagents/skills"]) as string[]
  return Array.isArray(v) && v.length > 0 ? v : ["/.deepagents/skills"]
}

export function setSkillSources(paths: string[]): void {
  const cleaned = paths.map((p) => (p.startsWith("/") ? p : `/${p}`)).filter(Boolean)
  store.set(KEY, cleaned.length > 0 ? cleaned : ["/.deepagents/skills"])
}

/**
 * Resolve configured skill sources to absolute filesystem paths under the current workspace.
 *
 * Stored values remain POSIX-style workspace-relative paths for UI/config compatibility.
 * The agent runtime, however, uses absolute filesystem paths (virtualMode=false), so we
 * translate those stored values here before passing them into deepagents.
 */
export function resolveSkillSourcesForWorkspace(workspacePath: string): string[] {
  return getSkillSources().map((source) => {
    const normalized = source.trim()
    if (!normalized) return path.join(workspacePath, ".deepagents", "skills")

    const workspaceRelative = normalized.replace(/^\/+/, "")
    return path.join(workspacePath, workspaceRelative)
  })
}
