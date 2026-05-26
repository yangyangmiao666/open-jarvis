import * as fs from "node:fs/promises";
import path from "node:path";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import {
  ensureWorkspaceMemoryBootstrapFiles,
  getWorkspaceMemoryDir,
  MEMORY_ROUTE_PREFIX,
} from "../memory-config";
import { logInfo, logWarn } from "../logger";
import { getSkillPromotionThreshold } from "../memory-settings";
import type {
  MemoryDocument,
  MemoryDocumentSummary,
  MemoryPromotionCandidate,
} from "../types";

interface SerializedGraphMessage {
  id?: unknown;
  kwargs?: Record<string, unknown>;
}

interface MemoryFrontmatter {
  title: string;
  summary: string;
  keywords: string[];
  workspaceTags: string[];
  recallCount: number;
  lastRecalledAt: string | null;
  lastUpdatedAt: string;
  promotionStatus: "none" | "candidate" | "promoted" | "rejected";
}

interface MemoryDocumentRecord {
  filePath: string;
  routePath: string;
  frontmatter: MemoryFrontmatter;
  body: string;
}

interface ConsolidateTaskMemoryOptions {
  threadId: string;
  workspacePath: string;
  model: BaseChatModel;
  state: unknown;
  trigger: "invoke" | "resume";
}

interface ConsolidateTaskMemoryResult {
  promotionCandidate: MemoryPromotionCandidate | null;
}

interface GeneratedMemoryDraft {
  title: string;
  summary: string;
  keywords: string[];
  target_path: string;
  body_markdown: string;
}

const MEMORY_SYSTEM_PROMPT = `You consolidate completed agent work into durable topic memory.

Return strict JSON only with these keys:
- title: short generalized topic title
- summary: one-sentence generalized summary
- keywords: array of 3-8 short keywords
- target_path: an absolute route path under ${MEMORY_ROUTE_PREFIX} ending in .md; if an existing memory is a good match, reuse its exact route path and do not create a new file
- body_markdown: markdown body only, without frontmatter

Rules:
- Prefer editing an existing similar memory instead of creating duplicates.
- Keep the memory topic-oriented, durable, and reusable.
- Write the title, summary, and body in generalized reusable language rather than as a one-off task report.
- Avoid exact user requests, ticket phrasing, temporary project details, timestamps, single-run outcomes, absolute paths, and unnecessary file names unless they are essential to the reusable lesson.
- Prefer abstract topics such as capability, workflow, pattern, failure mode, or troubleshooting method.
- Focus on scenarios, successful workflow, concrete execution steps, failure signals, important commands/files/constraints, cautions, and what to check first next time.
- Prioritize the task handling process above all other details.
- If the source task is very specific, abstract it upward into the most reusable topic that still preserves the real workflow and cautions.
- The markdown body must explicitly preserve the task's operation flow/process and cautions/notes so it can be reused as a skill later.
- Do not include fenced JSON or explanations outside the JSON object.`;

type UnknownRecord = Record<string, unknown>;

function stringifyConversationContent(content: unknown): string {
  if (typeof content === "string") {
    return content.trim();
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") {
          return part.trim();
        }
        if (!part || typeof part !== "object") {
          return "";
        }

        const record = part as Record<string, unknown>;
        if (typeof record.text === "string") {
          return record.text.trim();
        }
        if (typeof record.content === "string") {
          return record.content.trim();
        }
        if (typeof record.reasoning === "string") {
          return record.reasoning.trim();
        }
        if (typeof record.thinking === "string") {
          return record.thinking.trim();
        }
        return "";
      })
      .filter((value) => value.length > 0)
      .join("\n")
      .trim();
  }

  if (content && typeof content === "object") {
    const record = content as Record<string, unknown>;
    if (typeof record.text === "string") {
      return record.text.trim();
    }
    if (typeof record.content === "string") {
      return record.content.trim();
    }
    return JSON.stringify(content);
  }

  return "";
}

