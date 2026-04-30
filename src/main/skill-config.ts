import Store from "electron-store";
import path from "node:path";
import { homedir } from "node:os";
import { getOpenworkDir } from "./storage";

const store = new Store({
  name: "settings",
  cwd: getOpenworkDir(),
});

const KEY = "skillSources";
const DEFAULT_SOURCE = "~/.open-jarvis/skills";
const LEGACY_DEFAULT_SOURCE = "~/.deepagents/skills";
const LEGACY_ABSOLUTE_SOURCE = path.join(homedir(), ".deepagents", "skills");
const DEFAULT_ABSOLUTE_SOURCE = path.join(getOpenworkDir(), "skills");

function normalizeSkillSourcePath(source: string): string {
  const trimmed = source.trim();
  if (!trimmed) return "";

  // Legacy values from older versions; should point to the Open-Jarvis home skill dir.
  if (
    trimmed === "/.deepagents/skills" ||
    trimmed === LEGACY_DEFAULT_SOURCE ||
    trimmed === LEGACY_ABSOLUTE_SOURCE
  ) {
    return DEFAULT_SOURCE;
  }

  if (trimmed === "/.open-jarvis/skills" || trimmed === DEFAULT_ABSOLUTE_SOURCE) {
    return DEFAULT_SOURCE;
  }

  return trimmed;
}

/** Sources may be user-home paths like `~/.open-jarvis/skills` or workspace-relative paths like `/.deepagents/skills`. */
export function getSkillSources(): string[] {
  const hasStoredSources = store.has(KEY);
  const storedValue = store.get(
    KEY,
    hasStoredSources ? [] : [DEFAULT_SOURCE],
  ) as string[];
  const normalized = (Array.isArray(storedValue) ? storedValue : [DEFAULT_SOURCE])
    .map((source) => normalizeSkillSourcePath(source))
    .filter(Boolean);

  const finalSources =
    normalized.length > 0 || hasStoredSources ? normalized : [DEFAULT_SOURCE];

  // Persist migrated values so old configs are upgraded once.
  if (JSON.stringify(finalSources) !== JSON.stringify(storedValue)) {
    store.set(KEY, finalSources);
  }

  return finalSources;
}

export function setSkillSources(paths: string[]): void {
  const cleaned = paths
    .map((p) => normalizeSkillSourcePath(p))
    .filter(Boolean);
  store.set(KEY, cleaned);
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
    if (!normalized) return DEFAULT_ABSOLUTE_SOURCE;

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
