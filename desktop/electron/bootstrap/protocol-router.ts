import { parseContentStoreInstallProtocolUrl } from "../../src/lib/content-store-install-window"
import { parseSkillRepositoryInstallProtocolUrl } from "../../src/lib/skill-repository-install-window"
import type { SynapseContentStoreInstallWindowRequest } from "../../src/types/content-store-install"
import type { SynapseSkillRepositoryInstallWindowRequest } from "../../src/types/skill-repository-install"

type ProtocolRouterLogger = {
  warn: (message: string, meta?: unknown) => void
}

type ProtocolUrlRouterDeps = {
  focusMainWindow: () => void
  handleAuthCallback: (url: string) => Promise<unknown>
  logger: ProtocolRouterLogger
  openInstallWindow: (request: SynapseContentStoreInstallWindowRequest) => Promise<void>
  openSkillRepositoryInstallWindow: (request: SynapseSkillRepositoryInstallWindowRequest) => Promise<void>
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

function isContentInstallUrlCandidate(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl)
    return parsed.protocol === "synapse:" && parsed.hostname === "content-install"
  } catch {
    return (
      rawUrl === "synapse://content-install"
      || rawUrl.startsWith("synapse://content-install?")
      || rawUrl.startsWith("synapse://content-install/")
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

function shouldFocusMainForSecondInstance(argv: string[]): boolean {
  return !argv.some(isSynapseProtocolUrl)
}

function createProtocolUrlRouter(deps: ProtocolUrlRouterDeps, initialUrls: string[] = []) {
  const pendingUrls = [...initialUrls]
  let started = false
  let activeDrain: Promise<number> | null = null

  async function routeUrl(url: string): Promise<number> {
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

    const installRequest = parseContentStoreInstallProtocolUrl(url)
    if (installRequest) {
      try {
        await deps.openInstallWindow(installRequest)
      } catch (error) {
        deps.logger.warn("Failed to open content store install window.", { error })
        deps.focusMainWindow()
      }
      return 0
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
      isContentInstallUrlCandidate(url)
        ? "Ignored invalid content store install URL."
        : isSkillRepositoryInstallUrlCandidate(url)
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
      !parseContentStoreInstallProtocolUrl(url)
      && !parseSkillRepositoryInstallProtocolUrl(url)
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
