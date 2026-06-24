import { BrowserWindow, dialog, screen } from "electron"
import path from "node:path"
import { z } from "zod"
import type { IpcModule } from "../../../electron/runtime/ipc/types"
import type { AuditSink, PermissionAction, PermissionGuard } from "../../../electron/runtime/security"
import { rendererBaseUrl } from "../../../electron/modules/shared/renderer-base-url"
import { buildDetachedViewWindowUrl } from "../../../electron/services/detached-view-window-service"
import {
  screenshotArtifactSchema,
  screenshotCaptureInputSchema,
  screenshotCaptureToFileInputSchema,
  screenshotSaveArtifactInputSchema,
  screenshotInteractiveCaptureInputSchema,
  screenshotRegionSchema,
  screenshotClipboardResultSchema,
  screenshotSaveResultSchema,
  type ScreenshotArtifact,
  type ScreenshotCaptureInput,
  type ScreenshotCaptureToFileInput,
  type ScreenshotSaveArtifactInput,
  type ScreenshotInteractiveCaptureInput,
  type ScreenshotRegion,
} from "../shared/schema"
import { createScreenshotService } from "./service"
import { runWithScreenshotWindowState, waitForWindowTransition } from "./window-capture"

const chooseOutputPngRequestSchema = z.object({
  defaultPath: z.string().min(1).optional(),
}).optional()
const interactiveCaptureResponseSchema = screenshotArtifactSchema.nullable()

type ChooseOutputPngRequest = z.infer<typeof chooseOutputPngRequestSchema>

type InteractiveCaptureSession = {
  readonly id: string
  overlayWindow: BrowserWindow | null
  readonly resolve: (region: ScreenshotRegion | null) => void
}

let interactiveSession: InteractiveCaptureSession | null = null

export const screenshotIpcModule: IpcModule = {
  id: "screenshot",
  methods: {
    capture: {
      channel: "synapse:screenshot:capture",
      kind: "invoke",
      request: screenshotCaptureInputSchema,
      response: screenshotArtifactSchema,
      handler: async (_ctx, request: ScreenshotCaptureInput) => {
        return runWithScreenshotWindowState(
          { hideCurrentWindow: request.hideCurrentWindow === true },
          (screenshotContext) => createScreenshotService().capture(request, screenshotContext),
        )
      },
    },
    captureToFile: {
      channel: "synapse:screenshot:file:capture",
      kind: "invoke",
      request: screenshotCaptureToFileInputSchema,
      response: screenshotSaveResultSchema,
      handler: async (ctx, request: ScreenshotCaptureToFileInput) => {
        await authorizeFileAccess(ctx, "fs.write.outside-userdata", request.outputPath, "screenshot.captureToFile.output")
        return runWithScreenshotWindowState(
          { hideCurrentWindow: request.capture.hideCurrentWindow === true },
          (screenshotContext) => createScreenshotService().captureToFile(request, screenshotContext),
        )
      },
    },
    saveArtifact: {
      channel: "synapse:screenshot:file:save-artifact",
      kind: "invoke",
      request: screenshotSaveArtifactInputSchema,
      response: screenshotSaveResultSchema,
      handler: async (ctx, request: ScreenshotSaveArtifactInput) => {
        await authorizeFileAccess(ctx, "fs.write.outside-userdata", request.outputPath, "screenshot.saveArtifact.output")
        return createScreenshotService().saveArtifact(request)
      },
    },
    copyToClipboard: {
      channel: "synapse:screenshot:clipboard:copy",
      kind: "invoke",
      request: screenshotCaptureInputSchema,
      response: screenshotClipboardResultSchema,
      handler: async (_ctx, request: ScreenshotCaptureInput) => {
        return runWithScreenshotWindowState(
          { hideCurrentWindow: request.hideCurrentWindow === true },
          (screenshotContext) => createScreenshotService().captureToClipboard(request, screenshotContext),
        )
      },
    },
    copyArtifactToClipboard: {
      channel: "synapse:screenshot:clipboard:copy-artifact",
      kind: "invoke",
      request: screenshotArtifactSchema,
      response: screenshotClipboardResultSchema,
      handler: async (_ctx, artifact: ScreenshotArtifact) => {
        return createScreenshotService().copyArtifactToClipboard(artifact)
      },
    },
    startInteractiveCapture: {
      channel: "synapse:screenshot:interactive:start",
      kind: "invoke",
      request: screenshotInteractiveCaptureInputSchema,
      response: interactiveCaptureResponseSchema,
      handler: async (_ctx, request: ScreenshotInteractiveCaptureInput) => {
        if (interactiveSession) {
          throw new Error("已有截图正在进行")
        }
        return runWithScreenshotWindowState(
          { hideCurrentWindow: request.hideCurrentWindow === true },
          async (screenshotContext) => {
            const region = await openInteractiveOverlay()
            if (!region) return null
            return await createScreenshotService().capture({ mode: "region", region }, screenshotContext)
          },
        )
      },
    },
    completeInteractiveCapture: {
      channel: "synapse:screenshot:interactive:complete",
      kind: "invoke",
      request: screenshotRegionSchema,
      response: z.boolean(),
      handler: async (_ctx, region: ScreenshotRegion) => {
        const session = interactiveSession
        if (!session) return false
        finishInteractiveSession(session, region)
        return true
      },
    },
    cancelInteractiveCapture: {
      channel: "synapse:screenshot:interactive:cancel",
      kind: "invoke",
      request: z.void().optional(),
      response: z.boolean(),
      handler: async () => {
        const session = interactiveSession
        if (!session) return false
        finishInteractiveSession(session, null)
        return true
      },
    },
    chooseOutputFile: {
      channel: "synapse:screenshot:output:choose",
      kind: "invoke",
      request: chooseOutputPngRequestSchema,
      response: z.string().nullable(),
      handler: async (_ctx, request: ChooseOutputPngRequest) => {
        const parentWindow = focusedWindow()
        const options = {
          title: "选择输出文件",
          defaultPath: request?.defaultPath ?? "screenshot.png",
          filters: [{ name: "PNG 图片", extensions: ["png"] }],
        }
        const result = parentWindow
          ? await dialog.showSaveDialog(parentWindow, options)
          : await dialog.showSaveDialog(options)
        return result.canceled || !result.filePath ? null : result.filePath
      },
    },
  },
  events: {},
}

