import * as fs from "node:fs/promises";
import path from "node:path";
import {
  BaseStore,
  type Item,
  type MatchCondition,
  type Operation,
  type OperationResults,
  type SearchItem,
} from "@langchain/langgraph-checkpoint";

interface PersistedItem {
  key: string;
  namespace: string[];
  value: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

interface PersistedStoreShape {
  version: 1;
  items: PersistedItem[];
}

function makeCompositeKey(namespace: string[], key: string): string {
  return `${namespace.join("\u001f")}\u001e${key}`;
}

function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function matchesNamespacePrefix(namespace: string[], prefix: string[]): boolean {
  if (prefix.length > namespace.length) {
    return false;
  }

  return prefix.every((segment, index) => namespace[index] === segment);
}

function comparePrimitive(left: unknown, operator: string, right: unknown): boolean {
  switch (operator) {
    case "$eq":
      return left === right;
    case "$ne":
      return left !== right;
    case "$gt":
      return typeof left === "number" && typeof right === "number" && left > right;
    case "$gte":
      return typeof left === "number" && typeof right === "number" && left >= right;
    case "$lt":
      return typeof left === "number" && typeof right === "number" && left < right;
    case "$lte":
      return typeof left === "number" && typeof right === "number" && left <= right;
    default:
      return false;
  }
}

function matchesFilter(value: Record<string, unknown>, filter?: Record<string, unknown>): boolean {
  if (!filter) {
    return true;
  }

  return Object.entries(filter).every(([field, expected]) => {
    const actual = value[field];

    if (
      expected &&
      typeof expected === "object" &&
      !Array.isArray(expected)
    ) {
      return Object.entries(expected as Record<string, unknown>).every(
        ([operator, operand]) => comparePrimitive(actual, operator, operand),
      );
    }

    return actual === expected;
  });
}

function matchCondition(namespace: string[], condition: MatchCondition): boolean {
  const filtered = condition.path.filter((segment) => segment !== "*");
  if (condition.matchType === "prefix") {
    return matchesNamespacePrefix(namespace, filtered as string[]);
  }

  if (filtered.length > namespace.length) {
    return false;
  }

  const offset = namespace.length - filtered.length;
  return (filtered as string[]).every(
    (segment, index) => namespace[offset + index] === segment,
  );
}

function scoreSearch(value: Record<string, unknown>, query?: string): number | undefined {
  if (!query) {
    return undefined;
  }

  const haystack = JSON.stringify(value).toLowerCase();
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return undefined;
  }

  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }

  return count;
}

export class JsonFileStore extends BaseStore {
  private readonly filePath: string;

  private loaded = false;

  private readonly items = new Map<string, PersistedItem>();

  private writeChain: Promise<void> = Promise.resolve();

  constructor(filePath: string) {
    super();
    this.filePath = filePath;
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) {
      return;
    }

    this.loaded = true;

    try {
      const raw = await fs.readFile(this.filePath, "utf-8");
      const parsed = JSON.parse(raw) as PersistedStoreShape;
      if (parsed.version !== 1 || !Array.isArray(parsed.items)) {
        return;
      }

      for (const item of parsed.items) {
        this.items.set(makeCompositeKey(item.namespace, item.key), item);
      }
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code !== "ENOENT") {
        throw error;
      }
    }
  }

  private toItem(record: PersistedItem): Item {
    return {
      key: record.key,
      namespace: [...record.namespace],
      value: cloneValue(record.value),
      createdAt: new Date(record.createdAt),
      updatedAt: new Date(record.updatedAt),
    };
  }

  private async persist(): Promise<void> {
    const payload: PersistedStoreShape = {
      version: 1,
      items: Array.from(this.items.values()),
    };

    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(payload, null, 2), "utf-8");
  }

  async batch<Op extends Operation[]>(operations: Op): Promise<OperationResults<Op>> {
    await this.ensureLoaded();
    const results: unknown[] = [];
    let needsPersist = false;

    for (const operation of operations) {
      if ("key" in operation && "namespace" in operation && "value" in operation) {
        const compositeKey = makeCompositeKey(operation.namespace, operation.key);
        if (operation.value === null) {
          this.items.delete(compositeKey);
        } else {
          const existing = this.items.get(compositeKey);
          const now = new Date().toISOString();
          this.items.set(compositeKey, {
            key: operation.key,
            namespace: [...operation.namespace],
            value: cloneValue(operation.value),
            createdAt: existing?.createdAt ?? now,
            updatedAt: now,
          });
        }

        needsPersist = true;
        results.push(undefined);
        continue;
      }

      if ("key" in operation && "namespace" in operation) {
        const compositeKey = makeCompositeKey(operation.namespace, operation.key);
        const record = this.items.get(compositeKey);
        results.push(record ? this.toItem(record) : null);
        continue;
      }

      if ("namespacePrefix" in operation) {
        const filtered = Array.from(this.items.values())
          .filter((item) => matchesNamespacePrefix(item.namespace, operation.namespacePrefix))
          .filter((item) => matchesFilter(item.value, operation.filter))
          .map((item) => {
            const score = scoreSearch(item.value, operation.query);
            const base: SearchItem = this.toItem(item);
            return score !== undefined ? { ...base, score } : base;
          });

        if (operation.query) {
          filtered.sort((left, right) => (right.score ?? 0) - (left.score ?? 0));
        } else {
          filtered.sort(
            (left, right) => right.updatedAt.getTime() - left.updatedAt.getTime(),
          );
        }

        const offset = operation.offset ?? 0;
        const limit = operation.limit ?? 10;
        results.push(filtered.slice(offset, offset + limit));
        continue;
      }

      const namespaces = new Map<string, string[]>();
      for (const item of this.items.values()) {
        let namespace = [...item.namespace];

        if (operation.maxDepth && operation.maxDepth > 0) {
          namespace = namespace.slice(0, operation.maxDepth);
        }

        if (operation.matchConditions?.length) {
          const allMatch = operation.matchConditions.every((condition) =>
            matchCondition(namespace, condition),
          );
          if (!allMatch) {
            continue;
          }
        }

        namespaces.set(namespace.join("\u001f"), namespace);
      }

      const offset = operation.offset ?? 0;
      const limit = operation.limit ?? 100;
      results.push(
        Array.from(namespaces.values())
          .sort((left, right) => left.join("/").localeCompare(right.join("/")))
          .slice(offset, offset + limit),
      );
    }

    if (needsPersist) {
      this.writeChain = this.writeChain.then(() => this.persist());
      await this.writeChain;
    }

    return results as OperationResults<Op>;
  }

  override async start(): Promise<void> {
    await this.ensureLoaded();
  }
}