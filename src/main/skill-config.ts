import Store from "electron-store"
import { getOpenworkDir } from "./storage"

const store = new Store({
  name: "settings",
  cwd: getOpenworkDir()
})

const KEY = "skillSources"

/** POSIX paths relative to workspace root (FilesystemBackend), e.g. `/.deepagents/skills` */
export function getSkillSources(): string[] {
  const v = store.get(KEY, ["/.deepagents/skills"]) as string[]
  return Array.isArray(v) && v.length > 0 ? v : ["/.deepagents/skills"]
}

export function setSkillSources(paths: string[]): void {
  const cleaned = paths.map((p) => (p.startsWith("/") ? p : `/${p}`)).filter(Boolean)
  store.set(KEY, cleaned.length > 0 ? cleaned : ["/.deepagents/skills"])
}
