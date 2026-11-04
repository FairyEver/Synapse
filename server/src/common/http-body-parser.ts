import express, { type Request, type Response, type NextFunction } from "express"
import { isHubUploadPath } from "../skill-hub/skill-hub-log"
import type { NestExpressApplication } from "@nestjs/platform-express"
import { problemFeedbackRawJsonParser } from "../problem-feedback/problem-feedback-http"

export const httpJsonBodyLimit = "1mb"
export const driveTextEditJsonBodyLimit = "110mb"
export const webhookRawBodyLimit = "256kb"

export function registerHttpBodyParsers(app: NestExpressApplication): void {
  app.use(problemFeedbackRawJsonParser)
  app.useBodyParser("raw", { type: isWebhookRawBodyRequest, limit: webhookRawBodyLimit })
  app.useBodyParser("json", { type: isDriveTextEditJsonBodyRequest, limit: driveTextEditJsonBodyLimit })
  const json = express.json({ limit: httpJsonBodyLimit })
  const form = express.urlencoded({ extended: true, limit: httpJsonBodyLimit })
  // The authenticated Hub handler is the only consumer of this raw stream.
  app.use((request: Request, response: Response, next: NextFunction) => {
    if (isHubUploadPath(request.originalUrl ?? request.url)) return next()
    json(request, response, (error?: unknown) => error ? next(error) : form(request, response, next))
  })
}

export function isWebhookRawBodyRequest(request: { readonly url?: string }): boolean {
  return request.url?.startsWith("/webhooks/") ?? false
}

export function isDriveTextEditJsonBodyRequest(request: { readonly url?: string }): boolean {
  const pathname = request.url?.split("?")[0] ?? ""
  return /^\/api\/drive\/browser\/(?:owner\/items\/[^/]+|shares\/[^/]+(?:\/items\/[^/]+)?)\/content$/u.test(pathname)
}
