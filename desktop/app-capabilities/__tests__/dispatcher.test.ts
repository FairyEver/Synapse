import { describe, expect, it, vi } from "vitest"
import { DOCUMENT_TEMPLATE_CAPABILITY_ID } from "../document-template/shared/capability"
import { SCREENSHOT_CAPTURE_CAPABILITY_ID } from "../screenshot/shared/capability"
import { SOUND_NOTIFIER_PLAY_CAPABILITY_ID } from "../sound-notifier/shared/capability"
import { SWARM_TASK_TASK_LIST_CAPABILITY_ID } from "../swarm-task/shared/capability"
import { createAppCapabilityDispatcher } from "../dispatcher"

describe("createAppCapabilityDispatcher", () => {
  it("routes document template, screenshot, sound notifier, and swarm task actions to their dispatchers", async () => {
    const documentTemplate = {
      dispatch: vi.fn(async () => ({ ok: true as const, data: { outputPath: "/tmp/out.docx" } })),
    }
    const screenshot = {
      dispatch: vi.fn(async () => ({ ok: true as const, data: { tempPath: "/tmp/screen.png" } })),
    }
    const soundNotifier = {
      dispatch: vi.fn(async () => ({ ok: true as const, data: { played: true } })),
    }
    const swarmTask = {
      dispatch: vi.fn(async () => ({ ok: true as const, data: [] })),
    }
    const dispatcher = createAppCapabilityDispatcher({ documentTemplate, screenshot, soundNotifier, swarmTask })

    await dispatcher.dispatch(DOCUMENT_TEMPLATE_CAPABILITY_ID, {}, { source: "mcp-http" })
    await dispatcher.dispatch(SCREENSHOT_CAPTURE_CAPABILITY_ID, {}, { source: "mcp-http" })
    await dispatcher.dispatch(SOUND_NOTIFIER_PLAY_CAPABILITY_ID, {}, { source: "mcp-http" })
    await dispatcher.dispatch(SWARM_TASK_TASK_LIST_CAPABILITY_ID, {}, { source: "mcp-http" })

    expect(documentTemplate.dispatch).toHaveBeenCalledWith(DOCUMENT_TEMPLATE_CAPABILITY_ID, {}, { source: "mcp-http" })
    expect(screenshot.dispatch).toHaveBeenCalledWith(SCREENSHOT_CAPTURE_CAPABILITY_ID, {}, { source: "mcp-http" })
    expect(soundNotifier.dispatch).toHaveBeenCalledWith(SOUND_NOTIFIER_PLAY_CAPABILITY_ID, {}, { source: "mcp-http" })
    expect(swarmTask.dispatch).toHaveBeenCalledWith(SWARM_TASK_TASK_LIST_CAPABILITY_ID, {}, { source: "mcp-http" })
  })

  it("rejects unknown app actions", async () => {
    const dispatcher = createAppCapabilityDispatcher({
      documentTemplate: { dispatch: vi.fn() },
      screenshot: { dispatch: vi.fn() },
      soundNotifier: { dispatch: vi.fn() },
      swarmTask: { dispatch: vi.fn() },
    })

    await expect(dispatcher.dispatch("app.unknown.action", {}, { source: "mcp-http" }))
      .rejects.toThrow("Unknown app action")
  })
})