function summarizeToolCalls(toolCalls: unknown): string {
  if (!Array.isArray(toolCalls) || toolCalls.length === 0) {
    return "";
  }

  return toolCalls
    .map((toolCall) => {
      if (!toolCall || typeof toolCall !== "object") {
        return "tool";
      }
      const record = toolCall as Record<string, unknown>;
      if (typeof record.name === "string" && record.name.length > 0) {
        return record.name;
      }

      const fn = record.function as { name?: unknown } | undefined;
      return typeof fn?.name === "string" ? fn.name : "tool";
    })
    .join(", ");
}

function parseToolArgs(args: unknown): Record<string, unknown> | null {
  if (!args) {
    return null;
  }

  if (typeof args === "string") {
    try {
      const parsed = JSON.parse(args) as unknown;
      return parsed && typeof parsed === "object"
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }

  return typeof args === "object" ? (args as Record<string, unknown>) : null;
}

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function collectToolCalls(message: SerializedGraphMessage): UnknownRecord[] {
  const kwargs = asRecord(message.kwargs) ?? {};
  const additionalKwargs = asRecord(kwargs.additional_kwargs) ?? {};
  const candidates = [
    kwargs.tool_calls,
    kwargs.toolCalls,
    additionalKwargs.tool_calls,
    additionalKwargs.toolCalls,
    additionalKwargs.function_call,
    kwargs.invalid_tool_calls,
    kwargs.invalidToolCalls,
  ];

  const toolCalls: UnknownRecord[] = [];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      for (const item of candidate) {
        const record = asRecord(item);
        if (record) {
          toolCalls.push(record);
        }
      }
      continue;
    }

    const record = asRecord(candidate);
    if (record) {
      toolCalls.push(record);
    }
  }

  return toolCalls;
}

function getToolCallName(toolCall: UnknownRecord): string {
  if (typeof toolCall.name === "string") {
    return toolCall.name;
  }

  const functionRecord = asRecord(toolCall.function);
  return typeof functionRecord?.name === "string" ? functionRecord.name : "";
}

function getToolCallArgs(
  toolCall: UnknownRecord,
): Record<string, unknown> | null {
  const directArgs = parseToolArgs(toolCall.args);
  if (directArgs) {
    return directArgs;
  }

  const functionRecord = asRecord(toolCall.function);
  return parseToolArgs(functionRecord?.arguments);
}

function getToolCallPath(args: Record<string, unknown> | null): string {
  if (!args) {
    return "";
  }

  const candidates = [args.file_path, args.filePath, args.path, args.filename];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.length > 0) {
      return candidate;
    }
  }

  return "";
}

function normalizeMemoryRoutePath(rawPath: string): string | null {
  const trimmed = rawPath.trim();
  if (!trimmed) {
    return null;
  }

  const normalized = path.posix.normalize(
    trimmed.startsWith("/") ? trimmed : `/${trimmed}`,
  );
  if (
    !normalized.startsWith(MEMORY_ROUTE_PREFIX) ||
    !normalized.endsWith(".md")
  ) {
    return null;
  }

  return normalized;
}

function routePathToRelativePath(routePath: string): string {
  const normalized = normalizeMemoryRoutePath(routePath);
  if (!normalized) {
    throw new Error("Invalid memory route path");
  }

  return normalized.slice(MEMORY_ROUTE_PREFIX.length).replace(/^\//, "");
}

function slugifyTopicName(raw: string): string {
  const slug = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "memory-topic";
}

function ensureTopicRoutePath(rawPath: string, title: string): string {
  const normalized = normalizeMemoryRoutePath(rawPath);
  if (normalized && normalized.endsWith(".md")) {
    return normalized;
  }

  return `${MEMORY_ROUTE_PREFIX}${slugifyTopicName(title)}.md`;
}

function tokenizeForSimilarity(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fff]+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 2);
}

