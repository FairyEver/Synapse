import type { DriveDiscussionNotificationMetadata } from "@synapse/shared"
import type { SynapseNotification } from "@/types/notification-center"

/** 文档互动通知正文区那一段的标题词。列表与详情共用同一个词。 */
export function discussionContentLabel(meta?: DriveDiscussionNotificationMetadata): string {
  return meta?.action === "replied" ? "回复" : meta?.kind === "message" ? "文末留言" : "评论"
}

/**
 * 「复制正文」到底复制哪一段。
 *
 * 取的是**详情页显示的那一份**，不是原始 `item.body`：按钮叫复制正文，用户复制到的就该是
 * 他看到的那一段。两处回退也照这个标准 —— 站内信还在加载或读取失败时，页面上显示的就是
 * 通知自带的摘要；云盘互动缺快照时，页面上显示的也是它。
 *
 * 提成纯函数是因为这条判断有三个分支加两处回退，而在组件里它只会是一行看不出边界的表达式。
 */
export function notificationDetailText(item: SynapseNotification, mailBody: string | null): string {
  if (item.source === "drive-discussion") {
    const snapshot = item.driveDiscussion?.snapshot
    if (!snapshot) return item.body
    const sections = [
      snapshot.original
        ? `${snapshot.original.kind === "image" ? "评论图片" : "评论原文"}\n${snapshot.original.text}`
        : null,
      snapshot.replyTo
        ? `回复对象 · ${snapshot.replyTo.authorName}\n${snapshot.replyTo.content || "无文本内容"}`
        : null,
      `${discussionContentLabel(item.driveDiscussion)}\n${snapshot.content || "无文本内容"}`,
    ]
    return sections.filter((section): section is string => section !== null).join("\n\n")
  }
  if (item.source === "mail" && item.targetId) return mailBody ?? item.body
  return item.body
}
