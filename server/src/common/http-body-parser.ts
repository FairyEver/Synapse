import type { NestExpressApplication } from "@nestjs/platform-express"

export const httpJsonBodyLimit = "1mb"
export const skillRepositoryJsonBodyLimit = "80mb"
export const webhookRawBodyLimit = "256kb"

export function registerHttpBodyParsers(app: NestExpressApplication): void {
  app.useBodyParser("raw", { type: isWebhookRawBodyRequest, limit: webhookRawBodyLimit })
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

export function isLargeJsonBodyRequest(request: { readonly url?: string }): boolean {
  return isSkillRepositoryLargeJsonBodyRequest(request)
}
