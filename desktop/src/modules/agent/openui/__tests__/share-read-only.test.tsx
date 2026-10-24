/** @vitest-environment jsdom */
import { act } from "react"
import { createRoot } from "react-dom/client"
import { expect, it, vi } from "vitest"
import { useGeneratedUi } from "../use-generated-ui"
const bridge = vi.hoisted(() => ({ getGeneratedUiState: vi.fn(), saveGeneratedUiState: vi.fn(), submitGeneratedUiAction: vi.fn() }))
vi.mock("@/lib/electron-bridge", () => ({ requireBridgeDomain: () => bridge }))
vi.mock("@/app-shell/logging", () => ({ createRendererLogger: () => ({ warn: vi.fn() }) }))
vi.mock("@/lib/ui-tracking", () => ({ track: vi.fn() }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

it("share rendering can restore state but never persist normalization, submit, or save on unmount", async () => {
  vi.useFakeTimers()
  bridge.getGeneratedUiState.mockResolvedValue({ revision: 2, state: { filter: "week" }, readOnly: false })
  bridge.saveGeneratedUiState.mockResolvedValue({ revision: 3, state: {}, readOnly: false })
  let controller: ReturnType<typeof useGeneratedUi>
  function Driver() { controller = useGeneratedUi({ projectId: "p", conversationId: "c", blockId: "b" }, true); return null }
  const root = createRoot(document.createElement("div"))
  try {
    await act(async () => root.render(<Driver />))
    act(() => controller!.stateChanged({ filter: "changed-by-initial-render" }))
    await act(async () => vi.advanceTimersByTimeAsync(1000))
    expect(controller!.snapshot.state).toEqual({ filter: "week" })
    expect(bridge.saveGeneratedUiState).not.toHaveBeenCalled()
    expect(bridge.submitGeneratedUiAction).not.toHaveBeenCalled()
  } finally {
    await act(async () => root.unmount())
    vi.useRealTimers()
  }
  expect(bridge.saveGeneratedUiState).not.toHaveBeenCalled()
})
