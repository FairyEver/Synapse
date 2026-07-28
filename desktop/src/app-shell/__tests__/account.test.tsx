// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

import { AccountProvider, useAccount } from "@/app-shell/account"
import type { SynapseAccountState } from "@/types/account"
import type { SynapseBridge } from "@/types/bridge"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null

afterEach(() => {
  if (root) {
    act(() => root?.unmount())
  }
  root = null
  document.body.innerHTML = ""
  delete (window as unknown as { synapse?: SynapseBridge }).synapse
  vi.clearAllMocks()
})

function createDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

function installBridge(startLogin: () => Promise<SynapseAccountState>) {
  const account = {
    getState: vi.fn().mockResolvedValue({ status: "unauthenticated" } satisfies SynapseAccountState),
    startLogin: vi.fn(startLogin),
    cancelLogin: vi.fn(),
    refresh: vi.fn(),
    logout: vi.fn(),
    onStateChanged: vi.fn(() => () => undefined),
  }
  ;(window as unknown as { synapse: SynapseBridge }).synapse = {
    account,
    isPackaged: false,
    platform: "darwin",
    versions: { chrome: "1", electron: "1", node: "1" },
  } as unknown as SynapseBridge
  return account
}

function Probe() {
  const account = useAccount()
  return (
    <button
      data-loading={String(account.isLoading)}
      data-pending={account.pendingAction ?? ""}
      onClick={() => {
        void account.startLogin()
      }}
      type="button"
    >
      login
    </button>
  )
}

describe("AccountProvider", () => {
  it("marks login as pending while startLogin IPC is in flight", async () => {
    const login = createDeferred<SynapseAccountState>()
    const accountBridge = installBridge(() => login.promise)
    const container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () => {
      root?.render(
        <AccountProvider>
          <Probe />
        </AccountProvider>,
      )
    })
    await act(async () => {})

    const button = container.querySelector("button")
    expect(button?.dataset.loading).toBe("false")

    await act(async () => {
      button?.click()
    })

    expect(accountBridge.startLogin).toHaveBeenCalledTimes(1)
    expect(button?.dataset.pending).toBe("login")

    await act(async () => {
      login.resolve({ status: "authenticating", loginUrl: "https://example.com/login" })
      await login.promise
    })

    expect(button?.dataset.pending).toBe("")
  })

  it("marks login cancellation as pending and uses the dedicated bridge method", async () => {
    const accountBridge = installBridge(async () => ({ status: "unauthenticated" }))
    const cancellation = createDeferred<SynapseAccountState>()
    accountBridge.cancelLogin.mockImplementation(() => cancellation.promise)
    const container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)

    function CancelProbe() {
      const account = useAccount()
      return (
        <button
          data-pending={account.pendingAction ?? ""}
          onClick={() => {
            void account.cancelLogin()
          }}
          type="button"
        >
          cancel
        </button>
      )
    }

    await act(async () => {
      root?.render(
        <AccountProvider>
          <CancelProbe />
        </AccountProvider>,
      )
    })
    await act(async () => {})

    const button = container.querySelector("button")
    await act(async () => {
      button?.click()
    })

    expect(accountBridge.cancelLogin).toHaveBeenCalledTimes(1)
    expect(accountBridge.logout).not.toHaveBeenCalled()
    expect(button?.dataset.pending).toBe("cancelLogin")

    await act(async () => {
      cancellation.resolve({ status: "unauthenticated" })
      await cancellation.promise
    })

    expect(button?.dataset.pending).toBe("")
  })
})
