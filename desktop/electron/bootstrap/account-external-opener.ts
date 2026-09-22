import { shell } from "electron"

import { sanitizeUrl } from "../../src/lib/url-sanitize"
import type { AuditSink, PermissionGuard } from "../runtime/security"
import { createMainLogger } from "../services/log-store"

type AccountExternalUrlOpener = (url: string, signal?: AbortSignal) => Promise<void>

type AccountExternalUrlOpenerDeps = {
  auditSink: AuditSink
  permissionGuard: PermissionGuard
  openExternal?: (url: string) => Promise<void>
  source?: string
  omitUrlDetails?: boolean
}

const ACCOUNT_LOGIN_SHELL_SOURCE = "account.startLogin"
const userActor = { kind: "user" } as const
const logger = createMainLogger("bootstrap.account-external-opener")

function recordAccountShellAudit(
  auditSink: AuditSink,
  event: Parameters<AuditSink["record"]>[0],
): void {
  try {
    auditSink.record(event)
  } catch (error) {
    logger.warn("Failed to record account shell audit event.", {
      action: event.action,
      outcome: event.outcome,
      source: ACCOUNT_LOGIN_SHELL_SOURCE,
      errorName: error instanceof Error ? error.name : typeof error,
      errorLength: String(error).length,
    })
  }
}

function createAccountExternalUrlOpener({
  auditSink,
  permissionGuard,
  openExternal = shell.openExternal,
  source = ACCOUNT_LOGIN_SHELL_SOURCE,
  omitUrlDetails = false,
}: AccountExternalUrlOpenerDeps): AccountExternalUrlOpener {
  return async (rawUrl: string, signal?: AbortSignal) => {
    const url = new URL(rawUrl)
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("Only http and https links can be opened.")
    }

    const externalUrl = url.toString()
    const resource = omitUrlDetails ? `${url.origin}${url.pathname}` : sanitizeUrl(externalUrl)
    const permission = await permissionGuard.check({
      action: "shell.exec",
      actor: userActor,
      resource,
      context: { source },
    })

    if (!permission.allowed) {
      recordAccountShellAudit(auditSink, {
        action: "shell.exec",
        actor: userActor,
        resource,
        outcome: "denied",
        metadata: {
          source,
          reason: permission.reason,
          policyId: permission.policyId,
        },
      })
      throw new Error(permission.reason)
    }

    try {
      if (signal?.aborted) throw new Error("浏览器打开已取消。")
      await openExternal(externalUrl)
    } catch (error) {
      recordAccountShellAudit(auditSink, {
        action: "shell.exec",
        actor: userActor,
        resource,
        outcome: "failed",
        metadata: {
          source,
          errorName: error instanceof Error ? error.name : typeof error,
          errorLength: String(error).length,
        },
      })
      throw error
    }

    recordAccountShellAudit(auditSink, {
      action: "shell.exec",
      actor: userActor,
      resource,
      outcome: "allowed",
      metadata: { source },
    })
  }
}

export { createAccountExternalUrlOpener }
