import {
  BadGatewayException,
  GatewayTimeoutException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  PayloadTooLargeException,
} from "@nestjs/common"
import { Buffer } from "node:buffer"
import type { DriveMarkdownProjectionImageDto } from "@synapse/shared"
import { loadEnv } from "../config/env"
import type { DriveMarkdownRenderOptions } from "./drive-markdown-renderer"
import {
  DriveMarkdownPdfRenderCancelledError,
  DriveMarkdownPdfRenderQueueFullError,
  DriveMarkdownPdfRenderResourceLimitError,
  DriveMarkdownPdfRenderTimeoutError,
  renderDriveMarkdownPdfInWorker,
} from "./drive-markdown-pdf-render-worker"
import type { DriveMarkdownPdfSource } from "./drive.service"
import type { DriveStoragePort } from "./drive-storage"
import { DriveDocumentHostedImageService } from "./drive-document-hosted-image.service"
import { DrivePublicAssetService } from "./drive-public-asset.service"
import { detectPublicAssetImageType } from "./drive-public-asset-policy"
import { fetchSafeExternalImage } from "./drive-pdf-external-image"

export const DRIVE_PDF_SOURCE_MAX_BYTES = 10 * 1024 * 1024
export const DRIVE_PDF_IMAGE_MAX_BYTES = 10 * 1024 * 1024
export const DRIVE_PDF_IMAGES_MAX_BYTES = 64 * 1024 * 1024
export const DRIVE_PDF_MAX_IMAGES = 256
export const DRIVE_PDF_OUTPUT_MAX_BYTES = 64 * 1024 * 1024
export const DRIVE_PDF_TIMEOUT_MS = 60_000
const DRIVE_PDF_RATE_LIMIT = 5
const DRIVE_PDF_RATE_WINDOW_MS = 60_000

export type DriveMarkdownPdfExportResult = {
  readonly bytes: Buffer
  readonly fileName: string
  readonly imageWarnings: number
  readonly diagramWarnings: number
}

export class DriveMarkdownPdfExportCancelledError extends Error {
  constructor() {
    super("Drive Markdown PDF export cancelled")
    this.name = "DriveMarkdownPdfExportCancelledError"
  }
}

@Injectable()
export class DriveMarkdownPdfExportService {
  private readonly attempts = new Map<string, number[]>()

  constructor(
    @Inject("DriveStoragePort") private readonly storage: DriveStoragePort,
    private readonly hostedImages: DriveDocumentHostedImageService,
    private readonly publicAssets: DrivePublicAssetService,
  ) {}

  async export(input: {
    readonly resolveSource: (signal: AbortSignal) => Promise<DriveMarkdownPdfSource>
    readonly rateLimitKey: string
    readonly signal?: AbortSignal
  }): Promise<DriveMarkdownPdfExportResult> {
    if (input.signal?.aborted) throw new DriveMarkdownPdfExportCancelledError()
    this.assertRateLimit(input.rateLimitKey)
    const startedAt = Date.now()
    return enforceExportDeadline(async (signal) => {
      const source = await input.resolveSource(signal)
      this.assertDeadline(startedAt)
      return this.performExport(source, startedAt, signal)
    }, input.signal)
  }

