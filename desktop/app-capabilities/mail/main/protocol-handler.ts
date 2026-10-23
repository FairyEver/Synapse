import { MAIL_OPEN_HANDLER, MAIL_SERVICE_ID, parseMailReference } from "../shared/manifest"
import { MailError } from "../shared/types"
import type { MailService } from "./service"
export function createMailProtocolHandlers(registry: { get<T>(id: string): T }) {
  return { async [MAIL_OPEN_HANDLER](params: Record<string, unknown>): Promise<void> {
    const id = typeof params.deepLink === "string" ? parseMailReference(params.deepLink) : null
    if (!id) throw new MailError("INVALID_REFERENCE", "邮箱链接无效")
    await registry.get<MailService>(MAIL_SERVICE_ID).openMessage(id)
  } }
}
