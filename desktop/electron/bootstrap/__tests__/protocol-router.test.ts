import { describe, expect, it, vi } from "vitest"

import {
  createProtocolUrlRouter,
  shouldFocusMainForSecondInstance,
} from "../protocol-router"

describe("createProtocolUrlRouter", () => {
  it("routes auth callbacks and valid install URLs while draining multiple pending URLs", async () => {
    const handleAuthCallback = vi.fn(async () => undefined)
    const openInstallWindow = vi.fn(async () => undefined)
    const focusMainWindow = vi.fn()
    const logger = createLogger()
    const router = createProtocolUrlRouter({
      focusMainWindow,
      handleAuthCallback,
      logger,
      openInstallWindow,
    }, [
      "synapse://auth/desktop/callback?code=auth-code",
      "synapse://content-install?session=session-1",
      "synapse://content-install?session=",
    ])

    const authCallbackCount = await router.start()

    expect(authCallbackCount).toBe(1)
    expect(handleAuthCallback).toHaveBeenCalledWith("synapse://auth/desktop/callback?code=auth-code")
    expect(openInstallWindow).toHaveBeenCalledWith({ session: "session-1" })
    expect(logger.warn).toHaveBeenCalledWith("Ignored invalid content store install URL.")
    expect(focusMainWindow).toHaveBeenCalledTimes(2)
  })

  it("waits for account preparation before opening pending install windows", async () => {
    const calls: string[] = []
    const router = createProtocolUrlRouter({
      focusMainWindow: vi.fn(),
      handleAuthCallback: vi.fn(async () => {
        calls.push("auth")
      }),
      logger: createLogger(),
      openInstallWindow: vi.fn(async () => {
        calls.push("install")
      }),
    }, [
      "synapse://auth/desktop/callback?code=auth-code",
      "synapse://content-install?session=session-1",
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
      focusMainWindow: vi.fn(),
      handleAuthCallback: vi.fn(async () => {
        calls.push("auth")
      }),
      logger: createLogger(),
      openInstallWindow: vi.fn(async () => {
        calls.push("install")
      }),
    }, ["synapse://content-install?session=session-1"])

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
      focusMainWindow,
      handleAuthCallback: vi.fn(async () => undefined),
      logger,
      openInstallWindow: vi.fn(async () => undefined),
    }, ["synapse://content-install/%", "synapse://unknown"])

    await router.start()

    expect(logger.warn).toHaveBeenCalledTimes(2)
    expect(focusMainWindow).toHaveBeenCalledTimes(2)
  })

  it("opens install URLs received after startup without focusing the main window", async () => {
    const openInstallWindow = vi.fn(async () => undefined)
    const focusMainWindow = vi.fn()
    const router = createProtocolUrlRouter({
      focusMainWindow,
      handleAuthCallback: vi.fn(async () => undefined),
      logger: createLogger(),
      openInstallWindow,
    })

    await router.start()
    router.enqueue("synapse://content-install?session=session-2")
    await router.drain()

    expect(openInstallWindow).toHaveBeenCalledWith({ session: "session-2" })
    expect(focusMainWindow).not.toHaveBeenCalled()
  })

  it("keeps auth callback focus behavior when auth handling fails", async () => {
    const error = new Error("auth failed")
    const focusMainWindow = vi.fn()
    const logger = createLogger()
    const router = createProtocolUrlRouter({
      focusMainWindow,
      handleAuthCallback: vi.fn(async () => {
        throw error
      }),
      logger,
      openInstallWindow: vi.fn(async () => undefined),
    }, ["synapse://auth/desktop/callback?code=auth-code"])

    await router.start()

    expect(logger.warn).toHaveBeenCalledWith("Failed to handle account auth callback.", { error })
    expect(focusMainWindow).toHaveBeenCalledTimes(1)
  })
})

describe("shouldFocusMainForSecondInstance", () => {
  it("focuses generic launches but leaves every protocol launch to the protocol router", () => {
    expect(shouldFocusMainForSecondInstance(["/Electron"])).toBe(true)
    expect(shouldFocusMainForSecondInstance([
      "/Electron",
      "synapse://content-install?session=session-1",
    ])).toBe(false)
    expect(shouldFocusMainForSecondInstance([
      "/Electron",
      "synapse://auth/desktop/callback?code=auth-code",
    ])).toBe(false)
    expect(shouldFocusMainForSecondInstance([
      "/Electron",
      "synapse://content-install?session=",
    ])).toBe(false)
    expect(shouldFocusMainForSecondInstance([
      "/Electron",
      "synapse://unknown",
    ])).toBe(false)
  })
})

function createLogger() {
  return { warn: vi.fn() }
}
