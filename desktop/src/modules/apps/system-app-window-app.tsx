import { mailOpenRequestSchema } from "../../../app-capabilities/mail/shared/private-schema"
import { useCallback, useEffect, useMemo, useState } from "react"
import {
  type ContentOpenRequest,
} from "@/app-shell/content-navigation"
import { Empty, EmptyContent, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { getSynapseBridge } from "@/lib/electron-bridge"
import { updateTrackingContext } from "@/lib/ui-tracking"
import { SystemAppContent } from "./components/system-app-content"
import type {
  SynapseSystemAppGitOpenRequest,
  SynapseSystemAppMailInternalOpenRequest,
  TodoOpenRequest,
  SynapseSystemAppId,
  SynapseSystemAppOpenOptions,
  SynapseSystemAppTerminalOpenRequest,
} from "./types"
import { parseSystemAppId } from "./definitions"

type AppsBridge = {
  readonly openSystemApp: (appId: SynapseSystemAppId, options?: SynapseSystemAppOpenOptions) => Promise<void>
  readonly onContentOpenRequest: (listener: (request: ContentOpenRequest) => void) => () => void
  readonly onGitOpenRequest: (listener: (request: SynapseSystemAppGitOpenRequest) => void) => () => void
  readonly onTerminalOpenRequest: (listener: (request: SynapseSystemAppTerminalOpenRequest) => void) => () => void
  readonly onMailOpenRequest?: (listener: (request: import("../../../app-capabilities/mail/shared/private-schema").MailOpenRequest) => void) => () => void
  readonly onTodoOpenRequest?: (listener: (request: TodoOpenRequest) => void) => () => void
  readonly onMailInternalOpenRequest: (listener: (request: SynapseSystemAppMailInternalOpenRequest) => void) => () => void
}

function getAppsBridge(): AppsBridge | undefined {
  return (getSynapseBridge() as (ReturnType<typeof getSynapseBridge> & { readonly apps?: AppsBridge }) | undefined)
    ?.apps
}

function parseInitialContentOpenRequest(): ContentOpenRequest | null {
  const raw = new URLSearchParams(window.location.search).get("contentOpenRequest")
  if (!raw) return null
  try {
    return JSON.parse(raw) as ContentOpenRequest
  } catch {
    return null
  }
}

function parseInitialGitOpenRequest(): SynapseSystemAppGitOpenRequest | null {
  const raw = new URLSearchParams(window.location.search).get("gitOpenRequest")
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<SynapseSystemAppGitOpenRequest>
    return typeof parsed.requestId === "string"
      && parsed.requestId.length > 0
      && typeof parsed.repositoryId === "string"
      && parsed.repositoryId.length > 0
      ? { requestId: parsed.requestId, repositoryId: parsed.repositoryId }
      : null
  } catch {
    return null
  }
}

function parseInitialTerminalOpenRequest(): SynapseSystemAppTerminalOpenRequest | null {
  const raw = new URLSearchParams(window.location.search).get("terminalOpenRequest")
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<SynapseSystemAppTerminalOpenRequest>
    return typeof parsed.requestId === "string"
      && parsed.requestId.length > 0
      && typeof parsed.sessionId === "string"
      && parsed.sessionId.length > 0
      ? { requestId: parsed.requestId, sessionId: parsed.sessionId }
      : null
  } catch {
    return null
  }
}

function parseInitialTodoOpenRequest(): TodoOpenRequest | null {
  const raw = new URLSearchParams(window.location.search).get("todoOpenRequest")
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<TodoOpenRequest>
    return typeof parsed.requestId === "string" && parsed.requestId.length > 0 && typeof parsed.id === "string" && /^[A-Za-z0-9_-]{1,200}$/.test(parsed.id) ? { requestId: parsed.requestId, id: parsed.id } : null
  } catch { return null }
}

function parseInitialMailInternalOpenRequest(): SynapseSystemAppMailInternalOpenRequest | null {
  const raw = new URLSearchParams(window.location.search).get("mailInternalOpenRequest")
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<SynapseSystemAppMailInternalOpenRequest>
    return typeof parsed.requestId === "string" && typeof parsed.messageId === "string" ? { requestId: parsed.requestId, messageId: parsed.messageId } : null
  } catch { return null }
}

function replaceOpenRequestInUrl(name: string, request: unknown): void {
  const url = new URL(window.location.href)
  url.searchParams.set(name, JSON.stringify(request))
  window.history.replaceState(
    window.history.state,
    "",
    `${url.pathname}${url.search}${url.hash}`,
  )
}

