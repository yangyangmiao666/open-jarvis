import { app, shell, BrowserWindow, ipcMain, nativeImage } from "electron";
import Store from "electron-store";
import { join } from "path";
import { closeAllRuntimeResources } from "./agent/runtime";
import { registerApprovalHandlers } from "./ipc/approval";
import { registerAgentHandlers } from "./ipc/agent";
import { registerMCPHandlers } from "./ipc/mcp";
import { registerThreadHandlers } from "./ipc/threads";
import { registerModelHandlers } from "./ipc/models";
import { registerSkillHandlers } from "./ipc/skills";
import { initializeDatabase } from "./db";
import { getOpenworkDir, loadEnvFileToProcessEnv } from "./storage";
import { getMainLogPath, logError, logInfo, logWarn } from "./logger";

let mainWindow: BrowserWindow | null = null;

// Simple dev check - replaces @electron-toolkit/utils is.dev
const isDev = !app.isPackaged;
const isMac = process.platform === "darwin";
const settingsStore = new Store({
  name: "settings",
  cwd: getOpenworkDir(),
});

interface WindowBoundsState {
  x?: number;
  y?: number;
  width: number;
  height: number;
}

const DEFAULT_WINDOW_BOUNDS: WindowBoundsState = {
  width: 1440,
  height: 900,
};

function getStoredWindowBounds(): WindowBoundsState | null {
  const bounds = settingsStore.get("windowBounds");
  if (!bounds || typeof bounds !== "object") {
    return null;
  }

  const candidate = bounds as Partial<WindowBoundsState>;
  if (
    typeof candidate.width !== "number" ||
    typeof candidate.height !== "number"
  ) {
    return null;
  }

  return {
    width: Math.round(candidate.width),
    height: Math.round(candidate.height),
    ...(typeof candidate.x === "number" ? { x: Math.round(candidate.x) } : {}),
    ...(typeof candidate.y === "number" ? { y: Math.round(candidate.y) } : {}),
  };
}

function persistWindowState(window: BrowserWindow): void {
  if (window.isDestroyed() || window.isMinimized()) {
    return;
  }

  settingsStore.set("windowWasMaximized", window.isMaximized());

  if (window.isMaximized()) {
    return;
  }

  const bounds = window.getBounds();
  settingsStore.set("windowBounds", bounds);
}

