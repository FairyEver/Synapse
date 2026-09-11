import { renderDriveMarkdownFragment, type DriveMarkdownRenderOptions } from "./drive-markdown-renderer"

type RenderRequest = {
  readonly markdown: string
  readonly options: DriveMarkdownRenderOptions
}

const DRIVE_MARKDOWN_WORKER_RESULT_MAX_BYTES = 64 * 1024 * 1024

if (!process.send) throw new Error("Drive Markdown PDF render worker requires an IPC channel")

process.once("message", async (request: RenderRequest) => {
  try {
    const result = await renderDriveMarkdownFragment(request.markdown, request.options)
    if (Buffer.byteLength(JSON.stringify(result), "utf8") > DRIVE_MARKDOWN_WORKER_RESULT_MAX_BYTES) {
      process.send?.({
        ok: false,
        code: "RESOURCE_LIMIT",
        error: "Markdown rendering result exceeded its memory limit",
      }, () => process.disconnect?.())
      return
    }
    process.send?.({ ok: true, result }, () => process.disconnect?.())
  } catch (error) {
    process.send?.({
      ok: false,
      error: error instanceof Error ? error.message : "Markdown rendering failed",
    }, () => process.disconnect?.())
  }
})
