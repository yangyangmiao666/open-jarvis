import { app, shell, BrowserWindow, ipcMain, nativeImage } from "electron"
import { join } from "path"
import { registerAgentHandlers } from "./ipc/agent"
import { registerThreadHandlers } from "./ipc/threads"
import { registerModelHandlers } from "./ipc/models"
import { registerSkillHandlers } from "./ipc/skills"
import { initializeDatabase } from "./db"

let mainWindow: BrowserWindow | null = null

// Simple dev check - replaces @electron-toolkit/utils is.dev
const isDev = !app.isPackaged
const isMac = process.platform === "darwin"

function createWindow(): void {
  mainWindow = new BrowserWindow({
    title: "Open-Jarvis",
    width: 1440,
    height: 900,
    minWidth: 1200,
    minHeight: 700,
    show: false,
    backgroundColor: "#0D0D0F",
    titleBarStyle: isMac ? "hiddenInset" : "default",
    ...(isMac
      ? {
          // 与渲染层首行 32px 标题栏内交通灯垂直对齐（hiddenInset 下由系统绘制）
          trafficLightPosition: { x: 16, y: 14 }
        }
      : {}),
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false
    }
  })

  mainWindow.on("ready-to-show", () => {
    mainWindow?.setTitle("Open-Jarvis")
    mainWindow?.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: "deny" }
  })

  // HMR for renderer based on electron-vite cli
  if (isDev && process.env["ELECTRON_RENDERER_URL"]) {
    mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"])
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"))
  }

  mainWindow.on("closed", () => {
    mainWindow = null
  })
}

app.whenReady().then(async () => {
  if (process.platform === "darwin") {
    app.setAboutPanelOptions({
      applicationName: "Open-Jarvis",
      applicationVersion: app.getVersion()
    })
  }

  // Set app user model id for windows
  if (process.platform === "win32") {
    app.setAppUserModelId(isDev ? process.execPath : "com.langchain.openwork")
  }

  // Set dock icon on macOS
  if (process.platform === "darwin" && app.dock) {
    const iconPath = join(__dirname, "../../resources/icon.png")
    try {
      const icon = nativeImage.createFromPath(iconPath)
      if (!icon.isEmpty()) {
        app.dock.setIcon(icon)
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
          window.webContents.toggleDevTools()
          event.preventDefault()
        }
      })
    })
  }

  // Initialize database
  await initializeDatabase()

  // Register IPC handlers
  registerAgentHandlers(ipcMain)
  registerThreadHandlers(ipcMain)
  registerModelHandlers(ipcMain)
  registerSkillHandlers(ipcMain)

  createWindow()

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit()
  }
})
