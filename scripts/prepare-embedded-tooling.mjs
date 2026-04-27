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
import { dirname, join, relative, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import process from "node:process";

const repoRoot = resolve(dirname(new URL(import.meta.url).pathname), "..");
const toolingRoot = join(
  repoRoot,
  "resources",
  "tooling",
  `${process.platform}-${process.arch}`,
);
const binDir = join(toolingRoot, "bin");
const pythonDir = join(toolingRoot, "python");
const uvVersion = "0.11.7";
const bunVersion = "1.3.13";
const pythonVersion = "3.12.13";

const TARGETS = {
  darwin: {
    arm64: {
      uvAsset: "uv-aarch64-apple-darwin.tar.gz",
      bunAsset: "bun-darwin-aarch64.zip",
    },
    x64: {
      uvAsset: "uv-x86_64-apple-darwin.tar.gz",
      bunAsset: "bun-darwin-x64.zip",
    },
  },
  linux: {
    arm64: {
      uvAsset: "uv-aarch64-unknown-linux-gnu.tar.gz",
      bunAsset: "bun-linux-aarch64.zip",
    },
    x64: {
      uvAsset: "uv-x86_64-unknown-linux-gnu.tar.gz",
      bunAsset: "bun-linux-x64.zip",
    },
  },
};

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
  const platformTargets = TARGETS[process.platform];
  if (!platformTargets) {
    throw new Error(
      `Unsupported platform for embedded tooling download: ${process.platform}`,
    );
  }

  const target = platformTargets[process.arch];
  if (!target) {
    throw new Error(
      `Unsupported architecture for embedded tooling download: ${process.platform}-${process.arch}`,
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

function extractTarGz(archivePath, destinationDir) {
  run("tar", ["-xzf", archivePath, "-C", destinationDir]);
}

function extractZip(archivePath, destinationDir) {
  run("unzip", ["-q", archivePath, "-d", destinationDir]);
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
  const candidates = ["python3.12", "python3", "python"];

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
    manifest.platform === process.platform &&
    manifest.arch === process.arch &&
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

  logStage(`Target platform: ${process.platform}-${process.arch}`);
  logStage(`Working directory: ${tempRoot}`);
  await downloadFile(uvUrl, uvArchivePath);
  await downloadFile(bunUrl, bunArchivePath);

  logStage(`Extracting ${target.uvAsset}`);
  extractTarGz(uvArchivePath, uvExtractDir);
  logStage(`Extracting ${target.bunAsset}`);
  extractZip(bunArchivePath, bunExtractDir);

  const uvPath = findFile(
    uvExtractDir,
    (entryPath, entryName) => entryName === "uv" && isExecutableFile(entryPath),
  );
  const bunPath = findFile(
    bunExtractDir,
    (entryPath, entryName) => entryName === "bun" && isExecutableFile(entryPath),
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

  stageExecutable(uvPath, join(binDir, "uv"));
  stageExecutable(bunPath, join(binDir, "bun"));
  stageDirectory(pythonInstallDir, pythonDir);

  const embeddedPythonPath = resolvePythonExecutable(pythonDir);
  const embeddedPythonRelativePath = relative(toolingRoot, embeddedPythonPath);

  const manifest = {
    platform: process.platform,
    arch: process.arch,
    uv: {
      version: actualUvVersion,
      path: "bin/uv",
    },
    bun: {
      version: actualBunVersion,
      path: "bin/bun",
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