import { describe, expect, it, vi } from "vitest"
import { DOCUMENT_TEMPLATE_CAPABILITY_ID } from "../document-template/shared/capability"
import { SCREENSHOT_CAPTURE_CAPABILITY_ID } from "../screenshot/shared/capability"
import { SOUND_NOTIFIER_PLAY_CAPABILITY_ID } from "../sound-notifier/shared/capability"
import { createAppCapabilityDispatcher } from "../dispatcher"

describe("createAppCapabilityDispatcher", () => {
  it("routes document template, screenshot, and sound notifier actions to their dispatchers", async () => {
    const documentTemplate = {
      dispatch: vi.fn(async () => ({ ok: true as const, data: { outputPath: "/tmp/out.docx" } })),
    }
    const screenshot = {
      dispatch: vi.fn(async () => ({ ok: true as const, data: { tempPath: "/tmp/screen.png" } })),
    }
    const soundNotifier = {
      dispatch: vi.fn(async () => ({ ok: true as const, data: { played: true } })),
    }
    const dispatcher = createAppCapabilityDispatcher({ documentTemplate, screenshot, soundNotifier })

    await dispatcher.dispatch(DOCUMENT_TEMPLATE_CAPABILITY_ID, {}, { source: "mcp-http" })
    await dispatcher.dispatch(SCREENSHOT_CAPTURE_CAPABILITY_ID, {}, { source: "mcp-http" })
    await dispatcher.dispatch(SOUND_NOTIFIER_PLAY_CAPABILITY_ID, {}, { source: "mcp-http" })

    expect(documentTemplate.dispatch).toHaveBeenCalledWith(DOCUMENT_TEMPLATE_CAPABILITY_ID, {}, { source: "mcp-http" })
    expect(screenshot.dispatch).toHaveBeenCalledWith(SCREENSHOT_CAPTURE_CAPABILITY_ID, {}, { source: "mcp-http" })
    expect(soundNotifier.dispatch).toHaveBeenCalledWith(SOUND_NOTIFIER_PLAY_CAPABILITY_ID, {}, { source: "mcp-http" })
  })

  it("rejects unknown app actions", async () => {
    const dispatcher = createAppCapabilityDispatcher({
      documentTemplate: { dispatch: vi.fn() },
      screenshot: { dispatch: vi.fn() },
      soundNotifier: { dispatch: vi.fn() },
    })

    await expect(dispatcher.dispatch("app.unknown.action", {}, { source: "mcp-http" }))
      .rejects.toThrow("Unknown app action")
  })
})
