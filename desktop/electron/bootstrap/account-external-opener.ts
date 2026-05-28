import { shell } from "electron"

import { sanitizeUrl } from "../../src/lib/url-sanitize"
import type { AuditSink, PermissionGuard } from "../runtime/security"

type AccountExternalUrlOpener = (url: string) => Promise<void>

type AccountExternalUrlOpenerDeps = {
  auditSink: AuditSink
  permissionGuard: PermissionGuard
  openExternal?: AccountExternalUrlOpener
}

const ACCOUNT_LOGIN_SHELL_SOURCE = "account.startLogin"
const userActor = { kind: "user" } as const

function createAccountExternalUrlOpener({
  auditSink,
  permissionGuard,
  openExternal = shell.openExternal,
}: AccountExternalUrlOpenerDeps): AccountExternalUrlOpener {
  return async (rawUrl: string) => {
    const url = new URL(rawUrl)
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("Only http and https links can be opened.")
    }

    const externalUrl = url.toString()
    const resource = sanitizeUrl(externalUrl)
    const permission = await permissionGuard.check({
      action: "shell.exec",
      actor: userActor,
      resource,
      context: { source: ACCOUNT_LOGIN_SHELL_SOURCE },
    })

    if (!permission.allowed) {
      auditSink.record({
        action: "shell.exec",
        actor: userActor,
        resource,
        outcome: "denied",
        metadata: {
          source: ACCOUNT_LOGIN_SHELL_SOURCE,
          reason: permission.reason,
          policyId: permission.policyId,
        },
      })
      throw new Error(permission.reason)
    }

    try {
      await openExternal(externalUrl)
      auditSink.record({
        action: "shell.exec",
        actor: userActor,
        resource,
        outcome: "allowed",
        metadata: { source: ACCOUNT_LOGIN_SHELL_SOURCE },
      })
    } catch (error) {
      auditSink.record({
        action: "shell.exec",
        actor: userActor,
        resource,
        outcome: "failed",
        metadata: {
          source: ACCOUNT_LOGIN_SHELL_SOURCE,
          errorName: error instanceof Error ? error.name : typeof error,
          errorLength: String(error).length,
        },
      })
      throw error
    }
  }
}

export { createAccountExternalUrlOpener }
