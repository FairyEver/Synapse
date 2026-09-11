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
import { renderDriveMarkdownFragment } from "./drive-markdown-renderer"
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
  }): Promise<DriveMarkdownPdfExportResult> {
    this.assertRateLimit(input.rateLimitKey)
    const startedAt = Date.now()
    return enforceExportDeadline(async (signal) => {
      const source = await input.resolveSource(signal)
      this.assertDeadline(startedAt)
      return this.performExport(source, startedAt, signal)
    })
  }

  private async performExport(
    source: DriveMarkdownPdfSource,
    startedAt: number,
    signal: AbortSignal,
  ): Promise<DriveMarkdownPdfExportResult> {
    const initial = await renderDriveMarkdownFragment(source.sourceText, {
      allowStandaloneRawImages: source.allowStandaloneRawImages,
    })
    const images = uniqueProjectionImages(initial.projection.images ?? [])
    if (images.length > DRIVE_PDF_MAX_IMAGES) {
      throw new PayloadTooLargeException(`Markdown 图片超过 ${DRIVE_PDF_MAX_IMAGES} 个，无法导出。`)
    }

    const resourceUrls = new Map<string, string | null>()
    let imageBytes = 0
    for (const image of images) {
      this.assertDeadline(startedAt)
      try {
        const resolved = await this.resolveImage(image, source, remainingTime(startedAt), signal)
        this.assertDeadline(startedAt)
        imageBytes += resolved.bytes.length
        if (imageBytes > DRIVE_PDF_IMAGES_MAX_BYTES) {
          throw new PayloadTooLargeException("Markdown 图片总大小超过 64 MiB，无法导出。")
        }
        resourceUrls.set(image.resourceKey, `data:${resolved.mimeType};base64,${resolved.bytes.toString("base64")}`)
      } catch (error) {
        if (error instanceof PayloadTooLargeException || error instanceof GatewayTimeoutException) throw error
        resourceUrls.set(image.resourceKey, null)
      }
    }

    const imageWarnings = (initial.projection.images ?? [])
      .filter((image) => resourceUrls.get(image.resourceKey) === null)
      .length

    const urlsById = new Map<string, string | null>()
    for (const image of initial.projection.images ?? []) {
      urlsById.set(image.imageId, resourceUrls.get(image.resourceKey) ?? null)
    }
    this.assertDeadline(startedAt)
    const rendered = await renderDriveMarkdownFragment(source.sourceText, {
      allowStandaloneRawImages: source.allowStandaloneRawImages,
      projection: initial.projection,
      pdfImageUrlsById: urlsById,
    })
    const response = await this.renderPdf({
      title: stripMarkdownExtension(source.name),
      html: `<main class="markdown-body">${rendered.html}</main>`,
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
  ): Promise<{ readonly bytes: Buffer; readonly mimeType: string }> {
    if (image.resourceKey.startsWith("relative:")) {
      const relative = source.relativeImages.get(image.resourceKey)
      if (!relative) throw new Error("PDF_IMAGE_NOT_FOUND")
      return this.readStorageImage(relative.storageKey, relative.size, signal)
    }
    if (image.resourceKey.startsWith("object:")) {
      const hosted = await this.hostedImages.resolveImage(image.resourceKey.slice("object:".length))
      if (!hosted) throw new Error("PDF_IMAGE_NOT_FOUND")
      if (hosted.size > BigInt(DRIVE_PDF_IMAGE_MAX_BYTES)) throw imageTooLarge()
      const object = await this.hostedImages.openImage(hosted.storageKey)
      return validateImageBytes(await readLimitedStream(object.stream, DRIVE_PDF_IMAGE_MAX_BYTES, signal))
    }
    if (image.resourceKey.startsWith("file:")) {
      const asset = await this.publicAssets.resolvePublicAsset(image.resourceKey.slice("file:".length), {})
      if (asset.status !== "ok") throw new Error("PDF_IMAGE_NOT_FOUND")
      return this.readStorageImage(asset.storageKey, asset.size, signal)
    }
    if (image.resourceKey.startsWith("data:")) return parseDataImage(image.source)
    if (/^https?:\/\//iu.test(image.source.trim())) {
      try {
        return await fetchSafeExternalImage(image.source, {
          maxBytes: DRIVE_PDF_IMAGE_MAX_BYTES,
          timeoutMs: Math.max(1, Math.min(10_000, remainingMs)),
          maxRedirects: 3,
          signal,
        })
      } catch (error) {
        if (error instanceof Error && error.message === "EXTERNAL_IMAGE_TOO_LARGE") throw imageTooLarge()
        if (remainingMs <= 0) throw new GatewayTimeoutException("PDF 导出超时。")
        throw error
      }
    }
    throw new Error("PDF_IMAGE_UNSUPPORTED")
  }

  private async readStorageImage(storageKey: string, declaredSize: bigint, signal: AbortSignal) {
    if (declaredSize > BigInt(DRIVE_PDF_IMAGE_MAX_BYTES)) throw imageTooLarge()
    const object = await this.storage.getObjectStream({ key: storageKey })
    return validateImageBytes(await readLimitedStream(object.stream, DRIVE_PDF_IMAGE_MAX_BYTES, signal))
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
      if (!response.ok) throw new BadGatewayException("PDF 导出服务暂不可用。")
      const declaredLength = Number(response.headers.get("content-length") ?? 0)
      if (declaredLength > DRIVE_PDF_OUTPUT_MAX_BYTES) throw new PayloadTooLargeException("生成的 PDF 超过 64 MiB。")
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

async function enforceExportDeadline<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
  let timeout: NodeJS.Timeout | undefined
  const controller = new AbortController()
  try {
    return await Promise.race([
      operation(controller.signal),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          reject(new GatewayTimeoutException("PDF 导出超时。"))
          controller.abort()
        }, DRIVE_PDF_TIMEOUT_MS)
      }),
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
    controller.abort()
  }
}

function uniqueProjectionImages(images: readonly DriveMarkdownProjectionImageDto[]): DriveMarkdownProjectionImageDto[] {
  return [...new Map(images.map((image) => [image.resourceKey, image])).values()]
}

function remainingTime(startedAt: number): number {
  return DRIVE_PDF_TIMEOUT_MS - (Date.now() - startedAt)
}

function imageTooLarge(): PayloadTooLargeException {
  return new PayloadTooLargeException("单张图片超过 10 MiB，无法导出。")
}

async function readLimitedStream(
  stream: NodeJS.ReadableStream,
  maxBytes: number,
  signal: AbortSignal,
): Promise<Buffer> {
  const chunks: Buffer[] = []
  let total = 0
  const destroy = () => (stream as { destroy?: (error?: Error) => void }).destroy?.(new Error("PDF_EXPORT_ABORTED"))
  signal.addEventListener("abort", destroy, { once: true })
  try {
    for await (const chunk of stream as NodeJS.ReadableStream & AsyncIterable<Buffer | string>) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      total += bytes.length
      if (total > maxBytes) {
        ;(stream as { destroy?: () => void }).destroy?.()
        throw imageTooLarge()
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

function parseDataImage(source: string): { readonly bytes: Buffer; readonly mimeType: string } {
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=\s]+)$/iu.exec(source.trim())
  if (!match) throw new Error("PDF_IMAGE_DATA_INVALID")
  const bytes = Buffer.from(match[2].replace(/\s+/gu, ""), "base64")
  if (bytes.length > DRIVE_PDF_IMAGE_MAX_BYTES) throw imageTooLarge()
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
  return (normalized || "文档").slice(0, 180)
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