function calculateMemorySimilarity(
  draft: Pick<GeneratedMemoryDraft, "title" | "summary" | "keywords">,
  document: MemoryDocumentRecord,
): number {
  const draftTokens = new Set([
    ...tokenizeForSimilarity(draft.title),
    ...tokenizeForSimilarity(draft.summary),
    ...draft.keywords.flatMap((keyword) => tokenizeForSimilarity(keyword)),
  ]);
  const documentTokens = new Set([
    ...tokenizeForSimilarity(document.frontmatter.title),
    ...tokenizeForSimilarity(document.frontmatter.summary),
    ...document.frontmatter.keywords.flatMap((keyword) =>
      tokenizeForSimilarity(keyword),
    ),
  ]);

  if (draftTokens.size === 0 || documentTokens.size === 0) {
    return 0;
  }

  let overlap = 0;
  for (const token of draftTokens) {
    if (documentTokens.has(token)) {
      overlap += 1;
    }
  }

  return overlap / Math.max(draftTokens.size, documentTokens.size);
}

function resolveMemoryRoutePath(
  draft: GeneratedMemoryDraft,
  existingDocs: MemoryDocumentRecord[],
  recalledMemoryPaths: string[],
): string {
  const recalledExisting = recalledMemoryPaths
    .map((routePath) => existingDocs.find((doc) => doc.routePath === routePath))
    .find((doc): doc is MemoryDocumentRecord => Boolean(doc));
  if (recalledExisting) {
    return recalledExisting.routePath;
  }

  const requestedRoutePath = ensureTopicRoutePath(
    draft.target_path,
    draft.title,
  );
  const exactExisting = existingDocs.find(
    (doc) => doc.routePath === requestedRoutePath,
  );
  if (exactExisting) {
    return exactExisting.routePath;
  }

  const similarExisting = existingDocs
    .map((doc) => ({ doc, score: calculateMemorySimilarity(draft, doc) }))
    .sort((left, right) => right.score - left.score)[0];
  if (similarExisting && similarExisting.score >= 0.35) {
    return similarExisting.doc.routePath;
  }

  return requestedRoutePath;
}

function toSkillName(title: string): string {
  return slugifyTopicName(title);
}

function pathTitleFallback(routePath: string): string {
  return routePath
    .replace(MEMORY_ROUTE_PREFIX, "")
    .replace(/\.md$/i, "")
    .replace(/[/-]+/g, " ")
    .trim();
}

function routePathToFilePath(workspacePath: string, routePath: string): string {
  return path.join(
    getWorkspaceMemoryDir(workspacePath),
    routePathToRelativePath(routePath),
  );
}

function filePathToRoutePath(workspacePath: string, filePath: string): string {
  const relativePath = path.relative(
    getWorkspaceMemoryDir(workspacePath),
    filePath,
  );
  return `${MEMORY_ROUTE_PREFIX}${relativePath.replace(/\\/g, "/")}`;
}

function parseFrontmatter(markdown: string): {
  frontmatter: Partial<MemoryFrontmatter>;
  body: string;
} {
  if (!markdown.startsWith("---\n")) {
    return { frontmatter: {}, body: markdown.trim() };
  }

  const closingIndex = markdown.indexOf("\n---\n", 4);
  if (closingIndex === -1) {
    return { frontmatter: {}, body: markdown.trim() };
  }

  const rawFrontmatter = markdown.slice(4, closingIndex).trim();
  const body = markdown.slice(closingIndex + 5).trim();
  const lines = rawFrontmatter.split("\n");
  const frontmatter: Partial<MemoryFrontmatter> = {};
  let currentArrayKey: "keywords" | "workspaceTags" | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    if (trimmed.startsWith("- ") && currentArrayKey) {
      const value = trimmed.slice(2).trim().replace(/^"|"$/g, "");
      const currentValues = frontmatter[currentArrayKey] ?? [];
      frontmatter[currentArrayKey] = [...currentValues, value];
      continue;
    }

    currentArrayKey = null;
    const separatorIndex = trimmed.indexOf(":");
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();

    switch (key) {
      case "title":
      case "summary":
      case "lastUpdatedAt":
        frontmatter[key] = value.replace(/^"|"$/g, "");
        break;
      case "lastRecalledAt":
        frontmatter.lastRecalledAt =
          value === "null" ? null : value.replace(/^"|"$/g, "");
        break;
      case "recallCount":
        frontmatter.recallCount = Number.parseInt(value, 10) || 0;
        break;
      case "promotionStatus":
        if (
          value === "none" ||
          value === "candidate" ||
          value === "promoted" ||
          value === "rejected"
        ) {
          frontmatter.promotionStatus = value;
        }
        break;
      case "keywords":
      case "workspaceTags":
        frontmatter[key] = [];
        currentArrayKey = key;
        break;
      default:
        break;
    }
  }

  return { frontmatter, body };
}

