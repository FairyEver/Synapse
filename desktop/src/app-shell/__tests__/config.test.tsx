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
  repositoryUpdatedListener: null as null | ((event: unknown) => void),
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
  getSynapseBridge: () => ({
    settings: {
      repository: {
        onUpdated: (listener: (event: unknown) => void) => {
          mocks.repositoryUpdatedListener = listener
          return () => {
            mocks.repositoryUpdatedListener = null
          }
        },
      },
    },
  }),
  requireSynapseBridge: () => ({
    config: {
      get: mocks.configGet,
      update: mocks.configUpdate,
    },
    settings: {
      repository: {
        onUpdated: (listener: (event: unknown) => void) => {
          mocks.repositoryUpdatedListener = listener
          return () => {
            mocks.repositoryUpdatedListener = null
          }
        },
      },
    },
  }),
}))

import { AppConfigProvider, useAppConfig } from "../config"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let roots: Root[] = []

beforeEach(() => {
  mocks.configGet.mockReset()
  mocks.configUpdate.mockReset()
  mocks.repositoryUpdatedListener = null
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

  it("refreshes config when user variables change outside the renderer", async () => {
    const firstConfig = {
      ...createDefaultConfig(),
      activeRepoUuid: "repo-1",
      repositories: [{
        uuid: "repo-1",
        name: "Repo",
        localPath: "/repo",
        contentDirs: {},
      }],
      global: {
        ...createDefaultConfig().global,
        variables: [{ name: "OLD", value: "old" }],
      },
    }
    const secondConfig = {
      ...firstConfig,
      global: {
        ...firstConfig.global,
        variables: [{ name: "NEW", value: "new" }],
      },
    }
    mocks.configGet
      .mockResolvedValueOnce(firstConfig)
      .mockResolvedValueOnce(secondConfig)

    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <AppConfigProvider>
          <VariableProbe />
        </AppConfigProvider>,
      )
      await Promise.resolve()
    })

    expect(container.querySelector("[data-testid='variable-probe']")?.textContent).toBe("OLD")

    await act(async () => {
      mocks.repositoryUpdatedListener?.({
        repositoryUuid: "repo-1",
        operation: "variables",
        completedAt: new Date().toISOString(),
      })
      await Promise.resolve()
    })

    expect(container.querySelector("[data-testid='variable-probe']")?.textContent).toBe("NEW")
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

function VariableProbe() {
  const { config } = useAppConfig()

  return (
    <div data-testid="variable-probe">
      {config.global.variables[0]?.name}
    </div>
  )
}
