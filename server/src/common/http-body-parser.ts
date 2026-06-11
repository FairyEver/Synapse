import type { NestExpressApplication } from "@nestjs/platform-express"

export const httpJsonBodyLimit = "80mb"
export const webhookRawBodyLimit = "256kb"

export function registerHttpBodyParsers(app: NestExpressApplication): void {
  app.useBodyParser("raw", { type: isWebhookRawBodyRequest, limit: webhookRawBodyLimit })
  app.useBodyParser("json", { limit: httpJsonBodyLimit })
  app.useBodyParser("urlencoded", { extended: true, limit: httpJsonBodyLimit })
}

export function isWebhookRawBodyRequest(request: { readonly url?: string }): boolean {
  return request.url?.startsWith("/webhooks/") ?? false
}
