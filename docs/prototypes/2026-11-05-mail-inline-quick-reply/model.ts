import type { MailContact, MailMessage, MailPerson } from "@/types/mail"

export type MailBox = "inbox" | "sent"

export const viewer: MailPerson = { userId: "viewer", nickname: "李杨", handle: "yang.li" }

const people = {
  fanxw: { userId: "fanxw", nickname: "樊晓旺", handle: "fanxw" },
  liucj: { userId: "liucj", nickname: "刘春杰", handle: "liucj" },
  wanglei: { userId: "wanglei", nickname: "王璐", handle: "wanglei" },
  chenpeng: { userId: "chenpeng", nickname: "陈鹏", handle: "chenpeng" },
  gongshuo: { userId: "gongshuo", nickname: "巩固", handle: "gongshuo" },
  lizeNing: { userId: "lizening", nickname: "李泽宁", handle: "lizening" },
  system: { userId: "system", nickname: "Synapse", handle: "synapse" },
} satisfies Record<string, MailPerson>

function inbox(id: string, sender: MailPerson, subject: string, body: string, sentAt: string, unread = false): MailMessage {
  return {
    messageId: id,
    kind: "user",
    sender,
    recipients: [viewer],
    toRecipients: [viewer],
    ccRecipients: [],
    relationKind: null,
    subject,
    snippet: body.replaceAll("\n", " ").slice(0, 72),
    sentAt,
    readAt: unread ? null : sentAt,
    attachmentCount: 0,
    viewerId: viewer.userId,
    body,
    team: { id: "team-world-tech", name: "World Tech" },
    conversationId: id,
    replyToId: null,
    relation: null,
    quote: null,
    attachments: [],
  }
}

function sent(id: string, to: MailPerson[], subject: string, body: string, sentAt: string): MailMessage {
  return {
    messageId: id,
    kind: "user",
    sender: viewer,
    recipients: to,
    toRecipients: to,
    ccRecipients: [],
    relationKind: null,
    subject,
    snippet: body,
    sentAt,
    readAt: sentAt,
    attachmentCount: 0,
    viewerId: viewer.userId,
    body,
    team: { id: "team-world-tech", name: "World Tech" },
    conversationId: id,
    replyToId: null,
    relation: null,
    quote: null,
    attachments: [],
  }
}

export function initialMessages(): MailMessage[] {
  return [
    inbox("mail-test", people.fanxw, "测试邮件", "李杨，你好：\n\n这是一封测试邮件，请忽略。\n\n谢谢！", "2026-11-05T16:49:00+08:00"),
    inbox("mail-hr-reply-1", people.liucj, "回复：人力部署申请", "申请已收到，我先核对人员范围和上线时间，确认后再回复。", "2026-11-05T15:49:00+08:00"),
    inbox("mail-hr-reply-2", people.fanxw, "回复：人力部署申请", "部署窗口可以放在今晚，相关审批已经完成。", "2026-11-05T14:20:00+08:00", true),
    inbox("mail-hr", people.wanglei, "人力部署申请", "需要在本周完成人力系统测试环境部署，请协助安排。", "2026-11-05T14:10:00+08:00"),
    inbox("mail-finance-reply-1", people.liucj, "回复：财务系统部署申请", "测试环境已经准备完成，可以开始验证。", "2026-11-05T13:40:00+08:00"),
    inbox("mail-finance-reply-2", people.fanxw, "回复：财务系统部署申请", "收到，我补充一下回滚检查项。", "2026-11-05T12:20:00+08:00", true),
    inbox("mail-finance", people.chenpeng, "财务系统部署申请", "财务系统测试版本已完成打包，请安排测试环境部署。", "2026-11-05T11:45:00+08:00"),
    inbox("mail-purchase", people.gongshuo, "回复：采购优化 app 已经完成，提交测试", "采购优化 app 已完成本轮修复，现提交测试。", "2026-11-05T09:20:00+08:00"),
    inbox("mail-update", people.system, "Synapse v1.0.100 更新内容", "本次更新包含站内信体验与稳定性改进。", "2026-11-05T08:00:00+08:00"),
    sent("mail-sent-1", [people.fanxw], "回复：测试邮件", "收到。", "2026-11-05T16:52:00+08:00"),
  ]
}

export function personName(person: MailPerson): string {
  return person.nickname || person.handle || person.userId
}

export function personEmail(person: MailPerson): string {
  return person.userId === viewer.userId ? "yang.li@world-tech.com.cn" : `${person.handle ?? person.userId}@world-tech.com.cn`
}

export function addressNames(people: MailPerson[]): string {
  return people.map(personName).join("、")
}

export function contactKey(person: MailPerson, kind: MailContact["kind"]): string {
  return `${kind}:${person.userId}`
}

export function contactsFor(messages: MailMessage[], box: MailBox): MailContact[] {
  const contacts = new Map<string, MailContact>()
  for (const message of messages.filter((item) => messageBox(item) === box)) {
    const parties = box === "inbox" ? [message.sender] : message.toRecipients
    for (const person of parties) {
      const kind: MailContact["kind"] = message.kind === "platform_broadcast" && person.userId === people.system.userId ? "platform" : "user"
      const key = contactKey(person, kind)
      const current = contacts.get(key)
      contacts.set(key, {
        key,
        kind,
        name: personName(person),
        handle: person.handle,
        teamName: null,
        unread: (current?.unread ?? 0) + Number(box === "inbox" && message.readAt === null),
        lastSentAt: current && current.lastSentAt > message.sentAt ? current.lastSentAt : message.sentAt,
      })
    }
  }
  return [...contacts.values()].sort((left, right) => right.lastSentAt.localeCompare(left.lastSentAt) || left.name.localeCompare(right.name))
}

export function messageBox(message: MailMessage): MailBox {
  return message.sender.userId === viewer.userId ? "sent" : "inbox"
}

export function messageMatchesContact(message: MailMessage, box: MailBox, key: string | null): boolean {
  if (!key) return true
  const parties = box === "inbox" ? [message.sender] : message.toRecipients
  return parties.some((person) => contactKey(person, message.kind === "platform_broadcast" ? "platform" : "user") === key)
}

export function sentTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value))
}

export function fullTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value))
}
