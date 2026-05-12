import {
  chmodSync,
  cpSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const uvVersion = "0.11.7";
const bunVersion = "1.3.13";
const pythonVersion = "3.12.13";

const TARGETS = {
  darwin: {
    arm64: {
      uvAsset: "uv-aarch64-apple-darwin.tar.gz",
      bunAsset: "bun-darwin-aarch64.zip",
      uvBinaryName: "uv",
      bunBinaryName: "bun",
      pythonBinaryName: "python3",
    },
    x64: {
      uvAsset: "uv-x86_64-apple-darwin.tar.gz",
      bunAsset: "bun-darwin-x64.zip",
      uvBinaryName: "uv",
      bunBinaryName: "bun",
      pythonBinaryName: "python3",
    },
  },
  linux: {
    arm64: {
      uvAsset: "uv-aarch64-unknown-linux-gnu.tar.gz",
      bunAsset: "bun-linux-aarch64.zip",
      uvBinaryName: "uv",
      bunBinaryName: "bun",
      pythonBinaryName: "python3",
    },
    x64: {
      uvAsset: "uv-x86_64-unknown-linux-gnu.tar.gz",
      bunAsset: "bun-linux-x64.zip",
      uvBinaryName: "uv",
      bunBinaryName: "bun",
      pythonBinaryName: "python3",
    },
  },
  win32: {
    arm64: {
      uvAsset: "uv-aarch64-pc-windows-msvc.zip",
      bunAsset: "bun-windows-aarch64.zip",
      uvBinaryName: "uv.exe",
      bunBinaryName: "bun.exe",
      pythonBinaryName: "python.exe",
    },
    x64: {
      uvAsset: "uv-x86_64-pc-windows-msvc.zip",
      bunAsset: "bun-windows-x64.zip",
      uvBinaryName: "uv.exe",
      bunBinaryName: "bun.exe",
      pythonBinaryName: "python.exe",
    },
  },
};

function parseTargetArg(argv) {
  const byEquals = argv.find((arg) => arg.startsWith("--target="));
  if (byEquals) {
    return byEquals.slice("--target=".length);
  }

  const targetFlagIndex = argv.indexOf("--target");
  if (targetFlagIndex >= 0) {
    return argv[targetFlagIndex + 1] ?? "";
  }

  return `${process.platform}-${process.arch}`;
}

function resolveRequestedTarget(argv) {
  const requested = parseTargetArg(argv);
  const [platform, arch] = requested.split("-");

  if (!platform || !arch) {
    throw new Error(`Invalid --target value: ${requested}. Expected format <platform>-<arch>.`);
  }

  return {
    platform,
    arch,
    id: `${platform}-${arch}`,
  };
}

const requestedTarget = resolveRequestedTarget(process.argv.slice(2));
const toolingRoot = join(repoRoot, "resources", "tooling", requestedTarget.id);
const binDir = join(toolingRoot, "bin");

function run(command, args, extraOptions = {}) {
  return execFileSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...extraOptions,
  }).trim();
}

