import type { IpcMain } from "electron";
import { applyGlobalProxyDispatcher, getProxyConfigFromEnv } from "../proxy-config";
import { getProxyConfig, setProxyConfig } from "../storage";
import type { ProxyConfig } from "../types";

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
}