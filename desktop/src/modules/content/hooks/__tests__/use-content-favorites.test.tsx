/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { SynapseContentType } from "@/types/content"
import type { SynapseConfig } from "@/types/config"

const mocks = vi.hoisted(() => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
  },
  notifyError: vi.fn(),
  updateConfig: vi.fn(),
}))

vi.mock("@/app-shell/config", () => ({
  useAppConfig: () => ({
    config: ({
      global: {
        favorites: {
          prompt: [],
          rule: [],
          skill: [],
        },
      },
    } as unknown) as SynapseConfig,
    updateConfig: mocks.updateConfig,
  }),
}))

vi.mock("@/app-shell/logging", () => ({
  createRendererLogger: () => mocks.logger,
}))

vi.mock("@/app-shell/notifications", () => ({
  useAppNotifications: () => ({
    error: mocks.notifyError,
  }),
}))

import { useContentFavorites } from "../use-content-favorites"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let roots: Root[] = []
let toggleFavorite: ((type: SynapseContentType, contentId: string) => Promise<void>) | null = null

function TestFavorites() {
  toggleFavorite = useContentFavorites().toggleFavorite
  return null
}

async function renderHookHarness() {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)

  await act(async () => {
    root.render(<TestFavorites />)
  })
}

afterEach(() => {
  for (const root of roots) {
    act(() => root.unmount())
  }
  roots = []
  toggleFavorite = null
  document.body.innerHTML = ""
  vi.clearAllMocks()
})

describe("useContentFavorites", () => {
  it("handles config update failures without rethrowing to fire-and-forget callers", async () => {
    mocks.updateConfig.mockRejectedValue(new Error("config write failed"))

    await renderHookHarness()

    expect(toggleFavorite).not.toBeNull()
    await expect(toggleFavorite!("prompt", "prompt-1")).resolves.toBeUndefined()

    expect(mocks.updateConfig).toHaveBeenCalledWith({
      global: {
        favorites: {
          prompt: ["prompt-1"],
          rule: [],
          skill: [],
        },
      },
    })
    expect(mocks.logger.error).toHaveBeenCalledWith("Failed to update favorite.", expect.objectContaining({
      contentId: "prompt-1",
      contentType: "prompt",
      isFavorite: true,
    }))
    expect(mocks.notifyError).toHaveBeenCalledWith("收藏更新失败，请稍后重试。")
  })
})
