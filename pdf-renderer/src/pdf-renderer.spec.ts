import { afterAll, describe, expect, it } from "vitest"
import { createServer } from "node:http"
import { PdfRenderer } from "./pdf-renderer"

const renderer = new PdfRenderer()

describe.sequential("PdfRenderer", () => {
  it("prints self-contained Markdown and Mermaid", async () => {
    const result = await renderer.render({
      schemaVersion: 1,
      title: "中文文档",
      html: '<main class="markdown-body"><h1>中文标题</h1><ol><li>一级<ol><li>二级</li></ol></li></ol><pre><code class="language-mermaid">graph TD; A--&gt;B</code></pre></main>',
    })

    expect(result.bytes.subarray(0, 5).toString("ascii")).toBe("%PDF-")
    expect(result.diagramWarnings).toBe(0)
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
      expect(requests).toBe(0)
    } finally {
      await new Promise<void>((resolve, reject) => imageServer.close((error) => error ? reject(error) : resolve()))
    }
  }, 30_000)
})

afterAll(async () => {
  await renderer.close()
})
