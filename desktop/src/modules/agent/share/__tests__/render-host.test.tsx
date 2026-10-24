/** @vitest-environment jsdom */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import { AgentShareRenderHost } from "../render-host"
import type { ShareDomainEvent, ShareRenderRequest } from "../../../../../app-capabilities/agent/shared/share"
const mocks = vi.hoisted(() => ({ listener: undefined as undefined | ((e: ShareDomainEvent) => void), complete: vi.fn(), capture: vi.fn(), base64: vi.fn() }))
vi.mock("@/lib/electron-bridge", () => ({ getSynapseBridge: () => ({ agent: { onShareEvent: (fn: (e: ShareDomainEvent) => void) => { mocks.listener = fn; return () => { mocks.listener = undefined } }, completeShareRender: mocks.complete } }) }))
vi.mock("../image", () => ({ captureShareImage: mocks.capture, shareBlobBase64: mocks.base64 }))
vi.mock("../share-paper", () => ({ AgentSharePaper: ({ paperRef }: { paperRef: (node: HTMLElement | null) => void }) => <article ref={paperRef}>original</article> }))
vi.mock("../../openui/generated-ui-theme", () => ({ GeneratedUiTheme: ({ children }: { children: React.ReactNode }) => children }))
vi.mock("@/app-shell/logging", () => ({ createRendererLogger: () => ({ warn: vi.fn() }) }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let root: Root | undefined
afterEach(() => { act(() => root?.unmount()); root = undefined; vi.resetAllMocks() })
const request: ShareRenderRequest = { requestId: "r", nonce: "n", projectId: "p", conversationId: "c", messages: [], generatedUi: {}, settings: { width: 720, scale: 2, redact: true, showModel: true, showTime: true } }
describe("share render host", () => {
  it("renders from the host snapshot and returns only the exact request identity", async () => {
    mocks.capture.mockResolvedValue(new Blob()); mocks.base64.mockResolvedValue("png"); mocks.complete.mockResolvedValue({ success: true })
    root = createRoot(document.createElement("div")); await act(async () => { root!.render(<AgentShareRenderHost />) })
    await act(async () => { mocks.listener?.({ domain: "agent", type: "shareRender", payload: request }) })
    expect(mocks.complete).toHaveBeenCalledWith({ requestId: "r", nonce: "n", projectId: "p", conversationId: "c", pngBase64: "png" })
    expect(mocks.capture.mock.calls[0]?.[1]).toBe(2)
  })
  it("does not publish a late capture after the host unmounts", async () => {
    let finish!: (blob: Blob) => void
    mocks.capture.mockImplementation(() => new Promise<Blob>(resolve => { finish = resolve }))
    root = createRoot(document.createElement("div")); await act(async () => { root!.render(<AgentShareRenderHost />) })
    await act(async () => { mocks.listener?.({ domain: "agent", type: "shareRender", payload: request }) })
    act(() => root!.unmount()); root = undefined
    await act(async () => { finish(new Blob()) })
    expect(mocks.complete).not.toHaveBeenCalled()
  })
})
