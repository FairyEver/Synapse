import { describe, expect, it } from "vitest"

import {
  createImageAttachment,
  createPathAttachment,
  formatDraftAttachmentsForMessage,
  nextImageLabel,
} from "../attachments"

describe("agent attachment helpers", () => {
  it("labels images using Claude Code style numbering", () => {
    expect(nextImageLabel(0)).toBe("[Image #1]")
    expect(nextImageLabel(2)).toBe("[Image #3]")
  })

  it("formats images and paths into readable user message content", () => {
    const image = createImageAttachment({
      id: "img-1",
      mimeType: "image/png",
      size: 10,
      bytes: new ArrayBuffer(3),
    })
    const file = createPathAttachment({
      id: "path-1",
      path: "/Users/liyang/Desktop/课堂内容.md",
      entryType: "file",
    })
    const folder = createPathAttachment({
      id: "path-2",
      path: "/Users/liyang/Downloads/作业范文",
      entryType: "directory",
    })

    expect(formatDraftAttachmentsForMessage("请分析", [image, file, folder])).toBe([
      "[Image #1]",
      "粘贴文件:",
      "/Users/liyang/Desktop/课堂内容.md",
      "",
      "粘贴文件夹:",
      "/Users/liyang/Downloads/作业范文",
      "",
      "请分析",
    ].join("\n"))
  })

  it("allows attachment-only readable content", () => {
    const image = createImageAttachment({
      id: "img-1",
      mimeType: "image/webp",
      size: 10,
      bytes: new ArrayBuffer(3),
    })

    expect(formatDraftAttachmentsForMessage("", [image])).toBe("[Image #1]")
  })
})
