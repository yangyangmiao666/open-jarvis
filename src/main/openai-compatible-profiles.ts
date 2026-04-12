import Store from "electron-store";
import { randomUUID } from "crypto";
import { getOpenworkDir } from "./storage";
import type { OpenAICompatibleProfile } from "./types";

const store = new Store({
  name: "settings",
  cwd: getOpenworkDir(),
});

const KEY = "openaiCompatibleProfiles";

export function getOpenAICompatibleProfiles(): OpenAICompatibleProfile[] {
  const raw = store.get(KEY, []) as OpenAICompatibleProfile[];
  return Array.isArray(raw) ? raw : [];
}

export function getOpenAICompatibleProfileByModelId(
  modelId: string,
): OpenAICompatibleProfile | undefined {
  if (!modelId.startsWith("oac:")) return undefined;
  const id = modelId.slice(4);
  return getOpenAICompatibleProfiles().find((p) => p.id === id);
}

export function upsertOpenAICompatibleProfile(
  profile: Omit<OpenAICompatibleProfile, "id"> & { id?: string },
): OpenAICompatibleProfile {
  const profiles = getOpenAICompatibleProfiles();
  const id = profile.id ?? randomUUID();
  const modelTrim = profile.model.trim();
  const nameTrim = profile.name.trim();
  const next: OpenAICompatibleProfile = {
    id,
    name: nameTrim || modelTrim || "自定义模型",
    baseUrl: profile.baseUrl.trim(),
    apiKey: profile.apiKey,
    model: modelTrim,
  };
  const idx = profiles.findIndex((p) => p.id === id);
  if (idx >= 0) {
    profiles[idx] = next;
  } else {
    profiles.push(next);
  }
  store.set(KEY, profiles);
  return next;
}

export function deleteOpenAICompatibleProfile(id: string): void {
  const profiles = getOpenAICompatibleProfiles().filter((p) => p.id !== id);
  store.set(KEY, profiles);
}
