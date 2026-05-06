import { BrowserWindow, session } from "electron"
import { createMainLogger } from "../../log-store"

const logger = createMainLogger("cursor-login-window")

const CURSOR_LOGIN_URL = "https://cursor.com/login"
const CURSOR_COOKIE_NAME = "WorkosCursorSessionToken"
const CURSOR_DOMAIN = "cursor.com"

export interface CursorLoginResult {
  sessionToken: string | null
  cancelled: boolean
}

export function openCursorLoginWindow(parentWindow?: BrowserWindow | null): Promise<CursorLoginResult> {
  return new Promise((resolve) => {
    const partition = `cursor-login-${Date.now()}`
    const ses = session.fromPartition(partition, { cache: false })

    const win = new BrowserWindow({
      width: 800,
      height: 640,
      title: "连接 Cursor",
      parent: parentWindow ?? undefined,
      modal: false,
      show: false,
      webPreferences: {
        partition,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    })

    win.setMenuBarVisibility(false)
    let resolved = false

    const timeout = setTimeout(() => {
      logger.info("Cursor login window timed out")
      finish(null, true)
    }, 5 * 60 * 1000)

    function finish(token: string | null, cancelled: boolean) {
      if (resolved) return
      resolved = true
      clearTimeout(timeout)
      resolve({ sessionToken: token, cancelled })
      if (!win.isDestroyed()) win.close()
    }

    ses.cookies.on("changed", (_event, cookie, _cause, removed) => {
      if (removed) return
      if (cookie.name !== CURSOR_COOKIE_NAME) return
      if (!cookie.domain?.includes(CURSOR_DOMAIN)) return
      logger.info("Cursor session cookie detected")
      finish(cookie.value, false)
    })

    win.on("closed", () => {
      finish(null, true)
    })

    win.once("ready-to-show", () => win.show())
    void win.loadURL(CURSOR_LOGIN_URL)
  })
}