export function SystemAppWindowApp() {
  const appId = useMemo(
    () => parseSystemAppId(new URLSearchParams(window.location.search).get("appId")),
    [],
  )
  const [pendingContentOpenRequest, setPendingContentOpenRequest] =
    useState<ContentOpenRequest | null>(() => parseInitialContentOpenRequest())
  const [pendingGitOpenRequest, setPendingGitOpenRequest] =
    useState<SynapseSystemAppGitOpenRequest | null>(() => parseInitialGitOpenRequest())
  const [pendingTerminalOpenRequest, setPendingTerminalOpenRequest] =
    useState<SynapseSystemAppTerminalOpenRequest | null>(() => parseInitialTerminalOpenRequest())
  const [pendingTodoOpenRequest, setPendingTodoOpenRequest] = useState<TodoOpenRequest | null>(() => parseInitialTodoOpenRequest())
  const [pendingMailOpenRequest, setPendingMailOpenRequest] = useState<import("../../../app-capabilities/mail/shared/private-schema").MailOpenRequest | null>(() => {
    const raw = new URLSearchParams(window.location.search).get("mailOpenRequest")
    if (!raw) return null
    try { const result = mailOpenRequestSchema.safeParse(JSON.parse(raw)); return result.success ? result.data : null } catch { return null }
  })
  useEffect(() => getAppsBridge()?.onMailOpenRequest?.(request => { replaceOpenRequestInUrl("mailOpenRequest", request); setPendingMailOpenRequest(request) }), [])
  const [pendingMailInternalOpenRequest, setPendingMailInternalOpenRequest] =
    useState<SynapseSystemAppMailInternalOpenRequest | null>(() => parseInitialMailInternalOpenRequest())

  useEffect(() => {
    updateTrackingContext({ moduleId: appId ?? "apps", windowType: "system-app" })
  }, [appId])

  useEffect(() => {
    const bridge = getAppsBridge()
    if (!bridge) return undefined
    return bridge.onContentOpenRequest((request) => {
      replaceOpenRequestInUrl("contentOpenRequest", request)
      setPendingContentOpenRequest(request)
    })
  }, [])

  useEffect(() => {
    const bridge = getAppsBridge()
    if (!bridge) return undefined
    return bridge.onTerminalOpenRequest((request) => {
      replaceOpenRequestInUrl("terminalOpenRequest", request)
      setPendingTerminalOpenRequest(request)
    })
  }, [])

  useEffect(() => {
    const bridge = getAppsBridge()
    if (!bridge) return undefined
    return bridge.onGitOpenRequest((request) => {
      replaceOpenRequestInUrl("gitOpenRequest", request)
      setPendingGitOpenRequest(request)
    })
  }, [])

  useEffect(() => {
    const bridge = getAppsBridge()
    if (!bridge) return undefined
    return bridge.onMailInternalOpenRequest((request) => {
      replaceOpenRequestInUrl("mailInternalOpenRequest", request)
      setPendingMailInternalOpenRequest(request)
    })
  }, [])

  useEffect(() => getAppsBridge()?.onTodoOpenRequest?.((request) => setPendingTodoOpenRequest(request)), [])

  const handleTodoConsumed = useCallback((requestId: string) => {
    setPendingTodoOpenRequest((current) => current?.requestId === requestId ? null : current)
    const url = new URL(window.location.href)
    url.searchParams.delete("todoOpenRequest")
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`)
  }, [])

  const forwardContentOpenRequest = useCallback((request: ContentOpenRequest) => {
    void getAppsBridge()?.openSystemApp("resource-repository", {
      contentOpenRequest: request,
    })
  }, [])

  if (!appId) {
    return <SystemAppWindowError />
  }

  return (
    <SystemAppContent
      appId={appId}
      resourceContentOpenRequest={pendingContentOpenRequest}
      onResourceContentOpenRequestConsumed={(requestId) => {
        setPendingContentOpenRequest((current) => current?.requestId === requestId ? null : current)
      }}
      gitOpenRequest={pendingGitOpenRequest}
      onGitOpenRequestConsumed={(requestId) => {
        setPendingGitOpenRequest((current) => current?.requestId === requestId ? null : current)
      }}
      terminalOpenRequest={pendingTerminalOpenRequest}
      onTerminalOpenRequestConsumed={(requestId) => {
        setPendingTerminalOpenRequest((current) => current?.requestId === requestId ? null : current)
      }}
      todoOpenRequest={pendingTodoOpenRequest}
      onTodoOpenRequestConsumed={handleTodoConsumed}
      mailOpenRequest={pendingMailOpenRequest}
      onMailOpenRequestConsumed={id => setPendingMailOpenRequest(current => current?.requestId === id ? null : current)}
      mailInternalOpenRequest={pendingMailInternalOpenRequest}
      onMailInternalOpenRequestConsumed={(requestId) => {
        setPendingMailInternalOpenRequest((current) => current?.requestId === requestId ? null : current)
      }}
      onContentOpenRequest={forwardContentOpenRequest}
    />
  )
}

function SystemAppWindowError() {
  return (
    <div className="flex h-full items-center justify-center bg-surface p-6">
      <Empty>
        <EmptyHeader>
          <EmptyTitle>无法打开应用</EmptyTitle>
        </EmptyHeader>
        <EmptyContent>应用不存在。</EmptyContent>
      </Empty>
    </div>
  )
}
