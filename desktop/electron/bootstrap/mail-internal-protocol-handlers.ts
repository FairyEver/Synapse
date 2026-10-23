import { parseMailMessageReference } from "../../synapse-capabilities/shared/message-reference"
import { randomUUID } from "node:crypto"
import { MAIL_INTERNAL_OPEN_HANDLER } from "../../app-capabilities/mail-internal/shared/manifest"
import { SYSTEM_APP_WINDOW_SERVICE_ID, type createDefaultSystemAppWindowService } from "../services/system-app-window-service"

export function createMailInternalProtocolHandlers(registry: { get<T>(id: string): T }) {
  return {
    async [MAIL_INTERNAL_OPEN_HANDLER](params: Record<string, unknown>): Promise<void> {
      if (typeof params.deepLink !== "string") throw new Error("站内信链接无效。")
      const messageId = parseMailMessageReference(params.deepLink)
      await registry.get<ReturnType<typeof createDefaultSystemAppWindowService>>(SYSTEM_APP_WINDOW_SERVICE_ID)
        .open("mail-internal", { mailInternalOpenRequest: { requestId: randomUUID(), messageId } })
    },
  }
}
