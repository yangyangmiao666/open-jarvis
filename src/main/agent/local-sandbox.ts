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

import { spawn } from "node:child_process"
import { randomUUID } from "node:crypto"
import * as fs from "node:fs/promises"
import fsSync from "node:fs"
import path from "node:path"
import {
  FilesystemBackend,
  type ExecuteResponse,
  type FileInfo,
  type GrepMatch,
  type ReadRawResult,
  type ReadResult,
  type SandboxBackendProtocolV2
} from "deepagents"
import { decodeTextBuffer } from "../text-encoding"

/** Match deepagents FilesystemBackend formatting (read tool UX). */
const EMPTY_CONTENT_WARNING = "System reminder: File exists but has empty contents"
const MAX_LINE_LENGTH = 10_000
const LINE_NUMBER_WIDTH = 6
const SUPPORTS_NOFOLLOW = fsSync.constants.O_NOFOLLOW !== undefined
const TEXTUTIL_PATH = "/usr/bin/textutil"

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
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".odt": "application/vnd.oasis.opendocument.text",
  ".rtf": "application/rtf",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".zip": "application/zip",
  ".7z": "application/x-7z-compressed",
  ".rar": "application/vnd.rar",
  ".tar": "application/x-tar",
  ".gz": "application/gzip"
}

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
  ".svg": "image/svg+xml"
}

const TEXTUTIL_SUPPORTED_EXTENSIONS = new Set([".doc", ".docx", ".odt", ".rtf"])
const SPECIAL_TEXT_FILENAMES = new Set([
  "dockerfile",
  "makefile",
  ".gitignore",
  ".editorconfig",
  ".npmrc",
  ".yarnrc",
  ".env"
])

function checkEmptyContent(content: string): string | null {
  if (!content || content.trim() === "") return EMPTY_CONTENT_WARNING
  return null
}

function formatContentWithLineNumbers(content: string | string[], startLine = 1): string {
  let lines: string[]
  if (typeof content === "string") {
    lines = content.split("\n")
    if (lines.length > 0 && lines[lines.length - 1] === "") lines = lines.slice(0, -1)
  } else {
    lines = content
  }
  const resultLines: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const lineNum = i + startLine
    if (line.length <= MAX_LINE_LENGTH) {
      resultLines.push(`${lineNum.toString().padStart(LINE_NUMBER_WIDTH)}\t${line}`)
    } else {
      const numChunks = Math.ceil(line.length / MAX_LINE_LENGTH)
      for (let chunkIdx = 0; chunkIdx < numChunks; chunkIdx++) {
        const start = chunkIdx * MAX_LINE_LENGTH
        const end = Math.min(start + MAX_LINE_LENGTH, line.length)
        const chunk = line.substring(start, end)
        if (chunkIdx === 0) {
          resultLines.push(`${lineNum.toString().padStart(LINE_NUMBER_WIDTH)}\t${chunk}`)
        } else {
          const continuationMarker = `${lineNum}.${chunkIdx}`
          resultLines.push(`${continuationMarker.padStart(LINE_NUMBER_WIDTH)}\t${chunk}`)
        }
      }
    }
  }
  return resultLines.join("\n")
}

function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase()
  const base = path.basename(filePath).toLowerCase()
  if (!ext || SPECIAL_TEXT_FILENAMES.has(base)) {
    return "text/plain"
  }
  return BINARY_MIME_TYPES[ext] ?? TEXT_MIME_TYPES[ext] ?? "application/octet-stream"
}

function isTextMimeType(mimeType: string): boolean {
  return (
    mimeType.startsWith("text/") ||
    mimeType === "application/json" ||
    mimeType === "application/javascript" ||
    mimeType === "application/xml" ||
    mimeType === "text/yaml" ||
    mimeType === "image/svg+xml"
  )
}

function supportsTextExtraction(filePath: string): boolean {
  return TEXTUTIL_SUPPORTED_EXTENSIONS.has(path.extname(filePath).toLowerCase())
}

/**
 * Options for LocalSandbox configuration.
 */
export interface LocalSandboxOptions {
  /** Root directory for file operations and command execution (default: process.cwd()) */
  rootDir?: string
  /** Enable virtual path mode where "/" maps to rootDir (default: false) */
  virtualMode?: boolean
  /** Maximum file size in MB for file operations (default: 10) */
  maxFileSizeMb?: number
  /** Command timeout in milliseconds (default: 120000 = 2 minutes) */
  timeout?: number
  /** Maximum output bytes before truncation (default: 100000 = ~100KB) */
  maxOutputBytes?: number
  /** Environment variables to pass to commands (default: process.env) */
  env?: Record<string, string>
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
export class LocalSandbox extends FilesystemBackend implements SandboxBackendProtocolV2 {
  /** Unique identifier for this sandbox instance */
  readonly id: string

