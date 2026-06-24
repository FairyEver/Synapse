import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  SCREENSHOT_CAPTURE_CAPABILITY_ID,
  SCREENSHOT_FILE_SAVE_CAPABILITY_ID,
} from "../../shared/capability"
import { createScreenshotCapabilityDispatcher } from "../dispatcher"

const windowCaptureMock = vi.hoisted(() => ({
  runWithScreenshotWindowState: vi.fn(async (_options, operation) =>
    operation({ targetPoint: { x: 500, y: 300 } })),
}))

vi.mock("../window-capture", () => ({
  runWithScreenshotWindowState: windowCaptureMock.runWithScreenshotWindowState,
}))

const publicArtifact = {
  id: "shot-1",
  mimeType: "image/png" as const,
  size: 11,
  width: 1440,
  height: 900,
  tempPath: "/tmp/shot-1.png",
  capture: {
    mode: "fullscreen" as const,
    coordinateSpace: "screen" as const,
    capturedAt: "2026-06-24T08:00:00.000Z",
  },
}

describe("createScreenshotCapabilityDispatcher", () => {
  beforeEach(() => {
    windowCaptureMock.runWithScreenshotWindowState.mockClear()
    windowCaptureMock.runWithScreenshotWindowState.mockImplementation(async (_options, operation) =>
      operation({ targetPoint: { x: 500, y: 300 } }))
  })

  it("dispatches capture without returning raw bytes", async () => {
    const service = {
      capture: vi.fn(async () => ({ ...publicArtifact, bytes: new Uint8Array([1, 2, 3]) })),
      captureToFile: vi.fn(),
      captureToClipboard: vi.fn(),
      saveArtifact: vi.fn(),
    }
    const dispatcher = createScreenshotCapabilityDispatcher({ service })

    await expect(dispatcher.dispatch(
      SCREENSHOT_CAPTURE_CAPABILITY_ID,
      { mode: "fullscreen" },
      { source: "mcp-http" },
    )).resolves.toEqual({
      ok: true,
      data: publicArtifact,
      affected: 1,
    })
    expect(windowCaptureMock.runWithScreenshotWindowState).toHaveBeenCalledWith(
      { hideCurrentWindow: false },
      expect.any(Function),
    )
    expect(service.capture).toHaveBeenCalledWith(
      { mode: "fullscreen" },
      { targetPoint: { x: 500, y: 300 } },
    )
  })

  it("honors hideCurrentWindow for MCP capture requests", async () => {
    const service = {
      capture: vi.fn(async () => ({ ...publicArtifact, bytes: new Uint8Array([1, 2, 3]) })),
      captureToFile: vi.fn(),
      captureToClipboard: vi.fn(),
      saveArtifact: vi.fn(),
    }
    const dispatcher = createScreenshotCapabilityDispatcher({ service })

    await dispatcher.dispatch(
      SCREENSHOT_CAPTURE_CAPABILITY_ID,
      { mode: "fullscreen", hideCurrentWindow: true },
      { source: "mcp-http" },
    )

    expect(windowCaptureMock.runWithScreenshotWindowState).toHaveBeenCalledWith(
      { hideCurrentWindow: true },
      expect.any(Function),
    )
  })

  it("checks write permission before saving a screenshot file", async () => {
    const service = {
      capture: vi.fn(),
      captureToFile: vi.fn(async () => ({
        outputPath: "/tmp/screen.png",
        fileName: "screen.png",
        size: 11,
        artifact: publicArtifact,
      })),
      captureToClipboard: vi.fn(),
      saveArtifact: vi.fn(),
    }
    const permissionGuard = {
      check: vi.fn(async () => ({ allowed: true as const })),
    }
    const auditSink = {
      record: vi.fn(),
    }
    const dispatcher = createScreenshotCapabilityDispatcher({
      service,
      permissionGuard: permissionGuard as never,
      auditSink: auditSink as never,
    })

    await dispatcher.dispatch(SCREENSHOT_FILE_SAVE_CAPABILITY_ID, {
      capture: { mode: "region", region: { x: 1, y: 2, width: 3, height: 4 } },
      outputPath: "/tmp/screen.png",
    }, { source: "mcp-http" })

    expect(permissionGuard.check).toHaveBeenCalledWith(expect.objectContaining({
      action: "fs.write.outside-userdata",
      resource: "/tmp/screen.png",
    }))
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({ outcome: "allowed" }))
    expect(service.captureToFile).toHaveBeenCalledWith(
      {
        capture: { mode: "region", region: { x: 1, y: 2, width: 3, height: 4 } },
        outputPath: "/tmp/screen.png",
      },
      { targetPoint: { x: 500, y: 300 } },
    )
  })

  it("rejects unknown screenshot actions", async () => {
    const dispatcher = createScreenshotCapabilityDispatcher({
      service: {
        capture: vi.fn(),
        captureToFile: vi.fn(),
        captureToClipboard: vi.fn(),
        saveArtifact: vi.fn(),
      },
    })

    await expect(dispatcher.dispatch("app.screenshot.missing", {}, { source: "mcp-http" }))
      .rejects.toThrow("Unknown screenshot action")
  })
})
