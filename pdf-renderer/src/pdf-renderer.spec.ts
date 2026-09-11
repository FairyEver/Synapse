import { afterAll, describe, expect, it, vi } from "vitest"
import { createServer } from "node:http"
import { PdfRenderer, PdfRenderCancelledError, PdfRenderTimeoutError } from "./pdf-renderer"

const renderer = new PdfRenderer()

describe.sequential("PdfRenderer", () => {
  it("prints self-contained Markdown and Mermaid", async () => {
    const result = await renderer.render({
      schemaVersion: 1,
      title: "中文文档",
      html: '<main class="markdown-body"><h1>中文标题</h1><ol><li>一级<ol><li>二级</li></ol></li></ol><pre><code class="language-mermaid">graph TD; A--&gt;B</code></pre></main>',
    })

    expect(result.bytes.subarray(0, 5).toString("ascii")).toBe("%PDF-")
    expect(result.imageWarnings).toBe(0)
    expect(result.diagramWarnings).toBe(0)
  }, 30_000)

  it("does not count wrapper-only ordered-list items in hierarchical markers", async () => {
    const listRenderer = new PdfRenderer(55_000, async (page) => {
      expect(await page.locator("li").evaluateAll((items) => items.map((item) => (
        item.getAttribute("data-drive-list-marker")
      )))).toEqual(["3.", null, "3.1", "4."])
    })
    try {
      const result = await listRenderer.render({
        schemaVersion: 1,
        title: "分级列表",
        html: '<main class="markdown-body"><ol start="3"><li>第一项</li><li><ol><li>嵌套项</li></ol></li><li>第二项</li></ol></main>',
      })

      expect(result.bytes.subarray(0, 5).toString("ascii")).toBe("%PDF-")
    } finally {
      await listRenderer.close()
    }
  }, 30_000)

  it("continues when Mermaid source is invalid", async () => {
    const result = await renderer.render({
      schemaVersion: 1,
      title: "invalid diagram",
      html: '<main class="markdown-body"><pre><code class="language-mermaid">not a diagram</code></pre></main>',
    })

    expect(result.bytes.subarray(0, 5).toString("ascii")).toBe("%PDF-")
    expect(result.diagramWarnings).toBe(1)
  }, 30_000)

  it("prints task lists, quotes, code, wide tables, long links, large images, and multiple pages", async () => {
    const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
    const rows = Array.from({ length: 180 }, (_, index) => `<p>分页内容 ${index + 1}：中英文 mixed content</p>`).join("")
    const layoutRenderer = new PdfRenderer(55_000, async (page) => {
      const layout = await page.evaluate(() => {
        const root = document.querySelector<HTMLElement>(".markdown-body")
        const task = document.querySelector<HTMLInputElement>('.task-list-item input[type="checkbox"]')
        const quote = document.querySelector<HTMLElement>("blockquote")
        const code = document.querySelector<HTMLElement>("pre")
        const table = document.querySelector<HTMLTableElement>("table")
        const link = document.querySelector<HTMLAnchorElement>("a")
        const image = document.querySelector<HTMLImageElement>("img")
        const heading = document.querySelector<HTMLElement>("h1")
        if (!root || !task || !quote || !code || !table || !link || !image || !heading) {
          throw new Error("Expected print fixtures were not rendered")
        }
        const rootRect = root.getBoundingClientRect()
        const imageRect = image.getBoundingClientRect()
        const linkRect = link.getBoundingClientRect()
        return {
          bodyFont: getComputedStyle(document.body).fontFamily,
          interReady: document.fonts.check("12px Inter"),
          headingVisible: heading.getBoundingClientRect().width > 0 && heading.getBoundingClientRect().height > 0,
          taskChecked: task.checked,
          quoteRuleVisible: Number.parseFloat(getComputedStyle(quote).borderLeftWidth) > 0,
          codeWraps: getComputedStyle(code).whiteSpace === "pre-wrap",
          tableFits: table.scrollWidth <= root.clientWidth,
          linkFits: linkRect.left >= rootRect.left - 1 && linkRect.right <= rootRect.right + 1,
          imageFits: imageRect.width <= rootRect.width + 1 && imageRect.height <= 926,
        }
      })
      expect(layout).toMatchObject({
        interReady: true,
        headingVisible: true,
        taskChecked: true,
        quoteRuleVisible: true,
        codeWraps: true,
        tableFits: true,
        linkFits: true,
        imageFits: true,
      })
      expect(layout.bodyFont).toContain("Inter")
    })
    try {
      const result = await layoutRenderer.render({
        schemaVersion: 1,
        title: "打印版式",
        html: `<main class="markdown-body"><h1>验收</h1><ul class="contains-task-list"><li class="task-list-item"><input type="checkbox" checked disabled>任务</li></ul><blockquote><p>引用</p></blockquote><pre><code>const longValue = "abcdefghijklmnopqrstuvwxyz";</code></pre><table><thead><tr><th>很宽的列一</th><th>很宽的列二</th><th>很宽的列三</th></tr></thead><tbody><tr><td>内容一</td><td>内容二</td><td>内容三</td></tr></tbody></table><p><a href="https://example.com/${"long-segment/".repeat(30)}">${"long-link-text-".repeat(30)}</a></p><img src="data:image/png;base64,${png}" alt="超大图片" width="100000" height="100000">${rows}</main>`,
      })

      expect(result.bytes.subarray(0, 5).toString("ascii")).toBe("%PDF-")
      expect(result.bytes.toString("latin1")).toContain("/FontFamily (Inter)")
      expect(result.imageWarnings).toBe(0)
      expect(countPdfPages(result.bytes)).toBeGreaterThan(1)
    } finally {
      await layoutRenderer.close()
    }
  }, 30_000)

  it("freezes a GIF to a printable static frame", async () => {
    const gif = "R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=="
    const gifRenderer = new PdfRenderer(55_000, async (page) => {
      const image = page.locator("img")
      expect(await image.getAttribute("src")).toMatch(/^data:image\/png;base64,/u)
      expect(await image.evaluate((element) => {
        const renderedImage = element as HTMLImageElement
        return { width: renderedImage.naturalWidth, height: renderedImage.naturalHeight }
      }))
        .toEqual({ width: 1, height: 1 })
    })
    try {
      const result = await gifRenderer.render({
        schemaVersion: 1,
        title: "GIF",
        html: `<main class="markdown-body"><img src="data:image/gif;base64,${gif}" alt="动图"></main>`,
      })

      expect(result.bytes.subarray(0, 5).toString("ascii")).toBe("%PDF-")
      expect(result.imageWarnings).toBe(0)
    } finally {
      await gifRenderer.close()
    }
  }, 30_000)

  it("replaces an undecodable image with a visible warning", async () => {
    const truncatedPng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString("base64")
    const result = await renderer.render({
      schemaVersion: 1,
      title: "broken image",
      html: `<main class="markdown-body"><img src="data:image/png;base64,${truncatedPng}" alt="结构图"></main>`,
    })

    expect(result.bytes.subarray(0, 5).toString("ascii")).toBe("%PDF-")
    expect(result.imageWarnings).toBe(1)
  }, 30_000)

  it("hydrates repeated images from one self-contained resource entry", async () => {
    const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
    const resourceUrl = `data:image/png;base64,${png}`
    const resourceRenderer = new PdfRenderer(55_000, async (page) => {
      expect(await page.locator("#synapse-pdf-resources").count()).toBe(0)
      expect(await page.locator("img").evaluateAll((images) => images.map((image) => ({
        src: (image as HTMLImageElement).src,
        width: (image as HTMLImageElement).naturalWidth,
      })))).toEqual([
        { src: resourceUrl, width: 1 },
        { src: resourceUrl, width: 1 },
      ])
    })
    try {
      const result = await resourceRenderer.render({
        schemaVersion: 1,
        title: "deduplicated resources",
        html: `<main class="markdown-body"><img data-drive-pdf-resource-key="image-1" alt="one"><img data-drive-pdf-resource-key="image-1" alt="two"><script id="synapse-pdf-resources" type="application/json">${JSON.stringify({ "image-1": resourceUrl })}</script></main>`,
      })

      expect(result.imageWarnings).toBe(0)
      expect(result.bytes.subarray(0, 5).toString("ascii")).toBe("%PDF-")
    } finally {
      await resourceRenderer.close()
    }
  }, 30_000)

  it("applies the render deadline before Chromium startup completes", async () => {
    const constrainedRenderer = new PdfRenderer(1)
    try {
      await expect(constrainedRenderer.render({
        schemaVersion: 1,
        title: "startup timeout",
        html: '<main class="markdown-body"><p>正文</p></main>',
      })).rejects.toBeInstanceOf(PdfRenderTimeoutError)
    } finally {
      await constrainedRenderer.close()
    }
  }, 30_000)

  it("cancels before opening a page when the caller disconnects", async () => {
    const controller = new AbortController()
    controller.abort()

    await expect(renderer.render({
      schemaVersion: 1,
      title: "cancelled",
      html: '<main class="markdown-body"><p>正文</p></main>',
    }, controller.signal)).rejects.toBeInstanceOf(PdfRenderCancelledError)
  })

  it("does not evict a replacement browser while recovering a stale context", async () => {
    const localRenderer = new PdfRenderer()
    const oldBrowser = { close: vi.fn(async () => undefined) }
    const replacementBrowser = { close: vi.fn(async () => undefined) }
    const staleContext = {
      close: vi.fn(async () => { throw new Error("stale context") }),
      browser: () => oldBrowser,
    }
    const state = localRenderer as unknown as {
      browserPromise: Promise<typeof replacementBrowser> | null
      browserInstance: typeof replacementBrowser | null
      closeContextAndRecover: (context: unknown, phase: "finalize") => Promise<void>
    }
    state.browserPromise = Promise.resolve(replacementBrowser)
    state.browserInstance = replacementBrowser
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true)
    try {
      await state.closeContextAndRecover(staleContext, "finalize")

      expect(await state.browserPromise).toBe(replacementBrowser)
      expect(oldBrowser.close).toHaveBeenCalledOnce()
    } finally {
      stderr.mockRestore()
      await localRenderer.close()
    }
  })

  it("blocks every network request from document HTML", async () => {
    let requests = 0
    const imageServer = createServer((_request, response) => {
      requests += 1
      response.writeHead(200, { "Content-Type": "image/png" }).end()
    })
    await new Promise<void>((resolve) => imageServer.listen(0, "127.0.0.1", resolve))
    const address = imageServer.address()
    if (!address || typeof address === "string") throw new Error("Test image server did not bind a TCP port")
    try {
      const result = await renderer.render({
        schemaVersion: 1,
        title: "network isolation",
        html: `<main class="markdown-body"><img src="http://127.0.0.1:${address.port}/image.png" alt="blocked"></main>`,
      })

      expect(result.bytes.subarray(0, 5).toString("ascii")).toBe("%PDF-")
      expect(result.imageWarnings).toBe(1)
      expect(requests).toBe(0)
    } finally {
      await new Promise<void>((resolve, reject) => imageServer.close((error) => error ? reject(error) : resolve()))
    }
  }, 30_000)
})

afterAll(async () => {
  await renderer.close()
})

function countPdfPages(bytes: Buffer): number {
  return bytes.toString("latin1").match(/\/Type\s*\/Page\b/gu)?.length ?? 0
}
