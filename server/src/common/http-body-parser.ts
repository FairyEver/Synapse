import type { NestExpressApplication } from "@nestjs/platform-express"
import { problemFeedbackRawJsonParser } from "../problem-feedback/problem-feedback-http"

export const httpJsonBodyLimit = "1mb"
export const driveTextEditJsonBodyLimit = "110mb"
export const skillRepositoryJsonBodyLimit = "80mb"
export const webhookRawBodyLimit = "256kb"

export function registerHttpBodyParsers(app: NestExpressApplication): void {
  app.use(problemFeedbackRawJsonParser)
  app.useBodyParser("raw", { type: isWebhookRawBodyRequest, limit: webhookRawBodyLimit })
  app.useBodyParser("json", { type: isDriveTextEditJsonBodyRequest, limit: driveTextEditJsonBodyLimit })
  app.useBodyParser("json", { type: isLargeJsonBodyRequest, limit: skillRepositoryJsonBodyLimit })
  app.useBodyParser("json", { limit: httpJsonBodyLimit })
  app.useBodyParser("urlencoded", { extended: true, limit: httpJsonBodyLimit })
}

export function isWebhookRawBodyRequest(request: { readonly url?: string }): boolean {
  return request.url?.startsWith("/webhooks/") ?? false
}

export function isSkillRepositoryLargeJsonBodyRequest(request: { readonly url?: string }): boolean {
  const pathname = request.url?.split("?")[0] ?? ""
  return pathname === "/api/skill-repositories/import"
}

export function isDriveTextEditJsonBodyRequest(request: { readonly url?: string }): boolean {
  const pathname = request.url?.split("?")[0] ?? ""
  return /^\/api\/drive\/browser\/(?:owner\/items\/[^/]+|shares\/[^/]+(?:\/items\/[^/]+)?)\/content$/u.test(pathname)
}

export function isLargeJsonBodyRequest(request: { readonly url?: string }): boolean {
  return isSkillRepositoryLargeJsonBodyRequest(request)
}