function serializeMemoryDocument(
  frontmatter: MemoryFrontmatter,
  body: string,
): string {
  const keywordLines = frontmatter.keywords
    .map((keyword) => `  - ${keyword}`)
    .join("\n");
  const workspaceLines = frontmatter.workspaceTags
    .map((tag) => `  - ${tag}`)
    .join("\n");

  return `---
title: "${frontmatter.title.replace(/"/g, '\\"')}"
summary: "${frontmatter.summary.replace(/"/g, '\\"')}"
keywords:
${keywordLines || "  - general"}
workspaceTags:
${workspaceLines || "  - global"}
recallCount: ${frontmatter.recallCount}
lastRecalledAt: ${frontmatter.lastRecalledAt ? `"${frontmatter.lastRecalledAt}"` : "null"}
lastUpdatedAt: "${frontmatter.lastUpdatedAt}"
promotionStatus: ${frontmatter.promotionStatus}
---

${body.trim()}
`;
}

function buildSkillMarkdownFromMemory(
  routePath: string,
  frontmatter: MemoryFrontmatter,
  body: string,
): string {
  const description = `${frontmatter.title} 的通用处理方法、操作流程与注意事项。`;
  const keywords =
    frontmatter.keywords.length > 0
      ? frontmatter.keywords.join("、")
      : frontmatter.title;

  return `---
name: ${toSkillName(frontmatter.title)}
description: ${description}
---

# ${frontmatter.title}

本技能应以通用、可复用的方式理解和使用，避免把它当成一次性任务记录。

## 适用场景

当任务涉及 ${keywords} 或相近问题模式时优先使用这个技能。

## 来源记忆

- 记忆路径: ${routePath}
- 召回次数: ${frontmatter.recallCount}

## 操作流程

从下面的工作方法中提炼稳定、可迁移的执行顺序、关键检查点和必要命令模式。

## 注意事项

从下面的工作方法中提炼通用的风险点、边界条件和回退办法。

## 工作方法

${body.trim()}
`;
}

