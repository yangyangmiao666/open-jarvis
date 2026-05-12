/**
 * LocalSandbox: Execute shell commands locally on the host machine.
 *
 * Extends FilesystemBackend with command execution capability.
 * Commands run in the workspace directory with configurable timeout and output limits.
 *
 * Security note: This has NO built-in safeguards except for the human-in-the-loop
 * middleware provided by the agent framework. All command approval should be
 * handled via HITL configuration.
 */

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import {
  FilesystemBackend,
  type ExecuteResponse,
  type FileInfo,
  type GrepMatch,
  type ReadRawResult,
  type ReadResult,
  type SandboxBackendProtocolV2,
} from "deepagents";
import { decodeTextBuffer } from "../text-encoding";
import { getEmbeddedToolingRuntime } from "../tooling";
import { logError, logInfo } from "../logger";

/** Match deepagents FilesystemBackend formatting (read tool UX). */
const EMPTY_CONTENT_WARNING =
  "System reminder: File exists but has empty contents";
const MAX_LINE_LENGTH = 10_000;
const LINE_NUMBER_WIDTH = 6;
const SUPPORTS_NOFOLLOW = fsSync.constants.O_NOFOLLOW !== undefined;
const TEXTUTIL_PATH = "/usr/bin/textutil";

const BINARY_MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
  ".ico": "image/x-icon",
  ".heic": "image/heic",
  ".heif": "image/heif",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".aiff": "audio/aiff",
  ".aac": "audio/aac",
  ".ogg": "audio/ogg",
  ".flac": "audio/flac",
  ".m4a": "audio/mp4",
  ".weba": "audio/webm",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mpeg": "video/mpeg",
  ".mpg": "video/mpeg",
  ".mov": "video/quicktime",
  ".avi": "video/x-msvideo",
  ".flv": "video/x-flv",
  ".wmv": "video/x-ms-wmv",
  ".3gpp": "video/3gpp",
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".odt": "application/vnd.oasis.opendocument.text",
  ".rtf": "application/rtf",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx":
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".zip": "application/zip",
  ".7z": "application/x-7z-compressed",
  ".rar": "application/vnd.rar",
  ".tar": "application/x-tar",
  ".gz": "application/gzip",
};

const TEXT_MIME_TYPES: Record<string, string> = {
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".mdx": "text/markdown",
  ".markdown": "text/markdown",
  ".csv": "text/csv",
  ".tsv": "text/tab-separated-values",
  ".log": "text/plain",
  ".json": "application/json",
  ".jsonl": "application/json",
  ".js": "application/javascript",
  ".jsx": "application/javascript",
  ".mjs": "application/javascript",
  ".cjs": "application/javascript",
  ".ts": "text/plain",
  ".tsx": "text/plain",
  ".py": "text/plain",
  ".java": "text/plain",
  ".c": "text/plain",
  ".cc": "text/plain",
  ".cpp": "text/plain",
  ".h": "text/plain",
  ".hpp": "text/plain",
  ".cs": "text/plain",
  ".go": "text/plain",
  ".rs": "text/plain",
  ".rb": "text/plain",
  ".php": "text/plain",
  ".xml": "application/xml",
  ".html": "text/html",
  ".htm": "text/html",
  ".css": "text/css",
  ".scss": "text/css",
  ".sass": "text/css",
  ".less": "text/css",
  ".yaml": "text/yaml",
  ".yml": "text/yaml",
  ".toml": "text/plain",
  ".ini": "text/plain",
  ".cfg": "text/plain",
  ".conf": "text/plain",
  ".env": "text/plain",
  ".sql": "text/plain",
  ".sh": "text/plain",
  ".bash": "text/plain",
  ".zsh": "text/plain",
  ".fish": "text/plain",
  ".svg": "image/svg+xml",
};

const TEXTUTIL_SUPPORTED_EXTENSIONS = new Set([
  ".doc",
  ".docx",
  ".odt",
  ".rtf",
]);
const SPECIAL_TEXT_FILENAMES = new Set([
  "dockerfile",
  "makefile",
  ".gitignore",
  ".editorconfig",
  ".npmrc",
  ".yarnrc",
  ".env",
]);
const PYTHON_COMMAND_PATTERN =
  /(^|[\s(;|&])(?:python|python3|pip|pip3|pytest|py\.test|uv)(?=$|[\s);|&])/;
const JS_COMMAND_PATTERN =
  /(^|[\s(;|&])(?:bun|node|npm|npx|pnpm|yarn|tsx|ts-node|tsc|vite|vitest|jest|eslint|prettier|webpack|rollup|parcel|next|nuxt)(?=$|[\s);|&])/;

function checkEmptyContent(content: string): string | null {
  if (!content || content.trim() === "") return EMPTY_CONTENT_WARNING;
  return null;
}

function formatContentWithLineNumbers(
  content: string | string[],
  startLine = 1,
): string {
  let lines: string[];
  if (typeof content === "string") {
    lines = content.split("\n");
    if (lines.length > 0 && lines[lines.length - 1] === "")
      lines = lines.slice(0, -1);
  } else {
    lines = content;
  }
  const resultLines: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + startLine;
    if (line.length <= MAX_LINE_LENGTH) {
      resultLines.push(
        `${lineNum.toString().padStart(LINE_NUMBER_WIDTH)}\t${line}`,
      );
    } else {
      const numChunks = Math.ceil(line.length / MAX_LINE_LENGTH);
      for (let chunkIdx = 0; chunkIdx < numChunks; chunkIdx++) {
        const start = chunkIdx * MAX_LINE_LENGTH;
        const end = Math.min(start + MAX_LINE_LENGTH, line.length);
        const chunk = line.substring(start, end);
        if (chunkIdx === 0) {
          resultLines.push(
            `${lineNum.toString().padStart(LINE_NUMBER_WIDTH)}\t${chunk}`,
          );
        } else {
          const continuationMarker = `${lineNum}.${chunkIdx}`;
          resultLines.push(
            `${continuationMarker.padStart(LINE_NUMBER_WIDTH)}\t${chunk}`,
          );
        }
      }
    }
  }
  return resultLines.join("\n");
}

