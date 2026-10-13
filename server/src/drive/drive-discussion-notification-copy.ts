import remarkParse from "remark-parse"
import remarkGfm from "remark-gfm"
import { unified } from "unified"
import type { DriveDiscussionEvent, DriveDiscussionRecipient } from "./drive-discussion-notification.types"

export function collectDriveDiscussionRecipients(event: DriveDiscussionEvent): DriveDiscussionRecipient[] {
  const recipients: DriveDiscussionRecipient[] = []
  if (event.action === "replied") {
    if (event.directlyRepliedTo) recipients.push({ ...event.directlyRepliedTo, role: "direct" })
    recipients.push({ ...event.root.author, role: "starter" })
  }
  recipients.push({ userId: event.item.userId, sourceShareId: null, role: "owner" })
  const unique = new Map<string, DriveDiscussionRecipient>()
  for (const recipient of recipients) {
    if (recipient.userId !== event.actor.userId && !unique.has(recipient.userId)) unique.set(recipient.userId, recipient)
  }
  return [...unique.values()].map((r) => r.userId === event.item.userId ? { ...r, sourceShareId: null } : r)
}

const parser = unified().use(remarkParse).use(remarkGfm)
type TextNode = { type: string; value?: string; alt?: string; children?: TextNode[] }
function plainText(node: TextNode): string {
  if (node.type === "html" || node.type === "definition") return ""
  if (node.type === "image" || node.type === "imageReference") return node.alt ?? ""
  if (node.value !== undefined) return node.value + (node.type === "code" ? " " : "")
  return (node.children ?? []).map(plainText).join("") + (["paragraph", "heading", "listItem"].includes(node.type) ? " " : "")
}
function clipUtf16(value: string, limit: number): string {
  let result = ""
  for (const point of value) { if (result.length + point.length > limit) break; result += point }
  return result
}
function excerpt(value: string, limit: number): string {
  const points = Array.from(value.replace(/\s+/gu, " ").trim())
  return points.length > limit ? points.slice(0, limit - 1).join("") + "…" : points.join("")
}
function markdownText(value: string): string { return plainText(parser.parse(value) as TextNode) }
export function buildDriveDiscussionNotificationCopy(event: DriveDiscussionEvent, recipient: DriveDiscussionRecipient) {
  const noun = event.kind === "annotation" ? "评论" : "留言"
  const titleFor = (actor: string, name: string): string => {
    if (event.action === "created") return event.kind === "annotation" ? actor + "评论了《" + name + "》" : actor + "在《" + name + "》中留言"
    if (recipient.role === "direct") return actor + "回复了你在《" + name + "》中的" + noun
    if (recipient.role === "starter") return actor + "回复了你在《" + name + "》中发起的" + (event.kind === "annotation" ? "讨论" : "留言讨论")
    return actor + "回复了《" + name + "》中的" + noun
  }
  let actor = event.actor.handle
  const name = clipUtf16(event.item.name, Math.max(1, 64 - titleFor(actor, "").length))
  actor = clipUtf16(actor, Math.max(1, 64 - titleFor("", name).length))
  const content = markdownText(event.body)
  const original = event.original ? { kind: event.original.kind, text: excerpt(event.original.text, 200) } : undefined
  const replyTo = event.action === "replied" && event.replyTo ? {
    authorName: excerpt(event.replyTo.authorName, 200), content: excerpt(markdownText(event.replyTo.content), 200),
  } : undefined
  const context = replyTo ? "回复：" + excerpt(replyTo.content, 60) : original ? "原文：" + excerpt(original.text, 60) : null
  const body = excerpt(content, 120) + (context ? "\n" + context : "")
  const snapshot = { detailTitle: titleFor(event.actor.handle, event.item.name), content: excerpt(content, 500),
    ...(original ? { original } : {}), ...(replyTo ? { replyTo } : {}) }
  const sourceKey = event.kind === "annotation" ? "drive:annotation-comment:" + event.targetCommentId
    : event.action === "created" ? "drive:message:" + event.root.id : "drive:message-comment:" + event.targetCommentId
  return { title: titleFor(actor, name), body, sourceKey, meta: { kind: event.kind, action: event.action, snapshot } }
}
