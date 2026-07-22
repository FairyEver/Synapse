import { parseSkillRepositoryInstallProtocolUrl } from "../../src/lib/skill-repository-install-window"
import type { SynapseSkillRepositoryInstallWindowRequest } from "../../src/types/skill-repository-install"
import { DESKTOP_UPDATE_INTENT_TOKEN_MAX_LENGTH } from "../../config"
import type { DispatchResult } from "../../synapse-capabilities/shared/types"
import { isAppDeepLinkCandidate, parseDeclaredAppDeepLink } from "./app-deep-link"

type ProtocolRouterLogger = {
  warn: (message: string, meta?: unknown) => void
}

type ProtocolUrlRouterDeps = {
  focusMainWindow: () => void
  handleAuthCallback: (url: string) => Promise<unknown>
  logger: ProtocolRouterLogger
  openSkillRepositoryInstallWindow: (request: SynapseSkillRepositoryInstallWindowRequest) => Promise<void>
  publishUpdateOpenRequest: (automatic: boolean) => void
  verifyUpdateIntent: (token: string) => Promise<boolean>
  dispatchAppAction?: (
    capabilityId: string,
    params: Record<string, unknown>,
  ) => Promise<DispatchResult>
  showAppDeepLinkError?: (message: string) => void
}

type UpdateProtocolRequest = {
  readonly token: string | null
}

function isSynapseProtocolUrl(rawUrl: string): boolean {
  const value = rawUrl.trim()
  if (!value) return false
  try {
    return new URL(value).protocol === "synapse:"
  } catch {
    return value.toLowerCase().startsWith("synapse://")
  }
}

function isAccountAuthCallbackUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl)
    return parsed.protocol === "synapse:" && parsed.hostname === "auth" && parsed.pathname === "/desktop/callback"
  } catch {
    return (
      rawUrl === "synapse://auth/desktop/callback"
      || rawUrl.startsWith("synapse://auth/desktop/callback?")
      || rawUrl.startsWith("synapse://auth/desktop/callback#")
    )
  }
}

function isSkillRepositoryInstallUrlCandidate(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl)
    return parsed.protocol === "synapse:" && parsed.hostname === "skill-install"
  } catch {
    return (
      rawUrl === "synapse://skill-install"
      || rawUrl.startsWith("synapse://skill-install?")
      || rawUrl.startsWith("synapse://skill-install/")
    )
  }
}

function parseUpdateProtocolRequest(rawUrl: string): UpdateProtocolRequest | null {
  try {
    const parsed = new URL(rawUrl)
    if (parsed.protocol !== "synapse:" || parsed.hostname !== "update") {
      return null
    }
    if (
      (parsed.pathname !== "" && parsed.pathname !== "/")
      || parsed.hash !== ""
      || parsed.username !== ""
      || parsed.password !== ""
      || parsed.port !== ""
    ) return { token: null }
    if (parsed.search === "") {
      return { token: null }
    }
    const tokenValues = parsed.searchParams.getAll("token")
    const parameterNames = [...parsed.searchParams.keys()]
    if (
      parameterNames.length !== 1
      || tokenValues.length !== 1
      || !tokenValues[0]
      || tokenValues[0].length > DESKTOP_UPDATE_INTENT_TOKEN_MAX_LENGTH
    ) {
      return { token: null }
    }
    return { token: tokenValues[0] }
  } catch {
    return null
  }
}

function shouldFocusMainForSecondInstance(argv: string[]): boolean {
  return !argv.some(isSynapseProtocolUrl)
}

