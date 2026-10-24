import type { ShareRenderResponse } from "../../../../app-capabilities/agent/shared/share"
import { createRendererLogger } from "@/app-shell/logging"
import { AGENT_SHARE_MAX_PIXELS, AGENT_SHARE_MAX_PNG_BYTES } from "@/types/agent-share"
import { getSynapseBridge } from "@/lib/electron-bridge"

const logger = createRendererLogger("agent.share.image")
const XLINK_NAMESPACE = "http://www.w3.org/1999/xlink"
const IMAGE_STYLE_PROPERTIES = ["background-image", "mask-image", "border-image-source", "list-style-image", "content"] as const
const CSS_IMAGE_URL = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/g

class ShareImageResourceLimitError extends Error {
  constructor() { super("图片资源过大，请缩小分享范围。"); this.name = "ShareImageResourceLimitError" }
}

async function readImageBlob(response: Response, signal: AbortSignal): Promise<Blob> {
  if (Number(response.headers.get("content-length")) > AGENT_SHARE_MAX_PNG_BYTES) {
    await response.body?.cancel()
    throw new ShareImageResourceLimitError()
  }
  if (!response.body) return response.blob()
  const reader = response.body.getReader()
  const chunks: BlobPart[] = []
  let size = 0
  try {
    while (true) {
      signal.throwIfAborted()
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > AGENT_SHARE_MAX_PNG_BYTES) throw new ShareImageResourceLimitError()
      chunks.push(value)
    }
    return new Blob(chunks, { type: response.headers.get("content-type") ?? "" })
  } finally {
    try { await reader.cancel() }
    catch (cause) { logger.warn("Agent share image stream cleanup failed.", { errorName: cause instanceof Error ? cause.name : typeof cause }) }
    reader.releaseLock()
  }
}

function resourceKind(src: string): string {
  if (/^https?:/i.test(src)) return "remote"
  if (/^(file|synapse-agent-artifact):/i.test(src)) return "local"
  if (/^blob:/i.test(src)) return "blob"
  if (/^data:/i.test(src)) return "data"
  return "other"
}

function blobDataUrl(blob: Blob, signal: AbortSignal): Promise<string> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    const abort = () => reader.abort()
    const cleanup = () => signal.removeEventListener("abort", abort)
    reader.onload = () => {
      cleanup()
      if (typeof reader.result === "string") resolve(reader.result)
      else reject(new Error("无法读取图片。"))
    }
    reader.onerror = () => { cleanup(); reject(new Error("无法读取图片。", { cause: reader.error })) }
    reader.onabort = () => { cleanup(); reject(signal.reason ?? new DOMException("已取消", "AbortError")) }
    signal.addEventListener("abort", abort, { once: true })
    reader.readAsDataURL(blob)
  })
}

function imagePixels(image: HTMLImageElement): string {
  const width = image.naturalWidth, height = image.naturalHeight
  if (!width || !height || width * height > AGENT_SHARE_MAX_PIXELS) throw new Error("图片尺寸超出导出范围。")
  const canvas = document.createElement("canvas")
  canvas.width = width; canvas.height = height
  const context = canvas.getContext("2d")
  if (!context) throw new Error("无法读取图片像素。")
  context.drawImage(image, 0, 0)
  const data = canvas.toDataURL("image/png")
  if (!data.startsWith("data:image/png;base64,")) throw new Error("无法读取图片像素。")
  return data
}