  private readonly timeout: number
  private readonly maxOutputBytes: number
  private readonly env: Record<string, string>
  private readonly workingDir: string

  constructor(options: LocalSandboxOptions = {}) {
    super({
      rootDir: options.rootDir,
      virtualMode: options.virtualMode,
      maxFileSizeMb: options.maxFileSizeMb
    })

    this.id = `local-sandbox-${randomUUID().slice(0, 8)}`
    this.timeout = options.timeout ?? 120_000 // 2 minutes default
    this.maxOutputBytes = options.maxOutputBytes ?? 100_000 // ~100KB default
    this.env = options.env ?? ({ ...process.env } as Record<string, string>)
    this.workingDir = options.rootDir ?? process.cwd()
  }

  /**
   * Resolve path like deepagents FilesystemBackend (private in typings; exists at runtime).
   */
  private resolvePathSafe(filePath: string): string {
    const self = this as unknown as { resolvePath: (k: string) => string }
    return self.resolvePath(filePath)
  }

  private async extractTextWithTextutil(resolvedPath: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const proc = spawn(TEXTUTIL_PATH, ["-stdout", "-convert", "txt", "--", resolvedPath], {
        stdio: ["ignore", "pipe", "pipe"]
      })

      const stdout: Buffer[] = []
      const stderr: Buffer[] = []

      proc.stdout.on("data", (chunk: Buffer) => stdout.push(chunk))
      proc.stderr.on("data", (chunk: Buffer) => stderr.push(chunk))
      proc.on("error", reject)
      proc.on("close", (code) => {
        if (code !== 0) {
          reject(new Error(Buffer.concat(stderr).toString("utf8") || `textutil exited with code ${code}`))
          return
        }
        resolve(decodeTextBuffer(Buffer.concat(stdout)))
      })
    })
  }

  private async readTextFile(filePath: string): Promise<{
    raw: Buffer
    stat: Awaited<ReturnType<typeof fs.lstat>>
  }> {
    const resolvedPath = this.resolvePathSafe(filePath)

    if (SUPPORTS_NOFOLLOW) {
      const stat = await fs.stat(resolvedPath)
      if (!stat.isFile()) {
        throw new Error(`File '${filePath}' not found`)
      }
      const fd = await fs.open(resolvedPath, fsSync.constants.O_RDONLY | fsSync.constants.O_NOFOLLOW)
      try {
        const raw = await fd.readFile()
        return { raw, stat }
      } finally {
        await fd.close()
      }
    }

    const stat = await fs.lstat(resolvedPath)
    if (stat.isSymbolicLink()) throw new Error(`Symlinks are not allowed: ${filePath}`)
    if (!stat.isFile()) throw new Error(`File '${filePath}' not found`)
    const raw = await fs.readFile(resolvedPath)
    return { raw, stat }
  }

  /**
   * Read file using UTF-8 with GB18030 fallback (matches workspace:readFile).
   */
  override async read(filePath: string, offset = 0, limit = 500): Promise<ReadResult> {
    try {
      const { raw, stat } = await this.readTextFile(filePath)
      const mimeType = getMimeType(filePath)

      if (!isTextMimeType(mimeType)) {
        if (supportsTextExtraction(filePath)) {
          const resolvedPath = this.resolvePathSafe(filePath)
          const content = await this.extractTextWithTextutil(resolvedPath)
          const emptyMsg = checkEmptyContent(content)
          if (emptyMsg) return { content: emptyMsg, mimeType: "text/plain" }
          const lines = content.split("\n")
          const startIdx = offset
          const endIdx = Math.min(startIdx + limit, lines.length)
          if (startIdx >= lines.length) {
            return { error: `Line offset ${offset} exceeds file length (${lines.length} lines)` }
          }
          return {
            content: formatContentWithLineNumbers(lines.slice(startIdx, endIdx), startIdx + 1),
            mimeType: "text/plain"
          }
        }

        return {
          content: new Uint8Array(raw),
          mimeType
        }
      }

      if (!stat.isFile()) {
        return { error: `File '${filePath}' not found` }
      }

      const content = decodeTextBuffer(raw)
      const emptyMsg = checkEmptyContent(content)
      if (emptyMsg) {
        return { content: emptyMsg, mimeType }
      }
      const lines = content.split("\n")
      const startIdx = offset
      const endIdx = Math.min(startIdx + limit, lines.length)
      if (startIdx >= lines.length) {
        return { error: `Line offset ${offset} exceeds file length (${lines.length} lines)` }
      }
      return {
        content: formatContentWithLineNumbers(lines.slice(startIdx, endIdx), startIdx + 1),
        mimeType
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return { error: `Error reading file '${filePath}': ${msg}` }
    }
  }

  override async readRaw(filePath: string): Promise<ReadRawResult> {
    try {
      const { raw, stat } = await this.readTextFile(filePath)
      const mimeType = getMimeType(filePath)

      if (!isTextMimeType(mimeType)) {
        if (supportsTextExtraction(filePath)) {
          const resolvedPath = this.resolvePathSafe(filePath)
          const text = await this.extractTextWithTextutil(resolvedPath)
          return {
            data: {
              content: text,
              mimeType: "text/plain",
              created_at: stat.ctime.toISOString(),
              modified_at: stat.mtime.toISOString()
            }
          }
        }

        return {
          data: {
            content: new Uint8Array(raw),
            mimeType,
            created_at: stat.ctime.toISOString(),
            modified_at: stat.mtime.toISOString()
          }
        }
      }

      const text = decodeTextBuffer(raw)
      return {
        data: {
          content: text,
          mimeType,
          created_at: stat.ctime.toISOString(),
          modified_at: stat.mtime.toISOString()
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return { error: `Error reading file '${filePath}': ${msg}` }
    }
  }

  async lsInfo(dirPath: string): Promise<FileInfo[]> {
    const result = await this.ls(dirPath)
    return result.files ?? []
  }

  async grepRaw(pattern: string, dirPath?: string | null, glob?: string | null): Promise<GrepMatch[] | string> {
    const result = await this.grep(pattern, dirPath ?? undefined, glob)
    return result.error ?? result.matches ?? []
  }

  async globInfo(pattern: string, searchPath = "/"): Promise<FileInfo[]> {
    const result = await this.glob(pattern, searchPath)
    return result.files ?? []
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
    if (!command || typeof command !== "string") {
      return {
        output: "Error: Shell tool expects a non-empty command string.",
        exitCode: 1,
        truncated: false
      }
    }

    return new Promise<ExecuteResponse>((resolve) => {
      const outputParts: string[] = []
      let totalBytes = 0
      let truncated = false
      let resolved = false

      // Determine shell based on platform
      const isWindows = process.platform === "win32"
      const shell = isWindows ? "cmd.exe" : "/bin/sh"
      const shellArgs = isWindows ? ["/c", command] : ["-c", command]

      const proc = spawn(shell, shellArgs, {
        cwd: this.workingDir,
        env: this.env,
        stdio: ["ignore", "pipe", "pipe"]
      })

      // Handle timeout
      const timeoutId = setTimeout(() => {
        if (!resolved) {
          resolved = true
          proc.kill("SIGTERM")
          // Give it a moment, then force kill
          setTimeout(() => proc.kill("SIGKILL"), 1000)
          resolve({
            output: `Error: Command timed out after ${(this.timeout / 1000).toFixed(1)} seconds.`,
            exitCode: null,
            truncated: false
          })
        }
      }, this.timeout)

      // Collect stdout
      proc.stdout.on("data", (data: Buffer) => {
        if (truncated) return

        const chunk = data.toString()
        const newTotal = totalBytes + chunk.length

        if (newTotal > this.maxOutputBytes) {
          // Truncate to fit within limit
          const remaining = this.maxOutputBytes - totalBytes
          if (remaining > 0) {
            outputParts.push(chunk.slice(0, remaining))
          }
          truncated = true
          totalBytes = this.maxOutputBytes
        } else {
          outputParts.push(chunk)
          totalBytes = newTotal
        }
      })

      // Collect stderr with [stderr] prefix per line
      proc.stderr.on("data", (data: Buffer) => {
        if (truncated) return

        const chunk = data.toString()
        // Prefix each line with [stderr]
        const prefixedLines = chunk
          .split("\n")
          .filter((line) => line.length > 0)
          .map((line) => `[stderr] ${line}`)
          .join("\n")

        if (prefixedLines.length === 0) return

        const withNewline = prefixedLines + (chunk.endsWith("\n") ? "\n" : "")
        const newTotal = totalBytes + withNewline.length

        if (newTotal > this.maxOutputBytes) {
          const remaining = this.maxOutputBytes - totalBytes
          if (remaining > 0) {
            outputParts.push(withNewline.slice(0, remaining))
          }
          truncated = true
          totalBytes = this.maxOutputBytes
        } else {
          outputParts.push(withNewline)
          totalBytes = newTotal
        }
      })

      // Handle process exit
      proc.on("close", (code, signal) => {
        if (resolved) return
        resolved = true
        clearTimeout(timeoutId)

        let output = outputParts.join("")

        // Add truncation notice if needed
        if (truncated) {
          output += `\n\n... Output truncated at ${this.maxOutputBytes} bytes.`
        }

        // If no output, show placeholder
        if (!output.trim()) {
          output = "<no output>"
        }

        resolve({
          output,
          exitCode: signal ? null : code,
          truncated
        })
      })

      // Handle spawn errors
      proc.on("error", (err) => {
        if (resolved) return
        resolved = true
        clearTimeout(timeoutId)

        resolve({
          output: `Error: Failed to execute command: ${err.message}`,
          exitCode: 1,
          truncated: false
        })
      })
    })
  }
}
