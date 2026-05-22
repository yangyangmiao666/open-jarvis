import type { createAgentRuntime } from "./runtime";

export type DeepAgent = Awaited<ReturnType<typeof createAgentRuntime>>;
