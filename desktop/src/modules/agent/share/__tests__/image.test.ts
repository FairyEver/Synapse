/** @vitest-environment jsdom */
import { Blob as NodeBlob } from "node:buffer"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { captureShareImage } from "../image"
const engine = vi.hoisted(() => ({ capture: vi.fn(), toBlob: vi.fn(), warn: vi.fn(), readResource: vi.fn() }))
vi.mock("@zumer/snapdom", () => ({ snapdom: engine.capture }))
vi.mock("@/app-shell/logging", () => ({ createRendererLogger: () => ({ warn: engine.warn }) }))
vi.mock("@/lib/electron-bridge", () => ({ getSynapseBridge: () => ({ agent: { readShareImageResource: engine.readResource } }) }))
function png(width = 1440, height = 200) {
  const bytes = new Uint8Array(24); bytes.set([137,80,78,71,13,10,26,10]); const view = new DataView(bytes.buffer); view.setUint32(16,width); view.setUint32(20,height)
  return new NodeBlob([bytes], { type: "image/png" })
}
function resourceResponse(content: string, type = "image/png") { return new Response(new TextEncoder().encode(content), { headers: { "content-type": type } }) }
function paper() { const node = document.createElement("article"); node.style.width="720px"; document.body.append(node); return node }
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(720)
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(100)
  const computedStyle = getComputedStyle
  vi.stubGlobal("getComputedStyle", (node: Element, pseudo?: string) => pseudo ? document.createElement("div").style : computedStyle(node))
  engine.capture.mockResolvedValue({ toBlob: engine.toBlob, warnings: [] })
  engine.toBlob.mockResolvedValue(png())
  engine.readResource.mockRejectedValue(new Error("远端图片无法读取。"))
  Object.defineProperty(HTMLImageElement.prototype, "decode", { configurable: true, value: vi.fn().mockResolvedValue(undefined) })
  vi.spyOn(HTMLImageElement.prototype, "complete", "get").mockReturnValue(true)
  vi.spyOn(HTMLImageElement.prototype, "naturalWidth", "get").mockReturnValue(40)
  vi.spyOn(HTMLImageElement.prototype, "naturalHeight", "get").mockReturnValue(20)
})
afterEach(() => {
  document.body.innerHTML=""; vi.restoreAllMocks(); vi.resetAllMocks(); vi.unstubAllGlobals()
  Reflect.deleteProperty(HTMLImageElement.prototype, "decode")
})
describe("share PNG generation", () => {
  it("allows bounded automatic image loading to continue beyond the manual preview wait", async () => {
    vi.useFakeTimers()
    try {
      const node = paper(); node.innerHTML = '<span data-agent-render-pending>加载中</span>'
      let outcome: { error?: unknown; blob?: Blob } | undefined
      const renderContext = { requestId: "request-1", nonce: "nonce-1", projectId: "project-1", conversationId: "conversation-1" }
      const task = captureShareImage(node, 2, "save", new AbortController().signal, renderContext)
        .then(blob => { outcome = { blob } }, error => { outcome = { error } })
      await vi.advanceTimersByTimeAsync(16_000)
      expect(outcome).toBeUndefined()
      node.innerHTML = "authorized content"
      await vi.advanceTimersByTimeAsync(200)
      await task
      expect(outcome).toMatchObject({ blob: expect.objectContaining({ type: "image/png" }) })
    } finally { vi.useRealTimers() }
  })
  it("calibrates inline text layout so ordinary Markdown can be exported", async () => {
    engine.capture.mockImplementation(async (_node, options) => ({
      toBlob: engine.toBlob,
      warnings: options.reconcile ? [] : [{ code: "reconcile-risk", message: "text may wrap differently" }],
    }))
    const node = paper(); node.innerHTML = '<p><strong>峰值</strong> <code>dataComplete: true</code></p>'
    await expect(captureShareImage(node, 2, "save", new AbortController().signal)).resolves.toHaveProperty("type", "image/png")
  })

  it.each(["image-fallback", "raster-clamp", "canvas-clamp", "reconcile-risk", "backdrop-filter-failed", "selection-compose-failed", "shrink-failed", "future-warning"])("blocks %s and records safe, specific diagnostics", async (code) => {
    engine.capture.mockResolvedValue({ toBlob: engine.toBlob, warnings: [{ code, message: "https://private.example/image?token=secret", detail: { content: "private" } }] })
    await expect(captureShareImage(paper(), 2, "save", new AbortController().signal)).rejects.toThrow()
    expect(engine.warn).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ warningCodes: [code], action: "save", scale: 2 }))
    expect(JSON.stringify(engine.warn.mock.calls)).not.toMatch(/private|secret/)
    expect(document.querySelector("[data-agent-share-capture]")).toBeNull()
  })

  it.each(["https://images.example/photo.png", "blob:https://synapse.example/temporary", "synapse-agent-artifact://local/p/s/photo.png", "file:///tmp/photo.png"])("embeds %s before the capture engine reads it", async (src) => {
    const fetchImage = vi.fn().mockResolvedValue(resourceResponse("pixels", "image/png"))
    vi.stubGlobal("fetch", fetchImage)
    const node = paper(); const image = document.createElement("img"); image.src = src; node.append(image)
    await captureShareImage(node, 2, "copy", new AbortController().signal)
    const snapshot = engine.capture.mock.calls[0]![0] as HTMLElement
    expect(snapshot.querySelector("img")?.src).toBe("data:image/png;base64,cGl4ZWxz")
    expect(image.src).toBe(src)
    expect(HTMLImageElement.prototype.decode).toHaveBeenCalled()
  })

  it("freezes currentSrc and removes responsive picture sources only from the export copy", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(resourceResponse("selected", "image/webp")))
    const node = paper(); node.innerHTML = '<picture><source srcset="https://images.example/wide.webp"><img src="https://images.example/small.png" srcset="https://images.example/large.png 2x" sizes="100vw"></picture>'
    const image = node.querySelector("img")!
    Object.defineProperty(image, "currentSrc", { value: "https://images.example/selected.webp" })
    await captureShareImage(node, 2, "save", new AbortController().signal)
    const snapshot = engine.capture.mock.calls[0]![0] as HTMLElement
    expect(fetch).toHaveBeenCalledWith("https://images.example/selected.webp", expect.objectContaining({ signal: expect.any(AbortSignal) }))
    expect(snapshot.querySelector("source")).toBeNull()
    expect(snapshot.querySelector("img")?.hasAttribute("srcset")).toBe(false)
    expect(snapshot.querySelector("img")?.hasAttribute("sizes")).toBe(false)
    expect(node.querySelector("source")).not.toBeNull()
  })

  it("keeps embedded data images offline and rejects decode failures", async () => {
    const fetchImage = vi.fn(); vi.stubGlobal("fetch", fetchImage)
    const node = paper(); node.innerHTML = '<img src="data:image/png;base64,cGl4ZWxz">'
    await captureShareImage(node, 2, "save", new AbortController().signal)
    expect(fetchImage).not.toHaveBeenCalled()
    vi.mocked(HTMLImageElement.prototype.decode).mockRejectedValue(new Error("decode failed"))
    await expect(captureShareImage(node, 2, "save", new AbortController().signal)).rejects.toThrow("图片")
    expect(document.querySelector("[data-agent-share-capture]")).toBeNull()
  })

  it("uses already decoded pixels when fetching a displayed image fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("network unavailable")))
    const drawImage = vi.fn()
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D)
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/png;base64,Y2FjaGVk")
    const node = paper(); node.innerHTML = '<img src="blob:https://synapse.example/revoked">'
    await captureShareImage(node, 2, "save", new AbortController().signal)
    expect(drawImage).toHaveBeenCalledWith(node.querySelector("img"), 0, 0)
    expect((engine.capture.mock.calls[0]![0] as HTMLElement).querySelector("img")?.src).toBe("data:image/png;base64,Y2FjaGVk")
  })

  it("rejects inaccessible or tainted images instead of exporting placeholders", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("blocked")))
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D)
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockImplementation(() => { throw new DOMException("tainted", "SecurityError") })
    const node = paper(); node.innerHTML = '<img src="https://private.example/photo?token=secret">'
    await expect(captureShareImage(node, 2, "save", new AbortController().signal)).rejects.toThrow("图片")
    expect(engine.capture).not.toHaveBeenCalled()
    expect(JSON.stringify(engine.warn.mock.calls)).not.toMatch(/private|secret/)
    expect(document.querySelector("[data-agent-share-capture]")).toBeNull()
  })

  it("uses the guarded native image reader for a public image blocked by browser CORS", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("CORS")))
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D)
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockImplementation(() => { throw new DOMException("tainted", "SecurityError") })
    engine.readResource.mockResolvedValue({ dataUrl: "data:image/png;base64,bmF0aXZl" })
    const node = paper(); node.innerHTML = '<img src="https://images.example/photo.png">'
    await captureShareImage(node, 2, "copy", new AbortController().signal)
    expect(engine.readResource).toHaveBeenCalledWith({ url: "https://images.example/photo.png" })
    expect((engine.capture.mock.calls[0]![0] as HTMLElement).querySelector("img")?.src).toBe("data:image/png;base64,bmF0aXZl")
  })

  it.each([false, true])("preserves the automatic render caller when remote image access is denied (cached pixels: %s)", async (cached) => {
    const fetchImage = vi.fn().mockResolvedValue(resourceResponse("unguarded"))
    vi.stubGlobal("fetch", fetchImage)
    if (cached) {
      vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D)
      vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/png;base64,Y2FjaGVk")
    }
    engine.readResource.mockRejectedValue(new Error("没有网络权限。"))
    const renderContext = { requestId: "request-1", nonce: "nonce-1", projectId: "project-1", conversationId: "conversation-1" }
    const node = paper(); node.innerHTML = '<img src="https://images.example/photo.png">'
    await expect(captureShareImage(node, 2, "save", new AbortController().signal, renderContext)).rejects.toThrow("没有网络权限")
    expect(engine.readResource).toHaveBeenCalledExactlyOnceWith({ url: "https://images.example/photo.png", renderContext })
    expect(fetchImage).not.toHaveBeenCalled()
    expect(engine.capture).not.toHaveBeenCalled()
  })

  it("uses permission-checked bytes for an automatic render even when browser fetch would succeed", async () => {
    const fetchImage = vi.fn().mockResolvedValue(resourceResponse("unguarded"))
    vi.stubGlobal("fetch", fetchImage)
    engine.readResource.mockResolvedValue({ dataUrl: "data:image/png;base64,bmF0aXZl" })
    const renderContext = { requestId: "request-1", nonce: "nonce-1", projectId: "project-1", conversationId: "conversation-1" }
    const node = paper(); node.innerHTML = '<img src="https://images.example/photo.png">'
    await captureShareImage(node, 2, "save", new AbortController().signal, renderContext)
    expect(engine.readResource).toHaveBeenCalledExactlyOnceWith({ url: "https://images.example/photo.png", renderContext })
    expect(fetchImage).not.toHaveBeenCalled()
    expect((engine.capture.mock.calls[0]![0] as HTMLElement).querySelector("img")?.src).toBe("data:image/png;base64,bmF0aXZl")
  })

  it("checks relative remote SVG images against the automatic render caller's permissions", async () => {
    vi.spyOn(document, "baseURI", "get").mockReturnValue("https://images.example/conversation/")
    const fetchImage = vi.fn().mockResolvedValue(resourceResponse("unguarded"))
    vi.stubGlobal("fetch", fetchImage)
    engine.readResource.mockRejectedValue(new Error("没有网络权限。"))
    const renderContext = { requestId: "request-1", nonce: "nonce-1", projectId: "project-1", conversationId: "conversation-1" }
    const node = paper(); node.innerHTML = '<svg><image href="photo.png"/></svg>'
    await expect(captureShareImage(node, 2, "save", new AbortController().signal, renderContext)).rejects.toThrow("没有网络权限")
    expect(engine.readResource).toHaveBeenCalledWith({ url: "https://images.example/conversation/photo.png", renderContext })
    expect(fetchImage).not.toHaveBeenCalled()
  })

  it("aborts image fetching without capturing or leaving a clone behind", async () => {
    const controller = new AbortController()
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => { controller.abort(); throw controller.signal.reason }))
    const node = paper(); node.innerHTML = '<img src="https://images.example/photo.png">'
    await expect(captureShareImage(node, 2, "save", controller.signal)).rejects.toThrow()
    expect(engine.capture).not.toHaveBeenCalled(); expect(engine.readResource).not.toHaveBeenCalled()
    expect(document.querySelector("[data-agent-share-capture]")).toBeNull()
  })

  it("records warnings raised during PNG encoding as well as initial capture", async () => {
    const warnings: { code: string }[] = []
    engine.capture.mockResolvedValue({ toBlob: engine.toBlob, warnings })
    engine.toBlob.mockImplementation(async () => { warnings.push({ code: "canvas-clamp" }); return png(720, 100) })
    await expect(captureShareImage(paper(), 2, "save", new AbortController().signal)).rejects.toThrow("清晰度")
    expect(engine.warn).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ stage: "encode", warningCodes: ["canvas-clamp"] }))
  })

  it.each([[720, 2], [720, 3], [960, 2], [960, 3]] as const)("preserves %i CSS pixels at %ix for copy and save", async (width, scale) => {
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(width)
    engine.toBlob.mockResolvedValue(png(width * scale, 100 * scale))
    for (const action of ["copy", "save"] as const) await expect(captureShareImage(paper(), scale, action, new AbortController().signal)).resolves.toHaveProperty("type", "image/png")
  })

  it("freezes SVG image resources while preserving inline chart vectors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(resourceResponse("svg-image", "image/png")))
    const node = paper(); node.innerHTML = '<svg><rect width="10" height="20"/><image href="https://images.example/chart.png" width="40" height="20"/></svg>'
    await captureShareImage(node, 2, "save", new AbortController().signal)
    const snapshot = engine.capture.mock.calls[0]![0] as HTMLElement
    expect(snapshot.querySelector("rect")).not.toBeNull()
    expect(snapshot.querySelector("image")?.getAttribute("href")).toBe("data:image/png;base64,c3ZnLWltYWdl")
  })

  it("embeds CSS image resources instead of allowing the engine to silently omit backgrounds", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(resourceResponse("background", "image/png")))
    const node = paper(); const background = document.createElement("div")
    background.style.backgroundImage = 'url("https://images.example/background.png")'
    node.append(background)
    await captureShareImage(node, 2, "save", new AbortController().signal)
    expect((engine.capture.mock.calls[0]![0] as HTMLElement).querySelector("div")?.style.backgroundImage).toContain("data:image/png;base64,YmFja2dyb3VuZA==")
  })

  it("freezes before/after background and content images without changing source styles", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => resourceResponse("pseudo")))
    const computedStyle = getComputedStyle
    vi.stubGlobal("getComputedStyle", (node: Element, pseudo?: string) => {
      if (pseudo && node.classList.contains("illustrated")) {
        const style = document.createElement("div").style
        const before = node.hasAttribute("data-agent-share-resource") ? "data:image/png;base64,cHNldWRv" : "https://images.example/before.png"
        const after = node.hasAttribute("data-agent-share-resource") ? "data:image/png;base64,cHNldWRv" : "https://images.example/after.png"
        style.content = pseudo === "::before" ? '""' : `url("${after}")`
        if (pseudo === "::before") style.backgroundImage = `url("${before}")`
        return style
      }
      return computedStyle(node, pseudo)
    })
    const node = paper(); node.innerHTML = '<div class="illustrated">text</div>'
    await captureShareImage(node, 2, "save", new AbortController().signal)
    const snapshot = engine.capture.mock.calls[0]![0] as HTMLElement
    const rules = snapshot.querySelector("style")?.textContent
    expect(rules).toContain('::before{background-image:url("data:image/png;base64,cHNldWRv")')
    expect(rules).toContain('::after{content:url("data:image/png;base64,cHNldWRv")')
    expect(rules).not.toContain("https://")
    expect(node.querySelector("[data-agent-share-resource]")).toBeNull()
  })

  it("refuses a pseudo image that stronger CSS prevents from freezing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => resourceResponse("pseudo")))
    const computedStyle = getComputedStyle
    vi.stubGlobal("getComputedStyle", (node: Element, pseudo?: string) => {
      if (pseudo === "::before" && node.classList.contains("important-image")) {
        const style = document.createElement("div").style
        style.content = '""'; style.backgroundImage = 'url("https://images.example/important.png")'
        return style
      }
      return computedStyle(node, pseudo)
    })
    const node = paper(); node.innerHTML = '<div class="important-image">text</div>'
    await expect(captureShareImage(node, 2, "save", new AbortController().signal)).rejects.toThrow("图片样式")
    expect(engine.capture).not.toHaveBeenCalled()
  })

  it("cancels oversized image streams immediately without bypassing the limit through fallback", async () => {
    const cancel = vi.fn()
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(32 * 1024 * 1024 + 1)) }, cancel })
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(stream, { headers: { "content-type": "image/png" } })))
    const node = paper(); node.innerHTML = '<img src="https://images.example/oversized.png">'
    await expect(captureShareImage(node, 2, "save", new AbortController().signal)).rejects.toThrow("图片资源过大")
    expect(cancel).toHaveBeenCalled(); expect(engine.readResource).not.toHaveBeenCalled(); expect(engine.capture).not.toHaveBeenCalled()
  })

  it("copies canvas pixels, layout attributes and waits for the replacement image", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => resourceResponse("background")))
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/png;base64,Y2FudmFz")
    const node = paper(); node.innerHTML = '<canvas class="chart" style="width: 40px; height: 20px; background-image: url(https://images.example/background.png)" aria-label="收件数"></canvas>'
    await captureShareImage(node, 2, "save", new AbortController().signal)
    const snapshot = engine.capture.mock.calls[0]![0] as HTMLElement
    expect(snapshot.querySelector("canvas")).toBeNull()
    expect(snapshot.querySelector("img")).toMatchObject({ className: "chart", alt: "收件数" })
    expect(snapshot.querySelector("img")?.style.backgroundImage).toContain("data:image/png;base64,YmFja2dyb3VuZA==")
    expect(HTMLImageElement.prototype.decode).toHaveBeenCalled()
    expect(node.querySelector("canvas")).not.toBeNull()
  })

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
