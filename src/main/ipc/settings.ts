import type {IpcMain} from "electron";
import {BrowserWindow, Notification, dialog} from "electron";
import * as fs from "fs/promises";
import {applyGlobalProxyDispatcher, getProxyConfigFromEnv} from "../proxy-config";
import {getProxyConfig, setProxyConfig} from "../storage";
import {exportGlobalConfig, importGlobalConfig} from "../global-config";
import type {GlobalConfigExport, GlobalConfigImportMode, ProxyConfig} from "../types";
import {getEmbeddedToolingRuntime} from "../tooling";

export function registerSettingsHandlers(ipcMain: IpcMain): void {
  ipcMain.handle("settings:getProxyConfig", (): ProxyConfig => {
    return getProxyConfig();
  });

  ipcMain.handle(
    "settings:setProxyConfig",
    async (_event, config: ProxyConfig): Promise<ProxyConfig> => {
      const nextConfig = setProxyConfig(config);
      await applyGlobalProxyDispatcher(getProxyConfigFromEnv());
      return nextConfig;
    },
  );

  ipcMain.handle(
    "settings:exportGlobalConfigToFile",
    async (event, options: { includeApiKeys: boolean }): Promise<{
      success: boolean;
      filePath?: string;
      error?: string;
    }> => {
      const window = BrowserWindow.fromWebContents(event.sender);
      if (!window) {
        return { success: false, error: "No window" };
      }

      const result = await dialog.showSaveDialog(window, {
        title: "Export Configuration",
        defaultPath: `open-jarvis-config-${new Date().toISOString().slice(0, 10)}.json`,
        filters: [{ name: "JSON", extensions: ["json"] }],
      });

      if (result.canceled || !result.filePath) {
        return { success: false, error: "cancelled" };
      }

      try {
        const config = await exportGlobalConfig(options.includeApiKeys);
        await fs.writeFile(result.filePath, JSON.stringify(config, null, 2), "utf-8");
        return { success: true, filePath: result.filePath };
      } catch (e) {
        return {
          success: false,
          error: e instanceof Error ? e.message : "Export failed",
        };
      }
    },
  );

  ipcMain.handle(
    "settings:importGlobalConfigFromFile",
    async (event, mode: GlobalConfigImportMode): Promise<{
      success: boolean;
      error?: string;
      profilesImported?: number;
      serversImported?: number;
      skillsImported?: number;
      proxyUpdated?: boolean;
    }> => {
      const window = BrowserWindow.fromWebContents(event.sender);
      if (!window) {
        return { success: false, error: "No window" };
      }

      const result = await dialog.showOpenDialog(window, {
        title: "Import Configuration",
        filters: [{ name: "JSON", extensions: ["json"] }],
        properties: ["openFile"],
      });

      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, error: "cancelled" };
      }

      try {
        const raw = await fs.readFile(result.filePaths[0], "utf-8");
        const data = JSON.parse(raw);
        return await importGlobalConfig(data as GlobalConfigExport, mode);
      } catch (e) {
        return {
          success: false,
          error: e instanceof Error ? e.message : "Import failed",
        };
      }
    },
  );

  ipcMain.handle("settings:getToolingVersions", (): { bun: string | null; uv: string | null; python: string | null } => {
    const runtime = getEmbeddedToolingRuntime();
    if (!runtime) {
      return { bun: null, uv: null, python: null };
    }
    return {
      bun: runtime.manifest.bun.version,
      uv: runtime.manifest.uv.version,
      python: runtime.manifest.python.version,
    };
  });

  ipcMain.handle(
    "settings:showDesktopNotification",
    async (
      event,
      payload: { title: string; body: string },
    ): Promise<{ success: boolean; error?: string }> => {
      if (!Notification.isSupported()) {
        return { success: false, error: "Desktop notifications are not supported" };
      }

      try {
        const parentWindow = BrowserWindow.fromWebContents(event.sender);
        const notification = new Notification({
          title: payload.title,
          body: payload.body,
          silent: true,
        });

        notification.on("click", () => {
          if (!parentWindow || parentWindow.isDestroyed()) {
            return;
          }

          if (parentWindow.isMinimized()) {
            parentWindow.restore();
          }
          parentWindow.show();
          parentWindow.focus();
        });

        notification.show();
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Failed to show notification",
        };
      }
    },
  );
}