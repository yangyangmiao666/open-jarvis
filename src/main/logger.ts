import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { getOpenworkDir } from "./storage";

type LogLevel = "INFO" | "WARN" | "ERROR" | "DEBUG";

function ensureLogDir(): string {
  const dir = getOpenworkDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function logPath(): string {
  return join(ensureLogDir(), "main.log");
}

function normalizeArg(arg: unknown): string {
  if (arg instanceof Error) {
    return `${arg.name}: ${arg.message}\n${arg.stack ?? ""}`.trim();
  }

  if (typeof arg === "string") {
    return arg;
  }

  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

function write(level: LogLevel, scope: string, args: unknown[]): void {
  const line = `${new Date().toISOString()} [${level}] [${scope}] ${args
    .map((arg) => normalizeArg(arg))
    .join(" ")}\n`;

  try {
    appendFileSync(logPath(), line, "utf8");
  } catch {
    // Ignore logging failures.
  }
}

export function logInfo(scope: string, ...args: unknown[]): void {
  console.log(`[${scope}]`, ...args);
  write("INFO", scope, args);
}

export function logWarn(scope: string, ...args: unknown[]): void {
  console.warn(`[${scope}]`, ...args);
  write("WARN", scope, args);
}

export function logError(scope: string, ...args: unknown[]): void {
  console.error(`[${scope}]`, ...args);
  write("ERROR", scope, args);
}

export function getMainLogPath(): string {
  return logPath();
}