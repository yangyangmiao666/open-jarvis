import { app } from "electron";
import Store from "electron-store";
import * as fs from "fs/promises";
import * as path from "path";
import { getOpenworkDir } from "./storage";
import { getProxyConfig, setProxyConfig } from "./storage";
import { getOpenAICompatibleProfiles, upsertOpenAICompatibleProfile } from "./openai-compatible-profiles";
import { getMCPServers, upsertMCPServer } from "./mcp-config";
import type {
  GlobalConfigExport,
  GlobalConfigImportMode,
  GlobalConfigImportResult,
  OpenAICompatibleProfile,
} from "./types";

const store = new Store({
  name: "settings",
  cwd: getOpenworkDir(),
});

function getSkillsRoot(): string {
  return path.join(getOpenworkDir(), "skills");
}

export async function exportGlobalConfig(
  includeApiKeys: boolean,
): Promise<GlobalConfigExport> {
  const profiles = getOpenAICompatibleProfiles();
  const sanitizedProfiles: OpenAICompatibleProfile[] = includeApiKeys
    ? profiles
    : profiles.map((p) => ({ ...p, apiKey: "" }));

  const mcpServers = getMCPServers();
  const defaultModel = (store.get("defaultModel", "") as string) ?? "";
  const enabledMcpServerIds =
    (store.get("enabledMcpServerIds", []) as string[]) ?? [];

  const proxyConfig = getProxyConfig();

  // Read skills from filesystem
  const skillsRoot = getSkillsRoot();
  const skills: { name: string; markdown: string }[] = [];
  try {
    await fs.mkdir(skillsRoot, { recursive: true });
    const entries = await fs.readdir(skillsRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillMdPath = path.join(skillsRoot, entry.name, "SKILL.md");
      try {
        const content = await fs.readFile(skillMdPath, "utf-8");
        skills.push({ name: entry.name, markdown: content });
      } catch {
        // SKILL.md might not exist; skip
      }
    }
  } catch {
    // skills dir might not exist; skip
  }

  return {
    meta: {
      version: 1,
      exportedAt: new Date().toISOString(),
      appVersion: app.getVersion(),
      includeApiKeys,
    },
    openaiCompatibleProfiles: sanitizedProfiles,
    defaultModel,
    mcpServers,
    enabledMcpServerIds,
    proxyConfig,
    skills,
  };
}

export async function importGlobalConfig(
  data: GlobalConfigExport,
  mode: GlobalConfigImportMode,
): Promise<GlobalConfigImportResult> {
  if (data.meta?.version !== 1) {
    return {
      success: false,
      error: `Unsupported config version: ${data.meta?.version}`,
      profilesImported: 0,
      serversImported: 0,
      skillsImported: 0,
      proxyUpdated: false,
    };
  }

  let profilesImported = 0;
  let serversImported = 0;
  let skillsImported = 0;
  let proxyUpdated = false;

  // --- Replace mode: clear everything first ---
  if (mode === "replace") {
    store.set("openaiCompatibleProfiles", []);
    store.set("mcpServers", []);
    store.set("enabledMcpServerIds", []);
    store.set("defaultModel", "");

    // Clear proxy
    setProxyConfig({ httpProxy: "", httpsProxy: "", allProxy: "" });

    // Clear skills directory
    const skillsRoot = getSkillsRoot();
    try {
      const entries = await fs.readdir(skillsRoot, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          await fs.rm(path.join(skillsRoot, entry.name), {
            recursive: true,
            force: true,
          });
        }
      }
    } catch {
      // skills dir might not exist
    }
  }

  // --- Import profiles ---
  if (Array.isArray(data.openaiCompatibleProfiles)) {
    for (const profile of data.openaiCompatibleProfiles) {
      try {
        upsertOpenAICompatibleProfile(profile);
        profilesImported++;
      } catch {
        // skip invalid profiles
      }
    }
  }

  // --- Import MCP servers ---
  if (Array.isArray(data.mcpServers)) {
    for (const server of data.mcpServers) {
      try {
        upsertMCPServer(server);
        serversImported++;
      } catch {
        // skip invalid servers
      }
    }
  }

  // --- Import enabled MCP IDs ---
  if (Array.isArray(data.enabledMcpServerIds)) {
    if (mode === "merge") {
      const existing =
        (store.get("enabledMcpServerIds", []) as string[]) ?? [];
      const merged = Array.from(
        new Set([...existing, ...data.enabledMcpServerIds]),
      );
      // Only keep IDs that reference existing servers
      const allServers = getMCPServers();
      const validIds = new Set(allServers.map((s) => s.id));
      const filtered = merged.filter((id) => validIds.has(id));
      store.set("enabledMcpServerIds", filtered);
    } else {
      // In replace mode, just set the imported IDs (validate against servers)
      const allServers = getMCPServers();
      const validIds = new Set(allServers.map((s) => s.id));
      const filtered = data.enabledMcpServerIds.filter((id) =>
        validIds.has(id),
      );
      store.set("enabledMcpServerIds", filtered);
    }
  }

  // --- Import default model ---
  if (data.defaultModel) {
    const allProfiles = getOpenAICompatibleProfiles();
    const validModelIds = allProfiles.map((p) => `oac:${p.id}`);
    if (validModelIds.includes(data.defaultModel)) {
      store.set("defaultModel", data.defaultModel);
    }
  }

  // --- Import proxy config ---
  if (data.proxyConfig) {
    setProxyConfig(data.proxyConfig);
    proxyUpdated = true;
  }

  // --- Import skills ---
  if (Array.isArray(data.skills)) {
    const skillsRoot = getSkillsRoot();
    await fs.mkdir(skillsRoot, { recursive: true });

    for (const skill of data.skills) {
      if (!skill.name || skill.name.includes("..") || skill.name.includes("/") || skill.name.includes("\\")) {
        continue;
      }
      const skillDir = path.join(skillsRoot, skill.name);
      await fs.mkdir(skillDir, { recursive: true });
      const skillMdPath = path.join(skillDir, "SKILL.md");
      await fs.writeFile(skillMdPath, skill.markdown ?? "", "utf-8");
      skillsImported++;
    }
  }

  return {
    success: true,
    profilesImported,
    serversImported,
    skillsImported,
    proxyUpdated,
  };
}