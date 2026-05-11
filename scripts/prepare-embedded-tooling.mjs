import {
  chmodSync,
  cpSync,
  createWriteStream,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readlinkSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
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
    },
    x64: {
      uvAsset: "uv-x86_64-apple-darwin.tar.gz",
      bunAsset: "bun-darwin-x64.zip",
      uvBinaryName: "uv",
      bunBinaryName: "bun",
    },
  },
  linux: {
    arm64: {
      uvAsset: "uv-aarch64-unknown-linux-gnu.tar.gz",
      bunAsset: "bun-linux-aarch64.zip",
      uvBinaryName: "uv",
      bunBinaryName: "bun",
    },
    x64: {
      uvAsset: "uv-x86_64-unknown-linux-gnu.tar.gz",
      bunAsset: "bun-linux-x64.zip",
      uvBinaryName: "uv",
      bunBinaryName: "bun",
    },
  },
  win32: {
    arm64: {
      uvAsset: "uv-aarch64-pc-windows-msvc.zip",
      bunAsset: "bun-windows-aarch64.zip",
      uvBinaryName: "uv.exe",
      bunBinaryName: "bun.exe",
    },
    x64: {
      uvAsset: "uv-x86_64-pc-windows-msvc.zip",
      bunAsset: "bun-windows-x64.zip",
      uvBinaryName: "uv.exe",
      bunBinaryName: "bun.exe",
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
const pythonDir = join(toolingRoot, "python");

function run(command, args) {
  return execFileSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function runWithEnv(command, args, env) {
  return execFileSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      ...env,
    },
  }).trim();
}

function runWithEnvLogged(command, args, env) {
  execFileSync(command, args, {
    cwd: repoRoot,
    stdio: "inherit",
    env: {
      ...process.env,
      ...env,
    },
  });
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

function stageDirectory(sourcePath, destinationPath) {
  cpSync(sourcePath, destinationPath, {
    recursive: true,
    dereference: true,
    force: true,
    preserveTimestamps: true,
  });
}

function rewriteSymlinksToStagedPaths(sourceRootDir, stagedRootDir, currentDir = stagedRootDir) {
  const sourceRootRealPath = realpathSync(sourceRootDir);

  for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
    const entryPath = join(currentDir, entry.name);
    const entryStats = lstatSync(entryPath);

    if (entryStats.isSymbolicLink()) {
      const resolvedSourceTarget = realpathSync(entryPath);
      const sourceRelativeTarget = relative(sourceRootRealPath, resolvedSourceTarget);

      if (sourceRelativeTarget.startsWith("..")) {
        throw new Error(
          `Embedded Python symlink points outside install root: ${entryPath} -> ${readlinkSync(entryPath)}`,
        );
      }

      const stagedTargetPath = join(stagedRootDir, sourceRelativeTarget);
      const targetStats = statSync(stagedTargetPath);
      const relativeLinkTarget = relative(currentDir, stagedTargetPath) || ".";

      unlinkSync(entryPath);
      symlinkSync(relativeLinkTarget, entryPath, targetStats.isDirectory() ? "dir" : "file");
      continue;
    }

    if (entryStats.isDirectory()) {
      rewriteSymlinksToStagedPaths(sourceRootDir, stagedRootDir, entryPath);
    }
  }
}

