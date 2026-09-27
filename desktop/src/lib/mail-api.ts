import { getSynapseBridge } from "./electron-bridge"
import type { MailOperation, MailOperationResult } from "../types/mail"

export async function mailRequest<K extends MailOperation["kind"]>(operation: Extract<MailOperation, { kind: K }>): Promise<MailOperationResult[K]> {
  const bridge = getSynapseBridge()
  if (!bridge) throw new Error("站内信服务不可用。")
  return await bridge.mail.execute(operation) as MailOperationResult[K]
}
