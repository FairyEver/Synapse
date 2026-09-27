import { randomUUID } from "node:crypto"
import { MAIL_OPEN_HANDLER } from "../../app-capabilities/mail/shared/manifest"
import { SYSTEM_APP_WINDOW_SERVICE_ID, type createDefaultSystemAppWindowService } from "../services/system-app-window-service"

export function createMailProtocolHandlers(registry: { get<T>(id: string): T }) {
  return {
    async [MAIL_OPEN_HANDLER](params: Record<string, unknown>): Promise<void> {
      if (typeof params.deepLink !== "string") throw new Error("站内信链接无效。")
      const url = new URL(params.deepLink)
      const messageId = url.pathname.slice(1)
      if (!/^[a-zA-Z0-9_-]{1,200}$/u.test(messageId)) throw new Error("站内信链接无效。")
      await registry.get<ReturnType<typeof createDefaultSystemAppWindowService>>(SYSTEM_APP_WINDOW_SERVICE_ID)
        .open("mail", { mailOpenRequest: { requestId: randomUUID(), messageId } })
    },
  }
}
