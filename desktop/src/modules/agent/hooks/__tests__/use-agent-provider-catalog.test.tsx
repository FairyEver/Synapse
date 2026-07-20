/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { useAgentProviderCatalog } from "../use-agent-provider-catalog"

const logger = vi.hoisted(() => ({ warn: vi.fn() }))

vi.mock("@/app-shell/logging", () => ({
  createRendererLogger: () => logger,
}))

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let container: HTMLDivElement | null = null

beforeEach(() => {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  if (root) act(() => root?.unmount())
  root = null
  container = null
  document.body.innerHTML = ""
  delete (window as unknown as { synapse?: unknown }).synapse
  vi.clearAllMocks()
})

describe("useAgentProviderCatalog", () => {
  it("loads providers only while enabled and exposes loading state", async () => {
    const request = deferred<ReturnType<typeof providerCatalog>>()
    const listAllProviders = vi.fn(() => request.promise)
    installBridge(listAllProviders)

    await renderDriver(true)
    expect(readState()).toEqual({ count: 0, error: false, loading: true })

    await act(async () => {
      request.resolve(providerCatalog())
      await request.promise
    })

    expect(readState()).toEqual({ count: 1, error: false, loading: false })
    await renderDriver(false)
    expect(listAllProviders).toHaveBeenCalledTimes(1)
  })

  it("exposes a sanitized failure and supports retry", async () => {
    const rawError = new Error("provider failed token=sk-secret")
    const listAllProviders = vi.fn()
      .mockRejectedValueOnce(rawError)
      .mockResolvedValueOnce(providerCatalog())
    installBridge(listAllProviders)

    await renderDriver(true)
    expect(readState()).toEqual({ count: 0, error: true, loading: false })
    expect(logger.warn).toHaveBeenCalledWith("Agent session model list failed.", {
      boundary: "renderer.agent.session-create-model-list",
      errorName: "Error",
      errorLength: rawError.message.length,
    })
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("sk-secret")

    await act(async () => {
      document.querySelector<HTMLButtonElement>("button")?.click()
      await Promise.resolve()
    })

    expect(readState()).toEqual({ count: 1, error: false, loading: false })
    expect(listAllProviders).toHaveBeenCalledTimes(2)
  })

  it("ignores a request that finishes after the hook is disabled", async () => {
    const request = deferred<ReturnType<typeof providerCatalog>>()
    installBridge(vi.fn(() => request.promise))

    await renderDriver(true)
    await renderDriver(false)
    expect(readState()).toEqual({ count: 0, error: false, loading: false })

    await act(async () => {
      request.resolve(providerCatalog())
      await request.promise
    })

    expect(readState()).toEqual({ count: 0, error: false, loading: false })
  })
})

function Driver({ enabled }: { readonly enabled: boolean }) {
  const { providers, isLoading, hasError, reload } = useAgentProviderCatalog(enabled)
  return (
    <button
      type="button"
      data-count={providers?.length ?? 0}
      data-error={hasError}
      data-loading={isLoading}
      onClick={() => void reload()}
    >
      reload
    </button>
  )
}

async function renderDriver(enabled: boolean): Promise<void> {
  await act(async () => {
    root?.render(<Driver enabled={enabled} />)
    await Promise.resolve()
  })
}

function readState(): { count: number; error: boolean; loading: boolean } {
  const button = document.querySelector<HTMLButtonElement>("button")
  return {
    count: Number(button?.dataset.count ?? 0),
    error: button?.dataset.error === "true",
    loading: button?.dataset.loading === "true",
  }
}

function installBridge(listAllProviders: ReturnType<typeof vi.fn>): void {
  Object.defineProperty(window, "synapse", {
    configurable: true,
    value: { agent: { listAllProviders } },
  })
}

function providerCatalog() {
  return [{
    id: "provider-1",
    name: "Provider 1",
    category: "official" as const,
    active: true,
    archived: false,
    model: "model-1",
  }]
}

function deferred<T>(): {
  readonly promise: Promise<T>
  readonly resolve: (value: T) => void
} {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => { resolve = next })
  return { promise, resolve }
}