function createProtocolUrlRouter(deps: ProtocolUrlRouterDeps, initialUrls: string[] = []) {
  const pendingUrls = [...initialUrls]
  let started = false
  let activeDrain: Promise<number> | null = null

  async function routeUrl(url: string): Promise<number> {
    if (isAppDeepLinkCandidate(url)) {
      try {
        const request = parseDeclaredAppDeepLink(url)
        if (!deps.dispatchAppAction) throw new Error("应用能力暂不可用")
        const result = await deps.dispatchAppAction(request.capabilityId, request.params)
        if (!result.ok) throw new Error(result.error || "应用操作失败")
      } catch (error) {
        const message = error instanceof Error ? error.message : "应用链接处理失败"
        deps.logger.warn("App deep link request failed.", {
          errorName: error instanceof Error ? error.name : typeof error,
          errorCode: typeof error === "object" && error !== null && "code" in error
            ? String((error as { code?: unknown }).code)
            : undefined,
        })
        deps.showAppDeepLinkError?.(message)
      }
      return 0
    }

    const updateRequest = parseUpdateProtocolRequest(url)
    if (updateRequest) {
      deps.focusMainWindow()
      let automatic = false
      if (updateRequest.token) {
        try {
          automatic = await deps.verifyUpdateIntent(updateRequest.token)
        } catch {
          deps.logger.warn("Update intent verification failed closed.")
        }
      }
      deps.publishUpdateOpenRequest(automatic)
      return 0
    }

    if (isAccountAuthCallbackUrl(url)) {
      try {
        await deps.handleAuthCallback(url)
      } catch (error) {
        deps.logger.warn("Failed to handle account auth callback.", { error })
      } finally {
        deps.focusMainWindow()
      }
      return 1
    }

    const skillInstallRequest = parseSkillRepositoryInstallProtocolUrl(url)
    if (skillInstallRequest) {
      try {
        await deps.openSkillRepositoryInstallWindow(skillInstallRequest)
      } catch (error) {
        deps.logger.warn("Failed to open skill repository install window.", { error })
        deps.focusMainWindow()
      }
      return 0
    }

    deps.logger.warn(
      isSkillRepositoryInstallUrlCandidate(url)
        ? "Ignored invalid skill repository install URL."
        : "Ignored unknown synapse protocol URL.",
    )
    deps.focusMainWindow()
    return 0
  }

  function drain(): Promise<number> {
    if (activeDrain) return activeDrain

    activeDrain = (async () => {
      let authCallbackCount = 0
      while (pendingUrls.length > 0) {
        authCallbackCount += await routeUrl(pendingUrls.shift()!)
      }
      return authCallbackCount
    })().finally(() => {
      activeDrain = null
      if (started && pendingUrls.length > 0) void drain()
    })

    return activeDrain
  }

  async function drainInitialAuthCallbacks(): Promise<number> {
    const remainingUrls: string[] = []
    let authCallbackCount = 0

    while (pendingUrls.length > 0) {
      const url = pendingUrls.shift()!
      if (isAccountAuthCallbackUrl(url)) {
        authCallbackCount += await routeUrl(url)
      } else {
        remainingUrls.push(url)
      }
    }

    pendingUrls.push(...remainingUrls)
    return authCallbackCount
  }

  function shouldCreateMainWindowBeforeStart(): boolean {
    if (pendingUrls.length === 0) return true
    return pendingUrls.some((url) => (
      !parseSkillRepositoryInstallProtocolUrl(url) && !isAppDeepLinkCandidate(url)
    ))
  }

  return {
    drain,
    enqueue(url: string): void {
      pendingUrls.push(url)
      if (started) void drain()
    },
    shouldCreateMainWindowBeforeStart,
    async start(
      prepareBeforeNonAuthRoutes: (handledAuthCallbacks: number) => Promise<void> = async () => undefined,
    ): Promise<number> {
      const initialAuthCallbackCount = await drainInitialAuthCallbacks()
      await prepareBeforeNonAuthRoutes(initialAuthCallbackCount)
      const lateAuthCallbackCount = await drainInitialAuthCallbacks()
      started = true
      return initialAuthCallbackCount + lateAuthCallbackCount + await drain()
    },
  }
}

export {
  createProtocolUrlRouter,
  isSynapseProtocolUrl,
  shouldFocusMainForSecondInstance,
}
