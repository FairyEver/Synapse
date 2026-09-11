import { parentPort } from "node:worker_threads"
import { renderDriveMarkdownFragment, type DriveMarkdownRenderOptions } from "./drive-markdown-renderer"

type RenderRequest = {
  readonly markdown: string
  readonly options: DriveMarkdownRenderOptions
}

if (!parentPort) throw new Error("Drive Markdown PDF render worker requires a parent port")
const port = parentPort

port.once("message", async (request: RenderRequest) => {
  try {
    const result = await renderDriveMarkdownFragment(request.markdown, request.options)
    port.postMessage({ ok: true, result })
  } catch (error) {
    port.postMessage({
      ok: false,
      error: error instanceof Error ? error.message : "Markdown rendering failed",
    })
  }
})
