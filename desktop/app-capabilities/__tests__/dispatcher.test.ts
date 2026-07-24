import { describe, expect, it, vi } from "vitest"
import {
  TEXT_EXTRACTOR_CAPABILITY_ID,
  TEXT_EXTRACTOR_TO_FILE_CAPABILITY_ID,
} from "../text-extractor/shared/capability"
import { DOCUMENT_TEMPLATE_CAPABILITY_ID } from "../document-template/shared/capability"
import { SECRETS_ITEM_LIST_CAPABILITY_ID } from "../secrets/shared/capability"
import { SOUND_NOTIFIER_PLAY_CAPABILITY_ID } from "../sound-notifier/shared/capability"
import { FILE_OPENER_CAPABILITY_ID } from "../file-opener/shared/capability"
import { TEXT_FILE_WRITER_CAPABILITY_ID } from "../text-file-writer/shared/capability"
import { createAppCapabilityDispatcher } from "../dispatcher"
import { PROBLEM_FEEDBACK_SUBMIT_CAPABILITY_ID } from "../problem-feedback/shared/capability"
import { JSON_REPAIR_CAPABILITY_ID } from "../json-repair/shared/capability"

describe("createAppCapabilityDispatcher", () => {
  it("routes app capability actions to their dispatchers", async () => {
    const documentTemplate = {
      dispatch: vi.fn(async () => ({ ok: true as const, data: { outputPath: "/tmp/out.docx" } })),
    }
    const textExtractor = {
      dispatch: vi.fn(async () => ({ ok: true as const, data: { text: "text" } })),
    }
    const soundNotifier = {
      dispatch: vi.fn(async () => ({ ok: true as const, data: { played: true } })),
    }
    const secrets = {
      dispatch: vi.fn(async () => ({ ok: true as const, data: { secrets: [], total: 0 } })),
    }
    const fileOpener = {
      dispatch: vi.fn(async () => ({ ok: true as const, data: { path: "/tmp/report.txt" } })),
    }
    const textFileWriter = {
      dispatch: vi.fn(async () => ({ ok: true as const, data: { path: "/tmp/report.md" } })),
    }
    const systemNotifier = { dispatch: vi.fn(async () => ({ ok: true as const })) }
    const htmlGenerator = { dispatch: vi.fn(async () => ({ ok: true as const })) }
    const problemFeedback = { dispatch: vi.fn(async () => ({ ok: true as const })) }
    const jsonRepair = { dispatch: vi.fn(async () => ({ ok: true as const })) }
    const dispatcher = createAppCapabilityDispatcher({
      documentTemplate,
      textExtractor,
      secrets,
      soundNotifier,
      systemNotifier,
      fileOpener,
      textFileWriter,
      htmlGenerator,
      problemFeedback,
      jsonRepair,
    })

    await dispatcher.dispatch(DOCUMENT_TEMPLATE_CAPABILITY_ID, {}, { source: "mcp-http" })
    await dispatcher.dispatch(TEXT_EXTRACTOR_CAPABILITY_ID, {}, { source: "mcp-http" })
    await dispatcher.dispatch(TEXT_EXTRACTOR_TO_FILE_CAPABILITY_ID, {}, { source: "mcp-http" })
    await dispatcher.dispatch(SOUND_NOTIFIER_PLAY_CAPABILITY_ID, {}, { source: "mcp-http" })
    await dispatcher.dispatch(SECRETS_ITEM_LIST_CAPABILITY_ID, {}, { source: "mcp-http" })
    await dispatcher.dispatch(FILE_OPENER_CAPABILITY_ID, {}, { source: "mcp-http" })
    await dispatcher.dispatch(TEXT_FILE_WRITER_CAPABILITY_ID, {}, { source: "mcp-http" })
    await dispatcher.dispatch(PROBLEM_FEEDBACK_SUBMIT_CAPABILITY_ID, {}, { source: "mcp-http" })
    await dispatcher.dispatch(JSON_REPAIR_CAPABILITY_ID, {}, { source: "mcp-http" })

    expect(documentTemplate.dispatch).toHaveBeenCalledWith(DOCUMENT_TEMPLATE_CAPABILITY_ID, {}, { source: "mcp-http" })
    expect(textExtractor.dispatch).toHaveBeenCalledWith(TEXT_EXTRACTOR_CAPABILITY_ID, {}, { source: "mcp-http" })
    expect(textExtractor.dispatch).toHaveBeenCalledWith(TEXT_EXTRACTOR_TO_FILE_CAPABILITY_ID, {}, { source: "mcp-http" })
    expect(soundNotifier.dispatch).toHaveBeenCalledWith(SOUND_NOTIFIER_PLAY_CAPABILITY_ID, {}, { source: "mcp-http" })
    expect(secrets.dispatch).toHaveBeenCalledWith(SECRETS_ITEM_LIST_CAPABILITY_ID, {}, { source: "mcp-http" })
    expect(fileOpener.dispatch).toHaveBeenCalledWith(FILE_OPENER_CAPABILITY_ID, {}, { source: "mcp-http" })
    expect(textFileWriter.dispatch).toHaveBeenCalledWith(TEXT_FILE_WRITER_CAPABILITY_ID, {}, { source: "mcp-http" })
    expect(problemFeedback.dispatch).toHaveBeenCalledWith(PROBLEM_FEEDBACK_SUBMIT_CAPABILITY_ID, {}, { source: "mcp-http" })
    expect(jsonRepair.dispatch).toHaveBeenCalledWith(JSON_REPAIR_CAPABILITY_ID, {}, { source: "mcp-http" })
  })

  it("rejects unknown app actions", async () => {
    const dispatcher = createAppCapabilityDispatcher({
      documentTemplate: { dispatch: vi.fn() },
      textExtractor: { dispatch: vi.fn() },
      secrets: { dispatch: vi.fn() },
      soundNotifier: { dispatch: vi.fn() },
      systemNotifier: { dispatch: vi.fn() },
      fileOpener: { dispatch: vi.fn() },
      textFileWriter: { dispatch: vi.fn() },
      htmlGenerator: { dispatch: vi.fn() },
      problemFeedback: { dispatch: vi.fn() },
      jsonRepair: { dispatch: vi.fn() },
    })

    await expect(dispatcher.dispatch("app.unknown.action", {}, { source: "mcp-http" }))
      .rejects.toThrow("Unknown app action")
  })
})
