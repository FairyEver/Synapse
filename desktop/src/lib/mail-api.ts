import { getSynapseBridge } from "./electron-bridge"
import type { MailOperation, MailOperationResult } from "../types/mail"

export async function mailRequest<K extends MailOperation["kind"]>(operation: Extract<MailOperation, { kind: K }>): Promise<MailOperationResult[K]> {
  const bridge = getSynapseBridge()
  if (!bridge) throw new Error("站内信服务不可用。")
  const request = operation as MailOperation
  let result: unknown
  switch (request.kind) {
    case "recipientSearch": result = await bridge.mailInternal.recipient.list({ query: request.query, cursor: request.cursor }); break
    case "organizationSearch": result = await bridge.mailInternal.organization.list({ query: request.query }); break
    case "organizationMembers": result = await bridge.mailInternal.organization.members({ organizationId: request.organizationId, cursor: request.cursor }); break
    case "messageList": result = await bridge.mailInternal.message.list({ box: request.box, query: request.query, cursor: request.cursor, unreadOnly: request.unreadOnly, contactKey: request.contactKey }); break
    case "contactList": result = await bridge.mailInternal.contact.list({ box: request.box }); break
    case "messageCount": result = await bridge.mailInternal.message.count(); break
    case "messageReadAll": result = await bridge.mailInternal.message.readAll(); break
    case "messageDeleteBatch": result = await bridge.mailInternal.message.deleteBatch({ messageIds: request.messageIds, box: request.box }); break
    case "messageDeleteAll": result = await bridge.mailInternal.message.deleteAll({ box: request.box }); break
    case "messageGet": result = await bridge.mailInternal.message.get({ messageId: request.messageId }); break
    case "messageContext": result = await bridge.mailInternal.context.list({ messageId: request.messageId, cursor: request.cursor }); break
    case "messageSetRead": result = await bridge.mailInternal.message.update({ messageId: request.messageId, read: request.read }); break
    case "messageDelete": result = await bridge.mailInternal.message.delete({ messageId: request.messageId, box: request.box }); break
    case "attachmentLocal": result = await bridge.mailInternal.attachment.localCreate({ filePath: request.filePath }); break
    case "attachmentDownload": result = await bridge.mailInternal.attachment.downloadFile({ messageId: request.messageId, attachmentId: request.attachmentId, outputPath: request.outputPath }); break
    case "sendPreview": result = await bridge.mailInternal.send.preview({ content: request.content }); break
    case "send": result = await bridge.mailInternal.message.send({ previewId: request.previewId, clientRequestId: request.clientRequestId }); break
    default: {
      const unreachable: never = request
      throw new Error(`未知的站内信操作：${String(unreachable)}`)
    }
  }
  return result as MailOperationResult[K]
}