function extractJsonObject(text: string): string | null {
  const fenced = text.match(/```json\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    return null;
  }

  return text.slice(start, end + 1).trim();
}

function parseGeneratedDraft(text: string): GeneratedMemoryDraft | null {
  const rawJson = extractJsonObject(text);
  if (!rawJson) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawJson) as Partial<GeneratedMemoryDraft>;
    if (
      typeof parsed.title !== "string" ||
      typeof parsed.summary !== "string" ||
      !Array.isArray(parsed.keywords) ||
      typeof parsed.target_path !== "string" ||
      typeof parsed.body_markdown !== "string"
    ) {
      return null;
    }

    return {
      title: parsed.title.trim(),
      summary: parsed.summary.trim(),
      keywords: parsed.keywords
        .filter((keyword): keyword is string => typeof keyword === "string")
        .map((keyword) => keyword.trim())
        .filter((keyword) => keyword.length > 0),
      target_path: parsed.target_path.trim(),
      body_markdown: parsed.body_markdown.trim(),
    };
  } catch {
    return null;
  }
}

function extractMessages(state: unknown): SerializedGraphMessage[] {
  if (!state || typeof state !== "object") {
    return [];
  }

  const maybeMessages = (state as { messages?: unknown }).messages;
  return Array.isArray(maybeMessages)
    ? (maybeMessages as SerializedGraphMessage[])
    : [];
}

function extractConversationTranscript(state: unknown): string {
  const messages = extractMessages(state);
  const lines: string[] = [];

  for (const message of messages) {
    const kwargs = message.kwargs ?? {};
    const classId = Array.isArray(message.id) ? message.id : [];
    const className = String(classId[classId.length - 1] ?? "");
    const content = stringifyConversationContent(kwargs.content);
    const toolCallSummary = summarizeToolCalls(kwargs.tool_calls);

    if (className.includes("Human")) {
      if (content) {
        lines.push(`User: ${content}`);
      }
      continue;
    }

    if (className.includes("Tool")) {
      const toolName = typeof kwargs.name === "string" ? kwargs.name : "tool";
      if (content) {
        lines.push(`Tool(${toolName}): ${content}`);
      }
      continue;
    }

    const printable =
      content || (toolCallSummary ? `tool_calls: ${toolCallSummary}` : "");
    if (printable) {
      lines.push(`Assistant: ${printable}`);
    }
  }

  return lines.join("\n").trim();
}

function extractRecalledMemoryPaths(state: unknown): string[] {
  const messages = extractMessages(state);
  const recalledPaths = new Set<string>();

  for (const message of messages) {
    const toolCalls = collectToolCalls(message);

    for (const toolCall of toolCalls) {
      const name = getToolCallName(toolCall);
      if (name !== "read_file") {
        continue;
      }

      const args = getToolCallArgs(toolCall);
      const filePath = getToolCallPath(args);
      const normalized = normalizeMemoryRoutePath(filePath);
      if (!normalized) {
        continue;
      }

      recalledPaths.add(normalized);
    }
  }

  return Array.from(recalledPaths);
}

async function collectMarkdownFiles(rootDir: string): Promise<string[]> {
  const files: string[] = [];

  async function walk(currentDir: string): Promise<void> {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith(".md")) {
        files.push(fullPath);
      }
    }
  }

  await walk(rootDir);
  return files;
}

async function listMemoryDocuments(
  workspacePath: string,
): Promise<MemoryDocumentRecord[]> {
  const memoryDir = await ensureWorkspaceMemoryBootstrapFiles(workspacePath);
  const filePaths = await collectMarkdownFiles(memoryDir);
  const documents = await Promise.all(
    filePaths.map(async (filePath) => {
      const markdown = await fs.readFile(filePath, "utf-8");
      const parsed = parseFrontmatter(markdown);
      const stats = await fs.stat(filePath);
      const routePath = filePathToRoutePath(workspacePath, filePath);
      return {
        filePath,
        routePath,
        body: parsed.body,
        frontmatter: {
          title: parsed.frontmatter.title ?? pathTitleFallback(routePath),
          summary: parsed.frontmatter.summary ?? "",
          keywords: parsed.frontmatter.keywords ?? [],
          workspaceTags: parsed.frontmatter.workspaceTags ?? [],
          recallCount: parsed.frontmatter.recallCount ?? 0,
          lastRecalledAt: parsed.frontmatter.lastRecalledAt ?? null,
          lastUpdatedAt:
            parsed.frontmatter.lastUpdatedAt ?? stats.mtime.toISOString(),
          promotionStatus: parsed.frontmatter.promotionStatus ?? "none",
        },
      } satisfies MemoryDocumentRecord;
    }),
  );

  return documents.sort((left, right) =>
    right.frontmatter.lastUpdatedAt.localeCompare(
      left.frontmatter.lastUpdatedAt,
    ),
  );
}

async function writeMemoryDocument(
  workspacePath: string,
  routePath: string,
  frontmatter: MemoryFrontmatter,
  body: string,
): Promise<void> {
  const filePath = routePathToFilePath(workspacePath, routePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(
    filePath,
    serializeMemoryDocument(frontmatter, body),
    "utf-8",
  );
}

async function updateRecallCounts(
  workspacePath: string,
  routePaths: string[],
): Promise<void> {
  if (routePaths.length === 0) {
    return;
  }

  const now = new Date().toISOString();

  for (const routePath of routePaths) {
    const filePath = routePathToFilePath(workspacePath, routePath);
    let markdown = "";
    try {
      markdown = await fs.readFile(filePath, "utf-8");
    } catch {
      continue;
    }

    const parsed = parseFrontmatter(markdown);
    const frontmatter: MemoryFrontmatter = {
      title: parsed.frontmatter.title ?? pathTitleFallback(routePath),
      summary: parsed.frontmatter.summary ?? "",
      keywords: parsed.frontmatter.keywords ?? [],
      workspaceTags: parsed.frontmatter.workspaceTags ?? [],
      recallCount: (parsed.frontmatter.recallCount ?? 0) + 1,
      lastRecalledAt: now,
      lastUpdatedAt: parsed.frontmatter.lastUpdatedAt ?? now,
      promotionStatus: parsed.frontmatter.promotionStatus ?? "none",
    };

    await writeMemoryDocument(
      workspacePath,
      routePath,
      frontmatter,
      parsed.body,
    );
  }
}

export async function markMemoryPromotionStatus(
  workspacePath: string,
  routePath: string,
  status: MemoryFrontmatter["promotionStatus"],
): Promise<void> {
  const filePath = routePathToFilePath(workspacePath, routePath);
  let markdown = "";
  try {
    markdown = await fs.readFile(filePath, "utf-8");
  } catch {
    return;
  }

  const parsed = parseFrontmatter(markdown);
  const now = new Date().toISOString();
  const frontmatter: MemoryFrontmatter = {
    title: parsed.frontmatter.title ?? pathTitleFallback(routePath),
    summary: parsed.frontmatter.summary ?? "",
    keywords: parsed.frontmatter.keywords ?? [],
    workspaceTags: parsed.frontmatter.workspaceTags ?? [],
    recallCount: parsed.frontmatter.recallCount ?? 0,
    lastRecalledAt: parsed.frontmatter.lastRecalledAt ?? null,
    lastUpdatedAt: now,
    promotionStatus: status,
  };

  await writeMemoryDocument(workspacePath, routePath, frontmatter, parsed.body);
}

function maybeBuildPromotionCandidate(
  workspacePath: string,
  routePath: string,
  frontmatter: MemoryFrontmatter,
  body: string,
): MemoryPromotionCandidate | null {
  const threshold = getSkillPromotionThreshold();
  const reachedThreshold = frontmatter.recallCount >= threshold;
  if (
    !reachedThreshold ||
    frontmatter.promotionStatus === "promoted" ||
    frontmatter.promotionStatus === "rejected"
  ) {
    return null;
  }

  return {
    workspacePath,
    memoryPath: routePath,
    title: frontmatter.title,
    summary: frontmatter.summary,
    skillName: toSkillName(frontmatter.title),
    skillMarkdown: buildSkillMarkdownFromMemory(routePath, frontmatter, body),
    recallCount: frontmatter.recallCount,
    threshold,
  };
}

async function generateMemoryDraft(options: {
  model: BaseChatModel;
  workspacePath: string;
  trigger: "invoke" | "resume";
  transcript: string;
  recalledMemoryPaths: string[];
  existingDocs: MemoryDocumentRecord[];
}): Promise<GeneratedMemoryDraft | null> {
  const existingSummaries = options.existingDocs.map((doc) => ({
    path: doc.routePath,
    title: doc.frontmatter.title,
    summary: doc.frontmatter.summary,
    keywords: doc.frontmatter.keywords,
  }));

  const response = await options.model.invoke([
    new SystemMessage(MEMORY_SYSTEM_PROMPT),
    new HumanMessage(
      JSON.stringify(
        {
          workspacePath: options.workspacePath,
          trigger: options.trigger,
          recalledMemoryPaths: options.recalledMemoryPaths,
          existingDocs: existingSummaries,
          transcript: options.transcript,
        },
        null,
        2,
      ),
    ),
  ]);

  const content = stringifyConversationContent(response.content);
  return parseGeneratedDraft(content);
}

export async function consolidateTaskMemory(
  options: ConsolidateTaskMemoryOptions,
): Promise<ConsolidateTaskMemoryResult> {
  const transcript = extractConversationTranscript(options.state);
  if (transcript.length === 0) {
    return { promotionCandidate: null };
  }

  const recalledMemoryPaths = extractRecalledMemoryPaths(options.state);
  await ensureWorkspaceMemoryBootstrapFiles(options.workspacePath);
  await updateRecallCounts(options.workspacePath, recalledMemoryPaths);

  const existingDocs = await listMemoryDocuments(options.workspacePath);
  const draft = await generateMemoryDraft({
    model: options.model,
    workspacePath: options.workspacePath,
    trigger: options.trigger,
    transcript,
    recalledMemoryPaths,
    existingDocs,
  });

  if (!draft) {
    logWarn(
      "Memory",
      "Skipping memory consolidation because the model response was not valid JSON",
      {
        threadId: options.threadId,
        trigger: options.trigger,
      },
    );
    return { promotionCandidate: null };
  }

  const routePath = resolveMemoryRoutePath(
    draft,
    existingDocs,
    recalledMemoryPaths,
  );
  const existing = existingDocs.find((doc) => doc.routePath === routePath);
  const now = new Date().toISOString();

  const frontmatter: MemoryFrontmatter = {
    title: draft.title,
    summary: draft.summary,
    keywords: Array.from(new Set(draft.keywords)).slice(0, 8),
    workspaceTags: Array.from(
      new Set([
        ...(existing?.frontmatter.workspaceTags ?? []),
        options.workspacePath,
      ]),
    ),
    recallCount: existing?.frontmatter.recallCount ?? 0,
    lastRecalledAt: existing?.frontmatter.lastRecalledAt ?? null,
    lastUpdatedAt: now,
    promotionStatus:
      existing?.frontmatter.promotionStatus === "promoted"
        ? "promoted"
        : existing?.frontmatter.promotionStatus === "rejected"
          ? "rejected"
          : "none",
  };

  const promotionCandidate = maybeBuildPromotionCandidate(
    options.workspacePath,
    routePath,
    frontmatter,
    draft.body_markdown,
  );
  if (promotionCandidate && frontmatter.promotionStatus !== "promoted") {
    frontmatter.promotionStatus = "candidate";
  }

  await writeMemoryDocument(
    options.workspacePath,
    routePath,
    frontmatter,
    draft.body_markdown,
  );

  logInfo("Memory", "Consolidated task memory", {
    threadId: options.threadId,
    trigger: options.trigger,
    routePath,
    recalledMemoryPaths,
  });

  return { promotionCandidate };
}

export async function listWorkspaceMemoryDocuments(
  workspacePath: string,
): Promise<MemoryDocumentSummary[]> {
  const documents = await listMemoryDocuments(workspacePath);
  return documents.map((document) => ({
    routePath: document.routePath,
    title: document.frontmatter.title,
    summary: document.frontmatter.summary,
    recallCount: document.frontmatter.recallCount,
    lastUpdatedAt: document.frontmatter.lastUpdatedAt,
    promotionStatus: document.frontmatter.promotionStatus,
  }));
}

export async function getWorkspaceMemoryDocument(
  workspacePath: string,
  routePath: string,
): Promise<MemoryDocument | null> {
  const normalizedRoutePath = normalizeMemoryRoutePath(routePath);
  if (!normalizedRoutePath) {
    return null;
  }

  const filePath = routePathToFilePath(workspacePath, normalizedRoutePath);
  try {
    const markdown = await fs.readFile(filePath, "utf-8");
    const parsed = parseFrontmatter(markdown);
    const stats = await fs.stat(filePath);
    return {
      routePath: normalizedRoutePath,
      title: parsed.frontmatter.title ?? pathTitleFallback(normalizedRoutePath),
      summary: parsed.frontmatter.summary ?? "",
      recallCount: parsed.frontmatter.recallCount ?? 0,
      lastUpdatedAt:
        parsed.frontmatter.lastUpdatedAt ?? stats.mtime.toISOString(),
      promotionStatus: parsed.frontmatter.promotionStatus ?? "none",
      body: parsed.body,
    };
  } catch {
    return null;
  }
}

export async function createMemoryPromotionCandidate(
  workspacePath: string,
  routePath: string,
): Promise<MemoryPromotionCandidate | null> {
  const normalizedRoutePath = normalizeMemoryRoutePath(routePath);
  if (!normalizedRoutePath) {
    return null;
  }

  const filePath = routePathToFilePath(workspacePath, normalizedRoutePath);
  try {
    const markdown = await fs.readFile(filePath, "utf-8");
    const parsed = parseFrontmatter(markdown);
    const frontmatter: MemoryFrontmatter = {
      title: parsed.frontmatter.title ?? pathTitleFallback(normalizedRoutePath),
      summary: parsed.frontmatter.summary ?? "",
      keywords: parsed.frontmatter.keywords ?? [],
      workspaceTags: parsed.frontmatter.workspaceTags ?? [],
      recallCount: parsed.frontmatter.recallCount ?? 0,
      lastRecalledAt: parsed.frontmatter.lastRecalledAt ?? null,
      lastUpdatedAt:
        parsed.frontmatter.lastUpdatedAt ?? new Date().toISOString(),
      promotionStatus: parsed.frontmatter.promotionStatus ?? "none",
    };

    return {
      workspacePath,
      memoryPath: normalizedRoutePath,
      title: frontmatter.title,
      summary: frontmatter.summary,
      skillName: toSkillName(frontmatter.title),
      skillMarkdown: buildSkillMarkdownFromMemory(
        normalizedRoutePath,
        frontmatter,
        parsed.body,
      ),
      recallCount: frontmatter.recallCount,
      threshold: getSkillPromotionThreshold(),
    };
  } catch {
    return null;
  }
}

export async function updateWorkspaceMemoryDocument(
  workspacePath: string,
  routePath: string,
  updates: { title: string; summary: string; body: string },
): Promise<MemoryDocumentSummary | null> {
  const normalizedRoutePath = normalizeMemoryRoutePath(routePath);
  if (!normalizedRoutePath) {
    return null;
  }

  const filePath = routePathToFilePath(workspacePath, normalizedRoutePath);
  let markdown = "";
  try {
    markdown = await fs.readFile(filePath, "utf-8");
  } catch {
    return null;
  }

  const parsed = parseFrontmatter(markdown);
  const now = new Date().toISOString();
  const title = updates.title.trim() || pathTitleFallback(normalizedRoutePath);
  const summary = updates.summary.trim();
  const frontmatter: MemoryFrontmatter = {
    title,
    summary,
    keywords: parsed.frontmatter.keywords ?? [],
    workspaceTags: parsed.frontmatter.workspaceTags ?? [],
    recallCount: parsed.frontmatter.recallCount ?? 0,
    lastRecalledAt: parsed.frontmatter.lastRecalledAt ?? null,
    lastUpdatedAt: now,
    promotionStatus: parsed.frontmatter.promotionStatus ?? "none",
  };

  await writeMemoryDocument(
    workspacePath,
    normalizedRoutePath,
    frontmatter,
    updates.body,
  );
  return {
    routePath: normalizedRoutePath,
    title,
    summary,
    recallCount: frontmatter.recallCount,
    lastUpdatedAt: frontmatter.lastUpdatedAt,
    promotionStatus: frontmatter.promotionStatus,
  };
}

async function removeEmptyMemoryDirectories(
  rootDir: string,
  startDir: string,
): Promise<void> {
  let currentDir = startDir;
  while (currentDir.startsWith(rootDir) && currentDir !== rootDir) {
    const entries = await fs.readdir(currentDir);
    if (entries.length > 0) {
      return;
    }

    await fs.rmdir(currentDir);
    currentDir = path.dirname(currentDir);
  }
}

export async function deleteWorkspaceMemoryDocument(
  workspacePath: string,
  routePath: string,
): Promise<boolean> {
  const normalizedRoutePath = normalizeMemoryRoutePath(routePath);
  if (!normalizedRoutePath) {
    return false;
  }

  const memoryRoot = getWorkspaceMemoryDir(workspacePath);
  const filePath = routePathToFilePath(workspacePath, normalizedRoutePath);
  try {
    await fs.access(filePath);
    await fs.rm(filePath);
    await removeEmptyMemoryDirectories(memoryRoot, path.dirname(filePath));
    return true;
  } catch {
    return false;
  }
}
