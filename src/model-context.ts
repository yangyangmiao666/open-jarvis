const DEFAULT_CONTEXT_WINDOW = 128_000;

function normalizeConfiguredContextWindow(
  contextWindow?: number,
): number | undefined {
  if (typeof contextWindow !== "number" || !Number.isFinite(contextWindow)) {
    return undefined;
  }

  const normalized = Math.floor(contextWindow);
  return normalized > 0 ? normalized : undefined;
}

export function getContextWindowForModel(
  modelId: string,
  configuredContextWindow?: number,
): number {
  const configured = normalizeConfiguredContextWindow(configuredContextWindow);
  if (configured !== undefined) {
    return configured;
  }

  const normalizedModelId = modelId.toLowerCase();

  if (normalizedModelId.startsWith("claude")) return 200_000;

  if (normalizedModelId.startsWith("gpt-5")) return 400_000;
  if (normalizedModelId.startsWith("gpt-4.1")) return 1_000_000;
  if (
    normalizedModelId.startsWith("gpt-4o") ||
    normalizedModelId.startsWith("gpt-4-turbo")
  ) {
    return 128_000;
  }
  if (normalizedModelId === "gpt-4") return 8_192;

  if (
    normalizedModelId.startsWith("o1") ||
    normalizedModelId.startsWith("o3") ||
    normalizedModelId.startsWith("o4")
  ) {
    return 200_000;
  }

  if (
    normalizedModelId.startsWith("gemini-3-pro") ||
    normalizedModelId.startsWith("gemini-2.5-pro") ||
    normalizedModelId.startsWith("gemini-1.5-pro")
  ) {
    return 2_000_000;
  }
  if (normalizedModelId.startsWith("gemini")) return 1_000_000;

  // Common OpenAI-compatible families. These remain fallbacks and can be
  // overridden per profile with an explicit contextWindow value.
  if (normalizedModelId.includes("deepseek")) return 64_000;
  if (normalizedModelId.includes("qwen")) return 131_072;
  if (
    normalizedModelId.includes("glm") ||
    normalizedModelId.includes("chatglm")
  ) {
    return 128_000;
  }
  if (
    normalizedModelId.includes("minimax") ||
    normalizedModelId.includes("abab")
  ) {
    return 1_000_000;
  }

  return DEFAULT_CONTEXT_WINDOW;
}

export function getConfiguredContextWindow(
  contextWindow?: number,
): number | undefined {
  return normalizeConfiguredContextWindow(contextWindow);
}