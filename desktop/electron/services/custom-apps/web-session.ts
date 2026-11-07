import { dialog, session, type DownloadItem, type Session, type WebContents } from "electron"
import { parseCustomAppUrl } from "@synapse/shared/custom-apps-contracts"

export const CUSTOM_WEB_PARTITION = "persist:synapse-custom-web"

type WebSessionDependencies = {
  readonly onDownload?: (item: DownloadItem, webContents: WebContents) => void
  readonly showSaveDialog?: typeof dialog.showSaveDialog
}

const configuredSessions = new WeakMap<Session, () => void>()

export function getCustomWebSession(): Session {
  return session.fromPartition(CUSTOM_WEB_PARTITION)
}

export function isAllowedCustomWebUrl(value: string): boolean {
  return parseCustomAppUrl(value) !== null
}

export function configureCustomWebSession(
  target: Session,
  deps: WebSessionDependencies = {},
): () => void {
  const existing = configuredSessions.get(target)
  if (existing) return existing

  target.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === "mediaKeySystem")
  })
  target.setPermissionCheckHandler((_webContents, permission) => {
    return permission === "mediaKeySystem"
  })
  target.setDevicePermissionHandler(() => false)

  const onWillDownload = (
    _event: Electron.Event,
    item: DownloadItem,
    webContents: WebContents,
  ) => {
    if (deps.onDownload) {
      deps.onDownload(item, webContents)
      return
    }
    void (deps.showSaveDialog ?? dialog.showSaveDialog)({
      defaultPath: item.getFilename(),
    }).then((result) => {
      if (result.canceled || !result.filePath) {
        item.cancel()
        return
      }
      item.setSavePath(result.filePath)
    }).catch(() => {
      item.cancel()
    })
  }
  target.on("will-download", onWillDownload)

  const cleanup = () => {
    target.removeListener("will-download", onWillDownload)
    configuredSessions.delete(target)
  }
  configuredSessions.set(target, cleanup)
  return cleanup
}
