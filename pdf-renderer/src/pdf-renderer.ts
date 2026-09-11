import { readFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { join } from "node:path"
import { chromium, type Browser, type BrowserContext } from "playwright"

const requireFromHere = createRequire(__filename)
const mermaidScriptPath = requireFromHere.resolve("mermaid/dist/mermaid.min.js")
const markdownCssPath = requireFromHere.resolve("github-markdown-css/github-markdown-light.css")
const interFontPath = requireFromHere.resolve("@fontsource-variable/inter/files/inter-latin-wght-normal.woff2")

export type PdfRenderRequest = {
  readonly schemaVersion: 1
  readonly title: string
  readonly html: string
}

export type PdfRenderResult = {
  readonly bytes: Buffer
  readonly diagramWarnings: number
}

export class PdfRenderTimeoutError extends Error {
  constructor() {
    super("PDF render timed out")
    this.name = "PdfRenderTimeoutError"
  }
}

export class PdfRenderer {
  private browserPromise: Promise<Browser> | null = null
  private assetsPromise: Promise<{ readonly css: string; readonly mermaid: string }> | null = null

  async render(input: PdfRenderRequest): Promise<PdfRenderResult> {
    const [browser, assets] = await Promise.all([this.browser(), this.assets()])
    const context = await browser.newContext({ colorScheme: "light", javaScriptEnabled: true })
    let timedOut = false
    const timeout = setTimeout(() => {
      timedOut = true
      void closeContext(context, "timeout")
    }, 55_000)
    await context.route("**/*", (route) => route.abort("blockedbyclient"))
    const page = await context.newPage()
    try {
      await page.setContent(documentHtml(input.title, input.html, assets.css), { waitUntil: "load" })
      await page.addScriptTag({ content: assets.mermaid })
      const diagramWarnings = await page.evaluate(renderDocumentEnhancements)
      await page.evaluate(async () => {
        await document.fonts.ready
        await Promise.all(Array.from(document.images).map((image) => image.complete
          ? Promise.resolve()
          : new Promise<void>((resolve) => {
              image.addEventListener("load", () => resolve(), { once: true })
              image.addEventListener("error", () => resolve(), { once: true })
            })))
      })
      const bytes = await page.pdf({
        format: "A4",
        landscape: false,
        printBackground: true,
        displayHeaderFooter: false,
        margin: { top: "16mm", right: "16mm", bottom: "16mm", left: "16mm" },
        preferCSSPageSize: true,
      })
      return { bytes: Buffer.from(bytes), diagramWarnings }
    } catch (error) {
      if (timedOut) throw new PdfRenderTimeoutError()
      throw error
    } finally {
      clearTimeout(timeout)
      await closeContext(context, "finalize")
    }
  }

  async close(): Promise<void> {
    const browser = await this.browserPromise
    await browser?.close()
  }

  private browser(): Promise<Browser> {
    this.browserPromise ??= chromium.launch({ headless: true })
    return this.browserPromise
  }

  private assets(): Promise<{ readonly css: string; readonly mermaid: string }> {
    this.assetsPromise ??= Promise.all([
      readFile(markdownCssPath, "utf8"),
      readFile(join(__dirname, "print.css"), "utf8"),
      readFile(interFontPath),
      readFile(mermaidScriptPath, "utf8"),
    ]).then(([markdownCss, printCss, interFont, mermaid]) => ({
      css: `@font-face{font-family:Inter;src:url(data:font/woff2;base64,${interFont.toString("base64")}) format("woff2");font-weight:100 900;font-style:normal;font-display:block}\n${markdownCss}\n${printCss}`,
      mermaid,
    }))
    return this.assetsPromise
  }
}

function documentHtml(title: string, body: string, css: string): string {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${css}</style></head><body>${body}</body></html>`
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] ?? character)
}

async function renderDocumentEnhancements(): Promise<number> {
  const root = document.querySelector<HTMLElement>(".markdown-body")
  if (!root) return 0
  const markerPaths = new Map<HTMLLIElement, number[]>()
  for (const list of root.querySelectorAll<HTMLOListElement>("ol")) {
    let ancestor = list.parentElement
    let ancestorPath: number[] = []
    while (ancestor && ancestor !== root) {
      if (ancestor instanceof HTMLLIElement && markerPaths.has(ancestor)) {
        ancestorPath = markerPaths.get(ancestor) ?? []
        break
      }
      ancestor = ancestor.parentElement
    }
    let current = list.start
    Array.from(list.children).filter((child): child is HTMLLIElement => child instanceof HTMLLIElement).forEach((item, index) => {
      if (item.hasAttribute("value")) current = item.value
      else if (index > 0) current += 1
      const path = [...ancestorPath, current]
      markerPaths.set(item, path)
      item.dataset.driveListMarker = path.length === 1 ? `${current}.` : path.join(".")
    })
  }

  for (const image of root.querySelectorAll<HTMLImageElement>('img[src^="data:image/gif"]')) {
    try {
      const canvas = document.createElement("canvas")
      canvas.width = image.naturalWidth
      canvas.height = image.naturalHeight
      canvas.getContext("2d")?.drawImage(image, 0, 0)
      image.src = canvas.toDataURL("image/png")
    } catch {
      image.dataset.drivePdfGifFrame = "browser-decoded"
    }
  }

  const mermaidApi = (globalThis as typeof globalThis & {
    mermaid?: { initialize(config: unknown): void; render(id: string, source: string): Promise<{ svg: string }> }
  }).mermaid
  const diagrams = Array.from(root.querySelectorAll<HTMLElement>("pre > code.language-mermaid"))
  if (!mermaidApi || diagrams.length === 0) return diagrams.length
  mermaidApi.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    suppressErrorRendering: true,
    secure: ["secure", "securityLevel", "startOnLoad", "maxTextSize", "suppressErrorRendering", "maxEdges", "theme", "themeVariables", "themeCSS", "fontFamily", "htmlLabels"],
    htmlLabels: false,
    theme: "neutral",
    fontFamily: getComputedStyle(document.body).fontFamily,
    flowchart: { htmlLabels: false, useMaxWidth: false },
    sequence: { useMaxWidth: false },
  })
  let warnings = 0
  for (const [index, code] of diagrams.entries()) {
    const pre = code.parentElement
    if (!pre) continue
    try {
      const result = await mermaidApi.render(`synapse-pdf-mermaid-${index}`, code.textContent ?? "")
      const template = document.createElement("template")
      template.innerHTML = result.svg.trim()
      const svg = template.content.querySelector("svg")
      if (!svg) throw new Error("MERMAID_EMPTY")
      const figure = document.createElement("figure")
      figure.dataset.drivePdfMermaid = "true"
      figure.append(svg)
      pre.replaceWith(figure)
    } catch {
      warnings += 1
      const placeholder = document.createElement("span")
      placeholder.dataset.drivePdfMermaidMissing = "true"
      placeholder.textContent = "图表无法渲染"
      pre.replaceWith(placeholder)
    }
  }
  return warnings
}

async function closeContext(context: BrowserContext, phase: "timeout" | "finalize"): Promise<void> {
  try {
    await context.close()
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      level: "warn",
      event: "pdf_context_close_failed",
      phase,
      errorName: error instanceof Error ? error.name : "UnknownError",
      at: new Date().toISOString(),
    })}\n`)
  }
}
