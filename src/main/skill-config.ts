import { app } from "electron";
import Store from "electron-store";
import fs from "node:fs/promises";
import path from "node:path";
import { homedir } from "node:os";
import { getOpenworkDir } from "./storage";

const store = new Store({
  name: "settings",
  cwd: getOpenworkDir(),
});

const DEFAULT_SOURCE = "~/.open-jarvis/skills";
const DEFAULT_ABSOLUTE_SOURCE = path.join(homedir(), ".open-jarvis", "skills");

function getBundledSkillsRoot(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, "default-skills")
    : path.resolve(__dirname, "../../skills");
}

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

export function getGlobalSkillsRoot(): string {
  return DEFAULT_ABSOLUTE_SOURCE;
}

export async function syncBundledSkillsToGlobalRoot(): Promise<void> {
  const bundledRoot = getBundledSkillsRoot();
  const globalRoot = DEFAULT_ABSOLUTE_SOURCE;

  try {
    const bundledEntries = await fs.readdir(bundledRoot, { withFileTypes: true });
    await fs.mkdir(globalRoot, { recursive: true });

    await Promise.all(
      bundledEntries
        .filter((entry) => entry.isDirectory())
        .map(async (entry) => {
          const sourceDir = path.join(bundledRoot, entry.name);
          const targetDir = path.join(globalRoot, entry.name);
          try {
            await fs.access(targetDir);
          } catch {
            await fs.cp(sourceDir, targetDir, {
              recursive: true,
              force: true,
            });
          }
        }),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return;
    }
    throw error;
  }
}
