import { createHash } from "node:crypto"
import { PayloadTooLargeException } from "@nestjs/common"
import type { WebhookBodySummary } from "./webhook-sanitize"

export function createWebhookBodySnapshot(summary: WebhookBodySummary, contentType?: string) {
  // This is the already-sanitized representation used by Automation, not raw
  // HTTP bytes. Strings avoid Prisma/JS reserialization losing special keys.
  const bodyText = summary.bodyKind === "text" ? summary.bodyText ?? "" : JSON.stringify(summary.body)
  const bodyBytes = Buffer.byteLength(bodyText, "utf8")
  if (bodyBytes > 1024 * 1024) throw new PayloadTooLargeException("Webhook payload snapshot is too large")
  return {
    bodyText,
    bodySha256: createHash("sha256").update(bodyText, "utf8").digest("hex"),
    bodyBytes,
    bodyContentType: contentType ?? null,
    payloadVersion: 1,
  }
}
