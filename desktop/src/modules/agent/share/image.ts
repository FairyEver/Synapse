import type { ShareRenderResponse } from "../../../../app-capabilities/agent/shared/share"
import { AGENT_SHARE_COPY_MAX_PIXELS, AGENT_SHARE_MAX_HEIGHT, AGENT_SHARE_MAX_PIXELS, AGENT_SHARE_MAX_PNG_BYTES } from "@/types/agent-share"
import { createRendererLogger } from "@/app-shell/logging"
import { decodeShareImages, freezeShareImages } from "./image-resources"

const logger = createRendererLogger("agent.share.image")

function checkCaptureWarnings(warnings: readonly { code: string }[], action: "copy" | "save", scale: 2 | 3, stage: "capture" | "encode"): void {
  if (!warnings.length) return
  const warningCodes = [...new Set(warnings.map(({ code }) => /^[a-z][a-z0-9-]{0,63}$/.test(code) ? code : "unknown"))]
  // Warning messages/details may contain resource URLs, credentials or user content.
  logger.warn("Agent share capture reported rendering warnings.", { action, scale, stage, warningCodes, warningCount: warnings.length })
  if (warningCodes.some((code) => code === "raster-clamp" || code === "canvas-clamp")) throw new Error("图片未达到设定清晰度，请缩小范围后重试。")
  if (warningCodes.includes("image-fallback")) throw new Error("部分图片未能完整渲染，请检查图片是否可访问后重试。")
  throw new Error("部分内容未能完整渲染，请返回对话检查后重试。")
}

function bounded<T>(promise: Promise<T>, signal: AbortSignal, milliseconds: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => { cleanup(); reject(signal.reason ?? new DOMException("已取消", "AbortError")) }
    const timer = setTimeout(() => { cleanup(); reject(new Error("图片生成超时，请缩小范围后重试。")) }, milliseconds)
    function cleanup() { clearTimeout(timer); signal.removeEventListener("abort", abort) }
    signal.addEventListener("abort", abort, { once: true })
    promise.then((result) => { cleanup(); resolve(result) }, (cause) => { cleanup(); reject(cause) })
    // Attach rejection handlers before inspecting the signal: constructing the
    // operation's promise can itself synchronously trigger cancellation.
    if (signal.aborted) abort()
  })
}

async function waitForContent(paper: HTMLElement, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted()
  if (paper.querySelector("[data-agent-render-error]")) throw new Error("图表未能完整显示，请返回对话检查后重试。")
  if (paper.querySelector("iframe, video, object, embed")) throw new Error("所选内容包含无法导出的嵌入网页或视频，请取消该条消息。")
  if (document.fonts) await bounded(document.fonts.ready, signal, 10_000)
  let stable = 0, previousSize = ""
  const end = Date.now() + 15_000
  while (Date.now() < end) {
    signal.throwIfAborted()
    if (paper.querySelector("[data-agent-render-error]")) throw new Error("图表未能完整显示，请返回对话检查后重试。")
    const images = Array.from(paper.querySelectorAll("img"))
    images.forEach((image) => { image.loading = "eager" })
    if (images.some((image) => image.complete && image.naturalWidth === 0)) throw new Error("部分图片加载失败，请返回对话检查后重试。")
    const size = `${paper.offsetWidth}:${paper.offsetHeight}:${paper.querySelectorAll("svg,canvas").length}`
    const ready = !paper.querySelector("[data-agent-render-pending]") && images.every((image) => image.complete) && paper.offsetWidth > 0 && paper.offsetHeight > 0
    stable = ready && size === previousSize ? stable + 1 : 0
    previousSize = size
    if (stable >= 3) {
      for (const animation of paper.getAnimations?.({ subtree: true }) ?? []) {
        if (animation.playState === "running" && animation.effect?.getTiming().iterations !== Infinity) animation.finish()
      }
      for (const node of [paper, ...paper.querySelectorAll<HTMLElement>("div, pre")]) {
        const style = getComputedStyle(node)
        if (node.clientWidth > 0 && node.scrollWidth > node.clientWidth + 2 && /auto|scroll|hidden|clip/.test(style.overflowX)) throw new Error("内容超出图片宽度，请改用宽版或取消该条消息。")
        if (node.clientHeight > 0 && node.scrollHeight > node.clientHeight + 2 && /auto|scroll|hidden|clip/.test(style.overflowY)) throw new Error("所选图表包含滚动内容，请展开完整内容或取消该条消息。")
      }
      return
    }
    await bounded(new Promise<void>((resolve) => setTimeout(resolve, 40)), signal, 1000)
  }
  throw new Error("内容仍在加载，请稍后再试。")
}

