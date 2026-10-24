/** @vitest-environment jsdom */
import { act } from "react"
import { createRoot } from "react-dom/client"
import { expect, it, vi } from "vitest"
const mocks = vi.hoisted(() => ({ listShareImages: vi.fn(), onShareEvent: vi.fn(() => () => undefined) }))
vi.mock("@/lib/electron-bridge", () => ({ getSynapseBridge: () => ({ agent: mocks }) }))
import { useShareResults } from "../use-share-results"
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
it("loads every page and ignores results from the previous conversation", async () => {
  let release!: (rows: unknown[]) => void
  mocks.listShareImages.mockImplementation(({ conversationId, offset }: { conversationId: string; offset: number }) => conversationId === "old" ? new Promise(resolve => { release = resolve }) : Promise.resolve(offset === 0 ? Array.from({ length: 100 }, (_, i) => ({ shareImageRef: String(i) })) : [{ shareImageRef: "last" }]))
  let state!: ReturnType<typeof useShareResults>
  function Test({ id }: { id: string }) { state = useShareResults("project", id); return null }
  const root = createRoot(document.createElement("div"))
  try {
    await act(async () => root.render(<Test id="old" />))
    await act(async () => root.render(<Test id="new" />))
    expect(state.images).toHaveLength(101)
    await act(async () => release([{ shareImageRef: "stale" }]))
    expect(state.images.at(-1)?.shareImageRef).toBe("last")
  } finally { act(() => root.unmount()) }
})
