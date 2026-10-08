import { getSynapseBridge } from "./electron-bridge"
import type { MailOperation, MailOperationResult } from "../types/mail"

export async function mailRequest<K extends MailOperation["kind"]>(operation: Extract<MailOperation, { kind: K }>): Promise<MailOperationResult[K]> {
  const bridge = getSynapseBridge()
  if (!bridge) throw new Error("站内信服务不可用。")
  const request = operation as MailOperation
  let result: unknown
  switch (request.kind) {
    case "recipientSearch": result = await bridge.mail.recipient.list({ query: request.query, cursor: request.cursor }); break
    case "organizationSearch": result = await bridge.mail.organization.list({ query: request.query }); break
    case "organizationMembers": result = await bridge.mail.organization.members({ organizationId: request.organizationId, cursor: request.cursor }); break
    case "messageList": result = await bridge.mail.message.list({ box: request.box, query: request.query, cursor: request.cursor, unreadOnly: request.unreadOnly }); break
    case "messageCount": result = await bridge.mail.message.count(); break
    case "messageReadAll": result = await bridge.mail.message.readAll(); break
    case "messageDeleteBatch": result = await bridge.mail.message.deleteBatch({ messageIds: request.messageIds, box: request.box }); break
    case "messageDeleteAll": result = await bridge.mail.message.deleteAll({ box: request.box }); break
    case "messageGet": result = await bridge.mail.message.get({ messageId: request.messageId }); break
    case "messageContext": result = await bridge.mail.context.list({ messageId: request.messageId, cursor: request.cursor }); break
    case "messageSetRead": result = await bridge.mail.message.update({ messageId: request.messageId, read: request.read }); break
    case "messageDelete": result = await bridge.mail.message.delete({ messageId: request.messageId, box: request.box }); break
    case "attachmentLocal": result = await bridge.mail.attachment.localCreate({ filePath: request.filePath }); break
    case "attachmentDownload": result = await bridge.mail.attachment.downloadFile({ messageId: request.messageId, attachmentId: request.attachmentId, outputPath: request.outputPath }); break
    case "sendPreview": result = await bridge.mail.send.preview({ content: request.content }); break
    case "send": result = await bridge.mail.message.send({ previewId: request.previewId, clientRequestId: request.clientRequestId }); break
    default: {
      const unreachable: never = request
      throw new Error(`未知的站内信操作：${String(unreachable)}`)
    }
  }
  return result as MailOperationResult[K]
}
