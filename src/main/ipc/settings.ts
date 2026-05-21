import type { IpcMain } from "electron";
import { BrowserWindow, dialog } from "electron";
import * as fs from "fs/promises";
import { applyGlobalProxyDispatcher, getProxyConfigFromEnv } from "../proxy-config";
import { getProxyConfig, setProxyConfig } from "../storage";
import { exportGlobalConfig, importGlobalConfig } from "../global-config";
import type { ProxyConfig, GlobalConfigExport, GlobalConfigImportMode } from "../types";

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
        title: "导出全局配置",
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
        title: "导入全局配置",
        filters: [{ name: "JSON", extensions: ["json"] }],
        properties: ["openFile"],
      });

      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, error: "cancelled" };
      }

      try {
        const raw = await fs.readFile(result.filePaths[0], "utf-8");
        const data = JSON.parse(raw);
        const importResult = await importGlobalConfig(data as GlobalConfigExport, mode);
        return importResult;
      } catch (e) {
        return {
          success: false,
          error: e instanceof Error ? e.message : "Import failed",
        };
      }
    },
  );
}