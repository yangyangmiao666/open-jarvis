import * as fs from "node:fs/promises";
import path from "node:path";

export const MEMORY_ROUTE_PREFIX = "/memories/";

export function getWorkspaceMemoryDir(workspacePath: string): string {
  return path.join(workspacePath, ".open-jarvis", "memories");
}

export function getAgentMemorySources(): string[] {
  return [];
}

async function collectMarkdownFiles(rootDir: string): Promise<string[]> {
  const files: string[] = [];
  const entries = await fs.readdir(rootDir, { recursive: true, withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) {
      continue;
    }

    const relativeParent = typeof entry.parentPath === "string"
      ? path.relative(rootDir, entry.parentPath)
      : "";
    files.push(path.join(rootDir, relativeParent, entry.name));
  }

  return files;
}

async function migrateLegacyMemoryLayout(memoryDir: string): Promise<void> {
  const legacyAgentsPath = path.join(memoryDir, "AGENTS.md");
  await fs.rm(legacyAgentsPath, { force: true });

  const legacyTopicsDir = path.join(memoryDir, "topics");
  try {
    await fs.access(legacyTopicsDir);
  } catch {
    return;
  }

  const legacyFiles = await collectMarkdownFiles(legacyTopicsDir);
  for (const legacyFile of legacyFiles) {
    const targetPath = path.join(memoryDir, path.basename(legacyFile));
    try {
      await fs.access(targetPath);
    } catch {
      await fs.rename(legacyFile, targetPath);
    }
  }

  await fs.rm(legacyTopicsDir, { recursive: true, force: true });
}

export async function ensureWorkspaceMemoryBootstrapFiles(
  workspacePath: string,
): Promise<string> {
  const memoryDir = getWorkspaceMemoryDir(workspacePath);
  await fs.mkdir(memoryDir, { recursive: true });
  await migrateLegacyMemoryLayout(memoryDir);

  return memoryDir;
}