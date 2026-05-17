import { app, ipcMain, type IpcMainEvent, type IpcMainInvokeEvent, type WebContents } from "electron"
import path from "node:path"
import { pathToFileURL } from "node:url"

type SynapseIpcEvent = IpcMainEvent | IpcMainInvokeEvent

function getTrustedRendererIndexUrl(): URL {
  return pathToFileURL(path.join(app.getAppPath(), "dist/index.html"))
}

function isTrustedRendererUrl(url: string): boolean {
  if (!url) {
    return false
  }

  const devServerUrl = process.env.VITE_DEV_SERVER_URL

  if (devServerUrl) {
    try {
      return new URL(url).origin === new URL(devServerUrl).origin
    } catch {
      return false
    }
  }

  if (!url.startsWith("file:")) {
    return false
  }

  try {
    const rendererUrl = new URL(url)
    const trustedIndexUrl = getTrustedRendererIndexUrl()

    return rendererUrl.protocol === trustedIndexUrl.protocol && rendererUrl.pathname === trustedIndexUrl.pathname
  } catch {
    return false
  }
}

function assertTrustedIpcSender(event: SynapseIpcEvent): void {
  const senderUrl = event.senderFrame?.url ?? event.sender.getURL()

  if (isTrustedRendererUrl(senderUrl)) {
    return
  }

  throw new Error(`Blocked IPC request from untrusted renderer: ${senderUrl || "<empty>"}`)
}

function handleValidatedIpc<Args extends unknown[], Result>(
  channel: string,
  handler: (event: IpcMainInvokeEvent, ...args: Args) => Promise<Result> | Result,
): void {
  ipcMain.handle(channel, (event, ...args) => {
    assertTrustedIpcSender(event)
    return handler(event, ...(args as Args))
  })
}

function onValidatedIpc<Args extends unknown[]>(
  channel: string,
  listener: (event: IpcMainEvent, ...args: Args) => void,
): void {
  ipcMain.on(channel, (event, ...args) => {
    assertTrustedIpcSender(event)
    listener(event, ...(args as Args))
  })
}

function isTrustedRendererContents(webContents: WebContents): boolean {
  return isTrustedRendererUrl(webContents.getURL())
}

export {
  assertTrustedIpcSender,
  handleValidatedIpc,
  isTrustedRendererContents,
  onValidatedIpc,
}
