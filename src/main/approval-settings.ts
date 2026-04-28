import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { getThread, updateThread } from "./db";
import type {
  ApprovalMode,
  HITLRequest,
  ThreadMetadata,
  WorkspaceApprovalRule,
} from "./types";

function getThreadMetadata(threadId: string): ThreadMetadata {
  const thread = getThread(threadId);
  if (!thread?.metadata) return {};
  try {
    return JSON.parse(thread.metadata) as ThreadMetadata;
  } catch {
    return {};
  }
}

function getWorkspaceApprovalDir(workspacePath: string): string {
  return join(workspacePath, ".open-jarvis");
}

function getWorkspaceApprovalRulesPath(workspacePath: string): string {
  return join(getWorkspaceApprovalDir(workspacePath), "approval-rules.json");
}

function readWorkspaceRules(workspacePath: string): WorkspaceApprovalRule[] {
  const rulesPath = getWorkspaceApprovalRulesPath(workspacePath);
  if (!existsSync(rulesPath)) return [];

  try {
    const raw = readFileSync(rulesPath, "utf-8");
    const parsed = JSON.parse(raw) as WorkspaceApprovalRule[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeWorkspaceRules(
  workspacePath: string,
  rules: WorkspaceApprovalRule[],
): void {
  const dir = getWorkspaceApprovalDir(workspacePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(
    getWorkspaceApprovalRulesPath(workspacePath),
    JSON.stringify(rules, null, 2) + "\n",
    "utf-8",
  );
}

function sortObject(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortObject);
  }
  if (value && typeof value === "object") {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = sortObject((value as Record<string, unknown>)[key]);
        return acc;
      }, {});
  }
  return value;
}

function normalizeWhitespace(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

function normalizeCommandForSimilarity(command: string): string {
  return normalizeWhitespace(command).replace(/\b\d+(?:\.\d+)?\b/g, "<num>");
}

export function createApprovalSignature(request: HITLRequest): string {
  const { name, args } = request.tool_call;

  if (name === "execute") {
    const command = typeof args.command === "string" ? args.command : "";
    return `${name}:${normalizeCommandForSimilarity(command)}`;
  }

  return `${name}:${JSON.stringify(sortObject(args))}`;
}

export function getApprovalMode(threadId: string): ApprovalMode {
  const metadata = getThreadMetadata(threadId);
  return metadata.approvalMode === "auto" ? "auto" : "manual";
}

export function setApprovalMode(
  threadId: string,
  mode: ApprovalMode,
): ApprovalMode {
  const metadata = getThreadMetadata(threadId);
  updateThread(threadId, {
    metadata: JSON.stringify({
      ...metadata,
      approvalMode: mode,
    }),
  });
  return mode;
}

export function shouldAutoApprove(
  threadId: string,
  workspacePath: string | undefined,
  request: HITLRequest,
): { approved: boolean; reason: "mode" | "workspace-rule" | null } {
  if (getApprovalMode(threadId) === "auto") {
    return { approved: true, reason: "mode" };
  }

  if (!workspacePath) {
    return { approved: false, reason: null };
  }

  const signature = createApprovalSignature(request);
  const rules = readWorkspaceRules(workspacePath);
  const matched = rules.some(
    (rule) =>
      rule.toolName === request.tool_call.name && rule.signature === signature,
  );

  return {
    approved: matched,
    reason: matched ? "workspace-rule" : null,
  };
}

export function rememberWorkspaceApproval(
  workspacePath: string,
  request: HITLRequest,
): WorkspaceApprovalRule {
  const signature = createApprovalSignature(request);
  const nextRule: WorkspaceApprovalRule = {
    toolName: request.tool_call.name,
    signature,
    createdAt: new Date().toISOString(),
  };

  const existing = readWorkspaceRules(workspacePath);
  const hasRule = existing.some(
    (rule) =>
      rule.toolName === nextRule.toolName &&
      rule.signature === nextRule.signature,
  );

  if (!hasRule) {
    writeWorkspaceRules(workspacePath, [...existing, nextRule]);
  }

  return nextRule;
}
