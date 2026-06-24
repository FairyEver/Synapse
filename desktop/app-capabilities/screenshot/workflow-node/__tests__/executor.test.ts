import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ScreenshotNodeConfig } from "../schema"
import { screenshotNodeExecutor } from "../executor.main"

const captureToFile = vi.fn()
const windowCaptureMock = vi.hoisted(() => ({
  runWithScreenshotWindowState: vi.fn(async (_options, operation) =>
    operation({ targetPoint: { x: 700, y: 400 } })),
}))

vi.mock("../../main/service", () => ({
  createScreenshotService: () => ({ captureToFile }),
}))

vi.mock("../../main/window-capture", () => ({
  runWithScreenshotWindowState: windowCaptureMock.runWithScreenshotWindowState,
}))

describe("screenshotNodeExecutor", () => {
  beforeEach(() => {
    captureToFile.mockReset()
    windowCaptureMock.runWithScreenshotWindowState.mockClear()
    windowCaptureMock.runWithScreenshotWindowState.mockImplementation(async (_options, operation) =>
      operation({ targetPoint: { x: 700, y: 400 } }))
  })

  it("captures a region screenshot to a file", async () => {
    captureToFile.mockResolvedValueOnce({
      outputPath: "/tmp/screen.png",
      fileName: "screen.png",
      size: 123,
      artifact: {
        id: "shot-1",
        mimeType: "image/png",
        width: 10,
        height: 20,
        size: 123,
        tempPath: "/tmp/shot-1.png",
        capture: {
          mode: "region",
          region: { x: 1, y: 2, width: 10, height: 20 },
          coordinateSpace: "screen",
          capturedAt: "2026-06-24T08:00:00.000Z",
        },
      },
    })
    const permissionGuard = { check: vi.fn(async () => ({ allowed: true as const })) }
    const auditSink = { record: vi.fn() }

    const result = await screenshotNodeExecutor.execute(createInput({
      mode: "region",
      x: "1",
      y: "2",
      width: "10",
      height: "20",
      outputPath: "/tmp/{{name}}.png",
      overwrite: false,
      hideCurrentWindow: true,
      variables: [],
    }, {
      resolvedVariables: { name: "screen" },
      runtimeDeps: { permissionGuard, auditSink } as never,
    }))

    expect(result.status).toBe("success")
    expect(result.output).toBe("/tmp/screen.png")
    expect(windowCaptureMock.runWithScreenshotWindowState).toHaveBeenCalledWith(
      { hideCurrentWindow: true },
      expect.any(Function),
    )
    expect(captureToFile).toHaveBeenCalledWith(
      {
        capture: {
          mode: "region",
          region: { x: 1, y: 2, width: 10, height: 20 },
          hideCurrentWindow: true,
        },
        outputPath: "/tmp/screen.png",
        overwrite: false,
      },
      { targetPoint: { x: 700, y: 400 } },
    )
    expect(permissionGuard.check).toHaveBeenCalledWith(expect.objectContaining({
      action: "fs.write.outside-userdata",
      resource: "/tmp/screen.png",
    }))
  })
})

function createInput(
  config: ScreenshotNodeConfig,
  overrides: Partial<Parameters<typeof screenshotNodeExecutor.execute>[0]> = {},
): Parameters<typeof screenshotNodeExecutor.execute>[0] {
  return {
    config,
    resolvedVariables: {},
    context: { runId: "run-1", abortSignal: new AbortController().signal },
    agentDeps: {} as never,
    ...overrides,
  }
}
