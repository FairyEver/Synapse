/** @vitest-environment jsdom */
import { act } from "react"
import { createRoot } from "react-dom/client"
import { expect, it, vi } from "vitest"
import { registerNavigationGuard, runAppNavigation } from "../../navigation-guard"
import { useMainNavigation } from "../use-main-navigation"
import type { MainNavigationRequest } from "@/modules/apps/main-navigation"

const mocks = vi.hoisted(() => ({
  apps: {
    onMainNavigationRequested: vi.fn(),
    getPendingMainNavigation: vi.fn(),
    acknowledgeMainNavigation: vi.fn(async () => undefined),
  },
}))
vi.mock("@/lib/electron-bridge", () => ({ getSynapseBridge: () => mocks }))

it("ignores a stale pull result, acknowledges blocked navigation, and consumes a later click once", async () => {
  const host = document.createElement("div")
  const root = createRoot(host)
  let receive!: (request: MainNavigationRequest) => void
  let finishRead!: (request: MainNavigationRequest) => void
  mocks.apps.onMainNavigationRequested.mockImplementation((listener) => {
    receive = listener
    return () => undefined
  })
  mocks.apps.getPendingMainNavigation.mockReturnValue(new Promise((resolve) => { finishRead = resolve }))
  const request = (id: number): MainNavigationRequest => ({
    id, ownerId: null, destination: { appId: "todos", target: { id: `todo-${id}`, requestId: String(id) } },
  })
  const applied: string[] = []
  function Harness() {
    const nav = useMainNavigation((destination, apply) => runAppNavigation(() => {
      if (apply() && destination.appId === "todos") applied.push(destination.target.id)
    }))
    return <button onClick={() => { if (nav.pending) nav.complete(nav.pending) }}>consume</button>
  }
  let release = registerNavigationGuard(() => false)
  const actEnv = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  const previousActEnv = actEnv.IS_REACT_ACT_ENVIRONMENT
  actEnv.IS_REACT_ACT_ENVIRONMENT = true
  try {
    await act(async () => { root.render(<Harness />) })
    await act(async () => { receive(request(2)); finishRead(request(1)) })
    expect(applied).toEqual([])
    expect(mocks.apps.acknowledgeMainNavigation.mock.calls).toEqual([[2]])

    release()
    release = () => undefined
    await act(async () => { receive(request(3)); receive(request(3)) })
    expect(applied).toEqual(["todo-3"])
    await act(async () => { host.querySelector("button")?.click() })
    expect(mocks.apps.acknowledgeMainNavigation.mock.calls).toEqual([[2], [3]])
  } finally {
    release()
    await act(async () => { root.unmount() })
    actEnv.IS_REACT_ACT_ENVIRONMENT = previousActEnv
  }
})
