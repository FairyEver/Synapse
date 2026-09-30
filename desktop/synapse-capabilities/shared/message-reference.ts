const messageIdPattern = /^[A-Za-z0-9_-]{1,200}$/u

function validId(id: string): string {
  if (!messageIdPattern.test(id)) throw new Error("invalid_message_id")
  return id
}

export function buildMailMessageReference(messageId: string): string {
  return `synapse://mail/${validId(messageId)}`
}

export function parseMailMessageReference(reference: string): string {
  const match = /^synapse:\/\/mail\/([A-Za-z0-9_-]{1,200})$/u.exec(reference)
  if (!match) throw new Error("invalid_mail_reference")
  return match[1]
}

export function buildNotificationReference(id: string): string {
  return `synapse:notification:${validId(id)}`
}

export function parseNotificationReference(reference: string): string {
  const match = /^synapse:notification:([A-Za-z0-9_-]{1,200})$/u.exec(reference)
  if (!match) throw new Error("invalid_notification_reference")
  return match[1]
}
