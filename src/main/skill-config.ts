import Store from "electron-store";
import path from "node:path";
import { homedir } from "node:os";
import { getOpenworkDir } from "./storage";

const store = new Store({
  name: "settings",
  cwd: getOpenworkDir(),
});

const KEY = "skillSources";
const DEFAULT_SOURCE = "~/.deepagents/skills";

function normalizeSkillSourcePath(source: string): string {
  const trimmed = source.trim();
  if (!trimmed) return "";

  // Legacy value from older versions; should point to user home skill dir.
  if (trimmed === "/.deepagents/skills") {
    return DEFAULT_SOURCE;
  }

  return trimmed;
}

/** POSIX-style paths stored relative to workspace root, e.g. `/.deepagents/skills`. */
export function getSkillSources(): string[] {
  const v = store.get(KEY, [DEFAULT_SOURCE]) as string[];
  const normalized = (Array.isArray(v) ? v : [DEFAULT_SOURCE])
    .map((source) => normalizeSkillSourcePath(source))
    .filter(Boolean);

  const finalSources = normalized.length > 0 ? normalized : [DEFAULT_SOURCE];

  // Persist migrated values so old configs are upgraded once.
  if (JSON.stringify(finalSources) !== JSON.stringify(v)) {
    store.set(KEY, finalSources);
  }

  return finalSources;
}

export function setSkillSources(paths: string[]): void {
  const cleaned = paths
    .map((p) => normalizeSkillSourcePath(p))
    .filter(Boolean);
  store.set(KEY, cleaned.length > 0 ? cleaned : [DEFAULT_SOURCE]);
}

/**
 * Resolve configured skill sources to absolute filesystem paths under the current workspace.
 *
 * Stored values remain POSIX-style workspace-relative paths for UI/config compatibility.
 * The agent runtime, however, uses absolute filesystem paths (virtualMode=false), so we
 * translate those stored values here before passing them into deepagents.
 */
export function resolveSkillSourcesForWorkspace(
  workspacePath: string,
): string[] {
  return getSkillSources().map((source) => {
    const normalized = source.trim();
    if (!normalized) return path.join(homedir(), ".deepagents", "skills");

    if (normalized.startsWith("~/")) {
      return path.join(homedir(), normalized.slice(2));
    }

    if (path.isAbsolute(normalized)) {
      return normalized;
    }

    const workspaceRelative = normalized.replace(/^\/+/, "");
    return path.join(workspacePath, workspaceRelative);
  });
}
