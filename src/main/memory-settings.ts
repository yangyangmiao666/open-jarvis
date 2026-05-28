import Store from "electron-store";
import type { MemorySettings } from "./types";

const memorySettingsStore = new Store<{ memorySettings?: MemorySettings }>({
  name: "settings",
});

export const DEFAULT_SKILL_PROMOTION_RECALL_THRESHOLD = 3;
export const DEFAULT_MEMORY_CONSOLIDATION_ENABLED = true;

export function getMemorySettings(): MemorySettings {
  const stored = memorySettingsStore.get("memorySettings");
  return {
    memoryConsolidationEnabled:
      stored?.memoryConsolidationEnabled ??
      DEFAULT_MEMORY_CONSOLIDATION_ENABLED,
    skillPromotionRecallThreshold:
      stored?.skillPromotionRecallThreshold ??
      DEFAULT_SKILL_PROMOTION_RECALL_THRESHOLD,
  };
}

export function setMemorySettings(
  next: Partial<MemorySettings>,
): MemorySettings {
  const current = getMemorySettings();
  const merged: MemorySettings = {
    ...current,
    ...next,
    memoryConsolidationEnabled:
      next.memoryConsolidationEnabled ?? current.memoryConsolidationEnabled,
    skillPromotionRecallThreshold: Math.max(
      1,
      Math.min(
        50,
        Math.floor(
          next.skillPromotionRecallThreshold ??
            current.skillPromotionRecallThreshold,
        ),
      ),
    ),
  };

  memorySettingsStore.set("memorySettings", merged);
  return merged;
}

export function getSkillPromotionThreshold(): number {
  return getMemorySettings().skillPromotionRecallThreshold;
}

export function isMemoryConsolidationEnabled(): boolean {
  return getMemorySettings().memoryConsolidationEnabled;
}