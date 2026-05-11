import { existsSync, readFileSync, readdirSync } from "node:fs";
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
  
  // Log directory structure for diagnostics
  const toolingParent = resolve(process.resourcesPath, "tooling");
  let toolingParentContents: string[] = [];
  try {
    if (existsSync(toolingParent)) {
      toolingParentContents = readdirSync(toolingParent);
    }
  } catch (error) {
    logWarn("Tooling", "Failed to read tooling parent directory", {
      toolingParent,
      error: String(error),
    });
  }
  
  logInfo("Tooling", "Looking for embedded tooling", {
    platformArch,
    resourcesPath: process.resourcesPath,
    packagedPath,
    packagedExists: existsSync(packagedPath),
    toolingParentExists: existsSync(toolingParent),
    toolingParentContents,
  });
  
  if (existsSync(packagedPath)) {
    logInfo("Tooling", "Using packaged embedded tooling", {
      platformArch,
      rootDir: packagedPath,
    });
    return packagedPath;
  }

  const devPath = resolve(__dirname, "../../resources/tooling", platformArch);
  const devToolingParent = resolve(__dirname, "../../resources/tooling");
  let devToolingParentContents: string[] = [];
  try {
    if (existsSync(devToolingParent)) {
      devToolingParentContents = readdirSync(devToolingParent);
    }
  } catch (error) {
    logWarn("Tooling", "Failed to read dev tooling parent directory", {
      devToolingParent,
      error: String(error),
    });
  }
  
  logInfo("Tooling", "Packaged tooling not found, trying dev path", {
    devPath,
    devExists: existsSync(devPath),
    devToolingParentExists: existsSync(devToolingParent),
    devToolingParentContents,
  });
  
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

  try {
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

    // Verify all critical paths exist
    const uvExists = existsSync(runtime.uvPath);
    const bunExists = existsSync(runtime.bunPath);
    const pythonExists = existsSync(runtime.pythonPath);

    logInfo("Tooling", "Resolved embedded tooling runtime", {
      ...runtime,
      uvExists,
      bunExists,
      pythonExists,
    });

    return runtime;
  } catch (error) {
    logWarn("Tooling", "Failed to parse embedded tooling manifest", {
      manifestPath,
      error: String(error),
    });
    return null;
  }
}