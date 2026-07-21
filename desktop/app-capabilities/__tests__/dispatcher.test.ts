import { describe, expect, it, vi } from "vitest"
import { DOCUMENT_TEXT_EXTRACTOR_CAPABILITY_ID } from "../document-text-extractor/shared/capability"
import { DOCUMENT_TEMPLATE_CAPABILITY_ID } from "../document-template/shared/capability"
import { SECRETS_ITEM_LIST_CAPABILITY_ID } from "../secrets/shared/capability"
import { SOUND_NOTIFIER_PLAY_CAPABILITY_ID } from "../sound-notifier/shared/capability"
import { createAppCapabilityDispatcher } from "../dispatcher"

describe("createAppCapabilityDispatcher", () => {
  it("routes app capability actions to their dispatchers", async () => {
    const documentTemplate = {
      dispatch: vi.fn(async () => ({ ok: true as const, data: { outputPath: "/tmp/out.docx" } })),
    }
    const documentTextExtractor = {
      dispatch: vi.fn(async () => ({ ok: true as const, data: { text: "text" } })),
    }
    const soundNotifier = {
      dispatch: vi.fn(async () => ({ ok: true as const, data: { played: true } })),
    }
    const secrets = {
      dispatch: vi.fn(async () => ({ ok: true as const, data: { secrets: [], total: 0 } })),
    }
    const dispatcher = createAppCapabilityDispatcher({ documentTemplate, documentTextExtractor, secrets, soundNotifier })

    await dispatcher.dispatch(DOCUMENT_TEMPLATE_CAPABILITY_ID, {}, { source: "mcp-http" })
    await dispatcher.dispatch(DOCUMENT_TEXT_EXTRACTOR_CAPABILITY_ID, {}, { source: "mcp-http" })
    await dispatcher.dispatch(SOUND_NOTIFIER_PLAY_CAPABILITY_ID, {}, { source: "mcp-http" })
    await dispatcher.dispatch(SECRETS_ITEM_LIST_CAPABILITY_ID, {}, { source: "mcp-http" })

    expect(documentTemplate.dispatch).toHaveBeenCalledWith(DOCUMENT_TEMPLATE_CAPABILITY_ID, {}, { source: "mcp-http" })
    expect(documentTextExtractor.dispatch).toHaveBeenCalledWith(DOCUMENT_TEXT_EXTRACTOR_CAPABILITY_ID, {}, { source: "mcp-http" })
    expect(soundNotifier.dispatch).toHaveBeenCalledWith(SOUND_NOTIFIER_PLAY_CAPABILITY_ID, {}, { source: "mcp-http" })
    expect(secrets.dispatch).toHaveBeenCalledWith(SECRETS_ITEM_LIST_CAPABILITY_ID, {}, { source: "mcp-http" })
  })

  it("rejects unknown app actions", async () => {
    const dispatcher = createAppCapabilityDispatcher({
      documentTemplate: { dispatch: vi.fn() },
      documentTextExtractor: { dispatch: vi.fn() },
      secrets: { dispatch: vi.fn() },
      soundNotifier: { dispatch: vi.fn() },
    })

    await expect(dispatcher.dispatch("app.unknown.action", {}, { source: "mcp-http" }))
      .rejects.toThrow("Unknown app action")
  })
})