  private async performExport(
    source: DriveMarkdownPdfSource,
    startedAt: number,
    signal: AbortSignal,
  ): Promise<DriveMarkdownPdfExportResult> {
    assertExportActive(signal)
    const initial = await this.renderMarkdown(source.sourceText, {
      allowStandaloneRawImages: source.allowStandaloneRawImages,
    }, startedAt, signal)
    const images = uniqueProjectionImages(initial.projection.images ?? [])
    if (images.length > DRIVE_PDF_MAX_IMAGES) {
      throw new PayloadTooLargeException(`Markdown 图片超过 ${DRIVE_PDF_MAX_IMAGES} 个，无法导出。`)
    }
    const authorizationImages = source.relativeImageAuthorizationText === undefined
      ? initial.projection.images ?? []
      : (await this.renderMarkdown(source.relativeImageAuthorizationText, {
          allowStandaloneRawImages: source.allowStandaloneRawImages,
        }, startedAt, signal)).projection.images ?? []
    const relativeImages = source.resolveRelativeImages
      ? await source.resolveRelativeImages(initial.projection.images ?? [], authorizationImages, signal)
      : source.relativeImages
    this.assertDeadline(startedAt)
    const sourceWithRelativeImages = { ...source, relativeImages }

    const resourceTokens = new Map<string, string | null>()
    const resourceData = new Map<string, string>()
    let imageBytes = 0
    const consumeImageBytes = (byteLength: number) => {
      imageBytes += byteLength
      if (imageBytes > DRIVE_PDF_IMAGES_MAX_BYTES) {
        throw new PayloadTooLargeException("Markdown 图片总大小超过 64 MiB，无法导出。")
      }
    }
    for (const [index, image] of images.entries()) {
      assertExportActive(signal)
      this.assertDeadline(startedAt)
      try {
        const resolved = await this.resolveImage(image, sourceWithRelativeImages, remainingTime(startedAt), signal, consumeImageBytes)
        this.assertDeadline(startedAt)
        const token = `image-${index + 1}`
        resourceTokens.set(image.resourceKey, token)
        resourceData.set(token, `data:${resolved.mimeType};base64,${resolved.bytes.toString("base64")}`)
      } catch (error) {
        assertExportActive(signal)
        if (error instanceof PayloadTooLargeException || error instanceof GatewayTimeoutException) throw error
        resourceTokens.set(image.resourceKey, null)
      }
    }

    assertExportActive(signal)
    const imageWarnings = (initial.projection.images ?? [])
      .filter((image) => resourceTokens.get(image.resourceKey) === null)
      .length

    const resourceKeysById = new Map<string, string | null>()
    for (const image of initial.projection.images ?? []) {
      resourceKeysById.set(image.imageId, resourceTokens.get(image.resourceKey) ?? null)
    }
    this.assertDeadline(startedAt)
    const rendered = await this.renderMarkdown(source.sourceText, {
      allowStandaloneRawImages: source.allowStandaloneRawImages,
      projection: initial.projection,
      pdfImageResourceKeysById: resourceKeysById,
    }, startedAt, signal)
    const response = await this.renderPdf({
      title: stripMarkdownExtension(source.name),
      html: `<main class="markdown-body">${rendered.html}${pdfResourceMapScript(resourceData)}</main>`,
      timeoutMs: remainingTime(startedAt),
      signal,
    })
    if (response.bytes.length > DRIVE_PDF_OUTPUT_MAX_BYTES) {
      throw new PayloadTooLargeException("生成的 PDF 超过 64 MiB。")
    }
    return {
      bytes: response.bytes,
      fileName: `${safeFileStem(source.name)}.pdf`,
      imageWarnings: imageWarnings + response.imageWarnings,
      diagramWarnings: response.diagramWarnings,
    }
  }

