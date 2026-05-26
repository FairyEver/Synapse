/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createDefaultConfig } from "@/lib/config"

const mocks = vi.hoisted(() => ({
  configGet: vi.fn(),
  configUpdate: vi.fn(),
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}))

vi.mock("@/app-shell/logging", () => ({
  createRendererLogger: () => mocks.logger,
}))

vi.mock("@/lib/electron-bridge", () => ({
  requireSynapseBridge: () => ({
    config: {
      get: mocks.configGet,
      update: mocks.configUpdate,
    },
  }),
}))

import { AppConfigProvider, useAppConfig } from "../config"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let roots: Root[] = []

beforeEach(() => {
  mocks.configGet.mockReset()
  mocks.configUpdate.mockReset()
  for (const fn of Object.values(mocks.logger)) fn.mockClear()
})

afterEach(() => {
  for (const root of roots) {
    act(() => {
      root.unmount()
    })
  }
  roots = []
  document.body.innerHTML = ""
})

describe("AppConfigProvider", () => {
  it("blocks children and retries when the initial config load fails", async () => {
    const loadedConfig = {
      ...createDefaultConfig(),
      activeRepoUuid: "repo-1",
      repositories: [{
        uuid: "repo-1",
        name: "Repo",
        path: "/repo",
      }],
    }
    mocks.configGet
      .mockRejectedValueOnce(new Error("disk busy"))
      .mockResolvedValueOnce(loadedConfig)

    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <AppConfigProvider>
          <ConfigProbe />
        </AppConfigProvider>,
      )
      await Promise.resolve()
    })

    expect(container.querySelector("[data-testid='config-probe']")).toBeNull()
    expect(container.textContent).toContain("无法读取配置")
    expect(container.textContent).toContain("disk busy")

    const retryButton = container.querySelector("button")
    expect(retryButton).not.toBeNull()

    await act(async () => {
      retryButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      await Promise.resolve()
    })

    const probe = container.querySelector("[data-testid='config-probe']")
    expect(probe?.textContent).toBe("repo-1:1:true")
  })
})

function ConfigProbe() {
  const { config, isReady } = useAppConfig()

  return (
    <div data-testid="config-probe">
      {config.activeRepoUuid}:{config.repositories.length}:{String(isReady)}
    </div>
  )
}