function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const base = path.basename(filePath).toLowerCase();
  if (!ext || SPECIAL_TEXT_FILENAMES.has(base)) {
    return "text/plain";
  }
  return (
    BINARY_MIME_TYPES[ext] ?? TEXT_MIME_TYPES[ext] ?? "application/octet-stream"
  );
}

function isTextMimeType(mimeType: string): boolean {
  return (
    mimeType.startsWith("text/") ||
    mimeType === "application/json" ||
    mimeType === "application/javascript" ||
    mimeType === "application/xml" ||
    mimeType === "text/yaml" ||
    mimeType === "image/svg+xml"
  );
}

function supportsTextExtraction(filePath: string): boolean {
  return TEXTUTIL_SUPPORTED_EXTENSIONS.has(
    path.extname(filePath).toLowerCase(),
  );
}

function needsPythonWorkspaceRuntime(command: string): boolean {
  return PYTHON_COMMAND_PATTERN.test(command);
}

function needsWindowsPythonBootstrap(command: string): boolean {
  if (!needsPythonWorkspaceRuntime(command)) {
    return false;
  }

  const segments = command
    .split(/(?:&&|\|\||[;&])(?=(?:[^"]*"[^"]*")*[^"]*$)/)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

  const pythonSegments = segments.filter((segment) =>
    PYTHON_COMMAND_PATTERN.test(segment),
  );

  if (pythonSegments.length === 0) {
    return false;
  }

  const workspacePythonSegmentPattern =
    /(^|[\s(;|&])(?:python|python3|pip|pip3|pytest|py\.test)(?=$|[\s);|&])/i;

  return pythonSegments.some((segment) => {
    if (/^(where|which)\b/i.test(segment)) {
      return workspacePythonSegmentPattern.test(segment);
    }

    if (/^uv\s+(--version|-V)\b/i.test(segment)) {
      return false;
    }

    return true;
  });
}

function needsJavaScriptWorkspaceRuntime(command: string): boolean {
  return JS_COMMAND_PATTERN.test(command);
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function rewriteWindowsCommand(command: string): string {
  // Convert POSIX-style command separators to cmd separators outside quoted text.
  const normalizedSeparators = command.replace(
    /;(?=(?:[^"]*"[^"]*")*[^"]*$)/g,
    " &",
  );

  return normalizedSeparators
    .replace(/\bwhich(?=\s)/g, "where")
    .replace(/\bpython3\b/g, "python")
    .replace(/\bpip3\b/g, "pip");
}

interface WindowsRuntimeCommandPlan {
  command: string;
  env: Record<string, string>;
}

interface WindowsRuntimeShims {
  generalShimDir: string;
  pythonShimDir: string | null;
}

function getWindowsEnvKey(
  env: Record<string, string>,
  key: string,
): string {
  const upperKey = key.toUpperCase();
  return Object.keys(env).find((candidate) => candidate.toUpperCase() === upperKey) ?? key;
}

/**
 * Options for LocalSandbox configuration.
 */
export interface LocalSandboxOptions {
  /** Root directory for file operations and command execution (default: process.cwd()) */
  rootDir?: string;
  /** Enable virtual path mode where "/" maps to rootDir (default: false) */
  virtualMode?: boolean;
  /** Maximum file size in MB for file operations (default: 10) */
  maxFileSizeMb?: number;
  /** Command timeout in milliseconds (default: 120000 = 2 minutes) */
  timeout?: number;
  /** Maximum output bytes before truncation (default: 100000 = ~100KB) */
  maxOutputBytes?: number;
  /** Environment variables to pass to commands (default: process.env) */
  env?: Record<string, string>;
}

/**
 * LocalSandbox backend with shell command execution.
 *
 * Extends FilesystemBackend to inherit all file operations (ls, read, write,
 * edit, glob, grep) and adds execute() for running shell commands locally.
 *
 * @example
 * ```typescript
 * const sandbox = new LocalSandbox({
 *   rootDir: '/path/to/workspace',
 *   virtualMode: true,
 *   timeout: 60_000,
 * });
 *
 * const result = await sandbox.execute('npm test');
 * console.log(result.output);
 * console.log('Exit code:', result.exitCode);
 * ```
 */
export class LocalSandbox
  extends FilesystemBackend
  implements SandboxBackendProtocolV2
{
  /** Unique identifier for this sandbox instance */
  readonly id: string;

  private readonly timeout: number;
  private readonly maxOutputBytes: number;
  private readonly env: Record<string, string>;
  private readonly workingDir: string;
  private readonly embeddedTooling = getEmbeddedToolingRuntime();

  constructor(options: LocalSandboxOptions = {}) {
    super({
      rootDir: options.rootDir,
      virtualMode: options.virtualMode,
      maxFileSizeMb: options.maxFileSizeMb,
    });

    this.id = `local-sandbox-${randomUUID().slice(0, 8)}`;
    this.timeout = options.timeout ?? 120_000; // 2 minutes default
    this.maxOutputBytes = options.maxOutputBytes ?? 100_000; // ~100KB default
    this.env = options.env ?? ({ ...process.env } as Record<string, string>);
    this.workingDir = options.rootDir ?? process.cwd();

    logInfo("LocalSandbox", "Created sandbox", {
      id: this.id,
      workingDir: this.workingDir,
      hasEmbeddedTooling: !!this.embeddedTooling,
      embeddedToolingRoot: this.embeddedTooling?.rootDir ?? null,
      platform: process.platform,
    });
  }

  /**
   * Resolve path like deepagents FilesystemBackend (private in typings; exists at runtime).
   */
  private resolvePathSafe(filePath: string): string {
    const self = this as unknown as { resolvePath: (k: string) => string };
    return self.resolvePath(filePath);
  }

  private getWorkspacePythonInstallDir(): string {
    return path.join(this.workingDir, ".open-jarvis", "python-install");
  }

  private ensureWindowsRuntimeShims(
    requiresPython: boolean,
    _requiresJavaScript: boolean,
  ): WindowsRuntimeShims {
    const generalShimDir = path.join(
      this.workingDir,
      ".open-jarvis",
      "runtime-bin",
    );
    const pythonShimDir = requiresPython
      ? path.join(this.workingDir, ".open-jarvis", "python-runtime-bin")
      : null;

    fsSync.mkdirSync(generalShimDir, { recursive: true });
    if (pythonShimDir) {
      fsSync.mkdirSync(pythonShimDir, { recursive: true });
    }

    const generalShims: Array<{ fileName: string; content: string }> = [
      {
        fileName: "which.cmd",
        content: "@echo off\r\nwhere %*\r\n",
      },
    ];

    const pythonShims: Array<{ fileName: string; content: string }> = [];

    const hasEmbeddedUv =
      !!this.embeddedTooling?.uvPath && fsSync.existsSync(this.embeddedTooling.uvPath);

    if (hasEmbeddedUv) {
      pythonShims.push(
        {
          fileName: "python.cmd",
          content:
            "@echo off\r\nsetlocal\r\nif exist \"%VIRTUAL_ENV%\\Scripts\\python.exe\" (\r\n  \"%OPEN_JARVIS_UV%\" run --python \"%VIRTUAL_ENV%\\Scripts\\python.exe\" python %*\r\n) else (\r\n  echo Error: workspace Python runtime is not initialized. 1>&2\r\n  exit /b 127\r\n)\r\n",
        },
        {
          fileName: "python3.cmd",
          content:
            "@echo off\r\nsetlocal\r\nif exist \"%VIRTUAL_ENV%\\Scripts\\python.exe\" (\r\n  \"%OPEN_JARVIS_UV%\" run --python \"%VIRTUAL_ENV%\\Scripts\\python.exe\" python %*\r\n) else (\r\n  echo Error: workspace Python runtime is not initialized. 1>&2\r\n  exit /b 127\r\n)\r\n",
        },
        {
          fileName: "pip.cmd",
          content:
            "@echo off\r\nsetlocal\r\nif exist \"%VIRTUAL_ENV%\\Scripts\\python.exe\" (\r\n  \"%OPEN_JARVIS_UV%\" pip --python \"%VIRTUAL_ENV%\\Scripts\\python.exe\" %*\r\n) else (\r\n  echo Error: workspace Python runtime is not initialized. 1>&2\r\n  exit /b 127\r\n)\r\n",
        },
        {
          fileName: "pip3.cmd",
          content:
            "@echo off\r\nsetlocal\r\nif exist \"%VIRTUAL_ENV%\\Scripts\\python.exe\" (\r\n  \"%OPEN_JARVIS_UV%\" pip --python \"%VIRTUAL_ENV%\\Scripts\\python.exe\" %*\r\n) else (\r\n  echo Error: workspace Python runtime is not initialized. 1>&2\r\n  exit /b 127\r\n)\r\n",
        },
        {
          fileName: "pytest.cmd",
          content:
            "@echo off\r\nsetlocal\r\nif exist \"%VIRTUAL_ENV%\\Scripts\\python.exe\" (\r\n  \"%OPEN_JARVIS_UV%\" run --python \"%VIRTUAL_ENV%\\Scripts\\python.exe\" pytest %*\r\n) else (\r\n  echo Error: workspace Python runtime is not initialized. 1>&2\r\n  exit /b 127\r\n)\r\n",
        },
        {
          fileName: "py.test.cmd",
          content:
            "@echo off\r\nsetlocal\r\nif exist \"%VIRTUAL_ENV%\\Scripts\\python.exe\" (\r\n  \"%OPEN_JARVIS_UV%\" run --python \"%VIRTUAL_ENV%\\Scripts\\python.exe\" pytest %*\r\n) else (\r\n  echo Error: workspace Python runtime is not initialized. 1>&2\r\n  exit /b 127\r\n)\r\n",
        },
      );
    }

    const hasEmbeddedBun =
      !!this.embeddedTooling?.bunPath && fsSync.existsSync(this.embeddedTooling.bunPath);

    if (hasEmbeddedBun) {
      generalShims.push(
        {
          fileName: "bun.cmd",
          content: '@echo off\r\n"%OPEN_JARVIS_BUN%" %*\r\n',
        },
        {
          fileName: "node.cmd",
          content: "@echo off\r\n\"%OPEN_JARVIS_BUN%\" %*\r\n",
        },
        {
          fileName: "tsx.cmd",
          content: "@echo off\r\n\"%OPEN_JARVIS_BUN%\" %*\r\n",
        },
        {
          fileName: "ts-node.cmd",
          content: "@echo off\r\n\"%OPEN_JARVIS_BUN%\" %*\r\n",
        },
        {
          fileName: "npx.cmd",
          content: "@echo off\r\n\"%OPEN_JARVIS_BUN%\" x %*\r\n",
        },
        {
          fileName: "npm.cmd",
          content:
            "@echo off\r\nsetlocal\r\nif /I \"%~1\"==\"install\" shift & \"%OPEN_JARVIS_BUN%\" install %* & exit /b %errorlevel%\r\nif /I \"%~1\"==\"i\" shift & \"%OPEN_JARVIS_BUN%\" install %* & exit /b %errorlevel%\r\nif /I \"%~1\"==\"ci\" shift & \"%OPEN_JARVIS_BUN%\" install --frozen-lockfile %* & exit /b %errorlevel%\r\nif /I \"%~1\"==\"run\" shift & \"%OPEN_JARVIS_BUN%\" run %* & exit /b %errorlevel%\r\nif /I \"%~1\"==\"exec\" shift & \"%OPEN_JARVIS_BUN%\" x %* & exit /b %errorlevel%\r\nif /I \"%~1\"==\"test\" shift & \"%OPEN_JARVIS_BUN%\" run test %* & exit /b %errorlevel%\r\nif /I \"%~1\"==\"start\" shift & \"%OPEN_JARVIS_BUN%\" run start %* & exit /b %errorlevel%\r\nif /I \"%~1\"==\"dev\" shift & \"%OPEN_JARVIS_BUN%\" run dev %* & exit /b %errorlevel%\r\nif /I \"%~1\"==\"build\" shift & \"%OPEN_JARVIS_BUN%\" run build %* & exit /b %errorlevel%\r\nif /I \"%~1\"==\"lint\" shift & \"%OPEN_JARVIS_BUN%\" run lint %* & exit /b %errorlevel%\r\necho Error: npm is redirected to bun in this workspace. Use a bun-compatible command. 1>&2\r\nexit /b 127\r\n",
        },
        {
          fileName: "pnpm.cmd",
          content:
            "@echo off\r\nsetlocal\r\nif /I \"%~1\"==\"install\" shift & \"%OPEN_JARVIS_BUN%\" install %* & exit /b %errorlevel%\r\nif /I \"%~1\"==\"i\" shift & \"%OPEN_JARVIS_BUN%\" install %* & exit /b %errorlevel%\r\nif /I \"%~1\"==\"run\" shift & \"%OPEN_JARVIS_BUN%\" run %* & exit /b %errorlevel%\r\nif /I \"%~1\"==\"exec\" shift & \"%OPEN_JARVIS_BUN%\" x %* & exit /b %errorlevel%\r\nif /I \"%~1\"==\"dlx\" shift & \"%OPEN_JARVIS_BUN%\" x %* & exit /b %errorlevel%\r\nif /I \"%~1\"==\"test\" shift & \"%OPEN_JARVIS_BUN%\" run test %* & exit /b %errorlevel%\r\nif /I \"%~1\"==\"start\" shift & \"%OPEN_JARVIS_BUN%\" run start %* & exit /b %errorlevel%\r\nif /I \"%~1\"==\"dev\" shift & \"%OPEN_JARVIS_BUN%\" run dev %* & exit /b %errorlevel%\r\nif /I \"%~1\"==\"build\" shift & \"%OPEN_JARVIS_BUN%\" run build %* & exit /b %errorlevel%\r\nif /I \"%~1\"==\"lint\" shift & \"%OPEN_JARVIS_BUN%\" run lint %* & exit /b %errorlevel%\r\necho Error: pnpm is redirected to bun in this workspace. Use a bun-compatible command. 1>&2\r\nexit /b 127\r\n",
        },
        {
          fileName: "yarn.cmd",
          content:
            "@echo off\r\nsetlocal\r\nif /I \"%~1\"==\"install\" shift & \"%OPEN_JARVIS_BUN%\" install %* & exit /b %errorlevel%\r\nif /I \"%~1\"==\"run\" shift & \"%OPEN_JARVIS_BUN%\" run %* & exit /b %errorlevel%\r\nif /I \"%~1\"==\"dlx\" shift & \"%OPEN_JARVIS_BUN%\" x %* & exit /b %errorlevel%\r\nif /I \"%~1\"==\"test\" shift & \"%OPEN_JARVIS_BUN%\" run test %* & exit /b %errorlevel%\r\nif /I \"%~1\"==\"start\" shift & \"%OPEN_JARVIS_BUN%\" run start %* & exit /b %errorlevel%\r\nif /I \"%~1\"==\"dev\" shift & \"%OPEN_JARVIS_BUN%\" run dev %* & exit /b %errorlevel%\r\nif /I \"%~1\"==\"build\" shift & \"%OPEN_JARVIS_BUN%\" run build %* & exit /b %errorlevel%\r\nif /I \"%~1\"==\"lint\" shift & \"%OPEN_JARVIS_BUN%\" run lint %* & exit /b %errorlevel%\r\necho Error: yarn is redirected to bun in this workspace. Use a bun-compatible command. 1>&2\r\nexit /b 127\r\n",
        },
      );
    }

    const syncWindowsShims = (
      targetDir: string,
      shims: Array<{ fileName: string; content: string }>,
    ) => {
      for (const shim of shims) {
        const targetPath = path.join(targetDir, shim.fileName);
        const current = fsSync.existsSync(targetPath)
          ? fsSync.readFileSync(targetPath, "utf8")
          : null;
        if (current !== shim.content) {
          fsSync.writeFileSync(targetPath, shim.content, "utf8");
        }
      }

      // Keep a stable superset of runtime shims in the shared directory.
      // Multiple sandboxes can execute concurrently for the same workspace, so
      // per-request cleanup can delete a shim that another in-flight command still needs.
      const expectedShimNames = new Set(
        shims.map((shim) => shim.fileName.toLowerCase()),
      );
      for (const entry of fsSync.readdirSync(targetDir, { withFileTypes: true })) {
        if (!entry.isFile()) {
          continue;
        }

        const entryName = entry.name.toLowerCase();
        if (!entryName.endsWith(".cmd")) {
          continue;
        }

        if (!expectedShimNames.has(entryName)) {
          fsSync.rmSync(path.join(targetDir, entry.name), { force: true });
        }
      }

      return fsSync
        .readdirSync(targetDir, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".cmd"))
        .map((entry) => entry.name)
        .sort((a, b) => a.localeCompare(b));
    };

    const generalShimFiles = syncWindowsShims(generalShimDir, generalShims);
    const pythonShimFiles = pythonShimDir
      ? syncWindowsShims(pythonShimDir, pythonShims)
      : [];

    logInfo("LocalSandbox", "Windows runtime shims prepared", {
      generalShimDir,
      generalShimFiles,
      pythonShimDir,
      pythonShimFiles,
    });

    return {
      generalShimDir,
      pythonShimDir,
    };
  }

  private buildWorkspaceRuntimeCommandForWindows(
    command: string,
  ): WindowsRuntimeCommandPlan {
    const rewrittenCommand = rewriteWindowsCommand(command);
    const prelude: string[] = [];
    const commandEnv = { ...this.env };
    const pathKey = getWindowsEnvKey(commandEnv, "PATH");
    const pathExtKey = getWindowsEnvKey(commandEnv, "PATHEXT");

    const requiresPython = needsPythonWorkspaceRuntime(rewrittenCommand);
    const requiresJavaScript = needsJavaScriptWorkspaceRuntime(rewrittenCommand);
    const windowsRuntimeShims = this.ensureWindowsRuntimeShims(
      requiresPython,
      requiresJavaScript,
    );

    commandEnv.OPEN_JARVIS_RUNTIME_BIN = windowsRuntimeShims.generalShimDir;
    if (windowsRuntimeShims.pythonShimDir) {
      commandEnv.OPEN_JARVIS_PYTHON_RUNTIME_BIN =
        windowsRuntimeShims.pythonShimDir;
    }
    const currentPathExt = commandEnv[pathExtKey] ?? "";
    commandEnv[pathExtKey] = currentPathExt.toUpperCase().includes(".CMD")
      ? currentPathExt
      : `.COM;.EXE;.BAT;.CMD;${currentPathExt}`;

    logInfo("LocalSandbox", "Building Windows runtime command", {
      requiresPython,
      requiresJavaScript,
      hasEmbeddedTooling: !!this.embeddedTooling,
      generalShimDir: windowsRuntimeShims.generalShimDir,
      pythonShimDir: windowsRuntimeShims.pythonShimDir,
      pathExt: commandEnv[pathExtKey] ?? null,
    });

    if ((requiresPython || requiresJavaScript) && this.embeddedTooling) {
      const workspacePythonInstallDir = this.getWorkspacePythonInstallDir();
      commandEnv.OPEN_JARVIS_TOOLING_ROOT = this.embeddedTooling.rootDir;
      commandEnv.OPEN_JARVIS_TOOLING_BIN = this.embeddedTooling.binDir;
      commandEnv.OPEN_JARVIS_UV = this.embeddedTooling.uvPath;
      commandEnv.OPEN_JARVIS_BUN = this.embeddedTooling.bunPath;
      commandEnv.OPEN_JARVIS_PYTHON_VERSION = this.embeddedTooling.pythonVersion;
      commandEnv.UV_PYTHON_INSTALL_DIR = workspacePythonInstallDir;
      commandEnv.UV_NO_PROGRESS = "true";

      logInfo("LocalSandbox", "Embedded tooling environment variables set", {
        OPEN_JARVIS_UV: this.embeddedTooling.uvPath,
        OPEN_JARVIS_BUN: this.embeddedTooling.bunPath,
        OPEN_JARVIS_PYTHON_VERSION: this.embeddedTooling.pythonVersion,
        UV_PYTHON_INSTALL_DIR: workspacePythonInstallDir,
      });
    }

    const pathSegments: string[] = [];

    if (requiresPython) {
      if (windowsRuntimeShims.pythonShimDir) {
        pathSegments.push(windowsRuntimeShims.pythonShimDir);
      }

      pathSegments.push(
        path.join(this.workingDir, ".venv", "Scripts"),
      );
    }

    if ((requiresPython || requiresJavaScript) && this.embeddedTooling) {
      pathSegments.push(this.embeddedTooling.binDir);
    }

    // Put the shim directory after the real embedded executables so bare
    // uv/python/bun commands resolve to the bundled .exe files instead of the
    // .cmd wrappers that can distort quoted arguments on Windows.
    pathSegments.push(windowsRuntimeShims.generalShimDir);

    pathSegments.push(path.join(this.workingDir, "node_modules", ".bin"));
    commandEnv[pathKey] = `${pathSegments.join(";")};${commandEnv[pathKey] ?? ""}`;

    if (requiresPython) {
      commandEnv.VIRTUAL_ENV = path.join(this.workingDir, ".venv");
    }

    if (requiresPython) {
      const hasUv =
        this.embeddedTooling && fsSync.existsSync(this.embeddedTooling.uvPath);
      const hasPythonVersion = !!this.embeddedTooling?.pythonVersion;

      logInfo("LocalSandbox", "Python runtime check", {
        embeddedToolingExists: !!this.embeddedTooling,
        uvExists: hasUv,
        pythonVersion: this.embeddedTooling?.pythonVersion ?? null,
      });

      if (!this.embeddedTooling || !hasUv || !hasPythonVersion) {
        prelude.push(
          "echo Error: embedded uv runtime is incomplete in this app package. 1>&2",
          "exit /b 127",
        );
      }
    }

    if (requiresJavaScript) {
      const hasBun =
        this.embeddedTooling && fsSync.existsSync(this.embeddedTooling.bunPath);

      logInfo("LocalSandbox", "JavaScript runtime check", {
        embeddedToolingExists: !!this.embeddedTooling,
        bunExists: hasBun,
      });

      if (!this.embeddedTooling || !hasBun) {
        prelude.push(
          "echo Error: embedded bun runtime is incomplete in this app package. 1>&2",
          "exit /b 127",
        );
      }
    }

    prelude.push(rewrittenCommand);
    return {
      command: prelude.join(" && "),
      env: commandEnv,
    };
  }

  private buildWorkspaceRuntimeCommand(command: string): string {
    const prelude: string[] = ['export PATH="$PWD/node_modules/.bin:$PATH"'];

    const requiresPython = needsPythonWorkspaceRuntime(command);
    const requiresJavaScript = needsJavaScriptWorkspaceRuntime(command);

    if ((requiresPython || requiresJavaScript) && this.embeddedTooling) {
      const workspacePythonInstallDir = this.getWorkspacePythonInstallDir();
      prelude.push(
        `export OPEN_JARVIS_TOOLING_ROOT=${shellQuote(this.embeddedTooling.rootDir)}`,
        `export OPEN_JARVIS_TOOLING_BIN=${shellQuote(this.embeddedTooling.binDir)}`,
        `export OPEN_JARVIS_UV=${shellQuote(this.embeddedTooling.uvPath)}`,
        `export OPEN_JARVIS_BUN=${shellQuote(this.embeddedTooling.bunPath)}`,
        `export OPEN_JARVIS_PYTHON_VERSION=${shellQuote(this.embeddedTooling.pythonVersion)}`,
        `export UV_PYTHON_INSTALL_DIR=${shellQuote(workspacePythonInstallDir)}`,
        'export UV_NO_PROGRESS="true"',
      );
    }

    if (requiresPython) {
      if (!this.embeddedTooling) {
        prelude.push(
          "printf '%s\\n' 'Error: embedded Python tooling is not available. Run the packaging flow that prepares bundled tooling first.' >&2",
          "exit 127",
        );
      } else {
      prelude.push(
        'if [ ! -x "$OPEN_JARVIS_UV" ] || [ -z "$OPEN_JARVIS_PYTHON_VERSION" ]; then',
        "  printf '%s\\n' 'Error: embedded uv runtime is incomplete in this app package.' >&2",
        "  exit 127",
        "fi",
        'if [ ! -x "$PWD/.venv/bin/python" ]; then',
        '  "$OPEN_JARVIS_UV" venv "$PWD/.venv" --python "$OPEN_JARVIS_PYTHON_VERSION" >/dev/null',
        "fi",
        'export VIRTUAL_ENV="$PWD/.venv"',
        'export PATH="$VIRTUAL_ENV/bin:$OPEN_JARVIS_TOOLING_BIN:$PATH"',
        "uv() {",
        '  case "${1-}" in',
        '    pip) shift; "$OPEN_JARVIS_UV" pip --python "$VIRTUAL_ENV/bin/python" "$@" ;;',
        '    run) shift; "$OPEN_JARVIS_UV" run --python "$VIRTUAL_ENV/bin/python" "$@" ;;',
        '    python) shift; "$OPEN_JARVIS_UV" run --python "$VIRTUAL_ENV/bin/python" python "$@" ;;',
        '    *) "$OPEN_JARVIS_UV" "$@" ;;',
        "  esac",
        "}",
        "python() {",
        '  "$OPEN_JARVIS_UV" run --python "$VIRTUAL_ENV/bin/python" python "$@"',
        "}",
        'python3() { python "$@"; }',
        "pip() {",
        '  "$OPEN_JARVIS_UV" pip --python "$VIRTUAL_ENV/bin/python" "$@"',
        "}",
        'pip3() { pip "$@"; }',
        "pytest() {",
        '  "$OPEN_JARVIS_UV" run --python "$VIRTUAL_ENV/bin/python" pytest "$@"',
        "}",
      );
      }
    }

    if (requiresJavaScript) {
      if (!this.embeddedTooling) {
        prelude.push(
          "printf '%s\\n' 'Error: embedded JavaScript tooling is not available. Run the packaging flow that prepares bundled tooling first.' >&2",
          "exit 127",
        );
      } else {
      prelude.push(
        'if [ ! -x "$OPEN_JARVIS_BUN" ]; then',
        "  printf '%s\\n' 'Error: embedded bun runtime is incomplete in this app package.' >&2",
        "  exit 127",
        "fi",
        'export PATH="$OPEN_JARVIS_TOOLING_BIN:$PATH"',
        'bun() { "$OPEN_JARVIS_BUN" "$@"; }',
        "npm() {",
        '  case "${1-}" in',
        '    install|i) shift; bun install "$@" ;;',
        '    ci) shift; bun install --frozen-lockfile "$@" ;;',
        '    run) shift; bun run "$@" ;;',
        '    test|start|dev|build|lint) cmd="$1"; shift; bun run "$cmd" "$@" ;;',
        '    exec) shift; bun x "$@" ;;',
        "    *) printf '%s\\n' 'Error: npm is redirected to bun in this workspace. Use a bun-compatible command.' >&2; return 127 ;;",
        "  esac",
        "}",
        'npx() { bun x "$@"; }',
        "pnpm() {",
        '  case "${1-}" in',
        '    install|i) shift; bun install "$@" ;;',
        '    run) shift; bun run "$@" ;;',
        '    test|start|dev|build|lint) cmd="$1"; shift; bun run "$cmd" "$@" ;;',
        '    exec|dlx) shift; bun x "$@" ;;',
        "    *) printf '%s\\n' 'Error: pnpm is redirected to bun in this workspace. Use a bun-compatible command.' >&2; return 127 ;;",
        "  esac",
        "}",
        "yarn() {",
        '  case "${1-}" in',
        '    install) shift; bun install "$@" ;;',
        '    run) shift; bun run "$@" ;;',
        '    test|start|dev|build|lint) cmd="$1"; shift; bun run "$cmd" "$@" ;;',
        '    dlx) shift; bun x "$@" ;;',
        "    *) printf '%s\\n' 'Error: yarn is redirected to bun in this workspace. Use a bun-compatible command.' >&2; return 127 ;;",
        "  esac",
        "}",
        "node() {",
        '  if [ "${1-}" = "-e" ] || [ "${1-}" = "--eval" ]; then',
        "    shift",
        '    bun -e "$@"',
        "  else",
        '    bun "$@"',
        "  fi",
        "}",
        'tsx() { bun "$@"; }',
        "alias ts-node='bun'",
      );
      }
    }

    prelude.push(command);
    return prelude.join("\n");
  }

  private async ensureWindowsWorkspacePythonRuntime(
    commandEnv: Record<string, string>,
  ): Promise<ExecuteResponse | null> {
    const venvPythonPath = path.join(
      this.workingDir,
      ".venv",
      "Scripts",
      "python.exe",
    );

    if (fsSync.existsSync(venvPythonPath)) {
      return null;
    }

    const hasUv =
      !!this.embeddedTooling?.uvPath && fsSync.existsSync(this.embeddedTooling.uvPath);
    const pythonVersion = this.embeddedTooling?.pythonVersion ?? null;

    logInfo("LocalSandbox", "Ensuring Windows Python runtime", {
      sandboxId: this.id,
      workingDir: this.workingDir,
      venvPythonPath,
      hasEmbeddedTooling: !!this.embeddedTooling,
      uvPath: this.embeddedTooling?.uvPath ?? null,
      pythonVersion,
      hasUv,
    });

    if (!this.embeddedTooling || !hasUv || !pythonVersion) {
      return {
        output: "[stderr] Error: embedded uv runtime is incomplete in this app package.\n",
        exitCode: 127,
        truncated: false,
      };
    }

    return new Promise<ExecuteResponse | null>((resolve) => {
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let settled = false;

      const proc = spawn(
        this.embeddedTooling!.uvPath,
        [
          "venv",
          path.join(this.workingDir, ".venv"),
          "--python",
          pythonVersion,
        ],
        {
          cwd: this.workingDir,
          env: commandEnv,
          stdio: ["ignore", "pipe", "pipe"],
        },
      );

      const timeoutId = setTimeout(() => {
        if (settled) {
          return;
        }

        settled = true;
        proc.kill("SIGTERM");
        setTimeout(() => proc.kill("SIGKILL"), 1000);
        resolve({
          output: `Error: Command timed out after ${(this.timeout / 1000).toFixed(1)} seconds.`,
          exitCode: null,
          truncated: false,
        });
      }, this.timeout);

      proc.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
      proc.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));

      proc.on("error", (error) => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timeoutId);
        resolve({
          output: `[stderr] ${String(error)}\n`,
          exitCode: 1,
          truncated: false,
        });
      });

      proc.on("close", (code, signal) => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timeoutId);

        const decodedStdout = decodeTextBuffer(Buffer.concat(stdout));
        const decodedStderr = decodeTextBuffer(Buffer.concat(stderr));

        if (code === 0) {
          logInfo("LocalSandbox", "Windows Python runtime ready", {
            sandboxId: this.id,
            workingDir: this.workingDir,
            venvPythonPath,
          });
          resolve(null);
          return;
        }

        const outputParts: string[] = [];
        if (decodedStdout) {
          outputParts.push(decodedStdout);
        }
        if (decodedStderr) {
          outputParts.push(
            decodedStderr
              .split("\n")
              .filter((line) => line.length > 0)
              .map((line) => `[stderr] ${line}`)
              .join("\n") + (decodedStderr.endsWith("\n") ? "\n" : ""),
          );
        }

        resolve({
          output:
            outputParts.join("") ||
            `[stderr] uv venv exited with code ${code}${signal ? ` (signal: ${signal})` : ""}.\n`,
          exitCode: code,
          truncated: false,
        });
      });
    });
  }

  private async extractTextWithTextutil(resolvedPath: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const proc = spawn(
        TEXTUTIL_PATH,
        ["-stdout", "-convert", "txt", "--", resolvedPath],
        {
          stdio: ["ignore", "pipe", "pipe"],
        },
      );

      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];

      proc.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
      proc.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
      proc.on("error", reject);
      proc.on("close", (code) => {
        if (code !== 0) {
          reject(
            new Error(
              Buffer.concat(stderr).toString("utf8") ||
                `textutil exited with code ${code}`,
            ),
          );
          return;
        }
        resolve(decodeTextBuffer(Buffer.concat(stdout)));
      });
    });
  }

  private async readTextFile(filePath: string): Promise<{
    raw: Buffer;
    stat: Awaited<ReturnType<typeof fs.lstat>>;
  }> {
    const resolvedPath = this.resolvePathSafe(filePath);

    if (SUPPORTS_NOFOLLOW) {
      const stat = await fs.stat(resolvedPath);
      if (!stat.isFile()) {
        throw new Error(`File '${filePath}' not found`);
      }
      const fd = await fs.open(
        resolvedPath,
        fsSync.constants.O_RDONLY | fsSync.constants.O_NOFOLLOW,
      );
      try {
        const raw = await fd.readFile();
        return { raw, stat };
      } finally {
        await fd.close();
      }
    }

    const stat = await fs.lstat(resolvedPath);
    if (stat.isSymbolicLink())
      throw new Error(`Symlinks are not allowed: ${filePath}`);
    if (!stat.isFile()) throw new Error(`File '${filePath}' not found`);
    const raw = await fs.readFile(resolvedPath);
    return { raw, stat };
  }

  /**
   * Read file using UTF-8 with GB18030 fallback (matches workspace:readFile).
   */
  override async read(
    filePath: string,
    offset = 0,
    limit = 500,
  ): Promise<ReadResult> {
    try {
      const { raw, stat } = await this.readTextFile(filePath);
      const mimeType = getMimeType(filePath);

      if (!isTextMimeType(mimeType)) {
        if (supportsTextExtraction(filePath)) {
          const resolvedPath = this.resolvePathSafe(filePath);
          const content = await this.extractTextWithTextutil(resolvedPath);
          const emptyMsg = checkEmptyContent(content);
          if (emptyMsg) return { content: emptyMsg, mimeType: "text/plain" };
          const lines = content.split("\n");
          const startIdx = offset;
          const endIdx = Math.min(startIdx + limit, lines.length);
          if (startIdx >= lines.length) {
            return {
              error: `Line offset ${offset} exceeds file length (${lines.length} lines)`,
            };
          }
          return {
            content: formatContentWithLineNumbers(
              lines.slice(startIdx, endIdx),
              startIdx + 1,
            ),
            mimeType: "text/plain",
          };
        }

        return {
          content: new Uint8Array(raw),
          mimeType,
        };
      }

      if (!stat.isFile()) {
        return { error: `File '${filePath}' not found` };
      }

      const content = decodeTextBuffer(raw);
      const emptyMsg = checkEmptyContent(content);
      if (emptyMsg) {
        return { content: emptyMsg, mimeType };
      }
      const lines = content.split("\n");
      const startIdx = offset;
      const endIdx = Math.min(startIdx + limit, lines.length);
      if (startIdx >= lines.length) {
        return {
          error: `Line offset ${offset} exceeds file length (${lines.length} lines)`,
        };
      }
      return {
        content: formatContentWithLineNumbers(
          lines.slice(startIdx, endIdx),
          startIdx + 1,
        ),
        mimeType,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { error: `Error reading file '${filePath}': ${msg}` };
    }
  }

  override async readRaw(filePath: string): Promise<ReadRawResult> {
    try {
      const { raw, stat } = await this.readTextFile(filePath);
      const mimeType = getMimeType(filePath);

      if (!isTextMimeType(mimeType)) {
        if (supportsTextExtraction(filePath)) {
          const resolvedPath = this.resolvePathSafe(filePath);
          const text = await this.extractTextWithTextutil(resolvedPath);
          return {
            data: {
              content: text,
              mimeType: "text/plain",
              created_at: stat.ctime.toISOString(),
              modified_at: stat.mtime.toISOString(),
            },
          };
        }

        return {
          data: {
            content: new Uint8Array(raw),
            mimeType,
            created_at: stat.ctime.toISOString(),
            modified_at: stat.mtime.toISOString(),
          },
        };
      }

      const text = decodeTextBuffer(raw);
      return {
        data: {
          content: text,
          mimeType,
          created_at: stat.ctime.toISOString(),
          modified_at: stat.mtime.toISOString(),
        },
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { error: `Error reading file '${filePath}': ${msg}` };
    }
  }

  async lsInfo(dirPath: string): Promise<FileInfo[]> {
    const result = await this.ls(dirPath);
    return result.files ?? [];
  }

  async grepRaw(
    pattern: string,
    dirPath?: string | null,
    glob?: string | null,
  ): Promise<GrepMatch[] | string> {
    const result = await this.grep(pattern, dirPath ?? undefined, glob);
    return result.error ?? result.matches ?? [];
  }

  async globInfo(pattern: string, searchPath = "/"): Promise<FileInfo[]> {
    const result = await this.glob(pattern, searchPath);
    return result.files ?? [];
  }

  /**
   * Execute a shell command in the workspace directory.
   *
   * @param command - Shell command string to execute
   * @returns ExecuteResponse with combined output, exit code, and truncation flag
   *
   * @example
   * ```typescript
   * const result = await sandbox.execute('echo "Hello World"');
   * // result.output: "Hello World\n"
   * // result.exitCode: 0
   * // result.truncated: false
   * ```
   */
  async execute(command: string): Promise<ExecuteResponse> {
    if (!command) {
      return {
        output: "Error: Shell tool expects a non-empty command string.",
        exitCode: 1,
        truncated: false,
      };
    }

    const isWindows = process.platform === "win32";
    const windowsRuntimePlan = isWindows
      ? this.buildWorkspaceRuntimeCommandForWindows(command)
      : null;
    const preparedCommand = windowsRuntimePlan?.command ?? this.buildWorkspaceRuntimeCommand(command);
    const commandEnv = windowsRuntimePlan?.env ?? this.env;
    const requiresWindowsPythonRuntime =
      isWindows && needsWindowsPythonBootstrap(command);
    logInfo("LocalSandbox", "Execute requested", {
      sandboxId: this.id,
      command,
      preparedCommand,
      workingDir: this.workingDir,
      platform: process.platform,
    });

    if (requiresWindowsPythonRuntime) {
      const pythonRuntimeError = await this.ensureWindowsWorkspacePythonRuntime(
        commandEnv,
      );
      if (pythonRuntimeError) {
        logInfo("LocalSandbox", "Execute completed", {
          sandboxId: this.id,
          exitCode: pythonRuntimeError.exitCode,
          signal: null,
          truncated: pythonRuntimeError.truncated,
          outputPreview: pythonRuntimeError.output.slice(0, 500),
        });
        return pythonRuntimeError;
      }
    }

    return new Promise<ExecuteResponse>((resolve) => {
      const outputParts: string[] = [];
      let totalBytes = 0;
      let truncated = false;
      let resolved = false;

      // Determine shell based on platform
      const shell = isWindows ? "cmd.exe" : "/bin/sh";
      const shellArgs = isWindows
        ? ["/d", "/s", "/c", preparedCommand]
        : ["-c", preparedCommand];

      const proc = spawn(shell, shellArgs, {
        cwd: this.workingDir,
        env: commandEnv,
        stdio: ["ignore", "pipe", "pipe"],
      });

      // Handle timeout
      const timeoutId = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          proc.kill("SIGTERM");
          // Give it a moment, then force kill
          setTimeout(() => proc.kill("SIGKILL"), 1000);
          resolve({
            output: `Error: Command timed out after ${(this.timeout / 1000).toFixed(1)} seconds.`,
            exitCode: null,
            truncated: false,
          });
        }
      }, this.timeout);

      // Collect stdout
      proc.stdout.on("data", (data: Buffer) => {
        if (truncated) return;

        const chunk = decodeTextBuffer(data);
        const newTotal = totalBytes + chunk.length;

        if (newTotal > this.maxOutputBytes) {
          // Truncate to fit within limit
          const remaining = this.maxOutputBytes - totalBytes;
          if (remaining > 0) {
            outputParts.push(chunk.slice(0, remaining));
          }
          truncated = true;
          totalBytes = this.maxOutputBytes;
        } else {
          outputParts.push(chunk);
          totalBytes = newTotal;
        }
      });

      // Collect stderr with [stderr] prefix per line
      proc.stderr.on("data", (data: Buffer) => {
        if (truncated) return;

        const chunk = decodeTextBuffer(data);
        // Prefix each line with [stderr]
        const prefixedLines = chunk
          .split("\n")
          .filter((line) => line.length > 0)
          .map((line) => `[stderr] ${line}`)
          .join("\n");

        if (prefixedLines.length === 0) return;

        const withNewline = prefixedLines + (chunk.endsWith("\n") ? "\n" : "");
        const newTotal = totalBytes + withNewline.length;

        if (newTotal > this.maxOutputBytes) {
          const remaining = this.maxOutputBytes - totalBytes;
          if (remaining > 0) {
            outputParts.push(withNewline.slice(0, remaining));
          }
          truncated = true;
          totalBytes = this.maxOutputBytes;
        } else {
          outputParts.push(withNewline);
          totalBytes = newTotal;
        }
      });

      // Handle process exit
      proc.on("close", (code, signal) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timeoutId);

        let output = outputParts.join("");

        // Add truncation notice if needed
        if (truncated) {
          output += `\n\n... Output truncated at ${this.maxOutputBytes} bytes.`;
        }

        // If no output, show placeholder
        if (!output.trim()) {
          output = "<no output>";
        }

        logInfo("LocalSandbox", "Execute completed", {
          sandboxId: this.id,
          exitCode: signal ? null : code,
          signal,
          truncated,
          outputPreview: output.slice(0, 500),
        });

        resolve({
          output,
          exitCode: signal ? null : code,
          truncated,
        });
      });

      // Handle spawn errors
      proc.on("error", (err) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timeoutId);

        logError("LocalSandbox", "Execute spawn error", {
          sandboxId: this.id,
          command,
          preparedCommand,
          error: err.message,
        });

        resolve({
          output: `Error: Failed to execute command: ${err.message}`,
          exitCode: 1,
          truncated: false,
        });
      });
    });
  }
}
