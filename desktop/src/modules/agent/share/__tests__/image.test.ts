/** @vitest-environment jsdom */
import { Blob as NodeBlob } from "node:buffer"
import { afterEach, describe, expect, it, vi } from "vitest"
import { captureShareImage } from "../image"
const engine = vi.hoisted(() => ({ capture: vi.fn(), toBlob: vi.fn() }))
vi.mock("@zumer/snapdom", () => ({ snapdom: engine.capture }))
function png(width = 1440, height = 200) {
  const bytes = new Uint8Array(24); bytes.set([137,80,78,71,13,10,26,10]); const view = new DataView(bytes.buffer); view.setUint32(16,width); view.setUint32(20,height)
  return new NodeBlob([bytes], { type: "image/png" })
}
function paper() { const node = document.createElement("article"); node.style.width="720px"; document.body.append(node); return node }
afterEach(() => { document.body.innerHTML=""; vi.restoreAllMocks(); vi.clearAllMocks() })
describe("share PNG generation", () => {
  it("renders an unscaled isolated capture with explicit scale and DPR and cleans up", async () => {
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(720)
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(100)
    engine.capture.mockResolvedValue({ toBlob: engine.toBlob, warnings: [] }); engine.toBlob.mockResolvedValue(png())
    const node=paper(); const result=await captureShareImage(node,2,"save",new AbortController().signal)
    expect(result.type).toBe("image/png")
    expect(engine.capture).toHaveBeenCalledWith(expect.any(HTMLElement),expect.objectContaining({ scale:2,dpr:1 }))
    expect(engine.capture.mock.calls[0]![0]).not.toBe(node)
    expect(engine.toBlob).toHaveBeenCalledWith({format:"png",scale:2,dpr:1})
    expect(document.querySelector("[data-agent-share-capture]")).toBeNull()
  })
  it("rejects silent downscaling and resource warnings rather than returning a blurry or incomplete image", async () => {
    vi.spyOn(HTMLElement.prototype,"offsetWidth","get").mockReturnValue(720); vi.spyOn(HTMLElement.prototype,"offsetHeight","get").mockReturnValue(100)
    engine.capture.mockResolvedValue({toBlob:engine.toBlob,warnings:[]});engine.toBlob.mockResolvedValue(png(720,100))
    await expect(captureShareImage(paper(),2,"save",new AbortController().signal)).rejects.toThrow("清晰度")
    engine.toBlob.mockResolvedValue(png());engine.capture.mockResolvedValue({toBlob:engine.toBlob,warnings:[{code:"image-fallback"}]})
    await expect(captureShareImage(paper(),2,"save",new AbortController().signal)).rejects.toThrow("完整")
    expect(document.querySelector("[data-agent-share-capture]")).toBeNull()
  })
  it("refuses failed generated UI, unsupported frames, and aborted output", async () => {
    const node=paper();node.innerHTML='<p data-agent-render-error>failure</p>'
    await expect(captureShareImage(node,2,"save",new AbortController().signal)).rejects.toThrow("图表")
    node.innerHTML='<iframe></iframe>'
    await expect(captureShareImage(node,2,"save",new AbortController().signal)).rejects.toThrow("网页")
    const controller=new AbortController();controller.abort()
    await expect(captureShareImage(node,2,"save",controller.signal)).rejects.toThrow()
    expect(engine.capture).not.toHaveBeenCalled()
  })

  it("does not silently crop overflowing chart or table content", async () => {
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(720)
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(100)
    const node = paper(); const content = document.createElement("div"); content.dataset.agentGeneratedUi = ""; content.style.overflowX = "auto"; node.append(content)
    Object.defineProperties(content, { clientWidth: { value: 600 }, scrollWidth: { value: 1200 } })
    await expect(captureShareImage(node, 2, "save", new AbortController().signal)).rejects.toThrow("宽版")
    expect(engine.capture).not.toHaveBeenCalled()
  })
})
