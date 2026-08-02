/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useGitRepositories } from "../use-git-repositories"

const bridge = vi.hoisted(() => ({
  git: { listRepositorySummaries: vi.fn() },
}))

vi.mock("@/lib/electron-bridge", () => ({
  requireSynapseBridge: () => bridge,
}))

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function HookHarness({ onState }: { readonly onState: (state: ReturnType<typeof useGitRepositories>) => void }) {
  onState(useGitRepositories())
  return null
}

describe("useGitRepositories", () => {
  let root: Root
  const states: Array<ReturnType<typeof useGitRepositories>> = []

  beforeEach(() => {
    states.length = 0
    bridge.git.listRepositorySummaries.mockResolvedValue([])
    const container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    vi.clearAllMocks()
    document.body.innerHTML = ""
  })

  it("refreshes repository summaries when the window regains focus", async () => {
    await act(async () => {
      root.render(<HookHarness onState={(state) => states.push(state)} />)
    })
    expect(bridge.git.listRepositorySummaries).toHaveBeenCalledTimes(1)

    await act(async () => {
      window.dispatchEvent(new Event("focus"))
      await Promise.resolve()
    })

    expect(bridge.git.listRepositorySummaries).toHaveBeenCalledTimes(2)
    expect(states.at(-1)!.loading).toBe(false)
  })
})
