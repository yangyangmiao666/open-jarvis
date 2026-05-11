import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { logInfo, logWarn } from "./logger";

interface EmbeddedToolingManifestEntry {
  version: string;
  path: string;
}

interface EmbeddedToolingManifest {
  platform: string;
  arch: string;
  uv: EmbeddedToolingManifestEntry;
  bun: EmbeddedToolingManifestEntry;
  python: EmbeddedToolingManifestEntry & {
    request: string;
  };
}

export interface EmbeddedToolingRuntime {
  rootDir: string;
  manifest: EmbeddedToolingManifest;
  uvPath: string;
  bunPath: string;
  pythonPath: string;
  binDir: string;
  pythonInstallDir: string;
}

function getPlatformArch(): string {
  return `${process.platform}-${process.arch}`;
}

export function getEmbeddedToolingRootDir(): string | null {
  const platformArch = getPlatformArch();
  const packagedPath = resolve(process.resourcesPath, "tooling", platformArch);
  if (existsSync(packagedPath)) {
    logInfo("Tooling", "Using packaged embedded tooling", {
      platformArch,
      rootDir: packagedPath,
    });
    return packagedPath;
  }

  const devPath = resolve(__dirname, "../../resources/tooling", platformArch);
  if (existsSync(devPath)) {
    logInfo("Tooling", "Using development embedded tooling", {
      platformArch,
      rootDir: devPath,
    });
    return devPath;
  }

  logWarn("Tooling", "Embedded tooling root not found", {
    platformArch,
    packagedPath,
    devPath,
  });
  return null;
}

export function getEmbeddedToolingRuntime(): EmbeddedToolingRuntime | null {
  const rootDir = getEmbeddedToolingRootDir();
  if (!rootDir) {
    logWarn("Tooling", "Embedded tooling runtime unavailable because rootDir is missing");
    return null;
  }

  const manifestPath = join(rootDir, "manifest.json");
  if (!existsSync(manifestPath)) {
    logWarn("Tooling", "Embedded tooling manifest missing", { manifestPath });
    return null;
  }

  const manifest = JSON.parse(
    readFileSync(manifestPath, "utf8"),
  ) as EmbeddedToolingManifest;

  const runtime = {
    rootDir,
    manifest,
    uvPath: join(rootDir, manifest.uv.path),
    bunPath: join(rootDir, manifest.bun.path),
    pythonPath: join(rootDir, manifest.python.path),
    binDir: join(rootDir, "bin"),
    pythonInstallDir: join(rootDir, "python"),
  };

  logInfo("Tooling", "Resolved embedded tooling runtime", runtime);
  return runtime;
}