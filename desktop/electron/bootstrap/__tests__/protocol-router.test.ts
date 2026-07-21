import { describe, expect, it, vi } from "vitest"

import {
  createProtocolUrlRouter,
  isSynapseProtocolUrl,
  shouldFocusMainForSecondInstance,
} from "../protocol-router"

describe("isSynapseProtocolUrl", () => {
  it("accepts protocol arguments with case-insensitive schemes", () => {
    expect(isSynapseProtocolUrl("synapse://skill-install?session=session-1")).toBe(true)
    expect(isSynapseProtocolUrl("Synapse://auth/desktop/callback?code=auth-code")).toBe(true)
    expect(isSynapseProtocolUrl("SYNAPSE://skill-install?session=session-1")).toBe(true)
    expect(isSynapseProtocolUrl("/Electron")).toBe(false)
  })
})

describe("createProtocolUrlRouter", () => {
  it("focuses immediately and publishes a manual request for a bare update deep link", async () => {
    const focusMainWindow = vi.fn()
    const publishUpdateOpenRequest = vi.fn()
    const verifyUpdateIntent = vi.fn()
    const router = createProtocolUrlRouter({
      focusMainWindow,
      handleAuthCallback: vi.fn(async () => undefined),
      logger: createLogger(),
      openSkillRepositoryInstallWindow: vi.fn(async () => undefined),
      publishUpdateOpenRequest,
      verifyUpdateIntent,
    }, ["synapse://update"])

    await router.start()

    expect(focusMainWindow).toHaveBeenCalledTimes(1)
    expect(verifyUpdateIntent).not.toHaveBeenCalled()
    expect(publishUpdateOpenRequest).toHaveBeenCalledWith(false)
  })

  it("focuses before verification and publishes an automatic request only after a token is verified", async () => {
    let resolveVerification: ((authorized: boolean) => void) | undefined
    const verification = new Promise<boolean>((resolve) => {
      resolveVerification = resolve
    })
    const focusMainWindow = vi.fn()
    const publishUpdateOpenRequest = vi.fn()
    const verifyUpdateIntent = vi.fn(() => verification)
    const router = createProtocolUrlRouter({
      focusMainWindow,
      handleAuthCallback: vi.fn(async () => undefined),
      logger: createLogger(),
      openSkillRepositoryInstallWindow: vi.fn(async () => undefined),
      publishUpdateOpenRequest,
      verifyUpdateIntent,
    }, ["synapse://update?token=credential"])

    const startPromise = router.start()

    await vi.waitFor(() => {
      expect(focusMainWindow).toHaveBeenCalledTimes(1)
    })
    expect(verifyUpdateIntent).toHaveBeenCalledWith("credential")
    expect(publishUpdateOpenRequest).not.toHaveBeenCalled()

    resolveVerification?.(true)
    await startPromise

    expect(publishUpdateOpenRequest).toHaveBeenCalledWith(true)
  })

  it.each([
    ["invalid path", "synapse://update/other?token=credential"],
    ["unknown parameter", "synapse://update?token=credential&version=1.2.3"],
    ["duplicate token", "synapse://update?token=credential&token=other"],
    ["empty token", "synapse://update?token="],
    ["oversized token", `synapse://update?token=${"a".repeat(4_097)}`],
  ])("publishes a manual request for an update deep link with %s", async (_caseName, url) => {
    const focusMainWindow = vi.fn()
    const publishUpdateOpenRequest = vi.fn()
    const verifyUpdateIntent = vi.fn(async () => true)
    const router = createProtocolUrlRouter({
      focusMainWindow,
      handleAuthCallback: vi.fn(async () => undefined),
      logger: createLogger(),
      openSkillRepositoryInstallWindow: vi.fn(async () => undefined),
      publishUpdateOpenRequest,
      verifyUpdateIntent,
    }, [url])

    await router.start()

    expect(focusMainWindow).toHaveBeenCalledTimes(1)
    expect(verifyUpdateIntent).not.toHaveBeenCalled()
    expect(publishUpdateOpenRequest).toHaveBeenCalledWith(false)
  })

  it("fails closed to a manual request when update intent verification throws", async () => {
    const logger = createLogger()
    const publishUpdateOpenRequest = vi.fn()
    const router = createProtocolUrlRouter({
      focusMainWindow: vi.fn(),
      handleAuthCallback: vi.fn(async () => undefined),
      logger,
      openSkillRepositoryInstallWindow: vi.fn(async () => undefined),
      publishUpdateOpenRequest,
      verifyUpdateIntent: vi.fn(async () => {
        throw new Error("verification unavailable")
      }),
    }, ["synapse://update?token=credential"])

    await router.start()

    expect(publishUpdateOpenRequest).toHaveBeenCalledWith(false)
    expect(logger.warn).toHaveBeenCalledWith("Update intent verification failed closed.")
  })

  it("routes auth callbacks and valid install URLs while draining multiple pending URLs", async () => {
    const handleAuthCallback = vi.fn(async () => undefined)
    const openSkillRepositoryInstallWindow = vi.fn(async () => undefined)
    const focusMainWindow = vi.fn()
    const logger = createLogger()
    const router = createProtocolUrlRouter({
      ...createUnusedUpdateRouterDeps(),
      focusMainWindow,
      handleAuthCallback,
      logger,
      openSkillRepositoryInstallWindow,
    }, [
      "synapse://auth/desktop/callback?code=auth-code",
      "synapse://skill-install?session=skill-session-1",
      "synapse://skill-install?session=",
    ])

    const authCallbackCount = await router.start()

    expect(authCallbackCount).toBe(1)
    expect(handleAuthCallback).toHaveBeenCalledWith("synapse://auth/desktop/callback?code=auth-code")
    expect(openSkillRepositoryInstallWindow).toHaveBeenCalledWith({ session: "skill-session-1" })
    expect(logger.warn).toHaveBeenCalledWith("Ignored invalid skill repository install URL.")
    expect(focusMainWindow).toHaveBeenCalledTimes(2)
  })

  it("waits for account preparation before opening pending install windows", async () => {
    const calls: string[] = []
    const router = createProtocolUrlRouter({
      ...createUnusedUpdateRouterDeps(),
      focusMainWindow: vi.fn(),
      handleAuthCallback: vi.fn(async () => {
        calls.push("auth")
      }),
      logger: createLogger(),
      openSkillRepositoryInstallWindow: vi.fn(async () => {
        calls.push("install")
      }),
    }, [
      "synapse://auth/desktop/callback?code=auth-code",
      "synapse://skill-install?session=session-1",
    ])

    const authCallbackCount = await router.start(async (handledAuthCallbacks) => {
      calls.push(`prepare:${handledAuthCallbacks}`)
    })

    expect(authCallbackCount).toBe(1)
    expect(calls).toEqual(["auth", "prepare:1", "install"])
  })

  it("prioritizes auth callbacks received during account preparation over pending installs", async () => {
    const calls: string[] = []
    let releasePreparation: (() => void) | undefined
    const preparation = new Promise<void>((resolve) => {
      releasePreparation = resolve
    })
    const router = createProtocolUrlRouter({
      ...createUnusedUpdateRouterDeps(),
      focusMainWindow: vi.fn(),
      handleAuthCallback: vi.fn(async () => {
        calls.push("auth")
      }),
      logger: createLogger(),
      openSkillRepositoryInstallWindow: vi.fn(async () => {
        calls.push("install")
      }),
    }, ["synapse://skill-install?session=session-1"])

    const startPromise = router.start(async () => {
      calls.push("prepare:start")
      await preparation
      calls.push("prepare:end")
    })
    router.enqueue("synapse://auth/desktop/callback?code=auth-code")
    releasePreparation?.()

    const authCallbackCount = await startPromise

    expect(authCallbackCount).toBe(1)
    expect(calls).toEqual(["prepare:start", "prepare:end", "auth", "install"])
  })

  it("warns and focuses the main window for malformed or unknown protocol URLs", async () => {
    const focusMainWindow = vi.fn()
    const logger = createLogger()
    const router = createProtocolUrlRouter({
      ...createUnusedUpdateRouterDeps(),
      focusMainWindow,
      handleAuthCallback: vi.fn(async () => undefined),
      logger,
      openSkillRepositoryInstallWindow: vi.fn(async () => undefined),
    }, ["synapse://skill-install/%", "synapse://unknown"])

    await router.start()

    expect(logger.warn).toHaveBeenCalledTimes(2)
    expect(logger.warn).toHaveBeenCalledWith("Ignored invalid skill repository install URL.")
    expect(focusMainWindow).toHaveBeenCalledTimes(2)
  })

  it("opens install URLs received after startup without focusing the main window", async () => {
    const openSkillRepositoryInstallWindow = vi.fn(async () => undefined)
    const focusMainWindow = vi.fn()
    const router = createProtocolUrlRouter({
      ...createUnusedUpdateRouterDeps(),
      focusMainWindow,
      handleAuthCallback: vi.fn(async () => undefined),
      logger: createLogger(),
      openSkillRepositoryInstallWindow,
    })

    await router.start()
    router.enqueue("synapse://skill-install?session=session-2")
    await router.drain()

    expect(openSkillRepositoryInstallWindow).toHaveBeenCalledWith({ session: "session-2" })
    expect(focusMainWindow).not.toHaveBeenCalled()
  })

  it("focuses and publishes update URLs received after startup", async () => {
    const focusMainWindow = vi.fn()
    const publishUpdateOpenRequest = vi.fn()
    const router = createProtocolUrlRouter({
      focusMainWindow,
      handleAuthCallback: vi.fn(async () => undefined),
      logger: createLogger(),
      openSkillRepositoryInstallWindow: vi.fn(async () => undefined),
      publishUpdateOpenRequest,
      verifyUpdateIntent: vi.fn(async () => true),
    })

    await router.start()
    router.enqueue("synapse://update?token=credential")
    await router.drain()

    expect(focusMainWindow).toHaveBeenCalledTimes(1)
    expect(publishUpdateOpenRequest).toHaveBeenCalledWith(true)
  })

  it("keeps auth callback focus behavior when auth handling fails", async () => {
    const error = new Error("auth failed")
    const focusMainWindow = vi.fn()
    const logger = createLogger()
    const router = createProtocolUrlRouter({
      ...createUnusedUpdateRouterDeps(),
      focusMainWindow,
      handleAuthCallback: vi.fn(async () => {
        throw error
      }),
      logger,
      openSkillRepositoryInstallWindow: vi.fn(async () => undefined),
    }, ["synapse://auth/desktop/callback?code=auth-code"])

    await router.start()

    expect(logger.warn).toHaveBeenCalledWith("Failed to handle account auth callback.", { error })
    expect(focusMainWindow).toHaveBeenCalledTimes(1)
  })

  it("allows valid cold-start install URLs to skip the normal main window", () => {
    const createRouter = (initialUrls: string[]) => createProtocolUrlRouter({
      ...createUnusedUpdateRouterDeps(),
      focusMainWindow: vi.fn(),
      handleAuthCallback: vi.fn(async () => undefined),
      logger: createLogger(),
      openSkillRepositoryInstallWindow: vi.fn(async () => undefined),
    }, initialUrls)

    expect(
      createRouter(["synapse://skill-install?session=session-1"]).shouldCreateMainWindowBeforeStart(),
    ).toBe(false)
    expect(createRouter([
      "synapse://skill-install?session=session-1",
      "synapse://skill-install?session=session-2",
    ]).shouldCreateMainWindowBeforeStart()).toBe(false)
    expect(createRouter([]).shouldCreateMainWindowBeforeStart()).toBe(true)
    expect(createRouter(["synapse://auth/desktop/callback?code=auth-code"]).shouldCreateMainWindowBeforeStart()).toBe(true)
    expect(createRouter(["synapse://skill-install?session="]).shouldCreateMainWindowBeforeStart()).toBe(true)
    expect(createRouter(["synapse://unknown"]).shouldCreateMainWindowBeforeStart()).toBe(true)
    expect(createRouter(["synapse://update"]).shouldCreateMainWindowBeforeStart()).toBe(true)
  })
})

describe("shouldFocusMainForSecondInstance", () => {
  it("focuses generic launches but leaves every protocol launch to the protocol router", () => {
    expect(shouldFocusMainForSecondInstance(["/Electron"])).toBe(true)
    expect(shouldFocusMainForSecondInstance([
      "/Electron",
      "synapse://skill-install?session=session-1",
    ])).toBe(false)
    expect(shouldFocusMainForSecondInstance([
      "/Electron",
      "synapse://auth/desktop/callback?code=auth-code",
    ])).toBe(false)
    expect(shouldFocusMainForSecondInstance([
      "/Electron",
      "synapse://skill-install?session=",
    ])).toBe(false)
    expect(shouldFocusMainForSecondInstance([
      "/Electron",
      "synapse://unknown",
    ])).toBe(false)
    expect(shouldFocusMainForSecondInstance([
      "/Electron",
      "Synapse://auth/desktop/callback?code=auth-code",
    ])).toBe(false)
  })
})

function createLogger() {
  return { warn: vi.fn() }
}

function createUnusedUpdateRouterDeps() {
  return {
    publishUpdateOpenRequest: vi.fn(),
    verifyUpdateIntent: vi.fn(async () => false),
  }
}
