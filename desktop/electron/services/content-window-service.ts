import { app, BrowserWindow } from "electron"
import path from "node:path"
import { DEFAULT_WINDOW_BOUNDS } from "../../src/constants/defaults"
import { buildContentWindowSearchParams } from "../../src/lib/content-window"
import type { SynapseOpenContentWindowPayload } from "../../src/types/content"
import { getWindowIconPath } from "./app-icon-service"
import { createMainLogger } from "./log-store"

const logger = createMainLogger("content-window")
const contentWindows = new Set<BrowserWindow>()

async function loadContentWindow(
  window: BrowserWindow,
  payload: SynapseOpenContentWindowPayload,
): Promise<void> {
  const searchParams = buildContentWindowSearchParams(payload)
  const devServerUrl = process.env.VITE_DEV_SERVER_URL

  if (devServerUrl) {
    const url = new URL(devServerUrl)

    for (const [key, value] of searchParams.entries()) {
      url.searchParams.set(key, value)
    }

    await window.loadURL(url.toString())
    return
  }

  await window.loadFile(path.join(app.getAppPath(), "dist/index.html"), {
    query: Object.fromEntries(searchParams.entries()),
  })
}

const contentWindowService = {
  async openDetailWindow(payload: SynapseOpenContentWindowPayload): Promise<void> {
    const { width, height, minWidth, minHeight } = DEFAULT_WINDOW_BOUNDS
    const icon = getWindowIconPath()
    const window = new BrowserWindow({
      width,
      height,
      minWidth,
      minHeight,
      show: false,
      title: payload.title,
      ...(icon ? { icon } : {}),
      webPreferences: {
        preload: path.join(__dirname, "../preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    })

    contentWindows.add(window)

    window.webContents.on("preload-error", (_event, preloadPath, error) => {
      logger.error("Content window preload script failed.", {
        error,
        preloadPath,
      })
    })

    window.once("ready-to-show", () => {
      window.show()
    })

    window.on("closed", () => {
      contentWindows.delete(window)
    })

    await loadContentWindow(window, payload)
  },
}

export { contentWindowService }
