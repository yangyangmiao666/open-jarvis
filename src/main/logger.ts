type LogLevel = "INFO" | "WARN" | "ERROR" | "DEBUG";

function write(level: LogLevel, scope: string, args: unknown[]): void {
  void level;
  void scope;
  void args;
}

export function logInfo(scope: string, ...args: unknown[]): void {
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