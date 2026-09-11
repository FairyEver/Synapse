import { readFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { join } from "node:path"
import { chromium, type Browser, type BrowserContext, type Page } from "playwright"

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
  readonly imageWarnings: number
  readonly diagramWarnings: number
}

export class PdfRenderTimeoutError extends Error {
  constructor() {
    super("PDF render timed out")
    this.name = "PdfRenderTimeoutError"
  }
}

export class PdfRenderCancelledError extends Error {
  constructor() {
    super("PDF render cancelled")
    this.name = "PdfRenderCancelledError"
  }
}

export class PdfRenderer {
  private browserPromise: Promise<Browser> | null = null
  private browserInstance: Browser | null = null
  private assetsPromise: Promise<{ readonly css: string; readonly mermaid: string }> | null = null

  constructor(
    private readonly renderTimeoutMs = 55_000,
    private readonly inspectPreparedPage?: (page: Page) => Promise<void>,
  ) {}

  async warmup(timeoutMs = 4_000): Promise<void> {
    let timeout: NodeJS.Timeout | undefined
    try {
      await Promise.race([
        Promise.all([this.browser(), this.assets()]),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => reject(new Error("PDF renderer warmup timed out")), timeoutMs)
        }),
      ])
    } finally {
      if (timeout) clearTimeout(timeout)
    }
  }

  async render(input: PdfRenderRequest, signal?: AbortSignal): Promise<PdfRenderResult> {
    let context: BrowserContext | undefined
    let closePromise: Promise<void> | undefined
    let termination: "timeout" | "cancelled" | null = null
    let timeout: NodeJS.Timeout | undefined
    let rejectTermination: ((error: Error) => void) | undefined
    const terminationResult = new Promise<never>((_resolve, reject) => {
      rejectTermination = reject
    })
    const close = (phase: "timeout" | "cancelled" | "finalize"): Promise<void> => {
      if (!context) return Promise.resolve()
      closePromise ??= this.closeContextAndRecover(context, phase)
      return closePromise
    }
    const terminate = (reason: "timeout" | "cancelled") => {
      if (termination) return
      termination = reason
      void close(reason)
      rejectTermination?.(reason === "timeout" ? new PdfRenderTimeoutError() : new PdfRenderCancelledError())
    }
    timeout = setTimeout(() => {
      terminate("timeout")
    }, this.renderTimeoutMs)
    const cancel = () => terminate("cancelled")
    if (signal?.aborted) cancel()
    else signal?.addEventListener("abort", cancel, { once: true })
    try {
      return await Promise.race([
        this.renderPage(input, (value) => {
          context = value
          if (termination) void close(termination)
        }, () => termination),
        terminationResult,
      ])
    } catch (error) {
      if (termination === "timeout") throw new PdfRenderTimeoutError()
      if (termination === "cancelled") throw new PdfRenderCancelledError()
      throw error
    } finally {
      if (timeout) clearTimeout(timeout)
      signal?.removeEventListener("abort", cancel)
      await close("finalize")
    }
  }

  async close(): Promise<void> {
    const browser = await this.browserPromise
    await browser?.close()
  }

  private browser(): Promise<Browser> {
    if (!this.browserPromise) {
      const launch = chromium.launch({ headless: true })
      this.browserPromise = launch
      void launch.then((browser) => {
        if (this.browserPromise === launch) this.browserInstance = browser
        browser.once("disconnected", () => {
          if (this.browserPromise === launch) {
            this.browserPromise = null
            this.browserInstance = null
          }
        })
      }, () => {
        if (this.browserPromise === launch) {
          this.browserPromise = null
          this.browserInstance = null
        }
      })
    }
    return this.browserPromise
  }

  private async renderPage(
    input: PdfRenderRequest,
    setContext: (context: BrowserContext) => void,
    termination: () => "timeout" | "cancelled" | null,
  ): Promise<PdfRenderResult> {
    const [browser, assets] = await Promise.all([this.browser(), this.assets()])
    const beforeContext = termination()
    if (beforeContext) throw renderTerminationError(beforeContext)
    const context = await browser.newContext({ colorScheme: "light", javaScriptEnabled: true })
    setContext(context)
    const afterContext = termination()
    if (afterContext) {
      throw renderTerminationError(afterContext)
    }
    await context.route("**/*", (route) => route.abort("blockedbyclient"))
    const page = await context.newPage()
    await page.setContent(documentHtml(input.title, input.html, assets.css), { waitUntil: "load" })
    await page.addScriptTag({ content: assets.mermaid })
    await page.evaluate(hydratePdfResources)
    await page.evaluate(waitForDocumentResources)
    const warnings = await page.evaluate(renderDocumentEnhancements)
    await this.inspectPreparedPage?.(page)
    const bytes = await page.pdf({
      format: "A4",
      landscape: false,
      printBackground: true,
      displayHeaderFooter: false,
      margin: { top: "16mm", right: "16mm", bottom: "16mm", left: "16mm" },
      preferCSSPageSize: true,
    })
    return { bytes: Buffer.from(bytes), ...warnings }
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

  private async closeContextAndRecover(
    context: BrowserContext,
    phase: "timeout" | "cancelled" | "finalize",
  ): Promise<void> {
    if (await closeContext(context, phase)) return
    const browser = context.browser()
    if (!browser) return
    if (this.browserInstance === browser) {
      this.browserPromise = null
      this.browserInstance = null
    }
    await closeBrowser(browser)
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

async function waitForDocumentResources(): Promise<void> {
  await document.fonts.ready
  await Promise.all(Array.from(document.images).map((image) => image.complete
    ? Promise.resolve()
    : new Promise<void>((resolve) => {
        image.addEventListener("load", () => resolve(), { once: true })
        image.addEventListener("error", () => resolve(), { once: true })
      })))
}

function hydratePdfResources(): void {
  const element = document.querySelector<HTMLScriptElement>("#synapse-pdf-resources")
  if (!element) return
  let resources: Record<string, unknown> = {}
  try {
    const parsed = JSON.parse(element.textContent ?? "") as unknown
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      resources = parsed as Record<string, unknown>
    }
  } catch {
    resources = {}
  }
  for (const image of document.querySelectorAll<HTMLImageElement>("img[data-drive-pdf-resource-key]")) {
    const key = image.dataset.drivePdfResourceKey ?? ""
    const value = resources[key]
    if (typeof value === "string" && value.startsWith("data:image/")) image.src = value
    image.removeAttribute("data-drive-pdf-resource-key")
  }
  element.remove()
}

async function renderDocumentEnhancements(): Promise<{ readonly imageWarnings: number; readonly diagramWarnings: number }> {
  const root = document.querySelector<HTMLElement>(".markdown-body")
  if (!root) return { imageWarnings: 0, diagramWarnings: 0 }
  const findListItem = (child: Element): HTMLLIElement | null => {
    if (child instanceof HTMLLIElement) return child
    return child.firstElementChild instanceof HTMLLIElement ? child.firstElementChild : null
  }
  const isNestedListContainer = (item: HTMLLIElement): boolean => {
    let containsNestedList = false
    for (const child of item.childNodes) {
      if (child instanceof HTMLOListElement || child instanceof HTMLUListElement) {
        containsNestedList = true
        continue
      }
      if (child.nodeType === Node.TEXT_NODE && !child.textContent?.trim()) continue
      if (child.nodeType === Node.COMMENT_NODE) continue
      return false
    }
    return containsNestedList
  }
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
    const items = Array.from(list.children, findListItem).filter((item): item is HTMLLIElement => item !== null)
    let current = list.start
    let renderedItemCount = 0
    let previousPath: number[] | undefined
    items.forEach((item) => {
      if (isNestedListContainer(item)) {
        markerPaths.set(item, previousPath ?? ancestorPath)
        return
      }
      if (item.hasAttribute("value")) current = item.value
      else if (renderedItemCount > 0) current += 1
      const path = [...ancestorPath, current]
      markerPaths.set(item, path)
      previousPath = path
      renderedItemCount += 1
      item.dataset.driveListMarker = path.length === 1 ? `${current}.` : path.join(".")
    })
  }

  let imageWarnings = 0
  for (const image of root.querySelectorAll<HTMLImageElement>("img")) {
    if (image.naturalWidth > 0 && image.naturalHeight > 0) continue
    imageWarnings += 1
    const placeholder = document.createElement("span")
    placeholder.dataset.drivePdfImageMissing = "true"
    placeholder.textContent = image.alt ? `图片无法加载：${image.alt}` : "图片无法加载"
    image.replaceWith(placeholder)
  }

  for (const image of root.querySelectorAll<HTMLImageElement>('img[src^="data:image/gif"]')) {
    try {
      const canvas = document.createElement("canvas")
      canvas.width = image.naturalWidth
      canvas.height = image.naturalHeight
      const context = canvas.getContext("2d")
      if (!context) throw new Error("GIF_CANVAS_UNAVAILABLE")
      context.drawImage(image, 0, 0)
      image.src = canvas.toDataURL("image/png")
    } catch {
      imageWarnings += 1
      const placeholder = document.createElement("span")
      placeholder.dataset.drivePdfImageMissing = "true"
      placeholder.textContent = image.alt ? `图片无法加载：${image.alt}` : "图片无法加载"
      image.replaceWith(placeholder)
    }
  }

  const mermaidApi = (globalThis as typeof globalThis & {
    mermaid?: { initialize(config: unknown): void; render(id: string, source: string): Promise<{ svg: string }> }
  }).mermaid
  const diagrams = Array.from(root.querySelectorAll<HTMLElement>("pre > code.language-mermaid"))
  if (!mermaidApi || diagrams.length === 0) {
    return { imageWarnings, diagramWarnings: diagrams.length }
  }
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
  return { imageWarnings, diagramWarnings: warnings }
}

function renderTerminationError(reason: "timeout" | "cancelled"): Error {
  return reason === "timeout" ? new PdfRenderTimeoutError() : new PdfRenderCancelledError()
}

async function closeContext(
  context: BrowserContext,
  phase: "timeout" | "cancelled" | "finalize",
): Promise<boolean> {
  let timeout: NodeJS.Timeout | undefined
  try {
    await Promise.race([
      context.close(),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error("PDF context close timed out")), 2_000)
      }),
    ])
    return true
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      level: "warn",
      event: "pdf_context_close_failed",
      phase,
      errorName: error instanceof Error ? error.name : "UnknownError",
      at: new Date().toISOString(),
    })}\n`)
    return false
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

async function closeBrowser(browser: Browser): Promise<void> {
  let timeout: NodeJS.Timeout | undefined
  try {
    await Promise.race([
      browser.close(),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error("PDF browser close timed out")), 2_000)
      }),
    ])
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      level: "warn",
      event: "pdf_browser_close_failed",
      errorName: error instanceof Error ? error.name : "UnknownError",
      at: new Date().toISOString(),
    })}\n`)
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}
