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
import { FilesystemBackend, type ExecuteResponse, type SandboxBackendProtocol } from "deepagents"
import { decodeTextBuffer } from "../text-encoding"

/** Match deepagents FilesystemBackend formatting (read tool UX). */
const EMPTY_CONTENT_WARNING = "System reminder: File exists but has empty contents"
const MAX_LINE_LENGTH = 10_000
const LINE_NUMBER_WIDTH = 6
const SUPPORTS_NOFOLLOW = fsSync.constants.O_NOFOLLOW !== undefined

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
export class LocalSandbox extends FilesystemBackend implements SandboxBackendProtocol {
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

  /**
   * Read file using UTF-8 with GB18030 fallback (matches workspace:readFile).
   */
  override async read(filePath: string, offset = 0, limit = 500): Promise<string> {
    try {
      const resolvedPath = this.resolvePathSafe(filePath)
      let raw: Buffer
      if (SUPPORTS_NOFOLLOW) {
        if (!(await fs.stat(resolvedPath)).isFile()) {
          return `Error: File '${filePath}' not found`
        }
        const fd = await fs.open(resolvedPath, fsSync.constants.O_RDONLY | fsSync.constants.O_NOFOLLOW)
        try {
          raw = await fd.readFile()
        } finally {
          await fd.close()
        }
      } else {
        const stat = await fs.lstat(resolvedPath)
        if (stat.isSymbolicLink()) return `Error: Symlinks are not allowed: ${filePath}`
        if (!stat.isFile()) return `Error: File '${filePath}' not found`
        raw = await fs.readFile(resolvedPath)
      }
      const content = decodeTextBuffer(raw)
      const emptyMsg = checkEmptyContent(content)
      if (emptyMsg) return emptyMsg
      const lines = content.split("\n")
      const startIdx = offset
      const endIdx = Math.min(startIdx + limit, lines.length)
      if (startIdx >= lines.length) {
        return `Error: Line offset ${offset} exceeds file length (${lines.length} lines)`
      }
      return formatContentWithLineNumbers(lines.slice(startIdx, endIdx), startIdx + 1)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return `Error reading file '${filePath}': ${msg}`
    }
  }

  override async readRaw(filePath: string): Promise<{
    content: string[]
    created_at: string
    modified_at: string
  }> {
    const resolvedPath = this.resolvePathSafe(filePath)
    let raw: Buffer
    let stat: Awaited<ReturnType<typeof fs.lstat>>
    if (SUPPORTS_NOFOLLOW) {
      stat = await fs.stat(resolvedPath)
      if (!stat.isFile()) throw new Error(`File '${filePath}' not found`)
      const fd = await fs.open(resolvedPath, fsSync.constants.O_RDONLY | fsSync.constants.O_NOFOLLOW)
      try {
        raw = await fd.readFile()
      } finally {
        await fd.close()
      }
    } else {
      stat = await fs.lstat(resolvedPath)
      if (stat.isSymbolicLink()) throw new Error(`Symlinks are not allowed: ${filePath}`)
      if (!stat.isFile()) throw new Error(`File '${filePath}' not found`)
      raw = await fs.readFile(resolvedPath)
    }
    const text = decodeTextBuffer(raw)
    return {
      content: text.split("\n"),
      created_at: stat.ctime.toISOString(),
      modified_at: stat.mtime.toISOString()
    }
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