export async function captureShareImage(paper: HTMLElement, scale: 2 | 3, action: "copy" | "save", signal: AbortSignal, renderContext?: ShareRenderResponse): Promise<Blob> {
  await waitForContent(paper, signal)
  const host = document.createElement("div")
  host.dataset.agentShareCapture = ""
  host.setAttribute("aria-hidden", "true")
  host.className = "pointer-events-none fixed -left-[20000px] top-0"
  const clone = paper.cloneNode(true) as HTMLElement
  clone.removeAttribute("id")
  const resources = new AbortController()
  const captureSignal = AbortSignal.any([signal, resources.signal])
  let stage = "resources"
  try {
    await bounded(freezeShareImages(paper, clone, captureSignal, renderContext), captureSignal, 30_000)
    stage = "canvas"
    const canvases = Array.from(clone.querySelectorAll("canvas"))
    // cloneNode does not copy bitmap pixels. Freeze canvases before cloning can lose them.
    for (const [index, canvas] of Array.from(paper.querySelectorAll("canvas")).entries()) {
      const image = document.createElement("img")
      for (const attribute of canvases[index]!.attributes) image.setAttribute(attribute.name, attribute.value)
      image.removeAttribute("id")
      try { image.src = canvas.toDataURL("image/png") }
      catch (cause) { throw new Error("图表画布无法导出，请取消该条消息后重试。", { cause }) }
      image.style.width = getComputedStyle(canvas).width
      image.style.height = getComputedStyle(canvas).height
      image.alt = canvas.getAttribute("aria-label") ?? "图表"
      image.loading = "eager"
      canvases[index]?.replaceWith(image)
    }
    host.append(clone); document.body.append(host)
    stage = "decode"
    await bounded(decodeShareImages(clone, captureSignal), captureSignal, 15_000)
    const width = clone.offsetWidth * scale, height = clone.offsetHeight * scale
    if (!width || !height || width > 2880 || height > AGENT_SHARE_MAX_HEIGHT || width * height > AGENT_SHARE_MAX_PIXELS) throw new Error("图片过长，请缩小分享范围。")
    if (action === "copy" && (width * height > AGENT_SHARE_COPY_MAX_PIXELS || height > 32_767)) throw new Error("图片过长，无法复制，请保存图片后分享。")
    const { snapdom } = await import("@zumer/snapdom")
    stage = "capture"
    const capture = await bounded(snapdom(clone, { scale, dpr: 1, embedFonts: "auto", reconcile: true, fast: false, backgroundColor: getComputedStyle(clone).backgroundColor }), captureSignal, 30_000)
    checkCaptureWarnings(capture.warnings, action, scale, "capture")
    stage = "encode"
    const blob = await bounded(capture.toBlob({ format: "png", scale, dpr: 1 }), captureSignal, 30_000)
    checkCaptureWarnings(capture.warnings, action, scale, "encode")
    signal.throwIfAborted()
    if (!blob || blob.type !== "image/png" || blob.size < 24 || blob.size > AGENT_SHARE_MAX_PNG_BYTES) throw new Error("PNG 图片生成失败或文件过大，请缩小范围。")
    const dimensions = new DataView(await blob.slice(0, 24).arrayBuffer())
    if (dimensions.getUint32(16) !== width || dimensions.getUint32(20) !== height) throw new Error("图片未达到设定清晰度，请缩小范围后重试。")
    return blob
  } catch (cause) {
    if (!signal.aborted) logger.warn("Agent share image generation failed.", { stage, action, scale, errorName: cause instanceof Error ? cause.name : typeof cause })
    throw cause
  } finally { resources.abort(); host.remove() }
}

export function shareBlobBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result.slice(reader.result.indexOf(",") + 1)) : reject(new Error("无法读取分享图片。"))
    reader.onerror = () => reject(new Error("无法读取分享图片。"))
    reader.readAsDataURL(blob)
  })
}
