export async function initializePersistentMemoryStore(): Promise<void> {
  return;
}

export function getPersistentMemoryStore(): never {
  throw new Error(
    "Global persistent memory store has been replaced by workspace-scoped filesystem memories.",
  );
}