/** Freeze preview resources; public HTTP fallback stays behind permission-checked IPC. */
export async function freezeShareImages(paper: HTMLElement, clone: HTMLElement, signal: AbortSignal, renderContext?: ShareRenderResponse): Promise<void> {
  const cache = new Map<string, Promise<string>>()
  let totalBytes = 0
  function reserve(data: string): string {
    const payload = data.slice(data.indexOf(",") + 1).split("#", 1)[0]!
    const size = data.includes(";base64,") ? Math.floor(payload.length * 3 / 4) - (payload.match(/=+$/)?.[0].length ?? 0) : data.length
    totalBytes += size
    if (size > AGENT_SHARE_MAX_PNG_BYTES || totalBytes > AGENT_SHARE_MAX_PNG_BYTES * 4) throw new ShareImageResourceLimitError()
    return data
  }
  async function inline(src: string, displayed?: HTMLImageElement): Promise<string> {
    signal.throwIfAborted()
    const embed = (data: string) => reserve(/^data:image\/svg\+xml[;,]/i.test(data) ? data + new URL(src, document.baseURI).hash : data)
    let pending = cache.get(src)
    if (!pending) {
      pending = (async () => {
        if (/^data:image\//i.test(src)) return reserve(src)
        let blob: Blob
        try {
          const response = await fetch(src, { signal, credentials: "same-origin" })
          if (!response.ok) throw new Error("图片读取失败。")
          blob = await readImageBlob(response, signal)
        } catch (cause) {
          signal.throwIfAborted()
          if (cause instanceof ShareImageResourceLimitError) throw cause
          // A displayed local/cached image can remain readable after its URL expires.
          // Canvas enforces origin cleanliness; a tainted image still fails explicitly.
          if (displayed) {
            let pixels: string | undefined
            try { pixels = imagePixels(displayed) }
            catch (pixelCause) {
              logger.warn("Agent share image pixel fallback unavailable.", { resourceKind: resourceKind(src), errorName: pixelCause instanceof Error ? pixelCause.name : typeof pixelCause })
            }
            if (pixels) return reserve(pixels)
          }
          const agent = getSynapseBridge()?.agent
          if (/^https?:/i.test(src) && typeof agent?.readShareImageResource === "function") {
            const result = await agent.readShareImageResource({ url: src, ...(renderContext ? { renderContext } : {}) })
            signal.throwIfAborted()
            return embed(result.dataUrl)
          }
          throw new Error("部分图片无法读取，请检查图片是否可访问后重试。", { cause })
        }
        signal.throwIfAborted()
        if (!blob.size || blob.size > AGENT_SHARE_MAX_PNG_BYTES) throw new ShareImageResourceLimitError()
        return embed(await blobDataUrl(blob, signal))
      })()
      cache.set(src, pending)
    }
    return pending
  }

  const sourceImages = Array.from(paper.querySelectorAll("img"))
  const targetImages = Array.from(clone.querySelectorAll("img"))
  const sourceElements = [paper, ...paper.querySelectorAll("*")]
  const targetElements = [clone, ...clone.querySelectorAll("*")]
  clone.querySelectorAll("picture source").forEach((node) => node.remove())
  // Keep work bounded for image-heavy conversations rather than decoding everything at once.
  for (let index = 0; index < sourceImages.length; index += 4) {
    await Promise.all(sourceImages.slice(index, index + 4).map(async (image, offset) => {
      const target = targetImages[index + offset]!
      const src = image.currentSrc || image.src
      target.removeAttribute("srcset"); target.removeAttribute("sizes"); target.removeAttribute("crossorigin")
      target.loading = "eager"
      target.src = await inline(src, image)
    }))
  }
  for (const image of clone.querySelectorAll("svg image")) {
    const src = image.getAttribute("href") || image.getAttributeNS(XLINK_NAMESPACE, "href")
    if (!src || src.startsWith("#")) continue
    const data = await inline(src)
    image.setAttribute("href", data)
    if (image.hasAttributeNS(XLINK_NAMESPACE, "href")) image.setAttributeNS(XLINK_NAMESPACE, "xlink:href", data)
  }
  const pseudoRules: string[] = []
  async function imageStyles(computed: CSSStyleDeclaration): Promise<[string, string][]> {
    const styles: [string, string][] = []
    for (const property of IMAGE_STYLE_PROPERTIES) {
      let value = computed.getPropertyValue(property)
      if (!value.includes("url(")) continue
      for (const match of value.matchAll(CSS_IMAGE_URL)) {
        const src = (match[1] ?? match[2] ?? match[3] ?? "").trim()
        if (!src || src.startsWith("#")) continue
        value = value.replace(match[0], `url("${await inline(src)}")`)
      }
      styles.push([property, value])
    }
    return styles
  }
  for (const [index, source] of sourceElements.entries()) {
    const target = targetElements[index]
    if (!(target instanceof HTMLElement || target instanceof SVGElement)) continue
    for (const [property, value] of await imageStyles(getComputedStyle(source))) target.style.setProperty(property, value)
    for (const pseudo of ["::before", "::after"]) {
      const computed = getComputedStyle(source, pseudo)
      if (["", "none", "normal"].includes(computed.content)) continue
      const styles = await imageStyles(computed)
      if (styles.length) {
        target.setAttribute("data-agent-share-resource", String(index))
        pseudoRules.push(`[data-agent-share-resource="${index}"]${pseudo}{${styles.map(([property, value]) => `${property}:${value} !important;`).join("")}}`)
      }
    }
  }
  if (pseudoRules.length) { const style = document.createElement("style"); style.textContent = pseudoRules.join("\n"); clone.prepend(style) }
}

export async function decodeShareImages(clone: HTMLElement, signal: AbortSignal): Promise<void> {
  const images = Array.from(clone.querySelectorAll("img"))
  const additional = new Set<string>()
  function addResource(src: string): void {
    if (!src || src.startsWith("#")) return
    // Stronger author CSS (including !important) can defeat the frozen override.
    // Check the mounted clone's actual styles before the engine can drop a URL.
    if (!/^data:/i.test(src)) throw new Error("部分图片样式未能完整导出，请取消该条消息后重试。")
    additional.add(src)
  }
  for (const image of clone.querySelectorAll("svg image")) {
    const src = image.getAttribute("href") || image.getAttributeNS(XLINK_NAMESPACE, "href")
    if (src) addResource(src)
  }
  for (const element of [clone, ...clone.querySelectorAll("*")]) {
    for (const pseudo of [undefined, "::before", "::after"]) {
      const computed = getComputedStyle(element, pseudo)
      if (pseudo && ["", "none", "normal"].includes(computed.content)) continue
      for (const property of IMAGE_STYLE_PROPERTIES) {
        for (const match of computed.getPropertyValue(property).matchAll(CSS_IMAGE_URL)) {
          addResource((match[1] ?? match[2] ?? match[3] ?? "").trim())
        }
      }
    }
  }
  for (const src of additional) { const image = document.createElement("img"); image.src = src; images.push(image) }
  for (let index = 0; index < images.length; index += 4) {
    await Promise.all(images.slice(index, index + 4).map(async (image) => {
      signal.throwIfAborted()
      try { await image.decode() }
      catch (cause) { throw new Error("部分图片解码失败，请检查图片后重试。", { cause }) }
      signal.throwIfAborted()
      if (!image.naturalWidth) throw new Error("部分图片加载失败，请检查图片后重试。")
    }))
  }
}
