import Store from "electron-store";
import path from "node:path";
import { homedir } from "node:os";
import { getOpenworkDir } from "./storage";

const store = new Store({
  name: "settings",
  cwd: getOpenworkDir(),
});

const DEFAULT_SOURCE = "~/.open-jarvis/skills";
const DEFAULT_ABSOLUTE_SOURCE = path.join(homedir(), ".open-jarvis", "skills");

export function getSkillSources(): string[] {
  return [DEFAULT_SOURCE];
}

export function setSkillSources(_paths: string[]): void {
  // Keep compatibility for existing IPC calls while forcing global-only skills.
  store.delete("skillSources");
}

/**
 * Resolve skill sources to absolute filesystem paths.
 * Skills are global-only and always resolved to ~/.open-jarvis/skills.
 */
export function resolveSkillSourcesForWorkspace(
  _workspacePath: string,
): string[] {
  return [DEFAULT_ABSOLUTE_SOURCE];
}