function removeTopLevelSymlinks(rootDir) {
  for (const entry of readdirSync(rootDir, { withFileTypes: true })) {
    const entryPath = join(rootDir, entry.name);
    const entryStats = lstatSync(entryPath);

    if (entryStats.isSymbolicLink()) {
      unlinkSync(entryPath);
    }
  }
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

function resolvePythonExecutable(rootDir) {
  const candidates =
    requestedTarget.platform === "win32"
      ? ["python.exe", "python3.exe", "python3.12.exe"]
      : ["python3.12", "python3", "python"];

  for (const candidate of candidates) {
    const found = findFile(
      rootDir,
      (entryPath, entryName) => entryName === candidate && isExecutableFile(entryPath),
    );
    if (found) {
      return found;
    }
  }

  throw new Error(`Unable to locate embedded Python executable under ${rootDir}`);
}

function readExistingManifest() {
  const manifestPath = join(toolingRoot, "manifest.json");
  if (!existsSync(manifestPath)) {
    return null;
  }

  return JSON.parse(readFileSync(manifestPath, "utf8"));
}

function hasUsableEmbeddedTooling() {
  const manifest = readExistingManifest();
  if (!manifest) {
    return false;
  }

  const uvPath = join(toolingRoot, manifest.uv?.path ?? "");
  const bunPath = join(toolingRoot, manifest.bun?.path ?? "");
  const pythonPath = join(toolingRoot, manifest.python?.path ?? "");

  return (
    manifest.platform === requestedTarget.platform &&
    manifest.arch === requestedTarget.arch &&
    manifest.uv?.version === uvVersion &&
    manifest.bun?.version === bunVersion &&
    manifest.python?.version === pythonVersion &&
    existsSync(uvPath) &&
    existsSync(bunPath) &&
    existsSync(pythonPath)
  );
}

async function main() {
  logStage(`Checking embedded tooling cache at ${toolingRoot}`);
  if (hasUsableEmbeddedTooling()) {
    logStage(`Reusing embedded tooling at ${toolingRoot}`);
    return;
  }

  logStage("Cache miss or version mismatch, preparing embedded tooling");

  const target = getTargetConfig();
  const tempRoot = mkdtempSync(join(tmpdir(), "open-jarvis-tooling-"));
  const downloadsDir = join(tempRoot, "downloads");
  const extractDir = join(tempRoot, "extract");
  const uvExtractDir = join(extractDir, "uv");
  const bunExtractDir = join(extractDir, "bun");
  const pythonInstallDir = join(tempRoot, "python-install");

  mkdirSync(downloadsDir, { recursive: true });
  mkdirSync(uvExtractDir, { recursive: true });
  mkdirSync(bunExtractDir, { recursive: true });
  mkdirSync(pythonInstallDir, { recursive: true });

  const uvArchivePath = join(downloadsDir, target.uvAsset);
  const bunArchivePath = join(downloadsDir, target.bunAsset);
  const uvUrl = `https://github.com/astral-sh/uv/releases/download/${uvVersion}/${target.uvAsset}`;
  const bunUrl = `https://github.com/oven-sh/bun/releases/download/bun-v${bunVersion}/${target.bunAsset}`;

  logStage(`Target platform: ${requestedTarget.id}`);
  logStage(`Working directory: ${tempRoot}`);
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

  const uvPath = findFile(
    uvExtractDir,
    (entryPath, entryName) => entryName === target.uvBinaryName && isExecutableFile(entryPath),
  );
  const bunPath = findFile(
    bunExtractDir,
    (entryPath, entryName) => entryName === target.bunBinaryName && isExecutableFile(entryPath),
  );

  if (!uvPath) {
    throw new Error(`Unable to locate uv executable after extracting ${target.uvAsset}`);
  }
  if (!bunPath) {
    throw new Error(`Unable to locate bun executable after extracting ${target.bunAsset}`);
  }

  const actualUvVersion = normalizeVersion(
    run(uvPath, ["--version"]).replace(/^uv\s+/, ""),
  );
  const actualBunVersion = normalizeVersion(run(bunPath, ["--version"]));

  if (actualUvVersion !== uvVersion) {
    throw new Error(`uv version mismatch: expected ${uvVersion}, got ${actualUvVersion}`);
  }
  if (actualBunVersion !== bunVersion) {
    throw new Error(`bun version mismatch: expected ${bunVersion}, got ${actualBunVersion}`);
  }

  logStage(`Installing Python ${pythonVersion} with bundled uv`);
  runWithEnvLogged(
    uvPath,
    [
      "python",
      "install",
      pythonVersion,
      "--install-dir",
      pythonInstallDir,
    ],
    {
      UV_PYTHON_INSTALL_DIR: pythonInstallDir,
    },
  );
  logStage(`Python ${pythonVersion} installation complete`);

  const pythonExecutable = resolvePythonExecutable(pythonInstallDir);
  const actualPythonVersion = normalizeVersion(
    run(pythonExecutable, ["--version"]).replace(/^Python\s+/, ""),
  );

  rmSync(toolingRoot, { recursive: true, force: true });
  mkdirSync(binDir, { recursive: true });
  mkdirSync(pythonDir, { recursive: true });

  stageExecutable(uvPath, join(binDir, target.uvBinaryName));
  stageExecutable(bunPath, join(binDir, target.bunBinaryName));
  stageDirectory(pythonInstallDir, pythonDir);
  if (requestedTarget.platform !== "win32") {
    rewriteSymlinksToStagedPaths(pythonInstallDir, pythonDir);
    removeTopLevelSymlinks(pythonDir);
  }

  const embeddedPythonPath = resolvePythonExecutable(pythonDir);
  const embeddedPythonRelativePath = relative(toolingRoot, embeddedPythonPath);

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
      request: pythonVersion,
      version: actualPythonVersion,
      path: embeddedPythonRelativePath,
    },
  };

  writeFileSync(join(toolingRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

  rmSync(tempRoot, { recursive: true, force: true });

  logStage(`Staged embedded tooling at ${toolingRoot}`);
  console.log(JSON.stringify(manifest, null, 2));
}

await main();