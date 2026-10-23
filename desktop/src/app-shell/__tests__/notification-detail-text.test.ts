import { describe, expect, it } from "vitest"
import { notificationDetailText } from "../notification-detail-text"
import type { SynapseNotification } from "@/types/notification-center"

function notification(overrides: Partial<SynapseNotification> = {}): SynapseNotification {
  return {
    id: "n1", source: "system-notifier", title: "标题", body: "正文",
    group: null, url: null, copyOnTap: false, level: "active",
    targetId: null, deviceId: null, readAt: null, resolvedAt: null,
    createdAt: "2026-10-15T08:00:00.000Z",
    ...overrides,
  }
}

describe("notificationDetailText", () => {
  it("copies the plain body", () => {
    expect(notificationDetailText(notification(), null)).toBe("正文")
  })

  it("copies the mail body once it has loaded", () => {
    const item = notification({ source: "mail-internal", targetId: "m1" })
    expect(notificationDetailText(item, "来信正文")).toBe("来信正文")
  })

  it("falls back to the notification body when the mail has not loaded", () => {
    const item = notification({ source: "mail-internal", targetId: "m1" })
    expect(notificationDetailText(item, null)).toBe("正文")
  })

  it("joins the discussion snapshot in the order the detail page shows it", () => {
    const item = notification({
      source: "drive-discussion",
      driveDiscussion: {
        kind: "annotation",
        action: "replied",
        snapshot: {
          detailTitle: "文档标题",
          content: "本次回复",
          original: { kind: "text", text: "原文" },
          replyTo: { authorName: "某人", content: "被回复的内容" },
        },
      },
    })
    expect(notificationDetailText(item, null)).toBe("评论原文\n原文\n\n回复对象 · 某人\n被回复的内容\n\n回复\n本次回复")
  })

  it("labels an image original as 评论图片", () => {
    const item = notification({
      source: "drive-discussion",
      driveDiscussion: {
        kind: "annotation",
        action: "replied",
        snapshot: {
          detailTitle: "文档标题",
          content: "本次回复",
          original: { kind: "image", text: "图片说明" },
          replyTo: { authorName: "某人", content: "被回复的内容" },
        },
      },
    })
    expect(notificationDetailText(item, null)).toBe("评论图片\n图片说明\n\n回复对象 · 某人\n被回复的内容\n\n回复\n本次回复")
  })

  it("falls back to the body when the snapshot is missing", () => {
    const item = notification({ source: "drive-discussion", driveDiscussion: { kind: "annotation", action: "created" } })
    expect(notificationDetailText(item, null)).toBe("正文")
  })
})
