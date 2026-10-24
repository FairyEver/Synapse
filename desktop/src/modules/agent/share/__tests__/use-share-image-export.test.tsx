/** @vitest-environment jsdom */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import { DEFAULT_AGENT_SHARE_SETTINGS as settings } from "@/types/agent-share"
import { useShareImageExport } from "../use-share-image-export"

const mocks = vi.hoisted(() => ({ capture: vi.fn(), base64: vi.fn(), export: vi.fn(), toast: vi.fn() }))
vi.mock("../image", () => ({ captureShareImage: mocks.capture, shareBlobBase64: mocks.base64 }))
vi.mock("@/lib/electron-bridge", () => ({ requireBridgeDomain: () => ({ exportShareImage: mocks.export }) }))
vi.mock("@/app-shell/logging", () => ({ createRendererLogger: () => ({ warn: vi.fn() }) }))
vi.mock("@/lib/ui-tracking", () => ({ track: vi.fn() }))
vi.mock("sonner", () => ({ toast: mocks.toast }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let root: Root | undefined
let output: ReturnType<typeof useShareImageExport>
function Driver({ scope = "one" }: { scope?: string }) { output = useShareImageExport(scope); return null }
function mount() { root = createRoot(document.createElement("div")); act(() => root!.render(<Driver />)) }
afterEach(() => { act(() => root?.unmount()); root = undefined; vi.resetAllMocks() })

describe("native share output lifecycle", () => {
  it("serializes duplicate clicks, awaits real output, and uses a fixed filename without the conversation title", async () => {
    let complete!: (value: { success: boolean }) => void
    mocks.capture.mockResolvedValue(new Blob()); mocks.base64.mockResolvedValue("png")
    mocks.export.mockImplementation(() => new Promise((resolve) => { complete = resolve }))
    mount(); const paper = document.createElement("article")
    let pending!: Promise<void>
    await act(async () => { pending = output.run(paper, settings, "copy"); void output.run(paper, settings, "save") })
    expect(mocks.capture).toHaveBeenCalledTimes(1)
    expect(output.busy).toBe("copy"); expect(mocks.toast).not.toHaveBeenCalled()
    expect(mocks.export).toHaveBeenCalledWith(expect.objectContaining({ action: "copy", pngBase64: "png", fileName: "Synapse 对话-2x.png" }))
    await act(async () => { complete({ success: true }); await pending })
    expect(output.busy).toBeNull(); expect(mocks.toast).toHaveBeenCalledWith("图片已复制")
  })
  it("treats save cancellation as cancellation, and lets a failed export retry", async () => {
    mocks.capture.mockResolvedValue(new Blob()); mocks.base64.mockResolvedValue("png")
    mocks.export.mockResolvedValueOnce({ success: false }).mockRejectedValueOnce(new Error("disk full")).mockResolvedValueOnce({ success: true })
    mount(); const paper = document.createElement("article")
    await act(() => output.run(paper, settings, "save")); expect(mocks.toast).not.toHaveBeenCalled(); expect(output.error).toBeNull()
    await act(() => output.run(paper, settings, "save")); expect(output.error).toBe("disk full"); expect(output.busy).toBeNull()
    await act(() => output.run(paper, settings, "save")); expect(output.error).toBeNull(); expect(mocks.toast).toHaveBeenCalledWith("图片已保存")
  })
  it("abandons stale generation on conversation changes before any native write", async () => {
    let complete!: (blob: Blob) => void
    mocks.capture.mockImplementation(() => new Promise((resolve) => { complete = resolve })); mocks.base64.mockResolvedValue("png")
    mount(); let pending!: Promise<void>
    act(() => { pending = output.run(document.createElement("article"), settings, "save") })
    act(() => root!.render(<Driver scope="two" />))
    await act(async () => { complete(new Blob()); await pending })
    expect(mocks.export).not.toHaveBeenCalled(); expect(mocks.toast).not.toHaveBeenCalled(); expect(output.error).toBeNull()
  })
})