  private async resolveImage(
    image: DriveMarkdownProjectionImageDto,
    source: DriveMarkdownPdfSource,
    remainingMs: number,
    signal: AbortSignal,
    consumeBytes: (byteLength: number) => void,
  ): Promise<{ readonly bytes: Buffer; readonly mimeType: string }> {
    if (image.resourceKey.startsWith("relative:")) {
      const relative = source.relativeImages.get(image.resourceKey)
      if (!relative) throw new Error("PDF_IMAGE_NOT_FOUND")
      return this.readStorageImage(relative.storageKey, relative.size, signal, consumeBytes)
    }
    if (image.resourceKey.startsWith("object:")) {
      const hosted = await this.hostedImages.resolveImage(image.resourceKey.slice("object:".length))
      if (!hosted) throw new Error("PDF_IMAGE_NOT_FOUND")
      if (hosted.size > BigInt(DRIVE_PDF_IMAGE_MAX_BYTES)) throw imageTooLarge()
      const object = await this.hostedImages.openImage(hosted.storageKey)
      return validateImageBytes(await readLimitedStream(object.stream, DRIVE_PDF_IMAGE_MAX_BYTES, signal, consumeBytes))
    }
    if (image.resourceKey.startsWith("file:")) {
      const asset = await this.publicAssets.resolvePublicAsset(image.resourceKey.slice("file:".length), {})
      if (asset.status !== "ok") throw new Error("PDF_IMAGE_NOT_FOUND")
      return this.readStorageImage(asset.storageKey, asset.size, signal, consumeBytes)
    }
    if (image.resourceKey.startsWith("data:")) return parseDataImage(image.source, consumeBytes)
    if (/^https?:\/\//iu.test(image.source.trim())) {
      try {
        return await fetchSafeExternalImage(image.source, {
          maxBytes: DRIVE_PDF_IMAGE_MAX_BYTES,
          timeoutMs: Math.max(1, Math.min(10_000, remainingMs)),
          maxRedirects: 3,
          signal,
          onBytes: consumeBytes,
        })
      } catch (error) {
        if (error instanceof Error && error.message === "EXTERNAL_IMAGE_TOO_LARGE") throw imageTooLarge()
        if (remainingMs <= 0) throw new GatewayTimeoutException("PDF 导出超时。")
        throw error
      }
    }
    throw new Error("PDF_IMAGE_UNSUPPORTED")
  }

  private async renderMarkdown(
    markdown: string,
    options: DriveMarkdownRenderOptions,
    startedAt: number,
    signal: AbortSignal,
  ) {
    try {
      return await renderDriveMarkdownPdfInWorker(markdown, options, {
        signal,
        timeoutMs: remainingTime(startedAt),
      })
    } catch (error) {
      if (error instanceof DriveMarkdownPdfRenderTimeoutError) {
        throw new GatewayTimeoutException("PDF 导出超时。")
      }
      if (error instanceof DriveMarkdownPdfRenderQueueFullError) {
        throw new HttpException("PDF 导出请求较多，请稍后重试。", HttpStatus.TOO_MANY_REQUESTS)
      }
      if (error instanceof DriveMarkdownPdfRenderResourceLimitError) {
        throw new PayloadTooLargeException("Markdown 结构过于复杂，无法导出。")
      }
      if (error instanceof DriveMarkdownPdfRenderCancelledError) {
        assertExportActive(signal)
      }
      if (error instanceof HttpException) throw error
      throw new BadGatewayException("PDF 导出服务暂不可用。")
    }
  }

  private async readStorageImage(
    storageKey: string,
    declaredSize: bigint,
    signal: AbortSignal,
    consumeBytes: (byteLength: number) => void,
  ) {
    if (declaredSize > BigInt(DRIVE_PDF_IMAGE_MAX_BYTES)) throw imageTooLarge()
    const object = await this.storage.getObjectStream({ key: storageKey })
    return validateImageBytes(await readLimitedStream(object.stream, DRIVE_PDF_IMAGE_MAX_BYTES, signal, consumeBytes))
  }

