import path from "node:path"
import { describe, expect, it } from "vitest"
import { isInteractiveSessionSender, resolveScreenshotOverlayPreloadPath, screenshotIpcModule } from "../ipc"

describe("screenshotIpcModule", () => {
  it("declares screenshot channels", () => {
    expect(screenshotIpcModule.id).toBe("screenshot")
    expect(screenshotIpcModule.methods.capture.channel).toBe("synapse:screenshot:capture")
    expect(screenshotIpcModule.methods.captureToFile.channel).toBe("synapse:screenshot:file:capture")
    expect(screenshotIpcModule.methods.saveArtifact.channel).toBe("synapse:screenshot:file:save-artifact")
    expect(screenshotIpcModule.methods.copyToClipboard.channel).toBe("synapse:screenshot:clipboard:copy")
    expect(screenshotIpcModule.methods.copyArtifactToClipboard.channel).toBe("synapse:screenshot:clipboard:copy-artifact")
    expect(screenshotIpcModule.methods.startInteractiveCapture.channel).toBe("synapse:screenshot:interactive:start")
    expect(screenshotIpcModule.methods.completeInteractiveCapture.channel).toBe("synapse:screenshot:interactive:complete")
    expect(screenshotIpcModule.methods.cancelInteractiveCapture.channel).toBe("synapse:screenshot:interactive:cancel")
    expect(screenshotIpcModule.methods.chooseOutputFile.channel).toBe("synapse:screenshot:output:choose")
  })

  it("validates region capture requests", () => {
    const request = screenshotIpcModule.methods.capture.request
    expect(request.safeParse({ mode: "fullscreen" }).success).toBe(true)
    expect(request.safeParse({
      mode: "region",
      region: { x: 0, y: 0, width: 100, height: 80 },
    }).success).toBe(true)
    expect(request.safeParse({ mode: "region" }).success).toBe(false)
  })

  it("resolves the overlay preload from app-capabilities to the Electron preload", () => {
    expect(resolveScreenshotOverlayPreloadPath("/repo/desktop/dist-electron/app-capabilities/screenshot/main"))
      .toBe(path.join("/repo/desktop/dist-electron/electron", "preload.js"))
  })

  it("accepts interactive completion only from the overlay webContents", () => {
    const session = { overlayWebContentsId: 38 }

    expect(isInteractiveSessionSender(session, 38)).toBe(true)
    expect(isInteractiveSessionSender(session, 39)).toBe(false)
    expect(isInteractiveSessionSender(session, undefined)).toBe(false)
  })
})
