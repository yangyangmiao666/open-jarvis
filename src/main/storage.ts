import { homedir } from "os";
import { join } from "path";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import type { ProviderId } from "./types";

const OPEN_JARVIS_DIR = join(homedir(), ".open-jarvis");
const LEGACY_OPENWORK_DIR = join(homedir(), ".openwork");
const ENV_FILE = join(OPEN_JARVIS_DIR, ".env");

// Environment variable names for each provider
const ENV_VAR_NAMES: Record<ProviderId, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  google: "GOOGLE_API_KEY",
  ollama: "", // Ollama doesn't require an API key
  openai_compatible: "", // Stored in electron-store profiles
};

export function getOpenworkDir(): string {
  if (!existsSync(OPEN_JARVIS_DIR)) {
    if (existsSync(LEGACY_OPENWORK_DIR)) {
      try {
        renameSync(LEGACY_OPENWORK_DIR, OPEN_JARVIS_DIR);
      } catch {
        mkdirSync(OPEN_JARVIS_DIR, { recursive: true });
        cpSync(LEGACY_OPENWORK_DIR, OPEN_JARVIS_DIR, { recursive: true });
      }
    } else {
      mkdirSync(OPEN_JARVIS_DIR, { recursive: true });
    }
  }
  return OPEN_JARVIS_DIR;
}

export function getDbPath(): string {
  return join(getOpenworkDir(), "openwork.sqlite");
}

export function getCheckpointDbPath(): string {
  return join(getOpenworkDir(), "langgraph.sqlite");
}

export function getThreadCheckpointDir(): string {
  const dir = join(getOpenworkDir(), "threads");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function getThreadCheckpointPath(threadId: string): string {
  return join(getThreadCheckpointDir(), `${threadId}.sqlite`);
}

export function deleteThreadCheckpoint(threadId: string): void {
  const path = getThreadCheckpointPath(threadId);
  if (existsSync(path)) {
    unlinkSync(path);
  }
}

export function getEnvFilePath(): string {
  return ENV_FILE;
}

// Read .env file and parse into object
function parseEnvFile(): Record<string, string> {
  const envPath = getEnvFilePath();
  if (!existsSync(envPath)) return {};

  const content = readFileSync(envPath, "utf-8");
  const result: Record<string, string> = {};

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex > 0) {
      const key = trimmed.slice(0, eqIndex).trim();
      result[key] = trimmed.slice(eqIndex + 1).trim();
    }
  }
  return result;
}

// Write object back to .env file
function writeEnvFile(env: Record<string, string>): void {
  getOpenworkDir(); // ensure dir exists
  const lines = Object.entries(env)
    .filter((entry) => entry[1])
    .map(([k, v]) => `${k}=${v}`);
  writeFileSync(getEnvFilePath(), lines.join("\n") + "\n");
}

// API key management
export function getApiKey(provider: string): string | undefined {
  const envVarName = ENV_VAR_NAMES[provider];
  if (!envVarName) return undefined;

  // Check .env file first
  const env = parseEnvFile();
  if (env[envVarName]) return env[envVarName];

  // Fall back to process environment
  return process.env[envVarName];
}

export function setApiKey(provider: string, apiKey: string): void {
  const envVarName = ENV_VAR_NAMES[provider];
  if (!envVarName) return;

  const env = parseEnvFile();
  env[envVarName] = apiKey;
  writeEnvFile(env);

  // Also set in process.env for current session
  process.env[envVarName] = apiKey;
}

export function deleteApiKey(provider: string): void {
  const envVarName = ENV_VAR_NAMES[provider];
  if (!envVarName) return;

  const env = parseEnvFile();
  delete env[envVarName];
  writeEnvFile(env);

  // Also clear from process.env
  delete process.env[envVarName];
}

export function hasApiKey(provider: string): boolean {
  return !!getApiKey(provider);
}
