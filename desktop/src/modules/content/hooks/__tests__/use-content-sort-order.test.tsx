/**
 * @vitest-environment jsdom
 */
import { act, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { SynapseConfig } from "@/types/config"

const mocks = vi.hoisted(() => ({
  notifyError: vi.fn(),
  logger: {
    error: vi.fn(),
    info: vi.fn(),
  },
  updateConfig: vi.fn(),
}))

vi.mock("@/app-shell/config", () => ({
  useAppConfig: () => ({
    config: { global: { contentSortOrder: "modified-desc" } } as SynapseConfig,
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

import { useContentSortOrder } from "../use-content-sort-order"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let roots: Root[] = []

function TestSortOrder({ children }: { readonly children?: ReactNode }) {
  const { setSortOrder, sortOrder } = useContentSortOrder()

  return (
    <button
      type="button"
      data-sort-order={sortOrder}
      onClick={() => {
        void setSortOrder("name-asc")
      }}
    >
      {children ?? "排序"}
    </button>
  )
}

async function renderHookHarness() {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)

  await act(async () => {
    root.render(<TestSortOrder />)
  })
}

afterEach(() => {
  for (const root of roots) {
    act(() => root.unmount())
  }
  roots = []
  document.body.innerHTML = ""
  vi.clearAllMocks()
})

describe("useContentSortOrder", () => {
  it("handles config update failures without leaking a rejected promise", async () => {
    mocks.updateConfig.mockRejectedValue(new Error("config write failed"))

    await renderHookHarness()
    await act(async () => {
      document.querySelector<HTMLButtonElement>("button")?.click()
      await Promise.resolve()
    })

    expect(mocks.updateConfig).toHaveBeenCalledWith({
      global: { contentSortOrder: "name-asc" },
    })
    expect(mocks.logger.error).toHaveBeenCalledWith("Failed to save content sort order.", expect.objectContaining({
      from: "modified-desc",
      to: "name-asc",
    }))
    expect(mocks.notifyError).toHaveBeenCalledWith("排序保存失败，请稍后重试。")
    expect(document.querySelector<HTMLButtonElement>("button")?.dataset.sortOrder).toBe("modified-desc")
  })
})
