import { mkdir, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  createScreenshotService,
  createNodeScreenshotsProvider,
  type ScreenshotCaptureProvider,
  type ScreenshotClipboardAdapter,
} from "../service"

const PNG_BYTES = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3])
const REGION_BYTES = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 4, 5, 6])

describe("ScreenshotService", () => {
  let tempRoot: string

  beforeEach(async () => {
    tempRoot = path.join(os.tmpdir(), `synapse-screenshot-test-${process.pid}-${Date.now()}`)
    await mkdir(tempRoot, { recursive: true })
  })

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true })
    vi.resetModules()
    vi.doUnmock("node-screenshots")
  })

  it("captures fullscreen screenshots as PNG artifacts with a temp file", async () => {
    const provider: ScreenshotCaptureProvider = {
      capture: vi.fn(async () => ({
        bytes: PNG_BYTES,
        width: 1440,
        height: 900,
        displayId: "display-1",
        scaleFactor: 2,
      })),
    }
    const service = createScreenshotService({
      provider,
      tempRoot,
      now: () => new Date("2026-06-24T08:00:00.000Z"),
      idFactory: () => "shot-1",
    })

    const artifact = await service.capture({ mode: "fullscreen" })

    expect(provider.capture).toHaveBeenCalledWith({ mode: "fullscreen" }, undefined)
    expect(artifact).toMatchObject({
      id: "shot-1",
      mimeType: "image/png",
      width: 1440,
      height: 900,
      size: PNG_BYTES.byteLength,
      tempPath: path.join(tempRoot, "shot-1.png"),
      capture: {
        mode: "fullscreen",
        coordinateSpace: "screen",
        displayId: "display-1",
        scaleFactor: 2,
        capturedAt: "2026-06-24T08:00:00.000Z",
      },
    })
    expect([...artifact.bytes]).toEqual([...PNG_BYTES])
    expect([...await readFile(artifact.tempPath)]).toEqual([...PNG_BYTES])
  })

  it("captures coordinate regions and preserves region metadata", async () => {
    const provider: ScreenshotCaptureProvider = {
      capture: vi.fn(async () => ({
        bytes: REGION_BYTES,
        width: 320,
        height: 180,
      })),
    }
    const service = createScreenshotService({
      provider,
      tempRoot,
      now: () => new Date("2026-06-24T08:01:00.000Z"),
      idFactory: () => "shot-region",
    })
    const region = { x: 10, y: 20, width: 320, height: 180 }

    const artifact = await service.capture({ mode: "region", region })

    expect(provider.capture).toHaveBeenCalledWith({ mode: "region", region }, undefined)
    expect(artifact.capture.region).toEqual(region)
    expect(artifact.width).toBe(320)
    expect(artifact.height).toBe(180)
  })

  it("saves captured artifacts to an explicit output path", async () => {
    const provider: ScreenshotCaptureProvider = {
      capture: vi.fn(async () => ({ bytes: PNG_BYTES, width: 12, height: 8 })),
    }
    const service = createScreenshotService({
      provider,
      tempRoot,
      idFactory: () => "shot-save",
    })
    const outputPath = path.join(tempRoot, "exports", "screen.png")

    const result = await service.captureToFile({
      capture: { mode: "fullscreen" },
      outputPath,
    })

    expect(result.outputPath).toBe(outputPath)
    expect(result.fileName).toBe("screen.png")
    expect(result.size).toBe(PNG_BYTES.byteLength)
    expect([...await readFile(outputPath)]).toEqual([...PNG_BYTES])
  })

  it("copies captured artifacts to clipboard through an adapter", async () => {
    const clipboard: ScreenshotClipboardAdapter = {
      writePng: vi.fn(),
    }
    const provider: ScreenshotCaptureProvider = {
      capture: vi.fn(async () => ({ bytes: PNG_BYTES, width: 12, height: 8 })),
    }
    const service = createScreenshotService({
      provider,
      clipboard,
      tempRoot,
      idFactory: () => "shot-copy",
    })

    const result = await service.captureToClipboard({ mode: "fullscreen" })

    expect(clipboard.writePng).toHaveBeenCalledWith(PNG_BYTES)
    expect(result).toMatchObject({
      copied: true,
      artifact: {
        id: "shot-copy",
        mimeType: "image/png",
      },
    })
  })

  it("copies an existing artifact without taking another screenshot", async () => {
    const clipboard: ScreenshotClipboardAdapter = {
      writePng: vi.fn(),
    }
    const provider: ScreenshotCaptureProvider = {
      capture: vi.fn(async () => ({ bytes: PNG_BYTES, width: 12, height: 8 })),
    }
    const service = createScreenshotService({
      provider,
      clipboard,
      tempRoot,
      idFactory: () => "shot-copy-existing",
    })
    const artifact = await service.capture({ mode: "fullscreen" })

    const result = await service.copyArtifactToClipboard(artifact)

    expect(provider.capture).toHaveBeenCalledTimes(1)
    expect(clipboard.writePng).toHaveBeenCalledWith(PNG_BYTES)
    expect(result.artifact.id).toBe("shot-copy-existing")
  })

  it("uses the target point to pick the current monitor for fullscreen captures", async () => {
    vi.doMock("node-screenshots", () => ({
      Monitor: {
        all: vi.fn(() => [createMonitor({ id: 1, primary: true })]),
        fromPoint: vi.fn(() => createMonitor({ id: 2, x: 1440, width: 1920, height: 1080 })),
      },
    }))
    const provider = createNodeScreenshotsProvider()

    const image = await provider.capture({ mode: "fullscreen" }, { targetPoint: { x: 1500, y: 40 } })

    const screenshots = await import("node-screenshots") as {
      Monitor: { fromPoint: ReturnType<typeof vi.fn> }
    }
    expect(screenshots.Monitor.fromPoint).toHaveBeenCalledWith(1500, 40)
    expect(image).toMatchObject({
      width: 1920,
      height: 1080,
      displayId: "2",
    })
  })

  it("falls back to the primary monitor when no target point is provided", async () => {
    vi.doMock("node-screenshots", () => ({
      Monitor: {
        all: vi.fn(() => [
          createMonitor({ id: 1, primary: false }),
          createMonitor({ id: 2, primary: true, width: 1600, height: 900 }),
        ]),
        fromPoint: vi.fn(() => null),
      },
    }))
    const provider = createNodeScreenshotsProvider()

    const image = await provider.capture({ mode: "fullscreen" })

    expect(image).toMatchObject({
      width: 1600,
      height: 900,
      displayId: "2",
    })
  })

  it("falls back to the primary monitor when target point lookup misses", async () => {
    vi.doMock("node-screenshots", () => ({
      Monitor: {
        all: vi.fn(() => [createMonitor({ id: 3, primary: true, width: 1280, height: 720 })]),
        fromPoint: vi.fn(() => null),
      },
    }))
    const provider = createNodeScreenshotsProvider()

    const image = await provider.capture({ mode: "fullscreen" }, { targetPoint: { x: -9999, y: -9999 } })

    expect(image).toMatchObject({
      width: 1280,
      height: 720,
      displayId: "3",
    })
  })

  it("awaits async region cropping from node-screenshots", async () => {
    const crop = vi.fn(async () => ({
      toPng: vi.fn(async () => REGION_BYTES),
    }))
    vi.doMock("node-screenshots", () => ({
      Monitor: {
        all: vi.fn(() => []),
        fromPoint: vi.fn(() => ({
          ...createMonitor({ id: 4, x: 100, y: 200 }),
          captureImage: vi.fn(async () => ({
            crop,
            toPng: vi.fn(async () => PNG_BYTES),
          })),
        })),
      },
    }))
    const provider = createNodeScreenshotsProvider()

    const image = await provider.capture({
      mode: "region",
      region: { x: 120, y: 230, width: 300, height: 160 },
    })

    expect(crop).toHaveBeenCalledWith(20, 30, 300, 160)
    expect([...image.bytes]).toEqual([...REGION_BYTES])
  })
})

function createMonitor(input: {
  readonly id: number
  readonly x?: number
  readonly y?: number
  readonly width?: number
  readonly height?: number
  readonly primary?: boolean
}) {
  return {
    id: () => input.id,
    x: () => input.x ?? 0,
    y: () => input.y ?? 0,
    width: () => input.width ?? 1440,
    height: () => input.height ?? 900,
    scaleFactor: () => 2,
    isPrimary: () => input.primary === true,
    captureImage: vi.fn(async () => ({
      crop: vi.fn((() => ({
        toPng: vi.fn(async () => REGION_BYTES),
      }))),
      toPng: vi.fn(async () => PNG_BYTES),
    })),
  }
}
