import { dialog, nativeImage, session } from "electron"
import { readFile, stat } from "node:fs/promises"
import path from "node:path"

import { CUSTOM_WEB_PARTITION } from "./web-session"
export const CUSTOM_APP_FAVICON_SERVICE_ID = "core.custom-apps-favicon"

const MAX_HTML_BYTES = 512 * 1024
const MAX_ICON_BYTES = 512 * 1024
const MAX_LOCAL_ICON_BYTES = 2 * 1024 * 1024
const MAX_ICON_CANDIDATES = 8
const MAX_REDIRECTS = 3
const FETCH_TIMEOUT_MS = 5_000
const FAVICON_TOTAL_TIMEOUT_MS = 10_000

export type CustomAppIconResult = {
  readonly pngBase64: string
  readonly dataUrl: string
}

type FaviconServiceDependencies = {
  readonly fetch?: (input: string, init?: RequestInit) => Promise<Response>
  readonly normalizeImage?: (bytes: Buffer) => Promise<string | null>
  readonly chooseFile?: () => Promise<string | null>
  readonly readFile?: (path: string) => Promise<Buffer>
  readonly stat?: (path: string) => Promise<{ readonly size: number }>
}

export class CustomAppFaviconService {
  private readonly fetchImpl: (input: string, init?: RequestInit) => Promise<Response>
  private readonly normalizeImage: (bytes: Buffer) => Promise<string | null>
  private readonly chooseFile: () => Promise<string | null>
  private readonly read: (path: string) => Promise<Buffer>
  private readonly stat: (path: string) => Promise<{ readonly size: number }>

  constructor(deps: FaviconServiceDependencies = {}) {
    this.fetchImpl = deps.fetch ?? ((input, init) => session.fromPartition(CUSTOM_WEB_PARTITION).fetch(input, init))
    this.normalizeImage = deps.normalizeImage ?? normalizePng
    this.chooseFile = deps.chooseFile ?? chooseLocalImage
    this.read = deps.readFile ?? readFile
    this.stat = deps.stat ?? stat
  }

  async fetchFavicon(startUrl: string): Promise<CustomAppIconResult | null> {
    const pageUrl = parseHttpUrl(startUrl)
    if (!pageUrl) return null
    const deadline = Date.now() + FAVICON_TOTAL_TIMEOUT_MS

    const candidates: URL[] = []
    try {
      const htmlResponse = await fetchWithRedirects(this.fetchImpl, pageUrl)
      if (htmlResponse.ok) {
        const html = new TextDecoder().decode(await readLimitedBody(htmlResponse, MAX_HTML_BYTES))
        candidates.push(...discoverIconUrls(
          html,
          htmlResponse.url || pageUrl.toString(),
        ).slice(0, MAX_ICON_CANDIDATES - 1))
      }
    } catch {
      // A direct /favicon.ico attempt is still worthwhile.
    }
    candidates.push(new URL("/favicon.ico", pageUrl))

    const seen = new Set<string>()
    for (const candidate of candidates) {
      if (Date.now() >= deadline) break
      if (seen.has(candidate.toString())) continue
      seen.add(candidate.toString())
      try {
        const response = await fetchWithRedirects(this.fetchImpl, candidate)
        if (!response.ok) continue
        const contentType = response.headers.get("content-type")?.toLowerCase() ?? ""
        if (contentType && !contentType.startsWith("image/") && !contentType.startsWith("application/octet-stream")) continue
        const bytes = await readLimitedBody(response, MAX_ICON_BYTES)
        const pngBase64 = await this.normalizeImage(bytes)
        if (pngBase64) return { pngBase64, dataUrl: `data:image/png;base64,${pngBase64}` }
      } catch {
        continue
      }
    }
    return null
  }

  async chooseIcon(): Promise<CustomAppIconResult | null> {
    const filePath = await this.chooseFile()
    if (!filePath) return null
    const extension = path.extname(filePath).toLowerCase()
    if (![".png", ".jpg", ".jpeg", ".webp"].includes(extension)) return null
    try {
      const metadata = await this.stat(filePath)
      if (!Number.isFinite(metadata.size) || metadata.size <= 0 || metadata.size > MAX_LOCAL_ICON_BYTES) {
        return null
      }
      const bytes = await this.read(filePath)
      if (!bytes.length || bytes.length > MAX_LOCAL_ICON_BYTES) return null
      const pngBase64 = await this.normalizeImage(bytes)
      return pngBase64 ? { pngBase64, dataUrl: `data:image/png;base64,${pngBase64}` } : null
    } catch {
      return null
    }
  }
}

async function fetchWithRedirects(
  fetchImpl: (input: string, init?: RequestInit) => Promise<Response>,
  initialUrl: URL,
): Promise<Response> {
  let current = initialUrl
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    let response: Response
    try {
      response = await fetchImpl(current.toString(), {
        redirect: "manual",
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timeout)
    }
    if (![301, 302, 303, 307, 308].includes(response.status)) return response
    const location = response.headers.get("location")
    if (!location || redirect === MAX_REDIRECTS) throw new Error("Favicon redirect limit exceeded.")
    current = parseHttpUrl(new URL(location, current).toString())!
  }
  throw new Error("Favicon redirect limit exceeded.")
}

async function readLimitedBody(response: Response, maxBytes: number): Promise<Buffer> {
  const contentLength = Number(response.headers.get("content-length") ?? "")
  if (Number.isFinite(contentLength) && contentLength > maxBytes) throw new Error("Response too large.")
  if (!response.body) {
    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.length > maxBytes) throw new Error("Response too large.")
    return bytes
  }

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel()
        throw new Error("Response too large.")
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)))
}

function discoverIconUrls(html: string, pageUrl: string): URL[] {
  const urls: URL[] = []
  for (const match of html.matchAll(/<link\b[^>]*>/giu)) {
    const tag = match[0]
    const rel = readAttribute(tag, "rel")
    if (!rel || !/\b(?:icon|shortcut|apple-touch-icon)\b/iu.test(rel)) continue
    const href = readAttribute(tag, "href")
    const parsed = href ? parseHttpUrl(new URL(href, pageUrl).toString()) : null
    if (parsed) urls.push(parsed)
  }
  return urls
}

function readAttribute(tag: string, name: string): string | null {
  const match = new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "iu").exec(tag)
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? null
}

function parseHttpUrl(value: string): URL | null {
  try {
    const url = new URL(value.trim())
    return url.protocol === "http:" || url.protocol === "https:" ? url : null
  } catch {
    return null
  }
}

async function normalizePng(bytes: Buffer): Promise<string | null> {
  const image = nativeImage.createFromBuffer(bytes)
  if (image.isEmpty()) return null
  const resized = image.resize({ width: 128, height: 128, quality: "best" })
  const png = resized.toPNG()
  return png.length > 0 ? png.toString("base64") : null
}

async function chooseLocalImage(): Promise<string | null> {
  const result = await dialog.showOpenDialog({
    properties: ["openFile"],
    filters: [{
      name: "图片",
      extensions: ["png", "jpg", "jpeg", "webp"],
    }],
  })
  return result.canceled ? null : result.filePaths[0] ?? null
}
