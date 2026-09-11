import { PdfRenderer } from "./pdf-renderer"
import { createPdfRendererServer } from "./http-server"

const port = parsePort(process.env.PORT)
const internalSecret = requireSecret(process.env.PDF_RENDERER_INTERNAL_SECRET)
const renderer = new PdfRenderer()
const server = createPdfRendererServer({ renderer, internalSecret, log })

server.listen(port, "0.0.0.0", () => log("pdf_renderer_started", { port }))

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    server.close(() => {
      void renderer.close().finally(() => process.exit(0))
    })
  })
}

function parsePort(value: string | undefined): number {
  const parsed = Number(value ?? 3010)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) throw new Error("PORT is invalid")
  return parsed
}

function requireSecret(value: string | undefined): string {
  if (!value || value.length < 32) throw new Error("PDF_RENDERER_INTERNAL_SECRET must contain at least 32 characters")
  return value
}

function log(event: string, detail: unknown): void {
  process.stdout.write(`${JSON.stringify({ level: "info", event, detail: sanitizeLogDetail(detail), at: new Date().toISOString() })}\n`)
}

function sanitizeLogDetail(detail: unknown): unknown {
  if (detail instanceof Error) return { name: detail.name }
  return detail
}
