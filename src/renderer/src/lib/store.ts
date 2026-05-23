import { create } from "zustand";
import i18n from "@/lib/locales";
import type { Thread, ModelConfig, Provider } from "@/types";

interface AppState {
  // Threads
  threads: Thread[];
  currentThreadId: string | null;

  // Models and Providers (global, not per-thread)
  models: ModelConfig[];
  providers: Provider[];

  // Right panel state (UI state, not thread data)
  rightPanelTab: "todos" | "files" | "subagents";

  // Settings dialog state
  settingsOpen: boolean;

  // Sidebar state
  sidebarCollapsed: boolean;

  // Kanban view state
  showKanbanView: boolean;
  showSubagentsInKanban: boolean;

  /** 亮色 / 深色 */
  colorMode: "light" | "dark";
  setColorMode: (mode: "light" | "dark") => void;
  toggleColorMode: () => void;

  /** 语言 */
  language: "zh-CN" | "en-US";
  setLanguage: (lang: "zh-CN" | "en-US") => void;

  // Thread actions
  loadThreads: () => Promise<void>;
  createThread: (metadata?: Record<string, unknown>) => Promise<Thread>;
  selectThread: (threadId: string) => Promise<void>;
  deleteThread: (threadId: string) => Promise<void>;
  deleteThreads: (threadIds: string[]) => Promise<void>;
  updateThread: (threadId: string, updates: Partial<Thread>) => Promise<void>;
  generateTitleForFirstMessage: (
    threadId: string,
    content: string,
  ) => Promise<void>;

  // Model actions
  loadModels: () => Promise<void>;
  loadProviders: () => Promise<void>;
  setApiKey: (providerId: string, apiKey: string) => Promise<void>;
  deleteApiKey: (providerId: string) => Promise<void>;

  // Panel actions
  setRightPanelTab: (tab: "todos" | "files" | "subagents") => void;

  // Settings actions
  setSettingsOpen: (open: boolean) => void;

  // Sidebar actions
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;

  // Kanban actions
  setShowKanbanView: (show: boolean) => void;
  setShowSubagentsInKanban: (show: boolean) => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  // Initial state
  threads: [],
  currentThreadId: null,
  models: [],
  providers: [],
  rightPanelTab: "todos",
  settingsOpen: false,
  sidebarCollapsed: false,
  showKanbanView: false,
  showSubagentsInKanban: true,

  colorMode:
    typeof window !== "undefined"
      ? (localStorage.getItem("openwork-theme") as "light" | "dark") || "light"
      : "light",

  language:
    typeof window !== "undefined"
      ? (localStorage.getItem("openwork-language") as "zh-CN" | "en-US") ||
        "zh-CN"
      : "zh-CN",

  setColorMode: (mode) => {
    document.documentElement.classList.remove("light", "dark");
    document.documentElement.classList.add(mode);
    localStorage.setItem("openwork-theme", mode);
    set({ colorMode: mode });
  },

  toggleColorMode: () => {
    const next = get().colorMode === "dark" ? "light" : "dark";
    get().setColorMode(next);
  },

  setLanguage: (lang) => {
    localStorage.setItem("openwork-language", lang);
    i18n.changeLanguage(lang);
    set({ language: lang });
  },

  // Thread actions
  loadThreads: async () => {
    const threads = await window.api.threads.list();
    set({ threads });

    // Select first thread if none selected
    if (!get().currentThreadId && threads.length > 0) {
      await get().selectThread(threads[0].thread_id);
    }
  },

  createThread: async (metadata?: Record<string, unknown>) => {
    const merged: Record<string, unknown> = { ...metadata };
    const fromId = get().currentThreadId;
    if (fromId) {
      try {
        const from = await window.api.threads.get(fromId);
        const prev = from?.metadata as Record<string, unknown> | undefined;
        if (prev) {
          if (merged.model === undefined && typeof prev.model === "string") {
            merged.model = prev.model;
          }
          if (
            merged.workspacePath === undefined &&
            typeof prev.workspacePath === "string"
          ) {
            merged.workspacePath = prev.workspacePath;
          }
          if (
            merged.approvalMode === undefined &&
            (prev.approvalMode === "manual" || prev.approvalMode === "auto")
          ) {
            merged.approvalMode = prev.approvalMode;
          }
        }
      } catch {
        /* ignore */
      }
    }
    const thread = await window.api.threads.create(merged);
    set((state) => ({
      threads: [thread, ...state.threads],
      currentThreadId: thread.thread_id,
      showKanbanView: false,
    }));
    return thread;
  },

