import { describe, expect, it } from "vitest"

import {
  attachmentDisplayName,
  attachmentMetadata,
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

  it("formats attachment names and metadata for the composer strip", () => {
    const spreadsheet = createPathAttachment({
      id: "path-1",
      path: "/Users/liyang/Desktop/薪资等级.xlsx",
      entryType: "file",
      size: 10 * 1024,
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    })
    const markdown = createPathAttachment({
      id: "path-2",
      path: "/Users/liyang/Desktop/说明.md",
      entryType: "file",
    })
    const unknown = createPathAttachment({
      id: "path-3",
      path: "/Users/liyang/Desktop/archive.sqlite",
      entryType: "file",
      size: 1536,
    })
    const folder = createPathAttachment({
      id: "path-4",
      path: "/Users/liyang/Desktop/materials",
      entryType: "directory",
    })
    const image = createImageAttachment({
      id: "img-1",
      name: "screen.webp",
      mimeType: "image/webp",
      size: 3,
      bytes: new ArrayBuffer(3),
    })
    const unnamedImage = createImageAttachment({
      id: "img-2",
      mimeType: "image/png",
      size: 0,
      bytes: new ArrayBuffer(0),
    })
    const attachments = [spreadsheet, markdown, unknown, folder, image, unnamedImage]

    expect(attachmentDisplayName(attachments, spreadsheet, 0)).toBe("薪资等级.xlsx")
    expect(attachmentMetadata(spreadsheet)).toBe("Excel · 10 KB")
    expect(attachmentMetadata(markdown)).toBe("Markdown")
    expect(attachmentMetadata(unknown)).toBe("SQLITE · 1.5 KB")
    expect(attachmentMetadata(folder)).toBe("文件夹")
    expect(attachmentDisplayName(attachments, image, 4)).toBe("screen.webp")
    expect(attachmentMetadata(image)).toBe("WebP · 3 B")
    expect(attachmentDisplayName(attachments, unnamedImage, 5)).toBe("[Image #2]")
    expect(attachmentMetadata(unnamedImage)).toBe("PNG · 0 B")
  })
})
