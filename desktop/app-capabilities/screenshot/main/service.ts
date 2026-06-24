import { randomUUID } from "node:crypto"
import { constants } from "node:fs"
import { access, mkdir, readFile, stat, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {
  screenshotCaptureInputSchema,
  screenshotCaptureToFileInputSchema,
  type ScreenshotArtifact,
  type ScreenshotCaptureInput,
  type ScreenshotCaptureToFileInput,
  type ScreenshotClipboardResult,
  type ScreenshotPublicArtifact,
  type ScreenshotSaveResult,
} from "../shared/schema"

export type ScreenshotCaptureProviderImage = {
  readonly bytes: Uint8Array | Buffer
  readonly width: number
  readonly height: number
  readonly displayId?: string
  readonly scaleFactor?: number
}

export type ScreenshotCaptureOptions = {
  readonly targetPoint?: {
    readonly x: number
    readonly y: number
  }
}

export type ScreenshotCaptureProvider = {
  capture(input: ScreenshotCaptureInput, options?: ScreenshotCaptureOptions): Promise<ScreenshotCaptureProviderImage>
}

export type ScreenshotClipboardAdapter = {
  writePng(bytes: Uint8Array): void | Promise<void>
}

export type ScreenshotService = {
  capture(input: ScreenshotCaptureInput, options?: ScreenshotCaptureOptions): Promise<ScreenshotArtifact>
  captureToFile(input: ScreenshotCaptureToFileInput, options?: ScreenshotCaptureOptions): Promise<ScreenshotSaveResult>
  saveArtifact(input: {
    readonly artifact: ScreenshotArtifact
    readonly outputPath: string
    readonly overwrite?: boolean
  }): Promise<ScreenshotSaveResult>
  captureToClipboard(input: ScreenshotCaptureInput, options?: ScreenshotCaptureOptions): Promise<ScreenshotClipboardResult>
  copyArtifactToClipboard(artifact: ScreenshotArtifact): Promise<ScreenshotClipboardResult>
}

export type ScreenshotServiceDeps = {
  readonly provider?: ScreenshotCaptureProvider
  readonly clipboard?: ScreenshotClipboardAdapter
  readonly tempRoot?: string
  readonly now?: () => Date
  readonly idFactory?: () => string
}

export function createScreenshotService(deps: ScreenshotServiceDeps = {}): ScreenshotService {
  const provider = deps.provider ?? createNodeScreenshotsProvider()
  const clipboard = deps.clipboard ?? createElectronClipboardAdapter()
  const tempRoot = deps.tempRoot ?? path.join(os.tmpdir(), "synapse-screenshots")
  const now = deps.now ?? (() => new Date())
  const idFactory = deps.idFactory ?? randomUUID

  return {
    async capture(input, options) {
      const parsed = screenshotCaptureInputSchema.parse(input)
      const image = await provider.capture(parsed, options)
      const bytes = toUint8Array(image.bytes)
      const id = safeArtifactId(idFactory())
      const tempPath = path.join(tempRoot, `${id}.png`)
      await mkdir(tempRoot, { recursive: true })
      await writeFile(tempPath, bytes)

      return {
        id,
        mimeType: "image/png",
        bytes,
        size: bytes.byteLength,
        width: positiveInteger(image.width, "Screenshot width"),
        height: positiveInteger(image.height, "Screenshot height"),
        tempPath,
        capture: {
          mode: parsed.mode,
          ...(parsed.region ? { region: parsed.region } : {}),
          coordinateSpace: "screen",
          ...(image.displayId ? { displayId: image.displayId } : {}),
          ...(image.scaleFactor ? { scaleFactor: image.scaleFactor } : {}),
          capturedAt: now().toISOString(),
        },
      }
    },
    async captureToFile(input, options) {
      const parsed = screenshotCaptureToFileInputSchema.parse(input)
      const artifact = await this.capture(parsed.capture, options)
      return this.saveArtifact({
        artifact,
        outputPath: parsed.outputPath,
        overwrite: parsed.overwrite,
      })
    },
    async saveArtifact(input) {
      assertPngOutputPath(input.outputPath)
      await assertOutputWritable(input.outputPath, input.overwrite === true)
      await mkdir(path.dirname(input.outputPath), { recursive: true })
      await writeFile(input.outputPath, input.artifact.bytes, {
        flag: input.overwrite ? "w" : "wx",
      })
      const outputStat = await stat(input.outputPath)
      return {
        outputPath: input.outputPath,
        fileName: path.basename(input.outputPath),
        size: outputStat.size,
        artifact: publicArtifact(input.artifact),
      }
    },
    async captureToClipboard(input, options) {
      const artifact = await this.capture(input, options)
      return this.copyArtifactToClipboard(artifact)
    },
    async copyArtifactToClipboard(artifact) {
      await clipboard.writePng(artifact.bytes)
      return {
        copied: true,
        artifact: publicArtifact(artifact),
      }
    },
  }
}

export function publicArtifact(artifact: ScreenshotArtifact): ScreenshotPublicArtifact {
  return {
    id: artifact.id,
    mimeType: artifact.mimeType,
    size: artifact.size,
    width: artifact.width,
    height: artifact.height,
    tempPath: artifact.tempPath,
    capture: artifact.capture,
  }
}

function toUint8Array(bytes: Uint8Array | Buffer): Uint8Array {
  if (bytes instanceof Uint8Array && !(bytes instanceof Buffer)) return bytes
  return new Uint8Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer.`)
  }
  return value
}

function safeArtifactId(value: string): string {
  const normalized = value.replace(/[^a-zA-Z0-9_-]/g, "-").replace(/-+/g, "-")
  return normalized.length > 0 ? normalized : randomUUID()
}

function assertPngOutputPath(outputPath: string): void {
  if (path.extname(outputPath).toLowerCase() !== ".png") {
    throw new Error("截图输出文件必须是 .png 文件")
  }
}

async function assertOutputWritable(outputPath: string, overwrite: boolean): Promise<void> {
  try {
    await access(outputPath, constants.F_OK)
    if (!overwrite) throw new Error("输出文件已存在，请启用覆盖后重试")
  } catch (error) {
    if (error instanceof Error && error.message.includes("输出文件已存在")) throw error
  }
}

function createElectronClipboardAdapter(): ScreenshotClipboardAdapter {
  return {
    async writePng(bytes) {
      const electron = await import("electron")
      const nativeImage = electron.nativeImage.createFromBuffer(Buffer.from(bytes))
      electron.clipboard.writeImage(nativeImage)
    },
  }
}

type NodeScreenshotsModule = {
  readonly Monitor: {
    all(): unknown[]
    fromPoint(x: number, y: number): unknown
  }
}

type NodeScreenshotsImage = {
  crop?: (x: number, y: number, width: number, height: number) => NodeScreenshotsImage | Promise<NodeScreenshotsImage>
  cropSync?: (x: number, y: number, width: number, height: number) => NodeScreenshotsImage
  toPng?: () => Uint8Array | Buffer | Promise<Uint8Array | Buffer>
  toPngSync?: () => Uint8Array | Buffer
}

type NodeScreenshotsMonitor = {
  id?: string | number | (() => string | number)
  x?: number | (() => number)
  y?: number | (() => number)
  width?: number | (() => number)
  height?: number | (() => number)
  scaleFactor?: number | (() => number)
  isPrimary?: boolean | (() => boolean)
  captureImage?: () => NodeScreenshotsImage | Promise<NodeScreenshotsImage>
  captureImageSync?: () => NodeScreenshotsImage
}

export function createNodeScreenshotsProvider(): ScreenshotCaptureProvider {
  return {
    async capture(input, options) {
      const screenshots = await import("node-screenshots") as NodeScreenshotsModule
      const monitor = selectMonitor(screenshots, input, options)
      const image = await captureMonitorImage(monitor)
      const monitorX = monitorNumber(monitor, "x", 0)
      const monitorY = monitorNumber(monitor, "y", 0)
      const cropped = input.mode === "region" && input.region
        ? await cropImage(image, input.region.x - monitorX, input.region.y - monitorY, input.region.width, input.region.height)
        : image
      const bytes = await imageToPng(cropped)
      const displayId = monitorValue(monitor, "id")
      const scaleFactor = monitorNumber(monitor, "scaleFactor")
      return {
        bytes,
        width: input.mode === "region" && input.region ? Math.round(input.region.width) : positiveInteger(Math.round(monitorNumber(monitor, "width", 0)), "Monitor width"),
        height: input.mode === "region" && input.region ? Math.round(input.region.height) : positiveInteger(Math.round(monitorNumber(monitor, "height", 0)), "Monitor height"),
        ...(displayId !== undefined ? { displayId: String(displayId) } : {}),
        ...(scaleFactor ? { scaleFactor } : {}),
      }
    },
  }
}

function selectMonitor(
  screenshots: NodeScreenshotsModule,
  input: ScreenshotCaptureInput,
  options?: ScreenshotCaptureOptions,
): NodeScreenshotsMonitor {
  if (input.mode === "region" && input.region) {
    const monitor = screenshots.Monitor.fromPoint(input.region.x, input.region.y)
    if (!monitor) throw new Error("未找到区域所在显示器")
    return monitor as NodeScreenshotsMonitor
  }
  if (options?.targetPoint) {
    const monitor = screenshots.Monitor.fromPoint(options.targetPoint.x, options.targetPoint.y)
    if (monitor) return monitor as NodeScreenshotsMonitor
  }
  const monitors = screenshots.Monitor.all() as NodeScreenshotsMonitor[]
  const monitor = monitors.find((candidate) => monitorBoolean(candidate, "isPrimary")) ?? monitors[0]
  if (!monitor) throw new Error("未找到可截图的显示器")
  return monitor as NodeScreenshotsMonitor
}

async function captureMonitorImage(monitor: NodeScreenshotsMonitor): Promise<NodeScreenshotsImage> {
  if (monitor.captureImage) return await monitor.captureImage()
  if (monitor.captureImageSync) return monitor.captureImageSync()
  throw new Error("当前截图库不支持显示器截图")
}

async function cropImage(
  image: NodeScreenshotsImage,
  x: number,
  y: number,
  width: number,
  height: number,
): Promise<NodeScreenshotsImage> {
  if (image.crop) return await image.crop(Math.round(x), Math.round(y), Math.round(width), Math.round(height))
  if (image.cropSync) return image.cropSync(Math.round(x), Math.round(y), Math.round(width), Math.round(height))
  throw new Error("当前截图库不支持区域裁剪")
}

async function imageToPng(image: NodeScreenshotsImage): Promise<Uint8Array | Buffer> {
  if (image.toPng) return await image.toPng()
  if (image.toPngSync) return image.toPngSync()
  throw new Error("当前截图库不支持 PNG 输出")
}

export async function readArtifactBytes(artifact: ScreenshotPublicArtifact): Promise<Uint8Array> {
  return new Uint8Array(await readFile(artifact.tempPath))
}

type MonitorValue = string | number | boolean | undefined

function monitorValue(monitor: NodeScreenshotsMonitor, key: keyof NodeScreenshotsMonitor): MonitorValue {
  const value = monitor[key]
  if (typeof value === "function") return (value as () => MonitorValue).call(monitor)
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value
  return undefined
}

function monitorNumber(monitor: NodeScreenshotsMonitor, key: keyof NodeScreenshotsMonitor, fallback?: number): number {
  const value = monitorValue(monitor, key)
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (fallback !== undefined) return fallback
  throw new Error(`显示器 ${String(key)} 无效`)
}

function monitorBoolean(monitor: NodeScreenshotsMonitor, key: keyof NodeScreenshotsMonitor): boolean {
  return monitorValue(monitor, key) === true
}