function logStage(message) {
  console.log(`[tooling] ${message}`);
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GiB`;
}

function getTargetConfig() {
  const platformTargets = TARGETS[requestedTarget.platform];
  if (!platformTargets) {
    throw new Error(
      `Unsupported platform for embedded tooling download: ${requestedTarget.platform}`,
    );
  }

  const target = platformTargets[requestedTarget.arch];
  if (!target) {
    throw new Error(
      `Unsupported architecture for embedded tooling download: ${requestedTarget.id}`,
    );
  }

  return target;
}

function normalizeVersion(versionText) {
  return versionText.trim().split(/\s+/)[0];
}

async function downloadFile(url, destinationPath) {
  logStage(`Downloading ${url}`);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
  }

  if (!response.body) {
    throw new Error(`Download response body was empty for ${url}`);
  }

  const totalBytes = Number(response.headers.get("content-length") ?? 0);
  const fileStream = createWriteStream(destinationPath);
  const reader = response.body.getReader();
  let downloadedBytes = 0;
  let lastLoggedPercent = -10;
  let lastLoggedAt = Date.now();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = Buffer.from(value);
    fileStream.write(chunk);
    downloadedBytes += chunk.length;

    if (totalBytes > 0) {
      const percent = Math.floor((downloadedBytes / totalBytes) * 100);
      if (percent >= lastLoggedPercent + 10 || percent === 100) {
        logStage(
          `Download progress: ${percent}% (${formatBytes(downloadedBytes)} / ${formatBytes(totalBytes)})`,
        );
        lastLoggedPercent = percent;
      }
    } else if (Date.now() - lastLoggedAt >= 2000) {
      logStage(`Download progress: ${formatBytes(downloadedBytes)} received`);
      lastLoggedAt = Date.now();
    }
  }

  await new Promise((resolve, reject) => {
    fileStream.on("finish", resolve);
    fileStream.on("error", reject);
    fileStream.end();
  });

  logStage(`Download complete: ${destinationPath}`);
}

function stageExecutable(sourcePath, destinationPath) {
  cpSync(sourcePath, destinationPath, { dereference: true, force: true });
  chmodSync(destinationPath, 0o755);
}

function extractTarGz(archivePath, destinationDir) {
  run("tar", ["-xzf", archivePath, "-C", destinationDir]);
}

function extractZip(archivePath, destinationDir) {
  if (requestedTarget.platform === "win32") {
    // Windows runners often do not have `unzip`; prefer native PowerShell extraction.
    const psScript = `Expand-Archive -LiteralPath '${archivePath.replace(/'/g, "''")}' -DestinationPath '${destinationDir.replace(/'/g, "''")}' -Force`;
    try {
      run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", psScript]);
      return;
    } catch {
      // Continue to fallback commands below.
    }

    try {
      run("pwsh", ["-NoProfile", "-NonInteractive", "-Command", psScript]);
      return;
    } catch {
      // Continue to fallback commands below.
    }

    run("tar", ["-xf", archivePath, "-C", destinationDir]);
    return;
  }

  try {
    run("unzip", ["-q", archivePath, "-d", destinationDir]);
  } catch {
    // Some Linux images may not include unzip; bsdtar/gnu tar can extract zip.
    run("tar", ["-xf", archivePath, "-C", destinationDir]);
  }
}

function findFile(rootDir, predicate) {
  const stack = [rootDir];

  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const entryPath = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(entryPath);
        continue;
      }
      if (predicate(entryPath, entry.name)) {
        return entryPath;
      }
    }
  }

  return null;
}

function isExecutableFile(filePath) {
  try {
    return statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function toManifestPath(filePath) {
  return filePath.split("\\").join("/");
}

function getManagedPythonSubpath(pythonExecutablePath, exactVersion) {
  const normalizedPath = resolve(pythonExecutablePath);
  const parts = normalizedPath.split(/[\\/]+/).filter(Boolean);
  const exactPrefix = `cpython-${exactVersion}-`;
  const exactIndex = parts.findIndex((part) => part.startsWith(exactPrefix));

  if (exactIndex >= 0) {
    return parts.slice(exactIndex).join("/");
  }

  const fallbackIndex = parts.findIndex((part) => /^cpython-/.test(part));
  if (fallbackIndex >= 0) {
    return parts.slice(fallbackIndex).join("/");
  }

  return null;
}

function readExistingManifest() {
  const manifestPath = join(toolingRoot, "manifest.json");
  if (!existsSync(manifestPath)) {
    return null;
  }

  return JSON.parse(readFileSync(manifestPath, "utf8"));
}

function findExistingBundledPythonPath(rootDir, exactVersion, pythonBinaryName) {
  const pythonRoot = join(rootDir, "python-install");
  if (!existsSync(pythonRoot)) {
    return null;
  }

  const exactPrefix = `cpython-${exactVersion}-`;
  const exactDirs = readdirSync(pythonRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(exactPrefix))
    .map((entry) => entry.name);

  for (const dirName of exactDirs) {
    const executablePath = findFile(
      join(pythonRoot, dirName),
      (entryPath, entryName) =>
        entryName === pythonBinaryName && isExecutableFile(entryPath),
    );
    if (executablePath) {
      return executablePath;
    }
  }

  return findFile(
    pythonRoot,
    (entryPath, entryName) =>
      entryName === pythonBinaryName &&
      entryPath.includes(exactPrefix) &&
      isExecutableFile(entryPath),
  );
}

function resolveVersionedExecutable(candidatePaths, expectedVersion, versionArgs, transform) {
  for (const candidatePath of candidatePaths) {
    if (!candidatePath || !existsSync(candidatePath)) {
      continue;
    }

    try {
      const actualVersion = transform(run(candidatePath, versionArgs));
      if (actualVersion === expectedVersion) {
        return candidatePath;
      }
    } catch {
      // Ignore invalid or incompatible cached executables.
    }
  }

  return null;
}

function getReusableExistingTooling(target) {
  const manifest = readExistingManifest();
  if (
    manifest &&
    (manifest.platform !== requestedTarget.platform ||
      manifest.arch !== requestedTarget.arch)
  ) {
    return null;
  }

  const uvPath = resolveVersionedExecutable(
    [
      manifest?.uv?.path ? join(toolingRoot, manifest.uv.path) : null,
      join(toolingRoot, "bin", target.uvBinaryName),
    ],
    uvVersion,
    ["--version"],
    (output) => normalizeVersion(output.replace(/^uv\s+/, "")),
  );
  const bunPath = resolveVersionedExecutable(
    [
      manifest?.bun?.path ? join(toolingRoot, manifest.bun.path) : null,
      join(toolingRoot, "bin", target.bunBinaryName),
    ],
    bunVersion,
    ["--version"],
    (output) => normalizeVersion(output),
  );
  const pythonPathFromManifest =
    manifest?.python?.version === pythonVersion && manifest?.python?.path
      ? join(toolingRoot, manifest.python.path)
      : null;
  const pythonPath =
    (pythonPathFromManifest && existsSync(pythonPathFromManifest)
      ? pythonPathFromManifest
      : null) ??
    findExistingBundledPythonPath(
      toolingRoot,
      pythonVersion,
      target.pythonBinaryName,
    );

  return {
    uvPath,
    bunPath,
    pythonPath,
    pythonRelativePath: pythonPath
      ? toManifestPath(relative(toolingRoot, pythonPath))
      : null,
  };
}

function hasUsableEmbeddedTooling(target) {
  const reusableExistingTooling = getReusableExistingTooling(target);
  return !!(
    reusableExistingTooling?.uvPath &&
    reusableExistingTooling?.bunPath &&
    reusableExistingTooling?.pythonPath &&
    reusableExistingTooling?.pythonRelativePath
  );
}

async function main() {
  const target = getTargetConfig();
  logStage(`Checking embedded tooling cache at ${toolingRoot}`);
  const reusableExistingTooling = getReusableExistingTooling(target);
  if (
    reusableExistingTooling?.uvPath &&
    reusableExistingTooling?.bunPath &&
    reusableExistingTooling?.pythonPath &&
    reusableExistingTooling?.pythonRelativePath
  ) {
    const manifest = {
      platform: requestedTarget.platform,
      arch: requestedTarget.arch,
      uv: {
        version: uvVersion,
        path: `bin/${target.uvBinaryName}`,
      },
      bun: {
        version: bunVersion,
        path: `bin/${target.bunBinaryName}`,
      },
      python: {
        version: pythonVersion,
        path: reusableExistingTooling.pythonRelativePath,
      },
    };
    mkdirSync(toolingRoot, { recursive: true });
    writeFileSync(
      join(toolingRoot, "manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
    logStage(`Reusing embedded tooling at ${toolingRoot}`);
    console.log(JSON.stringify(manifest, null, 2));
    return;
  }

  logStage("Cache miss or version mismatch, preparing embedded tooling");

  const tempRoot = mkdtempSync(join(tmpdir(), "open-jarvis-tooling-"));
  const downloadsDir = join(tempRoot, "downloads");
  const extractDir = join(tempRoot, "extract");
  const uvExtractDir = join(extractDir, "uv");
  const bunExtractDir = join(extractDir, "bun");
  const pythonInstallDir = join(tempRoot, "python-install");
  const stagedBinaryDir = join(tempRoot, "staged-bin");

  mkdirSync(downloadsDir, { recursive: true });
  mkdirSync(uvExtractDir, { recursive: true });
  mkdirSync(bunExtractDir, { recursive: true });
  mkdirSync(pythonInstallDir, { recursive: true });
  mkdirSync(stagedBinaryDir, { recursive: true });

  const uvArchivePath = join(downloadsDir, target.uvAsset);
  const bunArchivePath = join(downloadsDir, target.bunAsset);
  const uvUrl = `https://github.com/astral-sh/uv/releases/download/${uvVersion}/${target.uvAsset}`;
  const bunUrl = `https://github.com/oven-sh/bun/releases/download/bun-v${bunVersion}/${target.bunAsset}`;

  logStage(`Target platform: ${requestedTarget.id}`);
  logStage(`Working directory: ${tempRoot}`);
  let uvSourcePath = reusableExistingTooling?.uvPath ?? null;
  let bunSourcePath = reusableExistingTooling?.bunPath ?? null;

  if (uvSourcePath && bunSourcePath) {
    logStage(`Reusing existing uv and bun binaries from ${toolingRoot}`);
  } else {
    await downloadFile(uvUrl, uvArchivePath);
    await downloadFile(bunUrl, bunArchivePath);

    logStage(`Extracting ${target.uvAsset}`);
    if (target.uvAsset.endsWith(".zip")) {
      extractZip(uvArchivePath, uvExtractDir);
    } else {
      extractTarGz(uvArchivePath, uvExtractDir);
    }
    logStage(`Extracting ${target.bunAsset}`);
    extractZip(bunArchivePath, bunExtractDir);

    uvSourcePath = findFile(
      uvExtractDir,
      (entryPath, entryName) => entryName === target.uvBinaryName && isExecutableFile(entryPath),
    );
    bunSourcePath = findFile(
      bunExtractDir,
      (entryPath, entryName) => entryName === target.bunBinaryName && isExecutableFile(entryPath),
    );
  }

  if (!uvSourcePath) {
    throw new Error(`Unable to locate uv executable after extracting ${target.uvAsset}`);
  }
  if (!bunSourcePath) {
    throw new Error(`Unable to locate bun executable after extracting ${target.bunAsset}`);
  }

  const actualUvVersion = normalizeVersion(
    run(uvSourcePath, ["--version"]).replace(/^uv\s+/, ""),
  );
  const actualBunVersion = normalizeVersion(run(bunSourcePath, ["--version"]));

  if (actualUvVersion !== uvVersion) {
    throw new Error(`uv version mismatch: expected ${uvVersion}, got ${actualUvVersion}`);
  }
  if (actualBunVersion !== bunVersion) {
    throw new Error(`bun version mismatch: expected ${bunVersion}, got ${actualBunVersion}`);
  }

  const pythonInstallEnv = {
    ...process.env,
    UV_NO_PROGRESS: "true",
    UV_PYTHON_INSTALL_DIR: pythonInstallDir,
  };
  let resolvedPythonPath = null;

  if (
    reusableExistingTooling?.pythonPath &&
    reusableExistingTooling.pythonRelativePath
  ) {
    logStage(`Reusing existing managed Python ${pythonVersion} from ${toolingRoot}`);
    cpSync(join(toolingRoot, "python-install"), pythonInstallDir, {
      recursive: true,
      force: true,
    });
    resolvedPythonPath = join(
      tempRoot,
      ...reusableExistingTooling.pythonRelativePath.split("/"),
    );
  } else {
    logStage(`Installing managed Python ${pythonVersion} with uv`);
    run(
      uvSourcePath,
      ["python", "install", "--install-dir", pythonInstallDir, pythonVersion],
      { env: pythonInstallEnv },
    );
    resolvedPythonPath = run(
      uvSourcePath,
      [
        "python",
        "find",
        "--managed-python",
        pythonVersion,
      ],
      { env: pythonInstallEnv },
    ).split(/\r?\n/).find(Boolean);
  }

  if (!resolvedPythonPath || !existsSync(resolvedPythonPath)) {
    throw new Error(
      `Unable to resolve embedded Python executable after installing ${pythonVersion}`,
    );
  }

  const stagedUvBinaryPath = join(stagedBinaryDir, target.uvBinaryName);
  const stagedBunBinaryPath = join(stagedBinaryDir, target.bunBinaryName);
  stageExecutable(uvSourcePath, stagedUvBinaryPath);
  stageExecutable(bunSourcePath, stagedBunBinaryPath);

  rmSync(toolingRoot, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 100,
  });
  mkdirSync(binDir, { recursive: true });

  stageExecutable(stagedUvBinaryPath, join(binDir, target.uvBinaryName));
  stageExecutable(stagedBunBinaryPath, join(binDir, target.bunBinaryName));
  const stagedPythonInstallDir = join(toolingRoot, "python-install");
  cpSync(pythonInstallDir, stagedPythonInstallDir, {
    recursive: true,
    force: true,
  });
  const normalizedPythonInstallDir = resolve(pythonInstallDir);
  const normalizedResolvedPythonPath = resolve(resolvedPythonPath);
  const pythonRelativePath = relative(
    normalizedPythonInstallDir,
    normalizedResolvedPythonPath,
  );
  const managedPythonSubpath = getManagedPythonSubpath(
    normalizedResolvedPythonPath,
    pythonVersion,
  );

  let stagedPythonPath =
    pythonRelativePath && !pythonRelativePath.startsWith("..")
      ? join(stagedPythonInstallDir, pythonRelativePath)
      : null;

  if ((!stagedPythonPath || !existsSync(stagedPythonPath)) && managedPythonSubpath) {
    stagedPythonPath = join(
      stagedPythonInstallDir,
      ...managedPythonSubpath.split("/"),
    );
  }

  if (!stagedPythonPath || !existsSync(stagedPythonPath)) {
    const resolvedPythonBaseName = basename(normalizedResolvedPythonPath);
    stagedPythonPath = findFile(
      stagedPythonInstallDir,
      (entryPath, entryName) =>
        entryName === resolvedPythonBaseName && isExecutableFile(entryPath),
    );
  }

  if (!stagedPythonPath || !existsSync(stagedPythonPath)) {
    throw new Error(
      `Embedded Python executable was not staged correctly: ${stagedPythonPath}`,
    );
  }

  const manifest = {
    platform: requestedTarget.platform,
    arch: requestedTarget.arch,
    uv: {
      version: actualUvVersion,
      path: `bin/${target.uvBinaryName}`,
    },
    bun: {
      version: actualBunVersion,
      path: `bin/${target.bunBinaryName}`,
    },
    python: {
      version: pythonVersion,
      path: toManifestPath(relative(toolingRoot, stagedPythonPath)),
    },
  };

  writeFileSync(join(toolingRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

  rmSync(tempRoot, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 100,
  });

  logStage(`Staged embedded tooling at ${toolingRoot}`);
  console.log(JSON.stringify(manifest, null, 2));
}

await main();