async function openInteractiveOverlay(): Promise<ScreenshotRegion | null> {
  const bounds = combinedDisplayBounds()
  const overlayWindow = new BrowserWindow({
    ...bounds,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    fullscreenable: false,
    hasShadow: false,
    title: "截图",
    webPreferences: {
      preload: path.join(__dirname, "../preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  overlayWindow.setAlwaysOnTop(true, "screen-saver")
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  const region = await new Promise<ScreenshotRegion | null>((resolve) => {
    const session: InteractiveCaptureSession = {
      id: `screenshot:${Date.now()}`,
      overlayWindow,
      resolve,
    }
    interactiveSession = session
    overlayWindow.on("closed", () => {
      if (interactiveSession?.id === session.id) {
        finishInteractiveSession(session, null)
      }
    })
    const params = new URLSearchParams({
      window: "screenshot-overlay",
      offsetX: String(bounds.x),
      offsetY: String(bounds.y),
    })
    void overlayWindow.loadURL(buildDetachedViewWindowUrl(rendererBaseUrl(), params))
    overlayWindow.once("ready-to-show", () => {
      overlayWindow.show()
      overlayWindow.focus()
    })
  })
  if (!overlayWindow.isDestroyed()) {
    overlayWindow.hide()
    overlayWindow.close()
  }
  if (region) {
    await waitForWindowTransition()
  }
  return region
}

function finishInteractiveSession(session: InteractiveCaptureSession, region: ScreenshotRegion | null): void {
  if (interactiveSession?.id !== session.id) return
  interactiveSession = null
  const overlayWindow = session.overlayWindow
  session.overlayWindow = null
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.hide()
    overlayWindow.close()
  }
  session.resolve(region)
}

function combinedDisplayBounds(): Electron.Rectangle {
  const displays = screen.getAllDisplays()
  if (displays.length === 0) {
    return { x: 0, y: 0, width: 1024, height: 768 }
  }
  const left = Math.min(...displays.map((display) => display.bounds.x))
  const top = Math.min(...displays.map((display) => display.bounds.y))
  const right = Math.max(...displays.map((display) => display.bounds.x + display.bounds.width))
  const bottom = Math.max(...displays.map((display) => display.bounds.y + display.bounds.height))
  return { x: left, y: top, width: right - left, height: bottom - top }
}

function focusedWindow(): Electron.BrowserWindow | undefined {
  return BrowserWindow.getFocusedWindow()
    ?? BrowserWindow.getAllWindows().find((window) => window.isVisible() && !window.isDestroyed())
    ?? undefined
}

async function authorizeFileAccess(
  ctx: Parameters<IpcModule["methods"][string]["handler"]>[0],
  action: PermissionAction,
  resource: string,
  source: string,
): Promise<void> {
  const permissionGuard = ctx.resolve<PermissionGuard>("core.permission-guard")
  const auditSink = ctx.resolve<AuditSink>("core.audit-sink")
  const actor = { kind: "user" } as const
  const permission = await permissionGuard.check({
    action,
    actor,
    resource,
    context: { source },
  })
  auditSink.record({
    action,
    actor,
    resource,
    outcome: permission.allowed ? "allowed" : "denied",
    metadata: permission.allowed
      ? { source }
      : { source, reason: permission.reason, policyId: permission.policyId },
  })
  if (!permission.allowed) {
    throw new Error(permission.reason)
  }
}
