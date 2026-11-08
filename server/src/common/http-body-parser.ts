import express, { type Request, type Response, type NextFunction } from "express"
import { isHubUploadPath } from "../skill-hub/skill-hub-log"
import type { NestExpressApplication } from "@nestjs/platform-express"
import { problemFeedbackRawJsonParser } from "../problem-feedback/problem-feedback-http"

export const httpJsonBodyLimit = "1mb"
export const driveTextEditJsonBodyLimit = "110mb"
export const webhookRawBodyLimit = "256kb"

export function registerHttpBodyParsers(app: NestExpressApplication): void {
  app.use(problemFeedbackRawJsonParser)
  app.use(captureWebhookBody)
  app.useBodyParser("json", { type: isDriveTextEditJsonBodyRequest, limit: driveTextEditJsonBodyLimit })
  const json = express.json({ limit: httpJsonBodyLimit })
  const form = express.urlencoded({ extended: true, limit: httpJsonBodyLimit })
  // The authenticated Hub handler is the only consumer of this raw stream.
  app.use((request: Request, response: Response, next: NextFunction) => {
    if (isHubUploadPath(request.originalUrl ?? request.url) || isWebhookRawBodyRequest(request)) return next()
    json(request, response, (error?: unknown) => error ? next(error) : form(request, response, next))
  })
}

export function isWebhookRawBodyRequest(request: { readonly url?: string }): boolean {
  return /^\/webhooks\//iu.test(request.url ?? "")
}

// body-parser inflates Content-Encoding before exposing the buffer. A forwarding
// endpoint must retain the actual wire entity, including malformed/opaque data.
function captureWebhookBody(request: Request, response: Response, next: NextFunction): void {
  if (!isWebhookRawBodyRequest(request)) return next()
  const limit = 256 * 1024
  const chunks: Buffer[] = []
  let size = 0
  let finished = false
  const fail = (status: number) => {
    if (finished) return
    finished = true
    chunks.length = 0
    response.status(status).json({ statusCode: status, message: status === 413 ? "Webhook body is too large" : "Incomplete webhook body" })
  }
  request.on("data", (chunk: Buffer) => {
    if (finished) return
    size += chunk.length
    if (size > limit) return fail(413)
    chunks.push(chunk)
  })
  request.once("aborted", () => fail(400))
  request.once("error", () => fail(400))
  request.once("end", () => {
    if (finished) return
    finished = true
    request.body = Buffer.concat(chunks, size)
    chunks.length = 0
    next()
  })
}

export function isDriveTextEditJsonBodyRequest(request: { readonly url?: string }): boolean {
  const pathname = request.url?.split("?")[0] ?? ""
  return /^\/api\/drive\/browser\/(?:owner\/items\/[^/]+|shares\/[^/]+(?:\/items\/[^/]+)?)\/content$/u.test(pathname)
}
