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
  const points = Array.from(plainText(parser.parse(event.body) as TextNode).replace(/\s+/gu, " ").trim())
  const body = points.length > 120 ? points.slice(0, 119).join("") + "…" : points.join("")
  const sourceKey = event.kind === "annotation" ? "drive:annotation-comment:" + event.targetCommentId
    : event.action === "created" ? "drive:message:" + event.root.id : "drive:message-comment:" + event.targetCommentId
  return { title: titleFor(actor, name), body, sourceKey, meta: { kind: event.kind, action: event.action } }
}
