import { logInfo, logWarn } from "./logger";
import type { ProxyConfig } from "./types";

function normalizeProxyValue(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

export function getProxyConfigFromEnv(): ProxyConfig {
  return {
    httpProxy: normalizeProxyValue(process.env["HTTP_PROXY"]),
    httpsProxy: normalizeProxyValue(process.env["HTTPS_PROXY"]),
    allProxy: normalizeProxyValue(process.env["ALL_PROXY"]),
  };
}

export async function applyGlobalProxyDispatcher(
  config: ProxyConfig,
): Promise<void> {
  try {
    const undici = (await import("undici")) as {
      Agent: new () => object;
      ProxyAgent: new (opts: { uri: string }) => object;
      setGlobalDispatcher: (dispatcher: object) => void;
    };
    const proxyUrl =
      normalizeProxyValue(config.httpsProxy) ||
      normalizeProxyValue(config.httpProxy) ||
      normalizeProxyValue(config.allProxy);

    if (proxyUrl) {
      undici.setGlobalDispatcher(new undici.ProxyAgent({ uri: proxyUrl }));
      logInfo("Main", "Global undici proxy dispatcher configured", {
        proxy: "<set>",
      });
      return;
    }

    undici.setGlobalDispatcher(new undici.Agent());
    logInfo("Main", "Global undici proxy dispatcher reset", {
      proxy: null,
    });
  } catch (error) {
    logWarn(
      "Main",
      "Failed to configure global proxy dispatcher",
      String(error),
    );
  }
}