function createWindow(): void {
  const storedBounds = getStoredWindowBounds();
  const launchedBefore =
    (settingsStore.get("windowLaunchedBefore", false) as boolean) ?? false;

  mainWindow = new BrowserWindow({
    title: "Open-Jarvis",
    width: storedBounds?.width ?? DEFAULT_WINDOW_BOUNDS.width,
    height: storedBounds?.height ?? DEFAULT_WINDOW_BOUNDS.height,
    ...(typeof storedBounds?.x === "number" ? { x: storedBounds.x } : {}),
    ...(typeof storedBounds?.y === "number" ? { y: storedBounds.y } : {}),
    minWidth: 1200,
    minHeight: 700,
    show: false,
    backgroundColor: "#0D0D0F",
    titleBarStyle: isMac ? "hiddenInset" : "default",
    ...(isMac
      ? {
          // 与渲染层首行 32px 标题栏内交通灯垂直对齐（hiddenInset 下由系统绘制）
          trafficLightPosition: { x: 16, y: 14 },
        }
      : {}),
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false,
    },
  });

  const syncWindowState = (): void => {
    if (mainWindow) {
      persistWindowState(mainWindow);
    }
  };

  mainWindow.on("resize", syncWindowState);
  mainWindow.on("move", syncWindowState);
  mainWindow.on("maximize", syncWindowState);
  mainWindow.on("unmaximize", syncWindowState);

  mainWindow.on("ready-to-show", () => {
    if (!launchedBefore) {
      mainWindow?.maximize();
      settingsStore.set("windowLaunchedBefore", true);
    } else if (
      (settingsStore.get("windowWasMaximized", false) as boolean) === true
    ) {
      mainWindow?.maximize();
    }
    mainWindow?.setTitle("Open-Jarvis");
    mainWindow?.show();
  });

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: "deny" };
  });

  // HMR for renderer based on electron-vite cli
  if (isDev && process.env["ELECTRON_RENDERER_URL"]) {
    mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }

  mainWindow.on("closed", () => {
    if (mainWindow) {
      persistWindowState(mainWindow);
    }
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  const loadedEnv = loadEnvFileToProcessEnv();

  // Configure global proxy dispatcher using undici ProxyAgent.
  // NODE_USE_ENV_PROXY only works if set before undici initialises (which is at
  // Node startup, before our code runs in a packaged app). Setting it in
  // process.env afterwards has no effect. Using setGlobalDispatcher is the
  // correct runtime approach and covers all fetch() calls in the main process.
  const proxyUrl =
    process.env["HTTPS_PROXY"] ||
    process.env["HTTP_PROXY"] ||
    process.env["ALL_PROXY"];
  if (proxyUrl) {
    try {
      // undici is bundled with Node 18+ (Electron main process).
      const undici = await import("undici") as {
        ProxyAgent: new (opts: { uri: string }) => object;
        setGlobalDispatcher: (dispatcher: object) => void;
      };
      const dispatcher = new undici.ProxyAgent({ uri: proxyUrl });
      undici.setGlobalDispatcher(dispatcher);
      logInfo("Main", "Global undici proxy dispatcher configured", {
        proxy: "<set>",
      });
    } catch (e) {
      logWarn("Main", "Failed to configure global proxy dispatcher", String(e));
    }
  }

  logInfo("Main", "App starting", {
    packaged: app.isPackaged,
    platform: process.platform,
    arch: process.arch,
    resourcesPath: process.resourcesPath,
    logPath: getMainLogPath(),
    loadedEnvKeys: Object.keys(loadedEnv),
    proxyEnv: {
      NODE_USE_ENV_PROXY: process.env["NODE_USE_ENV_PROXY"] ?? null,
      HTTP_PROXY: process.env["HTTP_PROXY"] ? "<set>" : null,
      HTTPS_PROXY: process.env["HTTPS_PROXY"] ? "<set>" : null,
      ALL_PROXY: process.env["ALL_PROXY"] ? "<set>" : null,
    },
  });

  if (process.platform === "darwin") {
    app.setAboutPanelOptions({
      applicationName: "Open-Jarvis",
      applicationVersion: app.getVersion(),
    });
  }

  // Set app user model id for windows
  if (process.platform === "win32") {
    app.setAppUserModelId(isDev ? process.execPath : "com.langchain.openwork");
  }

  // Set dock icon on macOS
  if (process.platform === "darwin" && app.dock) {
    const iconPath = join(__dirname, "../../resources/icon.png");
    try {
      const icon = nativeImage.createFromPath(iconPath);
      if (!icon.isEmpty()) {
        app.dock.setIcon(icon);
      }
    } catch {
      // Icon not found, use default
    }
  }

  // Default open or close DevTools by F12 in development
  if (isDev) {
    app.on("browser-window-created", (_, window) => {
      window.webContents.on("before-input-event", (event, input) => {
        if (input.key === "F12") {
          window.webContents.toggleDevTools();
          event.preventDefault();
        }
      });
    });
  }

  // Initialize database
  await initializeDatabase();
  logInfo("Main", "Database initialized and IPC registration begins");

  // Register IPC handlers
  registerApprovalHandlers(ipcMain);
  registerAgentHandlers(ipcMain);
  registerThreadHandlers(ipcMain);
  registerModelHandlers(ipcMain);
  registerMCPHandlers(ipcMain);
  registerSkillHandlers(ipcMain);

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("render-process-gone", (_event, webContents, details) => {
  logError("Main", "Renderer process gone", {
    reason: details.reason,
    exitCode: details.exitCode,
    url: webContents.getURL(),
  });
});

app.on("child-process-gone", (_event, details) => {
  logError("Main", "Child process gone", details);
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  void closeAllRuntimeResources();
});
