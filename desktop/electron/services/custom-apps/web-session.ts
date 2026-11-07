import { dialog, session, type DownloadItem, type Session, type WebContents } from "electron"
import { parseCustomAppUrl } from "@synapse/shared/custom-apps-contracts"
import type { AuditSink, PermissionGuard } from "../../runtime/security"

export const CUSTOM_WEB_PARTITION = "persist:synapse-custom-web"
export const CUSTOM_WEB_SESSION_SERVICE_ID = "core.custom-app-web-session"

type WebSessionDependencies = {
  readonly onDownload?: (item: DownloadItem, webContents: WebContents) => void
  readonly showSaveDialog?: typeof dialog.showSaveDialog
  readonly authorizeDownload?: (filePath: string) => Promise<boolean>
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
    }).then(async (result) => {
      if (result.canceled || !result.filePath) {
        item.cancel()
        return
      }
      if (deps.authorizeDownload && !await deps.authorizeDownload(result.filePath)) {
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

type CustomWebSessionServiceDependencies = {
  readonly target?: Session
  readonly permissionGuard: Pick<PermissionGuard, "check">
  readonly auditSink: Pick<AuditSink, "record">
  readonly showSaveDialog?: typeof dialog.showSaveDialog
}

export class CustomWebSessionService {
  private cleanup: (() => void) | null = null

  constructor(private readonly deps: CustomWebSessionServiceDependencies) {}

  start(): void {
    if (this.cleanup) return
    this.cleanup = configureCustomWebSession(this.deps.target ?? getCustomWebSession(), {
      showSaveDialog: this.deps.showSaveDialog,
      authorizeDownload: (filePath) => this.authorizeDownload(filePath),
    })
  }

  stop(): void {
    this.cleanup?.()
    this.cleanup = null
  }

  private async authorizeDownload(filePath: string): Promise<boolean> {
    const actor = { kind: "user" as const }
    try {
      const result = await this.deps.permissionGuard.check({
        action: "fs.write",
        actor,
        resource: filePath,
        context: { source: "custom-web.download" },
      })
      this.deps.auditSink.record({
        action: "fs.write",
        actor,
        resource: filePath,
        outcome: result.allowed ? "allowed" : "denied",
        metadata: {
          source: "custom-web.download",
          ...(result.allowed ? {} : {
            reason: result.reason,
            policyId: result.policyId,
          }),
        },
      })
      return result.allowed
    } catch {
      this.deps.auditSink.record({
        action: "fs.write",
        actor,
        resource: filePath,
        outcome: "failed",
        metadata: { source: "custom-web.download" },
      })
      return false
    }
  }
}