  private async renderPdf(input: {
    readonly title: string
    readonly html: string
    readonly timeoutMs: number
    readonly signal: AbortSignal
  }) {
    const env = loadEnv(process.env)
    if (!env.pdfRendererUrl || !env.pdfRendererInternalSecret) {
      throw new BadGatewayException("PDF 导出服务暂不可用。")
    }
    const controller = new AbortController()
    const abort = () => controller.abort()
    if (input.signal.aborted) abort()
    else input.signal.addEventListener("abort", abort, { once: true })
    const timeout = setTimeout(() => controller.abort(), Math.max(1, input.timeoutMs))
    try {
      const response = await fetch(`${env.pdfRendererUrl.replace(/\/+$/u, "")}/render`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.pdfRendererInternalSecret}`,
        },
        body: JSON.stringify({ schemaVersion: 1, title: input.title, html: input.html }),
        signal: controller.signal,
      })
      if (response.status === HttpStatus.TOO_MANY_REQUESTS) {
        throw new HttpException("PDF 导出请求较多，请稍后重试。", HttpStatus.TOO_MANY_REQUESTS)
      }
      if (response.status === HttpStatus.GATEWAY_TIMEOUT) {
        throw new GatewayTimeoutException("PDF 导出超时。")
      }
      if (response.status === HttpStatus.PAYLOAD_TOO_LARGE) {
        throw new PayloadTooLargeException("PDF 导出内容过大。")
      }
      if (!response.ok) throw new BadGatewayException("PDF 导出服务暂不可用。")
      const declaredLength = Number(response.headers.get("content-length") ?? 0)
      if (declaredLength > DRIVE_PDF_OUTPUT_MAX_BYTES) {
        await response.body?.cancel().catch(() => undefined)
        throw new PayloadTooLargeException("生成的 PDF 超过 64 MiB。")
      }
      const bytes = await readLimitedWebResponse(response, DRIVE_PDF_OUTPUT_MAX_BYTES)
      if (!bytes.subarray(0, 5).equals(Buffer.from("%PDF-"))) throw new BadGatewayException("PDF 导出结果无效。")
      return {
        bytes,
        imageWarnings: parseWarningCount(response.headers.get("x-synapse-pdf-image-warnings")),
        diagramWarnings: parseWarningCount(response.headers.get("x-synapse-pdf-diagram-warnings")),
      }
    } catch (error) {
      if (error instanceof HttpException) throw error
      if (controller.signal.aborted) throw new GatewayTimeoutException("PDF 导出超时。")
      throw new BadGatewayException("PDF 导出服务暂不可用。")
    } finally {
      clearTimeout(timeout)
      input.signal.removeEventListener("abort", abort)
    }
  }

  private assertRateLimit(key: string): void {
    const now = Date.now()
    if (this.attempts.size > 10_000) {
      for (const [candidate, values] of this.attempts) {
        if (values.every((at) => now - at >= DRIVE_PDF_RATE_WINDOW_MS)) this.attempts.delete(candidate)
      }
    }
    const recent = (this.attempts.get(key) ?? []).filter((at) => now - at < DRIVE_PDF_RATE_WINDOW_MS)
    if (recent.length >= DRIVE_PDF_RATE_LIMIT) {
      throw new HttpException("PDF 导出过于频繁，请稍后重试。", HttpStatus.TOO_MANY_REQUESTS)
    }
    recent.push(now)
    this.attempts.set(key, recent)
  }

  private assertDeadline(startedAt: number): void {
    if (remainingTime(startedAt) <= 0) throw new GatewayTimeoutException("PDF 导出超时。")
  }
}

async function enforceExportDeadline<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  externalSignal?: AbortSignal,
): Promise<T> {
  if (externalSignal?.aborted) throw new DriveMarkdownPdfExportCancelledError()
  let timeout: NodeJS.Timeout | undefined
  const controller = new AbortController()
  let rejectCancellation: ((error: Error) => void) | undefined
  const cancellation = new Promise<never>((_resolve, reject) => {
    rejectCancellation = reject
  })
  const cancel = () => {
    rejectCancellation?.(new DriveMarkdownPdfExportCancelledError())
    controller.abort()
  }
  externalSignal?.addEventListener("abort", cancel, { once: true })
  try {
    return await Promise.race([
      operation(controller.signal),
      cancellation,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          reject(new GatewayTimeoutException("PDF 导出超时。"))
          controller.abort()
        }, DRIVE_PDF_TIMEOUT_MS)
      }),
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
    externalSignal?.removeEventListener("abort", cancel)
    controller.abort()
  }
}

function uniqueProjectionImages(images: readonly DriveMarkdownProjectionImageDto[]): DriveMarkdownProjectionImageDto[] {
  return [...new Map(images.map((image) => [image.resourceKey, image])).values()]
}

function pdfResourceMapScript(resources: ReadonlyMap<string, string>): string {
  const json = JSON.stringify(Object.fromEntries(resources)).replace(/</gu, "\\u003c")
  return `<script id="synapse-pdf-resources" type="application/json">${json}</script>`
}

function remainingTime(startedAt: number): number {
  return DRIVE_PDF_TIMEOUT_MS - (Date.now() - startedAt)
}

function imageTooLarge(): PayloadTooLargeException {
  return new PayloadTooLargeException("单张图片超过 10 MiB，无法导出。")
}

function assertExportActive(signal: AbortSignal): void {
  if (signal.aborted) throw new DriveMarkdownPdfExportCancelledError()
}

async function readLimitedStream(
  stream: NodeJS.ReadableStream,
  maxBytes: number,
  signal: AbortSignal,
  consumeBytes: (byteLength: number) => void,
): Promise<Buffer> {
  const chunks: Buffer[] = []
  let total = 0
  const destroy = () => (stream as { destroy?: (error?: Error) => void }).destroy?.(new Error("PDF_EXPORT_ABORTED"))
  if (signal.aborted) destroy()
  else signal.addEventListener("abort", destroy, { once: true })
  try {
    for await (const chunk of stream as NodeJS.ReadableStream & AsyncIterable<Buffer | string>) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      total += bytes.length
      if (total > maxBytes) {
        ;(stream as { destroy?: () => void }).destroy?.()
        throw imageTooLarge()
      }
      try {
        consumeBytes(bytes.length)
      } catch (error) {
        ;(stream as { destroy?: () => void }).destroy?.()
        throw error
      }
      chunks.push(bytes)
    }
  } finally {
    signal.removeEventListener("abort", destroy)
  }
  return Buffer.concat(chunks, total)
}

function validateImageBytes(bytes: Buffer): { readonly bytes: Buffer; readonly mimeType: string } {
  const mimeType = detectPublicAssetImageType(bytes)
  if (!mimeType) throw new Error("PDF_IMAGE_FORMAT_INVALID")
  return { bytes, mimeType }
}

function parseDataImage(
  source: string,
  consumeBytes: (byteLength: number) => void,
): { readonly bytes: Buffer; readonly mimeType: string } {
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=\s]+)$/iu.exec(source.trim())
  if (!match) throw new Error("PDF_IMAGE_DATA_INVALID")
  const bytes = Buffer.from(match[2].replace(/\s+/gu, ""), "base64")
  if (bytes.length > DRIVE_PDF_IMAGE_MAX_BYTES) throw imageTooLarge()
  consumeBytes(bytes.length)
  return validateImageBytes(bytes)
}

function stripMarkdownExtension(name: string): string {
  const extensionStart = name.lastIndexOf(".")
  return (extensionStart > 0 ? name.slice(0, extensionStart) : name) || "文档"
}

function safeFileStem(name: string): string {
  const normalized = stripMarkdownExtension(name)
    .replace(/[\u0000-\u001f\u007f/\\]/gu, "_")
    .replace(/[. ]+$/gu, "")
    .trim()
  return Array.from(normalized || "文档").slice(0, 180).join("")
}

function parseWarningCount(value: string | null): number {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0
}

async function readLimitedWebResponse(response: Response, maxBytes: number): Promise<Buffer> {
  if (!response.body) return Buffer.alloc(0)
  const reader = response.body.getReader()
  const chunks: Buffer[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel()
        throw new PayloadTooLargeException("生成的 PDF 超过 64 MiB。")
      }
      chunks.push(Buffer.from(value))
    }
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks, total)
}