  selectThread: async (threadId: string) => {
    // Just update currentThreadId - ThreadContext handles per-thread state
    // Also close kanban view when selecting a thread
    set({ currentThreadId: threadId, showKanbanView: false });
  },

  deleteThread: async (threadId: string) => {
    await get().deleteThreads([threadId]);
  },

  deleteThreads: async (threadIds: string[]) => {
    if (threadIds.length === 0) return;
    const idSet = new Set(threadIds);
    const previousState = get();
    const currentThreadId = previousState.currentThreadId;
    let replacementMetadata: Record<string, unknown> | undefined;

    if (currentThreadId) {
      try {
        const currentThread = await window.api.threads.get(currentThreadId);
        const metadata = currentThread?.metadata;
        if (metadata) {
          replacementMetadata = {
            ...(typeof metadata.model === "string"
              ? { model: metadata.model }
              : {}),
            ...(typeof metadata.workspacePath === "string"
              ? { workspacePath: metadata.workspacePath }
              : {}),
            ...(metadata.approvalMode === "manual" ||
            metadata.approvalMode === "auto"
              ? { approvalMode: metadata.approvalMode }
              : {}),
          };
        }
      } catch {
        /* ignore */
      }
    }

    try {
      if (threadIds.length === 1) {
        await window.api.threads.delete(threadIds[0]);
      } else {
        await window.api.threads.deleteMany(threadIds);
      }

      const remainingThreads = previousState.threads.filter(
        (thread) => !idSet.has(thread.thread_id),
      );
      const wasCurrent =
        previousState.currentThreadId && idSet.has(previousState.currentThreadId);

      if (remainingThreads.length === 0) {
        const replacementThread = await window.api.threads.create({
          ...replacementMetadata,
          title: i18n.t('common:newSessionWithDate', { date: new Date().toLocaleDateString() }),
        });
        set({
          threads: [replacementThread],
          currentThreadId: replacementThread.thread_id,
          showKanbanView: false,
        });
        return;
      }

      set({
        threads: remainingThreads,
        currentThreadId: wasCurrent
          ? remainingThreads[0]?.thread_id || null
          : previousState.currentThreadId,
      });
    } catch (error) {
      console.error("[Store] Failed to delete threads:", error);
    }
  },

  updateThread: async (threadId: string, updates: Partial<Thread>) => {
    const updated = await window.api.threads.update(threadId, updates);
    set((state) => ({
      threads: state.threads.map((t) =>
        t.thread_id === threadId ? updated : t,
      ),
    }));
  },

  generateTitleForFirstMessage: async (threadId: string, content: string) => {
    try {
      const generatedTitle = await window.api.threads.generateTitle(content);
      await get().updateThread(threadId, { title: generatedTitle });
    } catch (error) {
      console.error("[Store] Failed to generate title:", error);
    }
  },

  // Model actions
  loadModels: async () => {
    const models = await window.api.models.list();
    set({ models });
  },

  loadProviders: async () => {
    const providers = await window.api.models.listProviders();
    set({ providers });
  },

  setApiKey: async (providerId: string, apiKey: string) => {
    console.log("[Store] setApiKey called:", {
      providerId,
      keyLength: apiKey.length,
    });
    try {
      await window.api.models.setApiKey(providerId, apiKey);
      console.log("[Store] API key saved via IPC");
      // Reload providers and models to update availability
      await get().loadProviders();
      await get().loadModels();
      console.log("[Store] Providers and models reloaded");
    } catch (e) {
      console.error("[Store] Failed to set API key:", e);
      throw e;
    }
  },

  deleteApiKey: async (providerId: string) => {
    await window.api.models.deleteApiKey(providerId);
    // Reload providers and models to update availability
    await get().loadProviders();
    await get().loadModels();
  },

  // Panel actions
  setRightPanelTab: (tab: "todos" | "files" | "subagents") => {
    set({ rightPanelTab: tab });
  },

  // Settings actions
  setSettingsOpen: (open: boolean) => {
    set({ settingsOpen: open });
  },

  // Sidebar actions
  toggleSidebar: () => {
    set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed }));
  },

  setSidebarCollapsed: (collapsed: boolean) => {
    set({ sidebarCollapsed: collapsed });
  },

  // Kanban actions
  setShowKanbanView: (show: boolean) => {
    if (show) {
      set({ showKanbanView: true, currentThreadId: null });
    } else {
      set({ showKanbanView: false });
    }
  },

  setShowSubagentsInKanban: (show: boolean) => {
    set({ showSubagentsInKanban: show });
  },
}));
